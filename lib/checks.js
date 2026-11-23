'use strict';

// Deterministic checks (no AI): headline figures and CAGR maths, share-versus-value maths, house-style and
// spacing rules, keyword coverage, key companies list. These give the same result every time.
// Also here: the tests every AI finding must pass before it is shown (real() and grounded()), so that
// "no problem" notes, requests to double-check, and findings that quote text which is not on the page are dropped.

const MULT = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3 };

function amount(n, unit) {
  return parseFloat(String(n).replace(/,/g, '')) * (MULT[String(unit || '').toLowerCase()] || 1);
}

function norm(text) {
  return String(text || '').replace(/[\u2012\u2013\u2014\u2212]/g, '-').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function marketFigures(text) {
  const t = norm(text);
  const f = {};
  let m = t.match(/size (?:was valued at|is valued at|was estimated at|stood at|was|is)(?: valued at)? USD ([\d.,]+) (trillion|billion|million) in (\d{4})/i);
  if (m) f.base = { value: amount(m[1], m[2]), label: 'USD ' + m[1] + ' ' + m[2], year: Number(m[3]) };
  m = t.match(/(?:grow|increase|rise|expand) from USD ([\d.,]+) (trillion|billion|million) in (\d{4}) to USD ([\d.,]+) (trillion|billion|million) by (?:the end of )?(\d{4})[^.]{0,80}?CAGR of ([\d.]+) ?%/i);
  if (m) {
    f.start = { value: amount(m[1], m[2]), label: 'USD ' + m[1] + ' ' + m[2], year: Number(m[3]) };
    f.end = { value: amount(m[4], m[5]), label: 'USD ' + m[4] + ' ' + m[5], year: Number(m[6]) };
    f.cagr = parseFloat(m[7]);
  }
  m = t.match(/forecast period \((\d{4}) ?- ?(\d{4})\)/i);
  if (m) f.period = [Number(m[1]), Number(m[2])];
  else if (f.start && f.end) f.period = [f.start.year, f.end.year];
  return f;
}

function issue(severity, section, quote, problem, fix, category) {
  return { severity, section: section || '', quote: quote || '', problem, fix: fix || '', category: category || 'language' };
}

// A sentence about a region, a country or a segment gives a PART of the market, so its value and CAGR
// are never compared with the market total.
const PART_RE = /(region|america|europe|asia|pacific|africa|middle east|\bmea\b|china|india|u\.s\.|japan|germany|fastest|highest|segment|accounted for|share of)/i;
// A sentence that states a share as a percentage ("a share of 35.43%", "57.88% share", "accounted for 35%").
const SHARE_RE = /share of [\d.]+ ?%|[\d.]+ ?% (?:share|of the (?:global |total |overall )?market)|accounted for (?:a |an |approximately |around |about |nearly |over )?(?:\w+ ){0,3}(?:share of )?[\d.]+ ?%/i;

function usdLabel(v, unit) {
  const div = MULT[String(unit).toLowerCase()] || 1;
  return 'USD ' + (Math.round((v / div) * 10) / 10) + ' ' + String(unit).toLowerCase();
}

function figuresCheck(text) {
  const f = marketFigures(text);
  const issues = [];
  if (f.start && f.end && typeof f.cagr === 'number') {
    const years = f.end.year - f.start.year;
    if (years > 0 && f.start.value > 0) {
      const calc = (Math.pow(f.end.value / f.start.value, 1 / years) - 1) * 100;
      if (Math.abs(calc - f.cagr) > 0.15) {
        issues.push(issue('error', 'Market Overview', 'CAGR of ' + f.cagr + '%',
          'Stated CAGR ' + f.cagr + '% does not match the values: ' + f.start.label + ' (' + f.start.year + ') to ' + f.end.label + ' (' + f.end.year + ') gives ' + calc.toFixed(2) + '%.',
          'Recheck the forecast values or the CAGR (computed ' + calc.toFixed(2) + '%).', 'data'));
      }
    }
    if (f.base && f.base.year === f.start.year - 1 && f.base.value > 0) {
      const g = (f.start.value / f.base.value - 1) * 100;
      if (g < 0 || Math.abs(g - f.cagr) > Math.max(6, f.cagr * 0.6)) {
        issues.push(issue('check', 'Market Overview', f.base.label + ' in ' + f.base.year,
          'First-year growth ' + f.base.year + ' to ' + f.start.year + ' is ' + g.toFixed(2) + '% against a CAGR of ' + f.cagr + '%.',
          'Confirm the base-year and first forecast-year values are correct.', 'data'));
      }
    }
  }
  const t = norm(text);
  const sentences = t.split(/(?<=[.!?])\s+|\n+/);
  const refs = [f.base, f.start, f.end].filter(Boolean);
  sentences.forEach((s) => {
    // Share maths: "a share of 35.43% ... USD 830.6 million in 2023" must agree with the market total for that year.
    if (refs.length && !/\bCAGR\b/i.test(s) && SHARE_RE.test(s)) {
      const pcts = s.match(/[\d.]+ ?%/g) || [];
      const vals = s.match(/USD [\d.,]+ (?:trillion|billion|million)/gi) || [];
      const yr = s.match(/\b(?:19|20)\d{2}\b/);
      if (pcts.length === 1 && vals.length === 1 && yr) {
        const ref = refs.find((x) => x.year === Number(yr[0]));
        const vm = vals[0].match(/USD ([\d.,]+) (trillion|billion|million)/i);
        const pct = parseFloat(pcts[0]);
        const v = amount(vm[1], vm[2]);
        if (ref && pct > 0 && pct < 100 && v > 0 && v < ref.value) {
          const expected = ref.value * pct / 100;
          if (Math.abs(expected - v) / expected > 0.015) {
            issues.push(issue('error', '', vals[0],
              'The share and the value do not agree: ' + pct + '% of the ' + ref.year + ' market (' + ref.label + ') is ' + usdLabel(expected, vm[2]) + ', but the sentence gives ' + vals[0] + ', which is ' + (v / ref.value * 100).toFixed(2) + '%.',
              'Correct either the share (' + (v / ref.value * 100).toFixed(2) + '%) or the value (' + usdLabel(expected, vm[2]) + ').', 'data'));
          }
        }
      }
    }
    if (!/\bmarket\b/i.test(s) || PART_RE.test(s)) return;
    if (refs.length && /(market size|projected to (?:reach|grow)|expected to reach|valued at)/i.test(s)) {
      const re = /USD ([\d.,]+) (trillion|billion|million)(?: in| by(?: the end of)?) (\d{4})/gi;
      let mm;
      while ((mm = re.exec(s))) {
        const v = amount(mm[1], mm[2]);
        const y = Number(mm[3]);
        const ref = refs.find((x) => x.year === y);
        if (ref && Math.abs(v - ref.value) / ref.value > 0.0005) {
          issues.push(issue('error', '', mm[0], 'Market value for ' + y + ' is ' + mm[0].replace(/ (in|by).*$/i, '') + ' here but ' + ref.label + ' in the Overview.', 'Use ' + ref.label + ' everywhere.', 'data'));
        }
      }
    }
    if (typeof f.cagr === 'number') {
      const c = s.match(/CAGR of ([\d.]+) ?%/i);
      if (c && Math.abs(parseFloat(c[1]) - f.cagr) > 0.001) {
        issues.push(issue('error', '', c[0], 'Market CAGR is ' + c[1] + '% here but ' + f.cagr + '% in the Overview.', 'Use ' + f.cagr + '% consistently.', 'data'));
      }
    }
  });
  return { figures: f, issues: dedupe(issues) };
}

// House-style and spacing rules that can be checked exactly, without AI.
function lint(text) {
  const t = String(text || '');
  const out = [];
  let m;
  const maj = /majority share(?: of)? ([\d.]+) ?%/gi;
  while ((m = maj.exec(t))) {
    if (parseFloat(m[1]) <= 50) out.push(issue('error', '', m[0], '"Majority" means more than 50%, but the share is ' + m[1] + '%.', 'Replace "majority share" with "largest share".', 'data'));
  }
  const reg = /\b(Middle East and Africa|South and Central America)\b/g;
  while ((m = reg.exec(t))) out.push(issue('warning', '', m[0], 'House style: combined regions are written with "&".', 'Replace with "' + m[0].replace(' and ', ' & ') + '".'));
  const rest = /,[ \t]*Rest of ([A-Z][A-Za-z &]+)/g;
  while ((m = rest.exec(t))) out.push(issue('warning', '', m[0].trim(), 'Region lists end with "and Rest of ...".', 'Use ", and Rest of ' + m[1].trim() + '".'));
  const rep = /\b([A-Za-z]{2,})[ \t]+\1\b/gi;
  while ((m = rep.exec(t))) {
    if (!/^(that|had)$/i.test(m[1])) out.push(issue('error', '', m[0], 'Repeated word.', 'Remove the duplicate "' + m[1] + '".'));
  }
  const sp = /[A-Za-z0-9)\]][ \t]+[,;:](?=\s|$)|[A-Za-z)\]][ \t]+\.(?=\s|$)/g;
  while ((m = sp.exec(t))) out.push(issue('warning', '', m[0], 'Extra space before punctuation.', 'Remove the space before the punctuation mark.'));
  const dbl = /[A-Za-z,.)][ ]{2,}[A-Za-z(]/g;
  while ((m = dbl.exec(t))) out.push(issue('warning', '', m[0], 'Double space.', 'Use a single space.'));
  const stop = /\b([a-z]{3,})\.([A-Z][a-z]+)\b/g;
  while ((m = stop.exec(t))) out.push(issue('warning', '', m[0], 'Missing space after the full stop.', 'Write "' + m[1] + '. ' + m[2] + '".'));

  // Region names.
  if (/\bMEA\b/.test(t)) out.push(issue('warning', '', 'MEA', 'House style writes the region in full, not as "MEA".', 'Replace "MEA" with "Middle East & Africa".'));
  if (/\bAsia Pacific\b/.test(t) && /\bAsia-Pacific\b/.test(t)) out.push(issue('warning', '', 'Asia-Pacific', 'The region is written two ways in this text: "Asia Pacific" and "Asia-Pacific".', 'Use one form throughout.'));
  const us = /\bthe US\b/g;
  while ((m = us.exec(t))) out.push(issue('warning', '', m[0], 'House style writes the country as "U.S.".', 'Write "the U.S.".'));

  // The same abbreviation written with different capitals (for example "ARTS" and "ARTs").
  // "FAQS" is left out: the tool itself adds that label above the questions when it checks a page.
  const forms = new Map();
  (t.match(/\b[A-Za-z]{3,6}\b/g) || []).forEach((w) => {
    if ((w.match(/[A-Z]/g) || []).length < 2) return;
    const k = w.toLowerCase();
    if (k === 'faqs') return;
    if (!forms.has(k)) forms.set(k, new Set());
    forms.get(k).add(w);
  });
  forms.forEach((set) => {
    if (set.size < 2) return;
    const all = Array.from(set);
    out.push(issue('warning', '', all[1], 'The same abbreviation is written ' + all.length + ' ways: ' + all.join(', ') + '.', 'Use one form throughout.'));
  });

  // A paragraph that stops without a full stop.
  t.split('\n').forEach((line) => {
    const l = line.trim();
    if (l.length >= 90 && !/^[#\-\[|]/.test(l) && l.indexOf(' | ') < 0 && /[a-z0-9)]$/.test(l)) {
      out.push(issue('warning', '', l.slice(-70), 'The paragraph does not end with a full stop.', 'Add a full stop at the end.'));
    }
  });
  return dedupe(out).slice(0, 60);
}

function countPhrase(lower, phrase) {
  const k = String(phrase || '').toLowerCase().trim();
  if (!k) return 0;
  const variants = new Set([k]);
  if (/s$/.test(k)) variants.add(k.slice(0, -1)); else variants.add(k + 's');
  let total = 0;
  variants.forEach((v) => {
    const re = new RegExp('(^|[^a-z0-9])' + escapeRe(v) + '(?=[^a-z0-9]|$)', 'g');
    total += (lower.match(re) || []).length;
  });
  return total;
}

function coverage(text, primary, secondaries) {
  const lower = ' ' + String(text || '').toLowerCase().replace(/[\u2019]/g, "'").replace(/\s+/g, ' ') + ' ';
  const words = (String(text || '').match(/[A-Za-z0-9][A-Za-z0-9'&.-]*/g) || []).length;
  const rows = [];
  if (primary) {
    const c = countPhrase(lower, primary);
    const density = words ? (c * primary.split(/\s+/).length / words) * 100 : 0;
    rows.push({ keyword: primary, type: 'Primary', count: c, density: Math.round(density * 100) / 100 });
  }
  (secondaries || []).forEach((k) => {
    if (!k || (primary && k.toLowerCase() === primary.toLowerCase())) return;
    rows.push({ keyword: k, type: 'Secondary', count: countPhrase(lower, k), density: null });
  });
  return { words, rows, found: rows.filter((r) => r.count > 0).length, missing: rows.filter((r) => r.count === 0).length };
}

// The names under "List of Key Companies ...". The list ends at the next heading, including the
// "Key Industry Developments" / "Recent Developments" line that follows it.
function keyCompanies(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => /key (companies|players) in the/i.test(l) || /^#{1,4} .*key (companies|players)/i.test(l));
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k];
    if (!l) continue;
    if (/^#{1,6} /.test(l) || /^research methodology$/i.test(l) || /\?$/.test(l) || /\bdevelopments?\s*:?$/i.test(l)) break;
    const name = l.replace(/^- /, '').trim();
    if (!name || name.indexOf('[IMAGE') === 0) continue;
    if (name.length > 120) { if (out.length) break; continue; }
    out.push(name);
  }
  return out;
}

function dedupe(list) {
  const seen = new Set();
  return (list || []).filter((x) => {
    const k = (x.problem + '|' + x.quote).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- tests every AI finding must pass ----------
const NON_ISSUE_RE = /\b(?:is|are|seems|appears|looks)\s+(?:consistent|correct|accurate|fine|plausible|aligned|valid)\b|\bconsistent (?:with|across|throughout)\b|\bcompl(?:ies|ying) with\b|\baligns? with\b|\bmatches (?:exactly|the description|correctly)\b/i;
// Items in which the AI itself says the text is fine, whatever else the sentence contains:
// "... which is consistent, so no conflict here", "seems plausible but double-check ...", "numbers ok, but ...".
const ALWAYS_OK_RE = /\bso ok\b|\bis ok\b|\bnumbers? (?:are )?ok\b|\b(?:is|are|seems?) (?:acceptable|plausible)\b|\bno (?:action|change)s? (?:is |are )?(?:needed|required)\b|\bno (?:conflicts?|issues?|errors?|problems?|discrepanc(?:y|ies)|mismatch(?:es)?|inconsistenc(?:y|ies)|contradictions?)\b|\bwhich is (?:consistent|correct|accurate)\b|\b(?:is|are) (?:consistent|correct|accurate)[,;]? so\b|\bnot (?:a|an) (?:conflict|issue|error|problem|discrepancy|mismatch)\b/i;
const PROBLEM_RE = /\b(?:but|however|mismatch\w*|differ\w*|contradict\w*|conflicts? with|missing|incorrect|wrong|instead of|typo\w*|misspel\w*|duplicat\w*|does not match|doesn't match|inconsistent\w*)\b/i;
const VAGUE_RE = /^(?:please\s+)?(?:confirm|check|verify|ensure|need(?:s)? (?:confirmation|to (?:be )?(?:confirm|check|verif)))/i;
// "Double-check ..." and "check whether ..." without a definite mismatch are requests, not findings.
const ASK_RE = /\bdouble-?check\b|\bcheck whether\b|\bensure (?:that )?(?:the |all )?\w+ (?:is|are) (?:consistent|uniform|correct)/i;
const HARD_RE = /\b(?:mismatch\w*|differ\w*|contradict\w*|conflict\w*|incorrect|wrong|instead of|typo\w*|misspel\w*|duplicat\w*|does not match|doesn't match|missing|extra|lacks?)\b/i;
// A fix that only asks the reader to look again.
const SOFT_FIX_RE = /^(?:please\s+)?(?:double-?check|verify|confirm|ensure|review|recheck)\b/i;
// "This figure is not mentioned anywhere else" is not a conflict.
const NOT_ELSEWHERE_RE = /\bnot (?:supported|mentioned|given|stated|provided)\b[^.]{0,60}\b(?:elsewhere|anywhere else|in the (?:description|main text|report))\b/i;
// Advice about wording is not an error.
const TASTE_RE = /\bconsider (?:variety|using|rephras|replac)|\bfor variety\b|\bsynonym\b/i;
// A fix that says nothing needs to change.
const NO_FIX_RE = /^(?:none|n\/a|no (?:change|fix|action)s?(?: (?:is |are )?(?:needed|required))?|not (?:needed|required|applicable))\.?$/i;

function isNonIssue(x) {
  const t = String((x && (x.problem || x.issue)) || '').trim();
  if (!t) return true;
  if (ALWAYS_OK_RE.test(t)) return true;
  if (/rest of north america/i.test(t)) return true;
  if (VAGUE_RE.test(t) && !PROBLEM_RE.test(t)) return true;
  if (ASK_RE.test(t) && !HARD_RE.test(t)) return true;
  if (/should be (?:verified|checked|confirmed)/i.test(t) && !/\b(?:mismatch\w*|differ\w*|contradict\w*|incorrect|wrong)\b/i.test(t)) return true;
  return NON_ISSUE_RE.test(t) && !PROBLEM_RE.test(t);
}

// Text reduced to lower-case letters, digits, % and dots, so quotes can be compared whatever the spacing or quote marks.
function plain(s) { return norm(s).toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// A real finding changes the text, states a definite problem, and is not a matter of taste.
function real(list) {
  return (list || []).filter((x) => {
    const problem = String(x.problem || '');
    const fix = String(x.fix || '').trim();
    if (x.quote && fix && plain(x.quote) === plain(fix)) return false;
    if (NO_FIX_RE.test(fix)) return false;
    if (NOT_ELSEWHERE_RE.test(problem)) return false;
    if (SOFT_FIX_RE.test(fix) && !HARD_RE.test(problem)) return false;
    if (TASTE_RE.test(problem + ' ' + fix) && !HARD_RE.test(problem)) return false;
    return true;
  });
}

// The quoted text must really be in the source. The AI sometimes "quotes" words that are not there (an invented
// typo, a reworded sentence); such findings are dropped. Very short quotes cannot be judged and stay.
function grounded(list, sourceText) {
  const src = plain(sourceText);
  return (list || []).filter((x) => {
    const pieces = String(x.quote || '').split(/\.{3,}|\u2026/).map((p) => plain(p).replace(/^[.\s]+|[.\s]+$/g, '')).filter((p) => p.length >= 8);
    if (!pieces.length) return true;
    return pieces.every((p) => src.indexOf(p.slice(0, 120)) >= 0);
  });
}

function normIssues(arr, fallbackSection) {
  return real((Array.isArray(arr) ? arr : []).filter((x) => x && (x.problem || x.issue)).filter((x) => !isNonIssue(x)).map((x) => {
    const sev = String(x.severity || '').toLowerCase();
    return {
      severity: ['error', 'warning', 'check'].indexOf(sev) >= 0 ? sev : 'warning',
      section: String(x.section || fallbackSection || ''),
      quote: String(x.quote || '').slice(0, 400),
      problem: String(x.problem || x.issue || ''),
      fix: String(x.fix || x.suggestion || '')
    };
  }));
}

function strip(list) {
  return (list || []).map((x) => ({ severity: x.severity, section: x.section, quote: x.quote, problem: x.problem, fix: x.fix }));
}

function result(issues, extra) {
  const list = strip(dedupe(issues || []));
  return Object.assign({ status: list.length ? 'Issues' : 'OK', issues: list }, extra || {});
}

function faqText(faqs) {
  return (faqs || []).map((f, i) => 'Q' + (i + 1) + ': ' + f.q + '\nA' + (i + 1) + ': ' + f.a).join('\n\n') || '(no FAQs found)';
}

module.exports = { marketFigures, figuresCheck, lint, coverage, keyCompanies, dedupe, normIssues, isNonIssue, real, grounded, plain, strip, result, faqText, norm };
