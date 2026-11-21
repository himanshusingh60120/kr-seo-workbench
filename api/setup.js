'use strict';

const { handler, competitors } = require('../lib/http');
const sheets = require('../lib/sheets');
const FC = require('../lib/factcheck');
const jev = require('../lib/jev');
const web = require('../lib/search');

const ENGINE_LABEL = {
  lite: 'lite (web search judged by Jev; the linked source is checked when no search is available)',
  deep: 'deep (OpenAI web search)',
  both: 'both (OpenAI web search, with the lite result shown beside it)'
};

// The same list as api/keywords.js: the people who may approve keywords.
function managers() {
  const split = (t) => String(t || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = process.env.MANAGER_EMAILS ? split(process.env.MANAGER_EMAILS) : ['hummer@kingsresearch.com', 'hsingh@kingsresearch.com'];
  split(process.env.MANAGER_EMAIL).forEach((e) => { if (list.indexOf(e) < 0) list.push(e); });
  return list;
}

module.exports = handler({
  async status() {
    const id = sheets.sheetId();
    const eng = FC.engine();
    return {
      env: {
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        MANGOOLS_API_KEY: !!process.env.MANGOOLS_API_KEY,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
        MANAGER_PIN: !!process.env.MANAGER_PIN,
        TEAM_ACCESS_KEY: !!process.env.TEAM_ACCESS_KEY,
        KR_COOKIE: !!process.env.KR_COOKIE
      },
      serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      sheetId: id,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      managerEmail: managers().join(', '),
      // The Setup dialog prints this line as it is, so the cost-saving and sign-in settings are shown here too.
      model: (process.env.OPENAI_MODEL || 'gpt-4.1-mini') +
        ' · Fact-check engine: ' + ENGINE_LABEL[eng] +
        ' · Jev key: ' + (jev.configured() ? 'set' : 'not set') +
        ' · Web search key: ' + (web.configured() ? 'set' : 'not set') +
        ' · Sign-in accounts: ' + (process.env.USERS_SHEET_ID ? 'in a private sheet' : 'in this sheet (hidden, edit-locked)'),
      factEngine: eng,
      jev: jev.configured(),
      search: web.configured(),
      webSearch: String(process.env.OPENAI_WEB_SEARCH || 'true').toLowerCase() !== 'false',
      competitors: competitors(),
      tabs: sheets.tabNames()
    };
  },

  async init() {
    return sheets.ensureTabs(true);
  }
});
