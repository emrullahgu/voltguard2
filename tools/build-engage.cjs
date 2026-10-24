'use strict';

// Geri dönüş (return-visit) bileşeni verisi: js/vg-engage-data.js (window.VG_ENGAGE_DATA).
// Kaynaklar: sözlük (tools/data/elektrik-terimleri.cjs), üretilmiş VoltSim sayfaları (voltsim/<slug>/index.html),
// hesap araçları (hesaplama/*.html) ve aşağıdaki doğrulanmış mühendislik soruları. Sunucu gerekmez.
//   node tools/build-engage.cjs          veriyi yazar
//   node tools/build-engage.cjs --check  veri güncel değilse hata verir
// VoltSim modül listesi build-voltsim.cjs'yi çalıştırmadan, üretilmiş sayfalardan okunur (o betik yan etki üretir).
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const OUT = 'js/vg-engage-data.js';
const TERMS = require('./data/elektrik-terimleri.cjs');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] != null ? ENT[e] : m));
const text = h => decode(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const pick = (html, re) => { const m = html.match(re); return m ? text(m[1]) : ''; };

/* Sözlük maddesi: tanım ilk 1–2 cümleyle kısaltılır (en fazla ~240 karakter). */
function shortDef(def) {
  const sentences = def.match(/[^.!?]+[.!?]+(\s|$)/g) || [def];
  let out = '';
  for (const s of sentences) { if ((out + s).length > 240 && out) break; out += s; }
  return out.trim();
}
const terms = TERMS.map(t => ({ id: t.id, term: t.term, def: shortDef(t.def),
  link: t.links && t.links[0] ? t.links[0] : null, url: '/bilgi/elektrik-terimleri-sozlugu.html#' + t.id }));

const sims = fs.readdirSync(path.join(root, 'voltsim'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
  .map(slug => {
    const file = path.join(root, 'voltsim', slug, 'index.html');
    if (!fs.existsSync(file)) return null;
    const html = fs.readFileSync(file, 'utf8');
    const id = (html.match(/data-vs-module="([a-z0-9-]+)"/) || [])[1];
    if (!id) return null;
    return { id, slug, name: pick(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i), desc: decode((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [, ''])[1]), url: `/voltsim/${slug}/` };
  }).filter(Boolean);

const tools = fs.readdirSync(path.join(root, 'hesaplama')).filter(f => f.endsWith('.html')).sort().map(f => {
  const html = fs.readFileSync(path.join(root, 'hesaplama', f), 'utf8');
  const slug = f.replace(/\.html$/, '');
  return { slug, name: pick(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i).replace(/:.*$/, ''), url: `/hesaplama/${slug}/` };
});
// "Öne çıkan araçlar": kullanım verisi yokken gösterilen, elle seçilmiş liste (popülerlik iddiası taşımaz).
const FEATURED = ['fabrika-elektrik-risk-testi', 'reaktif-ceza-hesaplama', 'trafo-kapasite-artirimi', 'harmonik-filtre-ihtiyaci', 'kablo-kesiti-hesaplama', 'kompanzasyon-hesaplama'];

// Haftanın mühendislik sorusu: her yanıt sitedeki kaynak sayfada yazan bilgiye dayanır (src).
const QUESTIONS = [
  { q: 'Kurulu gücü 50 kVA ve üzerindeki bir işletmede endüktif reaktif enerji, aktif enerjinin en fazla yüzde kaçı olabilir?',
    o: ['%15', '%20', '%33', '%50'], a: 1, e: 'Sınır %20\'dir (50 kVA altı kurulu güçte %33). Aşılırsa ölçülen endüktif reaktif enerjinin tamamı faturalanır.',
    src: ['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama'] },
  { q: 'Aynı abone grubunda (50 kVA ve üzeri) kapasitif reaktif enerji sınırı nedir?',
    o: ['%10', '%15', '%20', '%33'], a: 1, e: 'Kapasitif sınır aktif enerjinin %15\'idir. Gece veya düşük yükte devrede kalan kondansatörler bu sınırı aşmanın en yaygın nedenidir.',
    src: ['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama'] },
  { q: 'Reaktif sınır aşıldığında faturaya ne yansır?',
    o: ['Yalnızca sınırı aşan kısım', 'Dönemde ölçülen reaktif enerjinin tamamı', 'Sabit bir idari para cezası', 'Yalnızca yazılı uyarı'], a: 1,
    e: 'Oranlardan biri aşılırsa aşan kısım değil, ölçülen reaktif enerjinin tamamı reaktif enerji birim fiyatıyla faturalanır. Takvim yılının ilk ihlali aynı faturada düşülür.',
    src: ['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama'] },
  { q: 'İş Ekipmanları Yönetmeliği EK-III Tablo-3\'e göre elektrik iç tesisatı periyodik kontrolü en fazla ne kadar aralıkla yapılmalıdır?',
    o: ['6 ay', '1 yıl', '2 yıl', '5 yıl'], a: 1, e: 'İlgili standartta daha kısa süre yoksa elektrik ve topraklama tesisatı, yıldırımdan korunma, transformatör, jeneratör ve akümülatör için periyot en fazla 1 yıldır.',
    src: ['/bilgi/elektrik-tesisati-periyodik-kontrol.html', 'Elektrik tesisatı periyodik kontrol'] },
  { q: 'p = %7 seri reaktörlü (detuned) kompanzasyon kademesinin ayar (rezonans) frekansı yaklaşık kaçtır?',
    o: ['134 Hz', '189 Hz', '250 Hz', '350 Hz'], a: 1, e: 'f = 50 Hz ÷ √0,07 ≈ 189 Hz; böylece rezonans 5. harmoniğin (250 Hz) altına çekilir. p = %14 için ayar ≈ 134 Hz\'dir.',
    src: ['/bilgi/reaktif-guc-kompanzasyonu.html', 'Reaktif güç kompanzasyonu'] },
  { q: '400 V şebekede p = %7 reaktörlü kademede neden 440 V anma gerilimli kondansatör seçilir?',
    o: ['Reaktör kondansatör gerilimini U ÷ (1 − p) ≈ 430 V\'a yükselttiği için', 'Harmonikler şebeke gerilimini düşürdüğü için', 'Trafo çıkış gerilimi 440 V olduğu için', 'Kondansatör ömrünü kısaltmak için'], a: 0,
    e: 'Seri reaktör kondansatör uçlarındaki gerilimi U ÷ (1 − p) kadar yükseltir: 400 ÷ 0,93 ≈ 430 V. Bu yüzden 440 V (p = %14\'te 480 V) kondansatör kullanılır.',
    src: ['/bilgi/reaktif-guc-kompanzasyonu.html', 'Reaktif güç kompanzasyonu'] },
  { q: 'EN 50160 ve IEEE 519\'a göre AG barasında gerilim toplam harmonik bozulması (THDv) için kullanılan sınır nedir?',
    o: ['%3', '%5', '%8', '%15'], a: 2, e: 'AG barasında THDv sınırı %8\'dir; EN 50160\'ta bir haftalık 10 dakikalık ortalamaların %95\'i için değerlendirilir.',
    src: ['/bilgi/harmonik-nedir-sorunlari.html', 'Harmonik nedir?'] },
  { q: '30 mA kaçak akım rölesiyle korunan TT sistemde topraklama direnci için hesap sınırı (RA × IΔn ≤ 50 V) yaklaşık kaç Ω\'dur?',
    o: ['2 Ω', '10 Ω', '166 Ω', '1.667 Ω'], a: 3, e: 'RA ≤ 50 V ÷ 0,03 A ≈ 1.667 Ω. Elektrot yaşlanması ve mevsim etkisi nedeniyle sahada çok daha düşük değer hedeflenir.',
    src: ['/bilgi/topraklama-degeri-kac-olmali.html', 'Topraklama değeri kaç olmalı?'] },
  { q: 'Elektrik İç Tesisleri Yönetmeliği Madde 57\'ye göre yapı bağlantı kutusu ile tüketici arasında motor devrelerinde izin verilen gerilim düşümü yüzde kaçtır?',
    o: ['%1,5', '%3', '%5', '%10'], a: 1, e: 'Motor devrelerinde %3, aydınlatma ve priz devrelerinde %1,5 sınırdır.',
    src: ['/bilgi/gerilim-dusumu-nedir.html', 'Gerilim düşümü nedir?'] },
  { q: '1000 kVA\'lık bir dağıtım trafosunun 400 V tarafındaki anma akımı yaklaşık kaç amperdir?',
    o: ['577 A', '1000 A', '1443 A', '2500 A'], a: 2, e: 'I = S ÷ (√3 × U) = 1.000.000 ÷ (1,732 × 400) ≈ 1443 A.',
    src: ['/bilgi/kisa-devre-akimi-nedir.html', 'Kısa devre akımı ve trafo tablosu'] },
  { q: '1000 kVA, uk = %6 bir trafonun AG çıkışında beklenen üç fazlı kısa devre akımı yaklaşık kaçtır?',
    o: ['6 kA', '14,4 kA', '24 kA', '60 kA'], a: 2, e: 'Ik ≈ In ÷ uk = 1443 A ÷ 0,06 ≈ 24 kA (şebeke sonsuz kabul edilirse). Şalterlerin kesme kapasitesi bu değerin üzerinde seçilir.',
    src: ['/bilgi/kisa-devre-akimi-nedir.html', 'Kısa devre akımı nedir?'] },
  { q: 'TS HD 60364-4-41\'e göre 32 A\'ya kadar priz devrelerinde ek koruma olarak hangi kaçak akım rölesi istenir?',
    o: ['10 mA', '30 mA', '300 mA', '500 mA'], a: 1, e: '32 A\'ya kadar priz devrelerinde ve dış mekânda kullanılan seyyar cihaz devrelerinde 30 mA RCD ek koruma olarak istenir; 300 mA yangın koruması içindir.',
    src: ['/bilgi/kacak-akim-rolesi-secimi.html', 'Kaçak akım rölesi seçimi'] }
];

function build() {
  const data = { v: 1, terms, sims, tools, featured: FEATURED.filter(s => tools.some(t => t.slug === s)), questions: QUESTIONS };
  return '/* Otomatik üretildi: node tools/build-engage.cjs — elle düzenlemeyin. */\nwindow.VG_ENGAGE_DATA=' + JSON.stringify(data) + ';\n';
}

if (require.main === module) {
  const out = build();
  const file = path.join(root, OUT);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur !== out) { console.error(OUT + ' güncel değil: node tools/build-engage.cjs'); process.exit(1); }
    console.log(OUT + ' güncel');
  } else {
    fs.writeFileSync(file, out);
    console.log(`${OUT} yazıldı (${terms.length} terim, ${sims.length} simülasyon, ${tools.length} araç, ${QUESTIONS.length} soru)`);
  }
}
module.exports = { QUESTIONS, FEATURED, build };
