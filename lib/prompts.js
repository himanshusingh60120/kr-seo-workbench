'use strict';

// Every AI instruction used by the tool lives here (plus the opportunity ranking prompt in lib/topics.js and the
// one-line market reason in api/keywords.js) so the team can tune wording in one place.

const { today, cap, competitors } = require('./http');
const { faqText } = require('./checks');

const HOUSE_RULES = [
  '1. Every number (market size by year, CAGR, segment and regional shares, values and CAGRs, years) must be identical wherever it appears: Overview, Key Market Highlights, body sections, FAQs, infographic, Report Snapshot and Table of Contents.',
  '2. "Largest", "leading", "dominant", "majority" (majority = more than 50%), "fastest" and "highest CAGR" claims must agree with the numbers given. Superlatives apply WITHIN one segmentation category: the fastest-growing deployment mode and the fastest-growing technology are different claims and can both be true. Flag a conflict only when two segments of the SAME category are both called largest/fastest, or when the numbers contradict the claim.',
  '3. Base year, forecast period (e.g. 2026-2033) and historical period must be consistent on every tab.',
  '4. Combined regions are always written "Middle East & Africa" and "South & Central America". Country lists end with ", and Rest of <Region>", EXCEPT North America, which is always exactly "U.S., Canada, and Mexico" (there is no "Rest of North America").',
  '5. Company names must be identical in the key companies list, Competitive Landscape and FAQ key players; acquired companies are written "Subsidiary (Parent)".',
  '6. Dated developments use the form "In <Month> <Year>, ..." and must not be dated after today.',
  '7. Lists use the Oxford comma ("A, B, and C"); every segment and sub-segment in the title and segmentation table is named consistently.',
  '8. Past tense for base-year facts ("held", "accounted for"), future tense for forecasts ("is expected to").',
  '9. Statistics, regulations, approvals, deals and launches attributed to an organization should carry a source link.',
  '10. No duplicated words or phrases, no missing or extra spaces, abbreviations expanded on first use.'
].join('\n');

const ONLY_PROBLEMS = 'List ONLY real problems. Never include items that are correct, consistent, plausible, acceptable or "OK", never write "no conflict" entries, and never ask the reader to "confirm", "check", "double-check", "ensure" or "verify" something unless you found a specific discrepancy that you can quote. If the text does not give enough data to recompute a figure, that is not a problem.';

// What the reviewer must never do. Each line answers a kind of false alarm seen in real checks.
const NEVER = 'Strict limits:\n' +
  '- The house rules above are the ONLY style rules. Never invent another rule or call something "house style" that is not listed.\n' +
  '- Never change or "correct" the name of a company, product, organization or person. Names are written the way their owner writes them. Only report a name when the SAME name is spelled two different ways in the supplied text, and quote both.\n' +
  '- The "quote" must be copied character for character from the supplied text. Never tidy it, shorten words in it or fix it. If you cannot copy the exact words, do not report the item.\n' +
  '- The "fix" must be different from the quote. If your fix is the same as the quote, there is no problem to report.\n' +
  '- A figure that appears only once is not a conflict. A regional or segment growth rate that differs from the market growth rate is normal.\n' +
  '- Do not report matters of taste: repeated adjectives, word choice, or sentences that could be shorter.';

// How numbers are compared. A regional or segment figure is a part of the market, not a second market total.
const NUMBER_RULES = 'Number rules: (1) A value given for a region, a country or a segment is a PART of the market total and is expected to be smaller than it; never report it as conflicting with the total, and never report that parts "do not add up" unless every part of that category is given. ' +
  '(2) Before reporting any mismatch, do the arithmetic and compare: a share and its value agree when value divided by the market total for the same year is within 1% of the share. ' +
  '(3) A mismatch needs two quotes of the SAME metric for the SAME year with different values. ' +
  '(4) A segmentation list that shows a region followed by its countries is a normal table, not a duplication.';

const ISSUE_FORMAT = 'Return JSON only, in this shape:\n' +
  '{"issues":[{"severity":"error|warning|check","section":"where it is (e.g. Market Overview, FAQ 3, Infographic, Snapshot, TOC chapter 6)","quote":"exact text copied from the source, max 30 words","problem":"what is wrong, specifically","fix":"the exact replacement text or the action to take"}]}\n' +
  'Severity: "error" = objectively wrong (mismatch, misspelling, wrong fact); "warning" = house-style or clarity problem; "check" = a specific discrepancy a human should confirm.\n' +
  ONLY_PROBLEMS + '\nReport each problem once. If nothing is wrong return {"issues":[]}.';

const RD_FORMAT = 'Return JSON only, in this shape:\n' +
  '{"consistency":[ISSUE],"language":[ISSUE],"structure":[ISSUE],"keyword_tips":[{"keyword":"...","suggestion":"section to add it to + a sample sentence using it naturally"}]}\n' +
  'where ISSUE = {"severity":"error|warning|check","section":"...","quote":"exact text copied character for character from the content, max 30 words","problem":"...","fix":"exact replacement or action"}.\n' +
  'Severity: "error" = objectively wrong; "warning" = style or clarity; "check" = a specific discrepancy to confirm.\n' + ONLY_PROBLEMS + ' Use empty arrays when nothing is wrong.';

function qcSystem(format) {
  return 'You are the senior quality reviewer at Kings Research (kingsresearch.com), a market research publisher. ' +
    'You check Report Description (RD) pages before and after publication. Today\'s date is ' + today() + '.\n' +
    'Be precise: report only problems you can point to in the supplied text, quoting it exactly. A false alarm wastes the writer\'s time, so when you are not sure, leave it out.\n\n' +
    'House rules:\n' + HOUSE_RULES + '\n\n' + NEVER + '\n\n' + (format || ISSUE_FORMAT);
}

function block(label, text, n) { return label + ':\n"""\n' + cap(text || '', n) + '\n"""\n'; }

function dataTask(pg, figures) {
  return 'TASK: DATA CONSISTENCY CHECK for the "' + (pg.h1 || 'report') + '" page.\n' +
    'Report only: the same metric given different values in different places; impossible maths (shares over 100%, sub-segment shares that cannot add up, a CAGR that does not match its own start and end values); a superlative that the numbers contradict; inconsistent years or periods.\n' +
    'Superlatives are per segmentation category (By Technology vs By Deployment Mode vs By End Use vs By Region): each category has its own largest and fastest segment, so they never conflict with each other.\n' +
    NUMBER_RULES + '\n' +
    'Parsed headline figures: ' + JSON.stringify(figures) + '\n\n' +
    block('DESCRIPTION', pg.descriptionText, 35000) + block('FAQS', faqText(pg.faqs), 8000);
}

function faqTask(pg, companies) {
  return 'TASK: FAQ ACCURACY CHECK for the "' + (pg.h1 || 'report') + '" page.\n' +
    'Report only: (1) a number, year, region, segment or company in an answer that is DIFFERENT from the Description; (2) two FAQs that contradict each other; (3) grammar errors; (4) a key-players answer whose company names differ from the key companies list.\n' +
    'An answer that repeats the Description word for word is correct. An answer may add explanation or examples that are not in the Description - that is fine and must not be reported. Before reporting a number mismatch, compare both values; if they are the same, it is not a problem.\n' +
    'Key companies parsed from the Description: ' + JSON.stringify(companies) + '\n\n' +
    block('FAQS', faqText(pg.faqs), 12000) + block('DESCRIPTION', pg.descriptionText, 30000);
}

function languageTask(text) {
  return 'TASK: SPELLING, GRAMMAR AND STYLE CHECK.\n' +
    'Read every word. Find every misspelled word (for example a word with a missing letter), grammar errors, wrong tense, subject-verb disagreement, missing or extra words, duplicated words or phrases, wrong articles, punctuation and spacing errors (including a missing space after a full stop and a missing full stop at the end of a sentence), inconsistent capitalization of segment names, unexpanded abbreviations and house-rule violations. ' +
    'Lower-case segment names inside a running sentence are correct. Do not suggest synonyms or rewording when the sentence is already correct. ' +
    'Ignore the [IMAGE ...] markers, the markdown symbols (#, -) and website labels such as "Description", "Report Snapshot" and "Table Of Content". Quote the exact wrong text and put the corrected text in "fix".\n\n' +
    block('TEXT', text, 40000);
}

function imageTask(pg, figures, imageAlt) {
  return 'TASK: INFOGRAPHIC vs CONTENT CHECK for the "' + (pg.h1 || 'report') + '" page. The image alt text is "' + (imageAlt || '') + '".\n' +
    'Step 1: read every word and number in the image.\n' +
    'Step 2: report ONLY numbers or statements in the image that CONTRADICT the Description: a different value for the same metric (market size, year, CAGR, share), a different largest or fastest segment or region, a different forecast period, or a different market name.\n' +
    'Do NOT report:\n' +
    '- masked or placeholder values such as XX.X%, X.XX%, XX%, $XX Bn or blanks (they are intentional);\n' +
    '- numbers in the image that the Description does not mention (they are fine);\n' +
    '- regional or segment figures, unless the Description gives a DIFFERENT value for that same region or segment and year;\n' +
    '- fonts, bold, styling, layout, labels, missing years, missing breakdowns or wording suggestions.\n' +
    'Headline figures from the Description: ' + JSON.stringify(figures) + '\n\n' +
    block('DESCRIPTION (overview, highlights and segments)', pg.descriptionText, 9000) +
    '\nReturn JSON: {"transcription":"all text you can read in the image","issues":[{"severity":"error|check","section":"Infographic","quote":"text as shown in the image","problem":"which statement in the Description it contradicts, quoting both values","fix":"the value to use"}]}. If nothing contradicts the Description, return "issues": [].';
}

function snapshotTask(pg, figures) {
  return 'TASK: REPORT SNAPSHOT vs DESCRIPTION CHECK for the "' + (pg.h1 || 'report') + '" report.\n' +
    'Compare the Report Snapshot tab with the Description: base year, forecast period, historical period, market size values (base year, first forecast year, final year), CAGR, units, largest region, fastest-growing region, every segment and sub-segment list (names, spelling, missing or extra items, missing commas between items), regions and countries. Report every mismatch, with the snapshot text in "quote" and "Report Snapshot" as the section prefix. If the snapshot text is clearly not a snapshot (for example navigation only), return one "check" issue saying the snapshot could not be read.\n' +
    'The "quote" must come from the REPORT SNAPSHOT block, never from the Description.\n' +
    'Headline figures from the Description: ' + JSON.stringify(figures) + '\n\n' +
    block('REPORT SNAPSHOT', pg.snapshot && pg.snapshot.text, 15000) + block('DESCRIPTION (reference)', pg.descriptionText, 25000);
}

function tocTask(pg, figures) {
  const period = figures && figures.period ? figures.period.join('-') : 'the forecast period';
  return 'TASK: TABLE OF CONTENTS vs DESCRIPTION CHECK for the "' + (pg.h1 || 'report') + '" report.\n' +
    'Check: segment chapters and sub-segments match the segmentation table; the region chapter matches the regions and countries; table and figure titles use the right market name, years (' + period + '), units and segment names; chapter numbering is sequential with no gaps or repeats; "Market"/"Markets" is used consistently; no chapter or title mentions a different market (copied from another report); spelling. Use "Table of Contents" as the section prefix.\n' +
    'The "quote" must come from the TABLE OF CONTENTS block, never from the Description: problems inside the Description are found by other checks.\n' +
    'The TOC does NOT list company names - never report missing companies. Ignore website navigation labels such as "Description", "Report Snapshot" and "Table Of Content".\n\n' +
    block('TABLE OF CONTENTS', pg.toc && pg.toc.text, 30000) + block('DESCRIPTION (reference)', pg.descriptionText, 15000);
}

function rdReviewTask(o) {
  return 'TASK: PRE-PUBLICATION REVIEW of the RD for "' + (o.reportName || o.primary || 'this market') + '".\n' +
    '- consistency: ONLY number and fact conflicts: the same metric for the same year given two different values (quote both), a CAGR that does not match its own start and end values, a superlative that the numbers contradict (superlatives are per segmentation category), an inconsistent base year or forecast period. ' + NUMBER_RULES + ' Spelling, grammar, wording, naming and abbreviation problems do NOT belong here.\n' +
    '- language: read every word. Every misspelled word (for example a word with a missing letter), grammar, tense, duplicated words, missing or extra words, punctuation, a missing space after a full stop, a missing full stop at the end of a sentence, abbreviations and names written two different ways, house style. Lower-case segment names inside a running sentence are correct. Do not suggest synonyms or rewording when the sentence is already correct.\n' +
    '- structure: missing standard sections (Market Overview, Key Market Highlights, Market Dynamics with a driver, a restraint/challenge and an opportunity, Market Segmentation table, Segmental Analysis, Regional Analysis, Competitive Landscape with recent developments, key companies list, Research Methodology) and regions or segments from the segmentation that the text never discusses. Report each gap once.\n' +
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
    '- "claim": the checkable fact in one short line, using the exact dates, numbers and names written in the sentence,\n' +
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
    'Rules: judge only what the sentence actually says. If your correction states the same date, number or name that the sentence already states, the verdict is "Supported". ' +
    'Never "correct" a value the sentence does not contain. If sources are simply older than the event, use "Unverifiable", not "Contradicted". ' +
    'The source_url must be a page about THIS claim (the organization\'s own page, the law or regulator page, or a news report of the event) - never a page about a different topic.\n' +
    'Prefer primary sources: the organization\'s own newsroom, press release or investor-relations page, government or regulator sites, official journals, then major news agencies. ' +
    'Never use these as sources: ' + competitors().join(', ') + ', kingsresearch.com, or any other market-research report seller.\n' +
    'Return {"results":[{"id":<claim id>,"verdict":"Supported|Partially supported|Contradicted|Unverifiable","correction":"","source_url":"https://...","source_title":"","note":"one line"}]}\n\n' +
    'CLAIMS:\n' + claims.map((c) => '[' + c.id + '] ' + c.claim + ' | sentence: "' + cap(c.sentence, 600) + '"').join('\n');
}

function pageTermsSystem() {
  return 'You are a senior SEO strategist for Kings Research (kingsresearch.com), a market research publisher. You find secondary keywords for a report page by studying the pages that rank in Google\'s top 10. Respond in JSON only.';
}

function pageTermsTask(o) {
  const pages = (o.pages || []).map((p, i) => {
    const s = (o.serp || [])[i] || {};
    if (!p || !p.ok) return '#' + (s.position || i + 1) + ' ' + (s.domain || '') + ' (page could not be read) | Google title: ' + (s.title || '');
    return '#' + (s.position || i + 1) + ' ' + (s.domain || '') + '\nTitle: ' + cap(p.title, 200) + '\nMeta description: ' + cap(p.description, 300) +
      '\nHeadings: ' + cap((p.headings || []).slice(0, 40).join(' | '), 2000) + '\nOpening text: ' + cap(p.excerpt, 1200);
  }).join('\n\n');
  return 'Report: "' + (o.title || o.primary) + '". Primary keyword: "' + o.primary + '".\n' +
    'Below are the pages ranking in Google\'s top 10 for the primary keyword.\n' +
    'Suggest up to 20 SECONDARY keywords for our report page: phrases these pages target or repeat in their titles, headings and text that people search when looking for this report - size, share, growth, forecast and trend variants; segment, product, technology and application terms; end-use industries; regional variants (regions, not single countries); key-player and question phrasings.\n' +
    'Rules: 2-6 words each, lower case, written the way people search; same search intent as the primary or a subtopic covered inside this report; no competitor or company brand names; no single countries; nothing that duplicates these existing keywords: ' + JSON.stringify(o.existing || []) + '.\n' +
    'For each keyword give "why" (one short line) and "sources" (the domains where you saw it).\n' +
    'Return {"keywords":[{"keyword":"","why":"","sources":["domain"]}]}\n\n' + pages;
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

// DM tab: the headings come from the pasted content itself, not from a fixed list of section names.
function headingsSystem() {
  return 'You are the senior editor of Kings Research (kingsresearch.com), a market research publisher. You decide the H2 and H3 headings of report pages from their own content. Respond in JSON only.';
}

function headingsTask(o) {
  const lines = (o.blocks || []).map((b) => '[' + b.i + '] ' + b.kind + ' (' + b.len + ' chars) ' + String(b.text || '').slice(0, 160)).join('\n');
  return 'TASK: Choose the headings (H2 and H3) of the "' + (o.keyword || 'report') + '" page from its own content.\n' +
    'Below is every block of the pasted text, in order: [index] TYPE (length) text. LONG paragraphs are cut short; LIST items and TABLE rows are shown for context.\n' +
    'For every SHORT or HEADING block decide: "h2" (a main section), "h3" (a topic inside the main section above it) or "p" (plain text).\n' +
    'Rules:\n' +
    '1. Judge by the content: a line is a heading only when the blocks after it are about what it names. A line that states a fact, a number or a full sentence is text.\n' +
    '2. H2 is for the main sections, for example the Overview, Key Market Highlights, Market Dynamics, Market Segmentation, Segmental Analysis, Regional Analysis, Competitive Landscape, Research Methodology and Frequently Asked Questions, or any other main topic this text has.\n' +
    '3. H3 is for the topics inside a main section: each driver, restraint, challenge, opportunity or trend; each segment or region discussed; key companies; recent developments; each FAQ question; "How we gather this information" and "Custom offerings".\n' +
    '4. An H3 always sits under an H2. Do not use H3 before the first H2.\n' +
    '5. Lines inside the Market Segmentation list (By Type, By Application, region names followed by their countries) are table content: "p".\n' +
    '6. Company names in the key companies list, list items and dated developments ("In March 2025, ...") are text: "p".\n' +
    '7. "better": only for a heading that is vague (for example "Overview", "Drivers", "Key Insights", "Analysis"), suggest clearer wording of at most 70 characters that uses only words, names and facts from that line and the text right after it, plus the market name where it reads naturally. Keep questions as questions and keep the writer\'s meaning. Never add numbers or claims. Otherwise leave "better" empty.\n' +
    'Return {"items":[{"i":<index>,"level":"h2|h3|p","better":""}]} with one entry for every SHORT or HEADING block.\n\n' +
    'Market name: "' + (o.keyword || '') + '"\n\nBLOCKS:\n' + lines;
}

// Meta title and description options. Only figures written in the content may be used (api/dm.js drops any
// option with a number that is not in the content).
function metaTask(o) {
  const end = String(o.period || '').split('-')[1] || '2033';
  return 'Write SEO metadata for the Kings Research report page "' + o.keyword + '".\n' +
    'Use ONLY the figures written in the content below (market size values with their years, CAGR, forecast period). Copy every number exactly as written; never round, convert or invent a number. If a figure is not in the content, leave it out.\n' +
    (o.figures ? 'Figures found in the content: ' + o.figures + '\n' : '') +
    block('CONTENT (overview and key highlights)', o.overview, 6000) +
    'Return JSON: {"titles":["three options, 50-60 characters each, starting with the market name and ending with ' + end + '"],' +
    '"descriptions":["three options, 140-160 characters each, stating the market size values and CAGR exactly as written in the content"],' +
    '"alt":"' + o.keyword + ' Size & Share, By Revenue, ' + (o.period || '2026-2033') + '"}';
}

module.exports = {
  HOUSE_RULES, ISSUE_FORMAT, RD_FORMAT, qcSystem, dataTask, faqTask, languageTask, imageTask, snapshotTask, tocTask,
  rdReviewTask, claimsSystem, claimsTask, verifySystem, verifyTask, pageTermsSystem, pageTermsTask, interlinkSystem, interlinkTask,
  headingsSystem, headingsTask, metaTask
};
