'use strict';

// RD tab: data consistency, language review, keyword tips for unused keywords, claim extraction + fact-check,
// external link suggestions and link status. (Keyword highlighting and counts happen in the browser.)
// The fact-check actions are also used by Publish and Live checks. The fact-check logic itself, including the
// "Fact Cache" that stops the same sentence being paid for twice, lives in lib/factcheck.js.
// "decisions" and "decide" record who marked an RD issue as not an error (the "Issue Decisions" sheet tab).

const { handler, HttpError, nowIST, isCompetitor, toList, cap } = require('../lib/http');
const checks = require('../lib/checks');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');
const FC = require('../lib/factcheck');
const jev = require('../lib/jev');
const { checkUrls } = require('../lib/linkcheck');

// The AI sometimes files wording problems under "consistency". An item is a language item when it talks about
// grammar, spelling or naming and does not describe a number conflict.
const LANG_RE = /grammar|spelling|misspel|typo|\barticle\b|tense|punctuation|comma|capitali[sz]|agreement|extra word|missing word|repeated|repetition|duplicate|abbreviat|house style|unnatural|phrase|plural|singular|hyphen|wording|synonym|named inconsistently|full form/i;
const NUMBER_RE = /mismatch|differ|conflict|contradict|\bcagr\b|\bshare\b|\d{3,}|\d ?%/i;

function splitConsistency(list) {
  const data = [];
  const language = [];
  (list || []).forEach((x) => {
    if (LANG_RE.test(x.problem) && !NUMBER_RE.test(x.problem)) language.push(Object.assign({}, x, { severity: x.severity === 'error' ? 'warning' : x.severity }));
    else data.push(x);
  });
  return { data, language };
}

// A fact worth checking names something: it has a month-and-year date, or a proper name after its first word.
// Follow-on sentences such as "This approval allows couples to ..." have neither and are left out.
const MONTH_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},\s+)?(?:19|20)\d{2}\b/;
function namesSomething(sentence) {
  const s = String(sentence || '');
  return MONTH_RE.test(s) || /\s[A-Z][a-z]{2,}/.test(s.slice(1));
}

// Reports and issues are matched by their letters and digits only, so spacing and punctuation do not matter.
function plainKey(s, max) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, max || 200); }

const DECISIONS = ['Not an error', 'Error'];

module.exports = handler({
  async review(b) {
    const content = String(b.content || '').trim();
    if (content.length < 200) throw new HttpError(400, 'Paste the full RD content (at least a few paragraphs).');
    const primary = String(b.primary || '').trim();
    const secondaries = toList(b.secondaries);
    const coverage = checks.coverage(content, primary, secondaries);
    const fig = checks.figuresCheck(content);
    const lint = checks.lint(content);
    const missing = coverage.rows.filter((r) => r.count === 0).map((r) => r.keyword);
    let out = {};
    let aiError = '';
    try {
      out = await ai.chatJSON({ system: P.qcSystem(P.RD_FORMAT), user: P.rdReviewTask({ content, primary, secondaries, reportName: b.reportName, missing }) });
    } catch (e) {
      aiError = e.message;
    }
    // AI findings are kept only when the text they quote is really in the content.
    const sorted = splitConsistency(checks.grounded(checks.normIssues(out.consistency, 'Consistency'), content));
    const aiLanguage = checks.grounded(checks.normIssues(out.language, 'Language'), content);
    return {
      coverage,
      figures: fig.figures,
      consistency: checks.strip(checks.dedupe(fig.issues.concat(lint.filter((i) => i.category === 'data'), sorted.data))),
      language: checks.strip(checks.dedupe(lint.filter((i) => i.category !== 'data').concat(aiLanguage, sorted.language))),
      structure: checks.normIssues(out.structure, 'Structure'),
      keywordTips: (Array.isArray(out.keyword_tips) ? out.keyword_tips : []).filter((x) => x && x.keyword).map((x) => ({ keyword: String(x.keyword), suggestion: String(x.suggestion || '') })),
      aiError
    };
  },

  // The current decision for every issue of a report that someone has marked (latest row wins).
  async decisions(b) {
    const report = plainKey(b.report, 160);
    if (!report) return { decisions: [] };
    const rows = await sheets.readTab('DECISIONS');
    const latest = new Map();
    rows.forEach((r) => {
      const key = String(r['Key'] || '').trim();
      if (!key || plainKey(r['Report'], 160) !== report) return;
      latest.set(key, { key, decision: String(r['Decision'] || ''), by: String(r['By'] || ''), at: String(r['At'] || '') });
    });
    return { decisions: Array.from(latest.values()) };
  },

  // Records that the signed-in person marked an issue as "Not an error" (or as an "Error" again).
  // The name comes from the sign-in, not from the browser, so the log can be trusted.
  async decide(b, req) {
    const by = String((req && req.user) || '').trim();
    if (!by) throw new HttpError(419, 'Please sign in to continue.');
    const reportName = String(b.report || '').trim();
    if (!plainKey(reportName)) throw new HttpError(400, 'Enter the report name before marking an issue.');
    const decision = DECISIONS.indexOf(b.decision) >= 0 ? b.decision : '';
    if (!decision) throw new HttpError(400, 'Unknown decision.');
    const key = plainKey(b.quote || b.problem);
    if (!key) throw new HttpError(400, 'This issue has no text to remember it by.');
    const at = nowIST();
    await sheets.appendRows('DECISIONS', [{
      'At': at,
      'By': by,
      'Report': reportName,
      'Decision': decision,
      'Section': String(b.section || ''),
      'Severity': String(b.severity || ''),
      'Problem': cap(b.problem, 1000),
      'Quote': cap(b.quote, 600),
      'Key': key
    }]);
    return { key, decision, by, at };
  },

  // Finds the facts to check. Facts already in the Fact Cache come back with their stored verdict ("cached"),
  // so the browser only sends the new ones to "verify". Each claim also carries the external link found in
  // its sentence ("linkUrl"), which is what gets checked when no web search is available.
  async claims(b) {
    const content = String(b.content || '').trim();
    if (!content) throw new HttpError(400, 'No content to fact-check.');
    const links = (Array.isArray(b.links) ? b.links : []).filter((l) => l && String(l.text || '').trim().length > 2)
      .map((l) => ({ text: String(l.text).trim().toLowerCase(), href: String(l.href || '').trim() })).slice(0, 200);
    const linked = links.map((l) => l.text)
      .concat((Array.isArray(b.linked) ? b.linked : []).map((x) => String(x || '').trim().toLowerCase()).filter((x) => x.length > 2));
    const max = Math.max(3, Math.min(Number(b.max) || 10, 14));

    let cache = new Map();
    let cacheError = '';
    try { cache = await FC.loadCache(); } catch (e) { cacheError = e.message; }

    let list = null;
    let triage = 'openai';
    let triageError = '';
    let candidates = 0;
    if (jev.configured() && String(process.env.FACT_TRIAGE || 'jev').toLowerCase() !== 'openai') {
      try {
        const r = await FC.extractClaims(content, max, cache);
        list = r.claims;
        candidates = r.candidates;
        triage = 'jev';
      } catch (e) {
        triageError = e.message;
      }
    }
    if (!list) {
      const out = await ai.chatJSON({ system: P.claimsSystem(), user: P.claimsTask(content, max) });
      list = (Array.isArray(out.claims) ? out.claims : []).filter((c) => c && c.claim).slice(0, max).map((c) => {
        const sentence = String(c.sentence || '');
        const key = FC.sentenceKey(sentence);
        const hit = key ? cache.get(key) : null;
        return { sentence, key, claim: String(c.claim), anchor: String(c.anchor || '').trim(), date: String(c.date || ''), cached: hit ? FC.fromCache(hit) : null };
      });
    }
    list = list.filter((c) => namesSomething(c.sentence));

    const claims = list.map((c, i) => {
      const lower = c.sentence.toLowerCase();
      const source = links.find((l) => /^https?:\/\//i.test(l.href) && !/kingsresearch\.com/i.test(l.href) && lower.indexOf(l.text) >= 0);
      return {
        id: i + 1,
        key: c.key,
        sentence: c.sentence,
        claim: c.claim,
        anchor: c.anchor,
        date: c.date,
        hasLink: linked.some((l) => lower.indexOf(l) >= 0),
        linkUrl: source ? source.href : '',
        anchorInContent: !!c.anchor && content.indexOf(c.anchor) >= 0,
        cached: c.cached || null
      };
    });
    return {
      claims,
      info: { engine: FC.engine(), triage, triageError, cacheError, candidates, reused: claims.filter((c) => c.cached).length }
    };
  },

  // Each claim is checked on its own (in parallel), so sources are not mixed up between claims.
  // engine "deep" can be forced per call (the "Deep check" button); otherwise the server setting decides.
  async verify(b) {
    const claims = (Array.isArray(b.claims) ? b.claims : []).filter((c) => c && c.claim).slice(0, 4);
    if (!claims.length) return { results: [], searched: false };
    const eng = b.engine === 'deep' ? 'deep' : FC.engine();
    const results = await Promise.all(claims.map((c) => FC.verifyClaim(c, eng).catch((e) => ({
      id: c.id, engine: eng === 'lite' ? 'lite' : 'deep', verdict: 'Error', correction: '', sourceUrl: '', sourceTitle: '', note: e.message,
      confidence: null, cited: false, searched: false, searchError: e.message
    }))));
    const urls = results.map((r) => r.sourceUrl).filter(Boolean);
    const status = await checkUrls(urls, 4);
    const byUrl = new Map(status.map((s) => [s.url, s]));
    results.forEach((r) => {
      if (!r.sourceUrl) return;
      const s = byUrl.get(r.sourceUrl);
      // null = could not tell (the site blocks automated checks); false = the link is broken.
      r.reachable = s ? (s.ok ? true : ([401, 403, 405, 429, 999].indexOf(s.status) >= 0 ? null : false)) : null;
      r.httpStatus = s ? s.status : 0;
    });
    // Remember the verdicts so the same sentence is not checked again (best effort: a sheet error must not fail the check).
    try { await FC.saveCache(claims, results, String(b.reportName || '')); } catch (e) { /* ignore */ }
    const searched = results.some((r) => r.searched);
    const searchError = (results.find((r) => r.searchError) || {}).searchError || '';
    return { results, searched, searchError, engine: eng };
  },

  async links(b) {
    const urls = Array.from(new Set((Array.isArray(b.urls) ? b.urls : []).map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u)))).slice(0, 40);
    const results = await checkUrls(urls, 8);
    return { results: results.map((r) => Object.assign({}, r, { competitor: isCompetitor(r.url) })) };
  },

  async save(b, req) {
    const writer = String((req && req.user) || b.user || '').trim();
    if (!writer) throw new HttpError(400, 'Sign in first.');
    await sheets.appendRows('RD', [{
      'Checked At': nowIST(),
      'Writer': writer,
      'Report Name': String(b.reportName || ''),
      'Primary Keyword': String(b.primary || ''),
      'Word Count': Number(b.words) || '',
      'Keywords Found': String(b.found || ''),
      'Keywords Missing': String(b.missing || ''),
      'Data Consistency': String(b.consistency || ''),
      'Language & Style': String(b.language || ''),
      'Structure': String(b.structure || ''),
      'Fact Check': String(b.facts || ''),
      'External Link Suggestions': String(b.suggestions || ''),
      'Issue Count': Number(b.issueCount) || 0
    }]);
    return { saved: true };
  }
});
