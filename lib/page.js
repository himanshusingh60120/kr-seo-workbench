'use strict';

// Fetches a Kings Research report page (live or preview) plus its Report Snapshot and Table of Contents tabs,
// and turns them into structured text the checks can use.

const cheerio = require('cheerio');
const { UA, HttpError, fetchWithTimeout } = require('./http');

const SITE_HOST = /(^|\.)kingsresearch\.com$/i;
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'ul', 'ol', 'li', 'table',
  'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'blockquote', 'figure',
  'figcaption', 'button', 'summary', 'details', 'dl', 'dt', 'dd', 'form', 'label']);
const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'select', 'option']);

function host(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } }

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

async function fetchHtml(url) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
  if (process.env.KR_COOKIE && SITE_HOST.test(host(url))) headers.Cookie = process.env.KR_COOKIE;
  let r;
  try {
    r = await fetchWithTimeout(url, { redirect: 'follow', headers }, 25000);
  } catch (e) {
    throw new HttpError(504, e.name === 'AbortError' ? 'The page took too long to load: ' + url : 'Could not load ' + url + ': ' + e.message);
  }
  const html = await r.text();
  return { status: r.status, finalUrl: r.url || url, redirected: !!r.redirected, html };
}

function absUrl(src, baseUrl) {
  if (!src) return '';
  try {
    const u = new URL(src, baseUrl);
    if (u.pathname.indexOf('/_next/image') === 0 && u.searchParams.get('url')) return absUrl(u.searchParams.get('url'), baseUrl);
    return u.href;
  } catch (e) { return ''; }
}

// Linearizes DOM into lines; headings get "#" prefixes, list items "- ", images "[IMAGE alt="..."] src".
function toLines($, root, baseUrl) {
  const lines = [];
  let cur = '';
  const flush = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t && !/^(#+|-)$/.test(t)) lines.push(t);
    cur = '';
  };
  function walk(node) {
    if (!node) return;
    if (node.type === 'text') { cur += node.data || ''; return; }
    if (node.type !== 'tag' && node.type !== 'root') return;
    const tag = String(node.name || '').toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'img') {
      const el = $(node);
      const src = absUrl(el.attr('src') || el.attr('data-src') || '', baseUrl);
      if (src && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(src)) {
        flush();
        lines.push('[IMAGE alt="' + String(el.attr('alt') || '').replace(/"/g, "'").trim() + '"] ' + src);
      }
      return;
    }
    const isBlock = BLOCK.has(tag);
    if (isBlock) flush();
    if (/^h[1-6]$/.test(tag)) cur += '#'.repeat(Number(tag[1])) + ' ';
    else if (tag === 'li') cur += '- ';
    (node.children || []).forEach(walk);
    if (isBlock) flush();
  }
  walk(root);
  flush();
  return lines;
}

function faqFromLd(list) {
  const out = [];
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    const types = [].concat(o['@type'] || []);
    if (types.indexOf('FAQPage') >= 0 && o.mainEntity) {
      [].concat(o.mainEntity).forEach((q) => {
        if (!q || !q.name) return;
        const a = Array.isArray(q.acceptedAnswer) ? q.acceptedAnswer[0] : q.acceptedAnswer;
        out.push({ q: stripTags(q.name), a: stripTags(a && a.text) });
      });
    }
    if (o['@graph']) visit(o['@graph']);
  };
  visit(list);
  return out;
}

const FAQ_END = /^(author|reviewed by|related reports|recent reports|quick links|similar reports)$/i;

function faqFromLines(lines) {
  const i = lines.findIndex((l) => /^(#+ )?frequently asked questions\b/i.test(l));
  if (i < 0) return [];
  const out = [];
  let cur = null;
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k].replace(/^#+ /, '').replace(/^- /, '').trim();
    if (FAQ_END.test(l)) break;
    if (!l || l.indexOf('[IMAGE') === 0) continue;
    if (/\?$/.test(l) && l.length < 300) { cur = { q: l, a: '' }; out.push(cur); }
    else if (cur) cur.a = (cur.a ? cur.a + ' ' : '') + l;
  }
  return out;
}

// Candidate URLs for the Snapshot / TOC tab, best first: the link found on the page, the preview-style URL,
// then the live URL (used when the report is already live, e.g. a revamp).
function tabCandidates(kind, finalUrl, discovered, requested) {
  const seg = '/' + kind + '/';
  const out = [];
  const push = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
  if (discovered && discovered.indexOf(seg) >= 0) push(discovered);
  [finalUrl, requested].forEach((u) => {
    if (!u || !/\/report\//.test(u)) return;
    push(u.replace(/\/report\//, seg));
    push(u.replace(/\/preview\//, '/').replace(/\/report\//, seg));
  });
  return out.slice(0, 4);
}

async function fetchTab(url, capChars) {
  if (!url) return { url: '', status: 0, text: '', error: 'Tab link not found on the page' };
  try {
    const r = await fetchHtml(url);
    if (r.status >= 400) return { url, status: r.status, text: '', error: 'HTTP ' + r.status };
    const $ = cheerio.load(r.html);
    $('script, style, noscript, svg, iframe, template, header, footer, nav').remove();
    let lines = toLines($, $('body')[0], r.finalUrl);
    const s = lines.findIndex((l) => /^# /.test(l));
    if (s > 0) lines = lines.slice(s);
    const e = lines.findIndex((l, k) => k > 0 && /^(#+ )?(frequently asked questions|author|reviewed by|quick links)\b/i.test(l));
    if (e > 0) lines = lines.slice(0, e);
    const text = lines.join('\n');
    return { url: r.finalUrl, status: r.status, text: text.slice(0, capChars), truncated: text.length > capChars };
  } catch (e) {
    return { url, status: 0, text: '', error: e.message };
  }
}

async function fetchTabAny(urls, capChars) {
  if (!urls.length) return { url: '', status: 0, text: '', error: 'Tab link not found on the page' };
  const tried = [];
  for (const u of urls) {
    const r = await fetchTab(u, capChars);
    if (r.text) {
      r.live = !/\/preview\//.test(r.url || u);
      return r;
    }
    tried.push(u + ' (' + (r.error || 'empty page') + ')');
  }
  return { url: urls[0], status: 0, text: '', error: 'tried ' + tried.join('; ') };
}

async function extract(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) throw new HttpError(400, 'Enter a full URL starting with https://');
  const main = await fetchHtml(target);
  if (main.status >= 400) {
    throw new HttpError(502, 'The page returned HTTP ' + main.status + '. If it is a preview page that needs a login, set KR_COOKIE in Vercel.');
  }
  const baseUrl = main.finalUrl;
  const $ = cheerio.load(main.html);

  const meta = {
    title: $('title').first().text().replace(/\s+/g, ' ').trim(),
    description: String($('meta[name="description"]').attr('content') || '').trim(),
    canonical: String($('link[rel="canonical"]').attr('href') || '').trim(),
    robots: String($('meta[name="robots"]').attr('content') || '').trim(),
    keywords: String($('meta[name="keywords"]').attr('content') || '').trim(),
    ogTitle: String($('meta[property="og:title"]').attr('content') || '').trim(),
    ogImage: String($('meta[property="og:image"]').attr('content') || '').trim()
  };

  const jsonLd = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    const raw = (el.children || []).map((c) => c.data || '').join('');
    try { jsonLd.push(JSON.parse(raw)); } catch (e) { /* ignore broken JSON-LD */ }
  });
  const faqsLd = faqFromLd(jsonLd);

  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const h1Count = $('h1').length;
  const subtitle = $('h2').first().text().replace(/\s+/g, ' ').trim();

  let snapHref = '';
  let tocHref = '';
  $('a[href]').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (!snapHref && t === 'report snapshot') snapHref = absUrl($(el).attr('href'), baseUrl);
    if (!tocHref && /^table of contents?$/.test(t)) tocHref = absUrl($(el).attr('href'), baseUrl);
  });

  $('script, style, noscript, svg, iframe, template').remove();
  $('header, footer, nav').remove();

  const allLines = toLines($, $('body')[0], baseUrl);

  let container = null;
  const ov = $('h2, h3').filter((i, el) => /overview\s*$/i.test($(el).text().trim())).first();
  if (ov.length) {
    let node = ov.parent();
    while (node.length && node[0].type === 'tag' && node[0].name !== 'body') {
      if (/competitive landscape|research methodology|key companies/i.test(node.text())) { container = node; break; }
      node = node.parent();
    }
  }
  const root = container || $('body');
  let desc = container ? toLines($, root[0], baseUrl) : allLines.slice();
  const start = desc.findIndex((l) => /^#{1,4} .*overview$/i.test(l));
  if (start > 0) desc = desc.slice(start);
  const faqAt = desc.findIndex((l) => /^(#+ )?frequently asked questions\b/i.test(l));
  if (faqAt > 0) desc = desc.slice(0, faqAt);
  const endAt = desc.findIndex((l) => /^(#+ )?(author|reviewed by|related reports)$/i.test(l));
  if (endAt > 0) desc = desc.slice(0, endAt);
  const descriptionText = desc.join('\n');

  const faqsPage = faqFromLines(allLines);
  const faqs = faqsPage.length ? faqsPage : faqsLd;

  const images = [];
  const seenImg = new Set();
  root.find('img').each((i, el) => {
    const src = absUrl($(el).attr('src') || $(el).attr('data-src') || '', baseUrl);
    if (!src || seenImg.has(src) || !/\/uploads\/media\//i.test(src)) return;
    seenImg.add(src);
    images.push({ src, alt: String($(el).attr('alt') || '').trim(), standard: /research-methodology|why-kings-research/i.test(src) });
  });

  const lowerDesc = descriptionText.toLowerCase();
  const links = [];
  const seenLink = new Set();
  root.find('a[href]').each((i, el) => {
    const raw = String($(el).attr('href') || '').trim();
    if (!raw || raw[0] === '#' || /^(mailto|tel|javascript):/i.test(raw)) return;
    const href = absUrl(raw, baseUrl);
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !text || lowerDesc.indexOf(text.toLowerCase()) < 0) return;
    const key = href + '|' + text;
    if (seenLink.has(key)) return;
    seenLink.add(key);
    links.push({ href, text, internal: SITE_HOST.test(host(href)) });
  });

  const headings = desc.filter((l) => /^#{1,6} /.test(l)).map((l) => {
    const m = l.match(/^(#{1,6}) (.*)$/);
    return { level: m[1].length, text: m[2].trim() };
  });
  const info = allLines.filter((l) => /^(pages|base year|release|author|reviewed by|last updated)\s*:/i.test(l)).slice(0, 8);

  const tabs = await Promise.all([
    fetchTabAny(tabCandidates('snapshot', baseUrl, snapHref, target), 15000),
    fetchTabAny(tabCandidates('toc', baseUrl, tocHref, target), 30000)
  ]);

  return {
    url: target,
    finalUrl: baseUrl,
    status: main.status,
    redirected: main.redirected,
    preview: /\/preview\//.test(baseUrl) || /\/preview\//.test(target),
    meta,
    h1,
    h1Count,
    subtitle,
    info,
    headings,
    descriptionText: descriptionText.slice(0, 60000),
    descriptionFound: !!container || start >= 0,
    faqs,
    faqsLdCount: faqsLd.length,
    images,
    links: links.slice(0, 80),
    snapshot: tabs[0],
    toc: tabs[1]
  };
}

module.exports = { extract, fetchHtml };
