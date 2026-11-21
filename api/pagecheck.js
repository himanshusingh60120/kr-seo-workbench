'use strict';

// Publish Check (preview URL) and Live Check (live URL): extract the page, run each check, save to the sheet.
// The browser calls "extract" once, then each "check" kind in parallel (each fits in one function call), then "save".
// Report Snapshot and Table of Contents are checked only in Live Check (the browser skips them for preview pages).
// Every AI finding is tested before it is shown: its quote must really be on the page, its fix must change
// something, and it must state a definite problem (see grounded() and real() below).

const { handler, HttpError, nowIST, hostOf, isCompetitor } = require('../lib/http');
const page = require('../lib/page');
const checks = require('../lib/checks');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');
const { checkUrls } = require('../lib/linkcheck');

function requirePage(pg) {
  if (!pg || typeof pg !== 'object' || typeof pg.descriptionText !== 'string') throw new HttpError(400, 'Run "extract" first and send the page data.');
  return pg;
}

function issue(severity, section, problem, fix, quote) {
  return { severity, section, quote: quote || '', problem, fix: fix || '' };
}

function lowerNorm(s) { return checks.norm(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// ---------- tests every AI finding must pass ----------
// Text reduced to lower-case letters, digits, % and dots, so quotes can be compared whatever the spacing or quote marks.
function plain(s) { return checks.norm(s).toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\s+/g, ' ').trim(); }

// The quoted text must really be in the source. The AI sometimes "quotes" words that are not on the page
// (an invented typo, a reworded sentence); such findings are dropped. Very short quotes cannot be judged and stay.
function inSource(quote, src) {
  const pieces = String(quote || '').split(/\.{3,}|\u2026/).map((p) => plain(p).replace(/^[.\s]+|[.\s]+$/g, '')).filter((p) => p.length >= 8);
  if (!pieces.length) return true;
  return pieces.every((p) => src.indexOf(p.slice(0, 120)) >= 0);
}

function grounded(list, sourceText) {
  const src = plain(sourceText);
  return (list || []).filter((x) => inSource(x.quote, src));
}

const SOFT_FIX_RE = /^(?:please\s+)?(?:double-?check|verify|confirm|ensure|review|recheck)\b/i;
const HARD_RE = /\b(?:mismatch\w*|differ\w*|contradict\w*|conflict\w*|incorrect|wrong|instead of|typo\w*|misspel\w*|duplicat\w*|does not match|doesn't match|missing|extra)\b/i;
const NOT_ELSEWHERE_RE = /\bnot (?:supported|mentioned|given|stated|provided)\b[^.]{0,60}\b(?:elsewhere|anywhere else|in the (?:description|main text|report))\b/i;

// A real finding changes the text, states a definite problem, and is not just "this figure appears only once".
function real(list) {
  return (list || []).filter((x) => {
    if (x.quote && x.fix && plain(x.quote) === plain(x.fix)) return false;
    if (NOT_ELSEWHERE_RE.test(x.problem)) return false;
    if (SOFT_FIX_RE.test(x.fix || '') && !HARD_RE.test(x.problem)) return false;
    return true;
  });
}

// The key companies list ends where the developments heading starts.
function companyNames(pg) {
  return checks.keyCompanies(pg.descriptionText).filter((c) => !/\bdevelopments?\s*:?$/i.test(c));
}

// The infographic check needs the page's figures, which sit all through the description (regional values come
// near the end). This keeps the opening text and every later sentence that holds a figure.
function figuresDigest(text) {
  const t = String(text || '');
  if (t.length <= 8500) return t;
  const rest = t.slice(3000).split(/(?<=[.!?])\s+|\n+/).filter((s) => /\d/.test(s) && /(USD|\$|%|million|billion|CAGR)/i.test(s));
  return (t.slice(0, 3000) + '\n...\nOther sentences with figures:\n' + rest.join('\n')).slice(0, 8800);
}

// Infographic: masked values (XX.X%) are intentional and numbers the content does not mention are fine.
const IMAGE_SKIP_RE = /\b(?:font|bold|styl\w*|layout|clarity|clarif\w*|label\w*|unspecified|does not specify|not specified|placeholder\w*|masked|uncorroborated|unsupported)\b|\bnot (?:given|mentioned|stated|specified|included|present|provided|confirmed|verifiable) in the description\b|\bnot in the description\b|\bdoes not (?:provide|give|mention|state|include)\b|\bnot (?:mentioned|supported|given|stated)\b[^.]{0,40}\bdescription\b|\bcannot be verified\b|\bnot verifiable\b|\bshould be verified\b|\bseems unusually\b|\bno contradictory\b|\bmay create confusion\b|\b[x]{1,3}(?:[.,][x]{1,3})?\s?%|\$\s?x{1,3}/i;
const TOC_SKIP_RE = /compan(?:y|ies)|key players?|table of contents?["'\s]*(?:heading|label|title)|["']table of content["']/i;
// Labels of the website's own tabs are not part of the report text.
const NAV_LABEL_RE = /^(?:table of contents?|report snapshot|description)$/;

const KINDS = {
  async data(pg) {
    const det = checks.figuresCheck(pg.descriptionText);
    const lintData = checks.lint(pg.descriptionText).filter((i) => i.category === 'data');
    const out = await ai.chatJSON({ system: P.qcSystem(), user: P.dataTask(pg, det.figures) });
    const found = grounded(real(checks.normIssues(out.issues, 'Description')), pg.descriptionText + '\n' + checks.faqText(pg.faqs));
    return checks.result(det.issues.concat(lintData, found), { figures: det.figures });
  },

  async faq(pg) {
    const issues = [];
    const companies = companyNames(pg);
    const faqs = pg.faqs || [];
    if (!faqs.length) {
      issues.push(issue('warning', 'FAQs', 'No FAQs were found on the page.', 'Add the standard FAQs (growth, drivers, key players, challenges, fastest-growing region, opportunities).'));
      return checks.result(issues, { companies });
    }
    const kp = faqs.find((f) => /key (players|companies)|major (players|companies)|leading (players|companies)/i.test(f.q));
    if (companies.length && kp) {
      companies.forEach((c) => {
        if (kp.a.indexOf(c) < 0) issues.push(issue('error', 'FAQ: key players', '"' + c + '" is in the key companies list but missing, or named differently, in the FAQ key players answer.', 'Use the exact name "' + c + '" in the FAQ answer.', c));
      });
    }
    const out = await ai.chatJSON({ system: P.qcSystem(), user: P.faqTask(pg, companies) });
    const desc = lowerNorm(pg.descriptionText);
    // An FAQ answer that repeats the description word for word cannot contradict it.
    const ai2 = grounded(real(checks.normIssues(out.issues, 'FAQs')), checks.faqText(faqs) + '\n' + pg.descriptionText).filter((x) => {
      const q = lowerNorm(x.quote);
      return !(q.length > 40 && desc.indexOf(q.slice(0, 220)) >= 0 && /conflict|mismatch|differ|instead|incorrect|inconsistent|contradict|mix/i.test(x.problem));
    });
    return checks.result(issues.concat(ai2), { companies, faqCount: faqs.length });
  },

  async language(pg) {
    const text = pg.descriptionText + '\n\nFAQS:\n' + checks.faqText(pg.faqs);
    const lint = checks.lint(text).filter((i) => i.category !== 'data');
    const out = await ai.chatJSON({ system: P.qcSystem(), user: P.languageTask(text) });
    const found = grounded(real(checks.normIssues(out.issues, 'Description')), text).filter((x) => !NAV_LABEL_RE.test(plain(x.quote)));
    return checks.result(lint.concat(found));
  },

  async image(pg) {
    const issues = [];
    const h1 = String(pg.h1 || '').trim();
    const content = (pg.images || []).filter((i) => !i.standard && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(i.src));
    (pg.images || []).forEach((img) => {
      if (!img.alt) issues.push(issue(img.standard ? 'warning' : 'error', 'Image alt text', 'Image has no alt text: ' + img.src, img.standard ? 'Add a short descriptive alt text.' : 'Add alt "' + h1 + ' Size & Share, By Revenue, <forecast period>".'));
    });
    if (!content.length) {
      issues.push(issue('error', 'Infographic', 'No infographic image was found in the description.', 'Add the market infographic below the Overview section.'));
      return checks.result(issues, { images: [] });
    }
    const figures = checks.marketFigures(pg.descriptionText);
    const forImage = Object.assign({}, pg, { descriptionText: figuresDigest(pg.descriptionText) });
    const transcripts = [];
    for (const img of content.slice(0, 2)) {
      if (img.alt && h1 && img.alt.toLowerCase().indexOf(h1.toLowerCase()) < 0) issues.push(issue('warning', 'Image alt text', 'Alt text "' + img.alt + '" does not contain the market name "' + h1 + '".', 'Use "' + h1 + ' Size & Share, By Revenue, ' + (figures.period ? figures.period.join('-') : '<forecast period>') + '".', img.alt));
      try {
        const out = await ai.chatJSON({ system: P.qcSystem(), user: P.imageTask(forImage, figures, img.alt), images: [img.src] });
        transcripts.push({ src: img.src, alt: img.alt, text: String(out.transcription || '') });
        real(checks.normIssues(out.issues, 'Infographic'))
          .filter((x) => !IMAGE_SKIP_RE.test(x.problem + ' ' + x.quote + ' ' + x.fix))
          .forEach((x) => issues.push(Object.assign({}, x, { severity: x.severity === 'warning' ? 'check' : x.severity })));
      } catch (e) {
        issues.push(issue('check', 'Infographic', 'The image could not be read automatically (' + e.message + '): ' + img.src, 'Check the infographic manually.'));
      }
    }
    return checks.result(issues, { images: transcripts });
  },

  async meta(pg) {
    const issues = [];
    const m = pg.meta || {};
    const kw = String(pg.h1 || '').trim();
    const kwl = kw.toLowerCase();
    const add = (severity, problem, fix, quote) => issues.push(issue(severity, 'Meta & SEO', problem, fix, quote));
    if (!m.title) add('error', 'Meta title is missing.', 'Add a 50-60 character meta title that starts with the market name.');
    else {
      if (m.title.length > 60) add('warning', 'Meta title is ' + m.title.length + ' characters (over 60) and may be cut off in Google.', 'Shorten it to 50-60 characters.', m.title);
      if (m.title.length < 30) add('check', 'Meta title is only ' + m.title.length + ' characters.', 'Use 50-60 characters with the market name and end year.', m.title);
      if (kwl && m.title.toLowerCase().indexOf(kwl) < 0) add('warning', 'Meta title does not contain the H1 "' + kw + '".', 'Start the title with "' + kw + '".', m.title);
    }
    if (!m.description) add('error', 'Meta description is missing.', 'Add a 140-160 character description with the market size and CAGR.');
    else {
      if (m.description.length > 160) add('warning', 'Meta description is ' + m.description.length + ' characters (over 160).', 'Trim it to 140-160 characters.', m.description);
      if (m.description.length < 70) add('check', 'Meta description is only ' + m.description.length + ' characters.', 'Use 140-160 characters with the market size and CAGR.', m.description);
      if (kwl && m.description.toLowerCase().indexOf(kwl) < 0) add('warning', 'Meta description does not mention the market name.', 'Include "' + kwl + '".', m.description);
      const desc = checks.norm(pg.descriptionText).toLowerCase();
      (m.description.match(/USD [\d.,]+ (?:trillion|billion|million)|[\d.]+ ?%/gi) || []).forEach((tok) => {
        if (desc.indexOf(checks.norm(tok).toLowerCase()) < 0) add('error', 'Meta description figure "' + tok + '" does not appear in the report description.', 'Update the meta description to match the Overview figures.', m.description);
      });
    }
    if (!kw) add('error', 'No H1 found on the page.', 'Add the market name as the H1.');
    if (pg.h1Count > 1) add('warning', 'The page has ' + pg.h1Count + ' H1 tags.', 'Keep a single H1.');
    const headings = pg.headings || [];
    const ov = headings.find((h) => /overview$/i.test(h.text));
    if (pg.descriptionFound && !ov) add('warning', 'No "<Market> Overview" heading found in the description.', 'Add an H2 "' + kw + ' Overview".');
    else if (ov) {
      if (ov.level !== 2) add('warning', 'The Overview heading is H' + ov.level + ', not H2.', 'Make "' + ov.text + '" an H2.', ov.text);
      if (kwl && ov.text.toLowerCase().indexOf(kwl) < 0) add('warning', 'Overview heading "' + ov.text + '" does not include the market name.', 'Rename it "' + kw + ' Overview".', ov.text);
    }
    if (pg.descriptionFound && !headings.some((h) => h.level === 2)) add('error', 'The description has no H2 headings.', 'Use H2 for main sections and H3 for the questions.');
    if (pg.descriptionFound && !headings.some((h) => h.level === 3)) add('warning', 'The description has no H3 headings.', 'Use H3 for the question headings under each section.');
    if (!m.canonical) add('warning', 'Canonical tag is missing.', 'Add a canonical pointing to the live /report/ URL.');
    else if (/\/preview\//.test(m.canonical)) add('error', 'Canonical points to a preview URL: ' + m.canonical, 'The canonical must be the live /report/ URL.');
    if (!pg.preview && /noindex/i.test(m.robots || '')) add('error', 'Live page has robots "' + m.robots + '".', 'Remove noindex so the page can rank.');
    if (pg.faqsLdCount && (pg.faqs || []).length && pg.faqsLdCount !== pg.faqs.length) add('check', 'FAQ schema has ' + pg.faqsLdCount + ' questions but ' + pg.faqs.length + ' are visible.', 'Keep the FAQ schema in sync with the visible FAQs.');
    return checks.result(issues, { meta: m });
  },

  async links(pg) {
    const uniq = [];
    const seen = new Set();
    (pg.links || []).forEach((l) => { if (l && l.href && !seen.has(l.href)) { seen.add(l.href); uniq.push(l); } });
    const list = uniq.slice(0, 40);
    const res = await checkUrls(list.map((l) => l.href), 8);
    const issues = [];
    list.forEach((l, i) => {
      const r = res[i] || {};
      const h = hostOf(l.href);
      if (isCompetitor(l.href)) issues.push(issue('error', 'Links', 'Links to a competitor site (' + h + ').', 'Replace it with a primary source (regulator, company press release, government data).', l.text));
      if (/^http:\/\//i.test(l.href)) issues.push(issue('warning', 'Links', 'Insecure http:// link: ' + l.href, 'Use the https:// version.', l.text));
      if (l.internal && /\/preview\//.test(l.href)) issues.push(issue('error', 'Links', 'Link points to a preview URL: ' + l.href, 'Link to the live page instead.', l.text));
      if (String(l.text || '').trim().length < 3) issues.push(issue('warning', 'Links', 'Anchor text "' + l.text + '" is too short (link: ' + l.href + ').', 'Put the link on a descriptive phrase, such as the organization name.', l.text));
      if (!r.ok) {
        const blocked = [401, 403, 405, 429, 999].indexOf(r.status) >= 0;
        issues.push(issue(blocked ? 'check' : 'error', 'Links',
          blocked ? 'Link returned HTTP ' + r.status + ' (the site may block automated checks): ' + l.href : 'Broken link (' + (r.status || r.error || 'no response') + '): ' + l.href,
          blocked ? 'Open the link manually to confirm it works.' : 'Replace it with a working source URL.', l.text));
      } else if (r.redirected && hostOf(r.finalUrl) && hostOf(r.finalUrl) !== h) {
        issues.push(issue('check', 'Links', 'Link redirects to another site: ' + l.href + ' -> ' + r.finalUrl, 'Confirm the destination still supports the claim and link the final URL.', l.text));
      }
    });
    if (!list.length) issues.push(issue('check', 'Links', 'No links were found in the description.', 'Add source links for statistics, regulations and company developments, plus internal links to related reports.'));
    return checks.result(issues, { checked: list.length, links: list.map((l, i) => ({ href: l.href, text: l.text, internal: l.internal, status: (res[i] || {}).status, ok: !!(res[i] || {}).ok })) });
  },

  async snapshot(pg) {
    const s = pg.snapshot || {};
    if (!s.text) return checks.result([issue('check', 'Report Snapshot', 'The Report Snapshot tab could not be read' + (s.error ? ' (' + s.error + ')' : '') + '.', 'Open the Snapshot tab and confirm it loads.')], { url: s.url || '' });
    const figures = checks.marketFigures(pg.descriptionText);
    const out = await ai.chatJSON({ system: P.qcSystem(), user: P.snapshotTask(pg, figures) });
    // A snapshot finding must quote the snapshot itself.
    return checks.result(grounded(real(checks.normIssues(out.issues, 'Report Snapshot')), s.text), { url: s.url });
  },

  async toc(pg) {
    const t = pg.toc || {};
    if (!t.text) return checks.result([issue('check', 'Table of Contents', 'The Table of Contents tab could not be read' + (t.error ? ' (' + t.error + ')' : '') + '.', 'Open the TOC tab and confirm it loads.')], { url: t.url || '' });
    const figures = checks.marketFigures(pg.descriptionText);
    const out = await ai.chatJSON({ system: P.qcSystem(), user: P.tocTask(pg, figures) });
    // A TOC finding must quote the TOC itself; findings that quote the description belong to the other checks.
    const list = grounded(real(checks.normIssues(out.issues, 'Table of Contents')), t.text).filter((x) => !TOC_SKIP_RE.test(x.problem + ' ' + x.quote));
    return checks.result(list, { url: t.url });
  }
};

const COLUMNS = {
  data: 'Data Consistency', facts: 'Facts', faq: 'FAQs', image: 'Image', language: 'Spelling & Grammar',
  meta: 'Meta & SEO', links: 'Links', snapshot: 'Snapshot', toc: 'TOC'
};

function summarize(r) {
  if (!r) return 'Not run';
  if (r.status === 'Skipped') return r.note || 'Skipped';
  if (r.error) return 'ERROR: ' + r.error;
  const list = r.issues || [];
  if (!list.length) return 'OK';
  return list.map((x, i) => (i + 1) + '. [' + x.severity + '] ' + (x.section ? x.section + ': ' : '') + x.problem + (x.fix ? ' -> ' + x.fix : '') + (x.quote ? ' | "' + x.quote + '"' : '')).join('\n');
}

function normUrl(u) {
  return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/(preview\/)?(report|snapshot|toc)\//, '/').replace(/\/+$/, '');
}

module.exports = handler({
  async extract(b) {
    return page.extract(b.url);
  },

  async check(b) {
    const kind = String(b.kind || '');
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new HttpError(400, 'Unknown check "' + kind + '".');
    return KINDS[kind](requirePage(b.page));
  },

  async save(b, req) {
    const mode = b.mode === 'live' ? 'live' : 'publish';
    const results = b.results || {};
    let total = 0;
    let errors = 0;
    let warnings = 0;
    const row = {
      'Checked At': nowIST(),
      'URL': String(b.url || ''),
      'Report Name': String(b.reportName || ''),
      'Checked By': String((req && req.user) || b.user || '')
    };
    Object.keys(COLUMNS).forEach((k) => {
      const r = results[k];
      row[COLUMNS[k]] = summarize(r);
      (r && r.issues ? r.issues : []).forEach((x) => {
        total++;
        if (x.severity === 'error') errors++;
        else if (x.severity === 'warning') warnings++;
      });
    });
    const status = errors ? 'Fix required' : (warnings ? 'Review' : 'Pass');
    row['Status'] = status;
    row['Total Issues'] = total;
    await sheets.appendRows(mode === 'live' ? 'LIVE' : 'PUBLISH', [row]);

    if (mode === 'live') {
      const research = await sheets.readTab('RESEARCH');
      const target = normUrl(b.url);
      const reqTarget = normUrl(b.requestedUrl);
      const hit = research.find((r) => r['Live URL'] && (normUrl(r['Live URL']) === target || normUrl(r['Live URL']) === reqTarget));
      if (hit) {
        await sheets.updateCells('RESEARCH', [{ row: hit._row, data: { 'Last Live Check': row['Checked At'], 'Live Check Summary': status + ' - ' + total + ' issue(s): ' + errors + ' errors, ' + warnings + ' warnings' } }]);
      }
    }
    return { saved: true, status, total, errors, warnings, sheet: mode === 'live' ? 'Live Check' : 'Publish Check' };
  }
});
