'use strict';
// All published content remains native HTML links on the homepage, including
// without JavaScript. The search index is deliberately not an input: it indexes
// the generated homepage too, and that would create a self-referencing build.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://voltguard.com.tr';
const TERMS = require('./data/elektrik-terimleri.cjs');
const PUBLIC_NEWS = require('../js/home-volthaber.js');
const START = '<!--vg:directory-->';
const END = '<!--/vg:directory-->';
const CATEGORIES = [
  // Existing field/team photos, document previews and actual product screens.
  ['hizmetler', 'Hizmetler', '/public/opt/panokurulumuverevizyonu-640.webp', 640, 800],
  ['hesap', 'Hesap araçları', '/public/home/hesap-araclari.webp', 772, 611],
  ['muhendislik', 'Mühendislik uygulamaları', '/public/home/directory/muhendislik.webp', 480, 360],
  ['simulasyon', 'VoltSim ve oyun', '/public/home/directory/voltsim.webp', 480, 360],
  ['rehber', 'Rehberler ve mevzuat', '/public/opt/Trafoolcum-640.webp', 640, 853],
  ['akademi', 'Akademi ve dersler', '/public/opt/haberler/h6-640.webp', 640, 360],
  ['soru', 'Sorular ve topluluk', '/public/opt/haberler/ege-teknopark-topluluk-bulusmasi-640.webp', 640, 426],
  ['form', 'Formlar ve şablonlar', '/public/home/directory/formlar.webp', 480, 360],
  ['projeler', 'Saha projeleri', '/public/opt/trafo-kiosk-vinc-montaji-640.webp', 640, 853],
  ['haberler', 'Haberler ve VoltHaber', '/public/opt/haberler/h3-640.webp', 640, 429],
  ['kurumsal', 'Şirket ve iletişim', '/public/opt/ekip-ruhu-pano-kurulumu-640.webp', 640, 853],
  ['sozluk', 'Elektrik terimleri', '/public/opt/haberler/Elektronik-640.webp', 640, 380],
  ['belgeler', 'Belgeler ve indirmeler', '/public/brosur/voltguard-brosur-kapak.webp', 546, 1158],
  ['uyelik', 'Üyelik ve çalışan girişi', '/public/home/directory/uyelik.webp', 480, 360]
].map(([id, title, image, width, height]) => ({id, title, image, width, height}));
const EXTRA = [
  ['/arama.html', 'Sitede arama', 'kurumsal', 'Sayfa'],
  ['/voltgame.html', 'VoltGame elektrik oyunu', 'simulasyon', 'Oyun'],
  ['/hesap/giris.html', 'Üye girişi ve hesap alanı', 'uyelik', 'Giriş'],
  ['/hesap/kayit.html', 'Üyelik oluşturun', 'uyelik', 'Üyelik'],
  ['/hesap/sifre-sifirla.html', 'Üye şifresini yenileyin', 'uyelik', 'Hesap'],
  ['/calisan/giris.html', 'Şirket uygulamasına çalışan girişi', 'uyelik', 'Giriş'],
  ['/public/voltguard-brosur.pdf', 'VoltGuard kurumsal broşürü', 'belgeler', 'PDF'],
  ['/public/opt/voltguard-katalog.pdf', 'Ayrıntılı hizmet kataloğu', 'belgeler', 'PDF'],
  ['/araclar/downloads/voltguard-cevrimdisi.zip', 'Çevrimdışı mühendislik araçları', 'belgeler', 'ZIP'],
  ['/public/sertifika-ege-universitesi-onur-belgesi.jpg', 'Ege Üniversitesi onur belgesi', 'belgeler', 'Belge'],
  ['/public/sertifika-ege-universitesi-endustriyel-tesisler.jpg', 'Endüstriyel tesisler semineri belgesi', 'belgeler', 'Belge'],
  ['/public/sertifika-tusas-liftup-katilim-belgesi.jpg', 'TUSAŞ LIFT UP katılım belgesi', 'belgeler', 'Belge'],
  ['/public/brosur/voltguard-brosur-onizleme.webp', 'Kurumsal broşür dış yüz önizlemesi', 'belgeler', 'Görsel']
];
const HUBS = [
  ['/hakkimizda.html', 'kurumsal'], ['/iletisim.html', 'kurumsal'],
  ['/fabrika-cozumleri.html', 'hizmetler'], ['/teknik-kaynaklar.html', 'muhendislik'],
  ['/dokumanlar.html', 'belgeler'], ['/projeler.html', 'projeler'],
  ['/haberler.html', 'haberler'], ['/akademi.html', 'akademi'],
  ['/voltsim/', 'simulasyon']
];
const ENT = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', middot:'·', ndash:'–', mdash:'—', times:'×', deg:'°', rarr:'→'};
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m,e) => {
  if (e[0] !== '#') return ENT[e] ?? m;
  const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2),16) : Number(e.slice(1));
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
}).replace(/\s+/g,' ').trim();
const esc = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const attr = (attributes, name) => (attributes.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\']([^"\']+)["\']','i')) || [,''])[1];
const firstHeading = html => text((html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)||[,''])[1]);

function rewrites() {
  return Object.fromEntries(fs.readFileSync(path.join(ROOT,'netlify.toml'),'utf8').split('[[redirects]]').slice(1)
    .map(b=>[b.match(/from\s*=\s*"([^"]+)"/),b.match(/to\s*=\s*"(\/[^"]+\.html)"/),/status\s*=\s*200\b/.test(b)])
    .filter(([f,t,ok])=>f&&t&&ok).map(([f,t])=>[f[1],t[1]]));
}
function fileFor(url, map=rewrites()) {
  if (!url.startsWith('/') || url.startsWith('//')) throw Error('Only same-site content paths are allowed: '+url);
  const parsed = new URL(url,SITE);
  const rel = decodeURIComponent(map[parsed.pathname] || parsed.pathname).replace(/^\//,'');
  const choices = !rel ? ['index.html'] : rel.endsWith('/') ? [rel.slice(0,-1)+'.html',rel+'index.html'] : [rel];
  for (const name of choices) {
    const absolute = path.resolve(ROOT,name);
    if (!absolute.startsWith(ROOT+path.sep)) throw Error('Content path escapes workspace');
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
  }
  throw Error('Content target is missing: '+url);
}
function category(url) {
  if (/^\/hizmetler\//.test(url)||url==='/fabrika-cozumleri.html') return 'hizmetler';
  if (/^\/hesaplama(?:-araclari)?\//.test(url)||url==='/teklif-araclari.html') return 'hesap';
  if (/^\/araclar\//.test(url)||url==='/teknik-kaynaklar.html') return 'muhendislik';
  if (/^\/voltsim\//.test(url)||url==='/voltgame.html') return 'simulasyon';
  if (/^\/bilgi\//.test(url)||url==='/bilgi-bankasi.html') return 'rehber';
  if (/^\/akademi\//.test(url)||url==='/akademi.html') return 'akademi';
  if (/^\/sor\//.test(url)||['/sor.html','/topluluk.html'].includes(url)) return 'soru';
  if (/^\/mm\//.test(url)||url==='/muhendis-merkezi.html') return 'form';
  if (url==='/projeler.html') return 'projeler';
  if (url==='/haberler.html'||/^\/volthaber\//.test(url)) return 'haberler';
  if (url==='/dokumanlar.html'||url.endsWith('.pdf')) return 'belgeler';
  return 'kurumsal';
}
function buildCatalogue() {
  const map = rewrites(), entries = new Map();
  const categories = new Set(CATEGORIES.map(c=>c.id));
  function add(u,t,c,kind='Sayfa',keywords='') {
    const dynamic = kind==='VoltHaber';
    if (dynamic && !PUBLIC_NEWS.normalizeEntry({url:u,title:t},SITE)) throw Error('Invalid public VoltHaber article path');
    const file = dynamic ? null : fileFor(u,map);
    if (!categories.has(c)) throw Error('Unknown category '+c);
    if (!t) throw Error('Content needs a human-readable title: '+u);
    if (/^\/(?:api|tools)\//.test(u)) throw Error('Internal endpoints must not be listed');
    if (/^\/(?:hesap|calisan)\//.test(u) && !EXTRA.some(e=>e[0]===u)) throw Error('Only explicit account gateways may be listed');
    const hash = new URL(u,SITE).hash;
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      const ids = [...fs.readFileSync(file,'utf8').matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]);
      if (!ids.includes(id)) throw Error('Content fragment missing: '+u);
    }
    if (!entries.has(u)) entries.set(u,{u,t,c,kind,keywords:text(keywords).slice(0,400)});
  }
  const urls = [...fs.readFileSync(path.join(ROOT,'sitemap.xml'),'utf8').matchAll(/<loc>https:\/\/voltguard\.com\.tr(\/[^<]*)<\/loc>/g)].map(m=>m[1]);
  for (const u of urls) {
    const file = fileFor(u,map);
    if (!file.endsWith('.html')) {
      const extra = EXTRA.find(e=>e[0]===u);
      if (!extra) throw Error('Add a title/category for this public document: '+u);
      add(...extra); continue;
    }
    const html = fs.readFileSync(file,'utf8');
    if (!fs.existsSync(path.join(path.dirname(file),'index.php')) && /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) continue;
    const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||[,''])[1];
    const title = u==='/' ? 'Ana sayfa' : firstHeading(main) || text((html.match(/<title>([\s\S]*?)<\/title>/i)||[,''])[1]).replace(/\s*[|–-]\s*VoltGuard.*$/i,'');
    const description = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)||[,''])[1];
    add(u,title,category(u),'Sayfa',description);
  }
  for (const term of TERMS) add('/bilgi/elektrik-terimleri-sozlugu.html#'+term.id,term.term,'sozluk','Sözlük',[...(term.alt||[]),term.def].join(' '));
  for (const extra of EXTRA) add(...extra);
  const live = JSON.parse(fs.readFileSync(path.join(ROOT,'tools/data/home-directory-volthaber.json'),'utf8'));
  if (!Array.isArray(live.entries)) throw Error('Published VoltHaber snapshot is missing its entries');
  for (const entry of live.entries) {
    if (entry.c!=='haberler'||entry.kind!=='VoltHaber') throw Error('Invalid public VoltHaber snapshot category');
    add(entry.u,entry.t,entry.c,entry.kind,entry.keywords);
  }
  for (const [u,c] of HUBS) {
    const html = fs.readFileSync(fileFor(u,map),'utf8');
    for (const m of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)) {
      const id = attr(m[1],'id');
      const title = text(attr(m[1],'aria-label')) || firstHeading(m[2]);
      if (id && title) add(u+'#'+id,title,c,'Bölüm');
    }
  }
  // Films are nested articles; project/news records are actual independent cards.
  for (const [u,c,selector] of [
    ['/hakkimizda.html','kurumsal',/\bvgh-film__grid\b/],
    ['/projeler.html','projeler',/\bvgp-card\b/],
    ['/haberler.html','haberler',/\bnews-card\b/]
  ]) {
    const html = fs.readFileSync(fileFor(u,map),'utf8');
    for (const m of html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)) {
      if (!selector.test(attr(m[1],'class'))) continue;
      const id = attr(m[1],'id'), title = firstHeading(m[2]);
      if (!id || !title) throw Error('Every film/project/news card needs a stable id and heading in '+u);
      add(u+'#'+id,title,c,c==='projeler'?'Proje':c==='haberler'?'Haber':'Video');
    }
  }
  const list = [...entries.values()];
  const order = new Map(CATEGORIES.map((c,i)=>[c.id,i]));
  list.sort((a,b)=>order.get(a.c)-order.get(b.c) || a.t.localeCompare(b.t,'tr') || a.u.localeCompare(b.u));
  return list;
}
function renderDirectory(entries) {
  const groups = CATEGORIES.map(c=>({...c,entries:entries.filter(e=>e.c===c.id)})).filter(c=>c.entries.length);
  for (const group of groups) fileFor(group.image);
  return `${START}
  <div id="tum-icerikler" class="vgh-directory-anchor"><div class="vgh-directory" id="homeDirectory" role="region" aria-labelledby="homeDirectoryTitle">
    <div class="vgh-directory__heading"><div><p class="vgh-eyebrow">Bütün içerikler tek yerde</p><h3 id="homeDirectoryTitle">VoltGuard'ı baştan sona keşfedin.</h3></div><p>Bir kategori açın veya arayın; aradığınız içeriğe doğrudan ulaşın.</p></div>
    <div class="vgh-directory__controls" id="homeDirectoryControls" hidden>
      <div><label for="homeDirectorySearch">İçerik ara</label><input id="homeDirectorySearch" type="search" placeholder="Trafo, TEP, PLC, gerilim düşümü..." autocomplete="off" maxlength="120" aria-controls="homeDirectoryGroups"></div>
      <div><label for="homeDirectoryCategory">Kategori</label><select id="homeDirectoryCategory" aria-controls="homeDirectoryGroups"><option value="all">Tüm kategoriler</option>${groups.map(c=>`<option value="${c.id}">${esc(c.title)} (${c.entries.length})</option>`).join('')}</select></div>
      <button type="button" id="homeDirectoryReset" aria-controls="homeDirectoryGroups" hidden>Filtreleri temizle</button>
    </div>
    <div class="vgh-directory__bar"><p id="homeDirectoryCount" role="status" aria-live="polite" aria-atomic="true">${entries.length} içerik bağlantısı · ${groups.length} kategori</p><div id="homeDirectoryActions" hidden><button type="button" id="homeDirectoryOpen" aria-controls="homeDirectoryGroups">Tümünü aç</button><button type="button" id="homeDirectoryClose" aria-controls="homeDirectoryGroups">Tümünü kapat</button></div></div>
    <p id="homeDirectoryEmpty" class="vgh-directory__empty" hidden>Bu aramada içerik bulunamadı. Aramayı kısaltın veya filtreleri temizleyin.</p>
    <div id="homeDirectoryGroups" class="vgh-directory__groups">
${groups.map(c=>`      <details class="vgh-directory__group" data-directory-group="${c.id}"><summary><span class="vgh-directory__image" aria-hidden="true"><img src="${esc(c.image)}" width="${c.width}" height="${c.height}" alt="" loading="lazy" decoding="async"></span><span class="vgh-directory__copy"><strong>${esc(c.title)}</strong><small data-directory-group-count>${c.entries.length} içerik</small></span><span class="vgh-directory__chevron" aria-hidden="true">⌄</span></summary><ul>
${c.entries.map(e=>`        <li data-directory-entry data-directory-kind="${esc(e.kind)}" data-directory-search="${esc(e.t+' '+e.keywords)}"><a href="${esc(e.u)}"><span>${esc(e.t)}</span><small>${esc(e.kind)}</small><span aria-hidden="true">↗</span></a></li>`).join('\n')}
      </ul></details>`).join('\n')}
    </div>
  </div></div>
${END}`;
}
function updateHome(check=false) {
  const file = path.join(ROOT,'index.html'), current=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  if (!current.includes(START)||!current.includes(END)) throw Error('Homepage directory markers are missing');
  const entries=buildCatalogue(), block=renderDirectory(entries);
  const next=current.replace(/<!--vg:directory-->[\s\S]*?<!--\/vg:directory-->/,block);
  if (check && current!==next) throw Error('Homepage content directory is stale: node tools/build-home-directory.cjs');
  if (!check && current!==next) fs.writeFileSync(file,next);
  return {entries:entries.length,groups:new Set(entries.map(e=>e.c)).size,changed:current!==next};
}
module.exports={ROOT,CATEGORIES,EXTRA,HUBS,buildCatalogue,renderDirectory,updateHome,fileFor};
if (require.main===module) {
  try {console.log(JSON.stringify(updateHome(process.argv.includes('--check'))));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
