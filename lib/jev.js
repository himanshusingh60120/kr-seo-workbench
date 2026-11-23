'use strict';

// Jev (TypeSafe AI) decision model. It answers yes/no and multiple-choice questions about a piece of text
// and returns a probability for each answer. It cannot search the web and it cannot write text.
// Two ways to reach it (set ONE of these in Vercel):
//   TYPESAFE_API_KEY   -> https://api.typesafe.ai/v1/systemone     (key from console.typesafe.ai)
//   AI_GATEWAY_API_KEY -> https://ai-gateway.vercel.sh/v1/decisions (key from Vercel AI Gateway)
// Every successful call is counted for the API credit counter (JEV_PRICE_PER_CALL sets an optional cost per call).

const { HttpError, fetchWithTimeout, track } = require('./http');

function mode() {
  if (process.env.TYPESAFE_API_KEY) return 'typesafe';
  if (process.env.AI_GATEWAY_API_KEY) return 'gateway';
  return '';
}

function configured() { return !!mode(); }

function pricePerCall() {
  const n = Number(process.env.JEV_PRICE_PER_CALL);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function post(url, key, body) {
  let r;
  try {
    r = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 25000);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, e.name === 'AbortError' ? 'Jev took too long to respond.' : 'Jev request failed: ' + e.message);
  }
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
  if (!r.ok) {
    let msg = (j.error && (j.error.message || j.error)) || j.message || j.detail || text.slice(0, 200) || ('HTTP ' + r.status);
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
    if (r.status === 401 || r.status === 403) throw new HttpError(502, 'Jev: the API key was rejected (' + msg + ').');
    if (r.status === 429) throw new HttpError(429, 'Jev rate limit: ' + msg, { retryAfter: 10 });
    throw new HttpError(502, 'Jev: ' + msg);
  }
  track({ jevCalls: 1, jevCost: pricePerCall() });
  return j;
}

function stateText(state) {
  const s = typeof state === 'string' ? state : JSON.stringify(state);
  return s.length > 60000 ? s.slice(0, 60000) : s;
}

// questions: { id: { type: 'choice', instructions, options: { name: 'description' } } | { type: 'yesno', instructions } }
// returns:   { id: { type: 'choice', choice, probabilities: { name: 0..1 } } | { type: 'yesno', probability: 0..1 } }
async function decide(state, questions) {
  const m = mode();
  if (!m) throw new HttpError(500, 'Jev is not configured: set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY in Vercel.');
  const ids = Object.keys(questions || {});
  if (!ids.length) return {};
  const text = stateText(state);
  const out = {};

  if (m === 'typesafe') {
    const qs = {};
    ids.forEach((id) => {
      const q = questions[id];
      qs[id] = q.type === 'choice'
        ? { type: 'choice', instructions: q.instructions, criteria: q.options }
        : { type: 'noul', instructions: q.instructions };
    });
    const j = await post('https://api.typesafe.ai/v1/systemone', process.env.TYPESAFE_API_KEY, {
      state: text,
      model: process.env.JEV_MODEL || 'jev-latest',
      questions: qs
    });
    const answers = j.answers || {};
    ids.forEach((id) => {
      const a = answers[id];
      if (!a) return;
      if (questions[id].type === 'choice') out[id] = { type: 'choice', choice: String(a.choice || ''), probabilities: a.probabilities || {} };
      else out[id] = { type: 'yesno', probability: Number(a.noul !== undefined ? a.noul : a.probability) || 0 };
    });
    return out;
  }

  const list = ids.map((id) => {
    const q = questions[id];
    if (q.type === 'choice') {
      return {
        type: 'choice',
        name: id,
        instructions: q.instructions,
        choices: Object.keys(q.options).map((k) => ({ value: k, description: q.options[k] }))
      };
    }
    return { type: 'predicate', name: id, instructions: q.instructions };
  });
  const j = await post('https://ai-gateway.vercel.sh/v1/decisions', process.env.AI_GATEWAY_API_KEY, {
    model: process.env.JEV_GATEWAY_MODEL || 'typesafe-ai/jev',
    input: text,
    questions: list
  });
  (Array.isArray(j.answers) ? j.answers : []).forEach((a) => {
    if (!a || !Object.prototype.hasOwnProperty.call(questions, a.name)) return;
    if (questions[a.name].type === 'choice') out[a.name] = { type: 'choice', choice: String(a.choice || ''), probabilities: a.probabilities || {} };
    else out[a.name] = { type: 'yesno', probability: Number(a.probability) || 0 };
  });
  return out;
}

// Probability that a choice answer gives to one option (0 when the answer is missing).
function optionProb(answer, option) {
  if (!answer) return 0;
  const p = answer.probabilities && answer.probabilities[option];
  if (typeof p === 'number') return p;
  return answer.choice === option ? 1 : 0;
}

module.exports = { configured, mode, decide, optionProb };
