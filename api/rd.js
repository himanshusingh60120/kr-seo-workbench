'use strict';

// RD tab: data consistency, language review, keyword tips for unused keywords, claim extraction + fact-check,
// external link suggestions and link status. (Keyword highlighting and counts happen in the browser.)
// The fact-check actions are also used by Publish and Live checks. The fact-check logic itself, including the
// "Fact Cache" that stops the same sentence being paid for twice, lives in lib/factcheck.js.

const { handler, HttpError, nowIST, isCompetitor, toList } = require('../lib/http');
const checks = require('../lib/checks');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');
const FC = require('../lib/factcheck');
const jev = require('../lib/jev');
const { checkUrls } = require('../lib/linkcheck');

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
    return {
      coverage,
      figures: fig.figures,
      consistency: checks.strip(checks.dedupe(fig.issues.concat(lint.filter((i) => i.category === 'data'), checks.normIssues(out.consistency, 'Consistency')))),
      language: checks.strip(checks.dedupe(lint.filter((i) => i.category !== 'data').concat(checks.normIssues(out.language, 'Language')))),
      structure: checks.normIssues(out.structure, 'Structure'),
      keywordTips: (Array.isArray(out.keyword_tips) ? out.keyword_tips : []).filter((x) => x && x.keyword).map((x) => ({ keyword: String(x.keyword), suggestion: String(x.suggestion || '') })),
      aiError
    };
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

  async save(b) {
    const writer = String(b.user || '').trim();
    if (!writer) throw new HttpError(400, 'Enter your name (top right) first.');
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
