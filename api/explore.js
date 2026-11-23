'use strict';

// Keywords -> Keyword ideas: Mangools data in plain words.
// - ideas: keywords related to a seed keyword, with monthly searches, the 12-month trend, difficulty and ad value.
// - pageKeywords: the keywords any page or domain ranks for (for example a competitor's report page).
// - serp: who ranks in Google's top 10 for a keyword, how strong those websites are, and where Kings Research ranks.
// Each call uses one Mangools keyword or SERP lookup (Mangools does not count the same request again within
// 24 hours). The browser paces the calls (3 per 30 s), like the rest of the Keywords tab.

const { handler, HttpError, competitors } = require('../lib/http');
const mg = require('../lib/mangools');
const T = require('../lib/topics');
const SEO = require('../lib/seo');

const QUESTION_RE = /^(how|what|which|who|why|when|where|is|are|does|do|can|will|should)\b/;
const REPORT_RE = /\b(market|markets|industry|size|share|growth|forecast|trends?|analysis|outlook|companies|players|manufacturers|statistics|revenue|cagr)\b/;

// Adds plain-language flags to each keyword: a question (good for FAQs), report-style wording, a single country,
// a brand or junk search, and the SEO check against our published reports.
async function enrich(seed, list, existingUrl) {
  const rows = (list || []).filter((k) => k && k.kw);
  let assessed = [];
  try { assessed = await SEO.assess(seed, rows.map((k) => k.kw), existingUrl || ''); } catch (e) { assessed = []; }
  return rows.map((k, i) => {
    const n = T.normalize(k.kw);
    const a = assessed[i];
    return {
      kw: k.kw,
      sv: k.sv,
      kd: k.kd,
      cpc: k.cpc,
      trend: k.trend || '',
      change: k.change === undefined ? null : k.change,
      spark: Array.isArray(k.spark) ? k.spark : [],
      position: k.position === undefined ? null : k.position,
      question: QUESTION_RE.test(n),
      report: REPORT_RE.test(n),
      country: T.regionType(k.kw) === 'country',
      junk: !T.usable(k.kw),
      seo: a ? SEO.seoCheckText(a) : ''
    };
  });
}

function bySv(a, b) { return (b.sv || 0) - (a.sv || 0); }

module.exports = handler({
  async ideas(b) {
    const seed = String(b.seed || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seed) throw new HttpError(400, 'Type a keyword to explore.');
    const list = await mg.related(seed, b.location_id);
    const sorted = list.slice().sort(bySv).slice(0, 400);
    return { seed, total: list.length, keywords: await enrich(seed, sorted, '') };
  },

  async pageKeywords(b) {
    const url = String(b.url || '').trim();
    if (!url) throw new HttpError(400, 'Paste a page address or a domain.');
    if (!/^https?:\/\/\S+$/i.test(url) && !/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url)) throw new HttpError(400, 'That does not look like a web address. Paste a full page address or a domain such as marketsandmarkets.com.');
    const list = await mg.competitorKeywords(url, b.location_id);
    const sorted = list.slice().sort(bySv).slice(0, 400);
    return { url, total: list.length, keywords: await enrich('', sorted, '') };
  },

  async serp(b) {
    const kw = String(b.kw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!kw) throw new HttpError(400, 'Type a keyword.');
    const r = await mg.serp(kw, b.location_id, competitors());
    const top = r.organic.slice(0, 10);
    const kr = r.organic.find((x) => x.kr) || null;
    const das = top.map((x) => x.da).filter((x) => x !== null && x !== undefined);
    return {
      kw: r.kw,
      kd: r.kd,
      results: r.results,
      organic: r.organic,
      krPosition: kr ? kr.position : null,
      krUrl: kr ? kr.url : '',
      competitorsInTop10: top.filter((x) => x.competitor).length,
      avgDa: das.length ? Math.round(das.reduce((s, x) => s + x, 0) / das.length) : null
    };
  }
});
