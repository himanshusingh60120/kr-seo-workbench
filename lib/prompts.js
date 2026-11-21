'use strict';

// Every AI instruction used by the tool lives here so the team can tune wording in one place.

const { today, cap, competitors } = require('./http');
const { faqText } = require('./checks');

const HOUSE_RULES = [
  '1. Every number (market size by year, CAGR, segment and regional shares, values and CAGRs, years) must be identical wherever it appears: Overview, Key Market Highlights, body sections, FAQs, infographic, Report Snapshot and Table of Contents.',
  '2. "Largest", "leading", "dominant", "majority" (majority = more than 50%), "fastest" and "highest CAGR" claims must agree with the numbers given.',
  '3. Base year, forecast period (e.g. 2026-2033) and historical period must be consistent on every tab.',
  '4. Combined regions are always written "Middle East & Africa" and "South & Central America"; country lists end with ", and Rest of <Region>".',
  '5. Company names must be identical in the key companies list, Competitive Landscape, FAQ key players and TOC Company Profiles; acquired companies are written "Subsidiary (Parent)".',
  '6. Dated developments use the form "In <Month> <Year>, ..." and must not be dated after today.',
  '7. Lists use the Oxford comma ("A, B, and C"); every segment and sub-segment in the title and segmentation table is named consistently.',
  '8. Past tense for base-year facts ("held", "accounted for"), future tense for forecasts ("is expected to").',
  '9. Statistics, regulations, approvals, deals and launches attributed to an organization should carry a source link.',
  '10. No duplicated words or phrases, no missing or extra spaces, abbreviations expanded on first use.'
].join('\n');

const ISSUE_FORMAT = 'Return JSON only, in this shape:\n' +
  '{"issues":[{"severity":"error|warning|check","section":"where it is (e.g. Market Overview, FAQ 3, Infographic, Snapshot, TOC chapter 6)","quote":"exact text copied from the source, max 30 words","problem":"what is wrong, specifically","fix":"the exact replacement text or the action to take"}]}\n' +
  'Severity: "error" = objectively wrong (mismatch, misspelling, wrong fact); "warning" = house-style, clarity or SEO problem; "check" = needs a human to confirm.\n' +
  'Report each problem once. Do not invent problems. If nothing is wrong return {"issues":[]}.';

const RD_FORMAT = 'Return JSON only, in this shape:\n' +
  '{"consistency":[ISSUE],"language":[ISSUE],"structure":[ISSUE],"keyword_tips":[{"keyword":"...","suggestion":"section to add it to + a sample sentence using it naturally"}]}\n' +
  'where ISSUE = {"severity":"error|warning|check","section":"...","quote":"exact text, max 30 words","problem":"...","fix":"exact replacement or action"}.\n' +
  'Severity: "error" = objectively wrong; "warning" = style or clarity; "check" = needs a human to confirm. Do not invent problems; use empty arrays when nothing is wrong.';

function qcSystem(format) {
  return 'You are the senior quality reviewer at Kings Research (kingsresearch.com), a market research publisher. ' +
    'You check Report Description (RD) pages before and after publication. Today\'s date is ' + today() + '.\n' +
    'Be precise: report only problems you can point to in the supplied text, quoting it exactly. A false alarm wastes the writer\'s time, so when unsure use severity "check".\n\n' +
    'House rules:\n' + HOUSE_RULES + '\n\n' + (format || ISSUE_FORMAT);
}

function block(label, text, n) { return label + ':\n"""\n' + cap(text || '', n) + '\n"""\n'; }

function dataTask(pg, figures) {
  return 'TASK: DATA CONSISTENCY CHECK for the "' + (pg.h1 || 'report') + '" page.\n' +
    'Compare every figure across the Description, the FAQs and the Report Snapshot excerpt. Report mismatches (same metric, different values), impossible maths (shares over 100%, sub-segment shares that cannot add up, CAGR not matching start and end values), superlatives that contradict the numbers, and inconsistent years or periods.\n' +
    'Parsed headline figures (verify them too): ' + JSON.stringify(figures) + '\n\n' +
    block('DESCRIPTION', pg.descriptionText, 35000) + block('FAQS', faqText(pg.faqs), 8000) +
    block('REPORT SNAPSHOT (excerpt)', pg.snapshot && pg.snapshot.text, 8000);
}

function faqTask(pg, companies) {
  return 'TASK: FAQ ACCURACY CHECK for the "' + (pg.h1 || 'report') + '" page.\n' +
    'For each FAQ check: (1) the answer agrees with the Description (numbers, years, regions, segments, drivers, restraints, opportunities, company names); ' +
    '(2) it does not contradict another FAQ; (3) the question is answered directly and both question and answer are grammatical; ' +
    '(4) the key-players answer lists exactly the same company names as the key companies list.\n' +
    'Key companies parsed from the Description: ' + JSON.stringify(companies) + '\n\n' +
    block('FAQS', faqText(pg.faqs), 12000) + block('DESCRIPTION', pg.descriptionText, 30000);
}

function languageTask(text) {
  return 'TASK: SPELLING, GRAMMAR AND STYLE CHECK.\n' +
    'Find misspellings, grammar errors, wrong tense, subject-verb disagreement, missing or extra words, duplicated words or phrases, wrong articles, punctuation and spacing errors, inconsistent capitalization of segment names, unexpanded abbreviations and house-rule violations. ' +
    'Ignore the [IMAGE ...] markers and the markdown symbols (#, -). Quote the exact wrong text and put the corrected text in "fix".\n\n' +
    block('TEXT', text, 40000);
}

function imageTask(pg, figures, imageAlt) {
  return 'TASK: INFOGRAPHIC CHECK for the "' + (pg.h1 || 'report') + '" page. The image alt text is "' + (imageAlt || '') + '".\n' +
    'Step 1: read every word and number in the image.\n' +
    'Step 2: check spelling, the market name, the forecast period and years, units (USD Billion / Million), decimals and thousand separators, segment and sub-segment names, and that every number matches the Description. Also confirm the image belongs to this market and not another report.\n' +
    'Headline figures from the Description: ' + JSON.stringify(figures) + '\n\n' +
    block('DESCRIPTION (overview, highlights and segments)', pg.descriptionText, 9000) +
    '\nFor this task return JSON: {"transcription":"all text you can read in the image","issues":[{"severity":"error|warning|check","section":"Infographic","quote":"text as shown in the image","problem":"...","fix":"..."}]}';
}

function snapshotTask(pg, figures) {
  return 'TASK: REPORT SNAPSHOT vs DESCRIPTION CHECK for the "' + (pg.h1 || 'report') + '" report.\n' +
    'Compare the Report Snapshot tab with the Description: base year, forecast period, historical period, market size values (base year, first forecast year, final year), CAGR, units, largest region, fastest-growing region, every segment and sub-segment list (names, spelling, missing or extra items, missing commas between items), regions and countries, and key companies. Report every mismatch, with the snapshot text in "quote" and "Report Snapshot" as the section prefix.\n' +
    'Headline figures from the Description: ' + JSON.stringify(figures) + '\n\n' +
    block('REPORT SNAPSHOT', pg.snapshot && pg.snapshot.text, 15000) + block('DESCRIPTION (reference)', pg.descriptionText, 25000);
}

function tocTask(pg, figures, companies) {
  const period = figures && figures.period ? figures.period.join('-') : 'the forecast period';
  return 'TASK: TABLE OF CONTENTS vs DESCRIPTION CHECK for the "' + (pg.h1 || 'report') + '" report.\n' +
    'Check: segment chapters and sub-segments match the segmentation table; the region chapter matches the regions and countries; the Company Profiles list matches the key companies list exactly (same names, none missing, none extra); ' +
    'table and figure titles use the right market name, years (' + period + '), units and segment names; chapter numbering is sequential with no gaps or repeats; "Market"/"Markets" is used consistently; no chapter or title mentions a different market (copied from another report); spelling. Use "Table of Contents" as the section prefix.\n' +
    'Key companies from the Description: ' + JSON.stringify(companies) + '\n\n' +
    block('TABLE OF CONTENTS', pg.toc && pg.toc.text, 30000) + block('DESCRIPTION (reference)', pg.descriptionText, 15000);
}

function rdReviewTask(o) {
  return 'TASK: PRE-PUBLICATION REVIEW of the RD for "' + (o.reportName || o.primary || 'this market') + '".\n' +
    '- consistency: number mismatches between sections, wrong superlatives, CAGR or year problems, contradictions.\n' +
    '- language: spelling, grammar, tense, duplicated words, punctuation, house style.\n' +
    '- structure: missing standard sections (Market Overview, Key Market Highlights, Market Dynamics with a driver, a restraint/challenge and an opportunity, Market Segmentation table, Segmental Analysis, Regional Analysis, Competitive Landscape with recent developments, key companies list, Research Methodology) and unbalanced coverage of segments or regions.\n' +
    '- keyword_tips: only for these keywords that are missing from the content: ' + JSON.stringify(o.missing || []) + '\n' +
    'Primary keyword: "' + (o.primary || '') + '". Secondary keywords: ' + JSON.stringify(o.secondaries || []) + '\n\n' +
    block('CONTENT', o.content, 40000);
}

function claimsSystem() {
  return 'You extract checkable third-party facts from market research report descriptions for fact-checkers. Today is ' + today() + '. Respond in JSON only.';
}

function claimsTask(content, max) {
  return 'Extract the verifiable third-party factual claims from this report description.\n' +
    'Include: dated events, regulations and laws, approvals, product launches, acquisitions, partnerships, investments, funding amounts and statistics attributed to an organization (government, association, company, journal).\n' +
    'Exclude: Kings Research\'s own estimates and forecasts (market size, CAGR, shares, segment or regional figures), generic statements and opinions.\n' +
    'Pick at most ' + max + ' claims, most important first. For each return:\n' +
    '- "sentence": the full sentence copied exactly from the content,\n' +
    '- "claim": the checkable fact in one short line,\n' +
    '- "anchor": the organization or proper-noun phrase in that sentence that should carry the source hyperlink, copied exactly (e.g. "Eli Lilly and Company"),\n' +
    '- "date": the month and year mentioned, or "".\n' +
    'Return {"claims":[{"sentence":"","claim":"","anchor":"","date":""}]}\n\n' + block('CONTENT', content, 40000);
}

function verifySystem() {
  return 'You are a meticulous fact-checker for Kings Research. Use web search to verify each claim against reliable sources. Today is ' + today() + '. Respond with JSON only, no prose.';
}

function verifyTask(claims) {
  return 'Fact-check each claim below.\n' +
    'Verdicts: "Supported" (a reliable source confirms it as written), "Partially supported" (core is right but a detail such as date, number, name or wording is wrong; give the correction), ' +
    '"Contradicted" (reliable sources say otherwise; give the correction), "Unverifiable" (no reliable source found).\n' +
    'Prefer primary sources: the organization\'s own newsroom, press release or investor-relations page, government or regulator sites, official journals, then major news agencies. ' +
    'Never use these as sources: ' + competitors().join(', ') + ', kingsresearch.com, or any other market-research report seller.\n' +
    'Return {"results":[{"id":<claim id>,"verdict":"Supported|Partially supported|Contradicted|Unverifiable","correction":"","source_url":"https://...","source_title":"","note":"one line"}]}\n\n' +
    'CLAIMS:\n' + claims.map((c) => '[' + c.id + '] ' + c.claim + ' | sentence: "' + cap(c.sentence, 600) + '"').join('\n');
}

function kwSystem() {
  return 'You are a senior SEO strategist for Kings Research (kingsresearch.com), a market research publisher whose report pages compete in Google with ' +
    competitors().join(', ') + '. You choose keywords that help OUR report page outrank them. Respond in JSON only.';
}

function kwAnalyzeTask(b) {
  const serp = (b.serp || []).map((o) => '#' + o.position + ' ' + o.domain + (o.competitor ? ' [COMPETITOR]' : '') + ' - ' + cap(o.title, 120)).join('\n') || '(no SERP data)';
  const cands = (b.candidates || []).map((c) => c.kw + ' | vol ' + (c.sv == null ? '?' : c.sv) + ' | KD ' + (c.kd == null ? '?' : c.kd) + ' | CPC ' + (c.cpc == null ? '?' : c.cpc) + ' | competitor pages ranking: ' + (c.comps || 0)).join('\n') || '(no Mangools candidates: propose keywords from your own knowledge)';
  return 'Report: "' + (b.reportName || '') + '". Seed keyword: "' + (b.seed || '') + '". Location: ' + (b.location || 'Global') + '. Seed KD: ' + (b.kd == null ? 'unknown' : b.kd) + '.\n\n' +
    'Current Google top 10:\n' + serp + '\n\n' +
    'Candidate keywords (keyword | volume | difficulty | CPC | competitor pages ranking):\n' + cap(cands, 14000) + '\n\n' +
    'Choose:\n' +
    '1. ONE primary keyword: the head term the report page should rank for (usually "<topic> market" or "<topic> market size").\n' +
    '2. 8 to 15 secondary keywords that are tied to the report topic, have demand, are ranked by competitor pages, and can be placed naturally in an RD (overview, segments, regions, FAQs). Include question-style keywords for FAQs when available.\n' +
    'Avoid near-duplicates (singular/plural), competitor brand names, unrelated intents (jobs, salary, courses, stock price, definitions unrelated to the market) and zero-volume terms unless strongly relevant. Copy keyword text exactly from the candidates.\n' +
    'For each keyword give "reason": 1-2 sentences on why it helps OUR page outrank the competitors, and "placement": where in the RD to use it.\n' +
    'Return {"primary":{"keyword":"","reason":"","placement":""},"secondary":[{"keyword":"","reason":"","placement":"","intent":"informational|commercial"}],"faq_questions":["..."],"strategy_note":"2-3 sentences on how to beat the current top results"}';
}

function interlinkSystem() {
  return 'You are an SEO internal-linking specialist for Kings Research (kingsresearch.com). Respond in JSON only.';
}

function interlinkTask(o) {
  return 'Page topic: "' + o.keyword + '".\n' +
    'Choose up to ' + o.count + ' internal links for the content below from the numbered candidate list.\n' +
    'Rules:\n' +
    '1. "anchor" must be copied EXACTLY (same characters) from the content, 1 to 5 words long.\n' +
    '2. The anchor must describe the target page topic (e.g. anchor "gene synthesis" for a "gene synthesis market" report). Prefer the target market\'s topic words over generic words.\n' +
    '3. Never use the page\'s own topic ("' + o.keyword + '") or a phrase containing it as an anchor, and never pick a candidate about the same market as this page.\n' +
    '4. One link per candidate, every anchor different, spread across different paragraphs.\n' +
    '5. Prefer REPORT candidates; use BLOG or PRESS only when strongly relevant.\n' +
    '6. Do not use company names, numbers, years or region names as anchors.\n' +
    'Return {"suggestions":[{"id":<candidate number>,"anchor":"<exact text from content>","reason":"<short reason>"}]}\n\n' +
    'CANDIDATES:\n' + o.links + '\n\n' + block('CONTENT', o.content, 9000);
}

function metaTask(o) {
  const end = String(o.period || '').split('-')[1] || '2033';
  return 'Write SEO metadata for the Kings Research report page "' + o.keyword + '".\n' +
    block('OVERVIEW', o.overview, 4000) +
    'Return JSON: {"titles":["three options, 50-60 characters each, starting with the market name and ending with ' + end + '"],' +
    '"descriptions":["three options, 140-160 characters each, stating the market size values and CAGR exactly as written in the overview"],' +
    '"alt":"' + o.keyword + ' Size & Share, By Revenue, ' + (o.period || '2026-2033') + '"}';
}

module.exports = {
  HOUSE_RULES, ISSUE_FORMAT, RD_FORMAT, qcSystem, dataTask, faqTask, languageTask, imageTask, snapshotTask, tocTask,
  rdReviewTask, claimsSystem, claimsTask, verifySystem, verifyTask, kwSystem, kwAnalyzeTask, interlinkSystem, interlinkTask, metaTask
};
