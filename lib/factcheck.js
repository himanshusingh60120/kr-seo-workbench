'use strict';

// Fact-check engine, built to keep the cost per report low.
//  1. Sentences worth checking are picked with plain rules, then Jev labels each one
//     (public fact / Kings Research's own estimate / general statement). Only public facts are checked.
//  2. Every checked sentence is stored in the "Fact Cache" sheet tab, so the same sentence is never paid for
//     twice: RD, Publish Check and Live Check all reuse the stored verdict.
//  3. New facts are verified by the "lite" engine: one web search (Tavily's free monthly credits), judged by Jev.
//     If the search is not available (no key, credits used up, service down), the sentence is checked against
//     the page it already links to instead, which needs no search service at all.
//  4. The "deep" engine (OpenAI web search) reads full pages and can suggest a correction. It costs 1 to 3 cents
//     a claim and only runs when FACT_ENGINE says so or someone clicks "Deep check".
// FACT_ENGINE = lite | deep | both. Without it: lite when a Jev key is set, otherwise deep.

const crypto = require('crypto');
const { UA, today, nowIST, cap, hostOf, isCompetitor, pool, fetchWithTimeout } = require('./http');
const ai = require('./openai');
const P = require('./prompts');
const jev = require('./jev');
const web = require('./search');
const sheets = require('./sheets');

// ---------- settings ----------
function engine() {
  const want = String(process.env.FACT_ENGINE || '').trim().toLowerCase();
  const liteReady = jev.configured();
  if (want === 'deep') return 'deep';
  if (want === 'both') return liteReady ? 'both' : 'deep';
  return liteReady ? 'lite' : 'deep';
}

function minConfidence() {
  const n = Number(process.env.FACT_MIN_CONFIDENCE);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.8;
}

function cacheDays() {
  const n = Number(process.env.FACT_CACHE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 180;
}

// ---------- sentences ----------
// The same sentence always gives the same key, whatever its spacing, quotes or dashes.
function sentenceKey(s) {
  const n = String(s || '').toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').replace(/^[-#*\s]+/, '').trim();
  return n ? crypto.createHash('sha1').update(n).digest('hex').slice(0, 20) : '';
}

const ABBR_RE = /(?:\b(?:U\.S|U\.K|U\.A\.E|E\.U|Inc|Ltd|Corp|Co|Dr|Mr|Mrs|Ms|St|No|vs|approx|est|Jr|Sr|Pvt|Plc|Bros)|\b[A-Z])\.$/;

function splitSentences(text) {
  const out = [];
  String(text || '').split(/\n+/).forEach((line) => {
    const l = line.replace(/\s+/g, ' ').trim();
    if (!l || /^#{1,6} /.test(l) || l.indexOf('[IMAGE') === 0) return;
    const parts = l.replace(/^- /, '').split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/);
    let cur = '';
    parts.forEach((p) => {
      cur = cur ? cur + ' ' + p : p;
      if (ABBR_RE.test(cur)) return; // "U.S." or "Inc." is not the end of the sentence
      out.push(cur.trim());
      cur = '';
    });
    if (cur) out.push(cur.trim());
  });
  return out;
}

const MONTH_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},\s+)?(?:19|20)\d{2}\b/;
const CUE_RE = /\b(?:announc\w+|launch\w+|acquir\w+|acquisition|merg\w+|partner\w+|collaborat\w+|agreement|approv\w+|clearance|authoriz\w+|introduc\w+|unveil\w+|invest\w+|funding|raised|grant\w*|award\w+|signed|regulation|directive|legislation|mandat\w+|enacted|according to|reported|published|released|opened|commission\w+|inaugurat\w+)\b/i;
const OWN_RE = /\bCAGR\b|\bmarket (?:size|share)\b|\bUSD [\d.,]+ (?:trillion|billion|million)\b[^.]{0,40}\b(?:in|by) (?:19|20)\d{2}\b|\b(?:held|accounted for|captured)\b[^.]{0,60}\bshare\b/i;

// Sentences that could hold a checkable outside fact: a month-and-year date or an event word.
// Sentences that only give the report's own market numbers are left out here (no AI needed for that).
function candidates(sentences, limit) {
  const seen = new Set();
  const dated = [];
  const other = [];
  (sentences || []).forEach((s, i) => {
    if (s.length < 50 || s.length > 900 || /\?$/.test(s)) return;
    const hasDate = MONTH_RE.test(s);
    if (!hasDate && !CUE_RE.test(s)) return;
    if (!hasDate && OWN_RE.test(s)) return;
    const key = sentenceKey(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    (hasDate ? dated : other).push({ sentence: s, key, pos: i });
  });
  return dated.concat(other).slice(0, limit || 40).sort((a, b) => a.pos - b.pos);
}

const KIND = {
  public_fact: 'A specific, checkable fact about the outside world: a dated event, product launch, acquisition, partnership, investment, approval, regulation or law, or a statistic attributed to a named organization',
  own_estimate: 'A market size, share, growth rate, forecast or ranking of segments or regions given as the report\'s own analysis, with no outside organization named as the source',
  general: 'A general description, trend, opinion or explanation with nothing specific to look up'
};

// Jev labels each candidate sentence; only public facts are kept.
async function triage(items) {
  const flags = await pool(items, 6, async (it) => {
    const ans = await jev.decide('Sentence from a market research report:\n' + cap(it.sentence, 900), {
      kind: { type: 'choice', instructions: 'What kind of statement is this sentence?', options: KIND }
    });
    return jev.optionProb(ans.kind, 'public_fact') >= 0.5;
  });
  return items.filter((it, i) => flags[i]);
}

// For new facts only: a one-line claim and the organization name that should carry the source link.
async function describe(items) {
  if (!items.length) return [];
  let rows = [];
  try {
    const out = await ai.chatJSON({
      system: P.claimsSystem(),
      user: 'For each numbered sentence below (taken from a market research report description) return:\n' +
        '- "n": the sentence number,\n' +
        '- "claim": the checkable fact in one short line, using the exact dates, numbers and names written in the sentence,\n' +
        '- "anchor": the organization or proper-noun phrase in that sentence that should carry the source hyperlink, copied exactly from the sentence,\n' +
        '- "date": the month and year mentioned, or "".\n' +
        'Return {"claims":[{"n":1,"claim":"","anchor":"","date":""}]}\n\nSENTENCES:\n' +
        items.map((it, i) => '[' + (i + 1) + '] ' + cap(it.sentence, 900)).join('\n')
    });
    rows = Array.isArray(out.claims) ? out.claims : [];
  } catch (e) {
    rows = [];
  }
  return items.map((it, i) => {
    const r = rows.find((x) => x && Number(x.n) === i + 1) || {};
    const anchor = String(r.anchor || '').trim();
    return {
      sentence: it.sentence,
      key: it.key,
      pos: it.pos,
      claim: String(r.claim || '').trim() || it.sentence,
      anchor: anchor && it.sentence.indexOf(anchor) >= 0 ? anchor : '',
      date: String(r.date || '')
    };
  });
}

// ---------- cache (the "Fact Cache" sheet tab) ----------
const REUSE = ['Supported', 'Partially supported', 'Contradicted', 'Unverifiable', 'Check manually'];

async function loadCache() {
  const rows = await sheets.readTab('FACTS');
  const cutoff = Date.now() - cacheDays() * 86400000;
  const map = new Map();
  rows.forEach((r) => {
    const k = String(r['Key'] || '').trim();
    if (!k || REUSE.indexOf(r['Verdict']) < 0) return;
    const t = Date.parse(String(r['Checked At'] || '').slice(0, 10));
    if (Number.isFinite(t) && t < cutoff) return;
    map.set(k, r); // a later row for the same sentence replaces the earlier one
  });
  return map;
}

function fromCache(r) {
  const c = Number(r['Confidence']);
  return {
    verdict: String(r['Verdict'] || ''),
    correction: String(r['Correction'] || ''),
    sourceUrl: String(r['Source URL'] || ''),
    sourceTitle: String(r['Source Title'] || ''),
    note: String(r['Note'] || ''),
    engine: String(r['Engine'] || ''),
    confidence: String(r['Confidence']).trim() === '' || !Number.isFinite(c) ? null : c,
    checkedAt: String(r['Checked At'] || '')
  };
}

async function saveCache(claims, results, report) {
  const now = nowIST();
  const rows = [];
  (results || []).forEach((r) => {
    if (!r || REUSE.indexOf(r.verdict) < 0) return;
    if (!r.searched) return; // nothing was actually looked up, so there is nothing worth remembering
    // A link check depends on the link, not only on the sentence: keep it only when the link confirmed the fact.
    if (r.engine === 'link' && r.verdict !== 'Supported') return;
    const c = (claims || []).find((x) => String(x.id) === String(r.id));
    if (!c) return;
    const key = String(c.key || '') || sentenceKey(c.sentence);
    if (!key) return;
    rows.push({
      'Key': key,
      'Sentence': cap(c.sentence, 1500),
      'Claim': cap(c.claim, 600),
      'Anchor': String(c.anchor || ''),
      'Date': String(c.date || ''),
      'Verdict': r.verdict,
      'Correction': String(r.correction || ''),
      'Source URL': String(r.sourceUrl || ''),
      'Source Title': String(r.sourceTitle || ''),
      'Note': cap(r.note, 800),
      'Engine': String(r.engine || ''),
      'Confidence': typeof r.confidence === 'number' ? r.confidence : '',
      'Checked At': now,
      'Report': String(report || '')
    });
  });
  if (rows.length) await sheets.appendRows('FACTS', rows);
  return rows.length;
}

// Picks the facts in the content. Sentences already in the cache come back with their stored verdict;
// only new sentences go through Jev, and at most `max` new facts are returned for checking.
async function extractClaims(content, max, cache) {
  const cands = candidates(splitSentences(content), 40);
  const known = cands.filter((x) => cache.has(x.key));
  const fresh = cands.filter((x) => !cache.has(x.key));
  const facts = fresh.length ? (await triage(fresh)).slice(0, max) : [];
  const described = await describe(facts);
  const list = known.map((x) => {
    const r = cache.get(x.key);
    return {
      sentence: x.sentence, key: x.key, pos: x.pos,
      claim: String(r['Claim'] || '') || x.sentence,
      anchor: String(r['Anchor'] || ''),
      date: String(r['Date'] || ''),
      cached: fromCache(r)
    };
  }).concat(described.map((d) => Object.assign({ cached: null }, d)));
  return { claims: list.sort((a, b) => a.pos - b.pos), candidates: cands.length };
}

// ---------- shared verdict helpers ----------
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

function nums(t) { return String(t || '').toLowerCase().match(/\d+(?:[.,]\d+)*/g) || []; }
function words(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9.%]+/g, ' ').split(' ').filter((w) => w.length > 2); }

// A "correction" that repeats what the sentence already says is not a correction:
// - "August 2, 2026, not August 2, 2025" when the sentence says August 2, 2026;
// - a correction that simply restates the claim.
function falseAlarm(claim, sentence, correction) {
  const c = String(correction || '').toLowerCase().trim();
  const s = String(sentence || '').toLowerCase();
  if (!c) return false;
  const m = c.match(/\bnot\s+(?:on\s+|in\s+|of\s+)?([^.;]+)/);
  if (m) {
    const neg = nums(m[1]);
    const pos = nums(c.slice(0, m.index));
    if (neg.length && pos.length && pos.every((n) => s.indexOf(n) >= 0) && !neg.every((n) => s.indexOf(n) >= 0)) return true;
    return false;
  }
  if (/\binstead\b|\brather than\b/.test(c)) return false;
  if (!nums(c).every((n) => s.indexOf(n) >= 0)) return false;
  const a = new Set(words(c));
  const b = new Set(words(String(claim || '') + ' ' + s));
  if (!a.size) return false;
  let inter = 0;
  a.forEach((w) => { if (b.has(w)) inter++; });
  return inter / a.size >= 0.85;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'their', 'report', 'published', 'introduced', 'announced',
  'market', 'global', 'new', 'was', 'were', 'has', 'have', 'which', 'about', 'across', 'within', 'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'company', 'inc', 'ltd', 'corporation', 'group']);

// The source must be about this claim: it has to mention the organization (anchor) or, failing that, a key term of the claim.
function relevantSource(c, url, title) {
  const hay = (String(title || '') + ' ' + String(url || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (!hay.trim()) return false;
  const anchor = String(c.anchor || '');
  let keys = words(anchor).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
  (anchor + ' ' + String(c.sentence || '')).replace(/\(([A-Z0-9]{2,10})\)/g, (all, acr) => { keys.push(acr.toLowerCase()); return all; });
  nums(anchor).forEach((n) => { if (n.length >= 3 && !/^(19|20)\d{2}$/.test(n)) keys.push(n); });
  if (!keys.length) keys = words(c.claim).filter((w) => w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w));
  return keys.some((k) => hay.indexOf(k) >= 0);
}

// ---------- deep engine: OpenAI web search (reads pages, can suggest a correction) ----------
async function verifyDeep(c) {
  const res = await ai.webSearchJSON({ instructions: P.verifySystem(), input: P.verifyTask([c]) });
  const raw = Array.isArray(res.data.results) ? res.data.results : [];
  const r = raw.find((x) => Number(x && x.id) === Number(c.id)) || raw[0] || {};
  let url = String(r.source_url || '').trim();
  let note = String(r.note || '');
  if (url && (!/^https?:\/\//i.test(url) || isCompetitor(url) || /kingsresearch\.com/i.test(url))) url = '';
  let verdict = normVerdict(r.verdict);
  let correction = String(r.correction || '');
  if ((verdict === 'Contradicted' || verdict === 'Partially supported') && falseAlarm(c.claim, c.sentence, correction)) {
    verdict = 'Supported';
    note = (note ? note + ' ' : '') + '(The suggested correction matched the text, so it was treated as supported.)';
    correction = '';
  }
  const title = String(r.source_title || '');
  if (url && !relevantSource(c, url, title)) {
    url = '';
    note = (note ? note + ' ' : '') + '(The source found was about something else, so it was not used.)';
  }
  if (verdict === 'Unverifiable') url = '';
  return {
    id: c.id,
    engine: 'deep',
    verdict,
    correction,
    sourceUrl: url,
    sourceTitle: url ? title : '',
    note,
    confidence: null,
    cited: !!url && res.citations.some((x) => sameUrl(x.url, url)),
    searched: res.searched,
    searchError: res.searchError || ''
  };
}

// ---------- lite engine: one web search, judged by Jev ----------
const SELLER_RE = /(marketsandmarkets|grandviewresearch|mordorintelligence|fortunebusinessinsights|alliedmarketresearch|imarcgroup|precedenceresearch|persistencemarketresearch|futuremarketinsights|marketresearchfuture|researchandmarkets|technavio|straitsresearch|databridgemarketresearch|verifiedmarketresearch|coherentmarketinsights|transparencymarketresearch|polarismarketresearch|sphericalinsights|zionmarketresearch|kingsresearch|gminsights|skyquestt|emergenresearch|thebusinessresearchcompany|marketdataforecast|factmr|reportlinker|openpr|marketresearch|marketreport|marketinsights|marketanalysis)/;

function usableSource(url) {
  const h = hostOf(url);
  return !!h && !isCompetitor(url) && !SELLER_RE.test(h);
}

const RELATION = {
  confirms: 'This result reports the same event or fact as the claim, with the same names, dates and numbers',
  conflicts: 'This result is about the same event or fact but gives a different date, number or name than the claim',
  unrelated: 'This result is about something else, or does not mention this fact'
};

function round2(n) { return Math.round(n * 100) / 100; }

function blank(c, engineName) {
  return { id: c.id, engine: engineName, verdict: 'Unverifiable', correction: '', sourceUrl: '', sourceTitle: '', note: '', confidence: null, cited: false, searched: true, searchError: '' };
}

async function verifyLite(c) {
  const query = String(c.claim || c.sentence || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  let results = null;
  let why = '';
  try {
    results = await web.search(query, 8);
  } catch (e) {
    why = e.message; // no key, free credits used up, or the service is down
  }
  if (results === null) return verifyByLink(c, why);

  const base = blank(c, 'lite');
  const found = results.filter((x) => usableSource(x.url)).slice(0, 6);
  if (!found.length) return Object.assign(base, { note: 'The web search returned no usable sources for this claim.' });

  const state = 'CLAIM: ' + cap(c.claim, 600) + '\nSENTENCE IN THE REPORT: ' + cap(c.sentence, 900) + '\nTODAY: ' + today() + '\n\nSEARCH RESULTS:\n' +
    found.map((x, i) => 'R' + (i + 1) + ' | ' + cap(x.title, 160) + ' | ' + hostOf(x.url) + (x.date ? ' | ' + x.date : '') + '\n' + cap(x.snippet, 700)).join('\n\n');
  const questions = {};
  found.forEach((x, i) => {
    questions['r' + (i + 1)] = { type: 'choice', instructions: 'How does search result R' + (i + 1) + ' relate to the claim?', options: RELATION };
  });
  const ans = await jev.decide(state, questions);

  let yes = null;
  let no = null;
  found.forEach((x, i) => {
    const a = ans['r' + (i + 1)];
    if (!a || !relevantSource(c, x.url, x.title + ' ' + x.snippet)) return;
    const pc = jev.optionProb(a, 'confirms');
    const px = jev.optionProb(a, 'conflicts');
    if (!yes || pc > yes.p) yes = { p: pc, r: x };
    if (!no || px > no.p) no = { p: px, r: x };
  });
  const T = minConfidence();
  const supported = !!yes && yes.p >= T;
  const conflicted = !!no && no.p >= T;
  const src = (hit) => ({ sourceUrl: hit.r.url, sourceTitle: hit.r.title, confidence: round2(hit.p) });

  if (supported && !conflicted) return Object.assign(base, src(yes), { verdict: 'Supported', note: 'Confirmed by a web search result (title and summary check).' });
  if (conflicted && !supported) return Object.assign(base, src(no), { verdict: 'Contradicted', note: 'This source reports it differently: "' + cap(no.r.snippet, 260) + '"' });
  if (supported && conflicted) return Object.assign(base, src(yes), { verdict: 'Check manually', note: 'Sources disagree with each other. Another source: ' + no.r.url });
  const best = [yes, no].filter(Boolean).sort((a, b) => b.p - a.p)[0];
  if (best && best.p >= 0.4) return Object.assign(base, src(best), { verdict: 'Check manually', note: 'A possible source was found, but the match is not certain.' });
  return Object.assign(base, { note: 'No web search result reports this fact.' });
}

// ---------- link check: used when no web search is available ----------
// Opens the page the sentence already links to and asks Jev whether that page backs the claim.
// It needs no search service, so it keeps working when the free search credits are used up.
function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (all, n) => { try { return String.fromCodePoint(Number(n)); } catch (e) { return ' '; } });
}

async function readPage(url) {
  let r;
  try {
    r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }, 12000);
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'it took too long to load' : e.message };
  }
  if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
  const type = String(r.headers.get('content-type') || '').toLowerCase();
  if (type && type.indexOf('html') < 0 && type.indexOf('text/plain') < 0) return { ok: false, error: 'it is not a web page (' + type.split(';')[0] + ')' };
  let html = await r.text();
  if (html.length > 1500000) html = html.slice(0, 1500000);
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = decodeHtml(html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (text.length < 200) return { ok: false, error: 'it has no readable text' };
  return { ok: true, title: decodeHtml(tm ? tm[1] : '').replace(/\s+/g, ' ').trim(), text };
}

// The parts of the page that mention the claim's names, numbers and key words.
function pickPassages(text, c) {
  const terms = Array.from(new Set(words(String(c.claim || '') + ' ' + String(c.anchor || ''))
    .map((w) => w.replace(/[.%]+$/, ''))
    .filter((w) => (w.length >= 4 && !STOP.has(w)) || /\d/.test(w))));
  const chunks = [];
  for (let i = 0; i < text.length; i += 700) {
    const chunk = text.slice(i, i + 800);
    const lower = chunk.toLowerCase();
    let score = 0;
    terms.forEach((t) => { if (lower.indexOf(t) >= 0) score++; });
    chunks.push({ i, chunk, score });
  }
  const top = chunks.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.i - b.i);
  return top.length ? top.map((x) => x.chunk).join('\n[...]\n') : text.slice(0, 2500);
}

const PAGE_RELATION = {
  confirms: 'The page reports the same event or fact as the claim, with the same names, dates and numbers',
  conflicts: 'The page is about the same event or fact but gives a different date, number or name than the claim',
  unrelated: 'The page extracts do not mention this fact'
};

async function verifyByLink(c, why) {
  const base = Object.assign(blank(c, 'link'), { verdict: 'Check manually', searched: false });
  const reason = 'Web search is not available' + (why ? ' (' + why + ')' : '');
  const url = String(c.linkUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return Object.assign(base, { note: reason + ', and this sentence has no source link to check. Add a source link and run the check again, or click "Deep check".' });
  }
  if (!usableSource(url)) {
    return Object.assign(base, { sourceUrl: url, note: 'The link in this sentence points to a market-research seller, which is not accepted as a source. Link the original source instead.' });
  }
  const pg = await readPage(url);
  if (!pg.ok) {
    return Object.assign(base, { sourceUrl: url, note: reason + ', and the linked page could not be read: ' + pg.error + '. Open the link and confirm it.' });
  }
  const state = 'CLAIM: ' + cap(c.claim, 600) + '\nSENTENCE IN THE REPORT: ' + cap(c.sentence, 900) + '\n\nSOURCE PAGE: ' + cap(pg.title, 200) + ' | ' + hostOf(url) +
    '\nEXTRACTS FROM THE PAGE:\n' + pickPassages(pg.text, c);
  const ans = await jev.decide(state, { rel: { type: 'choice', instructions: 'How does the source page relate to the claim?', options: PAGE_RELATION } });
  const pc = jev.optionProb(ans.rel, 'confirms');
  const px = jev.optionProb(ans.rel, 'conflicts');
  const T = minConfidence();
  const src = { sourceUrl: url, sourceTitle: pg.title, searched: true };
  if (pc >= T) return Object.assign(base, src, { verdict: 'Supported', confidence: round2(pc), note: 'Confirmed by the page this sentence links to.' });
  if (px >= T) return Object.assign(base, src, { verdict: 'Contradicted', confidence: round2(px), note: 'The page this sentence links to reports it differently.' });
  return Object.assign(base, src, { confidence: round2(Math.max(pc, px)), note: 'The linked page does not clearly state this fact. Check that the link points to the right source.' });
}

async function verifyClaim(c, eng) {
  if (eng === 'deep') return verifyDeep(c);
  if (eng === 'both') {
    const pair = await Promise.all([
      verifyDeep(c),
      verifyLite(c).catch((e) => ({ verdict: 'Error', confidence: null, sourceUrl: '', note: e.message }))
    ]);
    return Object.assign(pair[0], { lite: { verdict: pair[1].verdict, confidence: pair[1].confidence, sourceUrl: pair[1].sourceUrl || '', note: pair[1].note || '' } });
  }
  return verifyLite(c);
}

module.exports = {
  engine, sentenceKey, splitSentences, candidates, extractClaims, loadCache, fromCache, saveCache,
  verifyClaim, verifyDeep, verifyLite, verifyByLink, relevantSource, falseAlarm, normVerdict
};
