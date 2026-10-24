'use strict';

// VoltSim sayfa üreticisi: voltsim/index.html (tanıtım) ve voltsim/<slug>/index.html (simülasyonlar).
// Ortak başlık/alt bilgi tools/shell.py ile eklenir: `node tools/build-voltsim.cjs && python tools/shell.py`.
// Mevzuat paneli js/voltsim/regulations.js verisinden statik HTML olarak üretilir (JS kapalıyken ve arama motorlarında görünür).
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const assets = ['css/voltsim.css', 'js/voltsim/core.js', 'js/voltsim/engine.js', 'js/voltsim/regulations.js',
  ...['calc', 'mod'].flatMap(dir => fs.readdirSync(path.join(root, 'js/voltsim', dir)).filter(f => f.endsWith('.js')).sort().map(f => 'js/voltsim/' + dir + '/' + f))];
const V = createHash('sha256').update(assets.map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')).join('\n')).digest('hex').slice(0, 12);
// her dosyanın sürümü kendi içeriğinin SHA-256 özetinden (tools/sync-versions.py ve araclar/ üreticisiyle aynı kural)
const rev = file => { const f = path.join(root, file.replace(/^\//, '')); return fs.existsSync(f) ? createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12) : V; }; // CRLF/LF farkı yok sayılır
const regs = require(path.join(root, 'js/voltsim/regulations.js'));
const SITE = 'https://voltguard.com.tr';

const MODULES = [
  { id: 'pano', slug: 'pano', name: 'Elektrik Pano', short: 'AG dağıtım, MCC, kompanzasyon, otomasyon ve transfer panoları',
    title: '3D Elektrik Pano Simülasyonu: Kısa Devre ve Koruma | VoltSim',
    description: 'ADP, MCC ve transfer panolarını 3D inceleyin; yük ekleyin, motor çalıştırın, faz akımı, gerilim düşümü, kısa devre ve koruma koordinasyonunu anlık hesaplayın.',
    h1: '3D Elektrik Pano Simülasyonu', eyebrow: 'Ana dağıtım · MCC · Transfer',
    lead: 'Ana şalterden baralara, MCB’lerden kontaktörlere kadar endüstriyel bir panoyu açın. Yükleri devreye alın, motorları çalıştırın; faz akımları fazör toplamıyla, kablo ve koruma uygunluğu TS HD 60364 kurallarıyla anında hesaplanır.',
    tags: ['Faz akımları (fazör)', 'P · Q · S · cosφ', 'Ib ≤ In ≤ Iz', 'Gerilim düşümü', 'Kısa devre (IEC 60909 yakl.)', 'Otomatik kesme'],
    service: ['/hizmetler/elektrik-pano-imalati.html', 'Elektrik pano imalatı'],
    related: [['/hesaplama/kablo-kesiti-hesaplama/', 'Kablo kesiti hesabı'], ['/hesaplama/kisa-devre-akimi-hesaplama/', 'Kısa devre akımı'], ['/araclar/ag-kisa-devre/', 'AG kısa devre aracı']] },
  { id: 'ges', slug: 'ges', name: 'GES', short: 'Fabrika çatısı güneş santrali, güneş hareketi ve gölge',
    title: '3D GES Simülasyonu: Çatı Güneş Santrali Tasarımı | VoltSim',
    description: 'Fabrika çatısında GES kurun: güneşin konumu, eğim, gölge, string Voc kontrolü, inverter kırpması, öz tüketim ve geri dönüş senaryosunu 3D olarak inceleyin.',
    h1: '3D GES Simülasyonu', eyebrow: 'Çatı GES · String · Öz tüketim',
    lead: 'Bir fabrika çatısına panelleri yerleştirin, il veya koordinat seçin, gün içinde güneşi hareket ettirin. Soğuk sabahta string açık devre gerilimini, sıcak öğlede MPPT aralığını ve inverter kırpmasını kontrol edin.',
    tags: ['kWp · DC/AC', 'Voc (Tmin)', 'MPPT aralığı', 'Anlık / günlük / yıllık', 'Öz tüketim', 'Geri dönüş'],
    service: ['/hizmetler/fabrika-cati-ges.html', 'Fabrika çatı GES'],
    related: [['/araclar/ges-tasarim/', 'GES tasarım aracı'], ['/hesaplama/ges-uretim-hesaplama/', 'GES üretim hesabı'], ['/hesaplama/inverter-dc-ac-kablo-secimi/', 'İnverter DC/AC kablo']] },
  { id: 'trafo', slug: 'trafo', name: 'Trafo', short: 'Beton köşk trafo merkezi, OG hücreler ve güç trafosu',
    title: '3D Trafo Merkezi Simülasyonu: Kayıp, Verim, Isınma | VoltSim',
    description: 'Beton köşk trafo merkezini 3D inceleyin; trafo gücü, uk, P0 ve Pk ile OG/AG akımı, kayıplar, verim, gerilim değişimi ve yaklaşık kısa devre akımını hesaplayın.',
    h1: '3D Trafo ve Trafo Merkezi Simülasyonu', eyebrow: 'Beton köşk · OG hücre · Güç trafosu',
    lead: 'OG hücrelerinden güç trafosuna ve AG panoya kadar bir trafo merkezini gezin. Yük arttıkça trafonun yüklenmesini, kayıplarını, verimini ve sargı sıcaklığını izleyin.',
    tags: ['I = S/(√3·U)', 'Yüklenme %', 'P0 + Pk·K²', 'Verim', 'Gerilim değişimi', 'Ik ≈ In/uk'],
    service: ['/hizmetler/trafo-merkezi-kurulumu.html', 'Trafo merkezi kurulumu'],
    related: [['/araclar/beton-kosk-yerlesim/', 'Beton köşk yerleşim aracı'], ['/hesaplama/trafo-akimi-hesaplama/', 'Trafo akımı hesabı'], ['/hizmetler/trafo-isletme-sorumlulugu.html', 'Trafo işletme sorumluluğu']] },
  { id: 'sarj', slug: 'sarj-istasyonu', name: 'Şarj İstasyonu', short: 'AC wallbox ve DC hızlı şarj, yük paylaşımı',
    title: 'Elektrikli Araç Şarj İstasyonu Simülasyonu | VoltSim',
    description: 'AC 7,4–22 kW ve DC 60–180 kW şarjı simüle edin: batarya SOC, araç kabul gücü, şarj eğrisi, verim, eşzamanlı araçlar ve dinamik yük paylaşımı.',
    h1: '3D Elektrikli Araç Şarj İstasyonu Simülasyonu', eyebrow: 'AC wallbox · DC hızlı şarj · Yük yönetimi',
    lead: 'Aracı şarj noktasına bağlayın, AC veya DC seçin ve şarjı başlatın. Gücü her an cihaz, araç ve tesis sınırlarının en küçüğü belirler; SOC ve güç grafikleri canlı çizilir.',
    tags: ['SOC → enerji', 'Şarj eğrisi', 'Araç / cihaz / tesis sınırı', 'Verim ve kayıp', 'Dinamik yük paylaşımı', 'RCD gereksinimi'],
    service: ['/hizmetler/elektrik-taahhut.html', 'Elektrik taahhüt ve şarj altyapısı'],
    related: [['/araclar/ev-sarj-suresi/', 'EV şarj süresi aracı'], ['/hesaplama/kw-kva-amper-donusturucu/', 'kW–kVA–A dönüştürücü']] },
  { id: 'res', slug: 'res', name: 'RES', short: 'Rüzgâr türbini, güç eğrisi ve rüzgâr parkı',
    title: '3D Rüzgâr Türbini (RES) Simülasyonu ve Güç Eğrisi | VoltSim',
    description: 'Dönen rotorlu 3D rüzgâr türbini: rüzgâr hızı, hava yoğunluğu, Cp, Betz sınırı, nominal güç, cut-in/cut-out ve Weibull dağılımıyla yıllık üretim senaryosu.',
    h1: '3D RES / Rüzgâr Enerjisi Simülasyonu', eyebrow: 'Rüzgâr türbini · Güç eğrisi · Park',
    lead: 'Rüzgârı artırın: rotor hızlanır, nominalde kanat açısı devreye girer, fırtınada türbin güvenli duruşa geçer. Güç ½·ρ·A·Cp·v³ ile, verimler ayrı ayrı uygulanarak hesaplanır.',
    tags: ['½·ρ·A·Cp·v³', 'Betz sınırı', 'Cut-in / cut-out', 'Güç eğrisi', 'Hava yoğunluğu', 'Weibull AEP'],
    service: ['/hizmetler/elektrik-projesi.html', 'Elektrik projesi'],
    related: [['/araclar/', 'Mühendislik uygulamaları']] },
  { id: 'komp', slug: 'kompanzasyon', name: 'Kompanzasyon', short: 'Kondansatör kademeleri, harmonik ve rezonans',
    title: '3D Kompanzasyon ve Harmonik Simülasyonu | VoltSim',
    description: 'Kompanzasyon panosunda kademeleri açıp kapatın; Qc = P·(tanφ1 − tanφ2), harmonik spektrum, THDi/THDv ve paralel rezonans riskini empedans modeliyle görün.',
    h1: '3D Kompanzasyon ve Harmonik Simülasyonu', eyebrow: 'Kondansatör · Reaktör · Harmonik filtre',
    lead: 'Reaktif güç rölesi kademeleri devreye alır; ayarlı (detuned) reaktörlerle ya da reaktörsüz grupla harmoniklerin nasıl büyüdüğünü veya söndüğünü trafo ve kondansatör empedanslarıyla hesaplayın.',
    tags: ['Qc = P·(tanφ1 − tanφ2)', 'Kademe seçimi', 'THDi / THDv', 'Paralel rezonans', 'Ayarlı filtre', 'Şönt reaktör'],
    service: ['/hizmetler/harmonik-filtreli-kompanzasyon.html', 'Harmonik filtreli kompanzasyon'],
    related: [['/hesaplama/kompanzasyon-hesaplama/', 'Kompanzasyon hesabı'], ['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesabı'], ['/araclar/harmonik-thd/', 'Harmonik THD aracı']] },
  { id: 'topraklama', slug: 'topraklama', name: 'Topraklama', short: 'Elektrotlar, dokunma/adım gerilimi, TT/TN/IT',
    title: '3D Topraklama Simülasyonu: Dokunma ve Adım Gerilimi | VoltSim',
    description: 'Çubuk, şerit ve ağ topraklama elektrotlarını toprak özdirenciyle modelleyin; topraklama direnci, GPR, dokunma ve adım gerilimi, TT/TN/IT kesme koşulları.',
    h1: '3D Topraklama ve Elektrik Güvenliği Simülasyonu', eyebrow: 'Elektrot · Potansiyel · Sistem tipi',
    lead: 'Toprak altını açın: elektrotlar, potansiyel dağılımı ve eşpotansiyel bağlantılar. Kabul koşulu sistem tipine ve koruma düzenine göre değerlendirilir; tek bir sabit ohm sınırı yoktur.',
    tags: ['Çubuk · şerit · ağ', 'GPR', 'Dokunma / adım', 'TT: RA·IΔn ≤ UL', 'TN / IT', 'Eşpotansiyel'],
    service: ['/hizmetler/topraklama-olcumu.html', 'Topraklama ölçümü'],
    related: [['/araclar/topraklama-simulatoru/', 'Topraklama simülatörü'], ['/hesaplama/topraklama-hesaplama/', 'Topraklama hesabı'], ['/araclar/adim-gerilimi/', 'Adım gerilimi aracı']] },
  { id: 'motor', slug: 'motor-otomasyon', name: 'Motor & PLC', short: 'MCC, yıldız-üçgen, sürücü ve PLC mantığı',
    title: '3D Motor, MCC ve PLC Otomasyon Simülasyonu | VoltSim',
    description: 'Asenkron motoru doğrudan, yıldız-üçgen, yumuşak yol verici veya frekans konvertörüyle çalıştırın; akım, devir, moment, termik röle ve kilitlemeli PLC mantığı.',
    h1: '3D Motor, MCC ve PLC Otomasyon Simülasyonu', eyebrow: 'Asenkron motor · Kontaktör · PLC',
    lead: 'Başlat butonuna basın: PLC mühürler, yıldız kontaktörü kapanır, zaman rölesi sonunda kilitli geçişle üçgene geçilir. Motorun yol alması moment dengesiyle hesaplanır.',
    tags: ['In · Tn', 'Yol alma eğrisi', 'Y-Δ / soft / VFD', 'Termik sınıfı', 'Kilitlemeler', 'Acil durdurma'],
    service: ['/hizmetler/plc-scada-otomasyon.html', 'PLC & SCADA otomasyon'],
    related: [['/hesaplama/motor-akimi-hesaplama/', 'Motor akımı hesabı'], ['/hesaplama/motor-koruma-kontaktor-secimi/', 'Motor koruma ve kontaktör'], ['/araclar/motor-hiz-tork/', 'Motor hız–tork aracı']] },
  { id: 'ups', slug: 'ups-jenerator', name: 'UPS & Jeneratör', short: 'Şebeke kesintisi, UPS, ATS ve jeneratör',
    title: '3D UPS, Jeneratör ve ATS Simülasyonu | VoltSim',
    description: 'Şebeke kesintisini simüle edin: UPS akü süresi, jeneratör devreye girişi, kilitlemeli otomatik transfer şalteri, kritik yükler ve yakıt süresi.',
    h1: '3D UPS ve Jeneratör Simülasyonu', eyebrow: 'UPS · ATS · Jeneratör',
    lead: 'Şebekeyi kesin: kritik yükler UPS aküsünden beslenir, ATS onay süresinden sonra jeneratörü çalıştırır ve kilitli açık geçişle yükü aktarır. Şebeke dönünce geri aktarma ve soğutma çalışır.',
    tags: ['Akü süresi', 'UPS yüklenmesi', 'ATS durum makinesi', 'Kilitleme', 'Jeneratör yüklenmesi', 'Yakıt süresi'],
    service: ['/hizmetler/elektrik-taahhut.html', 'Elektrik taahhüt'],
    related: [['/hesaplama/ups-gucu-hesaplama/', 'UPS gücü hesabı'], ['/hesaplama/jenerator-gucu-hesaplama/', 'Jeneratör gücü hesabı'], ['/araclar/batarya-enerji-sure/', 'Batarya enerji süresi']] },
  { id: 'yangin', slug: 'yangin-algilama', name: 'Yangın Algılama', short: 'Dedektörler, panel durumları ve tahliye',
    title: '3D Yangın Algılama Sistemi Simülasyonu | VoltSim',
    description: 'Fabrika ve depo ortamında duman yayılımını, dedektör algılamasını, yangın alarm kontrol paneli durumlarını ve tahliye senaryosunu eğitim amaçlı simüle edin.',
    h1: '3D Yangın Algılama Sistemi Simülasyonu', eyebrow: 'Dedektör · Kontrol paneli · Tahliye',
    lead: 'Bir bölgede yangın başlatın: duman tavana yayılır, dedektörler sırayla algılar, panel ön alarm ve yangın alarmına geçer, sirenler çalar ve tahliye süresi hesaplanır. Eğitim senaryosudur; yangın projesi yerine geçmez.',
    tags: ['Duman yayılımı', 'Bölge alarmı', 'Çift dedektör onayı', 'EN 54-2 durumları', 'Siren / flaşör', 'Tahliye süresi'],
    service: ['/hizmetler/elektrik-projesi.html', 'Elektrik projesi'],
    related: [['/bilgi/mevzuat-kutuphanesi.html', 'Mevzuat kütüphanesi']] },
  { id: 'depolama', slug: 'depolama-hibrit', name: 'Depolama & Hibrit', short: 'LiFePO4 batarya, GES/RES/dizel hibrit santral ve dağıtım stratejileri',
    title: '3D Batarya Enerji Depolama (BESS) ve Hibrit Santral Simülasyonu | VoltSim',
    description: 'Fabrikanız için LiFePO4 batarya, GES, RES ve dizel jeneratörlü hibrit santrali saat saat simüle edin: öz tüketim, tepe tıraşlama, yedek rezerv, SOC, çevrim ve maliyet.',
    h1: '3D Batarya Enerji Depolama ve Hibrit Santral Simülasyonu', eyebrow: 'BESS · GES · RES · Dizel · Şebeke',
    lead: 'Fabrikanın 24 saatlik yük profiline GES, rüzgâr, dizel jeneratör ve LiFePO4 batarya ekleyin. Dağıtım stratejisini seçin; batarya, şebeke ve jeneratör arasındaki güç akışı her saat için hesaplanır ve 3D sahnede canlı akar.',
    tags: ['SOC · DoD · C-oranı', 'Çevrim verimi √η', 'Öz tüketim / tepe tıraşlama', 'Yedek rezerv · ada modu', 'Üç zamanlı tarife', 'Öz yeterlilik · çevrim'],
    service: ['/hizmetler/fabrika-cati-ges.html', 'Fabrika çatı GES ve depolama'],
    related: [['/araclar/mesken-ges-depolama/', 'GES + depolama aracı'], ['/araclar/batarya-enerji-sure/', 'Batarya enerji süresi'], ['/bilgi/lisanssiz-uretim-ges.html', 'Lisanssız üretim (GES)'], ['/hesaplama/ges-uretim-hesaplama/', 'GES üretim hesabı']] },
  { id: 'ariza', slug: 'ariza-tespit', name: 'Arıza Tespit Lab', short: 'Sanal ölçü aletleriyle AG tesiste arıza bulma ve güvenli ölçüm',
    title: '3D Elektrik Arıza Tespit Laboratuvarı: Ölçümle Arıza Bulma | VoltSim',
    description: 'Rastgele ama tekrarlanabilir arıza senaryolarında multimetre, pens ampermetre, 500 V yalıtım ölçer, döngü empedansı ve termal kamerayla ölçüm yapın; teşhisinizi puanlayın.',
    h1: '3D Elektrik Arıza Tespit Laboratuvarı', eyebrow: 'Multimetre · Yalıtım · Döngü · Termal kamera',
    lead: 'Küçük bir AG tesiste gizli bir arıza var: açık nötr, gevşek bağlantı, faz kaybı, yalıtım hatası, TT toprak hatası… 3D sahnede noktalara prob bağlayın; her ölçüm devre modelinden hesaplanır. Önce ayırın, kilitleyin, gerilim yokluğunu doğrulayın.',
    tags: ['Fazör devre çözücü', 'Açık nötr · hayalet gerilim', 'Yalıtım 500 V DC', 'Döngü empedansı', 'Faz sırası', 'EN 50110 beş kural'],
    service: ['/hizmetler/elektrik-periyodik-kontrol.html', 'Elektrik periyodik kontrol'],
    related: [['/bilgi/enerjisiz-calisma-is-guvenligi.html', 'Enerjisiz çalışma ve iş güvenliği'], ['/bilgi/kacak-akim-rolesi-ariza-nedenleri.html', 'Kaçak akım rölesi neden atar?'], ['/bilgi/elektrik-tesisati-periyodik-kontrol.html', 'Tesisat periyodik kontrolü'], ['/hesaplama/topraklama-hesaplama/', 'Topraklama hesabı']] }
];

const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DISCLAIMER = 'VoltSim mühendislik eğitimi ve ön değerlendirme amacıyla hazırlanmıştır. Nihai proje, ekipman seçimi, uygulama ve mevzuat uygunluğu yetkili mühendis tarafından değerlendirilmelidir.';

function head(o) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <!--vg:head--><!--/vg:head-->
  <title>${esc(o.title)}</title>
  <meta name="description" content="${esc(o.description)}">
  <link rel="canonical" href="${SITE}${o.url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(o.ogTitle || o.title)}">
  <meta property="og:description" content="${esc(o.description)}">
  <meta property="og:url" content="${SITE}${o.url}">
  <meta property="og:image" content="${SITE}${o.image || '/public/og-image.png'}">
  <meta property="og:locale" content="tr_TR">
  <meta property="og:site_name" content="VoltGuard">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" href="/public/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
  <link rel="stylesheet" href="/css/voltsim.css?v=${rev('/css/voltsim.css')}">
${o.scripts || ''}  <script type="application/ld+json">${JSON.stringify(o.ld)}</script>
</head>`;
}

function regsSection(id) {
  const list = regs.filter(r => (r.applies || []).includes(id));
  const binding = list.filter(r => r.binding), std = list.filter(r => !r.binding);
  const item = r => {
    const arts = (r.articles || []).filter(a => a.verified);
    return `<li class="vs-reg${r.needsCheck ? ' vs-reg--check' : ''}">
          <div class="vs-reg__top"><span class="vs-reg__kind">${esc(r.kind)}</span>${r.issuer ? `<span class="vs-reg__iss">${esc(r.issuer)}</span>` : ''}</div>
          <strong>${esc(r.name)}</strong>
          ${r.rg ? `<span class="vs-reg__rg">Resmî Gazete ${esc(r.rg)}</span>` : ''}${r.version ? `<span class="vs-reg__rg">${esc(r.version)}</span>` : ''}
          <p>${esc(r.note)}</p>
          ${arts.length ? `<ul class="vs-reg__arts">${arts.map(a => `<li><b>${esc(a.ref)}</b> ${esc(a.summary)}</li>`).join('')}</ul>` : ''}
          ${r.amendments ? `<p class="vs-reg__am">Değişiklikler: ${esc(r.amendments)}</p>` : ''}
          ${r.needsCheck ? '<p class="vs-reg__warn">Güncel mevzuat doğrulaması gereklidir.</p>' : ''}
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${r.binding ? 'Resmî kaynak' : 'Katalog sayfası'} ↗</a>` : ''}
        </li>`;
  };
  return `<section class="vs-regs" id="mevzuat" aria-labelledby="mevzuat-h">
      <div class="vs-sec-head">
        <h2 id="mevzuat-h">Mevzuat ve teknik standartlar</h2>
        <p>Bağlayıcı düzenlemeler (kanun, yönetmelik) ile gönüllü standartlar ayrı listelenmiştir. Standartlar bir yönetmelik atıf yaptığında veya sözleşmede istendiğinde bağlayıcı hale gelir. Son kontrol: <time datetime="${regs.checked}">${esc(regs.checkedText)}</time>.</p>
      </div>
      <div class="vs-regs__cols">
        <div><h3>Bağlayıcı düzenlemeler</h3><ul class="vs-reg-list">${binding.map(item).join('')}</ul></div>
        <div><h3>Standartlar ve rehberler</h3><ul class="vs-reg-list">${std.map(item).join('')}</ul></div>
      </div>
    </section>`;
}

function crumbLd(items) {
  return { '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[1], item: SITE + it[0] })) };
}

function modulePage(m) {
  const url = `/voltsim/${m.slug}/`;
  const others = MODULES.filter(x => x !== m);
  const ld = { '@context': 'https://schema.org', '@graph': [crumbLd([['/', 'Ana Sayfa'], ['/voltsim/', 'VoltSim'], [url, m.h1]]),
    { '@type': 'WebApplication', name: m.h1, url: SITE + url, applicationCategory: 'EngineeringApplication', operatingSystem: 'Web', inLanguage: 'tr', isAccessibleForFree: true, description: m.description, publisher: { '@type': 'Organization', name: 'VoltGuard', url: SITE + '/' } }] };
  const scripts = ['/js/vendor/three-r128.min.js', '/js/voltsim/engine.js', `/js/voltsim/calc/${m.id}.js`, '/js/voltsim/regulations.js', '/js/voltsim/core.js', `/js/voltsim/mod/${m.id}.js`]
    .map(s => `  <script src="${s}?v=${rev(s)}" defer></script>\n`).join('');
  const ico = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  return `${head({ title: m.title, description: m.description, url, ld, scripts, image: `/public/voltsim/${m.id}.webp` })}
<body class="vs-page doc-shell">
  <!--vg:header--><!--/vg:header-->
  <main class="vs-main" id="main" tabindex="-1">
    <nav class="vs-crumb" aria-label="Sayfa yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">/</span><a href="/voltsim/">VoltSim</a><span aria-hidden="true">/</span><span aria-current="page">${esc(m.name)}</span></nav>
    <header class="vs-head">
      <div>
        <p class="vs-eyebrow">VoltSim · ${esc(m.eyebrow)}</p>
        <h1>${esc(m.h1)}</h1>
        <p class="vs-lead">${esc(m.lead)}</p>
      </div>
      <ul class="vs-tags" aria-label="Hesaplama ve analizler">${m.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </header>

    <div class="vs-app" data-vs-module="${m.id}">
      <div class="vs-toolbar" role="toolbar" aria-label="Simülasyon araçları">
        <div class="vs-toolbar__g">
          <button class="vs-tb vs-tb--primary" type="button" data-vs-act="start">${ico('<path d="M7 4.5v15l12-7.5z"/>')}<span>Simülasyonu başlat</span></button>
          <button class="vs-tb" type="button" data-vs-act="pause" aria-pressed="false">${ico('<path d="M8 5v14M16 5v14"/>')}<span>Durdur</span></button>
          <button class="vs-tb" type="button" data-vs-act="reset">${ico('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>')}<span>Sıfırla</span></button>
          <label class="vs-tb vs-tb--select"><span class="sr-only">Örnek senaryo yükle</span><select data-vs-scenario><option value="">Örnek senaryo yükle…</option></select></label>
        </div>
        <div class="vs-toolbar__g">
          <button class="vs-tb" type="button" data-vs-act="mode" aria-pressed="false">${ico('<path d="M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4"/>')}<span>2D şema</span></button>
          <button class="vs-tb" type="button" data-vs-act="report">${ico('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>')}<span>Teknik rapor (PDF)</span></button>
          <button class="vs-tb" type="button" data-vs-act="csv">${ico('<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16"/>')}<span>CSV</span></button>
          <button class="vs-tb" type="button" data-vs-act="save">${ico('<path d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"/>')}<span>Projeyi kaydet</span></button>
          <button class="vs-tb" type="button" data-vs-act="load">${ico('<path d="M12 15V3m-4 4 4-4 4 4M5 15v6h14v-6"/>')}<span>Projeyi yükle</span></button>
          <input type="file" accept=".json,application/json" data-vs-file hidden>
        </div>
        <p class="vs-scn" data-vs-scenario-desc aria-live="polite"></p>
      </div>

      <div class="vs-mtabs" role="tablist" aria-label="Çalışma alanı">
        <button type="button" role="tab" id="vs-tab-params" aria-controls="vs-pane-params" data-vs-pane="params" aria-selected="false" tabindex="-1">Parametreler</button>
        <button type="button" role="tab" id="vs-tab-stage" aria-controls="vs-pane-stage" data-vs-pane="stage" aria-selected="true">3D Simülasyon</button>
        <button type="button" role="tab" id="vs-tab-analysis" aria-controls="vs-pane-analysis" data-vs-pane="analysis" aria-selected="false" tabindex="-1">Analiz</button>
      </div>

      <div class="vs-work" data-pane="stage">
        <section class="vs-left" id="vs-pane-params" aria-labelledby="vs-left-h">
          <h2 class="vs-panel-h" id="vs-left-h">Parametreler</h2>
          <div class="vs-scroll" data-vs-controls></div>
        </section>
        <section class="vs-center" id="vs-pane-stage" aria-label="3D simülasyon alanı">
          <div class="vs-stage" data-vs-stage data-mode="3d">
            <canvas class="vs-canvas" role="img" aria-label="${esc(m.h1)} — döndürmek için sürükleyin; klavyede ok tuşları ve +/− kamera, [ ve ] ekipman seçer, Enter ayrıntı kartını açar"></canvas>
            <canvas class="vs-2d" data-vs-2d role="img" aria-label="2D şema görünümü"></canvas>
            <div class="vs-labels" aria-hidden="true"></div>
            <div class="vs-hud"><span class="vs-badge" data-vs-badge data-level="info">Hazırlanıyor…</span></div>
            <div class="vs-vtools" role="group" aria-label="Görünüm araçları">
              <button class="vs-vt" type="button" data-vs-act="labels" aria-pressed="true" title="Etiketler" data-vs-3donly>${ico('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>')}<span class="sr-only">Etiketler</span></button>
              <button class="vs-vt" type="button" data-vs-act="ghost" aria-pressed="false" title="Şeffaf kapak" data-vs-3donly>${ico('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/><path d="M9 9h6v6H9z"/>')}<span class="sr-only">Şeffaf kapak</span></button>
              <button class="vs-vt" type="button" data-vs-act="section" aria-pressed="false" title="Kesit görünümü" data-vs-3donly>${ico('<path d="M4 4h16v16H4z"/><path d="M12 2v20"/>')}<span class="sr-only">Kesit görünümü</span></button>
              <button class="vs-vt" type="button" data-vs-act="explode" aria-pressed="false" title="Patlatılmış görünüm" data-vs-3donly>${ico('<path d="M12 3v5m0 8v5M3 12h5m8 0h5"/><rect x="9" y="9" width="6" height="6" rx="1"/>')}<span class="sr-only">Patlatılmış görünüm</span></button>
              <button class="vs-vt" type="button" data-vs-act="spin" aria-pressed="false" title="Otomatik döndür" data-vs-3donly>${ico('<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>')}<span class="sr-only">Otomatik döndür</span></button>
              <button class="vs-vt" type="button" data-vs-act="camera" title="Kamerayı sıfırla" data-vs-3donly>${ico('<path d="M3 12h4m10 0h4M12 3v4m0 10v4"/><circle cx="12" cy="12" r="4"/>')}<span class="sr-only">Kamera görünümünü sıfırla</span></button>
              <button class="vs-vt" type="button" data-vs-act="full" title="Tam ekran">${ico('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>')}<span class="sr-only">Tam ekran</span></button>
            </div>
            <div class="vs-clip" data-vs-clip hidden><label>Kesit konumu <input type="range" min="0" max="100" value="55"></label></div>
            <div class="vs-info" data-vs-info hidden role="dialog" aria-label="Ekipman ayrıntısı"></div>
            <p class="vs-hint">Sürükle: döndür · Sağ tık/iki parmak: kaydır · Tekerlek: yakınlaştır · Ekipmana tıkla ya da [ ] ve Enter: ayrıntı</p>
            <div class="vs-fallback" data-vs-fallback hidden role="status" aria-live="polite"><strong>3D görünüm açılamadı.</strong> Tarayıcınız WebGL desteklemiyor ya da kapalı; 2D şema gösteriliyor. Hesaplar, grafikler ve rapor çalışmaya devam eder.</div>
          </div>
        </section>
        <section class="vs-right" id="vs-pane-analysis" aria-labelledby="vs-right-h">
          <h2 class="vs-panel-h" id="vs-right-h">Analiz</h2>
          <div class="vs-scroll" data-vs-analysis>
            <div data-vs-ro></div>
            <div class="vs-charts" data-vs-charts></div>
            <h3 class="vs-sub">Uygunluk ön kontrolü</h3>
            <p class="vs-small">Model sınırları içindeki ön kontroldür; tasarım doğrulaması veya resmî onay değildir.</p>
            <ul class="vs-checks" data-vs-checks></ul>
            <details class="vs-asm"><summary>Varsayımlar ve bağıntılar</summary><div data-vs-assumptions></div></details>
            <a class="vs-jump" href="#mevzuat">Mevzuat ve standartlar ↓</a>
          </div>
        </section>
      </div>
      <noscript><p class="vs-noscript">Simülasyon için JavaScript gereklidir. Aşağıdaki mevzuat ve standart bilgileri JavaScript olmadan da okunabilir.</p></noscript>
    </div>

    <p class="vs-disclaimer"><strong>Önemli:</strong> ${DISCLAIMER} Girdileriniz yalnızca tarayıcınızda işlenir; VoltGuard’a gönderilmez.</p>

    ${regsSection(m.id)}

    <section class="vs-cta" aria-labelledby="cta-h">
      <div>
        <h2 id="cta-h">Bu sistemi tesisiniz için projelendirelim.</h2>
        <p>VoltGuard mühendislik ekibiyle projenizi gerçek tesis koşullarına göre değerlendirin. Raporunuzu paylaşmak isterseniz indirip teklif talebinize ekleyebilirsiniz; simülasyon girdileri bizimle siz istemedikçe paylaşılmaz.</p>
      </div>
      <div class="vs-cta__btns">
        <a class="vs-cbtn vs-cbtn--primary" href="/#iletisim">VoltGuard’dan Teklif Al</a>
        <a class="vs-cbtn" href="/sor.html">Mühendislik Desteği Al</a>
        <a class="vs-cbtn" href="${m.service[0]}">İlgili Hizmeti İncele: ${esc(m.service[1])}</a>
      </div>
    </section>

    <section class="vs-more" aria-labelledby="more-h">
      <h2 id="more-h">İlgili araçlar</h2>
      <ul class="vs-links">${m.related.map(r => `<li><a href="${r[0]}">${esc(r[1])}</a></li>`).join('')}</ul>
      <h2>Diğer simülasyonlar</h2>
      <ul class="vs-links">${others.map(o => `<li><a href="/voltsim/${o.slug}/">${esc(o.name)}</a></li>`).join('')}</ul>
    </section>
  </main>
  <!--vg:footer--><!--/vg:footer-->
</body>
</html>
`;
}

function landing() {
  const url = '/voltsim/';
  const ld = { '@context': 'https://schema.org', '@graph': [crumbLd([['/', 'Ana Sayfa'], [url, 'VoltSim']]),
    { '@type': 'CollectionPage', name: 'VoltSim — 3D Mühendislik Simülasyon Merkezi', url: SITE + url, inLanguage: 'tr', description: 'VoltGuard mühendisliğiyle geliştirilen interaktif 3D simülasyon laboratuvarı.',
      hasPart: MODULES.map(m => ({ '@type': 'WebApplication', name: m.h1, url: `${SITE}/voltsim/${m.slug}/`, applicationCategory: 'EngineeringApplication', operatingSystem: 'Web' })) }] };
  const cards = MODULES.map((m, i) => `
        <li class="vsl-card" style="--d:${i * 40}ms">
          <a href="/voltsim/${m.slug}/" class="vsl-card__a">
            <div class="vsl-card__img"><img src="/public/voltsim/${m.id}.webp?v=${rev('/public/voltsim/' + m.id + '.webp')}" alt="${esc(m.h1)} 3D sahne önizlemesi" width="640" height="400" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"></div>
            <div class="vsl-card__body">
              <h3>${esc(m.h1.replace(/^3D /, ''))}</h3>
              <p>${esc(m.short)}</p>
              <ul class="vsl-card__tags" aria-label="İçerdiği analizler">${m.tags.slice(0, 4).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
              <span class="vsl-card__go">Simülasyonu başlat <span aria-hidden="true">→</span></span>
            </div>
          </a>
        </li>`).join('');
  return `${head({ title: 'VoltSim — 3D Mühendislik Simülasyon Merkezi | VoltGuard', ogTitle: 'VoltSim — Enerjiyi Gör. Sistemi Kur. Sonucu Ölç.',
    description: 'Elektrik panosu, GES, trafo, şarj istasyonu, RES, kompanzasyon, topraklama, motor otomasyon, UPS/jeneratör ve yangın algılama için gerçek hesaplı 3D simülasyonlar.', url, ld, image: '/public/voltsim/pano.webp' })}
<body class="vs-page vsl-page doc-shell">
  <!--vg:header--><!--/vg:header-->
  <main class="vs-main" id="main" tabindex="-1">
    <nav class="vs-crumb" aria-label="Sayfa yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">VoltSim</span></nav>
    <section class="vsl-hero" aria-labelledby="vsl-h">
      <div class="vsl-hero__txt">
        <p class="vs-eyebrow">VoltGuard · 3D Mühendislik Simülasyon Merkezi</p>
        <h1 id="vsl-h">VoltSim</h1>
        <p class="vsl-hero__sub">Enerjiyi Gör. Sistemi Kur. Sonucu Ölç.</p>
        <p class="vsl-hero__lead">VoltGuard mühendisliğiyle geliştirilen interaktif 3D simülasyon laboratuvarı. Elektrik panolarını keşfedin, enerji sistemlerini modelleyin, mühendislik hesaplarını anlık inceleyin.</p>
        <div class="vsl-hero__btns"><a class="vs-cbtn vs-cbtn--primary" href="/voltsim/pano/">Pano simülasyonuyla başla</a><a class="vs-cbtn vs-cbtn--ghost" href="#simulasyonlar">Tüm simülasyonlar</a></div>
      </div>
      <div class="vsl-hero__img"><img src="/public/voltsim/hero.webp?v=${rev('/public/voltsim/hero.webp')}" alt="VoltSim 3D pano ve enerji sistemleri sahnesi" width="960" height="600" fetchpriority="high"></div>
      <ul class="vsl-facts">
        <li><strong>10</strong><span>simülasyon modülü</span></li>
        <li><strong>Ayrı motor</strong><span>test edilen hesap fonksiyonları</span></li>
        <li><strong>PDF · JSON · CSV</strong><span>rapor ve proje dosyası</span></li>
        <li><strong>Kaynaklı</strong><span>mevzuat ve standart paneli</span></li>
      </ul>
    </section>

    <section class="vsl-grid-sec" id="simulasyonlar" aria-labelledby="vsl-grid-h">
      <div class="vs-sec-head"><h2 id="vsl-grid-h">Simülasyonlar</h2><p>Her modülde parametre paneli, 3D çalışma alanı, anlık grafikler, uygunluk ön kontrolü ve mevzuat notları bulunur.</p></div>
      <ul class="vsl-grid">${cards}
      </ul>
    </section>

    <section class="vsl-how" aria-labelledby="vsl-how-h">
      <h2 id="vsl-how-h">Nasıl çalışır?</h2>
      <ol>
        <li><strong>Parametreleri girin</strong><span>Ekipman, gerilim, güç ve katalog değerlerini girin ya da örnek senaryo yükleyin. Hatalı girdiler anında işaretlenir.</span></li>
        <li><strong>Sistemi çalıştırın</strong><span>3D sahne, bağımsız hesap motorunun sonucunu gösterir: akım akışı, ısınma, açma, şarj, dönüş.</span></li>
        <li><strong>Sonucu ölçün</strong><span>Grafikleri, ön kontrolleri ve varsayımları inceleyin; A4 PDF rapor, JSON proje ve CSV veri dosyası alın.</span></li>
      </ol>
    </section>

    <section class="vsl-trust" aria-labelledby="vsl-trust-h">
      <div class="vs-sec-head"><h2 id="vsl-trust-h">Mühendislik güvenilirliği</h2></div>
      <div class="vsl-trust__grid">
        <article><h3>Görsel değil, hesap önce</h3><p>Formüller 3D sahneden bağımsız, otomatik testlerle doğrulanan fonksiyonlardır. Örneğin 1000 kVA, 400 V trafonun AG akımı 1443 A; 60 kWh bataryada %20→%80 ideal enerji 36 kWh.</p></article>
        <article><h3>Varsayımlar açık</h3><p>Her sonucun yanında kullanılan bağıntı ve sınırlama yazar. Üretici eğrisi gerektiren konularda (açma süresi, sıcaklık, akü deşarjı) kesin değer uydurulmaz.</p></article>
        <article><h3>Mevzuat ayrımı</h3><p>Bağlayıcı yönetmelikler ile gönüllü standartlar ayrı gösterilir; doğrulanamayan bilgi “Güncel mevzuat doğrulaması gereklidir” notuyla işaretlenir.</p></article>
      </div>
    </section>

    <p class="vs-disclaimer"><strong>Önemli:</strong> ${DISCLAIMER} “Simülasyon uygunluğu”, resmî proje onayı veya mevzuata uygunluk belgesi anlamına gelmez.</p>

    <section class="vs-cta" aria-labelledby="cta-h">
      <div><h2 id="cta-h">Bu sistemi tesisiniz için projelendirelim.</h2><p>VoltGuard mühendislik ekibiyle projenizi gerçek tesis koşullarına göre değerlendirin.</p></div>
      <div class="vs-cta__btns"><a class="vs-cbtn vs-cbtn--primary" href="/#iletisim">VoltGuard’dan Teklif Al</a><a class="vs-cbtn" href="/sor.html">Mühendislik Desteği Al</a><a class="vs-cbtn" href="/hizmetler/">Hizmetlerimizi İnceleyin</a></div>
    </section>
  </main>
  <!--vg:footer--><!--/vg:footer-->
</body>
</html>
`;
}

function writeIfChanged(file, text) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // shell.py'nin eklediği bölgeleri koru: mevcut dosyadaki vg bölgelerini yeni metne taşı
  if (fs.existsSync(abs)) {
    const old = fs.readFileSync(abs, 'utf8');
    for (const name of ['head', 'header', 'footer']) {
      const re = new RegExp(`<!--vg:${name}-->[\\s\\S]*?<!--/vg:${name}-->`);
      const m = old.match(re);
      if (m) text = text.replace(re, () => m[0]);
    }
    if (old === text) return false;
  }
  fs.writeFileSync(abs, text);
  return true;
}

let changed = 0;
if (writeIfChanged('voltsim/index.html', landing())) changed++;
for (const m of MODULES) if (writeIfChanged(`voltsim/${m.slug}/index.html`, modulePage(m))) changed++;
console.log(`VoltSim: ${MODULES.length + 1} sayfa üretildi (${changed} değişti). Ardından: python tools/shell.py voltsim`);
module.exports = { MODULES };
