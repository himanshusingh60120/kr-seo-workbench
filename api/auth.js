'use strict';

// Sign-in. Everyone signs in with their work email. The first time, the password is the starting password
// (FIRST_PASSWORD, default 1234) and they must set their own before the tool opens. Accounts live in the
// "Users" sheet tab; passwords are stored only as salted hashes, never as text.
// To reset someone's password: delete their row in the "Users" tab; their next sign-in uses the starting password.

const crypto = require('crypto');
const { handler, HttpError, nowIST, signToken, verifyToken } = require('../lib/http');
const sheets = require('../lib/sheets');

const SESSION_HOURS = 12;

function emailDomain() { return String(process.env.LOGIN_EMAIL_DOMAIN || 'kingsresearch.com').trim().toLowerCase(); }
function firstPassword() { return String(process.env.FIRST_PASSWORD || '1234'); }
function managerEmail() { return String(process.env.MANAGER_EMAIL || 'hummer@kingsresearch.com').trim().toLowerCase(); }

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) throw new HttpError(400, 'Enter your work email address.');
  if (!e.endsWith('@' + emailDomain())) throw new HttpError(403, 'Use your @' + emailDomain() + ' email address.');
  return e;
}

function hashOf(password, salt) { return crypto.scryptSync(String(password), String(salt), 32).toString('hex'); }

function sameHash(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function findUser(email) {
  const rows = await sheets.readTab('USERS');
  return rows.find((r) => String(r['Email']).trim().toLowerCase() === email) || null;
}

function sessionFor(email, mustChange) {
  return { token: signToken(email, SESSION_HOURS, mustChange), email, mustChange, manager: email === managerEmail(), hours: SESSION_HOURS };
}

module.exports = handler({
  async login(b) {
    const email = cleanEmail(b.email);
    const password = String(b.password || '');
    if (!password) throw new HttpError(400, 'Enter your password.');
    const now = nowIST();
    const row = await findUser(email);
    if (!row) {
      // First sign-in for this email: only the starting password opens it, and it must be changed straight away.
      if (password !== firstPassword()) { await wait(600); throw new HttpError(403, 'Wrong email or password.'); }
      const salt = crypto.randomBytes(16).toString('hex');
      await sheets.appendRows('USERS', [{
        'Email': email, 'Salt': salt, 'Password Hash': hashOf(password, salt), 'Must Change': 'Yes',
        'Created At': now, 'Updated At': now, 'Last Login': now
      }]);
      return sessionFor(email, true);
    }
    if (!sameHash(hashOf(password, row['Salt']), row['Password Hash'])) { await wait(600); throw new HttpError(403, 'Wrong email or password.'); }
    await sheets.updateCells('USERS', [{ row: row._row, data: { 'Last Login': now } }]);
    return sessionFor(email, String(row['Must Change']).trim().toLowerCase() === 'yes');
  },

  // Needs a session (a limited first-time session is enough) and the current password.
  async changePassword(b) {
    const email = verifyToken(b._token, true);
    if (!email) throw new HttpError(419, 'Please sign in again.');
    const oldPassword = String(b.oldPassword || '');
    const newPassword = String(b.newPassword || '');
    if (newPassword.length < 6) throw new HttpError(400, 'The new password needs at least 6 characters.');
    if (newPassword === firstPassword() || newPassword === oldPassword) throw new HttpError(400, 'Choose a password that is different from the current one.');
    const row = await findUser(email);
    if (!row || !sameHash(hashOf(oldPassword, row['Salt']), row['Password Hash'])) { await wait(600); throw new HttpError(403, 'The current password is not correct.'); }
    const salt = crypto.randomBytes(16).toString('hex');
    await sheets.updateCells('USERS', [{ row: row._row, data: { 'Salt': salt, 'Password Hash': hashOf(newPassword, salt), 'Must Change': 'No', 'Updated At': nowIST() } }]);
    return sessionFor(email, false);
  }
}, { open: true });
