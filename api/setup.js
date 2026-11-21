'use strict';

const { handler, competitors } = require('../lib/http');
const sheets = require('../lib/sheets');

module.exports = handler({
  async status() {
    const id = sheets.sheetId();
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
      managerEmail: process.env.MANAGER_EMAIL || 'habi@kingsresearch.com',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      webSearch: String(process.env.OPENAI_WEB_SEARCH || 'true').toLowerCase() !== 'false',
      competitors: competitors(),
      tabs: sheets.tabNames()
    };
  },

  async init() {
    return sheets.ensureTabs(true);
  }
});
