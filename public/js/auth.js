'use strict';
/* Sign-in. Loaded by main.js before the app starts. Shows the sign-in screen, makes a first-time user set their
   own password, adds "How it works", "Change password" and "Sign out" beside the name box, and sends the session
   with every request to the server. The session lasts until the browser tab is closed (12 hours at most). */
(function () {
  const KR = window.KR;
  const KEY = 'kr_session';
  let session = null;
  try {
    const s = JSON.parse(KR.session.get(KEY, '') || 'null');
    if (s && s.token && s.exp > Date.now()) session = s;
  } catch (e) { session = null; }

  function store(r) {
    session = { token: r.token, email: r.email, mustChange: !!r.mustChange, manager: !!r.manager, exp: Date.now() + (Number(r.hours) || 12) * 3600000 - 60000 };
    KR.session.set(KEY, JSON.stringify(session));
  }

  function clear() {
    session = null;
    KR.session.set(KEY, '');
  }

  // Every request carries the session. If the server says the session has ended (status 419), the sign-in
  // screen is shown on top of the page, so nothing typed or pasted is lost.
  const baseApi = KR.api;
  KR.api = async (endpoint, action, payload) => {
    try {
      return await baseApi(endpoint, action, Object.assign({}, payload || {}, session ? { _token: session.token } : {}));
    } catch (e) {
      if (e.status === 419) {
        clear();
        if (!document.getElementById('krAuth')) showLogin('Your session has ended. Sign in again, then repeat the last action.').then(() => KR.toast('Signed in. Repeat the last action.', 'ok'));
      }
      throw e;
    }
  };

  // ---------- screens ----------
  const BOX = 'background:#fff;border:1px solid #C3D4DE;padding:28px;width:100%;max-width:380px;color:#232323;box-sizing:border-box';
  const INPUT = 'display:block;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:10px 12px;border:1px solid #C3D4DE;font:inherit;color:#232323;background:#fff';
  const BTN = 'display:block;width:100%;padding:11px 16px;border:0;border-radius:999px;background:#2B71E2;color:#fff;font:inherit;font-weight:500;cursor:pointer';
  const LINK = 'display:block;width:100%;margin-top:10px;padding:9px 16px;border:1px solid #C3D4DE;border-radius:999px;background:#fff;color:#36476F;font:inherit;cursor:pointer';
  const LABEL = 'display:block;font-size:13px;color:#36476F';
  const HEAD = '<h2 style="margin:0 0 4px;font-size:20px;color:#36476F">Kings Research SEO Workbench</h2>';
  const MSG = '<p data-msg style="min-height:18px;margin:12px 0 0;font-size:13px;color:#B42318"></p>';

  function overlay() {
    let o = document.getElementById('krAuth');
    if (!o) {
      o = document.createElement('div');
      o.id = 'krAuth';
      o.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:#EAF8FF;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Roboto,Arial,sans-serif');
      document.body.appendChild(o);
    }
    return o;
  }

  function closeOverlay() {
    const o = document.getElementById('krAuth');
    if (o) o.remove();
  }

  function field(o, name) { return o.querySelector('[name="' + name + '"]'); }

  // Sign-in screen. Resolves once the person is signed in and, on a first sign-in, has set their own password.
  function showLogin(message) {
    return new Promise((resolve) => {
      const o = overlay();
      o.innerHTML = '<form style="' + BOX + '">' + HEAD +
        '<p style="margin:0 0 18px;color:#36476F;font-size:14px">Sign in with your work email.</p>' +
        '<label style="' + LABEL + '">Email<input name="email" type="email" autocomplete="username" required style="' + INPUT + '"></label>' +
        '<label style="' + LABEL + '">Password<input name="password" type="password" autocomplete="current-password" required style="' + INPUT + '"></label>' +
        '<button type="submit" style="' + BTN + '">Sign in</button>' + MSG +
        '<p style="margin:8px 0 0;font-size:12px;color:#36476F">First time here? Use the starting password from your manager. You will then set your own.</p>' +
        '<p style="margin:8px 0 0;font-size:12px"><a href="how-it-works.html" target="_blank" rel="noopener" style="color:#2B71E2">How the tool works</a></p></form>';
      const form = o.querySelector('form');
      const msg = o.querySelector('[data-msg]');
      const btn = o.querySelector('button');
      msg.textContent = message || '';
      field(o, 'email').value = KR.store.get('kr_login_email', '');
      (field(o, 'email').value ? field(o, 'password') : field(o, 'email')).focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = field(o, 'password').value;
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        msg.textContent = '';
        try {
          const r = await baseApi('auth', 'login', { email: field(o, 'email').value.trim(), password });
          KR.store.set('kr_login_email', r.email);
          store(r);
          if (r.mustChange) await showChange(password, true);
          closeOverlay();
          resolve();
        } catch (err) {
          msg.textContent = err.message;
          btn.disabled = false;
          btn.textContent = 'Sign in';
        }
      });
    });
  }

  // Set-a-new-password screen. forced = first sign-in (cannot be skipped). Resolves true when the password changed.
  function showChange(currentPassword, forced) {
    return new Promise((resolve) => {
      const o = overlay();
      o.innerHTML = '<form style="' + BOX + '">' + HEAD +
        '<p style="margin:0 0 18px;color:#36476F;font-size:14px">' + (forced ? 'Welcome. Set your own password to continue.' : 'Change your password.') + '</p>' +
        (forced ? '' : '<label style="' + LABEL + '">Current password<input name="old" type="password" autocomplete="current-password" required style="' + INPUT + '"></label>') +
        '<label style="' + LABEL + '">New password (at least 6 characters)<input name="new1" type="password" autocomplete="new-password" required minlength="6" style="' + INPUT + '"></label>' +
        '<label style="' + LABEL + '">New password again<input name="new2" type="password" autocomplete="new-password" required minlength="6" style="' + INPUT + '"></label>' +
        '<button type="submit" style="' + BTN + '">Save password</button>' +
        (forced ? '' : '<button type="button" data-cancel style="' + LINK + '">Cancel</button>') + MSG + '</form>';
      const form = o.querySelector('form');
      const msg = o.querySelector('[data-msg]');
      const btn = o.querySelector('button[type="submit"]');
      const cancel = o.querySelector('[data-cancel]');
      if (cancel) cancel.addEventListener('click', () => { closeOverlay(); resolve(false); });
      (forced ? field(o, 'new1') : field(o, 'old')).focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const next = field(o, 'new1').value;
        if (next !== field(o, 'new2').value) { msg.textContent = 'The two new passwords are not the same.'; return; }
        btn.disabled = true;
        btn.textContent = 'Saving…';
        msg.textContent = '';
        try {
          const r = await baseApi('auth', 'changePassword', { _token: session ? session.token : '', oldPassword: forced ? currentPassword : field(o, 'old').value, newPassword: next });
          store(r);
          if (!forced) closeOverlay();
          resolve(true);
        } catch (err) {
          msg.textContent = err.message;
          btn.disabled = false;
          btn.textContent = 'Save password';
        }
      });
    });
  }

  // ---------- used by main.js ----------
  KR.currentUser = () => (session ? session.email : '');

  // Resolves with the signed-in email; shows the sign-in screen first when needed.
  KR.requireLogin = async () => {
    if (!session || session.mustChange) {
      clear();
      await showLogin('');
    }
    return session.email;
  };

  // "How it works", "Change password" and "Sign out" beside the name box at the top right.
  KR.initAccountBar = () => {
    const name = KR.$('#userName');
    if (!name || document.getElementById('krAccount')) return;
    const bar = document.createElement('span');
    bar.id = 'krAccount';
    bar.setAttribute('style', 'display:inline-flex;gap:6px;margin-left:8px;vertical-align:middle');
    bar.innerHTML = '<a class="btn tiny ghost" href="how-it-works.html" target="_blank" rel="noopener">How it works</a>' +
      '<button type="button" class="btn tiny ghost" data-acc="pw">Change password</button><button type="button" class="btn tiny ghost" data-acc="out">Sign out</button>';
    name.insertAdjacentElement('afterend', bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acc]');
      if (!b) return;
      if (b.getAttribute('data-acc') === 'out') { clear(); location.reload(); return; }
      showChange('', false).then((changed) => { if (changed) KR.toast('Password changed.', 'ok'); });
    });
  };
})();
