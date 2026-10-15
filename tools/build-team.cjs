'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'team-data.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const photoRoot = path.join(root, 'public', 'ekibimiz');
fs.mkdirSync(photoRoot, {recursive:true});
const descriptions = {
  ofis: {short:'Merkez Ofis', tag:'PLANLAMA & MÜHENDİSLİK', copy:'Yönetim, mühendislik ve ofis ekibimiz.', icon:'building'},
  depo: {short:'Depo', tag:'MUHASEBE', copy:'Depo birimindeki muhasebe ekibimiz.', icon:'box'},
  'ar-ge': {short:'Ar-Ge', tag:'EGE TEKNOPARK', copy:'Elektronik, makine ve elektrik mühendisliği bir arada.', icon:'atom'},
  saha: {short:'Saha Ekibi', tag:'UYGULAMA', copy:'Ustabaşından çırağa, sahada aynı hedef için çalışan ekip.', icon:'helmet'}
};
const icons = {
  building:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h1m6 0h1M8 11h1m6 0h1"/>',
  box:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7.5 5.5l9 5"/>',
  atom:'<ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="1"/>',
  helmet:'<path d="M3 17v-3a9 9 0 0 1 18 0v3M9 5v7m6-7v7M2 17h20v4H2z"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const people = data.units.flatMap(u => u.people.map(p => ({...p,unit:u.id,unitName:u.name})));
if (data.version !== 1 || new Set(people.map(p => p.id)).size !== 26 || people.length !== 26 || data.units.length !== 4) throw Error('Team source is incomplete or duplicated.');
for (const person of people) {
  if (!/^[a-z0-9-]+$/.test(person.id) || path.basename(person.photo) !== person.photo || !/\.(jpe?g|png)$/i.test(person.photo)) throw Error('Invalid team asset.');
  const file = person.id + path.extname(person.photo).toLowerCase();
  const original = path.join(root, 'vesikalar', person.photo);
  const target = path.join(photoRoot, file);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('Team assets cannot use links.');
  if (fs.existsSync(original)) fs.copyFileSync(original, target);
  if (!fs.existsSync(target)) throw Error('Missing approved photo for '+person.name);
  person.src = '/public/ekibimiz/'+file;
}
const byId = Object.fromEntries(people.map(p => [p.id,p]));
const photo = (p, cls='', eager=false) => `<img class="${cls}" src="${p.src}" alt="${escape(p.name)}" width="240" height="240" ${eager?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
const portrait = p => `<button class="team-person" type="button" data-person="${p.id}" data-unit="${p.unit}" data-search="${escape(p.name+' '+p.role+' '+p.unitName+' '+(p.groupLabel||''))}" aria-label="${escape(p.name+' — '+p.role+'; kişi kartını aç')}"><span class="team-person__portrait">${photo(p)}<span class="team-person__open" aria-hidden="true">${icon('arrow')}</span></span><span class="team-person__text"><strong>${escape(p.name)}</strong><span>${escape(p.role)}</span></span></button>`;
const leader = byId['emrullah-gunay'];
const branches = data.units.map((u,i) => {
  const description = descriptions[u.id];
  const preview = u.people.slice(0,4).map(p => photo(byId[p.id])).join('');
  const groups = u.groups ? `<div class="team-branch__groups">${u.groups.map(g => `<span>${escape(g.name)}<b>${u.people.filter(p=>p.group===g.id).length}</b></span>`).join('')}</div>` : '';
  return `<a class="team-branch" href="#kadro" data-explore="${u.id}" data-branch="${u.id}"><span class="team-branch__top"><span class="team-branch__icon">${icon(description.icon)}</span><span class="team-branch__number">0${i+1}</span></span><span class="team-branch__tag">${description.tag}</span><h3>${description.short}</h3><p>${escape(u.name)}</p><span class="team-branch__portraits" aria-hidden="true">${preview}</span><span class="team-branch__count"><strong>${u.people.length}</strong> ekip arkadaşı</span>${groups}<span class="team-branch__action">Ekibi keşfet ${icon('arrow')}</span></a>`;
}).join('\n');
const roster = data.units.map((u,i) => {
  const description=descriptions[u.id];
  const content=u.groups?u.groups.map(g=>`<div class="team-role-group" data-group="${g.id}"><div class="team-role-group__title"><h4>${escape(g.name)}</h4><span>${u.people.filter(p=>p.group===g.id).length} kişi</span></div><div class="team-people">${u.people.filter(p=>p.group===g.id).map(p=>portrait(byId[p.id])).join('')}</div></div>`).join(''):`<div class="team-people">${u.people.map(p=>portrait(byId[p.id])).join('')}</div>`;
  return `<section class="team-roster-unit" data-roster-unit="${u.id}" aria-labelledby="unit-${u.id}"><div class="team-roster-unit__heading"><span class="team-roster-unit__index">0${i+1}</span><div><p>${description.tag}</p><h3 id="unit-${u.id}">${escape(u.name)}</h3></div><span class="team-roster-unit__count">${u.people.length} kişi</span></div>${content}</section>`;
}).join('\n');
const payload=JSON.stringify(people.map(({id,name,role,unit,unitName,groupLabel,src})=>({id,name,role,unit,unitName,groupLabel,src}))).replace(/</g,'\\u003c');
const html=`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--vg:head--><!--/vg:head-->
  <title>Ekibimiz — VoltGuard Çalışma Ağacı</title>
  <meta name="description" content="VoltGuard ekibini tanıyın. Kemalpaşa merkez ofis, depo, Ege Teknopark Ar-Ge ve saha birimlerinde çalışan 26 ekip arkadaşımızın fotoğraflı çalışma ağacı.">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="https://voltguard.com.tr/ekibimiz.html">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Ekibimiz | VoltGuard">
  <meta property="og:description" content="Dört birim, 26 ekip arkadaşı. VoltGuard’ın fotoğraflı çalışma ağacını keşfedin.">
  <meta property="og:url" content="https://voltguard.com.tr/ekibimiz.html">
  <meta property="og:image" content="https://voltguard.com.tr/public/og-image.png">
  <meta property="og:locale" content="tr_TR">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/public/favicon-32.png" type="image/png">
  <link rel="stylesheet" href="/css/team.css?v=20261015b">
  <script src="/js/voltguard-auth.js?v=20261013a" defer></script>
  <script src="/js/team.js?v=20261013b" defer></script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"VoltGuard Ekibimiz","url":"https://voltguard.com.tr/ekibimiz.html","inLanguage":"tr-TR","isPartOf":{"@type":"WebSite","name":"VoltGuard","url":"https://voltguard.com.tr/"}}</script>
</head>
<body class="team-page">
  <!--vg:header--><!--/vg:header-->
  <main id="main" tabindex="-1">
    <section class="team-hero team-wrap" aria-labelledby="team-title">
      <div class="team-hero__copy">
        <a class="team-breadcrumb" href="/">Ana Sayfa <span aria-hidden="true">/</span> <span>Ekibimiz</span></a>
        <p class="team-eyebrow"><span></span> VOLTGUARD’I VAR EDEN İNSANLAR</p>
        <h1 id="team-title">Aynı enerji.<br><em>Birlikte daha güçlü.</em></h1>
        <p class="team-hero__description">Fikirden projeye, ofisten sahaya. Farklı uzmanlıklarımızı aynı hedefte buluşturan ekibimizi tanıyın.</p>
        <a class="team-button" href="#calisma-agaci">Çalışma ağacını keşfet ${icon('arrow')}</a>
        <div class="team-hero__numbers"><span><strong>26</strong>Ekip arkadaşı</span><span><strong>4</strong>Çalışma birimi</span><span><strong>16</strong>Saha çalışanı</span></div>
      </div>
      <div class="team-hero__visual" aria-label="Ekibimizden yüzler">
        <div class="team-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="team-hero__spark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13.2 2 4.5 13.4h6.1L9.8 22l9.7-12.1h-6.3z"/></svg></div>
        <button class="team-hero-person team-hero-person--lead" type="button" data-profile="${leader.id}" aria-label="${escape(leader.name)} kişi kartını aç">${photo(leader,'',true)}<span><strong>${escape(leader.name)}</strong><small>Kurucu / Yönetici</small></span></button>
        <button class="team-hero-person team-hero-person--foreman" type="button" data-profile="mesut-arslan" aria-label="Mesut Arslan — Ustabaşı; kişi kartını aç"><span class="team-hero-person__portrait">${photo(byId['mesut-arslan'])}</span></button>
        <button class="team-hero-person team-hero-person--one" type="button" data-profile="gorkem-tanir" aria-label="Görkem Tanır kişi kartını aç">${photo(byId['gorkem-tanir'])}</button>
        <button class="team-hero-person team-hero-person--two" type="button" data-profile="ibrahim-ince" aria-label="İbrahim İnce kişi kartını aç">${photo(byId['ibrahim-ince'])}</button>
        <button class="team-hero-person team-hero-person--three" type="button" data-profile="sedat-sasmaz" aria-label="Sedat Şaşmaz kişi kartını aç">${photo(byId['sedat-sasmaz'])}</button>
        <button class="team-hero-person team-hero-person--four" type="button" data-profile="emirhan-aktas" aria-label="Emirhan Aktaş kişi kartını aç">${photo(byId['emirhan-aktas'])}</button>
        <span class="team-hero__label">Bir ekibin gücü,<br><strong>her bir insanında.</strong></span>
      </div>
    </section>
    <section class="team-tree team-wrap" id="calisma-agaci" aria-labelledby="tree-title">
      <div class="team-section-heading"><div><p class="team-eyebrow">İNSANLARIMIZ. BİRİMLERİMİZ.</p><h2 id="tree-title">Tek ekip, dört güçlü kol.</h2></div><p>Mühendislikten uygulamaya<br>birbirini tamamlayan bir yapı.</p></div>
      <div class="team-tree__root"><img class="team-tree__brand" src="/public/voltguard-logo.webp" width="45" height="45" alt=""><div><strong>Volt<span>Guard</span></strong><small>ÇALIŞMA AĞACIMIZ</small></div><span class="team-tree__total">26 kişi</span></div>
      <div class="team-tree__branches">${branches}</div>
    </section>
    <section class="team-roster team-wrap" id="kadro" aria-labelledby="roster-title">
      <div class="team-section-heading"><div><p class="team-eyebrow">İŞİN ARKASINDAKİ EKİP</p><h2 id="roster-title">Her yüz, ortak bir hedef.</h2></div><p>Bir kişi kartına dokunun;<br>görevini ve birimini tanıyın.</p></div>
      <div class="team-controls" hidden>
        <div class="team-filters" role="group" aria-label="Ekip birimini seç"><button type="button" data-filter="all" aria-pressed="true">Tüm ekip <span>26</span></button>${data.units.map(u=>`<button type="button" data-filter="${u.id}" aria-pressed="false">${descriptions[u.id].short} <span>${u.people.length}</span></button>`).join('')}</div>
        <label class="team-search">${icon('search')}<span class="team-sr-only">İsim, görev veya birim ara</span><input id="team-search" type="search" placeholder="İsim, görev veya birim ara" autocomplete="off" maxlength="100"></label>
      </div>
      <p class="team-results" role="status" aria-live="polite" hidden></p>
      <div class="team-empty" hidden><h3>Bu aramada ekip arkadaşı bulunamadı.</h3><p>Farklı bir isim, görev veya birim aramayı deneyin.</p><button class="team-button" type="button" data-reset>Filtreleri temizle ${icon('arrow')}</button></div>
      ${roster}
      <noscript><p class="team-noscript">Ekibimizin tamamı aşağıda yer alıyor. Arama ve kişi kartları için JavaScript’i etkinleştirebilirsiniz.</p></noscript>
    </section>
    <section class="team-closing team-wrap"><span class="team-closing__bolt" aria-hidden="true">ϟ</span><div><p class="team-eyebrow">BİRLİKTE HAYATA GEÇİRELİM</p><h2>Bir sonraki projenizde<br>yanınızda olalım.</h2></div><a class="team-button" href="/#iletisim">Projenizi anlatın ${icon('arrow')}</a></section>
  </main>
  <dialog class="team-dialog" aria-labelledby="profile-name"><button class="team-dialog__close" type="button" aria-label="Kişi kartını kapat">${icon('close')}</button><div class="team-dialog__portrait"><img alt="" width="320" height="380"></div><div class="team-dialog__content"><p class="team-eyebrow" id="profile-unit"></p><h2 id="profile-name"></h2><p class="team-dialog__role" id="profile-role"></p><span class="team-dialog__company">VOLTGUARD · EKİBİMİZ</span></div></dialog>
  <script id="team-data" type="application/json">${payload}</script>
  <!--vg:footer--><!--/vg:footer-->
</body>
</html>`;
const target=path.join(root,'ekibimiz.html');
// Preserve generated shell regions on subsequent builds.
let output=html;
if(fs.existsSync(target)){
  const old=fs.readFileSync(target,'utf8');
  for(const name of ['head','header','footer']){
    const region=new RegExp('<!--vg:'+name+'-->[\\s\\S]*?<!--/vg:'+name+'-->');
    const existing=old.match(region);
    if(existing)output=output.replace(region,existing[0]);
  }
}
fs.writeFileSync(target,output);
console.log('Ekibimiz: 26 approved portraits, 4 units and all field role groups generated.');
