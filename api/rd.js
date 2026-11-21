'use strict';

// RD tab: keyword coverage, data consistency, language review, claim extraction + web fact-check,
// external link suggestions (from verified sources) and link status. Also used by Publish/Live checks for facts.

const { handler, HttpError, nowIST, isCompetitor, toList } = require('../lib/http');
const checks = require('../lib/checks');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');
const { checkUrls } = require('../lib/linkcheck');

function normVerdict(v) {
  const s = String(v || '').toLowerCase();
  if (s.indexOf('partial') >= 0) return 'Partially supported';
  if (s.indexOf('contradict') >= 0 || s.indexOf('false') >= 0) return 'Contradicted';
  if (s.indexOf('support') >= 0 || s.indexOf('true') >= 0) return 'Supported';
  return 'Unverifiable';
}

function sameUrl(a, b) {
  const n = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return !!a && !!b && n(a) === n(b);
}

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

  async claims(b) {
    const content = String(b.content || '').trim();
    if (!content) throw new HttpError(400, 'No content to fact-check.');
    const linked = (Array.isArray(b.linked) ? b.linked : []).map((x) => String(x || '').trim()).filter((x) => x.length > 2);
    const max = Math.max(3, Math.min(Number(b.max) || 10, 14));
    const out = await ai.chatJSON({ system: P.claimsSystem(), user: P.claimsTask(content, max) });
    const claims = (Array.isArray(out.claims) ? out.claims : []).filter((c) => c && c.claim).slice(0, max).map((c, i) => {
      const sentence = String(c.sentence || '');
      const lower = sentence.toLowerCase();
      const anchor = String(c.anchor || '').trim();
      return {
        id: i + 1,
        sentence,
        claim: String(c.claim),
        anchor,
        date: String(c.date || ''),
        hasLink: linked.some((l) => lower.indexOf(l.toLowerCase()) >= 0),
        anchorInContent: !!anchor && content.indexOf(anchor) >= 0
      };
    });
    return { claims };
  },

  async verify(b) {
    const claims = (Array.isArray(b.claims) ? b.claims : []).filter((c) => c && c.claim).slice(0, 4);
    if (!claims.length) return { results: [], searched: false };
    const res = await ai.webSearchJSON({ instructions: P.verifySystem(), input: P.verifyTask(claims) });
    const raw = Array.isArray(res.data.results) ? res.data.results : [];
    const results = claims.map((c, i) => {
      const r = raw.find((x) => Number(x && x.id) === Number(c.id)) || raw[i] || {};
      let url = String(r.source_url || '').trim();
      if (url && (!/^https?:\/\//i.test(url) || isCompetitor(url) || /kingsresearch\.com/i.test(url))) url = '';
      return {
        id: c.id,
        verdict: normVerdict(r.verdict),
        correction: String(r.correction || ''),
        sourceUrl: url,
        sourceTitle: String(r.source_title || ''),
        note: String(r.note || ''),
        cited: !!url && res.citations.some((x) => sameUrl(x.url, url)),
        searched: res.searched
      };
    });
    const urls = results.map((r) => r.sourceUrl).filter(Boolean);
    const status = await checkUrls(urls, 4);
    const byUrl = new Map(status.map((s) => [s.url, s]));
    results.forEach((r) => {
      if (!r.sourceUrl) return;
      const s = byUrl.get(r.sourceUrl);
      r.reachable = !!(s && s.ok);
      r.httpStatus = s ? s.status : 0;
    });
    return { results, searched: res.searched, searchError: res.searchError || '' };
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
