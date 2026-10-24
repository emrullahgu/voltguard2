'use strict';

// bilgi/mevzuat-guncellemeleri.html sayfasını VoltSim mevzuat kaydından (js/voltsim/regulations.js) üretir.
// Kayıttaki "amendments" alanından 2025 ve sonrası Resmî Gazete değişiklikleri çıkarılır; kısa açıklamalar
// yalnızca kayıtta doğrulanmış bilgiden yazılmıştır (NOTES). Kabuk bilgi/mevzuat-kutuphanesi.html'den alınır.
//   node tools/build-mevzuat-guncellemeleri.cjs          sayfayı yazar
//   node tools/build-mevzuat-guncellemeleri.cjs --check  sayfa güncel değilse hata verir
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const regs = require(path.join(root, 'js/voltsim/regulations.js'));
const OUT = 'bilgi/mevzuat-guncellemeleri.html';
const URL = 'https://voltguard.com.tr/bilgi/mevzuat-guncellemeleri.html';
const FROM_YEAR = 2025;

// Değişikliğin neyi kapsadığı (kayıttaki doğrulanmış notlardan); olmayanlarda yalnız künye verilir
const NOTES = {
  'is-ekipmanlari|23.12.2025': 'Madde 7 ve EK-III değişti: elektrik, topraklama, yıldırımdan korunma, trafo, jeneratör, akü ve yangın algılama sistemlerinin periyodik kontrol usul ve esasları yenilendi.',
  'lisanssiz|02.04.2026': 'Mahsuplaşma, OSB ve elektrik bağlantı anlaşması ile depolama hükümleri geniş biçimde yeniden düzenlendi.',
  'lisanssiz|19.10.2026': 'Acil durumda tesislerin uzaktan kontrolü, dengeleme talimatına uymayan tesise ihtiyaç fazlası ödemesi yapılmaması; üretim tesisine bütünleşik depolamada kapasite sınırlaması kaldırıldı (Ek Madde 3).',
  'sarj|23.03.2026': 'Madde 5 muafiyetleri değişti: ticari faaliyet göstermeyen özel istasyonların ve yalnız kendi ihtiyacı için kurulan şarj ünitelerinin şarj ağına bağlanması zorunlu değil. Madde 30 ve 32 değişti, geçici maddeler eklendi.',
  'sebeke|21.01.2025': 'Madde 14 ve Ek-18 (E.18.4) frekans tepkisi hükümleri değişti.',
  'ced|26.06.2025': 'Rüzgâr enerji santrallerine ilişkin ÇED eşikleri bugünkü hâlini aldı.'
};
// Konu → ilgili VoltGuard sayfaları
const LINKS = {
  'is-ekipmanlari': [['/hesaplama/periyodik-kontrol-planlayici/', 'Periyodik kontrol planlayıcı'], ['/bilgi/elektrik-tesisati-periyodik-kontrol.html', 'Elektrik tesisatı periyodik kontrolü']],
  'lisanssiz': [['/voltsim/ges/', 'VoltSim GES simülasyonu'], ['/hizmetler/fabrika-cati-ges.html', 'Fabrika çatı GES']],
  'sarj': [['/voltsim/sarj-istasyonu/', 'VoltSim şarj istasyonu simülasyonu']],
  'otopark': [['/voltsim/sarj-istasyonu/', 'VoltSim şarj istasyonu simülasyonu']],
  'ruzgar-teknik': [['/voltsim/res/', 'VoltSim RES simülasyonu']],
  'ced': [['/voltsim/res/', 'VoltSim RES simülasyonu']],
  'yangin': [['/voltsim/yangin-algilama/', 'VoltSim yangın algılama simülasyonu']],
  'et-proje': [['/bilgi/mevzuat-kutuphanesi.html', 'Mevzuat ve standartlar kütüphanesi']]
};
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function entries() {
  const out = [];
  regs.filter(r => r.binding).forEach(r => {
    const seen = new Set();
    for (const m of String(r.amendments || '').matchAll(/(\d{2})\.(\d{2})\.(\d{4})\/(\d{5})/g)) {
      const [, d, mo, y, no] = m;
      if (+y < FROM_YEAR || seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ reg: r, date: `${d}.${mo}.${y}`, iso: `${y}-${mo}-${d}`, no, note: NOTES[r.id + '|' + `${d}.${mo}.${y}`] || '' });
    }
  });
  return out.sort((a, b) => b.iso.localeCompare(a.iso) || a.reg.name.localeCompare(b.reg.name, 'tr'));
}

function render() {
  const list = entries();
  const checkedIso = (String(regs.checked || '').match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '2026-10-23';
  const checkedTr = checkedIso.split('-').reverse().join('.');
  const years = [...new Set(list.map(e => e.iso.slice(0, 4)))];
  const title = 'Elektrik Mevzuatı Değişiklikleri 2025–2026 | VoltGuard';
  const desc = `Elektrik, enerji, şarj, GES/RES ve iş güvenliği yönetmeliklerinde 2025–2026'da Resmî Gazete'de yayımlanan ${list.length} değişiklik: tarih, sayı, kapsam ve resmî metin bağlantıları.`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', '@id': URL + '#article', headline: 'Elektrik Mevzuatı Değişiklikleri 2025–2026', description: desc, inLanguage: 'tr-TR', image: 'https://voltguard.com.tr/public/og-image.png',
      datePublished: '2026-10-24', dateModified: checkedIso, author: { '@type': 'Organization', '@id': 'https://voltguard.com.tr/#organization', name: 'VoltGuard' },
      publisher: { '@id': 'https://voltguard.com.tr/#organization' }, mainEntityOfPage: URL, isPartOf: { '@type': 'WebSite', '@id': 'https://voltguard.com.tr/#website' } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: 'https://voltguard.com.tr/' },
      { '@type': 'ListItem', position: 2, name: 'Bilgi Bankası', item: 'https://voltguard.com.tr/bilgi-bankasi.html' },
      { '@type': 'ListItem', position: 3, name: 'Mevzuat Kütüphanesi', item: 'https://voltguard.com.tr/bilgi/mevzuat-kutuphanesi.html' },
      { '@type': 'ListItem', position: 4, name: 'Mevzuat Değişiklikleri', item: URL }] }] };

  const head = `  <meta name="color-scheme" content="light only">
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${URL}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${URL}">
  <meta property="og:image" content="https://voltguard.com.tr/public/og-image.png">
  <meta property="og:site_name" content="VoltGuard">
  <meta name="twitter:card" content="summary_large_image">
  <meta property="og:locale" content="tr_TR">
  <link rel="icon" type="image/png" href="/public/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/style.css?v=0">
  <style>
    .mg-year{margin:2rem 0 .6rem;font-size:1.35rem}
    .mg-item{display:grid;grid-template-columns:7.5rem 1fr;gap:.4rem 1rem;padding:1rem 0;border-top:1px solid #e2e8f0}
    .mg-date{font-weight:800;color:#0a1628}
    .mg-date small{display:block;font-weight:600;color:#4f5f74;font-size:.8rem}
    .mg-item h3{margin:0 0 .25rem;font-size:1.02rem}
    .mg-item p{margin:.2rem 0}
    .mg-tag{display:inline-block;margin-left:.35rem;padding:.05rem .45rem;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:.75rem;font-weight:700;vertical-align:middle}
    .mg-links{display:flex;flex-wrap:wrap;gap:.2rem 1rem;margin-top:.35rem;font-size:.9rem}
    .mg-links a{display:inline-block;padding:.3rem 0}
    @media (max-width:560px){.mg-item{grid-template-columns:1fr}}
  </style>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>`;

  const items = years.map(y => `    <h2 class="mg-year" id="y${y}">${y}</h2>\n` + list.filter(e => e.iso.startsWith(y)).map(e => {
    const [yy, mm, dd] = e.iso.split('-');
    const rgUrl = `https://www.resmigazete.gov.tr/eskiler/${yy}/${mm}/${yy}${mm}${dd}.htm`;
    const rel = (LINKS[e.reg.id] || []).map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join('');
    return `    <article class="mg-item">
      <div class="mg-date"><time datetime="${e.iso}">${+dd} ${MONTHS[+mm - 1]} ${yy}</time><small>RG sayı ${e.no}</small></div>
      <div>
        <h3>${esc(e.reg.name)}<span class="mg-tag">${esc(e.reg.kind || 'Yönetmelik')}</span></h3>
        <p>${e.note ? esc(e.note) : 'Değişikliğin kapsamı için Resmî Gazete metnine bakın.'}</p>
        <div class="mg-links"><a href="${rgUrl}" target="_blank" rel="noopener noreferrer">Resmî Gazete ${e.date}</a>${e.reg.url ? `<a href="${esc(e.reg.url)}" target="_blank" rel="noopener noreferrer">Güncel metin (mevzuat.gov.tr)</a>` : ''}${rel}</div>
      </div>
    </article>`;
  }).join('\n')).join('\n');

  const main = `  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="/">Ana Sayfa</a> &rsaquo; <a href="/bilgi-bankasi.html">Bilgi Bankası</a> &rsaquo; <a href="/bilgi/mevzuat-kutuphanesi.html">Mevzuat Kütüphanesi</a> &rsaquo; <span>Mevzuat Değişiklikleri</span>
  </nav>

  <main class="article" id="main" tabindex="-1">
    <span class="article__cat">Mevzuat Takibi</span>
    <h1>Elektrik Mevzuatı Değişiklikleri 2025–2026</h1>
    <p class="article__byline" style="font-size:.85rem;color:#5b6472;margin:.25rem 0 1rem">Hazırlayan: VoltGuard Mühendislik Ekibi · Son kontrol: <time datetime="${checkedIso}">${checkedTr}</time></p>
    <p class="article__summary">Elektrik tesisatı, enerji piyasası, lisanssız üretim (GES), rüzgâr (RES), şarj hizmeti, yangın ve iş güvenliği alanında izlediğimiz yönetmeliklerde ${FROM_YEAR}'ten bu yana Resmî Gazete'de yayımlanan ${list.length} değişiklik. Liste, VoltSim simülasyonlarının dayandığı mevzuat kaydıyla aynı kaynaktan üretilir ve her kontrolde güncellenir.</p>
    <p>Atlama: ${years.map(y => `<a href="#y${y}">${y}</a>`).join(' · ')} · Tüm yönetmelik ve standartlar için <a href="/bilgi/mevzuat-kutuphanesi.html">mevzuat kütüphanesine</a> bakın.</p>
${items}
    <p class="kb-disclaimer" style="margin-top:1.6rem">Bu sayfa bilgilendirme amaçlıdır. Bağlayıcı olan, Resmî Gazete'de yayımlanan metin ve yürürlükteki güncel mevzuattır; kısa açıklamalar değişikliğin tamamını kapsamaz. Liste yalnızca VoltGuard'ın hizmet alanıyla ilgili yönetmelikleri içerir.</p>
    <div class="kb-cta">
      <div class="kb-cta__text"><strong>Tesisiniz yeni kurallara uygun mu?</strong><span>Periyodik kontrol, GES, şarj istasyonu ve trafo projelerinde güncel mevzuata göre değerlendirme.</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:.6rem">
        <a href="/hizmetler/elektrik-periyodik-kontrol.html" class="btn btn--accent btn--md"><i class="fas fa-arrow-right" aria-hidden="true"></i> Periyodik Kontrol Hizmeti</a>
        <a href="/#iletisim" class="btn btn--outline-white btn--md"><i class="fas fa-paper-plane" aria-hidden="true"></i> Teklif Al</a>
      </div>
    </div>
  </main>
`;
  const tpl = fs.readFileSync(path.join(root, 'bilgi/mevzuat-kutuphanesi.html'), 'utf8').replace(/\r\n/g, '\n');
  const h0 = tpl.indexOf('  <meta name="color-scheme"'), h1 = tpl.indexOf('</head>') + '</head>'.length;
  const m0 = tpl.indexOf('  <nav class="breadcrumb"'), m1 = tpl.indexOf('</main>') + '</main>\n'.length;
  if (h0 < 0 || m0 < 0) throw new Error('şablon işaretleri bulunamadı');
  let page = tpl.slice(0, h0) + head + tpl.slice(h1, m0) + main + tpl.slice(m1);
  // Kabuktaki ana kaynak sürümlerini koru (sync-versions günceller)
  const ver = (tpl.match(/\/css\/style\.css\?v=([0-9a-f]+)/) || [])[1];
  if (ver) page = page.replace('/css/style.css?v=0', '/css/style.css?v=' + ver);
  return page;
}

const page = render();
const file = path.join(root, OUT);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== page) { console.error(OUT + ' güncel değil: node tools/build-mevzuat-guncellemeleri.cjs'); process.exit(1); }
  console.log(OUT + ' güncel');
} else {
  fs.writeFileSync(file, page);
  console.log(OUT + ' yazıldı (' + entries().length + ' değişiklik)');
}
