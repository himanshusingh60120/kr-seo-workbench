'use strict';

// Mangools API (KWFinder + SERPChecker). Docs: https://apidocs.mangools.com
// Burst limit: 3 requests per 30 s per resource pool, so the browser paces calls about 11 s apart; a 429 is passed
// back with retryAfter. Paid endpoints use one lookup per successful call (the same request repeated within 24 hours
// is not counted by Mangools). /kwfinder/limits is free and returns the lookups left on the plan.
// Every paid call is counted for the API credit counter.

const { HttpError, fetchWithTimeout, hostOf, track } = require('./http');

const BASE = 'https://api.mangools.com/v3';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  const n = num(v);
  return n === null ? null : Math.round(n * 100) / 100;
}

// free = true for endpoints that use no lookups (they are not counted).
async function mg(path, params, body, free) {
  const key = process.env.MANGOOLS_API_KEY;
  if (!key) throw new HttpError(500, 'MANGOOLS_API_KEY is not set in Vercel.');
  const qs = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => { if (params[k] !== undefined && params[k] !== null) qs.set(k, String(params[k])); });
  const query = qs.toString();
  const headers = { 'x-access-token': key, Accept: 'application/json' };
  const opts = { method: body ? 'POST' : 'GET', headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetchWithTimeout(BASE + path + (query ? '?' + query : ''), opts, 52000);
  } catch (e) {
    throw new HttpError(504, e.name === 'AbortError' ? 'Mangools took too long to respond. Try again.' : 'Mangools request failed: ' + e.message);
  }
  if (r.status === 204) return {};
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  if (r.status === 429) {
    const ra = Number((j.error && j.error.retry_after) || r.headers.get('retry-after') || 30) || 30;
    throw new HttpError(429, 'Mangools rate limit, retry in ' + ra + 's', { retryAfter: ra });
  }
  if (r.status === 401) throw new HttpError(502, 'Mangools rejected the API key (check MANGOOLS_API_KEY).');
  if (!r.ok) {
    const extra = j.error && Array.isArray(j.error.errors) ? ' (' + j.error.errors.join('; ') + ')' : '';
    throw new HttpError(502, 'Mangools: ' + ((j.error && j.error.message) || ('HTTP ' + r.status)) + extra);
  }
  if (!free) track({ mangools: 1 });
  return j;
}

// Search interest from the monthly history Mangools returns (msv = [[year, month, searches], ...]):
// the last 3 months compared with the same 3 months a year earlier. Returns the label, the change in % and the
// last 12 months for a small chart.
function trendOf(msv) {
  const rows = (Array.isArray(msv) ? msv : [])
    .filter((r) => Array.isArray(r) && r.length >= 3 && Number.isFinite(Number(r[2])))
    .map((r) => ({ t: Number(r[0]) * 12 + Number(r[1]), v: Number(r[2]) }))
    .sort((a, b) => a.t - b.t);
  const spark = rows.slice(-12).map((r) => r.v);
  if (rows.length < 6) return { trend: '', change: null, spark };
  const last = rows[rows.length - 1].t;
  const avg = (list) => (list.length ? list.reduce((s, r) => s + r.v, 0) / list.length : 0);
  const recent = avg(rows.filter((r) => r.t > last - 3));
  const yearAgo = rows.filter((r) => r.t > last - 15 && r.t <= last - 12);
  const base = yearAgo.length ? avg(yearAgo) : avg(rows.slice(-12, -9));
  if (!base) return { trend: recent > 0 ? 'rising' : '', change: null, spark };
  const change = Math.round(((recent - base) / base) * 100);
  return { trend: change >= 20 ? 'rising' : change <= -20 ? 'falling' : 'stable', change, spark };
}

function normKw(k) {
  const t = trendOf(k.msv);
  return {
    kw: String(k.kw || '').toLowerCase().trim(),
    sv: num(k.sv),
    kd: num(k.seo),
    cpc: money(k.cpc),
    ppc: num(k.ppc),
    trend: t.trend,
    change: t.change,
    spark: t.spark,
    position: num(k.position)
  };
}

function langId() { return Number(process.env.MANGOOLS_LANGUAGE_ID || 0) || 0; }

// Keywords related to a seed keyword (KWFinder "related keywords"), each with volume, KD, CPC and trend.
async function related(kw, locationId) {
  const j = await mg('/kwfinder/related-keywords', { kw, location_id: Number(locationId) || 0, language_id: langId() });
  return (j.keywords || []).map(normKw).filter((k) => k.kw);
}

// The keywords a domain or URL ranks for.
async function competitorKeywords(url, locationId) {
  const j = await mg('/kwfinder/competitor-keywords', { url, location_id: Number(locationId) || 0 });
  return (j.keywords || []).map(normKw).filter((k) => k.kw);
}

// Search volume, KD, CPC and trend for a list of keywords (one lookup per request, up to 700 keywords).
async function keywordImports(keywords, locationId) {
  const list = Array.from(new Set((keywords || []).map((k) => String(k || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 700);
  if (!list.length) return [];
  const j = await mg('/kwfinder/keyword-imports', {}, { keywords: list, location_id: Number(locationId) || 0, language_id: langId() });
  return (j.keywords || []).map(normKw).filter((k) => k.kw);
}

// Keywords each competitor ranks for and `domain` does not. Keywords come back compact:
// [keyword, volume, kd, cpc, competitor position]
async function gap(domain, comps, locationId, page) {
  const body = { domain, competitors: (comps || []).slice(0, 5), location_id: Number(locationId) || 0 };
  if (Number(page) > 1) body.page = Number(page);
  const j = await mg('/kwfinder/gap-analysis', {}, body);
  return {
    page: num(j.page) || 1,
    pagination: !!j.isAllowedPagination,
    results: (j.results || []).map((r) => ({
      domain: String(r.domain || '').toLowerCase().replace(/^www\./, ''),
      total: num(r.totalCount),
      keywords: (r.keywords || []).filter((k) => k && k.kw).map((k) => [String(k.kw).toLowerCase().trim(), num(k.sv), num(k.seo), money(k.cpc), num(k.position)])
    }))
  };
}

async function serp(kw, locationId, competitorList) {
  const j = await mg('/serpchecker/serps', { kw, location_id: Number(locationId) || 0 });
  const comps = competitorList || [];
  const organic = (j.items || []).filter((it) => it && it.type === 'ORGANIC' && it.url).map((it, i) => {
    const domain = String(it.domain || hostOf(it.url) || '').toLowerCase().replace(/^www\./, '');
    const m = it.m || {};
    const moz = (m.moz && m.moz.v) || {};
    const maj = (m.majestic && m.majestic.v) || {};
    return {
      position: i + 1,
      url: it.url,
      domain,
      title: it.title || '',
      da: num(moz.pda),
      pa: num(moz.upa),
      cf: num(maj.CitationFlow),
      tf: num(maj.TrustFlow),
      competitor: comps.some((c) => domain === c || domain.endsWith('.' + c)),
      kr: /(^|\.)kingsresearch\.com$/.test(domain)
    };
  });
  return { kw: j.kw || kw, kd: num(j.rank), results: num(j.results), organic: organic.slice(0, 20) };
}

// The lookups left on the Mangools plan (free call). "lookups" = keyword lookups, "serps" = SERP lookups.
async function limits() {
  const j = await mg('/kwfinder/limits', {}, null, true);
  const pick = (o) => (o && typeof o === 'object' ? { limit: num(o.limit), remaining: num(o.remaining) } : null);
  const res = j.resources || {};
  return {
    lookups: pick(res['related-keywords']),
    serps: pick(res.serps),
    trends: pick(res.trends),
    plan: String(j.highestPlan || '')
  };
}

module.exports = { related, competitorKeywords, keywordImports, gap, serp, limits, trendOf };
