'use strict';

// Reads the Kings Research sitemaps (reports, blogs, press releases).

const { HttpError, UA, fetchWithTimeout } = require('./http');

const PATHS = { report: '/sitemap-reports.xml', blog: '/sitemap-blogs.xml', press: '/sitemap-pr.xml' };
const cache = {};

function base() { return String(process.env.SITE_BASE || 'https://www.kingsresearch.com').replace(/\/+$/, ''); }

function decodeXml(s) {
  return String(s || '')
    .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .trim();
}

function parseEntry(url, lastmod, type) {
  let path = '';
  try { path = new URL(url).pathname; } catch (e) { path = url; }
  const last = path.split('/').filter(Boolean).pop() || '';
  const m = last.match(/^(.*?)-(\d+)$/);
  const slug = m ? m[1] : last;
  return {
    url,
    lastmod: String(lastmod || '').slice(0, 10),
    type,
    slug: slug.toLowerCase(),
    id: m ? m[2] : '',
    kw: slug.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  };
}

async function fetchXml(url) {
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' } }, 25000);
  if (!r.ok) throw new HttpError(502, 'Could not fetch ' + url + ' (HTTP ' + r.status + ')');
  return r.text();
}

function locs(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lastmod = (m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] || '';
    out.push({ loc: decodeXml(loc), lastmod: decodeXml(lastmod) });
  }
  return out;
}

async function fetchSitemap(type, force) {
  if (!PATHS[type]) throw new HttpError(400, 'Unknown sitemap type ' + type);
  const c = cache[type];
  if (!force && c && Date.now() - c.at < 15 * 60 * 1000) return c.items;
  let xml = await fetchXml(base() + PATHS[type]);
  let entries = locs(xml, 'url');
  if (!entries.length && /<sitemapindex/i.test(xml)) {
    const children = locs(xml, 'sitemap').slice(0, 20);
    entries = [];
    for (const ch of children) {
      xml = await fetchXml(ch.loc);
      entries = entries.concat(locs(xml, 'url'));
    }
  }
  const seen = new Set();
  const items = [];
  entries.forEach((e) => {
    if (!e.loc || seen.has(e.loc)) return;
    seen.add(e.loc);
    items.push(parseEntry(e.loc, e.lastmod, type));
  });
  cache[type] = { at: Date.now(), items };
  return items;
}

async function allLinks() {
  const types = Object.keys(PATHS);
  const results = await Promise.allSettled(types.map((t) => fetchSitemap(t)));
  const links = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') r.value.forEach((x) => links.push(x));
    else errors.push(types[i] + ': ' + (r.reason && r.reason.message));
  });
  if (!links.length) throw new HttpError(502, 'Could not read any sitemap. ' + errors.join(' | '));
  return { links, errors };
}

module.exports = { fetchSitemap, allLinks };
