'use strict';
/* Check results and roles. Loaded by main.js.
   - Everyone signed in can read every saved RD, Publish and Live check in the "Check results" tab.
   - Only the check team (CHECKERS on the server) can run checks. For everyone else the run buttons are hidden and a
     note points to the results; the server refuses check actions from them anyway.
   - The "API credits" tab is shown only to CREDIT_VIEWERS. */
(function () {
  const KR = window.KR;
  const { $, esc } = KR;
  const R = { list: [], total: 0, loaded: false, timer: 0 };

  // ---------- roles ----------
  KR.applyRoles = () => {
    const me = KR.me || {};
    const team = (me.checkers || []).join(', ');
    const teamBox = $('#resTeam');
    if (teamBox) teamBox.textContent = team ? 'Check team: ' + team + '.' : '';
    if (me.creditViewer) {
      const t = $('#tabCredits');
      if (t) t.classList.remove('hidden');
    }
    if (me.checker !== false) return;
    document.body.classList.add('kr-viewer');
    const style = document.createElement('style');
    style.textContent = '.kr-viewer #rdRun,.kr-viewer #rdSave,.kr-viewer #pcRun,.kr-viewer #lvRun,.kr-viewer #lvCheckAll,' +
      '.kr-viewer [data-lvcheck],.kr-viewer .kr-dec{display:none !important}';
    document.head.appendChild(style);
    const msg = 'You can read check results, but checks are run only by the check team' + (team ? ' (' + team + ')' : '') + '. Open "Check results" to see their findings.';
    ['#rdProgress', '#pcProgress', '#lvProgress'].forEach((sel) => {
      const el = $(sel);
      if (!el || !el.parentNode) return;
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = msg;
      el.parentNode.insertBefore(p, el);
    });
  };

  // ---------- reading the saved text back as issues ----------
  // The sheet stores each finding as one line: "1. [error] Section: problem -> fix | "quote"".
  function lineHtml(line) {
    let m = line.match(/^\d+\.\s*\[(error|warning|check)\]\s*(.*)$/i);
    if (m) {
      const sev = m[1].toLowerCase();
      let rest = m[2];
      let quote = '';
      const qi = rest.lastIndexOf(' | "');
      if (qi >= 0 && /"$/.test(rest)) {
        quote = rest.slice(qi + 4, -1);
        rest = rest.slice(0, qi);
      }
      let fix = '';
      const fi = rest.indexOf(' -> ');
      if (fi >= 0) {
        fix = rest.slice(fi + 4);
        rest = rest.slice(0, fi);
      }
      return '<div class="issue"><span class="sev ' + sev + '">' + sev + '</span><div>' + esc(rest) + '</div>' +
        (quote ? '<div class="quote">' + esc(quote) + '</div>' : '') + (fix ? '<div class="fix">Fix: ' + esc(fix) + '</div>' : '') + '</div>';
    }
    m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (m) {
      const v = m[1];
      const cls = /^supported$/i.test(v) ? 'ok' : /contradicted|error/i.test(v) ? 'bad' : '';
      return '<div class="issue"><span class="tag ' + cls + '" style="margin:0 8px 0 0">' + esc(v) + '</span>' + esc(m[2]) + '</div>';
    }
    return '<div class="issue"><div>' + esc(line) + '</div></div>';
  }

  function linesHtml(text) {
    const t = String(text || '').trim();
    if (!t) return '<p class="hint">Nothing recorded.</p>';
    if (t === 'Not run') return '<p class="hint">Not run.</p>';
    if (t === 'OK') return '<p class="ok-msg">No issues found.</p>';
    if (t === 'No claims') return '<p class="ok-msg">No third-party facts to check.</p>';
    if (/^ERROR: /.test(t)) return '<p class="err">' + esc(t) + '</p>';
    if (/^Checked in Live Tracker|^Skipped/i.test(t)) return '<p class="hint">' + esc(t) + '</p>';
    return t.split('\n').map((l) => l.trim()).filter(Boolean).map(lineHtml).join('');
  }

  function statusTag(x) {
    const s = String(x.status || '');
    const cls = /fix|issues/i.test(s) ? 'bad' : /pass|^ok$/i.test(s) ? 'ok' : '';
    return '<span class="tag ' + cls + '">' + esc(s || '–') + '</span>';
  }

  function shortUrl(u) { return String(u || '').replace(/^https?:\/\/(www\.)?/, ''); }

  // ---------- list ----------
  function renderList() {
    const box = $('#resList');
    if (!R.list.length) { box.innerHTML = '<p class="hint">No saved checks match.</p>'; return; }
    box.innerHTML = (R.total > R.list.length ? '<p class="hint">Showing the latest ' + R.list.length + ' of ' + R.total + '. Use the filter to find older ones.</p>' : '') +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Check</th><th>Report</th><th>Checked by</th><th>Result</th><th>Issues</th><th></th></tr></thead><tbody>' +
      R.list.map((x, i) => '<tr><td class="small nowrap">' + esc(x.at) + '</td><td>' + esc(x.label) + '</td>' +
        '<td><b>' + esc(x.report || '(no name)') + '</b>' + (x.url ? '<div class="small"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(x.url)) + '</a></div>' : '') + '</td>' +
        '<td class="small">' + esc(x.by || 'unknown') + (x.by && !x.checker ? ' <span class="tag">not in the check team</span>' : '') + '</td>' +
        '<td>' + statusTag(x) + '</td><td>' + esc(x.total) + '</td>' +
        '<td><button class="btn tiny" type="button" data-resview="' + i + '">View</button></td></tr>').join('') +
      '</tbody></table></div>';
  }

  async function load() {
    const box = $('#resList');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const r = await KR.api('history', 'list', { kind: $('#resKind').value, q: $('#resQuery').value.trim() });
      R.list = r.results || [];
      R.total = r.total || R.list.length;
      R.loaded = true;
      if (r.checkers && r.checkers.length && $('#resTeam')) $('#resTeam').textContent = 'Check team: ' + r.checkers.join(', ') + '.';
      renderList();
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  // ---------- one check ----------
  function renderDetail(d) {
    const sections = (d.sections || []).map((s) => {
      const text = String(s.text || '');
      const n = (text.match(/^\d+\.\s*\[/gm) || []).length;
      const hasErr = /\[error\]/i.test(text);
      const badge = n ? '<span class="tag' + (hasErr ? ' bad' : '') + '">' + n + ' issue(s)</span>' : '';
      return '<details class="cat"' + (hasErr ? ' open' : '') + '><summary><span class="grow">' + esc(s.title) + '</span>' + badge + '</summary>' +
        '<div class="cat-body">' + linesHtml(text) + '</div></details>';
    }).join('');
    $('#resDetail').innerHTML = '<div class="card"><h2>' + esc(d.report || d.label) + ' ' + statusTag(d) + '</h2>' +
      '<p class="small muted">' + esc(d.label) + ' · ' + esc(d.at) + ' · checked by ' + esc(d.by || 'unknown') +
      (d.url ? ' · <a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(d.url)) + '</a>' : '') +
      (d.details && d.details.primary ? ' · primary keyword: ' + esc(d.details.primary) : '') +
      (d.details && d.details.words ? ' · ' + esc(d.details.words) + ' words' : '') + ' · ' + esc(d.total) + ' issue(s)</p>' + sections + '</div>';
  }

  async function view(i, btn) {
    const x = R.list[i];
    if (!x) return;
    KR.busy(btn, true, 'Opening…');
    try {
      const d = await KR.api('history', 'get', { kind: x.kind, row: x.row, at: x.at });
      renderDetail(d);
      $('#resDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initResults = () => {
    $('#resRefresh').addEventListener('click', load);
    $('#resKind').addEventListener('change', load);
    $('#resQuery').addEventListener('input', () => {
      clearTimeout(R.timer);
      R.timer = setTimeout(load, 500);
    });
    $('#resList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-resview]');
      if (b) view(Number(b.getAttribute('data-resview')), b);
    });
    KR.hooks.tab.results = () => { if (!R.loaded) load(); };
  };
})();
