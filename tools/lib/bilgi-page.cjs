'use strict';

// Üretilen bilgi sayfaları için ortak kabuk: bilgi/mevzuat-kutuphanesi.html'in <head> başı, site başlığı ve
// alt bilgisi alınır; sayfaya özgü <head> sonu (meta, stil, JSON-LD) ile breadcrumb…</main> arası değiştirilir.
// Kabuk bölgelerini tools/shell.py yönetir; burada yalnızca şablondan kopyalanır.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');

const rev = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);

const noCurrent = s => s.replace(/ aria-current="(?:page|true)"/g, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function compose({ head, main }) {
  // Menüdeki aria-current şablon sayfasına aittir; doğrusunu tools/shell.py sayfa adresine göre yazar
  const tpl = noCurrent(fs.readFileSync(path.join(root, 'bilgi/mevzuat-kutuphanesi.html'), 'utf8').replace(/\r\n/g, '\n'));
  const h0 = tpl.indexOf('  <meta name="color-scheme"'), h1 = tpl.indexOf('</head>') + '</head>'.length;
  const m0 = tpl.indexOf('  <nav class="breadcrumb"'), m1 = tpl.indexOf('</main>') + '</main>\n'.length;
  if (h0 < 0 || m0 < 0) throw new Error('şablon işaretleri bulunamadı');
  let page = tpl.slice(0, h0) + head + tpl.slice(h1, m0) + main + tpl.slice(m1);
  // Yerel css/js için ?v=0 yer tutucusunu tools/sync-versions.py ile aynı içerik özetine çevir
  return page.replace(/"\/((?:css|js)\/[\w./-]+\.(?:css|js))\?v=0"/g, (m, rel) => '"/' + rel + '?v=' + rev(rel) + '"');
}

// Ortak meta bloğu (canonical, Open Graph); extra: sayfaya özgü stil/betik/JSON-LD satırları
function metaHead({ title, desc, url, type = 'article', robots = 'index, follow, max-image-preview:large, max-snippet:-1', extra = '' }) {
  return `  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="${robots}">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="${type}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="https://voltguard.com.tr/public/og-image.png">
  <meta property="og:site_name" content="VoltGuard">
  <meta name="twitter:card" content="summary_large_image">
  <meta property="og:locale" content="tr_TR">
  <link rel="icon" type="image/png" href="/public/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/style.css?v=0">
${extra}</head>`;
}

// Yazar ya da --check ile güncelliği denetler
function emit(rel, page, label) {
  const file = path.join(root, rel);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(file) ? noCurrent(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')) : '';
    if (cur !== page) { console.error(rel + ' güncel değil: node ' + path.relative(root, process.argv[1]).replace(/\\/g, '/')); process.exit(1); }
    console.log(rel + ' güncel');
  } else {
    fs.writeFileSync(file, page);
    console.log(rel + ' yazıldı' + (label ? ' (' + label + ')' : ''));
  }
}

module.exports = { esc, compose, metaHead, emit, root };
