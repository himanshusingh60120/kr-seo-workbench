'use strict';

// Keyword research (Mangools + AI), analyst verification, manager approval and the Research List.

const { handler, HttpError, nowIST, competitors, hostOf } = require('../lib/http');
const mg = require('../lib/mangools');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');

const STATUS = {
  PENDING: 'Pending Verification',
  VERIFIED: 'Verified',
  APPROVED: 'Approved',
  EXCLUDED: 'Excluded',
  REJECTED: 'Rejected'
};

function managerEmail() { return String(process.env.MANAGER_EMAIL || 'habi@kingsresearch.com').trim().toLowerCase(); }

function num(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

function publicRow(r) {
  return {
    id: r['ID'], groupId: r['Group ID'], keyword: r['Keyword'], type: r['Type'], sv: r['Search Volume'], kd: r['KD'],
    cpc: r['CPC'], ppc: r['PPC'], competitors: r['Competitor Pages'], source: r['Source'], reason: r['AI Reason'],
    placement: r['Suggested Placement'], status: r['Status'], analyst: r['Analyst'], verdict: r['Analyst Verdict'],
    analystReason: r['Analyst Reason'], verifiedAt: r['Verified At'], manager: r['Manager'], note: r['Manager Note'],
    decisionAt: r['Decision At']
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
    checkSummary: r['Live Check Summary']
  };
}

module.exports = handler({
  async related(b) {
    const kw = String(b.kw || '').trim();
    if (!kw) throw new HttpError(400, 'Enter a seed keyword.');
    return { keywords: await mg.related(kw, b.location_id) };
  },

  async serp(b) {
    const kw = String(b.kw || '').trim();
    if (!kw) throw new HttpError(400, 'Enter a seed keyword.');
    return mg.serp(kw, b.location_id, competitors());
  },

  async competitor(b) {
    const url = String(b.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'Competitor URL must start with http:// or https://');
    const keywords = await mg.competitorKeywords(url, b.location_id);
    return { url, domain: hostOf(url), keywords };
  },

  async analyze(b) {
    return ai.chatJSON({ system: P.kwSystem(), user: P.kwAnalyzeTask(b || {}) });
  },

  async save(b) {
    const user = String(b.user || '').trim();
    if (!user) throw new HttpError(400, 'Enter your name (top right) first.');
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => r && String(r.keyword || '').trim());
    if (!rows.length) throw new HttpError(400, 'No keywords to save.');
    const primaries = rows.filter((r) => r.type === 'Primary').length;
    if (primaries !== 1) throw new HttpError(400, 'Mark exactly one keyword as Primary (currently ' + primaries + ').');
    const groupId = 'G-' + Date.now().toString(36).toUpperCase();
    const now = nowIST();
    const objs = rows.map((r, i) => ({
      'ID': groupId + '-' + (i + 1),
      'Group ID': groupId,
      'Created At': now,
      'Created By': user,
      'Report Name': String(b.reportName || ''),
      'Seed Keyword': String(b.seed || ''),
      'Location': String(b.location || ''),
      'Keyword': String(r.keyword).trim(),
      'Type': r.type === 'Primary' ? 'Primary' : 'Secondary',
      'Search Volume': num(r.sv),
      'KD': num(r.kd),
      'CPC': num(r.cpc),
      'PPC': num(r.ppc),
      'Competitor Pages': String(r.competitors || ''),
      'Source': String(r.source || ''),
      'AI Reason': String(r.reason || ''),
      'Suggested Placement': String(r.placement || ''),
      'Status': STATUS.PENDING
    }));
    await sheets.appendRows('KEYWORDS', objs);
    return { groupId, saved: objs.length };
  },

  async list() {
    const rows = await sheets.readTab('KEYWORDS');
    const groups = {};
    const order = [];
    rows.forEach((r) => {
      const g = r['Group ID'];
      if (!g) return;
      if (!groups[g]) {
        groups[g] = { groupId: g, reportName: r['Report Name'], seed: r['Seed Keyword'], createdAt: r['Created At'], createdBy: r['Created By'], location: r['Location'], rows: [] };
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
      'Approval Date': now
    };
    if (existing) {
      await sheets.updateCells('RESEARCH', [{ row: existing._row, data: rec }]);
    } else {
      rec['Live Status'] = 'Not live';
      await sheets.appendRows('RESEARCH', [rec]);
    }
    return { approved: approved.length, primary: primary['Keyword'], approvalDate: now };
  },

  async research() {
    const rows = await sheets.readTab('RESEARCH');
    return { rows: rows.map(researchRow).reverse() };
  }
});
