'use strict';

// Reads the pages that rank in Google's top 10 and returns their outline: title, meta description,
// headings (H1-H3) and opening text. Used to suggest more secondary keywords.

const cheerio = require('cheerio');
const { UA, fetchWithTimeout, pool } = require('./http');

async function outline(url) {
  try {
    const r = await fetchWithTimeout(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }
    }, 9000);
    if (r.status >= 400) return { url, ok: false, error: 'HTTP ' + r.status };
    const type = String(r.headers.get('content-type') || '');
    if (type && type.indexOf('html') < 0) return { url, ok: false, error: 'not an HTML page' };
    const html = await r.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, template, nav, footer, form').remove();
    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const description = String($('meta[name="description"]').attr('content') || '').replace(/\s+/g, ' ').trim();
    const headings = [];
    $('h1, h2, h3').each((i, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length <= 200 && headings.length < 60 && headings.indexOf(t) < 0) headings.push(t);
    });
    const main = $('main').first();
    const text = (main.length ? main.text() : $('body').text()).replace(/\s+/g, ' ').trim();
    return { url: r.url || url, ok: true, title, description, headings, excerpt: text.slice(0, 1500) };
  } catch (e) {
    return { url, ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

async function outlines(urls) {
  return pool((urls || []).slice(0, 10), 5, (u) => outline(u));
}

module.exports = { outline, outlines };
