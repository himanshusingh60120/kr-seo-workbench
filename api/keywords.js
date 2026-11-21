'use strict';

// Keywords: opportunity finder (competitor gap + reports sitemap -> New report / Revamp), the last saved scan,
// more secondary keywords from the pages ranking in Google's top 10, analyst verification, manager approval,
// the Research List, and the SEO check of saved keywords.

const { handler, HttpError, nowIST, competitors, hostOf, pool, titleCase } = require('../lib/http');
const mg = require('../lib/mangools');
const ai = require('../lib/openai');
const jev = require('../lib/jev');
const P = require('../lib/prompts');
const T = require('../lib/topics');
const SEO = require('../lib/seo');
const OUT = require('../lib/outline');
const sitemap = require('../lib/sitemap');
const sheets = require('../lib/sheets');

const STATUS = {
  PENDING: 'Pending Verification',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  EXCLUDED: 'Excluded',
  REJECTED: 'Rejected'
};

function managerEmail() { return String(process.env.MANAGER_EMAIL || 'habi@kingsresearch.com').trim().toLowerCase(); }
function ourDomain() { return hostOf(process.env.SITE_BASE || 'https://www.kingsresearch.com') || 'kingsresearch.com'; }

function num(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

function numOrNull(v) {
  const n = num(v);
  return n === '' ? null : n;
}

function reportIdOf(url) {
  const m = String(url || '').replace(/[?#].*$/, '').replace(/\/+$/, '').match(/-(\d+)$/);
  return m ? m[1] : '';
}

function cleanDomain(d) {
  return String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function cleanKw(k) { return String(k || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function publicRow(r) {
  const seo = String(r['SEO Check'] || '');
  const placement = String(r['Suggested Placement'] || '');
  return {
    id: r['ID'], groupId: r['Group ID'], keyword: r['Keyword'], type: r['Type'], sv: r['Search Volume'], kd: r['KD'],
    cpc: r['CPC'], ppc: r['PPC'], competitors: r['Competitor Pages'], source: r['Source'], reason: r['AI Reason'],
    placement: placement + (seo && !/^OK/.test(seo) ? (placement ? ' · ' : '') + 'SEO: ' + seo : ''),
    seoCheck: seo, status: r['Status'], analyst: r['Analyst'], verdict: r['Analyst Verdict'],
    analystReason: r['Analyst Reason'], verifiedAt: r['Verified At'], manager: r['Manager'], note: r['Manager Note'],
    decisionAt: r['Decision At'], action: r['Action'] || 'New report', existingUrl: r['Existing URL']
  };
}

function groupStatus(rows) {
  const s = rows.map((r) => r.status);
  if (s.indexOf(STATUS.PENDING) >= 0) return STATUS.PENDING;
  if (s.indexOf(STATUS.VERIFIED) >= 0) return 'Awaiting Approval';
  if (s.length && s.every((x) => x === STATUS.REJECTED)) return STATUS.REJECTED;
  return STATUS.APPROVED;
}

function researchRow(r) {
  return {
    row: r._row, groupId: r['Group ID'], reportName: r['Report Name'], primary: r['Primary Keyword'],
    secondary: r['Secondary Keywords'], sv: r['Primary Search Volume'], kd: r['Primary KD'], analyst: r['Analyst'],
    approvedBy: r['Approved By'], approvalDate: r['Approval Date'], liveStatus: r['Live Status'], liveUrl: r['Live URL'],
    reportId: r['Report ID'], liveDate: r['Live Date'], detectedOn: r['Detected On'], lastCheck: r['Last Live Check'],
    checkSummary: r['Live Check Summary'], action: r['Action'] || 'New report', existingUrl: r['Existing URL']
  };
}

function prepGroup(g) {
  const name = String((g && g.reportName) || 'the report');
  const rows = (Array.isArray(g && g.rows) ? g.rows : []).filter((r) => r && String(r.keyword || '').trim());
  if (!rows.length) throw new HttpError(400, 'No keywords to save for ' + name + '.');
  const primaries = rows.filter((r) => r.type === 'Primary').length;
  if (primaries !== 1) throw new HttpError(400, 'Mark exactly one keyword as Primary for ' + name + ' (currently ' + primaries + ').');
  return rows;
}

// Builds sheet rows; every secondary gets a suggested RD section and an SEO check.
async function groupObjects(g, rows, user, now, groupId) {
  const action = g.action === 'Revamp' ? 'Revamp' : 'New report';
  const primaryRow = rows.find((r) => r.type === 'Primary');
  const secs = rows.filter((r) => r !== primaryRow);
  let assessed = [];
  try {
    assessed = await SEO.assess(String(primaryRow.keyword).trim(), secs.map((r) => String(r.keyword).trim()), g.existingUrl || '');
  } catch (e) {
    assessed = [];
  }
  return rows.map((r, i) => {
    const isPrimary = r === primaryRow;
    const a = isPrimary ? null : assessed[secs.indexOf(r)];
    const placement = String(r.placement || '').trim() || (isPrimary ? 'Title, H1, meta and Overview' : SEO.sectionOf(r.keyword));
    return {
      'ID': groupId + '-' + (i + 1),
      'Group ID': groupId,
      'Created At': now,
      'Created By': user,
      'Report Name': String(g.reportName || ''),
      'Seed Keyword': String(g.seed || ''),
      'Location': String(g.location || ''),
      'Keyword': String(r.keyword).trim(),
      'Type': isPrimary ? 'Primary' : 'Secondary',
      'Search Volume': num(r.sv),
      'KD': num(r.kd),
      'CPC': num(r.cpc),
      'PPC': num(r.ppc),
      'Competitor Pages': String(r.competitors || ''),
      'Source': String(r.source || ''),
      'AI Reason': String(r.reason || ''),
      'Suggested Placement': placement,
      'Status': STATUS.PENDING,
      'Action': action,
      'Existing URL': String(g.existingUrl || ''),
      'SEO Check': isPrimary ? 'OK' : (a ? SEO.seoCheckText(a) : '')
    };
  });
}

// Topics already in the Keywords or Research List tabs (so they are not proposed twice).
async function pipelineIndex() {
  const idx = new Map();
  try {
    const both = await Promise.all([sheets.readTab('KEYWORDS'), sheets.readTab('RESEARCH')]);
    const groups = {};
    both[0].forEach((r) => {
      const g = r['Group ID'];
      if (!g) return;
      (groups[g] = groups[g] || []).push(r);
    });
    Object.keys(groups).forEach((g) => {
      const rows = groups[g];
      const st = groupStatus(rows.map((r) => ({ status: r['Status'] })));
      if (st === STATUS.REJECTED) return;
      const label = st === STATUS.PENDING ? 'Pending verification' : st === 'Awaiting Approval' ? 'Awaiting approval' : 'Approved';
      const names = [rows[0]['Report Name'], rows[0]['Seed Keyword']].concat(rows.filter((r) => r['Type'] === 'Primary').map((r) => r['Keyword']));
      names.forEach((n) => {
        const k = T.keyFor(n);
        if (k && !idx.has(k)) idx.set(k, label);
      });
    });
    both[1].forEach((r) => {
      [r['Report Name'], r['Primary Keyword']].forEach((n) => {
        const k = T.keyFor(n);
        if (k) idx.set(k, 'In Research List');
      });
    });
  } catch (e) {
    /* Sheet not configured yet: no pipeline information. */
  }
  return idx;
}

// "marketsandmarkets.com #3, precedenceresearch.com" -> { 'marketsandmarkets.com': 3, 'precedenceresearch.com': null }
function parsePositions(text) {
  const out = {};
  String(text || '').split(/\s*,\s*/).filter(Boolean).forEach((part) => {
    const m = part.trim().match(/^(\S+)(?:\s+#(\d+))?$/);
    if (m) out[m[1]] = m[2] ? Number(m[2]) : null;
  });
  return out;
}

// ---------- topic prioritisation with Jev (cheaper than a chat model) ----------
// Search volume and competitor counts set the base priority (plain maths). Jev answers the judgment questions:
// is this a sellable report topic, how strong is the commercial demand, and is a "similar" report the same market.
const VALUE = {
  high: 'A large or fast-growing industry where many companies invest and need market data',
  medium: 'An established niche market with a moderate number of companies',
  low: 'A very small, declining or mostly consumer-interest market'
};
const LEVELS = ['Low', 'Medium', 'High'];

async function rankOneWithJev(t) {
  const primary = String(t.primary || '').trim();
  const title = titleCase(primary) || titleCase(String(t.key || ''));
  const similar = t.status === 'Similar report exists' && !!t.url;
  const state = 'Kings Research sells B2B market research reports: market size, share and forecast studies of one industry or product market.\n' +
    'Proposed report topic: "' + title + '"\nSearch keyword: "' + primary + '"' +
    (similar ? '\nOur closest existing report page: ' + t.url : '');
  const questions = {
    sellable: {
      type: 'yesno',
      instructions: 'The proposed topic is a specific industry, product, technology or service market that a B2B market research report could be written and sold about. It is NOT a stock or financial-market term, a job or career search, a consumer how-to, a company or brand name, or a word too vague to be a market.'
    },
    value: {
      type: 'choice',
      instructions: 'How strong is the commercial demand among businesses for a paid market research report on this topic?',
      options: VALUE
    }
  };
  if (similar) {
    questions.same = { type: 'yesno', instructions: 'The existing report page and the proposed topic are the same market, so one report page should serve both.' };
  }
  const ans = await jev.decide(state, questions);

  const comps = String(t.comps || '').split(',').map((s) => s.trim()).filter((s) => s.indexOf('.') > 0);
  const positions = (String(t.comps || '').match(/#(\d+)/g) || []).map((s) => Number(s.slice(1)));
  const best = positions.length ? Math.min.apply(null, positions) : null;
  const total = Number(t.total) || 0;
  let level = LEVELS.indexOf(T.heuristicPriority({ totalVolume: total, competitors: comps }));
  const demand = (ans.value && ans.value.choice) || 'medium';
  if (demand === 'high' && jev.optionProb(ans.value, 'high') >= 0.7) level = Math.min(2, level + 1);
  if (demand === 'low' && jev.optionProb(ans.value, 'low') >= 0.6) level = Math.max(0, level - 1);

  const sameMarket = similar && !!ans.same && ans.same.probability >= 0.7;
  const action = t.status === 'Revamp' || sameMarket ? 'Revamp' : 'New report';
  const kd = Number(t.kd);
  const reason = (total ? total.toLocaleString('en-US') + ' searches a month across the keyword variants' : 'Search volume not available') + '; ' +
    (comps.length ? comps.length + (comps.length === 1 ? ' competitor ranks' : ' competitors rank') + (best ? ' (best position #' + best + ')' : '') : 'no competitor ranking data') +
    (Number.isFinite(kd) && String(t.kd).trim() !== '' ? '; KD ' + kd : '') + '. Commercial demand: ' + demand + '.' +
    (similar ? (sameMarket ? ' Our existing report covers the same market, so revamp it.' : ' Our similar report covers a different market.') : '');
  return {
    key: String(t.key),
    keep: !ans.sellable || ans.sellable.probability >= 0.4,
    priority: LEVELS[level],
    title,
    action,
    reason
  };
}

module.exports = handler({
  // ---------- opportunity finder ----------
  async gap(b) {
    const comp = cleanDomain(b.competitor);
    if (!comp || comp.indexOf('.') < 0) throw new HttpError(400, 'Enter a competitor domain such as marketsandmarkets.com');
    const r = await mg.gap(ourDomain(), [comp], b.location_id, b.page);
    const res = r.results.find((x) => x.domain === comp) || r.results[0] || { domain: comp, total: null, keywords: [] };
    return { domain: comp, page: r.page, pagination: r.pagination, total: res.total, keywords: res.keywords };
  },

  async opportunities(b) {
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) throw new HttpError(400, 'No competitor keywords to analyse.');
    const topics = T.groupGap(rows).slice(0, 400);
    const both = await Promise.all([sitemap.fetchSitemap('report'), pipelineIndex()]);
    const idx = T.krIndex(both[0]);
    topics.forEach((t) => {
      t.kr = T.matchTopic(t.key, idx);
      t.action = t.kr.status === 'Revamp' ? 'Revamp' : 'New report';
      t.inPipeline = both[1].get(t.key) || '';
      t.priority = T.heuristicPriority(t);
    });
    return { topics, krReports: both[0].length, rawKeywords: rows.length };
  },

  // The most recent scan saved in the Opportunities sheet, rebuilt for the page (pipeline status is refreshed).
  async lastScan() {
    const rows = await sheets.readTab('OPPORTUNITIES');
    if (!rows.length) return { topics: [] };
    const latest = rows.reduce((m, r) => (String(r['Scanned At']) > m ? String(r['Scanned At']) : m), '');
    const scan = rows.filter((r) => String(r['Scanned At']) === latest);
    const pipe = await pipelineIndex();
    const topics = scan.map((r) => {
      const title = String(r['Report Title'] || '').trim();
      const primaryKw = String(r['Primary Keyword'] || '').trim();
      const key = T.keyFor(title || primaryKw);
      const positions = parsePositions(r['Competitors Ranking']);
      const secondary = String(r['Secondary Keywords'] || '').split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
        .map((kw) => ({ kw, sv: null, kd: null, cpc: null }));
      const krStatus = ['New report', 'Revamp', 'Similar report exists'].indexOf(r['KR Status']) >= 0 ? r['KR Status'] : 'New report';
      return {
        key,
        topic: T.topicOf(title, false) || title,
        title: title || primaryKw,
        primary: { kw: primaryKw, sv: numOrNull(r['Primary Volume']), kd: numOrNull(r['KD']), cpc: null },
        secondary,
        keywordCount: secondary.length + 1,
        totalVolume: numOrNull(r['Total Volume']) || 0,
        kd: numOrNull(r['KD']),
        competitors: Object.keys(positions),
        positions,
        bestPosition: numOrNull(r['Best Position']),
        score: numOrNull(r['Score']) || 0,
        kr: { status: krStatus, url: String(r['KR URL'] || ''), name: '', lastmod: '' },
        action: r['Action'] === 'Revamp' ? 'Revamp' : 'New report',
        priority: ['High', 'Medium', 'Low'].indexOf(r['Priority']) >= 0 ? r['Priority'] : 'Medium',
        reason: String(r['AI Reason'] || ''),
        ai: !!String(r['AI Reason'] || '').trim(),
        keep: true,
        inPipeline: pipe.get(key) || ''
      };
    });
    return { topics, scannedAt: latest, scannedBy: String(scan[0]['Scanned By'] || ''), location: String(scan[0]['Location'] || 'Global') };
  },

  // Prioritises topics. With a Jev key this uses Jev (far cheaper); set DECISION_ENGINE=openai to use the chat model.
  // If Jev fails for any reason, the chat model is used for that batch.
  async rank(b) {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30);
    if (!items.length) return { items: [] };
    let note = '';
    if (jev.configured() && String(process.env.DECISION_ENGINE || 'jev').toLowerCase() !== 'openai') {
      try {
        return { items: await pool(items.filter((t) => t && t.key), 6, rankOneWithJev), engine: 'jev' };
      } catch (e) {
        note = e.message;
      }
    }
    const out = await ai.chatJSON({ system: T.rankSystem(), user: T.rankTask(items) });
    return {
      items: (Array.isArray(out.items) ? out.items : []).filter((x) => x && x.key).map((x) => ({
        key: String(x.key),
        keep: x.keep !== false,
        priority: ['High', 'Medium', 'Low'].indexOf(x.priority) >= 0 ? x.priority : 'Medium',
        title: String(x.title || ''),
        action: x.action === 'Revamp' ? 'Revamp' : 'New report',
        reason: String(x.reason || '')
      })),
      engine: 'openai',
      note
    };
  },

  async saveScan(b) {
    const now = nowIST();
    const rows = (Array.isArray(b.topics) ? b.topics : []).slice(0, 300).map((t) => ({
      'Scanned At': now,
      'Scanned By': String(b.user || ''),
      'Location': String(b.location || ''),
      'Report Title': String(t.title || ''),
      'Action': String(t.action || ''),
      'Priority': String(t.priority || ''),
      'KR Status': String(t.krStatus || ''),
      'KR URL': String(t.krUrl || ''),
      'Primary Keyword': String(t.primary || ''),
      'Primary Volume': num(t.primaryVolume),
      'Total Volume': num(t.totalVolume),
      'KD': num(t.kd),
      'Competitors Ranking': String(t.competitors || ''),
      'Best Position': num(t.bestPosition),
      'Score': num(t.score),
      'AI Reason': String(t.reason || ''),
      'Secondary Keywords': String(t.secondary || ''),
      'In Pipeline': String(t.inPipeline || '')
    }));
    if (!rows.length) return { saved: 0 };
    await sheets.appendRows('OPPORTUNITIES', rows);
    return { saved: rows.length };
  },

  // ---------- more secondary keywords from the Google top 10 ----------
  async serp(b) {
    const kw = String(b.kw || '').trim();
    if (!kw) throw new HttpError(400, 'No keyword given.');
    return mg.serp(kw, b.location_id, competitors());
  },

  // Reads the top-10 ranking pages and asks the AI for secondary keywords those pages target.
  async pageTerms(b) {
    const primary = cleanKw(b.primary);
    if (!primary) throw new HttpError(400, 'No primary keyword given.');
    const serp = (Array.isArray(b.serp) ? b.serp : []).filter((x) => x && /^https?:\/\//i.test(String(x.url || ''))).slice(0, 10)
      .map((x) => ({ url: String(x.url), domain: String(x.domain || hostOf(x.url)), position: Number(x.position) || 0, title: String(x.title || '') }));
    if (!serp.length) throw new HttpError(400, 'No ranking pages to read.');
    const existing = (Array.isArray(b.existing) ? b.existing : []).map(cleanKw).filter(Boolean).slice(0, 60);
    const pages = await OUT.outlines(serp.map((x) => x.url));
    const out = await ai.chatJSON({ system: P.pageTermsSystem(), user: P.pageTermsTask({ primary, title: String(b.title || ''), serp, pages, existing }) });
    const seen = new Set(existing.concat([primary]));
    const keywords = [];
    (Array.isArray(out.keywords) ? out.keywords : []).forEach((k) => {
      const kw = cleanKw(k && k.keyword);
      if (!kw || kw.length > 80 || seen.has(kw)) return;
      seen.add(kw);
      keywords.push({ keyword: kw, why: String((k && k.why) || ''), sources: Array.isArray(k && k.sources) ? k.sources.map(String).slice(0, 5) : [] });
    });
    const list = keywords.slice(0, 25);
    let assessed = [];
    try { assessed = await SEO.assess(primary, list.map((k) => k.keyword), String(b.existingUrl || '')); } catch (e) { assessed = []; }
    list.forEach((k, i) => { k.seo = assessed[i] ? SEO.seoCheckText(assessed[i]) : ''; });
    return {
      keywords: list,
      pagesRead: pages.filter((p) => p.ok).length,
      pagesTried: pages.length,
      failed: pages.filter((p) => !p.ok).map((p) => p.url + ' (' + p.error + ')')
    };
  },

  async volumes(b) {
    const keywords = (Array.isArray(b.keywords) ? b.keywords : []).map(cleanKw).filter(Boolean).slice(0, 200);
    if (!keywords.length) return { keywords: [] };
    return { keywords: await mg.keywordImports(keywords, b.location_id) };
  },

  // Adds secondary keywords to a keyword group that is still waiting for analyst verification.
  async addRows(b) {
    const user = String(b.user || '').trim();
    if (!user) throw new HttpError(400, 'Enter your name (top right) first.');
    const gid = String(b.groupId || '').trim();
    const all = await sheets.readTab('KEYWORDS');
    const rows = all.filter((r) => r['Group ID'] === gid);
    if (!rows.length) throw new HttpError(404, 'Keyword group not found.');
    if (groupStatus(rows.map((r) => ({ status: r['Status'] }))) !== STATUS.PENDING) throw new HttpError(400, 'Keywords can only be added while the group is waiting for analyst verification.');
    const have = new Set(rows.map((r) => cleanKw(r['Keyword'])));
    const add = (Array.isArray(b.rows) ? b.rows : []).filter((r) => r && cleanKw(r.keyword) && !have.has(cleanKw(r.keyword))).slice(0, 30);
    if (!add.length) throw new HttpError(400, 'No new keywords to add.');
    const primaryRow = rows.find((r) => r['Type'] === 'Primary') || rows[0];
    let assessed = [];
    try { assessed = await SEO.assess(primaryRow['Keyword'], add.map((r) => cleanKw(r.keyword)), primaryRow['Existing URL']); } catch (e) { assessed = []; }
    let maxIdx = 0;
    rows.forEach((r) => {
      const m = String(r['ID'] || '').match(/-(\d+)$/);
      if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
    });
    const now = nowIST();
    const objs = add.map((r, i) => ({
      'ID': gid + '-' + (maxIdx + i + 1),
      'Group ID': gid,
      'Created At': now,
      'Created By': user,
      'Report Name': primaryRow['Report Name'],
      'Seed Keyword': primaryRow['Seed Keyword'],
      'Location': primaryRow['Location'],
      'Keyword': cleanKw(r.keyword),
      'Type': 'Secondary',
      'Search Volume': num(r.sv),
      'KD': num(r.kd),
      'CPC': num(r.cpc),
      'PPC': '',
      'Competitor Pages': String(r.sources || ''),
      'Source': 'Top-10 pages',
      'AI Reason': String(r.why || ''),
      'Suggested Placement': SEO.sectionOf(r.keyword),
      'Status': STATUS.PENDING,
      'Action': primaryRow['Action'] || 'New report',
      'Existing URL': primaryRow['Existing URL'] || '',
      'SEO Check': assessed[i] ? SEO.seoCheckText(assessed[i]) : ''
    }));
    await sheets.appendRows('KEYWORDS', objs);
    return { added: objs.length };
  },

  // ---------- saving for analyst verification ----------
  async saveGroups(b) {
    const user = String(b.user || '').trim();
    if (!user) throw new HttpError(400, 'Enter your name (top right) first.');
    const groups = (Array.isArray(b.groups) ? b.groups : []).slice(0, 30);
    if (!groups.length) throw new HttpError(400, 'No topics selected.');
    const now = nowIST();
    const base = Date.now();
    let objs = [];
    const ids = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const rows = prepGroup(g);
      const groupId = 'G-' + (base + i).toString(36).toUpperCase();
      ids.push(groupId);
      objs = objs.concat(await groupObjects(g, rows, user, now, groupId));
    }
    await sheets.appendRows('KEYWORDS', objs);
    return { saved: groups.length, rows: objs.length, groupIds: ids };
  },

  // Fills Suggested Placement and SEO Check for keyword rows saved before those were filled automatically.
  async repair() {
    const rows = await sheets.readTab('KEYWORDS');
    const groups = {};
    rows.forEach((r) => {
      const g = r['Group ID'];
      if (g) (groups[g] = groups[g] || []).push(r);
    });
    const updates = [];
    let flagged = 0;
    for (const gid of Object.keys(groups)) {
      const g = groups[gid];
      const primaryRow = g.find((r) => r['Type'] === 'Primary') || g[0];
      const secs = g.filter((r) => r !== primaryRow);
      const assessed = await SEO.assess(primaryRow['Keyword'], secs.map((r) => r['Keyword']), primaryRow['Existing URL']);
      g.forEach((r) => {
        const data = {};
        if (r === primaryRow) {
          if (!String(r['SEO Check'] || '').trim()) data['SEO Check'] = 'OK';
          if (!String(r['Suggested Placement'] || '').trim()) data['Suggested Placement'] = 'Title, H1, meta and Overview';
        } else {
          const a = assessed[secs.indexOf(r)];
          if (!String(r['SEO Check'] || '').trim() && a) {
            data['SEO Check'] = SEO.seoCheckText(a);
            if (a.status !== 'OK') flagged++;
          }
          if (!String(r['Suggested Placement'] || '').trim()) data['Suggested Placement'] = SEO.sectionOf(r['Keyword']);
        }
        if (Object.keys(data).length) updates.push({ row: r._row, data });
      });
    }
    if (updates.length) await sheets.updateCells('KEYWORDS', updates);
    return { updatedRows: updates.length, flagged, groups: Object.keys(groups).length };
  },

  // ---------- verification, approval, research list ----------
  async list() {
    const rows = await sheets.readTab('KEYWORDS');
    const groups = {};
    const order = [];
    rows.forEach((r) => {
      const g = r['Group ID'];
      if (!g) return;
      if (!groups[g]) {
        groups[g] = {
          groupId: g, reportName: r['Report Name'], seed: r['Seed Keyword'], createdAt: r['Created At'], createdBy: r['Created By'],
          location: r['Location'], action: r['Action'] || 'New report', existingUrl: r['Existing URL'], rows: []
        };
        order.push(g);
      }
      groups[g].rows.push(publicRow(r));
    });
    return { groups: order.reverse().map((g) => Object.assign({}, groups[g], { status: groupStatus(groups[g].rows) })) };
  },

  async verify(b) {
    const analyst = String(b.analyst || '').trim();
    if (!analyst) throw new HttpError(400, 'Enter your name (top right) before verifying.');
    const rows = await sheets.readTab('KEYWORDS');
    const byId = new Map(rows.map((r) => [r['ID'], r]));
    const now = nowIST();
    const updates = [];
    (Array.isArray(b.verdicts) ? b.verdicts : []).forEach((v) => {
      const r = byId.get(v.id);
      if (!r || r['Group ID'] !== b.groupId) return;
      if (['Good', 'Not good'].indexOf(v.verdict) < 0) throw new HttpError(400, 'Choose Good or Not good for "' + r['Keyword'] + '".');
      const reason = String(v.reason || '').trim();
      if (!reason) throw new HttpError(400, 'Add a reason for "' + r['Keyword'] + '".');
      updates.push({ row: r._row, data: { 'Analyst': analyst, 'Analyst Verdict': v.verdict, 'Analyst Reason': reason, 'Verified At': now, 'Status': STATUS.VERIFIED } });
    });
    if (!updates.length) throw new HttpError(400, 'Nothing to verify for this group.');
    await sheets.updateCells('KEYWORDS', updates);
    return { updated: updates.length };
  },

  async decide(b) {
    const mgr = managerEmail();
    if (String(b.email || '').trim().toLowerCase() !== mgr) throw new HttpError(403, 'Only ' + mgr + ' can approve or reject keywords.');
    if (!process.env.MANAGER_PIN) throw new HttpError(500, 'MANAGER_PIN is not set in Vercel.');
    if (String(b.pin || '') !== String(process.env.MANAGER_PIN)) throw new HttpError(403, 'Incorrect manager PIN.');
    const rows = (await sheets.readTab('KEYWORDS')).filter((r) => r['Group ID'] === b.groupId);
    if (!rows.length) throw new HttpError(404, 'Keyword group not found.');
    if (rows.some((r) => r['Status'] === STATUS.PENDING)) throw new HttpError(400, 'Analyst verification is not complete for this group.');
    const now = nowIST();
    const note = String(b.note || '').trim();

    if (b.decision === 'reject') {
      await sheets.updateCells('KEYWORDS', rows.map((r) => ({ row: r._row, data: { 'Status': STATUS.REJECTED, 'Manager': mgr, 'Manager Note': note, 'Decision At': now } })));
      return { rejected: rows.length };
    }
    if (b.decision !== 'approve') throw new HttpError(400, 'Decision must be approve or reject.');

    const ids = Array.isArray(b.approvedIds) ? new Set(b.approvedIds) : new Set(rows.filter((r) => r['Analyst Verdict'] === 'Good').map((r) => r['ID']));
    const approved = rows.filter((r) => ids.has(r['ID']));
    if (!approved.length) throw new HttpError(400, 'Select at least one keyword to approve.');
    const primary = approved.find((r) => r['Type'] === 'Primary') || approved[0];
    const secondaries = approved.filter((r) => r !== primary).map((r) => r['Keyword']);
    const action = primary['Action'] === 'Revamp' ? 'Revamp' : 'New report';
    const existingUrl = primary['Existing URL'] || '';

    await sheets.updateCells('KEYWORDS', rows.map((r) => ({
      row: r._row,
      data: { 'Status': ids.has(r['ID']) ? STATUS.APPROVED : STATUS.EXCLUDED, 'Manager': mgr, 'Manager Note': note, 'Decision At': now }
    })));

    const research = await sheets.readTab('RESEARCH');
    const existing = research.find((r) => r['Group ID'] === b.groupId);
    const rec = {
      'Group ID': b.groupId,
      'Report Name': primary['Report Name'],
      'Primary Keyword': primary['Keyword'],
      'Secondary Keywords': secondaries.join(', '),
      'Primary Search Volume': primary['Search Volume'],
      'Primary KD': primary['KD'],
      'Analyst': primary['Analyst'],
      'Approved By': mgr,
      'Approval Date': now,
      'Action': action,
      'Existing URL': existingUrl
    };
    if (existing) {
      await sheets.updateCells('RESEARCH', [{ row: existing._row, data: rec }]);
    } else {
      if (action === 'Revamp' && existingUrl) {
        rec['Live Status'] = 'Revamp pending';
        rec['Live URL'] = existingUrl;
        rec['Report ID'] = reportIdOf(existingUrl);
      } else {
        rec['Live Status'] = 'Not live';
      }
      await sheets.appendRows('RESEARCH', [rec]);
    }
    return { approved: approved.length, primary: primary['Keyword'], approvalDate: now, action };
  },

  async research() {
    const rows = await sheets.readTab('RESEARCH');
    return { rows: rows.map(researchRow).reverse() };
  }
});
