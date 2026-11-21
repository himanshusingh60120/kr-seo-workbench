'use strict';

// Checks whether URLs load (HEAD first, then GET when HEAD is refused).

const { UA, fetchWithTimeout, pool } = require('./http');

async function drain(r) {
  try { if (r && r.body && typeof r.body.cancel === 'function') await r.body.cancel(); } catch (e) { /* ignore */ }
}

async function checkUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { url, status: 0, ok: false, error: 'not an http(s) URL', finalUrl: url, redirected: false };
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
  try {
    let r = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow', headers }, 8000);
    await drain(r);
    if ([400, 403, 404, 405, 406, 429, 500, 501, 503].includes(r.status)) {
      r = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', headers }, 10000);
      await drain(r);
    }
    return { url, status: r.status, ok: r.status < 400, finalUrl: r.url || url, redirected: !!r.redirected };
  } catch (e) {
    return { url, status: 0, ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message, finalUrl: url, redirected: false };
  }
}

async function checkUrls(urls, limit) {
  return pool(urls || [], limit || 6, (u) => checkUrl(u));
}

module.exports = { checkUrl, checkUrls };
