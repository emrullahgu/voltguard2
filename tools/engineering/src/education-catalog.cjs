module.exports = [
  {
    file: 'Fotondan_Panele_Atolyesi.html',
    slug: 'fotondan-panele-atolyesi',
    name: 'Fotondan Panele Atölyesi',
    category: 'egitim',
    description: 'Foton, p–n eklemi ve seri hücre ilişkisini keşfedin; ışınımın I–V eğrisine etkisini deneyin.',
    icon: 'sun',
    method: 'Sabit 25 °C ideal tek diyot; örnek Isc 10 A, hücre Voc 0,65 V, n=1,2; seri hücre ve ışınım etkisi; ayrı E=hc/λ deneyi.',
    inputs: 'Işınım (W/m²), seri hücre sayısı, çalışma geriliminin Voc oranı ve bağımsız foton deneyinde dalga boyu.',
    outputs: 'Kavramsal p–n kesiti, foton enerjisi, I–V ve P–V eğrileri, çalışma noktası, örnek maksimum güç ve PDF/proje çıktıları.',
    sources: [
      { title: 'U.S. Department of Energy · Photovoltaic Cell Basics', url: 'https://www.energy.gov/cmei/systems/solar-photovoltaic-cell-basics', note: 'Fotovoltaik dönüşümün teknik dayanağı; bağımsız VoltGuard eğitim uygulaması.' },
      { title: 'Sandia PVPMC · Single Diode Equivalent Circuit Models', url: 'https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/single-diode-equivalent-circuit-models/', note: 'İdeal tek diyot denklemi için referans; örnek parametreler gerçek panel kataloğu değildir.' }
    ]
  },
  {
    file: 'Kacak_Akim_Atolyesi.html',
    slug: 'kacak-akim-atolyesi',
    name: 'Kaçak Akım Atölyesi',
    category: 'egitim',
    description: 'Faz, nötr ve kaçak akımın RCD toroidindeki dengesini görün; 30–500 mA anma değerlerini karşılaştırın.',
    icon: 'ground',
    method: 'Tek fazlı 50 Hz, aynı faz açısındaki sinüzoidal AC akımların farkı; 0,5×IΔn ve IΔn deney bölgeleri. Açma süresi hesaplanmaz.',
    inputs: 'Yük akımı (A RMS), toroid dışından dönen kaçak akım (mA RMS) ve 30/100/300/500 mA RCD anma değeri.',
    outputs: 'Faz/nötr şeması, artık akım, seçili AC deney bölgesi, dört anma değerinin karşılaştırması ve PDF/proje çıktıları.',
    sources: [
      { title: 'Schneider Electric · Sensitivity of RCDs to disturbances', url: 'https://www.electrical-installation.org/enwiki/Sensitivity_of_RCDs_to_disturbances', note: 'AC deney bölgeleri için teknik referans; bağımsız eğitim modeli.' },
      { title: 'Schneider Electric · Types of RCDs', url: 'https://www.electrical-installation.org/enwiki/Types_of_RCDs', note: 'Artık akım dalga biçimi ve RCD tipleri.' },
      { title: 'Doepke · RCD testing basics', url: 'https://doepke.co.uk/technical-publications/rcd-testing-18th-edition-basics/', note: 'Sinüzoidal AC deney koşulları.' }
    ]
  },
  {
    file: 'Iletken_Boru_Atolyesi.html',
    slug: 'iletken-boru-atolyesi',
    name: 'İletken ve Boru Atölyesi',
    category: 'egitim',
    description: 'Fazlar ve nötrün ortak ya da ayrı çelik borulardaki akım çevrimini kesit, fazör ve dalga biçimiyle karşılaştırın.',
    icon: 'wave',
    method: 'Sinüzoidal RMS fazör toplamı, nötr dönüşü ve yarı durağan Ampère çevrim yasası; bağımsız eğitim modeli. Sıcaklık veya kayıp hesabı değildir.',
    inputs: 'L1/L2/L3 RMS akımları, frekans, nötrün ortak boru içindeki/dışındaki yolu ve elektriksel açı.',
    outputs: 'Ortak ve ayrı boru kesitleri, çevrelenen RMS akım, akım değişim hızı, fazör özeti, dalga grafiği ve PDF/proje çıktıları.',
    sources: [
      { title: 'Legrand · Power Guide, Transport and distribution', url: 'https://www.legrandgroup.com/sites/default/files/Documents_PDF_Legrand/Solutions/Power_guide/Power-Guide-Legrand_EX29017.pdf', note: 'Sayfa 58: fazlar ve nötrün aynı metal bölmede taşınması.' },
      { title: 'OpenStax · Ampère’s Law', url: 'https://openstax.org/books/university-physics-volume-2/pages/12-5-amperes-law', note: 'Manyetik çevrim yasası için fizik referansı; kod ve çizimler bağımsızdır.' }
    ]
  }
];
