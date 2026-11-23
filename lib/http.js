'use strict';

// Shared helpers for every serverless function.
// - Sign-in: every endpoint except api/auth.js needs a valid session token (created at sign-in).
// - Who may run checks: RD, Publish Check and Live Check actions run only for the check team (CHECKERS).
//   Everyone else can read the saved results in the "Check results" tab (api/history.js).
// - API credit counter: every paid call made while serving a request (OpenAI, Jev, Tavily, Serper, Mangools)
//   is counted, and one row per request is added to the "API Usage" sheet tab. Only CREDIT_VIEWERS see it.

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KR-SEO-Workbench/1.0';

const DEFAULT_COMPETITORS = [
  'marketresearchfuture.com',
  'futuremarketinsights.com',
  'marketsandmarkets.com',
  'precedenceresearch.com',
  'persistencemarketresearch.com'
];

// The check team: the only people who can run RD, Publish and Live checks. CHECKERS in Vercel replaces this list.
const DEFAULT_CHECKERS = [
  'hummer@kingsresearch.com',
  'ssengupta@kingsresearch.com',
  'mmaniyar@kingsresearch.com',
  'hsingh@kingsresearch.com',
  'atale@kingsresearch.com',
  'sb@kingsresearch.com'
];

// The people who see the API credit counter. CREDIT_VIEWERS in Vercel replaces this list.
const DEFAULT_CREDIT_VIEWERS = ['sb@kingsresearch.com', 'hsingh@kingsresearch.com', 'atale@kingsresearch.com'];

// Actions that run a check, per endpoint (api/<endpoint>.js). Reading saved results stays open to everyone.
const CHECKER_ONLY = {
  rd: ['review', 'claims', 'verify', 'links', 'save', 'decide'],
  pagecheck: ['extract', 'check', 'save']
};

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}

// ---------- people ----------
function emailList(text) { return String(text || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); }

function checkers() {
  const list = emailList(process.env.CHECKERS);
  return list.length ? list : DEFAULT_CHECKERS.slice();
}

function isChecker(email) { return checkers().indexOf(String(email || '').trim().toLowerCase()) >= 0; }

function creditViewers() {
  const list = emailList(process.env.CREDIT_VIEWERS);
  return list.length ? list : DEFAULT_CREDIT_VIEWERS.slice();
}

function isCreditViewer(email) { return creditViewers().indexOf(String(email || '').trim().toLowerCase()) >= 0; }

// ---------- session tokens ----------
// A token is "<data>.<signature>": the data holds the email and the expiry time, and the signature proves the
// server made it. AUTH_SECRET signs the tokens; without it, a secret is derived from keys already set in Vercel
// (so changing GOOGLE_PRIVATE_KEY, MANAGER_PIN or OPENAI_API_KEY then signs everyone out once).
function authSecret() {
  const s = process.env.AUTH_SECRET || ((process.env.GOOGLE_PRIVATE_KEY || '') + '|' + (process.env.MANAGER_PIN || '') + '|' + (process.env.OPENAI_API_KEY || ''));
  if (s.length < 12) throw new HttpError(500, 'Sign-in is not configured: set AUTH_SECRET in Vercel.');
  return s;
}

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function sign(data) { return b64url(crypto.createHmac('sha256', authSecret()).update(data).digest()); }

// limited = true marks a session that may only change its password (first sign-in with the starting password).
function signToken(email, hours, limited) {
  const data = b64url(JSON.stringify({ e: String(email).toLowerCase(), x: Date.now() + (hours || 12) * 3600000, l: limited ? 1 : 0 }));
  return data + '.' + sign(data);
}

// Returns the signed-in email, or '' when the token is missing, altered, expired, or limited (unless allowed).
function verifyToken(token, allowLimited) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '';
  const expected = Buffer.from(sign(parts[0]));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return '';
  let p;
  try { p = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return ''; }
  if (!p || !p.e || !(Number(p.x) > Date.now())) return '';
  if (p.l && !allowLimited) return '';
  return String(p.e);
}

// ---------- API credit counter ----------
// Each request gets its own counter. lib/openai.js, lib/jev.js, lib/search.js and lib/mangools.js call track()
// after every successful paid call; the handler below writes the totals to the "API Usage" tab when the request ends.
const usageStore = new AsyncLocalStorage();

// counts: { openaiCalls, openaiIn, openaiOut, openaiSearches, openaiCost, jevCalls, jevCost, tavily, serper, mangools }
function track(counts) {
  const u = usageStore.getStore();
  if (!u) return;
  Object.keys(counts || {}).forEach((k) => {
    const n = Number(counts[k]);
    if (Number.isFinite(n) && n !== 0) u[k] = (u[k] || 0) + n;
  });
}

function money(n) { return Math.round((Number(n) || 0) * 1000000) / 1000000; }

// Best effort: a sheet error here must never fail the user's request.
async function logUsage(user, endpoint, action, u) {
  if (!u || !Object.keys(u).length) return;
  try {
    const sheets = require('./sheets');
    await sheets.appendRows('USAGE', [{
      'At': nowIST(),
      'User': user || '',
      'Endpoint': endpoint,
      'Action': action,
      'OpenAI Calls': u.openaiCalls || 0,
      'OpenAI Input Tokens': u.openaiIn || 0,
      'OpenAI Output Tokens': u.openaiOut || 0,
      'OpenAI Web Searches': u.openaiSearches || 0,
      'OpenAI Cost USD': money(u.openaiCost),
      'Jev Calls': u.jevCalls || 0,
      'Jev Cost USD': money(u.jevCost),
      'Tavily Searches': u.tavily || 0,
      'Serper Searches': u.serper || 0,
      'Mangools Lookups': u.mangools || 0,
      'Total Cost USD': money((u.openaiCost || 0) + (u.jevCost || 0))
    }]);
  } catch (e) {
    console.error('API usage could not be logged: ' + e.message);
  }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let b;
  try { b = req.body; } catch (e) { throw new HttpError(400, 'Request body is not valid JSON.'); }
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    if (!b.trim()) return {};
    try { return JSON.parse(b); } catch (e) { throw new HttpError(400, 'Request body is not valid JSON.'); }
  }
  if (req.readableEnded) return {};
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { throw new HttpError(400, 'Request body is not valid JSON.'); }
}

// "/api/rd" -> "rd"
function endpointOf(req) {
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  return (path.split('/').pop() || '').replace(/\.js$/, '').toLowerCase();
}

// Wraps a map of { actionName: async (body, req) => result } into a Vercel handler.
// Every action needs a signed-in user (req.user = their email) unless opts.open is true (the sign-in endpoint).
// Check actions (CHECKER_ONLY) also need the user to be in the check team.
// Status 419 tells the browser to show the sign-in screen.
function handler(actions, opts) {
  return async function (req, res) {
    const usage = {};
    const endpoint = endpointOf(req);
    let user = '';
    let action = '';
    let out;
    let failure = null;
    try {
      const teamKey = process.env.TEAM_ACCESS_KEY;
      if (teamKey && String(req.headers['x-team-key'] || '') !== teamKey) {
        throw new HttpError(401, 'Team access key required. Click "Setup" and enter the key.');
      }
      let query = req.query;
      if (!query) {
        try { query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams); } catch (e) { query = {}; }
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (!(opts && opts.open)) {
        user = verifyToken(body._token || req.headers['x-kr-token']);
        if (!user) throw new HttpError(419, 'Please sign in to continue.');
        req.user = user;
      }
      action = String(body.action || query.action || '');
      const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
      if (!fn) throw new HttpError(400, 'Unknown action "' + action + '".');
      const only = CHECKER_ONLY[endpoint];
      if (only && only.indexOf(action) >= 0 && !isChecker(user)) {
        throw new HttpError(403, 'Checks are run by the check team only. You can read their results in the "Check results" tab.');
      }
      out = await usageStore.run(usage, () => fn(body, req));
    } catch (err) {
      failure = err;
    }
    // Calls made before a failure were still paid for, so they are counted too.
    await logUsage(user, endpoint, action, usage);
    if (failure) {
      const status = Number.isInteger(failure.status) ? failure.status : 500;
      if (status >= 500) console.error(failure);
      send(res, status, { error: failure.message || String(failure), retryAfter: failure.retryAfter });
      return;
    }
    send(res, 200, out === undefined ? { ok: true } : out);
  };
}

function nowIST() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return g('year') + '-' + g('month') + '-' + g('day') + ' ' + g('hour') + ':' + g('minute') + ':' + g('second');
}

function today() { return nowIST().slice(0, 10); }

// "YYYY-MM-DD" of a moment (milliseconds) in the app's time zone.
function dayOf(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ms));
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return g('year') + '-' + g('month') + '-' + g('day');
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 20000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

function cap(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + ' ...[truncated]' : str;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'via']);
const ACRONYMS = new Set(['ai', 'iot', 'ev', 'evs', 'hvac', 'crispr', 'api', 'apis', 'b2b', 'b2c', 'ar', 'vr', 'xr', 'ml', 'nlp', 'llm', 'saas', 'paas', 'iaas', 'erp', 'crm', 'led', 'oled', 'lidar', 'rfid', 'gps', 'uav', 'uavs', 'pcb', 'ic', 'ics', '3g', '4g', '5g', '6g', '3d', '2d', 'ott', 'ehr', 'emr', 'bfsi', 'sme', 'smes', 'ppe', 'dna', 'rna', 'mrna', 'ivd', 'pos', 'adas', 'ngs', 'pcr']);

function titleCase(s) {
  return String(s || '').trim().split(/\s+/).map((w, i) => {
    if (!w) return w;
    const core = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ACRONYMS.has(core)) return w.toUpperCase();
    if (/[A-Z]/.test(w.slice(1))) return w;
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
}

function competitors() {
  const env = String(process.env.COMPETITORS || '').split(',')
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  return env.length ? env : DEFAULT_COMPETITORS;
}

function isCompetitor(urlOrHost) {
  const v = String(urlOrHost || '');
  const h = v.includes('/') ? hostOf(v) : v.toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  return competitors().some((c) => h === c || h.endsWith('.' + c));
}

function toList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
  return String(v || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
}

module.exports = {
  UA, HttpError, send, readBody, handler, nowIST, today, dayOf, fetchWithTimeout, pool, cap,
  slugify, titleCase, hostOf, competitors, isCompetitor, toList, signToken, verifyToken,
  emailList, checkers, isChecker, creditViewers, isCreditViewer, track
};
