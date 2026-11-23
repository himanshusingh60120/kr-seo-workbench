'use strict';

// DM tab: sitemap link database for interlinking (KR-Interlinker logic), headings chosen from the pasted content
// (AI), AI anchor selection, meta suggestions that may only use the content's own figures, and logging to the DM sheet.

const { handler, HttpError, nowIST } = require('../lib/http');
const sitemap = require('../lib/sitemap');
const ai = require('../lib/openai');
const P = require('../lib/prompts');
const sheets = require('../lib/sheets');

// Every number in a meta suggestion must appear in the content, so nothing invented reaches the CMS.
function numbersOf(s) { return String(s || '').replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []; }
function backedByContent(text, source) {
  const have = new Set(numbersOf(source));
  return numbersOf(text).every((n) => have.has(n));
}

module.exports = handler({
  async links() {
    const { links, errors } = await sitemap.allLinks();
    const counts = { report: 0, blog: 0, press: 0 };
    links.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });
    return { links: links.filter((l) => l.kw).map((l) => [l.url, l.kw, l.type]), counts, errors };
  },

  // The H2 / H3 structure of the pasted content. blocks: [{ i, kind: SHORT|LONG|LIST|TABLE|HEADING<n>, len, text }].
  // Returns { items: [{ i, level: 'h2' | 'h3' | 'p', better }] } for the SHORT and HEADING blocks.
  async headings(b) {
    const keyword = String(b.keyword || '').trim();
    const blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 400).map((x) => ({
      i: Number(x && x.i),
      kind: String((x && x.kind) || 'LONG').toUpperCase().slice(0, 10),
      len: Number(x && x.len) || 0,
      text: String((x && x.text) || '').replace(/\s+/g, ' ').slice(0, 160)
    })).filter((x) => Number.isInteger(x.i));
    if (!blocks.length) throw new HttpError(400, 'Paste the content first.');
    const want = new Set(blocks.filter((x) => x.kind === 'SHORT' || /^HEADING/.test(x.kind)).map((x) => x.i));
    if (!want.size) return { items: [] };
    const out = await ai.chatJSON({ system: P.headingsSystem(), user: P.headingsTask({ keyword, blocks }) });
    const items = (Array.isArray(out.items) ? out.items : [])
      .filter((x) => x && want.has(Number(x.i)) && ['h2', 'h3', 'p'].indexOf(String(x.level || '').toLowerCase()) >= 0)
      .map((x) => ({ i: Number(x.i), level: String(x.level).toLowerCase(), better: String(x.better || '').replace(/\s+/g, ' ').trim().slice(0, 90) }));
    return { items };
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

  // Meta title and description options from the overview and key highlights. Options with a number that is not
  // in the content are dropped.
  async meta(b) {
    const keyword = String(b.keyword || '').trim();
    if (!keyword) throw new HttpError(400, 'Enter the keyword first.');
    const overview = String(b.overview || '');
    const period = String(b.period || '');
    const out = await ai.chatJSON({
      system: 'You write SEO metadata for Kings Research report pages. Respond in JSON only.',
      user: P.metaTask({ keyword, overview, period, figures: String(b.figures || '') })
    });
    const source = keyword + ' ' + overview + ' ' + period;
    const clean = (list) => (Array.isArray(list) ? list : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const titles = clean(out.titles);
    const descriptions = clean(out.descriptions);
    const okTitles = titles.filter((t) => backedByContent(t, source)).slice(0, 5);
    const okDescriptions = descriptions.filter((t) => backedByContent(t, source)).slice(0, 5);
    return {
      titles: okTitles,
      descriptions: okDescriptions,
      alt: String(out.alt || ''),
      dropped: (titles.length - okTitles.length) + (descriptions.length - okDescriptions.length)
    };
  },

  async save(b, req) {
    const user = String((req && req.user) || '').trim();
    if (!user) throw new HttpError(419, 'Please sign in to continue.');
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
