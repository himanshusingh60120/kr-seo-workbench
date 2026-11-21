'use strict';
/* KR SEO Workbench: shared browser helpers. Every script attaches to window.KR. */
(function () {
  const KR = (window.KR = window.KR || {});

  KR.$ = (s, el) => (el || document).querySelector(s);
  KR.$$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  KR.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  KR.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  KR.fmtNum = (n) => (n === null || n === undefined || n === '' || isNaN(Number(n))) ? '–' : Number(n).toLocaleString('en-US');
  KR.state = {};

  KR.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  KR.session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'vs', 'via']);
  const ACR = new Set(['ai', 'iot', 'ev', 'evs', 'hvac', 'crispr', 'api', 'b2b', 'b2c', 'ar', 'vr', 'xr', 'ml', 'nlp', 'llm', 'saas', 'paas', 'iaas', 'erp', 'crm', 'led', 'oled', 'lidar', 'rfid', 'gps', 'uav', 'pcb', 'ic', '3g', '4g', '5g', '6g', '3d', '2d', 'ott', 'ehr', 'emr', 'bfsi', 'sme', 'smes', 'ppe', 'dna', 'rna', 'mrna', 'ivd', 'pos', 'adas', 'ngs', 'pcr']);
  KR.titleCase = (s) => String(s || '').trim().split(/\s+/).map((w, i) => {
    if (!w) return w;
    const core = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ACR.has(core)) return w.toUpperCase();
    if (/[A-Z]/.test(w.slice(1))) return w;
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
  KR.lowerKw = (s) => String(s || '').split(' ').map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');

  KR.chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
  KR.runLimited = async (tasks, limit) => {
    let i = 0;
    const n = Math.max(1, Math.min(limit, tasks.length));
    const workers = [];
    for (let w = 0; w < n; w++) workers.push((async () => { while (i < tasks.length) { const k = i++; await tasks[k](); } })());
    await Promise.all(workers);
  };

  KR.toast = (msg, type) => {
    const box = KR.$('#toast');
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.remove(), type === 'err' ? 8000 : 5000);
  };

  KR.userName = () => String(KR.$('#userName').value || '').trim();
  KR.requireUser = () => {
    const u = KR.userName();
    if (!u) { KR.$('#userName').focus(); throw new Error('Enter your name (top right) first.'); }
    return u;
  };

  KR.busy = (btn, on, label) => {
    if (!btn) return;
    if (on) { if (!btn.dataset.label) btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
    else { btn.disabled = false; if (btn.dataset.label) { btn.textContent = btn.dataset.label; delete btn.dataset.label; } }
  };

  KR.copy = (text, btn) => {
    const done = () => { if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 1400); } };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { KR.toast('Copy failed: select the text and copy it manually.', 'err'); }
      ta.remove();
    }
  };

  // ---------- API ----------
  KR.api = async (endpoint, action, payload) => {
    const headers = { 'Content-Type': 'application/json' };
    const key = KR.store.get('kr_team_key', '');
    if (key) headers['x-team-key'] = key;
    let res;
    try {
      res = await fetch('/api/' + endpoint, { method: 'POST', headers, body: JSON.stringify(Object.assign({ action }, payload || {})) });
    } catch (e) {
      throw new Error('Network error: ' + e.message);
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {
      data = { error: res.status === 504 ? 'The server took too long (timeout). Try again, or check shorter content.' : (text.replace(/<[^>]+>/g, ' ').trim().slice(0, 240) || 'HTTP ' + res.status) };
    }
    if (res.status === 401 && !KR.$('#settingsDlg').open) KR.openSettings('Enter the team access key to use the tool.');
    if (!res.ok) {
      const err = new Error(data.error || 'HTTP ' + res.status);
      err.status = res.status;
      err.retryAfter = data.retryAfter;
      throw err;
    }
    return data;
  };

  // ---------- progress ----------
  KR.progress = (sel) => {
    const box = typeof sel === 'string' ? KR.$(sel) : sel;
    box.innerHTML = '';
    const mk = (cls, msg) => { const d = document.createElement('div'); d.className = 'p-step ' + cls; d.textContent = msg; box.appendChild(d); return d; };
    return {
      step(msg) {
        const d = mk('run', msg);
        return {
          set(m) { d.textContent = m; },
          done(m) { d.className = 'p-step ok'; if (m) d.textContent = m; },
          fail(m) { d.className = 'p-step err'; if (m) d.textContent = m; }
        };
      },
      info(msg) { mk('info', msg); },
      error(msg) { mk('err', msg); }
    };
  };

  KR.countdown = async (sec, prog, label) => {
    const st = prog.step(label + ': waiting ' + sec + 's…');
    for (let s = sec; s > 0; s--) { st.set(label + ': waiting ' + s + 's…'); await KR.sleep(1000); }
    st.done(label + ': resumed');
  };

  // ---------- tabs ----------
  KR.hooks = { tab: {}, sub: {} };
  KR.showSub = (group, id) => {
    if (typeof group === 'string') group = KR.$('.subtabs[data-group="' + group + '"]');
    if (!group) return;
    KR.$$('button', group).forEach((x) => x.classList.toggle('active', x.dataset.sub === id));
    Array.from(group.parentElement.children).filter((c) => c.classList.contains('sub')).forEach((s) => s.classList.toggle('active', s.id === id));
    if (KR.hooks.sub[id]) KR.hooks.sub[id]();
  };
  KR.showTab = (tab) => {
    KR.$$('#mainTabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
    KR.$$('main > .tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + tab));
    if (KR.hooks.tab[tab]) KR.hooks.tab[tab]();
  };
  KR.initTabs = () => {
    KR.$$('#mainTabs button').forEach((b) => b.addEventListener('click', () => KR.showTab(b.dataset.tab)));
    KR.$$('.subtabs').forEach((g) => KR.$$('button', g).forEach((b) => b.addEventListener('click', () => KR.showSub(g, b.dataset.sub))));
  };

  // ---------- 1px line icons (brand iconography) ----------
  const ICONS = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6M9 18h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/><rect x="2.5" y="2.5" width="19" height="19"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  };
  KR.initIcons = () => {
    KR.$$('.ico[data-icon]').forEach((el) => {
      const p = ICONS[el.dataset.icon];
      if (p) el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
    });
  };

  // ---------- setup dialog ----------
  KR.openSettings = async (msg) => {
    const dlg = KR.$('#settingsDlg');
    const m = KR.$('#setMsg');
    m.textContent = msg || '';
    m.classList.toggle('hidden', !msg);
    KR.$('#setKey').value = KR.store.get('kr_team_key', '');
    if (!dlg.open) dlg.showModal();
    const box = KR.$('#setStatus');
    box.innerHTML = '<p class="hint">Checking configuration…</p>';
    try {
      const s = await KR.api('setup', 'status');
      const env = Object.keys(s.env).map((k) => '<li>' + (s.env[k] ? '<span class="tag ok">set</span>' : '<span class="tag' + (['TEAM_ACCESS_KEY', 'KR_COOKIE'].indexOf(k) >= 0 ? '' : ' bad') + '">' + (['TEAM_ACCESS_KEY', 'KR_COOKIE'].indexOf(k) >= 0 ? 'optional' : 'missing') + '</span>') + ' ' + KR.esc(k) + '</li>').join('');
      box.innerHTML = '<h3>Server configuration</h3><ul class="env-list">' + env + '</ul>' +
        '<p class="small">Google Sheet: <a href="' + KR.esc(s.sheetUrl) + '" target="_blank" rel="noopener">open sheet</a>' +
        (s.serviceAccount ? ' · share it as Editor with <b>' + KR.esc(s.serviceAccount) + '</b>' : '') + '</p>' +
        '<p class="small">Manager: ' + KR.esc(s.managerEmail) + ' · Model: ' + KR.esc(s.model) + ' · Web fact-check: ' + (s.webSearch ? 'on' : 'off') + '</p>' +
        '<p class="small">Competitors: ' + KR.esc(s.competitors.join(', ')) + '</p>' +
        '<p class="small">Sheet tabs: ' + KR.esc(s.tabs.join(', ')) + '</p>';
    } catch (e) {
      box.innerHTML = '<p class="err">' + KR.esc(e.message) + '</p>';
    }
  };

  KR.initSettings = () => {
    KR.$('#btnSettings').addEventListener('click', () => KR.openSettings());
    KR.$('#setClose').addEventListener('click', () => KR.$('#settingsDlg').close());
    KR.$('#setSaveKey').addEventListener('click', () => {
      KR.store.set('kr_team_key', KR.$('#setKey').value.trim());
      KR.toast('Access key saved in this browser.', 'ok');
      KR.openSettings();
    });
    KR.$('#setInit').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      KR.busy(btn, true, 'Creating tabs…');
      try {
        const r = await KR.api('setup', 'init');
        KR.toast(r.created && r.created.length ? 'Created tabs: ' + r.created.join(', ') : 'All sheet tabs are ready.', 'ok');
        (r.warnings || []).forEach((w) => KR.toast(w));
      } catch (err) { KR.toast(err.message, 'err'); }
      finally { KR.busy(btn, false); }
    });
  };
})();
