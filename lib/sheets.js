'use strict';

// Google Sheets access through a service account (JWT signed with Node's crypto, no extra packages).
// Every tab the tool needs is created automatically, with its header row. New columns are only ever
// added at the end of a tab, so existing sheets upgrade in place without moving data.
//
// Sign-in accounts ("Users" tab) are kept away from the team:
// - With USERS_SHEET_ID set, they live in a separate spreadsheet that only the owner and the service account
//   can open. This is the real lock: nobody else can see it at all.
// - Without it, the Users tab stays in KR-Process but is hidden and edit-locked to the owner and the service
//   account. Other editors of KR-Process can no longer change it, but they could still unhide and read it.

const crypto = require('crypto');
const { HttpError } = require('./http');

const CHECK_HEADERS = ['Checked At', 'URL', 'Report Name', 'Checked By', 'Status', 'Total Issues',
  'Data Consistency', 'Facts', 'FAQs', 'Image', 'Spelling & Grammar', 'Meta & SEO', 'Links', 'Snapshot', 'TOC'];

const TABS = {
  OPPORTUNITIES: { name: 'Opportunities', headers: ['Scanned At', 'Scanned By', 'Location', 'Report Title', 'Action', 'Priority',
    'KR Status', 'KR URL', 'Primary Keyword', 'Primary Volume', 'Total Volume', 'KD', 'Competitors Ranking', 'Best Position', 'Score',
    'AI Reason', 'Secondary Keywords', 'In Pipeline'] },
  // "Must Use" = Yes marks the secondary keywords every report page must contain (checked at RD, Publish and Live).
  KEYWORDS: { name: 'Keywords', headers: ['ID', 'Group ID', 'Created At', 'Created By', 'Report Name', 'Seed Keyword', 'Location',
    'Keyword', 'Type', 'Search Volume', 'KD', 'CPC', 'PPC', 'Competitor Pages', 'Source', 'AI Reason', 'Suggested Placement',
    'Status', 'Analyst', 'Analyst Verdict', 'Analyst Reason', 'Verified At', 'Manager', 'Manager Note', 'Decision At',
    'Action', 'Existing URL', 'SEO Check', 'Must Use'] },
  RESEARCH: { name: 'Research List', headers: ['Group ID', 'Report Name', 'Primary Keyword', 'Secondary Keywords',
    'Primary Search Volume', 'Primary KD', 'Analyst', 'Approved By', 'Approval Date', 'Live Status', 'Live URL', 'Report ID',
    'Live Date', 'Detected On', 'Last Live Check', 'Live Check Summary', 'Action', 'Existing URL', 'Must-use Keywords'] },
  RD: { name: 'RD', headers: ['Checked At', 'Writer', 'Report Name', 'Primary Keyword', 'Word Count', 'Keywords Found',
    'Keywords Missing', 'Data Consistency', 'Language & Style', 'Structure', 'Fact Check', 'External Link Suggestions', 'Issue Count'] },
  CONTENT: { name: 'Content', headers: ['Date', 'Writer', 'Report Name', 'Notes'] },
  DM: { name: 'DM', headers: ['Optimized At', 'User', 'Keyword', 'Image URL', 'Image Alt', 'Meta Title', 'Meta Description',
    'Interlinks', 'H2 Count', 'H3 Count', 'Word Count'] },
  SITEMAP: { name: 'Sitemap', headers: ['URL', 'Report ID', 'Slug', 'Name', 'Lastmod', 'First Seen', 'Last Seen', 'In Sitemap'] },
  LIVE: { name: 'Live Check', headers: CHECK_HEADERS },
  PUBLISH: { name: 'Publish Check', headers: CHECK_HEADERS },
  // One row per fact that has been checked. A sentence found here is not checked (or paid for) again.
  FACTS: { name: 'Fact Cache', headers: ['Key', 'Sentence', 'Claim', 'Anchor', 'Date', 'Verdict', 'Correction', 'Source URL',
    'Source Title', 'Note', 'Engine', 'Confidence', 'Checked At', 'Report'] },
  // Sign-in accounts. Passwords are stored only as salted hashes. Delete a row to reset that person to the starting password.
  USERS: { name: 'Users', book: 'users', headers: ['Email', 'Salt', 'Password Hash', 'Must Change', 'Created At', 'Updated At', 'Last Login'] },
  // A log of every time someone marked an RD issue as "not an error" (or as an error again). Rows are only added,
  // never changed, so it shows who decided what and when; the latest row for an issue is the current decision.
  DECISIONS: { name: 'Issue Decisions', headers: ['At', 'By', 'Report', 'Decision', 'Section', 'Severity', 'Problem', 'Quote', 'Key'] },
  // The API credit counter: one row per server request that used a paid service (written by lib/http.js).
  USAGE: { name: 'API Usage', headers: ['At', 'User', 'Endpoint', 'Action', 'OpenAI Calls', 'OpenAI Input Tokens', 'OpenAI Output Tokens',
    'OpenAI Web Searches', 'OpenAI Cost USD', 'Jev Calls', 'Jev Cost USD', 'Tavily Searches', 'Serper Searches', 'Mangools Lookups', 'Total Cost USD'] }
};

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const enc = encodeURIComponent;

function sheetId() { return process.env.GOOGLE_SHEET_ID || '1NDDgdv4DGNpO8aYzq9VTtyD10O0rfn2Foa0lNobUzjM'; }
function usersSheetId() { return String(process.env.USERS_SHEET_ID || '').trim(); }
// The spreadsheet a tab lives in.
function bookOf(t) { return t.book === 'users' && usersSheetId() ? usersSheetId() : sheetId(); }
// The only person, besides the tool itself, who may edit the sign-in accounts.
function usersOwner() { return String(process.env.USERS_OWNER || 'hsingh@kingsresearch.com').trim().toLowerCase(); }
function tabNames() { return Object.values(TABS).filter((t) => bookOf(t) === sheetId()).map((t) => t.name); }

function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let tokenCache = { token: '', exp: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!email || !key) throw new HttpError(500, 'Google Sheets is not configured: set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel.');
  key = key.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  // A key pasted with literal "\n" sequences gets real line breaks back.
  key = key.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  let signature;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(header + '.' + claim);
    signature = signer.sign(key).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  } catch (e) {
    throw new HttpError(500, 'GOOGLE_PRIVATE_KEY could not be read. Paste the full private_key value from the service-account JSON, including the BEGIN/END lines.');
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header + '.' + claim + '.' + signature }).toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new HttpError(502, 'Google sign-in failed: ' + (j.error_description || j.error || ('HTTP ' + r.status)) + '. Check the service-account email and private key.');
  }
  tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// book = the spreadsheet id the request is for.
async function gapi(book, path, opts) {
  const o = opts || {};
  const token = await getToken();
  const r = await fetch(API + '/' + book + path, {
    method: o.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || text || ('HTTP ' + r.status);
    if (r.status === 403 || r.status === 404) {
      const which = book === sheetId() ? 'the sheet' : 'the private accounts sheet (USERS_SHEET_ID)';
      throw new HttpError(502, 'Google Sheets: ' + msg + ' - share ' + which + ' with ' + (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'the service account') + ' as Editor and enable the Google Sheets API.');
    }
    throw new HttpError(502, 'Google Sheets: ' + msg);
  }
  return j;
}

// Creates missing tabs and header rows in one spreadsheet. Tabs marked book: 'users' that still live in the main
// sheet are hidden and edit-locked to the owner and the service account.
async function ensureBook(book, tabs) {
  const meta = await gapi(book, '?fields=sheets(properties,protectedRanges)');
  const existing = new Map();
  const state = new Map();
  (meta.sheets || []).forEach((s) => {
    existing.set(s.properties.title, s.properties.sheetId);
    state.set(s.properties.title, { hidden: !!s.properties.hidden, locked: (s.protectedRanges || []).length > 0 });
  });
  const missing = tabs.filter((t) => !existing.has(t.name));
  const created = [];
  if (missing.length) {
    const reply = await gapi(book, ':batchUpdate', {
      method: 'POST',
      body: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, t.headers.length + 2) } } } })) }
    });
    (reply.replies || []).forEach((rp) => {
      if (rp.addSheet) {
        existing.set(rp.addSheet.properties.title, rp.addSheet.properties.sheetId);
        state.set(rp.addSheet.properties.title, { hidden: false, locked: false });
        created.push(rp.addSheet.properties.title);
      }
    });
  }
  const got = await gapi(book, '/values:batchGet?' + tabs.map((t) => 'ranges=' + enc("'" + t.name + "'!1:1")).join('&'));
  const writes = [];
  const formats = [];
  const warnings = [];
  (got.valueRanges || []).forEach((vr, i) => {
    const t = tabs[i];
    const row = (vr.values && vr.values[0]) || [];
    const isPrefix = row.every((v, k) => v === t.headers[k]);
    if (isPrefix && row.length === t.headers.length) return;
    const empty = !row.some((v) => String(v).trim());
    if (empty || isPrefix) {
      writes.push({ range: "'" + t.name + "'!A1:" + colLetter(t.headers.length) + '1', values: [t.headers] });
      const sid = existing.get(t.name);
      if (sid !== undefined) {
        formats.push({
          repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: t.headers.length },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.93, blue: 0.98 } } },
            fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor'
          }
        });
      }
    } else {
      warnings.push('Header row of "' + t.name + '" differs from the expected layout; new rows follow the tool\'s column order.');
    }
  });
  if (writes.length) await gapi(book, '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: writes } });
  if (formats.length) await gapi(book, ':batchUpdate', { method: 'POST', body: { requests: formats } });

  // Sign-in accounts that still sit in the main sheet: hide the tab and let only the owner and the tool edit it.
  if (book === sheetId()) {
    const locks = [];
    tabs.filter((t) => t.book === 'users').forEach((t) => {
      const sid = existing.get(t.name);
      const st = state.get(t.name) || {};
      if (sid === undefined) return;
      if (!st.locked) {
        locks.push({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId: sid },
              description: 'Sign-in accounts: only ' + usersOwner() + ' and the tool can edit this tab.',
              warningOnly: false,
              editors: { users: [usersOwner(), (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim()].filter(Boolean), domainUsersCanEdit: false }
            }
          }
        });
      }
      if (!st.hidden) locks.push({ updateSheetProperties: { properties: { sheetId: sid, hidden: true }, fields: 'hidden' } });
      warnings.push('Sign-in accounts are in the main sheet: the "' + t.name + '" tab is hidden and only ' + usersOwner() + ' and the tool can edit it, but anyone who can open the sheet could still unhide and read it. Set USERS_SHEET_ID to keep the accounts in a private sheet.');
    });
    if (locks.length) {
      try {
        await gapi(book, ':batchUpdate', { method: 'POST', body: { requests: locks } });
      } catch (e) {
        warnings.push('The sign-in accounts tab could not be locked automatically: ' + e.message);
      }
    }
  }
  return { created, warnings };
}

let ensuredAt = 0;

async function ensureTabs(force) {
  if (!force && ensuredAt && Date.now() - ensuredAt < 10 * 60 * 1000) return { created: [], warnings: [] };
  const books = new Map();
  Object.values(TABS).forEach((t) => {
    const id = bookOf(t);
    if (!books.has(id)) books.set(id, []);
    books.get(id).push(t);
  });
  let created = [];
  let warnings = [];
  for (const entry of books) {
    const r = await ensureBook(entry[0], entry[1]);
    created = created.concat(r.created);
    warnings = warnings.concat(r.warnings);
  }
  ensuredAt = Date.now();
  return { created, warnings, usersPrivate: !!usersSheetId() };
}

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return s.length > 49000 ? s.slice(0, 49000) + ' ...[truncated]' : s;
}

function toRow(t, obj) { return t.headers.map((h) => cell(obj[h])); }

async function readTab(key) {
  await ensureTabs();
  const t = TABS[key];
  const j = await gapi(bookOf(t), '/values/' + enc("'" + t.name + "'!A1:" + colLetter(t.headers.length)));
  const values = j.values || [];
  return values.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    t.headers.forEach((h, k) => { o[h] = r[k] !== undefined ? r[k] : ''; });
    return o;
  }).filter((o) => t.headers.some((h) => String(o[h]).trim() !== ''));
}

async function appendRows(key, objs) {
  if (!objs || !objs.length) return;
  await ensureTabs();
  const t = TABS[key];
  await gapi(bookOf(t), '/values/' + enc("'" + t.name + "'!A1") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
    method: 'POST',
    body: { values: objs.map((o) => toRow(t, o)) }
  });
}

// updates: [{ row: <sheet row number>, data: { 'Header': value } }]
async function updateCells(key, updates) {
  await ensureTabs();
  const t = TABS[key];
  const data = [];
  (updates || []).forEach((u) => {
    Object.keys(u.data || {}).forEach((h) => {
      const idx = t.headers.indexOf(h);
      if (idx < 0 || !u.row) return;
      data.push({ range: "'" + t.name + "'!" + colLetter(idx + 1) + u.row, values: [[cell(u.data[h])]] });
    });
  });
  if (!data.length) return;
  for (let i = 0; i < data.length; i += 500) {
    await gapi(bookOf(t), '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: data.slice(i, i + 500) } });
  }
}

// Replaces every data row (keeps the header).
async function rewriteTab(key, objs) {
  await ensureTabs();
  const t = TABS[key];
  await gapi(bookOf(t), '/values/' + enc("'" + t.name + "'!A2:" + colLetter(t.headers.length)) + ':clear', { method: 'POST', body: {} });
  const rows = (objs || []).map((o) => toRow(t, o));
  for (let i = 0; i < rows.length; i += 4000) {
    await gapi(bookOf(t), '/values/' + enc("'" + t.name + "'!A1") + ':append?valueInputOption=RAW&insertDataOption=OVERWRITE', {
      method: 'POST',
      body: { values: rows.slice(i, i + 4000) }
    });
  }
}

module.exports = { TABS, sheetId, tabNames, ensureTabs, readTab, appendRows, updateCells, rewriteTab };
