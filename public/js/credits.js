'use strict';
/* API credit counter ("API credits" tab). Loaded by main.js and shown only to CREDIT_VIEWERS (the server refuses
   everyone else). It shows what the tool has used from each paid service this month and today, who used it, which
   features used it, the last 30 days, the Mangools lookups left (live from Mangools) and the Tavily free searches
   used this month. Costs are estimates from token counts at the prices set in Vercel. */
(function () {
  const KR = window.KR;
  const { $, esc, fmtNum } = KR;
  let loaded = false;

  function usd(n) {
    const v = Number(n) || 0;
    if (!v) return '$0';
    return '$' + (v < 1 ? v.toFixed(3) : v.toFixed(2));
  }

  function cell(value, label) {
    return '<div class="cell"><div class="num">' + value + '</div><div class="lbl">' + esc(label) + '</div></div>';
  }

  // A bar that fills up as a limit is used: green, amber from 70%, red from 90%.
  function bar(used, limit, label) {
    if (!limit) return '';
    const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
    return '<div style="margin:12px 0"><div class="small"><b>' + esc(label) + '</b> · ' + fmtNum(used) + ' of ' + fmtNum(limit) + ' used (' + pct + '%)</div>' +
      '<div style="height:8px;background:var(--grey);margin-top:4px"><div style="height:8px;width:' + pct + '%;background:' + color + '"></div></div></div>';
  }

  function usageTable(rows, firstCol) {
    if (!rows.length) return '<p class="hint">Nothing used yet this month.</p>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(firstCol) + '</th><th>Estimated cost</th><th>OpenAI calls</th><th>Jev decisions</th><th>Web searches</th><th>Mangools lookups</th><th>Requests</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + esc(r.name) + '</td><td>' + usd(r.cost) + '</td><td>' + fmtNum(r.openaiCalls) + (r.openaiSearches ? ' <span class="muted small">(' + fmtNum(r.openaiSearches) + ' web)</span>' : '') + '</td>' +
        '<td>' + fmtNum(r.jev) + '</td><td>' + fmtNum(r.tavily + r.serper) + '</td><td>' + fmtNum(r.mangools) + '</td><td>' + fmtNum(r.requests) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function daysChart(days) {
    if (!days.length) return '<p class="hint">No usage in the last 30 days.</p>';
    const max = Math.max.apply(null, days.map((d) => d.cost)) || 1;
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Day</th><th style="width:45%">Estimated cost</th><th>OpenAI</th><th>Searches</th><th>Mangools</th></tr></thead><tbody>' +
      days.slice().reverse().map((d) => '<tr><td class="nowrap">' + esc(d.day) + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px"><div style="height:10px;background:var(--blue);width:' + Math.max(2, Math.round((d.cost / max) * 100)) + '%"></div><span class="small">' + usd(d.cost) + '</span></div></td>' +
        '<td>' + fmtNum(d.openaiCalls) + '</td><td>' + fmtNum(d.tavily + d.serper) + '</td><td>' + fmtNum(d.mangools) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function render(d) {
    const m = d.totals.month;
    const t = d.totals.today;
    const mg = d.mangools || {};
    const lookups = mg.lookups;
    const serps = mg.serps;
    let html = '<p class="hint">Month ' + esc(d.month) + ' · counting since ' + esc(String(d.first || 'today').slice(0, 10)) + ' · visible to ' + esc((d.viewers || []).join(', ')) + '.</p>';
    html += '<div class="summary">' +
      cell(usd(m.cost), 'Estimated cost this month') +
      cell(usd(t.cost), 'Estimated cost today') +
      cell(usd(m.openaiCost), 'OpenAI this month (' + fmtNum(m.openaiCalls) + ' calls)') +
      cell(fmtNum(m.tavily) + (d.limits.tavily ? '<span class="small muted"> / ' + fmtNum(d.limits.tavily) + '</span>' : ''), 'Tavily searches this month') +
      cell(lookups ? fmtNum(lookups.remaining) + '<span class="small muted"> / ' + fmtNum(lookups.limit) + '</span>' : fmtNum(m.mangools), lookups ? 'Mangools keyword lookups left' : 'Mangools lookups this month') +
      cell(fmtNum(m.jev), 'Jev decisions this month') +
      '</div>';
    html += '<h3>Limits</h3>';
    html += bar(m.tavily, d.limits.tavily, 'Tavily free searches this month');
    if (lookups && lookups.limit) html += bar(lookups.limit - (lookups.remaining || 0), lookups.limit, 'Mangools keyword lookups (live from Mangools)');
    if (serps && serps.limit) html += bar(serps.limit - (serps.remaining || 0), serps.limit, 'Mangools SERP lookups (live from Mangools)');
    if (d.limits.openaiBudget) html += bar(Math.round(m.openaiCost * 100) / 100, d.limits.openaiBudget, 'OpenAI budget this month (USD)');
    if (d.mangoolsError) html += '<p class="note">Mangools lookups left could not be read: ' + esc(d.mangoolsError) + '</p>';
    if (m.serper) html += '<p class="small">Serper backup searches this month: ' + fmtNum(m.serper) + '.</p>';
    html += '<h3>By person (this month)</h3>' + usageTable(d.people || [], 'Person');
    html += '<h3>By feature (this month)</h3>' + usageTable(d.features || [], 'Feature');
    html += '<h3>Last 30 days</h3>' + daysChart(d.days || []);
    html += '<p class="hint">All time: ' + usd(d.totals.all.cost) + ' estimated, ' + fmtNum(d.totals.all.openaiCalls) + ' OpenAI calls, ' + fmtNum(d.totals.all.tavily) + ' Tavily searches, ' +
      fmtNum(d.totals.all.mangools) + ' Mangools lookups. OpenAI costs use the prices set in Vercel (gpt-4.1-mini by default); the OpenAI web-search price per search is an estimate. Every row is in the "API Usage" sheet tab.</p>';
    $('#crBody').innerHTML = html;
  }

  async function load() {
    const box = $('#crBody');
    const btn = $('#crRefresh');
    box.innerHTML = '<p class="hint">Loading the counter…</p>';
    KR.busy(btn, true, 'Loading…');
    try {
      render(await KR.api('history', 'credits'));
      loaded = true;
    } catch (e) {
      box.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initCredits = () => {
    const btn = $('#crRefresh');
    if (!btn) return;
    btn.addEventListener('click', load);
    KR.hooks.tab.credits = () => { if (!loaded) load(); };
  };
})();
