'use strict';

// DM tab: sitemap link database for interlinking (KR-Interlinker logic), AI anchor selection,
// AI meta suggestions and logging to the DM sheet.

const { handler, HttpError, nowIST } = require('../lib/http');
const sitemap = require('../lib/sitemap');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');

module.exports = handler({
  async links() {
    const { links, errors } = await sitemap.allLinks();
    const counts = { report: 0, blog: 0, press: 0 };
    links.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });
    return { links: links.filter((l) => l.kw).map((l) => [l.url, l.kw, l.type]), counts, errors };
  },

  async interlink(b) {
    const keyword = String(b.keyword || '').trim();
    const content = String(b.content || '').trim();
    const links = String(b.links || '').trim();
    if (!keyword || !content || !links) throw new HttpError(400, 'Keyword, content and candidate links are required.');
    const count = Math.max(1, Math.min(Number(b.count) || 6, 15));
    const out = await ai.chatJSON({ system: P.interlinkSystem(), user: P.interlinkTask({ keyword, count, content, links }) });
    const suggestions = (Array.isArray(out.suggestions) ? out.suggestions : [])
      .filter((s) => s && Number.isFinite(Number(s.id)) && s.anchor)
      .map((s) => ({ id: Number(s.id), anchor: String(s.anchor).trim(), reason: String(s.reason || '') }));
    return { suggestions };
  },

  async meta(b) {
    const keyword = String(b.keyword || '').trim();
    if (!keyword) throw new HttpError(400, 'Enter the keyword first.');
    const out = await ai.chatJSON({ system: 'You write SEO metadata for Kings Research report pages. Respond in JSON only.', user: P.metaTask({ keyword, overview: b.overview || '', period: b.period || '' }) });
    return {
      titles: (Array.isArray(out.titles) ? out.titles : []).map(String).filter(Boolean).slice(0, 5),
      descriptions: (Array.isArray(out.descriptions) ? out.descriptions : []).map(String).filter(Boolean).slice(0, 5),
      alt: String(out.alt || '')
    };
  },

  async save(b) {
    const user = String(b.user || '').trim();
    if (!user) throw new HttpError(400, 'Enter your name (top right) first.');
    await sheets.appendRows('DM', [{
      'Optimized At': nowIST(),
      'User': user,
      'Keyword': String(b.keyword || ''),
      'Image URL': String(b.image || ''),
      'Image Alt': String(b.alt || ''),
      'Meta Title': String(b.metaTitle || ''),
      'Meta Description': String(b.metaDescription || ''),
      'Interlinks': String(b.interlinks || ''),
      'H2 Count': Number(b.h2) || 0,
      'H3 Count': Number(b.h3) || 0,
      'Word Count': Number(b.words) || 0
    }]);
    return { saved: true };
  }
});
