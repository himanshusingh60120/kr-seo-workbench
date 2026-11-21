'use strict';
/* Paste handling: turns content pasted from Google Docs, Word, a web page, a spreadsheet cell or plain text into
   clean blocks (paragraphs with links, headings, list items, tables) used by the RD and DM tabs.
   Paragraphs must never be glued together ("period.The"), whatever the pasted HTML looks like: every block-level
   tag and every line break counts as a gap, and a table that only wraps the text is read as normal paragraphs. */
(function () {
  const KR = window.KR;
  const { $$, esc } = KR;

  const BLOCK_SEL = 'p,div,ul,ol,li,table,h1,h2,h3,h4,h5,h6,blockquote,section,article,header,footer,' +
    'main,aside,nav,pre,address,figure,figcaption,dl,dt,dd,details,summary,form,center';
  const BLOCK_TAG_RE = /^(?:P|DIV|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|PRE|ADDRESS|FIGURE|FIGCAPTION|DL|DT|DD|DETAILS|SUMMARY|FORM|CENTER|BR|HR)$/;

  // The text of a node, with a gap wherever a block-level tag or a line break separates two pieces of text.
  function rawText(node) {
    let out = '';
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) { out += ch.textContent; return; }
      if (ch.nodeType !== 1) return;
      const block = BLOCK_TAG_RE.test(ch.tagName);
      out += (block ? ' ' : '') + rawText(ch) + (block ? ' ' : '');
    });
    return out;
  }

  function textOf(node) { return rawText(node).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
  function styleOf(el) { return (el && el.getAttribute && el.getAttribute('style')) || ''; }
  function isMsoIgnore(el) { return el.nodeType === 1 && /mso-list:\s*ignore/i.test(styleOf(el)); }
  function isMsoList(el) { return /MsoListParagraph/i.test(el.getAttribute('class') || '') || /mso-list:\s*l\d/i.test(styleOf(el)); }

  function cleanHref(h) {
    if (!h) return '';
    try {
      const u = new URL(String(h).trim(), 'https://www.kingsresearch.com/');
      if (/^(www\.)?google\.[a-z.]+$/i.test(u.hostname) && u.pathname === '/url') {
        const q = u.searchParams.get('q') || u.searchParams.get('url');
        if (q) return cleanHref(q);
      }
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.href;
    } catch (e) { return ''; }
  }

  // Inline HTML keeping only text, links and sup/sub. A block-level tag met here still leaves a gap.
  function cleanInline(node) {
    let out = '';
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) { out += esc(ch.textContent.replace(/\u00a0/g, ' ')); return; }
      if (ch.nodeType !== 1) return;
      const tag = ch.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || isMsoIgnore(ch)) return;
      if (tag === 'br') { out += ' '; return; }
      if (tag === 'a') {
        const href = cleanHref(ch.getAttribute('href'));
        const inner = cleanInline(ch);
        if (href && htmlToText(inner)) out += '<a href="' + esc(href) + '">' + inner + '</a>';
        else out += inner;
        return;
      }
      if (tag === 'sup' || tag === 'sub') { out += '<' + tag + '>' + cleanInline(ch) + '</' + tag + '>'; return; }
      const block = BLOCK_TAG_RE.test(ch.tagName);
      out += (block ? ' ' : '') + cleanInline(ch) + (block ? ' ' : '');
    });
    return out.replace(/\s+/g, ' ');
  }

  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return textOf(d);
  }

  function isWholeBold(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let any = false;
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      any = true;
      let el = n.parentElement;
      let bold = false;
      while (el && root.contains(el)) {
        const fw = (styleOf(el).match(/font-weight:\s*([a-z0-9]+)/i) || [])[1];
        if (fw) { bold = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600; break; }
        const tag = el.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') { bold = true; break; }
        el = el.parentElement;
      }
      if (!bold) return false;
    }
    return any;
  }

  function splitOnBr(node) {
    if (!node.querySelector || !node.querySelector('br')) return [node];
    return node.innerHTML.split(/<br\s*\/?>/i).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d; });
  }

  // A table that only wraps running text (a spreadsheet cell holding the whole document, or a page laid out with
  // a table) is not a data table: its cells are read as normal paragraphs.
  function isLayoutTable(table, cells) {
    return cells.some((c) => textOf(c).length > 600 || c.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,br').length > 4);
  }

  function extractBlocks(root) {
    const blocks = [];
    let listSeq = 0;

    const pushPara = (node) => {
      splitOnBr(node).forEach((part) => {
        const html = cleanInline(part).trim();
        const text = htmlToText(html);
        if (text) blocks.push({ kind: 'p', html, text, bold: isWholeBold(part) });
      });
    };

    const pushLi = (li, listId) => {
      const clone = li.cloneNode(true);
      $$('ul,ol', clone).forEach((x) => x.remove());
      $$('[style]', clone).forEach((x) => { if (isMsoIgnore(x)) x.remove(); });
      const html = cleanInline(clone).trim().replace(/^\s*(?:[·•▪◦§]\s*|o\s+(?=[A-Z]))/, '');
      const text = htmlToText(html);
      if (text) blocks.push({ kind: 'li', html, text, listId });
      Array.from(li.children).forEach((ch) => { const t = ch.tagName.toLowerCase(); if (t === 'ul' || t === 'ol') visit(ch); });
    };

    const isBlockEl = (n) => n.nodeType === 1 && (n.matches(BLOCK_SEL + ',br,hr') || !!n.querySelector(BLOCK_SEL));

    function visitChildren(parent) {
      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        const d = document.createElement('div');
        buf.forEach((n) => d.appendChild(n.cloneNode(true)));
        buf = [];
        if (textOf(d)) pushPara(d);
      };
      Array.from(parent.childNodes).forEach((n) => {
        if (n.nodeType === 8) return;
        // A line break ends the paragraph being collected.
        if (n.nodeType === 1 && n.tagName === 'BR') { flush(); return; }
        if (n.nodeType === 3 || (n.nodeType === 1 && !isBlockEl(n))) { buf.push(n); return; }
        flush();
        if (n.nodeType === 1) visit(n);
      });
      flush();
    }

    function visit(node) {
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'title', 'head', 'xml', 'svg', 'img', 'br', 'hr'].indexOf(tag) >= 0 || tag.indexOf(':') >= 0 || isMsoIgnore(node)) return;
      if (tag === 'table') {
        const cells = Array.from(node.querySelectorAll('td,th')).filter((c) => c.closest('table') === node);
        if (isLayoutTable(node, cells)) { cells.forEach((c) => visitChildren(c)); return; }
        const rows = Array.from(node.rows || []).map((tr) => Array.from(tr.cells).map((td) => textOf(td))).filter((r) => r.some(Boolean));
        if (rows.length) blocks.push({ kind: 'table', rows, text: '' });
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        const id = 'l' + (++listSeq);
        Array.from(node.children).forEach((ch) => {
          if (ch.tagName.toLowerCase() === 'li') pushLi(ch, id);
          else visit(ch);
        });
        return;
      }
      if (tag === 'li') { pushLi(node, 'l' + (++listSeq)); return; }
      if (/^h[1-6]$/.test(tag)) {
        const t = textOf(node);
        if (t) blocks.push({ kind: 'h', level: Number(tag[1]), html: esc(t), text: t });
        return;
      }
      if (isMsoList(node)) { pushLi(node, 'mso'); return; }
      if (node.querySelector(BLOCK_SEL) || node.querySelector('br')) { visitChildren(node); return; }
      pushPara(node);
    }

    visitChildren(root);
    return blocks;
  }

  function textToBlocks(text) {
    return String(text || '').split(/\r?\n|\t/).map((l) => l.replace(/\u00a0/g, ' ').trim()).filter(Boolean)
      .map((l) => ({ kind: 'p', html: esc(l), text: l, bold: false }));
  }

  function blocksToEditorHtml(blocks) {
    let html = '';
    let openList = null;
    blocks.forEach((b) => {
      if (b.kind === 'li') {
        if (openList !== b.listId) { if (openList) html += '</ul>'; html += '<ul>'; openList = b.listId; }
        html += '<li>' + b.html + '</li>';
        return;
      }
      if (openList) { html += '</ul>'; openList = null; }
      if (b.kind === 'h') html += '<h' + b.level + '>' + b.html + '</h' + b.level + '>';
      else if (b.kind === 'table') html += '<table>' + b.rows.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table>';
      else html += b.bold ? '<p><strong>' + b.html + '</strong></p>' : '<p>' + b.html + '</p>';
    });
    if (openList) html += '</ul>';
    return html;
  }

  function blocksToText(blocks) {
    return blocks.map((b) => {
      if (b.kind === 'li') return '- ' + b.text;
      if (b.kind === 'table') return b.rows.map((r) => r.join(' | ')).join('\n');
      if (b.kind === 'h') return '#'.repeat(Math.min(b.level, 3)) + ' ' + b.text;
      return b.text;
    }).join('\n');
  }

  function wordCount(text) { return (String(text || '').match(/[A-Za-z0-9][A-Za-z0-9'&.-]*/g) || []).length; }

  function updateStats(el) {
    const target = KR.$('#' + el.dataset.stats);
    if (!target) return;
    const words = wordCount(textOf(el));
    const links = el.querySelectorAll('a[href]').length;
    target.textContent = words ? words.toLocaleString('en-US') + ' words · ' + links + ' links' : '';
  }

  function setupPaste(el, statsId) {
    el.dataset.stats = statsId;
    el.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      e.preventDefault();
      const html = cd.getData('text/html');
      const text = cd.getData('text/plain');
      let blocks;
      if (html && /<[a-z][\s\S]*>/i.test(html)) blocks = extractBlocks(new DOMParser().parseFromString(html, 'text/html').body);
      else blocks = textToBlocks(text);
      // If the HTML gave fewer paragraphs than the plain text has lines (the page hid its paragraph breaks from us),
      // the plain text is the better guide to where paragraphs end.
      const lines = textToBlocks(text);
      if (html && blocks.length < 3 && lines.length > blocks.length * 3) {
        blocks = lines;
        KR.toast('Pasted as plain text because the paragraph breaks could not be read from the source: hyperlinks were not captured.');
      }
      const out = blocksToEditorHtml(blocks);
      let ok = false;
      try { ok = document.execCommand('insertHTML', false, out); } catch (err) { ok = false; }
      if (!ok) el.insertAdjacentHTML('beforeend', out);
      if (!html) KR.toast('Pasted as plain text: hyperlinks were not captured. Paste straight from Google Docs or Word to keep links.');
      updateStats(el);
    });
    el.addEventListener('input', () => updateStats(el));
  }

  function clearPaste(el) { el.innerHTML = ''; updateStats(el); }

  KR.blocks = { extractBlocks, blocksToText, blocksToEditorHtml, textOf, htmlToText, cleanHref, setupPaste, clearPaste, wordCount };
})();