'use strict';

// SEO check for keywords saved in the Keywords sheet (fills the "SEO Check" and "Suggested Placement" columns):
// - Link instead: the keyword is the main topic of another Kings Research report (cannibalization),
// - Duplicate: same words as another keyword in a different order,
// - Low value: country-specific variant or "market research" phrasing,
// - OK: fine to target.

const { titleCase } = require('./http');
const T = require('./topics');
const sitemap = require('./sitemap');

function normUrl(u) {
  return String(u || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/(preview\/)?(report|snapshot|toc)\//, '/')
    .replace(/\/+$/, '');
}

// The RD section a keyword usually belongs to.
function sectionOf(kw) {
  const n = T.normalize(kw);
  if (/^(how|what|which|who|why|when|where|is|are|does|do|can|will)\b/.test(n) || /\?\s*$/.test(String(kw || ''))) return 'FAQs';
  if (T.regionType(kw)) return 'Regional Analysis';
  if (/\b(companies|company|players|player|vendors|manufacturers|suppliers|leaders|competitors|competitive|competition)\b/.test(n)) return 'Competitive Landscape';
  if (/\b(cagr|forecast|forecasts|outlook|projection|projections|growth rate)\b/.test(n)) return 'Key Market Highlights';
  if (/\b(share|largest|dominant)\b/.test(n)) return 'Key Market Highlights';
  if (/\b(drivers?|trends?|growth|opportunity|opportunities|challenges?|restraints?|demand|dynamics)\b/.test(n)) return 'Market Dynamics';
  if (/\b(size|value|valuation|revenue|worth|industry|report|analysis|research|statistics|overview)\b/.test(n)) return 'Overview';
  return 'Segmental Analysis';
}

async function assess(primary, keywords, existingUrl) {
  let idx = null;
  try { idx = T.krIndex(await sitemap.fetchSitemap('report')); } catch (e) { idx = null; }
  const pKey = T.keyFor(primary);
  const own = normUrl(existingUrl);
  const seen = new Map();
  if (primary) seen.set(T.dupKey(primary), primary);
  return (keywords || []).map((kw) => {
    const out = { keyword: kw, status: 'OK', note: '', url: '' };
    const dk = T.dupKey(kw);
    if (dk && seen.has(dk)) {
      out.status = 'Duplicate';
      out.note = 'same words as "' + seen.get(dk) + '"';
      return out;
    }
    if (dk) seen.set(dk, kw);
    const key = T.keyFor(kw);
    if (idx && key && key !== pKey) {
      const hit = idx.exact.get(key);
      if (hit && normUrl(hit.url) !== own) {
        out.status = 'Link instead';
        out.url = hit.url;
        out.note = 'main topic of our ' + titleCase(hit.kw) + ' report';
        return out;
      }
    }
    const rt = T.regionType(kw);
    if (rt === 'country') {
      out.status = 'Low value';
      out.note = 'country-specific search for a global report';
      return out;
    }
    if (/\bmarket research\b|\bresearch (on|in|of)\b|\bindustry research\b/.test(T.normalize(kw))) {
      out.status = 'Low value';
      out.note = 'market-research phrasing';
      return out;
    }
    if (rt === 'region') out.note = 'regional search';
    return out;
  });
}

function seoCheckText(a) {
  if (!a) return '';
  if (a.status === 'OK') return a.note ? 'OK - ' + a.note : 'OK';
  return a.status + ': ' + a.note + (a.url ? ' ' + a.url : '');
}

module.exports = { sectionOf, assess, seoCheckText };
