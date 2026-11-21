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

async function mg(path, params) {
  const key = process.env.MANGOOLS_API_KEY;
  if (!key) throw new HttpError(500, 'MANGOOLS_API_KEY is not set in Vercel.');
  const qs = new URLSearchParams();
  Object.keys(params).forEach((k) => { if (params[k] !== undefined && params[k] !== null) qs.set(k, String(params[k])); });
  let r;
  try {
    r = await fetchWithTimeout(BASE + path + '?' + qs.toString(), { headers: { 'x-access-token': key, Accept: 'application/json' } }, 50000);
  } catch (e) {
    throw new HttpError(504, e.name === 'AbortError' ? 'Mangools took too long to respond.' : 'Mangools request failed: ' + e.message);
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
  const cpc = num(k.cpc);
  return {
    kw: String(k.kw || '').toLowerCase().trim(),
    sv: num(k.sv),
    kd: num(k.seo),
    cpc: cpc === null ? null : Math.round(cpc * 100) / 100,
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

module.exports = { related, competitorKeywords, serp };
