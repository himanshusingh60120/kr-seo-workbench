'use strict';

// OpenAI helpers: JSON chat completions (text + vision) and web-search verification (Responses API).

const { HttpError, fetchWithTimeout } = require('./http');

const BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';

function model(kind) {
  if (kind === 'vision') return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  if (kind === 'search') return process.env.OPENAI_SEARCH_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function apiKey() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new HttpError(500, 'OPENAI_API_KEY is not set in Vercel.');
  return k;
}

function parseJsonLoose(text) {
  if (!text) return {};
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* fall through */ }
  }
  return { _raw: t };
}

async function post(path, body, ms) {
  let r;
  try {
    r = await fetchWithTimeout(BASE + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, ms || 55000);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, e.name === 'AbortError' ? 'OpenAI took too long to respond. Try again, or check a shorter piece of content.' : 'OpenAI request failed: ' + e.message);
  }
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  return { ok: r.ok, status: r.status, json: j, error: (j.error && j.error.message) || (r.ok ? '' : 'HTTP ' + r.status) };
}

// Returns a parsed JSON object. The prompt must ask for JSON.
// The checks must give the same result when the same page is checked twice, so the model is asked for its most
// likely answer every time (temperature 0, fixed seed) instead of a varied one. Only the gpt-4 family accepts
// these settings, so they are left out for other models.
async function chatJSON(opts) {
  const images = (opts.images || []).filter(Boolean);
  const content = images.length
    ? [{ type: 'text', text: opts.user }].concat(images.map((u) => ({ type: 'image_url', image_url: { url: u, detail: 'high' } })))
    : opts.user;
  const name = model(images.length ? 'vision' : opts.kind);
  const body = {
    model: name,
    messages: [{ role: 'system', content: opts.system }, { role: 'user', content }],
    response_format: { type: 'json_object' }
  };
  if (/^gpt-4/i.test(name)) {
    body.temperature = 0;
    body.seed = 7;
  }
  const res = await post('/chat/completions', body);
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, 'OpenAI rate limit: ' + res.error, { retryAfter: 20 });
    throw new HttpError(502, 'OpenAI: ' + res.error);
  }
  const msg = res.json.choices && res.json.choices[0] && res.json.choices[0].message;
  return parseJsonLoose(msg && msg.content);
}

function readResponses(j) {
  let text = '';
  const citations = [];
  (j.output || []).forEach((item) => {
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      item.content.forEach((c) => {
        if (c && (c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') {
          text += c.text;
          (c.annotations || []).forEach((a) => {
            if (a && a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title || '' });
          });
        }
      });
    }
  });
  if (!text && typeof j.output_text === 'string') text = j.output_text;
  return { text, citations };
}

// Web-search backed JSON answer. Falls back to model knowledge if web search is unavailable.
async function webSearchJSON(opts) {
  const disabled = String(process.env.OPENAI_WEB_SEARCH || 'true').toLowerCase() === 'false';
  let lastError = disabled ? 'Web search disabled (OPENAI_WEB_SEARCH=false)' : '';
  if (!disabled) {
    for (const toolType of ['web_search', 'web_search_preview']) {
      const res = await post('/responses', {
        model: model('search'),
        instructions: opts.instructions,
        input: opts.input,
        tools: [{ type: toolType }]
      });
      if (res.ok) {
        const out = readResponses(res.json);
        return { data: parseJsonLoose(out.text), citations: out.citations, searched: true, searchError: '' };
      }
      lastError = res.error;
      if (res.status === 429) throw new HttpError(429, 'OpenAI rate limit: ' + res.error, { retryAfter: 20 });
      if (res.status !== 400 && res.status !== 404) break;
    }
  }
  const data = await chatJSON({
    system: opts.instructions,
    user: opts.input + '\n\nWeb search is not available: judge from your own knowledge only, leave source_url empty unless you are certain of an official URL, and use "Unverifiable" whenever you are not sure.'
  });
  return { data, citations: [], searched: false, searchError: lastError };
}

module.exports = { chatJSON, webSearchJSON, parseJsonLoose };
