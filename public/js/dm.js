'use strict';
/* DM tab: structure pasted content into the Kings Research report HTML format (H2/H3, segmentation table,
   lists), add internal links (KR-Interlinker logic), place one or more draggable images (alt text only inside
   each image's HTML alt attribute), and produce the CMS boxes: meta title, meta description and HTML source. */
(function () {
  const KR = window.KR;
  const { $, $$, esc } = KR;
  const B = KR.blocks;
  const D = (KR.state.dm = { units: [], links: [], imgs: [], keyword: '', period: '2026-2033' });

  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const H2_SET = ['market overview', 'key market highlights', 'market dynamics', 'market segmentation', 'segmental analysis', 'regional analysis', 'competitive landscape', 'research methodology', 'frequently asked questions'];
  const SECTION_OF = { 'key market highlights': 'highlights', 'market dynamics': 'dynamics', 'market segmentation': 'segmentation', 'segmental analysis': 'segmental', 'regional analysis': 'regional', 'competitive landscape': 'competitive', 'research methodology': 'methodology', 'frequently asked questions': 'faq' };
  const H3_SET = ['how we gather this information', 'custom offerings'];
  const STD_IMAGES = [
    { src: 'https://app.kingsresearch.com/uploads/media/1785508246086-research-methodology.webp', alt: 'Kings Research research methodology', after: 'how we gather this information' },
    { src: 'https://app.kingsresearch.com/uploads/media/1785832495783-why-kings-research.webp', alt: 'Why choose Kings Research', after: 'custom offerings' }
  ];
  const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'their', 'which', 'when', 'what', 'your', 'about', 'more', 'into', 'than', 'also', 'some', 'other', 'these', 'those', 'such', 'most', 'like', 'just', 'over', 'after', 'before', 'then', 'each', 'only', 'even', 'well', 'back', 'very', 'much', 'both', 'through', 'should', 'could', 'would', 'make', 'made', 'being', 'there', 'where', 'here', 'were', 'them', 'many', 'come', 'work', 'need', 'take', 'used', 'uses', 'using', 'market', 'markets', 'global', 'growth', 'demand', 'industry']);
  const GENERIC = new Set(['market', 'markets', 'industry', 'global', 'size', 'share', 'report', 'analysis', 'trends', 'growth', 'forecast', 'and', 'the', 'for', 'with']);

  // ---------- segmentation table ----------
  function tokensToRows(tok) {
    const rows = [];
    let i = 0;
    if (/^segmentation$/i.test(tok[0] || '')) { rows.push([tok[0], tok[1] || 'Details']); i = 2; }
    else rows.push(['Segmentation', 'Details']);
    while (i < tok.length) {
      const t = tok[i];
      if (/^by region/i.test(t)) {
        i++;
        let first = true;
        while (i < tok.length && !/^by /i.test(tok[i])) {
          const name = tok[i];
          const val = tok[i + 1] || '';
          rows.push(first ? [t, name, val] : [name, val]);
          first = false;
          i += 2;
        }
        if (first) rows.push([t, '']);
      } else {
        rows.push([t, tok[i + 1] || '']);
        i += 2;
      }
    }
    return rows;
  }

  function segCell(text, attrs, strong) {
    return '<td' + attrs + '>\n<p>' + (strong ? '<strong>' : '') + '<span>' + esc(text) + '</span>' + (strong ? '</strong>' : '') + '</p>\n</td>';
  }

  function renderSegTable(rows) {
    const head = rows[0];
    let body = rows.slice(1).filter((r) => r.some((c) => String(c).trim()));
    let groupLabel = null;
    body = body.map((r) => {
      if (r.length >= 3) {
        if (groupLabel !== null && (r[0] === groupLabel || r[0] === '')) return [r[1], r[2]];
        groupLabel = r[0];
        return r;
      }
      if (/^by /i.test(r[0])) groupLabel = null;
      return r;
    });
    let html = '<table width="936">\n<thead>\n<tr>\n' + segCell(head[0], ' width="220"', true) + '\n' + segCell(head[1] || 'Details', ' colspan="2" width="716"', true) + '\n</tr>\n</thead>\n<tbody>\n';
    for (let i = 0; i < body.length; i++) {
      const r = body[i];
      if (r.length >= 3) {
        let span = 1;
        while (i + span < body.length && body[i + span].length === 2 && !/^by /i.test(body[i + span][0])) span++;
        html += '<tr>\n' + segCell(r[0], ' rowspan="' + span + '" width="220"', true) + '\n' + segCell(r[1], ' width="240"') + '\n' + segCell(r[2], ' width="476"') + '\n</tr>\n';
        for (let k = 1; k < span; k++) {
          const c = body[i + k];
          html += '<tr>\n' + segCell(c[0], ' width="240"') + '\n' + segCell(c[1], ' width="476"') + '\n</tr>\n';
        }
        i += span - 1;
      } else {
        html += '<tr>\n' + segCell(r[0], ' width="220"', true) + '\n' + segCell(r[1] || '', ' colspan="2" width="716"') + '\n</tr>\n';
      }
    }
    return html + '</tbody>\n</table>';
  }

  function renderTable(rows) {
    if (rows.length && /segment/i.test(rows[0][0] || '')) return renderSegTable(rows);
    return '<table>\n<tbody>\n' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('\n') + '\n</tbody>\n</table>';
  }

  // ---------- classify pasted blocks into report units ----------
  function classify(raw, keyword) {
    const units = [];
    let section = 'intro';
    let h2Count = 0;
    let lastH3 = '';
    let seg = null;
    const monthRe = new RegExp('^In (' + MONTHS + ') \\d{4},');
    const pushLi = (html, text, listId) => {
      const last = units[units.length - 1];
      if (last && last.type === 'ul' && last.listId === listId) last.items.push({ html, text });
      else units.push({ type: 'ul', listId, items: [{ html, text }], section, sub: lastH3 });
    };
    const flushSeg = () => {
      if (seg && seg.length) units.push({ type: 'table', rows: tokensToRows(seg), section: 'segmentation' });
      seg = null;
    };
    raw.forEach((b) => {
      if (b.kind === 'table') { flushSeg(); units.push({ type: 'table', rows: b.rows, section }); return; }
      const t = String(b.text || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const clean = t.replace(/[:\uFF1A]\s*$/, '');
      const tl = clean.toLowerCase();
      const short = clean.length <= 90 && b.kind !== 'li';
      const isH2 = short && (H2_SET.indexOf(tl) >= 0 || (h2Count === 0 && /\boverview$/i.test(clean)));
      if (isH2) {
        flushSeg();
        h2Count++;
        lastH3 = '';
        section = SECTION_OF[tl] || (/overview$/i.test(clean) ? 'overview' : 'other');
        units.push({ type: 'h2', text: section === 'overview' && keyword ? keyword + ' Overview' : clean, section });
        return;
      }
      if (section === 'segmentation') { (seg = seg || []).push(clean); return; }
      if (b.kind !== 'li' && (H3_SET.indexOf(tl) >= 0 || (/\?$/.test(clean) && clean.length <= 220) || (b.kind === 'h' && b.level >= 3))) {
        units.push({ type: 'h3', text: clean, section });
        lastH3 = tl;
        return;
      }
      if (b.kind === 'h') {
        units.push({ type: b.level <= 2 ? 'h2' : 'h3', text: clean, section });
        if (b.level > 2) lastH3 = tl;
        return;
      }
      if (b.kind === 'li') { pushLi(b.html, t, b.listId + ':' + section); return; }
      if (section === 'highlights') { pushLi(b.html, t, 'hl'); return; }
      if (/key (companies|players)/.test(lastH3) && clean.length <= 120) { pushLi(b.html, t, 'kc'); return; }
      const prev = units[units.length - 1];
      if (section === 'competitive' && monthRe.test(clean) && prev && prev.type !== 'h3') { pushLi(b.html, t, 'cl'); return; }
      if ((section === 'regional' && clean.length <= 80 && !/[.?!:;,]$/.test(clean) && b.html.indexOf('<a ') < 0) || (b.bold && clean.length <= 80)) {
        units.push({ type: 'pstrong', text: clean, section });
        return;
      }
      units.push({ type: 'p', html: b.html, text: t, section, sub: lastH3 });
    });
    flushSeg();
    return units;
  }

  function finalizeUnits(units, withStd) {
    units.forEach((u) => {
      u.eligible = (u.type === 'p' || u.type === 'ul') &&
        ['intro', 'dynamics', 'segmental', 'regional', 'competitive', 'other'].indexOf(u.section) >= 0 &&
        !(u.type === 'ul' && (u.listId === 'kc' || /key (companies|players)/.test(u.sub || '')));
    });
    if (withStd) {
      STD_IMAGES.forEach((img) => {
        const hi = units.findIndex((u) => u.type === 'h3' && u.text.toLowerCase() === img.after);
        let pos = units.length;
        if (hi >= 0) { pos = hi + 1; while (pos < units.length && units[pos].type === 'p') pos++; }
        units.splice(pos, 0, { type: 'stdimg', src: img.src, alt: img.alt, section: 'methodology' });
      });
    }
    return units;
  }

  // Image k (0 = infographic) goes just before the (k+2)-th H2: the first after the Overview, the next after the
  // following section, and so on. Without headings, the first image goes after the first paragraph.
  function defaultPositions(units, n) {
    const h2 = [];
    units.forEach((u, i) => { if (u.type === 'h2') h2.push(i); });
    const out = [];
    for (let k = 0; k < n; k++) {
      if (h2[k + 1] !== undefined) out.push(h2[k + 1]);
      else if (k === 0 && h2.length < 2) {
        const p = units.findIndex((u) => u.type === 'p');
        out.push(p >= 0 ? p + 1 : units.length);
      } else out.push(units.length);
    }
    return out;
  }

  // ---------- image inputs ----------
  function imageRowHtml(n) {
    return '<div class="paste-head"><span><b>Image ' + n + '</b>' + (n === 1 ? ' <span class="hint">(infographic)</span>' : '') + '</span><button type="button" class="btn tiny ghost dm-img-del">Remove</button></div>' +
      '<div class="grid2"><label>Image URL (.jpg or .webp)<input class="dm-img-url" type="url" placeholder="https://app.kingsresearch.com/uploads/media/....jpg"></label>' +
      '<label>Alt text <span class="hint">(leave empty for automatic)</span><input class="dm-img-alt" type="text"></label></div>';
  }

  function addImageRow() {
    const box = $('#dmImages');
    const row = document.createElement('div');
    row.className = 'group dm-img-row';
    row.innerHTML = imageRowHtml($$('.dm-img-row', box).length + 1);
    box.appendChild(row);
    renumberRows();
    return row;
  }

  function renumberRows() {
    $$('#dmImages .dm-img-row').forEach((row, i) => {
      const b = $('.paste-head b', row);
      if (b) b.textContent = 'Image ' + (i + 1);
      const hint = $('.paste-head .hint', row);
      if (i === 0 && !hint) $('.paste-head span', row).insertAdjacentHTML('beforeend', ' <span class="hint">(infographic)</span>');
      if (i > 0 && hint) hint.remove();
    });
  }

  function readImageInputs() {
    return $$('#dmImages .dm-img-row').map((row) => ({ url: $('.dm-img-url', row).value.trim(), alt: $('.dm-img-alt', row).value.trim() })).filter((x) => x.url);
  }

  function altFromUrl(url) {
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) { name = ''; }
    name = name.replace(/\.[a-z0-9]+$/i, '').replace(/^\d{6,}[-_]?/, '').replace(/[-_]+/g, ' ').trim();
    return name ? KR.titleCase(name) : '';
  }

  function defaultAlt(k, url) {
    if (k === 0) return D.keyword + ' Size & Share, By Revenue, ' + D.period;
    const fromName = altFromUrl(url);
    return fromName || (D.keyword + ' ' + (k + 1));
  }

  // Alt text edits after Optimize are applied straight to the HTML.
  function syncAlts() {
    if (!D.units.length || !D.imgs.length) return;
    const inputs = readImageInputs();
    D.imgs.forEach((im, k) => {
      const inp = inputs[k];
      if (inp && inp.url === im.src) im.alt = inp.alt || defaultAlt(k, im.src);
    });
    renderDm();
  }

  // ---------- interlinks ----------
  function preFilter(content, keyword, max) {
    const lower = content.toLowerCase();
    const words = new Set((lower.match(/\b[a-z][a-z0-9-]{3,}\b/g) || []).filter((w) => !STOP.has(w)));
    const self = keyword.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const selfCore = self.replace(/\s+market$/, '');
    return (KR.state.siteLinks || []).filter((l) => l.kw && l.kw !== self && l.kw.replace(/\s+market$/, '') !== selfCore).map((l) => {
      const kws = l.kw.split(/\s+/).filter((w) => w.length > 3 && !GENERIC.has(w));
      if (!kws.length) return null;
      let score = 0;
      let hits = 0;
      kws.forEach((w) => {
        if (words.has(w)) { score += 2; hits++; }
        else if (words.has(w.replace(/s$/, '')) || words.has(w + 's')) { score += 1.5; hits++; }
      });
      if (!hits) return null;
      score *= hits / kws.length;
      const phrase = l.kw.replace(/\s+market$/, '');
      if (phrase.length > 3 && lower.indexOf(phrase) >= 0) score += 6;
      if (l.type === 'report') score += 0.5;
      return Object.assign({}, l, { score });
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, max);
  }

  function findWord(text, word, ci) {
    const re = new RegExp('(^|[^A-Za-z0-9])(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=[^A-Za-z0-9]|$)', ci ? 'i' : '');
    const m = re.exec(text);
    return m ? m.index + m[1].length : -1;
  }

  function linkify(html, anchor, url) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const ci of [false, true]) {
      for (const node of nodes) {
        if (node.parentElement && node.parentElement.closest('a')) continue;
        const idx = findWord(node.nodeValue, anchor, ci);
        if (idx < 0) continue;
        const target = node.splitText(idx);
        target.splitText(anchor.length);
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('data-il', '1');
        target.parentNode.insertBefore(a, target);
        a.appendChild(target);
        return box.innerHTML;
      }
    }
    return null;
  }

  function applyLinks(units, links) {
    const out = units.map((u) => Object.assign({}, u, u.items ? { items: u.items.map((it) => Object.assign({}, it)) } : {}));
    const applied = [];
    (links || []).forEach((L) => {
      if (!L.enabled) return;
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (!u.eligible) continue;
        if (u.type === 'p') {
          const r = linkify(u.html, L.anchor, L.url);
          if (r) { u.html = r; applied.push(L); return; }
        } else if (u.type === 'ul') {
          for (const it of u.items) {
            const r = linkify(it.html, L.anchor, L.url);
            if (r) { it.html = r; applied.push(L); return; }
          }
        }
      }
    });
    return { units: out, applied };
  }

  // ---------- HTML output ----------
  function decorateLinks(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    $$('a', box).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const internal = /^https?:\/\/([a-z0-9-]+\.)*kingsresearch\.com/i.test(href);
      const clean = document.createElement('a');
      clean.setAttribute('href', href);
      if (!internal) { clean.setAttribute('target', '_blank'); clean.setAttribute('rel', 'noopener noreferrer'); }
      while (a.firstChild) clean.appendChild(a.firstChild);
      const span = document.createElement('span');
      span.appendChild(clean);
      a.replaceWith(span);
    });
    return box.innerHTML;
  }

  function imgTag(src, alt, w, h) {
    return '<p><img style="display: block; margin-left: auto; margin-right: auto;" src="' + esc(src) + '" alt="' + esc(alt) + '"' + (w ? ' width="' + w + '"' : '') + (h ? ' height="' + h + '"' : '') + ' /></p>';
  }

  function unitHtml(u) {
    switch (u.type) {
      case 'h2': return '<h2><strong>' + esc(u.text) + '</strong></h2>';
      case 'h3': return '<h3><strong>' + esc(u.text) + '</strong></h3>';
      case 'pstrong': return '<p><strong>' + esc(u.text) + '</strong></p>';
      case 'p': return '<p>' + decorateLinks(u.html) + '</p>';
      case 'ul': return '<ul>\n' + u.items.map((it) => '<li>' + decorateLinks(it.html) + '</li>').join('\n') + '\n</ul>';
      case 'table': return renderTable(u.rows);
      case 'stdimg': return imgTag(u.src, u.alt, 1000, 563);
      default: return '';
    }
  }

  function imagesAt(pos, total) {
    const out = [];
    D.imgs.forEach((im, k) => {
      const p = Math.max(0, Math.min(total, im.pos));
      if (p === pos) out.push({ im, k });
    });
    return out;
  }

  function buildSource() {
    if (!D.units.length) return '';
    const units = applyLinks(D.units, D.links).units;
    const parts = [];
    units.forEach((u, i) => {
      imagesAt(i, units.length).forEach((x) => parts.push(imgTag(x.im.src, x.im.alt, x.im.w, x.im.h)));
      parts.push(unitHtml(u));
    });
    imagesAt(units.length, units.length).forEach((x) => parts.push(imgTag(x.im.src, x.im.alt, x.im.w, x.im.h)));
    return parts.join('\n');
  }

  function previewImg(im, k) {
    return '<div class="pv-img" draggable="true" data-img="' + k + '" title="Drag to move"><div class="pv-img-bar"><span>Image ' + (k + 1) + (k === 0 ? ' (infographic)' : '') + ': drag to move</span>' +
      '<button type="button" data-mv="-1" data-img="' + k + '" title="Move up">&#9650;</button><button type="button" data-mv="1" data-img="' + k + '" title="Move down">&#9660;</button></div>' +
      '<img src="' + esc(im.src) + '" alt="' + esc(im.alt) + '"></div>';
  }

  function renderPreview() {
    const box = $('#dmPreview');
    if (!D.units.length) { box.innerHTML = '<p class="hint">Run Optimize first.</p>'; return; }
    const units = applyLinks(D.units, D.links).units;
    let html = '';
    units.forEach((u, i) => {
      imagesAt(i, units.length).forEach((x) => { html += previewImg(x.im, x.k); });
      html += '<div class="pv-unit" data-i="' + i + '">' + unitHtml(u) + '</div>';
    });
    imagesAt(units.length, units.length).forEach((x) => { html += previewImg(x.im, x.k); });
    html += '<div class="pv-end" data-i="' + units.length + '">Drop here to place an image at the end</div>';
    box.innerHTML = html;
    // A broken image shows a clear note instead of its alt text, so alt text never appears as page text in the preview.
    $$('img', box).forEach((im) => {
      im.setAttribute('draggable', 'false');
      im.addEventListener('error', () => {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'This image could not be loaded. Check the URL: ' + im.getAttribute('src');
        im.replaceWith(note);
      });
    });
  }

  function renderLinksTable() {
    const box = $('#dmLinksTable');
    if (!D.units.length) { box.innerHTML = ''; return; }
    if (!D.links.length) { box.innerHTML = '<p class="hint">No internal links were added.</p>'; return; }
    const placed = new Set(applyLinks(D.units, D.links).applied.map((l) => l.url));
    box.innerHTML = '<h3>Internal links (' + placed.size + ' placed)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Use</th><th>Anchor text</th><th>Target page</th><th>Type</th><th>Why</th></tr></thead><tbody>' +
      D.links.map((l, i) => '<tr class="' + (l.enabled && !placed.has(l.url) ? 'warn-row' : '') + '"><td><input type="checkbox" data-li="' + i + '"' + (l.enabled ? ' checked' : '') + '></td><td><b>' + esc(l.anchor) + '</b></td>' +
        '<td class="small"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.url) + '</a></td><td><span class="tag ' + esc(l.type) + '">' + esc(l.type) + '</span></td>' +
        '<td class="small">' + esc(l.reason) + (l.enabled && !placed.has(l.url) ? ' <b>(anchor not found in an eligible paragraph)</b>' : '') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function updateCounters() {
    const t = $('#dmMetaTitle').value.trim().length;
    const d = $('#dmMetaDesc').value.trim().length;
    const tc = $('#dmTitleCount');
    const dc = $('#dmDescCount');
    tc.textContent = t + ' / 60 characters';
    tc.classList.toggle('bad', t > 60 || (t > 0 && t < 30));
    dc.textContent = d + ' / 160 characters';
    dc.classList.toggle('bad', d > 160 || (d > 0 && d < 70));
  }

  function renderDm() {
    renderLinksTable();
    renderPreview();
    $('#dmSource').value = buildSource();
    updateCounters();
  }

  function overviewText() {
    return D.units.filter((u) => u.section === 'overview' && u.type === 'p').map((u) => u.text).join(' ');
  }

  function setMetaDefaults() {
    const kw = D.keyword;
    const end = String(D.period).split('-')[1] || '2033';
    let title = kw + ' Trends, Growth & Insights ' + end;
    if (title.length > 60) title = kw + ' Size, Share & Forecast ' + end;
    if (title.length > 60) title = kw + ' Report ' + end;
    const ov = overviewText().replace(/[\u2013\u2014]/g, '-');
    const m = ov.match(/grow from USD ([\d.,]+ (?:trillion|billion|million)) in (\d{4}) to USD ([\d.,]+ (?:trillion|billion|million)) by (?:the end of )?(\d{4}),? (?:exhibiting|registering|growing at|at) (?:a )?CAGR of ([\d.]+) ?%/i);
    const desc = m
      ? 'The ' + KR.lowerKw(kw) + ' is projected to grow from USD ' + m[1] + ' in ' + m[2] + ' to USD ' + m[3] + ' by ' + m[4] + ', registering a CAGR of ' + m[5] + '%.'
      : 'Explore the ' + KR.lowerKw(kw) + ' size, share, growth drivers, segments, regional trends and key companies, with forecasts to ' + end + '.';
    $('#dmMetaTitle').value = title;
    $('#dmMetaDesc').value = desc;
  }

  function imageSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    });
  }

  async function optimize() {
    const btn = $('#dmOptimize');
    const prog = KR.progress('#dmProgress');
    try {
      const kwRaw = $('#dmKeyword').value.trim();
      if (!kwRaw) throw new Error('Enter the keyword this content is about (for example: Genetic Engineering Market).');
      const keyword = KR.titleCase(kwRaw);
      const raw = B.extractBlocks($('#dmContent'));
      if (raw.length < 3) throw new Error('Paste the content first.');
      const inputs = readImageInputs();
      inputs.forEach((x) => { if (!/^https?:\/\//i.test(x.url)) throw new Error('Image URLs must start with https:// (' + x.url + ').'); });
      KR.busy(btn, true, 'Optimizing…');
      let s = prog.step('Structuring the content and adding H-tags…');
      const units = finalizeUnits(classify(raw, keyword), $('#dmStdImgs').checked);
      D.units = units;
      D.links = [];
      D.keyword = keyword;
      const count = (type) => units.filter((u) => u.type === type).length;
      s.done('Structured: ' + count('h2') + ' H2, ' + count('h3') + ' H3, ' + count('ul') + ' lists, ' + count('table') + ' table(s)');
      if (!count('table')) prog.info('No segmentation table was detected. Check that the "Market Segmentation" section was pasted.');

      const yrs = overviewText().match(/\((\d{4})\s*[-\u2013\u2014]\s*(\d{4})\)/);
      D.period = yrs ? yrs[1] + '-' + yrs[2] : '2026-2033';

      D.imgs = [];
      if (inputs.length) {
        s = prog.step('Loading ' + inputs.length + ' image' + (inputs.length === 1 ? '' : 's') + '…');
        const dims = await Promise.all(inputs.map((x) => imageSize(x.url)));
        const pos = defaultPositions(units, inputs.length);
        const failed = [];
        inputs.forEach((x, k) => {
          const d = dims[k];
          const w = d ? Math.min(1000, d.w) : 0;
          D.imgs.push({ src: x.url, alt: x.alt || defaultAlt(k, x.url), w, h: d && w ? Math.round(w * d.h / d.w) : 0, pos: pos[k] });
          if (!d) failed.push(x.url);
          if (!/\.(jpe?g|webp|png)(\?|$)/i.test(x.url)) prog.info('Image ' + (k + 1) + ' does not end in .jpg, .webp or .png. Make sure it is an image file.');
        });
        if (failed.length) s.fail(failed.length + ' image(s) did not load in the browser (they are still added to the HTML): ' + failed.join(', '));
        else s.done(inputs.length + ' image' + (inputs.length === 1 ? '' : 's') + ' placed (the first after the Overview). Drag them in Preview to move.');
      } else {
        prog.info('No image URL given, so no images were added.');
      }

      s = prog.step('Loading the Kings Research sitemaps (reports, blogs, press releases)…');
      if (!KR.state.siteLinks) {
        const r = await KR.api('dm', 'links');
        KR.state.siteLinks = r.links.map((x) => ({ url: x[0], kw: x[1], type: x[2] }));
      }
      s.done('Sitemaps: ' + KR.state.siteLinks.length.toLocaleString('en-US') + ' pages');

      const eligibleText = units.filter((u) => u.eligible).map((u) => (u.type === 'ul' ? u.items.map((it) => it.text).join('\n') : u.text)).join('\n\n');
      const candidates = preFilter(eligibleText, keyword, 180);
      if (!candidates.length) prog.info('No related internal pages were found for interlinking.');
      else {
        s = prog.step('AI: choosing internal links from ' + candidates.length + ' related pages…');
        const r = await KR.api('dm', 'interlink', {
          keyword,
          count: Number($('#dmCount').value) || 6,
          content: eligibleText.slice(0, 9000),
          links: candidates.map((l, i) => i + '. [' + l.type.toUpperCase() + '] ' + l.kw).join('\n')
        });
        const seen = new Set();
        const anchors = new Set();
        const lowerText = eligibleText.toLowerCase();
        D.links = (r.suggestions || []).map((x) => {
          const c = candidates[x.id];
          const a = String(x.anchor || '').trim();
          if (!c || !a || seen.has(c.url) || anchors.has(a.toLowerCase()) || lowerText.indexOf(a.toLowerCase()) < 0) return null;
          if (a.toLowerCase().indexOf(keyword.toLowerCase()) >= 0) return null;
          seen.add(c.url);
          anchors.add(a.toLowerCase());
          return { anchor: a, url: c.url, type: c.type, reason: x.reason || '', enabled: true };
        }).filter(Boolean);
        s.done('Internal links: ' + applyLinks(D.units, D.links).applied.length + ' placed');
      }
      setMetaDefaults();
      renderDm();
      KR.showSub('dm', 'dm-preview');
      KR.toast('Optimized. Move the images in Preview if needed, then open "CMS boxes" to copy the meta title, meta description and HTML.', 'ok');
    } catch (e) {
      prog.error(e.message);
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  function moveImage(k, pos) {
    const im = D.imgs[k];
    if (!im) return;
    im.pos = Math.max(0, Math.min(D.units.length, pos));
    renderDm();
  }

  function initPreviewDnD() {
    const box = $('#dmPreview');
    let dragIdx = -1;
    const clearDrop = () => $$('.drop-before, .drop-after', box).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    box.addEventListener('dragstart', (e) => {
      const blk = e.target.closest ? e.target.closest('.pv-img') : null;
      if (!blk) return;
      dragIdx = Number(blk.getAttribute('data-img'));
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'kr-image-' + dragIdx); } catch (err) { /* ignore */ }
    });
    box.addEventListener('dragend', () => { dragIdx = -1; clearDrop(); });
    box.addEventListener('dragover', (e) => {
      if (dragIdx < 0) return;
      const t = e.target.closest('.pv-unit, .pv-end');
      if (!t) return;
      e.preventDefault();
      clearDrop();
      if (t.classList.contains('pv-end')) { t.classList.add('drop-before'); return; }
      const r = t.getBoundingClientRect();
      t.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    box.addEventListener('drop', (e) => {
      if (dragIdx < 0) return;
      const t = e.target.closest('.pv-unit, .pv-end');
      if (!t) return;
      e.preventDefault();
      let i = Number(t.dataset.i);
      if (t.classList.contains('drop-after')) i += 1;
      const k = dragIdx;
      dragIdx = -1;
      clearDrop();
      moveImage(k, i);
    });
    box.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const k = Number(mv.getAttribute('data-img'));
        if (D.imgs[k]) moveImage(k, D.imgs[k].pos + Number(mv.getAttribute('data-mv')));
        return;
      }
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); window.open(a.getAttribute('href'), '_blank', 'noopener'); }
    });
  }

  async function aiMeta(btn) {
    try {
      if (!D.units.length) throw new Error('Run Optimize first.');
      KR.busy(btn, true, 'Thinking…');
      const r = await KR.api('dm', 'meta', { keyword: D.keyword, overview: overviewText(), period: D.period });
      const chips = (list, field) => list.map((t) => '<button class="chip" type="button" data-fill="' + field + '" data-val="' + esc(t) + '">' + esc(t) + '<small>' + t.length + ' chars</small></button>').join('');
      $('#dmMetaSuggest').innerHTML = (r.titles.length ? '<h3>Title options (click to use)</h3><div class="chips">' + chips(r.titles, 'dmMetaTitle') + '</div>' : '') +
        (r.descriptions.length ? '<h3>Description options (click to use)</h3><div class="chips">' + chips(r.descriptions, 'dmMetaDesc') + '</div>' : '');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  async function saveDm(btn) {
    try {
      const user = KR.requireUser();
      if (!D.units.length) throw new Error('Run Optimize first.');
      const applied = applyLinks(D.units, D.links).applied;
      const words = B.wordCount(D.units.map((u) => (u.items ? u.items.map((i) => i.text).join(' ') : (u.text || ''))).join(' '));
      KR.busy(btn, true, 'Saving…');
      await KR.api('dm', 'save', {
        user,
        keyword: D.keyword,
        image: D.imgs.map((im) => im.src).join('\n'),
        alt: D.imgs.map((im) => im.alt).join('\n'),
        metaTitle: $('#dmMetaTitle').value.trim(),
        metaDescription: $('#dmMetaDesc').value.replace(/\s+/g, ' ').trim(),
        interlinks: applied.map((l) => l.anchor + ' -> ' + l.url).join('\n'),
        h2: D.units.filter((u) => u.type === 'h2').length,
        h3: D.units.filter((u) => u.type === 'h3').length,
        words
      });
      KR.toast('Saved to the DM sheet.', 'ok');
    } catch (e) {
      KR.toast(e.message, 'err');
    } finally {
      KR.busy(btn, false);
    }
  }

  KR.initDm = () => {
    B.setupPaste($('#dmContent'), 'dmStats');
    $('#dmClear').addEventListener('click', () => B.clearPaste($('#dmContent')));
    addImageRow();
    $('#dmAddImg').addEventListener('click', () => { const row = addImageRow(); $('.dm-img-url', row).focus(); });
    $('#dmImages').addEventListener('click', (e) => {
      const del = e.target.closest('.dm-img-del');
      if (!del) return;
      const rows = $$('#dmImages .dm-img-row');
      const row = del.closest('.dm-img-row');
      if (rows.length <= 1) { $('.dm-img-url', row).value = ''; $('.dm-img-alt', row).value = ''; }
      else row.remove();
      renumberRows();
    });
    $('#dmImages').addEventListener('input', (e) => { if (e.target.classList.contains('dm-img-alt')) syncAlts(); });
    $('#dmOptimize').addEventListener('click', optimize);
    $('#dmLinksTable').addEventListener('change', (e) => {
      const i = e.target.dataset.li;
      if (i === undefined) return;
      D.links[Number(i)].enabled = e.target.checked;
      renderDm();
    });
    $('#dmMetaTitle').addEventListener('input', updateCounters);
    $('#dmMetaDesc').addEventListener('input', updateCounters);
    $('#dmCopyTitle').addEventListener('click', (e) => KR.copy($('#dmMetaTitle').value.trim(), e.currentTarget));
    $('#dmCopyDesc').addEventListener('click', (e) => KR.copy($('#dmMetaDesc').value.replace(/\s+/g, ' ').trim(), e.currentTarget));
    $('#dmCopyHtml').addEventListener('click', (e) => KR.copy($('#dmSource').value, e.currentTarget));
    $('#dmMetaAi').addEventListener('click', (e) => aiMeta(e.currentTarget));
    $('#dmSave').addEventListener('click', (e) => saveDm(e.currentTarget));
    $('#dmMetaSuggest').addEventListener('click', (e) => {
      const c = e.target.closest('[data-fill]');
      if (!c) return;
      $('#' + c.dataset.fill).value = c.dataset.val;
      updateCounters();
    });
    initPreviewDnD();
    KR.hooks.sub['dm-preview'] = renderDm;
    KR.hooks.sub['dm-source'] = renderDm;
  };
})();
