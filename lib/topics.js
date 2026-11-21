'use strict';

// Keyword-opportunity logic: turns competitor gap keywords into report topics, matches each topic against
// Kings Research's published reports (reports sitemap), cleans the secondary keywords (no country variants,
// no word-order duplicates), and builds the AI prompt that prioritises topics.

const { today, competitors, titleCase } = require('./http');

const REGIONS = ['united states of america', 'united states', 'north america', 'latin america', 'south america', 'central america',
  'middle east and africa', 'middle east', 'asia pacific', 'south east asia', 'southeast asia', 'europe', 'european', 'asia', 'africa',
  'apac', 'emea', 'gcc', 'mena', 'usa', 'u s', 'us', 'uk', 'united kingdom', 'india', 'china', 'japan', 'germany', 'france', 'canada',
  'australia', 'brazil', 'mexico', 'south korea', 'korea', 'saudi arabia', 'uae', 'indonesia', 'vietnam', 'thailand', 'malaysia',
  'singapore', 'philippines', 'italy', 'spain', 'russia', 'nigeria', 'egypt', 'argentina', 'chile', 'netherlands', 'poland', 'sweden'];

const MAJOR_REGIONS = ['north america', 'latin america', 'south america', 'middle east and africa', 'middle east', 'asia pacific',
  'europe', 'apac', 'emea'];

const MODS = new Set(['market', 'markets', 'industry', 'industries', 'sector', 'segment', 'segments', 'global', 'worldwide', 'size',
  'sizes', 'share', 'shares', 'growth', 'rate', 'forecast', 'forecasts', 'trend', 'trends', 'analysis', 'report', 'reports', 'research',
  'outlook', 'value', 'valuation', 'revenue', 'revenues', 'statistics', 'stats', 'cagr', 'overview', 'insights', 'insight', 'demand',
  'opportunity', 'opportunities', 'companies', 'company', 'players', 'player', 'key', 'leading', 'top', 'major', 'vendors',
  'manufacturers', 'suppliers', 'scope', 'future', 'projections', 'projection', 'estimate', 'estimates', 'data', 'news', 'pdf', 'free',
  'sample', 'summary', 'study', 'landscape', 'dynamics']);

const EDGE = new Set(['the', 'of', 'in', 'for', 'by', 'to', 'and', 'a', 'an', 'with', 'on', 'vs', 'at', 'from', 'what', 'is', 'how', 'big']);

const JUNK = new Set(['stock', 'black', 'real estate', 'housing', 'job', 'labor', 'labour', 'flea', 'farmers', 'money', 'bond', 'bonds',
  'crypto', 'forex', 'capital', 'financial', 'digital', 'online', 'super', 'bull', 'bear', 'night', 'fish', 'target', 'emerging', 'world',
  'total addressable', 'addressable', 'serviceable addressable', 'serviceable obtainable', 'free', 'open', 'secondary', 'primary']);

const SKIP_RE = /\b(near me|jobs?|salary|salaries|careers?|stock price|share price|ticker|login|sign in|hours|meaning|definition|wiki|reddit|youtube|courses?|tutorial|crash|cap rate|for sale|price today)\b/;

const BRAND_RE = /(marketsandmarkets|markets and markets|precedence|persistence|future market insights|market research future|mrfr|grand view|grandview|fortune business|allied market|mordor|imarc|statista|technavio|research and markets|researchandmarkets|kings research|straits research|data bridge|verified market|coherent market|transparency market|polaris market|spherical insights|zion market|expert market|cognitive market|business research company|globenewswire|prnewswire|einpresswire|openpr)/;

const RESEARCH_RE = /\bmarket research\b|\bresearch (on|in|of)\b|\bindustry research\b/;

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordsRe(list, flags) {
  return new RegExp('\\b(' + list.slice().sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')\\b', flags || '');
}
const REGION_RE = wordsRe(REGIONS, 'g');
const REGION_TEST = wordsRe(REGIONS);
const MAJOR_TEST = wordsRe(MAJOR_REGIONS);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(kw) { return String(kw || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function normalize(kw) { return clean(kw).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

function stemWord(w) {
  if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(sses|ches|shes|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /s$/.test(w) && !/(ss|us|is|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

function keyOf(topic) { return String(topic || '').split(' ').filter(Boolean).map(stemWord).join(' '); }

// "US genetic engineering market size 2025" -> "genetic engineering". Returns '' when it is not a report keyword.
function topicOf(kw, requireMarket) {
  let s = normalize(kw);
  if (!s) return '';
  if (requireMarket !== false && !/\b(market|markets|industry|industries)\b/.test(s)) return '';
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b\d+\b/g, ' ').replace(REGION_RE, ' ');
  const words = s.split(' ').filter((w) => w && !MODS.has(w));
  while (words.length && EDGE.has(words[0])) words.shift();
  while (words.length && EDGE.has(words[words.length - 1])) words.pop();
  const topic = words.join(' ');
  if (topic.length < 3 || JUNK.has(topic)) return '';
  return topic;
}

function keyFor(name) { return keyOf(topicOf(name, false) || normalize(name)); }

// '' | 'region' (North America, Europe ...) | 'country' (France, US ...)
function regionType(kw) {
  const n = normalize(kw);
  if (!n || !REGION_TEST.test(n)) return '';
  const stripped = n.replace(wordsRe(MAJOR_REGIONS, 'g'), ' ');
  return REGION_TEST.test(stripped) ? 'country' : (MAJOR_TEST.test(n) ? 'region' : 'country');
}

const DUP_STOP = new Set(['the', 'of', 'in', 'for', 'a', 'an', 'to', 'by', 'on', 'is', 'are', 'and']);
// Same words in any order -> same key ("france automotive industry" = "automotive industry france").
function dupKey(kw) {
  return normalize(kw).split(' ').filter((w) => w && !DUP_STOP.has(w)).map(stemWord).sort().join(' ');
}

function usable(kw) {
  const n = normalize(kw);
  return !!n && !SKIP_RE.test(n) && !BRAND_RE.test(n);
}

// Keeps secondaries that suit a global report page: drops country variants, word-order duplicates and
// repeated "market research" phrasings.
function cleanSecondaries(list, primaryKw, limit) {
  const seen = new Set([dupKey(primaryKw)]);
  let research = 0;
  const kept = [];
  const dropped = { country: 0, duplicate: 0, research: 0 };
  (list || []).forEach((k) => {
    const dk = dupKey(k.kw);
    if (!dk || seen.has(dk)) { dropped.duplicate++; return; }
    if (regionType(k.kw) === 'country') { dropped.country++; return; }
    if (RESEARCH_RE.test(normalize(k.kw))) {
      if (research >= 1) { dropped.research++; return; }
      research++;
    }
    seen.add(dk);
    kept.push(k);
  });
  return { kept: kept.slice(0, limit || 15), dropped };
}

// rows: [[keyword, volume, kd, cpc, position, competitorDomain], ...]
function groupGap(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    if (!Array.isArray(r)) return;
    const kw = clean(r[0]);
    if (!kw || !usable(kw)) return;
    const topic = topicOf(kw);
    if (!topic) return;
    const key = keyOf(topic);
    let g = groups.get(key);
    if (!g) { g = { key, topics: {}, kws: new Map(), domains: new Map() }; groups.set(key, g); }
    const sv = num(r[1]);
    g.topics[topic] = (g.topics[topic] || 0) + (sv || 0) + 1;
    let k = g.kws.get(kw);
    if (!k) { k = { kw, sv, kd: num(r[2]), cpc: num(r[3]) }; g.kws.set(kw, k); }
    else {
      if ((sv || 0) > (k.sv || 0)) k.sv = sv;
      if (k.kd === null) k.kd = num(r[2]);
      if (k.cpc === null) k.cpc = num(r[3]);
    }
    const d = String(r[5] || '').toLowerCase();
    const p = num(r[4]);
    if (d && p !== null) {
      const best = g.domains.get(d);
      if (best === undefined || p < best) g.domains.set(d, p);
    } else if (d && !g.domains.has(d)) {
      g.domains.set(d, 999);
    }
  });

  return Array.from(groups.values()).map((g) => {
    const topic = Object.keys(g.topics).sort((a, b) => g.topics[b] - g.topics[a])[0];
    const kws = Array.from(g.kws.values()).sort((a, b) => (b.sv || 0) - (a.sv || 0));
    // The primary is always the report's head term "<topic> market" (Kings Research titles end in "Market").
    const canonical = topic + ' market';
    const exact = kws.find((k) => normalize(k.kw) === canonical);
    const primary = exact || { kw: canonical, sv: null, kd: null, cpc: null };
    const cleaned = cleanSecondaries(kws.filter((k) => k !== primary), primary.kw, 15);
    const total = kws.reduce((s, k) => s + (k.sv || 0), 0);
    const pos = Array.from(g.domains.entries()).sort((a, b) => a[1] - b[1]);
    const positions = {};
    pos.forEach((e) => { positions[e[0]] = e[1] === 999 ? null : e[1]; });
    const real = pos.map((e) => e[1]).filter((x) => x !== 999);
    const best = real.length ? Math.min.apply(null, real) : null;
    const kds = kws.map((k) => k.kd).filter((x) => x !== null).sort((a, b) => a - b);
    const kd = primary.kd !== null ? primary.kd : (kds.length ? kds[0] : null);
    const comps = Object.keys(positions);
    const score = Math.round((Math.log10(total + 10) * 12 + comps.length * 6 +
      (best !== null && best <= 3 ? 8 : best !== null && best <= 10 ? 4 : 0) - (kd === null ? 0 : kd * 0.08)) * 10) / 10;
    return {
      key: g.key,
      topic,
      title: titleCase(topic) + ' Market',
      primary: { kw: primary.kw, sv: primary.sv, kd: primary.kd, cpc: primary.cpc },
      secondary: cleaned.kept.map((k) => ({ kw: k.kw, sv: k.sv, kd: k.kd, cpc: k.cpc })),
      dropped: cleaned.dropped,
      keywordCount: kws.length,
      totalVolume: total,
      kd,
      competitors: comps,
      positions,
      bestPosition: best,
      score
    };
  }).sort((a, b) => b.score - a.score);
}

function krIndex(items) {
  const exact = new Map();
  const list = [];
  (items || []).forEach((it) => {
    const t = topicOf(it.kw, false) || normalize(it.kw);
    const key = keyOf(t);
    if (!key) return;
    if (!exact.has(key)) exact.set(key, it);
    list.push({ key, tokens: new Set(key.split(' ')), item: it });
  });
  return { exact, list };
}

function matchTopic(key, idx) {
  const none = { status: 'New report', url: '', name: '', lastmod: '' };
  if (!key) return none;
  const hit = idx.exact.get(key);
  if (hit) return { status: 'Revamp', url: hit.url, name: titleCase(hit.kw), lastmod: hit.lastmod || '' };
  const set = new Set(key.split(' '));
  let best = null;
  let bestScore = 0;
  idx.list.forEach((e) => {
    let inter = 0;
    set.forEach((t) => { if (e.tokens.has(t)) inter++; });
    if (!inter) return;
    const small = Math.min(set.size, e.tokens.size);
    const union = set.size + e.tokens.size - inter;
    const jac = inter / union;
    const subset = inter === small && small >= 2 && Math.abs(set.size - e.tokens.size) <= 1;
    const s = subset ? Math.max(jac, 0.76) : jac;
    if (s > bestScore) { bestScore = s; best = e; }
  });
  if (best && bestScore >= 0.75) return { status: 'Similar report exists', url: best.item.url, name: titleCase(best.item.kw), lastmod: best.item.lastmod || '' };
  return none;
}

function heuristicPriority(t) {
  const c = (t.competitors || []).length;
  if (t.totalVolume >= 3000 || (t.totalVolume >= 800 && c >= 2)) return 'High';
  if (t.totalVolume >= 150 || c >= 2) return 'Medium';
  return 'Low';
}

function q(v) { return v === null || v === undefined || v === '' ? '?' : v; }

function rankSystem() {
  return 'You are the head of research planning at Kings Research (kingsresearch.com), a market research publisher whose report pages compete in Google with ' +
    competitors().join(', ') + '. You decide which report topics to publish or revamp to win search traffic. Today is ' + today() + '. Respond in JSON only.';
}

function rankTask(items) {
  return 'These are keyword opportunities: report topics where competitor report pages rank in Google and Kings Research does not.\n' +
    'Status "New report" = we have no report on it. "Revamp" = we already publish that report but do not rank for these keywords. ' +
    '"Similar report exists" = we publish a closely related report (decide whether it is the same market).\n\n' +
    'For each topic return:\n' +
    '- "keep": false if it is not a sellable B2B market research report topic (generic word, stock or financial-market term, jobs, consumer how-to, competitor brand, too vague); otherwise true.\n' +
    '- "priority": "High", "Medium" or "Low", weighing search volume, how many competitors rank and how high, keyword difficulty, and the commercial value of the report.\n' +
    '- "title": the report title in Kings Research style, e.g. "Genetic Engineering Market".\n' +
    '- "action": "New report" or "Revamp". For "Similar report exists" say "Revamp" only if our report is the same market; otherwise "New report".\n' +
    '- "reason": one or two sentences on why taking this up wins traffic from the competitors.\n' +
    'Return {"items":[{"key":"","keep":true,"priority":"High","title":"","action":"","reason":""}]} with exactly one entry per input key, copying the key exactly.\n\n' +
    'TOPICS (key | status | our page | primary keyword | volume | total volume of all variants | KD | competitors ranking with best position):\n' +
    (items || []).map((t) => [t.key, t.status, t.url || '-', t.primary, q(t.sv), q(t.total), q(t.kd), t.comps || '-'].join(' | ')).join('\n');
}

module.exports = {
  topicOf, keyOf, keyFor, normalize, stemWord, usable, regionType, dupKey, cleanSecondaries,
  groupGap, krIndex, matchTopic, heuristicPriority, rankSystem, rankTask
};
