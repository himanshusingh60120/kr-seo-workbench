'use strict';

// Shared helpers for every serverless function, including the sign-in check: every endpoint except
// api/auth.js needs a valid session token (created at sign-in) before it does anything.

const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KR-SEO-Workbench/1.0';

const DEFAULT_COMPETITORS = [
  'marketresearchfuture.com',
  'futuremarketinsights.com',
  'marketsandmarkets.com',
  'precedenceresearch.com',
  'persistencemarketresearch.com'
];

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) Object.assign(this, extra);
  }
}

// ---------- session tokens ----------
// A token is "<data>.<signature>": the data holds the email and the expiry time, and the signature proves the
// server made it. AUTH_SECRET signs the tokens; without it, a secret is derived from keys already set in Vercel.
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

// Wraps a map of { actionName: async (body, req) => result } into a Vercel handler.
// Every action needs a signed-in user (req.user = their email) unless opts.open is true (the sign-in endpoint).
// Status 419 tells the browser to show the sign-in screen.
function handler(actions, opts) {
  return async function (req, res) {
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
        const user = verifyToken(body._token || req.headers['x-kr-token']);
        if (!user) throw new HttpError(419, 'Please sign in to continue.');
        req.user = user;
      }
      const action = String(body.action || query.action || '');
      const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
      if (!fn) throw new HttpError(400, 'Unknown action "' + action + '".');
      const out = await fn(body, req);
      send(res, 200, out === undefined ? { ok: true } : out);
    } catch (err) {
      const status = Number.isInteger(err.status) ? err.status : 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: err.message || String(err), retryAfter: err.retryAfter });
    }
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
  UA, HttpError, send, readBody, handler, nowIST, today, fetchWithTimeout, pool, cap,
  slugify, titleCase, hostOf, competitors, isCompetitor, toList, signToken, verifyToken
};
