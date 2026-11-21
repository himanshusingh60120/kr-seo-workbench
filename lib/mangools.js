'use strict';

// Mangools API (KWFinder + SERPChecker). Docs: https://apidocs.mangools.com
// Burst limit: ~3 requests / 30 s per resource pool. The browser paces calls; 429s are passed back with retryAfter.

const { HttpError, fetchWithTimeout, hostOf } = require('./http');

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

async function mg(path, params, body) {
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
  return j;
}

function normKw(k) {
  return {
    kw: String(k.kw || '').toLowerCase().trim(),
    sv: num(k.sv),
    kd: num(k.seo),
    cpc: money(k.cpc),
    ppc: num(k.ppc)
  };
}

function langId() { return Number(process.env.MANGOOLS_LANGUAGE_ID || 0) || 0; }

async function related(kw, locationId) {
  const j = await mg('/kwfinder/related-keywords', { kw, location_id: Number(locationId) || 0, language_id: langId() });
  return (j.keywords || []).map(normKw).filter((k) => k.kw);
}

async function competitorKeywords(url, locationId) {
  const j = await mg('/kwfinder/competitor-keywords', { url, location_id: Number(locationId) || 0 });
  return (j.keywords || []).map(normKw).filter((k) => k.kw);
}

// Search volume, KD and CPC for a list of keywords (one lookup per request, up to 200 keywords).
async function keywordImports(keywords, locationId) {
  const list = Array.from(new Set((keywords || []).map((k) => String(k || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 200);
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

module.exports = { related, competitorKeywords, keywordImports, gap, serp };
