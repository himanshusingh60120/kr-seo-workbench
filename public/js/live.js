'use strict';
/* Publish Check (preview URL) and Live Tracker (sitemap sync, live status, live checks). Everything runs on click. */
(function () {
  const KR = window.KR;
  const { $, esc } = KR;
  const S = KR.state;

  async function runPublish() {
    const btn = $('#pcRun');
    const url = $('#pcUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { KR.toast('Paste the full preview URL (https://www.kingsresearch.com/preview/report/...).', 'err'); return; }
    if (!/\/preview\//.test(url)) KR.toast('This does not look like a preview URL. The check will still run.');
    KR.busy(btn, true, 'Checking…');
    try {
      await KR.runPageCheck({ url, mode: 'publish', progEl: '#pcProgress', resultsEl: '#pcResults', web: $('#pcWeb').checked });
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function loadLive() {
    const box = $('#lvTable');
    box.innerHTML = '<p class="hint">Loading the Research List…</p>';
    try {
      box.innerHTML = KR.researchTable(await KR.loadResearch(), true);
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    }
  }

  async function syncSitemap() {
    const btn = $('#lvSync');
    const note = $('#lvSyncResult');
    KR.busy(btn, true, 'Syncing…');
    try {
      const r = await KR.api('sitemap', 'sync');
      let msg = 'Synced ' + r.total.toLocaleString('en-US') + ' report URLs on ' + r.syncedAt + '. ';
      msg += r.baseline ? 'This was the first sync, so it is the baseline; new reports are detected from the next sync. ' : r.added + ' new report(s) since the last sync. ';
      msg += r.newlyLive.length ? 'Newly live from the Research List: ' + r.newlyLive.map((x) => x.report + ' (' + x.liveDate + ')').join(', ') + '.' : 'No newly live reports from the Research List.';
      note.textContent = msg;
      note.classList.remove('hidden');
      KR.toast('Sitemap synced.', 'ok');
      await loadLive();
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function checkRow(i, btn) {
    const r = (S.research || [])[i];
    if (!r || !r.liveUrl) return;
    KR.busy(btn, true, 'Checking…');
    try {
      await KR.runPageCheck({ url: r.liveUrl, mode: 'live', progEl: '#lvProgress', resultsEl: '#lvResults', web: $('#lvWeb').checked });
      $('#lvResults').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
      loadLive();
    }
  }

  async function checkAll() {
    const btn = $('#lvCheckAll');
    try {
      const rows = (await KR.loadResearch()).filter((r) => r.liveStatus === 'Live' && r.liveUrl && !r.lastCheck);
      if (!rows.length) { KR.toast('Every live report already has a live check. Use the buttons in the table to re-run one.'); return; }
      KR.busy(btn, true, 'Checking ' + rows.length + '…');
      for (let k = 0; k < rows.length; k++) {
        btn.textContent = 'Checking ' + (k + 1) + ' of ' + rows.length + '…';
        try {
          await KR.runPageCheck({ url: rows[k].liveUrl, mode: 'live', progEl: '#lvProgress', resultsEl: '#lvResults', web: $('#lvWeb').checked });
        } catch (e) {
          KR.toast(rows[k].reportName + ': ' + e.message, 'err');
        }
      }
      KR.toast('Live checks finished and saved to the "Live Check" sheet.', 'ok');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
      loadLive();
    }
  }

  async function runManual() {
    const btn = $('#lvRun');
    const url = $('#lvUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { KR.toast('Paste the full live URL.', 'err'); return; }
    KR.busy(btn, true, 'Checking…');
    try {
      await KR.runPageCheck({ url, mode: 'live', progEl: '#lvProgress', resultsEl: '#lvResults', web: $('#lvWeb').checked });
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initLive = () => {
    $('#pcRun').addEventListener('click', runPublish);
    $('#lvSync').addEventListener('click', syncSitemap);
    $('#lvRefresh').addEventListener('click', loadLive);
    $('#lvCheckAll').addEventListener('click', checkAll);
    $('#lvRun').addEventListener('click', runManual);
    $('#lvTable').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-lvcheck]');
      if (b) checkRow(Number(b.dataset.lvcheck), b);
    });
    KR.hooks.tab.live = loadLive;
  };
})();
