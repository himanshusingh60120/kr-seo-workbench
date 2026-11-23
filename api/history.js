'use strict';

// Read-only views for the team:
// - me: who is signed in and what they may do (run checks, see the credit counter).
// - list / get: "Check results". Every RD, Publish and Live check saved in the sheet, readable by everyone signed
//   in, so the whole team can see what the check team (CHECKERS) found. Only the check team can run checks
//   (enforced in lib/http.js).
// - credits: "API credits". What the tool has used from each paid service (from the "API Usage" tab), the Mangools
//   lookups left (live from Mangools, a free call) and the Tavily free searches used this month.
//   Only CREDIT_VIEWERS can open it.

const { handler, HttpError, checkers, isChecker, creditViewers, isCreditViewer, nowIST, dayOf } = require('../lib/http');
const sheets = require('../lib/sheets');
const mg = require('../lib/mangools');

const PAGE_COLUMNS = [
  ['Data Consistency', 'Data consistency'], ['Facts', 'Facts'], ['FAQs', 'FAQs'], ['Image', 'Image'],
  ['Spelling & Grammar', 'Spelling and grammar'], ['Meta & SEO', 'Meta, SEO and keywords'], ['Links', 'Links'],
  ['Snapshot', 'Report Snapshot'], ['TOC', 'Table of Contents']
];

const KINDS = {
  rd: {
    tab: 'RD', label: 'RD check', by: 'Writer',
    columns: [['Structure', 'Keyword requirements and structure'], ['Data Consistency', 'Data consistency'], ['Language & Style', 'Language and style'],
      ['Fact Check', 'Facts'], ['External Link Suggestions', 'External link suggestions'], ['Keywords Found', 'Keywords used'], ['Keywords Missing', 'Keywords not used']]
  },
  publish: { tab: 'PUBLISH', label: 'Publish check', by: 'Checked By', columns: PAGE_COLUMNS },
  live: { tab: 'LIVE', label: 'Live check', by: 'Checked By', columns: PAGE_COLUMNS }
};

function summary(kind, r) {
  const k = KINDS[kind];
  const by = String(r[k.by] || '');
  let status;
  let total;
  if (kind === 'rd') {
    total = Number(r['Issue Count']) || 0;
    status = total ? 'Issues' : 'OK';
  } else {
    total = Number(r['Total Issues']) || 0;
    status = String(r['Status'] || '');
  }
  return {
    kind, label: k.label, row: r._row, at: String(r['Checked At'] || ''), report: String(r['Report Name'] || ''),
    url: String(r['URL'] || ''), by, checker: isChecker(by), status, total
  };
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function blank() {
  return { cost: 0, openaiCost: 0, openaiCalls: 0, openaiTokens: 0, openaiSearches: 0, jev: 0, jevCost: 0, tavily: 0, serper: 0, mangools: 0, requests: 0 };
}

function add(t, r) {
  t.cost += num(r['Total Cost USD']);
  t.openaiCost += num(r['OpenAI Cost USD']);
  t.openaiCalls += num(r['OpenAI Calls']);
  t.openaiTokens += num(r['OpenAI Input Tokens']) + num(r['OpenAI Output Tokens']);
  t.openaiSearches += num(r['OpenAI Web Searches']);
  t.jev += num(r['Jev Calls']);
  t.jevCost += num(r['Jev Cost USD']);
  t.tavily += num(r['Tavily Searches']);
  t.serper += num(r['Serper Searches']);
  t.mangools += num(r['Mangools Lookups']);
  t.requests += 1;
}

function round(t) {
  ['cost', 'openaiCost', 'jevCost'].forEach((k) => { t[k] = Math.round(t[k] * 10000) / 10000; });
  return t;
}

// What each feature is called on screen.
const FEATURE_NAMES = {
  'rd.review': 'RD check: AI review', 'rd.claims': 'Fact check: finding facts', 'rd.verify': 'Fact check: verifying facts',
  'pagecheck.check': 'Publish / Live check', 'pagecheck.extract': 'Publish / Live check: reading the page',
  'keywords.gap': 'Keywords: competitor gap', 'keywords.rank': 'Keywords: priority and reasons', 'keywords.mustHave': 'Keywords: must-use keywords',
  'keywords.serp': 'Keywords: Google top 10', 'keywords.pageTerms': 'Keywords: top-10 page keywords', 'keywords.volumes': 'Keywords: search volumes',
  'keywords.inhouse': 'Keywords: in-house check', 'explore.ideas': 'Keyword ideas: related keywords', 'explore.pageKeywords': 'Keyword ideas: page keywords',
  'explore.serp': 'Keyword ideas: who ranks', 'dm.headings': 'DM: headings', 'dm.interlink': 'DM: internal links', 'dm.meta': 'DM: meta options'
};

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

module.exports = handler({
  async me(b, req) {
    return { email: req.user, checker: isChecker(req.user), creditViewer: isCreditViewer(req.user), checkers: checkers() };
  },

  // The latest saved checks (newest first). kind: '' (all) | 'rd' | 'publish' | 'live'; q filters by report, URL or person.
  async list(b) {
    const want = KINDS[b.kind] ? [b.kind] : Object.keys(KINDS);
    const lists = await Promise.all(want.map((k) => sheets.readTab(KINDS[k].tab).then((rows) => rows.map((r) => summary(k, r)))));
    let all = [].concat.apply([], lists);
    const q = String(b.q || '').trim().toLowerCase();
    if (q) all = all.filter((x) => (x.report + ' ' + x.url + ' ' + x.by).toLowerCase().indexOf(q) >= 0);
    all.sort((a, c) => (a.at < c.at ? 1 : a.at > c.at ? -1 : 0));
    return { results: all.slice(0, 300), total: all.length, checkers: checkers() };
  },

  // Every finding of one saved check.
  async get(b) {
    const kind = KINDS[b.kind] ? b.kind : '';
    if (!kind) throw new HttpError(400, 'Unknown check type.');
    const row = Number(b.row);
    const rows = await sheets.readTab(KINDS[kind].tab);
    const r = rows.find((x) => x._row === row);
    if (!r || (b.at && String(r['Checked At']) !== String(b.at))) throw new HttpError(404, 'This result has moved in the sheet. Refresh the list.');
    const s = summary(kind, r);
    s.sections = KINDS[kind].columns.map((c) => ({ title: c[1], text: String(r[c[0]] || '') }));
    if (kind === 'rd') s.details = { primary: String(r['Primary Keyword'] || ''), words: String(r['Word Count'] || '') };
    return s;
  },

  // The API credit counter.
  async credits(b, req) {
    if (!isCreditViewer(req.user)) throw new HttpError(403, 'The API credit counter is shown only to ' + creditViewers().join(', ') + '.');
    const rows = await sheets.readTab('USAGE');
    const now = nowIST();
    const month = now.slice(0, 7);
    const day = now.slice(0, 10);
    const since = dayOf(Date.now() - 29 * 86400000);
    const totals = { month: blank(), today: blank(), all: blank() };
    const people = {};
    const features = {};
    const days = {};
    let first = '';
    rows.forEach((r) => {
      const at = String(r['At'] || '');
      if (!at) return;
      if (!first || at < first) first = at;
      add(totals.all, r);
      const d = at.slice(0, 10);
      if (at.slice(0, 7) === month) {
        add(totals.month, r);
        const who = String(r['User'] || '(unknown)');
        add(people[who] || (people[who] = blank()), r);
        const key = String(r['Endpoint'] || '') + '.' + String(r['Action'] || '');
        add(features[key] || (features[key] = blank()), r);
      }
      if (d === day) add(totals.today, r);
      if (d >= since) add(days[d] || (days[d] = blank()), r);
    });
    let mangools = null;
    let mangoolsError = '';
    try { mangools = await mg.limits(); } catch (e) { mangoolsError = e.message; }
    const list = (o, nameOf) => Object.keys(o).map((k) => Object.assign({ name: nameOf ? nameOf(k) : k, key: k }, round(o[k]))).sort((a, c) => c.cost - a.cost || c.requests - a.requests);
    Object.keys(totals).forEach((k) => round(totals[k]));
    return {
      month,
      today: day,
      first,
      totals,
      people: list(people),
      features: list(features, (k) => FEATURE_NAMES[k] || k),
      days: Object.keys(days).sort().map((d) => Object.assign({ day: d }, round(days[d]))),
      mangools,
      mangoolsError,
      limits: { tavily: numEnv('TAVILY_MONTHLY_LIMIT', 1000), openaiBudget: numEnv('OPENAI_MONTHLY_BUDGET', 0) },
      viewers: creditViewers()
    };
  }
});
