'use strict';

// Web search for the fact-check. Providers are tried in this order, using whichever keys are set in Vercel:
//   1. Tavily (TAVILY_API_KEY): 1,000 free searches every month (tavily.com).
//   2. Serper (SERPER_API_KEY): optional backup (2,500 free searches once, then paid packs).
// If a provider fails (free credits used up, key rejected, timeout), the next one is tried. When none works,
// search() throws and the fact-check falls back to checking the sentence's own source link (lib/factcheck.js).

const { HttpError, fetchWithTimeout } = require('./http');

// Press releases of market-research sellers ("... Market Size to Hit USD 31 Billion by 2032", "... Market Report
// 2025-2034") are published on news wires, so their web address looks like a news site. They repeat facts from
// other reports and must never be used as a source, so they are recognised by their title and dropped.
const REPORT_PR_RE = /\bmarket\b.{0,60}\b(?:size|share|report|forecast|outlook|analysis|cagr|worth|valued at|to (?:reach|hit|grow|surpass|exceed|cross|be worth))\b|\bresearch report\b|\bmarket (?:insights|research)\b|(?:USD|US\$|\$) ?[\d.,]+ ?(?:trillion|billion|million|bn|mn)\b.{0,40}\bby 20\d{2}\b/i;

async function postJson(label, url, headers, body) {
  let r;
  try {
    r = await fetchWithTimeout(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body)
    }, 15000);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, e.name === 'AbortError' ? label + ' took too long.' : label + ' failed: ' + e.message);
  }
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  if (!r.ok) {
    let msg = (j.detail && (j.detail.error || j.detail)) || j.message || j.error || text.slice(0, 200) || ('HTTP ' + r.status);
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    throw new HttpError(502, label + ' (HTTP ' + r.status + '): ' + msg);
  }
  return j;
}

function collector() {
  const out = [];
  const seen = new Set();
  return {
    out,
    add(title, url, snippet, date) {
      const u = String(url || '').trim();
      if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
      if (REPORT_PR_RE.test(String(title || ''))) return;
      seen.add(u);
      out.push({ title: String(title || ''), url: u, snippet: String(snippet || ''), date: String(date || '') });
    }
  };
}

async function tavily(q, num) {
  const j = await postJson('Tavily search', 'https://api.tavily.com/search', { Authorization: 'Bearer ' + process.env.TAVILY_API_KEY }, {
    query: q,
    search_depth: 'basic',
    max_results: Math.min(num, 10),
    include_answer: false
  });
  const c = collector();
  (Array.isArray(j.results) ? j.results : []).forEach((x) => { if (x) c.add(x.title, x.url, x.content, x.published_date); });
  return c.out;
}

async function serper(q, num) {
  const j = await postJson('Serper search', 'https://google.serper.dev/search', { 'X-API-KEY': process.env.SERPER_API_KEY }, { q, num: Math.min(num, 10) });
  const c = collector();
  const ab = j.answerBox;
  if (ab && ab.link) c.add(ab.title, ab.link, ab.snippet || ab.answer, ab.date);
  (Array.isArray(j.organic) ? j.organic : []).forEach((o) => { if (o) c.add(o.title, o.link, o.snippet, o.date); });
  return c.out;
}

function providers() {
  const list = [];
  if (process.env.TAVILY_API_KEY) list.push(tavily);
  if (process.env.SERPER_API_KEY) list.push(serper);
  return list;
}

function configured() { return providers().length > 0; }

// Returns [{ title, url, snippet, date }]. Throws when no provider is set or every provider failed.
async function search(query, num) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!q) return [];
  const list = providers();
  if (!list.length) throw new HttpError(500, 'no search key is set (TAVILY_API_KEY)');
  let last = null;
  for (const run of list) {
    try {
      return await run(q, num || 10);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

module.exports = { configured, search };
