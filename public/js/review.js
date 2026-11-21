'use strict';
/* RD issue decisions. Loaded by main.js. Every issue in the RD results gets an "Error" tick box. Unticking it
   saves "<email> marked this as not an error" to the "Issue Decisions" sheet tab, under the report's name.
   When anyone checks the same report again, the issue is shown faded with that note, so the team can see who
   decided it was not an error. Ticking it again is also saved. Nothing is ever deleted from the log. */
(function () {
  const KR = window.KR;
  const { $, $$ } = KR;
  const S = KR.state;
  const D = { report: null, map: new Map(), loading: Promise.resolve(), timer: 0 };

  // The same rule as the server: issues are matched by the letters and digits of their quoted text.
  function plainKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200); }
  function reportName() { return (S.rd && S.rd.reportName) || ''; }
  function keyOf(x) { return plainKey(x.quote || x.problem); }
  function isOff(key) { const d = D.map.get(key); return !!d && d.decision === 'Not an error'; }

  function partsOf(el) {
    const q = el.querySelector('.quote');
    const p = Array.from(el.children).find((c) => c.tagName === 'DIV' && !c.className);
    const sec = el.querySelector('.sec');
    const sev = el.querySelector('.sev');
    return { quote: q ? q.textContent : '', problem: p ? p.textContent : '', section: sec ? sec.textContent : '', severity: sev ? sev.textContent : '' };
  }

  async function loadFor(report) {
    D.report = report;
    D.map = new Map();
    if (!plainKey(report)) return;
    try {
      const r = await KR.api('rd', 'decisions', { report });
      if (D.report !== report) return;
      (r.decisions || []).forEach((d) => D.map.set(d.key, d));
    } catch (e) {
      /* The check still works without earlier decisions. */
    }
  }

  function decorate(el) {
    if (el.getAttribute('data-dec')) return;
    el.setAttribute('data-dec', '1');
    const parts = partsOf(el);
    const key = keyOf(parts);
    if (!key) return;
    const d = D.map.get(key);
    const off = isOff(key);

    const label = document.createElement('label');
    label.className = 'chk kr-dec';
    label.setAttribute('style', 'float:right;margin-left:12px;font-size:12px;cursor:pointer');
    label.title = 'Untick if this is not an error. Your decision is saved with your email for the whole team to see.';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !off;
    label.appendChild(box);
    label.appendChild(document.createTextNode(' Error'));
    el.insertBefore(label, el.firstChild);

    // Fade the issue itself, but keep the note about who decided fully readable.
    Array.from(el.children).forEach((c) => { if (c !== label) c.style.opacity = off ? '0.5' : ''; });
    if (d) {
      const note = document.createElement('div');
      note.className = 'kr-dec-note small';
      note.setAttribute('style', 'margin-top:6px;padding:4px 8px;background:' + (off ? '#EDEDED' : '#EAF8FF') + ';color:#36476F');
      note.textContent = d.by + (off ? ' marked this as not an error' : ' marked this as an error again') + ' on ' + String(d.at || '').slice(0, 16) + '.';
      el.appendChild(note);
    }
    label.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => toggle(parts, key, box));
  }

  function redoAll() {
    const root = $('#rdResults');
    if (!root) return;
    $$('.issue', root).forEach((el) => {
      $$('.kr-dec, .kr-dec-note', el).forEach((x) => x.remove());
      Array.from(el.children).forEach((c) => { c.style.opacity = ''; });
      el.removeAttribute('data-dec');
      decorate(el);
    });
    syncHighlights();
  }

  async function toggle(parts, key, box) {
    const decision = box.checked ? 'Error' : 'Not an error';
    box.disabled = true;
    try {
      const r = await KR.api('rd', 'decide', Object.assign({ report: reportName(), decision }, parts));
      D.map.set(r.key || key, r);
      redoAll();
      KR.toast(decision === 'Not an error' ? 'Saved: you marked this as not an error.' : 'Saved: marked as an error again.', 'ok');
    } catch (e) {
      box.checked = !box.checked;
      box.disabled = false;
      KR.toast(e.message, 'err');
    }
  }

  // Text of an issue marked "not an error" loses its faint red shading in the content view.
  function syncHighlights() {
    const box = $('#rdHighlight');
    if (!box || !S.rd) return;
    (S.rd.issueItems || []).forEach((it, idx) => {
      const off = isOff(keyOf(it));
      $$('[data-iq="' + idx + '"]', box).forEach((sp) => {
        if (!sp.hasAttribute('data-style')) sp.setAttribute('data-style', sp.getAttribute('style') || '');
        sp.setAttribute('style', off ? '' : sp.getAttribute('data-style'));
      });
    });
  }

  async function run() {
    const root = $('#rdResults');
    if (!root) return;
    const report = reportName();
    if (report !== D.report) D.loading = loadFor(report);
    await D.loading;
    $$('.issue', root).forEach(decorate);
    syncHighlights();
  }

  // The RD results are redrawn several times during a check; every redraw gets its tick boxes back.
  KR.initReview = () => {
    const root = $('#rdResults');
    if (!root) return;
    new MutationObserver(() => {
      clearTimeout(D.timer);
      D.timer = setTimeout(run, 60);
    }).observe(root, { childList: true, subtree: true });
  };
})();
