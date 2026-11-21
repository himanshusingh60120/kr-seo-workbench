'use strict';

// Syncs the reports sitemap into the "Sitemap" tab and marks Research List reports as live.
// Runs only when someone clicks "Sync reports sitemap" (no cron).

const { handler, nowIST, slugify, titleCase } = require('../lib/http');
const sitemap = require('../lib/sitemap');
const sheets = require('../lib/sheets');

function normUrl(u) {
  return String(u || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/(preview\/)?(report|snapshot|toc)\//, '/')
    .replace(/\/+$/, '');
}

function slugFromUrl(u) {
  const last = normUrl(u).split('/').pop() || '';
  return last.replace(/-\d+$/, '');
}

module.exports = handler({
  async sync() {
    const items = await sitemap.fetchSitemap('report', true);
    const now = nowIST();
    const existing = await sheets.readTab('SITEMAP');
    const baseline = existing.length === 0;
    const prev = new Map(existing.map((r) => [r['URL'], r]));
    const seen = new Set();
    const out = [];
    let added = 0;
    items.forEach((it) => {
      seen.add(it.url);
      const p = prev.get(it.url);
      if (!p) added++;
      out.push({
        'URL': it.url,
        'Report ID': it.id,
        'Slug': it.slug,
        'Name': titleCase(it.kw),
        'Lastmod': it.lastmod,
        'First Seen': p ? p['First Seen'] : (baseline ? now + ' (baseline)' : now),
        'Last Seen': now,
        'In Sitemap': 'Yes'
      });
    });
    existing.forEach((r) => {
      if (!seen.has(r['URL'])) {
        out.push({
          'URL': r['URL'], 'Report ID': r['Report ID'], 'Slug': r['Slug'], 'Name': r['Name'], 'Lastmod': r['Lastmod'],
          'First Seen': r['First Seen'], 'Last Seen': r['Last Seen'], 'In Sitemap': 'No (removed)'
        });
      }
    });
    await sheets.rewriteTab('SITEMAP', out);

    const bySlug = new Map();
    items.forEach((it) => { if (!bySlug.has(it.slug)) bySlug.set(it.slug, it); });
    const byUrl = new Map(items.map((it) => [normUrl(it.url), it]));
    const research = await sheets.readTab('RESEARCH');
    const updates = [];
    const newlyLive = [];
    research.forEach((r) => {
      if (r['Live Status'] === 'Live' && r['Live URL']) return;
      let hit = null;
      if (r['Live URL']) hit = byUrl.get(normUrl(r['Live URL'])) || bySlug.get(slugFromUrl(r['Live URL'])) || null;
      if (!hit) {
        const names = [r['Report Name'], r['Primary Keyword']];
        for (const n of names) {
          const s = slugify(n);
          if (!s) continue;
          if (bySlug.has(s)) { hit = bySlug.get(s); break; }
          if (!/-market$/.test(s) && bySlug.has(s + '-market')) { hit = bySlug.get(s + '-market'); break; }
        }
      }
      if (hit) {
        updates.push({ row: r._row, data: { 'Live Status': 'Live', 'Live URL': hit.url, 'Report ID': hit.id, 'Live Date': hit.lastmod, 'Detected On': now } });
        newlyLive.push({ report: r['Report Name'], url: hit.url, liveDate: hit.lastmod });
      }
    });
    if (updates.length) await sheets.updateCells('RESEARCH', updates);
    return { total: items.length, added: baseline ? 0 : added, baseline, removed: out.length - items.length, newlyLive, syncedAt: now };
  }
});
