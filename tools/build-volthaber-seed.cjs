'use strict';

// VoltHaber açılış içeriği: api/lib/volthaber-seed.json (API ilk çalıştığında yüklenir; sonra veri dizinindeki articles.json esastır).
// Yalnızca doğrulanmış kaynaklardan üretilir:
//  - "resmi" özetler: js/voltsim/regulations.js kaydındaki Resmî Gazete değişiklikleri ve doğrulanmış madde özetleri
//    (kısa açıklamalar tools/build-mevzuat-guncellemeleri.cjs ile aynı NOTES metnidir).
//  - "analiz" yazıları: aynı kayıttaki doğrulanmış (verified:true) madde özetleri ve sitedeki mevcut sayfalara bağlantılar.
// Uydurma sayı, alıntı, olay veya şirket yoktur. Kayıttaki her rakam ilgili maddeye atıfla kullanılır.
//   node tools/build-volthaber-seed.cjs           yazar
//   node tools/build-volthaber-seed.cjs --check   güncel değilse hata
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const regs = require(path.join(root, 'js/voltsim/regulations.js'));
const OUT = path.join(root, 'api/lib/volthaber-seed.json');
const LAUNCH = Date.UTC(2026, 9, 24, 6, 0, 0) / 1000; // 24.10.2026 09:00 TSİ
const reg = id => { const r = regs.find(x => x.id === id); if (!r) throw new Error('kayıt yok: ' + id); return r; };
const art = (id, ref) => { const a = (reg(id).articles || []).find(x => x.ref === ref && x.verified); if (!a) throw new Error('doğrulanmış madde yok: ' + id + ' ' + ref); return a.summary; };
const rgUrl = date => { const [d, m, y] = date.split('.'); return `https://www.resmigazete.gov.tr/eskiler/${y}/${m}/${y}${m}${d}.htm`; };
const rgNo = (id, date) => {
  const r = reg(id);
  const m = String(r.amendments || '').match(new RegExp(date.replace(/\./g, '\\.') + '\\/(\\d{5})'));
  if (m) return m[1];
  const own = String(r.rg || '').match(/^(\d{2}\.\d{2}\.\d{4}) \/ (\d{5})/);
  if (own && own[1] === date) return own[2];
  throw new Error('RG sayısı doğrulanamadı: ' + id + ' ' + date);
};
const iso = date => date.split('.').reverse().join('-');
const AUTHOR = { id: null, name: 'VoltGuard Mühendislik Ekibi' };
const LICENSE_RG = 'Resmî metin; FSEK md. 31 uyarınca kanun, yönetmelik ve resmî duyurular telif korumasında değildir. Bağlayıcı olan Resmî Gazete metnidir.';

// Kapsam açıklamaları: tools/build-mevzuat-guncellemeleri.cjs NOTES ile aynı, kayıtta doğrulanmış bilgi.
const NOTES = {
  'is-ekipmanlari|23.12.2025': 'Madde 7 ve EK-III değişti: elektrik, topraklama, yıldırımdan korunma, trafo, jeneratör, akü ve yangın algılama sistemlerinin periyodik kontrol usul ve esasları yenilendi.',
  'lisanssiz|02.04.2026': 'Mahsuplaşma, OSB ve elektrik bağlantı anlaşması ile depolama hükümleri geniş biçimde yeniden düzenlendi.',
  'lisanssiz|19.10.2026': 'Acil durumda tesislerin uzaktan kontrolü, dengeleme talimatına uymayan tesise ihtiyaç fazlası ödemesi yapılmaması; üretim tesisine bütünleşik depolamada kapasite sınırlaması kaldırıldı (Ek Madde 3).',
  'sarj|23.03.2026': 'Madde 5 muafiyetleri değişti: ticari faaliyet göstermeyen özel istasyonların ve yalnız kendi ihtiyacı için kurulan şarj ünitelerinin şarj ağına bağlanması zorunlu değil. Madde 30 ve 32 değişti, geçici maddeler eklendi.',
  'sebeke|21.01.2025': 'Madde 14 ve Ek-18 (E.18.4) frekans tepkisi hükümleri değişti.',
  'ced|26.06.2025': 'Rüzgâr enerji santrallerine ilişkin ÇED eşikleri bugünkü hâlini aldı.'
};

// [kayıt, tarih, başlık, kategori, etiketler, ilgili madde ref'leri, ilgili bağlantılar]
const RESMI = [
  ['lisanssiz', '19.10.2026', 'Lisanssız üretimde bütünleşik depolamada kapasite sınırlaması kaldırıldı (RG 19.10.2026)', 'yenilenebilir', ['lisanssiz-uretim', 'depolama', 'ges', 'epdk'], ['Ek Madde 3'], [['/voltsim/ges/', 'VoltSim GES simülasyonu'], ['/bilgi/lisanssiz-uretim-ges.html', 'Lisanssız üretim (GES) rehberi']]],
  ['ruzgar-gunes-imar', '24.07.2026', 'Lisanslı RES ve GES\'lerin imar ve ruhsat işlemleri için yeni yönetmelik yayımlandı (RG 24.07.2026)', 'yenilenebilir', ['res', 'ges', 'imar', 'etkb'], ['Madde 1'], [['/voltsim/res/', 'VoltSim RES simülasyonu'], ['/voltsim/ges/', 'VoltSim GES simülasyonu']]],
  ['lisanssiz', '02.04.2026', 'Lisanssız Elektrik Üretim Yönetmeliği\'nde mahsuplaşma, OSB ve depolama hükümleri yeniden düzenlendi (RG 02.04.2026)', 'yenilenebilir', ['lisanssiz-uretim', 'mahsuplasma', 'depolama', 'epdk'], [], [['/hesaplama/ges-uretim-hesaplama/', 'GES üretim hesaplama'], ['/bilgi/lisanssiz-uretim-ges.html', 'Lisanssız üretim (GES) rehberi']]],
  ['sarj', '23.03.2026', 'Şarj Hizmeti Yönetmeliği: yalnız kendi ihtiyacı için kurulan şarj ünitelerinde şarj ağına bağlanma zorunlu değil (RG 23.03.2026)', 'e-mobilite', ['sarj-istasyonu', 'elektrikli-arac', 'epdk'], ['Madde 5', 'Madde 32 (4)'], [['/voltsim/sarj-istasyonu/', 'VoltSim şarj istasyonu simülasyonu']]],
  ['fen-adamlari', '20.01.2026', 'Elektrik fen adamlarının proje ve yapım yetki sınırlarını belirleyen yeni yönetmelik yayımlandı (RG 20.01.2026)', 'tesisat-guvenlik', ['fen-adami', 'ic-tesisat', 'proje'], ['Madde 5 (1)', 'Madde 5 (2)'], [['/bilgi/elektrik-ic-tesis-projelendirme.html', 'Elektrik iç tesis projelendirme']]],
  ['is-ekipmanlari', '23.12.2025', 'İş Ekipmanları Yönetmeliği değişti: elektrik tesisatı periyodik kontrol esasları yenilendi (RG 23.12.2025)', 'tesisat-guvenlik', ['periyodik-kontrol', 'is-guvenligi', 'topraklama'], ['Madde 7', 'EK-III 2.3.1–2.3.2', 'EK-III Tablo-3'], [['/hesaplama/periyodik-kontrol-planlayici/', 'Periyodik kontrol planlayıcı'], ['/bilgi/elektrik-tesisati-periyodik-kontrol.html', 'Elektrik tesisatı periyodik kontrolü']]],
  ['ced', '26.06.2025', 'ÇED Yönetmeliği: rüzgâr santrallerinde eşik türbin sayısına göre belirleniyor (RG 26.06.2025)', 'yenilenebilir', ['ced', 'res', 'ruzgar'], ['Ek-1 madde 41', 'Ek-2 madde 57'], [['/voltsim/res/', 'VoltSim RES simülasyonu']]],
  ['sebeke', '21.01.2025', 'Elektrik Şebeke Yönetmeliği\'nde Madde 14 ve Ek-18 frekans tepkisi hükümleri değişti (RG 21.01.2025)', 'enerji-piyasasi', ['sebeke-yonetmeligi', 'res', 'ges', 'epdk'], ['Madde 14 (1)', 'Ek-18 E.18.1'], [['/voltsim/res/', 'VoltSim RES simülasyonu'], ['/voltsim/ges/', 'VoltSim GES simülasyonu']]]
];

function resmi([id, date, title, category, tags, refs, related], i) {
  const r = reg(id);
  const no = rgNo(id, date);
  const note = NOTES[id + '|' + date] || r.note;
  const isNew = String(r.rg || '').startsWith(date);
  const summary = isNew
    ? `${r.name}, ${date} tarihli ve ${no} sayılı Resmî Gazete'de yayımlandı. ${r.note}`
    : `${r.name}'nde ${date} tarihli ve ${no} sayılı Resmî Gazete'de yayımlanan değişiklik: ${note}`;
  const body = [
    '## Künye',
    `- **Düzenleme:** ${r.name} (${r.kind}, ${r.issuer})`,
    `- **Resmî Gazete:** ${date}, sayı ${no}` + (isNew ? ' (ilk yayım)' : ' (değişiklik)'),
    r.url ? `- **Güncel metin:** [mevzuat kaynağı](${r.url})` : '',
    '',
    '## Ne değişti?',
    isNew ? r.note : note,
    '',
    refs.length ? '## İlgili hükümler (VoltGuard mevzuat kaydındaki doğrulanmış özetler)' : '',
    ...refs.map(ref => `- **${ref}:** ${art(id, ref)}`),
    '',
    '## Bu özet hakkında',
    `Bu kısa özet, VoltGuard'ın VoltSim simülasyonlarında kullandığı mevzuat kaydından (son kontrol ${regs.checkedText}) hazırlanmıştır. Değişikliğin tamamı için [Resmî Gazete ${date}](${rgUrl(date)}) metnine bakın; bağlayıcı olan resmî metindir.`
  ].filter((l, k, a) => l !== '' || (a[k - 1] !== '' && k > 0)).join('\n');
  return {
    slug: slug(title), title, summary: trimTo(summary, 400), body, category, tags, type: 'resmi',
    source: { name: `Resmî Gazete (${date}, sayı ${no})`, url: rgUrl(date), publishedAt: iso(date), licenseNote: LICENSE_RG },
    image: null, status: 'published', publishAt: null, publishedAt: LAUNCH - i * 60, author: AUTHOR, editor: AUTHOR,
    seo: { title: '', description: '' }, related: related.map(([url, label]) => ({ url, label })),
    featured: false, pick: id === 'lisanssiz' && date === '19.10.2026', origin: 'seed', ingest: null, flags: [],
    createdAt: LAUNCH - i * 60, updatedAt: LAUNCH - i * 60
  };
}

const trimTo = (s, n) => s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
function slug(s) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u', Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  let out = s.replace(/[çğıöşüâîûÇĞİIÖŞÜ]/g, c => map[c]).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (out.length > 80) { out = out.slice(0, 80).replace(/-+$/, ''); const cut = out.lastIndexOf('-'); if (cut > 48) out = out.slice(0, cut); }
  return out;
}

// ------------------------------------------------------------------ VoltGuard analizleri
const ie = 'is-ekipmanlari', rx = 'reaktif-ue', ls = 'lisanssiz';
const ANALIZ = [
  {
    title: '23.12.2025 değişikliğinden sonra elektrik tesisatı periyodik kontrolü: işverenin bilmesi gerekenler',
    category: 'tesisat-guvenlik', tags: ['periyodik-kontrol', 'is-guvenligi', 'topraklama', 'yildirimdan-korunma'], featured: true, pick: false,
    summary: 'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği\'nin Madde 7 ve EK-III hükümleri 23.12.2025\'te değişti. Kontrol periyodu, kontrolü kimin yapacağı ve projesi olmayan tesisat için yönetmeliğin söylediklerini maddeleriyle derledik.',
    source: { name: 'İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği (mevzuat.gov.tr)', url: reg(ie).url, publishedAt: '2025-12-23', licenseNote: LICENSE_RG },
    related: [['/hesaplama/periyodik-kontrol-planlayici/', 'Periyodik kontrol planlayıcı'], ['/bilgi/elektrik-tesisati-periyodik-kontrol.html', 'Elektrik tesisatı periyodik kontrolü'], ['/voltsim/topraklama/', 'VoltSim topraklama simülasyonu']],
    body: () => [
      `İşyerlerinde elektrik ve topraklama tesisatının periyodik kontrolünün yasal dayanağı, ${reg(ie).name}'dir (RG ${reg(ie).rg}). Yönetmeliğin Madde 7 ve EK-III hükümleri **23.12.2025 tarihli ve 33116 sayılı** Resmî Gazete'de yayımlanan değişiklikle yeniden düzenlendi. Aşağıda, VoltGuard mevzuat kaydında madde metninden doğrulanmış hükümleri sahadaki karşılıklarıyla birlikte özetliyoruz.`,
      '',
      '## Hangi ekipmanlar kontrole tabi?',
      `**Madde 7:** ${art(ie, 'Madde 7')}`,
      '',
      '## Kontrol ne sıklıkla ve kim tarafından yapılır?',
      `**EK-III 2.3.1–2.3.2:** ${art(ie, 'EK-III 2.3.1–2.3.2')}`,
      '',
      `**EK-III Tablo-3:** ${art(ie, 'EK-III Tablo-3')}`,
      '',
      'Pratikte bu, standartta daha kısa bir süre öngörülmedikçe elektrik iç tesisatı, topraklama ve yıldırımdan korunma tesisatı için kontrollerin yıllık planlanması anlamına gelir. Trafo ve akü tesisatı için tabloda doğrudan 1 yıl yazılıdır.',
      '',
      '## Projesi olmayan tesisat',
      `**EK-III 2.3.7:** ${art(ie, 'EK-III 2.3.7')}`,
      '',
      `Projelendirmede ${reg('eitphy').name} esas alınır; kayıttaki nota göre İş Ekipmanları Yönetmeliği, projesi olmayan elektrik tesisatının bu yönetmeliğe göre projelendirilmesini ister.`,
      '',
      '## İşveren için kontrol listesi',
      '- Tesisteki elektrik, topraklama, yıldırımdan korunma, trafo, jeneratör, akü ve yangın algılama sistemlerinin listesini çıkarın.',
      '- Her biri için son kontrol tarihini ve raporu bulun; ilgili standartta daha kısa süre olup olmadığını kontrol edin.',
      '- Elektrik tesisatının güncel projesi yoksa kontrol öncesinde projelendirmeyi planlayın.',
      '- Kontrolü yapacak kişinin yetki belgesini (yetkili elektrik mühendisi / tekniker vb.) dosyaya ekleyin.',
      '',
      'Takvimi çıkarmak için [periyodik kontrol planlayıcımızı](/hesaplama/periyodik-kontrol-planlayici/) kullanabilir, ayrıntılı rehber için [elektrik tesisatı periyodik kontrolü](/bilgi/elektrik-tesisati-periyodik-kontrol.html) sayfamıza bakabilirsiniz.',
      '',
      `> Bu yazı bilgilendirme amaçlıdır. Madde özetleri VoltGuard mevzuat kaydından (son kontrol ${regs.checkedText}) alınmıştır; bağlayıcı olan [güncel yönetmelik metni](${reg(ie).url}) ve [23.12.2025 tarihli Resmî Gazete](${rgUrl('23.12.2025')}) metnidir.`
    ].join('\n')
  },
  {
    title: 'Reaktif enerji sınırları: 50 kVA altı ve üstü işletmelerde oranlar ve ceza mantığı',
    category: 'kompanzasyon', tags: ['reaktif-enerji', 'kompanzasyon', 'epdk', 'tarife'], featured: false, pick: true,
    summary: 'Dağıtım şebekesine bağlı işletmelerde reaktif enerji sınırları EPDK Tarife Uygulamaları Usul ve Esasları Madde 13\'te. Kurulu güce göre değişen endüktif/kapasitif oranları, muaf kullanıcıları ve sınır aşıldığında faturalamanın nasıl yapıldığını madde madde açıkladık.',
    source: { name: 'EPDK – Tarife Uygulamalarına İlişkin Usul ve Esaslar', url: reg(rx).url, publishedAt: '2015-12-31', licenseNote: 'Kurul kararı (resmî metin); bağlayıcı olan EPDK\'nın yayımladığı güncel metindir.' },
    related: [['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama'], ['/hesaplama/kompanzasyon-hesaplama/', 'Kompanzasyon hesaplama'], ['/bilgi/reaktif-guc-kompanzasyonu.html', 'Reaktif güç kompanzasyonu rehberi'], ['/voltsim/kompanzasyon/', 'VoltSim kompanzasyon simülasyonu']],
    body: () => [
      `Dağıtım şebekesine bağlı işletmelerin reaktif enerji sınırları, EPDK'nın "${reg(rx).name}" metninde (RG ${reg(rx).rg}) düzenlenir. Sınırlar kurulu güce göre farklıdır ve çoğu işletmede yanlış bilinen bir eşik vardır.`,
      '',
      '## Kimlere uygulanmaz?',
      `**Madde 13 (1):** ${art(rx, 'Madde 13 (1)')}`,
      '',
      '## Oranlar',
      `- **50 kVA altı — Madde 13 (2):** ${art(rx, 'Madde 13 (2)')}`,
      `- **50 kVA ve üstü — Madde 13 (3):** ${art(rx, 'Madde 13 (3)')}`,
      '',
      '## Sınır aşılırsa ne olur?',
      `**Madde 13 (4),(6):** ${art(rx, 'Madde 13 (4),(6)')}`,
      '',
      'Bu nedenle sınırın az da olsa aşılması, yalnızca aşan kısmın değil ölçülen reaktif enerjinin tamamının faturalanmasına yol açar. Kompanzasyon panosunun hem endüktif hem kapasitif tarafta izlenmesi bu yüzden önemlidir: aşırı kompanzasyon da kapasitif sınırı aşarak ceza doğurabilir.',
      '',
      '## İletim sistemine bağlı kullanıcılar farklıdır',
      `**Elektrik Şebeke Yönetmeliği Madde 14 (1):** ${art('sebeke', 'Madde 14 (1)')} Kayıttaki nota göre bu oranlar yalnızca iletime bağlı kullanıcılar içindir; dağıtıma bağlı tüketicilerde yukarıdaki Usul ve Esaslar geçerlidir.`,
      '',
      '## Ne yapmalı?',
      '- Son 12 ayın faturalarında endüktif ve kapasitif oranları ayrı ayrı inceleyin.',
      '- Kurulu gücünüzün 50 kVA eşiğinin hangi tarafında kaldığını kontrol edin; oranlar buna göre değişir.',
      '- Olası cezayı [reaktif ceza hesaplama](/hesaplama/reaktif-ceza-hesaplama/) aracıyla, gereken kondansatör gücünü [kompanzasyon hesaplama](/hesaplama/kompanzasyon-hesaplama/) aracıyla tahmin edin.',
      '',
      `> Not: EPDK sayfasında "son hali" olarak yayımlanan metin okunmuştur; metinde sonraki değişikliklerin tarih listesi bulunmadığı için son değişiklik tarihi doğrulanamamıştır. Uygulamadan önce [EPDK'daki güncel metni](${reg(rx).url}) kontrol edin.`
    ].join('\n')
  },
  {
    title: 'Lisanssız GES\'te depolama: 19.10.2026 değişikliği neyi değiştirdi, neyi değiştirmedi?',
    category: 'yenilenebilir', tags: ['lisanssiz-uretim', 'depolama', 'ges', 'mahsuplasma'], featured: false, pick: true,
    summary: 'Lisanssız Elektrik Üretim Yönetmeliği 2026\'da iki kez kapsamlı değişti. 19.10.2026 değişikliğiyle üretim tesisine bütünleşik depolamada kapasite sınırlaması kaldırıldı; depodan verilen ihtiyaç fazlasına ödeme yapılmaması ve diğer temel kurallar ise sürüyor.',
    source: { name: 'Elektrik Piyasasında Lisanssız Elektrik Üretim Yönetmeliği (mevzuat.gov.tr)', url: reg(ls).url, publishedAt: '2026-10-19', licenseNote: LICENSE_RG },
    related: [['/voltsim/ges/', 'VoltSim GES simülasyonu'], ['/hesaplama/ges-uretim-hesaplama/', 'GES üretim hesaplama'], ['/bilgi/lisanssiz-uretim-ges.html', 'Lisanssız üretim (GES) rehberi'], ['/hizmetler/fabrika-cati-ges.html', 'Fabrika çatı GES']],
    body: () => [
      `${reg(ls).name} (RG ${reg(ls).rg}), çatı ve arazi GES'leri ile küçük RES'lerin öz tüketim kurallarını belirler. Yönetmelik 2026'da **02.04.2026 (sayı 33212)** ve **19.10.2026 (sayı 33405)** tarihlerinde iki kez kapsamlı biçimde değişti. Bu yazıda depolama açısından neyin değiştiğini kayıttaki doğrulanmış hükümlerle ayırıyoruz.`,
      '',
      '## Değişen: bütünleşik depolama',
      `**Ek Madde 3:** ${art(ls, 'Ek Madde 3')}`,
      '',
      `19.10.2026 değişikliği ayrıca acil durumda tesislerin uzaktan kontrolünü ve dengeleme talimatına uymayan tesise ihtiyaç fazlası ödemesi yapılmamasını düzenledi.`,
      '',
      '## Değişmeyen: temel ekonomi kuralları',
      `- **Saatlik mahsuplaşma ve alım — Madde 26 (1),(4):** ${art(ls, 'Madde 26 (1),(4)')}`,
      `- **Ödeme yapılmayan durumlar — Madde 26 (5):** ${art(ls, 'Madde 26 (5)')}`,
      `- **Yıllık üretim sınırı — Madde 26 (17):** ${art(ls, 'Madde 26 (17)')}`,
      '',
      '## Proje açısından anlamı',
      'Depolama kapasitesi artık üretim tesisinin elektriksel gücüne kadar sınırlama olmaksızın planlanabilse de, depodan şebekeye verilen ihtiyaç fazlasına ödeme yapılmadığı için depolamanın değeri esas olarak öz tüketimi artırmasından gelir. Depolama boyutlandırması, tesisin saatlik tüketim profiline göre yapılmalıdır; saatlik mahsuplaşma kuralı bunu belirleyici kılar.',
      '',
      'Kendi tesisiniz için üretim ve öz tüketim dengesini [GES üretim hesaplama](/hesaplama/ges-uretim-hesaplama/) aracı ve [VoltSim GES simülasyonu](/voltsim/ges/) ile inceleyebilirsiniz.',
      '',
      `> Yönetmelik kısa aralıklarla değiştiği için hesaplar [güncel metne](${reg(ls).url}) göre kontrol edilmelidir. Değişikliklerin tamamı: [RG 02.04.2026](${rgUrl('02.04.2026')}), [RG 19.10.2026](${rgUrl('19.10.2026')}).`
    ].join('\n')
  }
];

function analiz(a, i) {
  const t = LAUNCH + 3600 - i * 600;
  return {
    slug: slug(a.title), title: a.title, summary: a.summary, body: a.body(), category: a.category, tags: a.tags, type: 'analiz',
    source: a.source, image: null, status: 'published', publishAt: null, publishedAt: t, author: AUTHOR, editor: AUTHOR,
    seo: { title: '', description: '' }, related: a.related.map(([url, label]) => ({ url, label })),
    featured: a.featured, pick: a.pick, origin: 'seed', ingest: null, flags: [], createdAt: t, updatedAt: t
  };
}

const articles = [...ANALIZ.map(analiz), ...RESMI.map(resmi)];
for (const a of articles) {
  if (a.title.length < 10 || a.title.length > 160) throw new Error('başlık uzunluğu: ' + a.title);
  if (a.summary.length < 40 || a.summary.length > 400) throw new Error('özet uzunluğu: ' + a.title + ' ' + a.summary.length);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)) throw new Error('slug: ' + a.slug);
}
if (new Set(articles.map(a => a.slug)).size !== articles.length) throw new Error('yinelenen slug');
if (new Set(articles.map(a => a.source.url)).size !== articles.length) {
  // Aynı kaynak adresi yinelenen kaynak sayılır; analizler mevzuat.gov.tr metnine, özetler RG sayfasına bağlanır.
  const seen = {}; for (const a of articles) { if (seen[a.source.url]) throw new Error('yinelenen kaynak: ' + a.source.url); seen[a.source.url] = 1; }
}
const json = JSON.stringify({ generated: 'tools/build-volthaber-seed.cjs', registryChecked: regs.checked, articles }, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== json) { console.error('api/lib/volthaber-seed.json güncel değil: node tools/build-volthaber-seed.cjs'); process.exit(1); }
  console.log('api/lib/volthaber-seed.json güncel');
} else {
  fs.writeFileSync(OUT, json);
  console.log(`api/lib/volthaber-seed.json yazıldı (${ANALIZ.length} analiz, ${RESMI.length} resmî özet)`);
}
