/*!
 * VoltGuard – factory.js  (yalnızca /fabrika-cozumleri.html)
 * Etkileşimli tek hat şeması, Fabrika Elektrik Sağlık Testi, reaktif ceza ve plansız duruş
 * hesaplayıcıları, sektör sekmeleri, sayaçlar, süreç zaman çizelgesi ve Teklif Sihirbazı.
 * Bağımlılık yok; defer ile yüklenir. Animasyonlar transform/opacity ile yapılır,
 * ekran dışındayken durur ve prefers-reduced-motion'da statik kalır.
 *
 * Çapalar: #reaktif-ceza ve #durus-maliyeti ilgili hesaplayıcı sekmesini açar; ana sayfadaki hızlı
 * tahmin ?saat=..&tl=..#durus-maliyeti ile duruş hesaplayıcısına aktarılır. #teklif-sihirbazi = #teklif.
 *
 * Teklif Sihirbazı /contact.php'ye index.html iletişim formuyla AYNI alanları gönderir:
 *   name, phone, email, subject (elektrik|elektronik|otomasyon|mekanik|diger), message (20-1000),
 *   website (honeypot), formTimestamp (ms), cf-turnstile-response (site anahtarı varsa).
 */
(function () {
  'use strict';

  /* =====================================================================
     YAPILANDIRMA — tek hat şemasındaki bağlantı hedefleri
     `service`: "Hizmet detayları" düğmesinin hedefi (/hizmetler/<slug>.html hizmet sayfası).
     `items`: "İlgili kaynaklar" listesi; önce ilgili diğer hizmet sayfaları, sonra rehber /
     hesaplama / soru sayfaları. Hedef değişirse yalnızca burayı düzenleyin ve
     fabrika-cozumleri.html'deki factory.js ?v= değerini artırın.
     ===================================================================== */
  var FX_LINKS = {
    sebeke: {
      service: '/hizmetler/trafo-isletme-sorumlulugu.html',
      items: [
        ['Trafo merkezi kurulumu', '/hizmetler/trafo-merkezi-kurulumu.html'],
        ['Yüksek gerilim işletme sorumluluğu', '/bilgi/yuksek-gerilim-isletme-sorumlulugu.html'],
        ['Kuvvetli akım tesisleri', '/bilgi/kuvvetli-akim-tesisleri.html'],
        ['SMM (Serbest Müşavir Mühendislik)', '/bilgi/smm-serbest-musavir-muhendislik.html']
      ]
    },
    trafo: {
      service: '/hizmetler/trafo-bakimi.html',
      items: [
        ['Trafo işletme sorumluluğu', '/hizmetler/trafo-isletme-sorumlulugu.html'],
        ['Trafo periyodik bakımı', '/bilgi/trafo-periyodik-bakim.html'],
        ['Trafo akımı hesaplama', '/hesaplama/trafo-akimi-hesaplama/'],
        ['kVA – amper hesabı', '/bilgi/kva-amper-hesaplama.html']
      ]
    },
    adp: {
      service: '/hizmetler/elektrik-pano-imalati.html',
      items: [
        ['Elektrik periyodik kontrol', '/hizmetler/elektrik-periyodik-kontrol.html'],
        ['Elektrik projesi', '/hizmetler/elektrik-projesi.html'],
        ['TMŞ seçimi rehberi', '/bilgi/tms-secimi-rehberi.html'],
        ['Kısa devre akımı hesaplama', '/hesaplama/kisa-devre-akimi-hesaplama/']
      ]
    },
    komp: {
      service: '/hizmetler/harmonik-filtreli-kompanzasyon.html',
      items: [
        ['Enerji kalitesi ölçümü', '/hizmetler/enerji-kalitesi-olcumu.html'],
        ['Reaktif güç kompanzasyonu', '/bilgi/reaktif-guc-kompanzasyonu.html'],
        ['Harmonik nedir?', '/bilgi/harmonik-nedir-sorunlari.html'],
        ['Kompanzasyon hesaplama', '/hesaplama/kompanzasyon-hesaplama/'],
        ['Cosφ 0,98 ama ceza var', '/sor/cosfi-098-fatura-reaktif-ceza.html']
      ]
    },
    tali: {
      service: '/hizmetler/elektrik-taahhut.html',
      items: [
        ['Topraklama ölçümü', '/hizmetler/topraklama-olcumu.html'],
        ['VFD (frekans invertörü) nedir?', '/bilgi/vfd-frekans-invertoru-nedir.html'],
        ['Motor akımı hesaplama', '/hesaplama/motor-akimi-hesaplama/'],
        ['Kablo kesiti hesaplama', '/hesaplama/kablo-kesiti-hesaplama/'],
        ['VFD overcurrent hatası', '/sor/vfd-overcurrent-hatasi.html']
      ]
    },
    scada: {
      service: '/hizmetler/plc-scada-otomasyon.html',
      items: [
        ['SCADA ve IEC 61850', '/bilgi/scada-iec-61850.html'],
        ['PLC nedir, nasıl çalışır?', '/bilgi/plc-nedir-nasil-calisir.html'],
        ['Arıtma tesisi SCADA otomasyonu', '/bilgi/scada-aritma-tesisi-otomasyonu.html'],
        ['Modbus RTU haberleşme sorunları', '/sor/modbus-rtu-haberlesme-kesiliyor.html']
      ]
    },
    ges: {
      service: '/hizmetler/fabrika-cati-ges.html',
      items: [
        ['Lisanssız üretim (GES)', '/bilgi/lisanssiz-uretim-ges.html'],
        ['GES için kaç panel gerekir?', '/bilgi/ges-kac-panel-lazim.html'],
        ['GES üretim hesaplama', '/hesaplama/ges-uretim-hesaplama/'],
        ['İnverter DC/AC kablo seçimi', '/hesaplama/inverter-dc-ac-kablo-secimi/']
      ]
    }
  };

  /* Şemadaki blokların içerikleri (genel mühendislik bilgisi; müşteri iddiası içermez). */
  var FX_NODES = {
    sebeke: {
      kicker: 'Orta gerilim giriş',
      title: 'Şebeke / OG Hücre',
      risks: [
        'Güncel olmayan koruma rölesi ve kesici ayarları seçicilik sorunlarına yol açar.',
        'Bakımı aksayan OG hücrelerde ark ve yangın riski artar.',
        'YG tesisinde işletme sorumlusu ataması ve kayıtlar eksik kalabilir.'
      ],
      does: [
        'Yüksek gerilim tesisleri için işletme sorumluluğu (EMO onaylı sözleşme ile)',
        'OG hücre ve koruma ekipmanlarının periyodik kontrolü',
        'Yeni yatırımlarda devreye alma ve kabul öncesi hazırlık'
      ],
      services: ['trafo', 'smm']
    },
    trafo: {
      kicker: 'OG / AG güç trafosu',
      title: 'Trafo',
      risks: [
        'Yağ, sıcaklık ve bağlantı kontrolleri aksarsa arıza belirtileri geç fark edilir.',
        'Aşırı yüklenme ve harmonikler trafoda ısınma ve ömür kaybı yaratır.',
        'Yüksüz çalışmada bile çekilen mıknatıslama akımı reaktif tüketimi artırır.'
      ],
      does: [
        'Trafo periyodik bakımı, ölçüm ve raporlama',
        'Trafo işletme sorumluluğu',
        'Trafo kiosk montajı ve güç trafosu devreye alma'
      ],
      services: ['trafo', 'periyodik']
    },
    adp: {
      kicker: 'AG ana dağıtım',
      title: 'Ana Dağıtım Panosu (ADP)',
      risks: [
        'Gevşek bağlantılar ve ısınan baralar yangın riskinin başlıca kaynağıdır.',
        'Kısa devre hesabına uymayan kesici seçimi güvenlik ve seçicilik sorunu doğurur.',
        'Etiketsiz ve güncel olmayan panolar arıza müdahalesini uzatır.'
      ],
      does: [
        'Elektrik pano kurulumu ve revizyonu',
        'Periyodik kontrol ve ölçüm hizmetleri',
        'Düzenli, etiketli kablo tavası ve kablolama'
      ],
      services: ['pano', 'periyodik']
    },
    komp: {
      kicker: 'Güç faktörü ve enerji kalitesi',
      title: 'Kompanzasyon / Harmonik Filtre',
      risks: [
        '50 kVA ve üzeri tesislerde aylık endüktif oran %20\'yi veya kapasitif oran %15\'i aşarsa ölçülen reaktif enerjinin tamamı faturalanır.',
        'Harmonikli tesiste reaktörsüz kondansatör bankası rezonansa girip hasar görebilir.',
        'Yaşlanan kondansatörler kapasite kaybeder; röle hedef değere ulaşamaz.'
      ],
      does: [
        'Reaktif tüketim ve harmonik ölçümü, enerji kalitesi raporu',
        'Harmonik filtreli kompanzasyon tasarımı ve kurulumu',
        'Röle ayarı ve kademe optimizasyonu'
      ],
      services: ['kompanzasyon', 'enerji-kalitesi'],
      calc: true
    },
    tali: {
      kicker: 'Üretim hattı yükleri',
      title: 'Tali Panolar, Motorlar ve VFD',
      risks: [
        'Motor koruması ile kablo kesiti uyumsuzluğu sık termik açmaya ve duruşa yol açar.',
        'Sürücüler (VFD) harmonik üretir; yanlış parametre kalkışta hataya neden olur.',
        'Kaçak akım ve topraklama sorunları can güvenliğini tehdit eder.'
      ],
      does: [
        'Sürücü (VFD) ve motor kontrol sistemleri',
        'Tesis kurulumu, revizyonu ve arıza giderme',
        'Topraklama ölçümü ve koruma sistemleri'
      ],
      services: ['vfd', 'tesis', 'topraklama']
    },
    scada: {
      kicker: 'Veri, alarm ve raporlama',
      title: 'SCADA / İzleme',
      risks: [
        'Tüketim izlenmediğinde kayıplar ve ceza ancak faturada görülür.',
        'Alarm altyapısı olmayan tesiste arıza, duruş başladıktan sonra fark edilir.',
        'Farklı markalı cihazlar arasındaki haberleşme kopuklukları veri kaybına yol açar.'
      ],
      does: [
        'SCADA sistemi kurulumu ve izleme',
        'PLC yazılım geliştirme ve sistem entegrasyonu',
        'Uzaktan izleme ve kontrol sistemleri'
      ],
      services: ['otomasyon']
    },
    ges: {
      kicker: 'Öz tüketim üretimi',
      title: 'GES (Çatı Güneş Enerjisi)',
      risks: [
        'GES şebekeden çekilen aktif enerjiyi azaltır; reaktif oran yükselip ceza riski doğabilir.',
        'Yanlış dizi ve kablo seçimi ile eksik topraklama verim ve güvenlik kaybı yaratır.',
        'Bağlantı ve izin süreci iyi planlanmazsa devreye alma gecikir.'
      ],
      does: [
        'Çatı GES fizibilitesi ve kapasite planlaması',
        'GES tasarımı, kurulumu ve izlenmesi',
        'GES sonrası kompanzasyon ayarlarının gözden geçirilmesi'
      ],
      services: ['ges', 'kompanzasyon']
    }
  };

  /* Akış katmanı segmentleri: [x1, y1, x2, y2, tür]  (tür: p=enerji, g=GES, r=reaktif, d=veri) */
  var FX_SEGMENTS = [
    [300, 70, 300, 128, 'p'], [300, 200, 300, 258, 'p'], [300, 268, 300, 330, 'p'], [300, 392, 300, 420, 'p'],
    [300, 420, 230, 420, 'p'], [300, 420, 370, 420, 'p'],
    [230, 420, 230, 453, 'p'], [300, 420, 300, 453, 'p'], [370, 420, 370, 453, 'p'],
    [510, 150, 510, 258, 'g'],
    [115, 330, 115, 268, 'r'],
    [460, 268, 460, 330, 'd'], [560, 150, 560, 330, 'd'], [375, 361, 420, 361, 'd'],
    [115, 392, 115, 512, 'd'], [115, 512, 500, 512, 'd'], [500, 512, 500, 392, 'd']
  ];

  var SVC_LABELS = {
    trafo: 'Trafo işletme sorumluluğu',
    smm: 'SMM hizmetleri',
    periyodik: 'Periyodik kontrol ve ölçüm',
    topraklama: 'Topraklama ve yıldırımdan korunma',
    kompanzasyon: 'Kompanzasyon / harmonik filtre',
    'enerji-kalitesi': 'Enerji kalitesi ölçümü',
    pano: 'Pano kurulumu / revizyonu',
    tesis: 'Tesis revizyonu ve arıza giderme',
    otomasyon: 'PLC / SCADA ve uzaktan izleme',
    vfd: 'Sürücü (VFD) ve motor kontrol',
    ges: 'GES (çatı güneş enerjisi)',
    mekanik: 'Mekanik sistemler / üretim hattı',
    diger: 'Diğer'
  };
  var SECTOR_LABELS = {
    gida: 'Gıda', tekstil: 'Tekstil', otomotiv: 'Otomotiv yan sanayi', metal: 'Metal / Plastik işleme',
    kimya: 'Kimya / İlaç', lojistik: 'Lojistik / Soğuk depo', diger: 'Diğer'
  };

  /* Sağlık testi risk alanları (öneriler sitedeki rehberlerle uyumlu, genel ifadelerdir). */
  var AREAS = {
    trafo: { label: 'Trafo bakımı', advice: 'Trafonun periyodik bakımı, ölçümü ve raporlaması planlanmalı.', svc: ['trafo', 'periyodik'] },
    uyum: { label: 'Periyodik kontrol (yasal uyum)', advice: 'Elektrik tesisatı kontrolleri genellikle en geç yılda bir tekrarlanır; rapor yetkili kişi tarafından düzenlenmelidir.', svc: ['periyodik'] },
    topraklama: { label: 'Topraklama ve yıldırımdan korunma', advice: 'Endüstriyel tesislerde topraklama ölçümleri genellikle yılda bir yapılır; nemli ortamlarda daha sık.', svc: ['topraklama'] },
    reaktif: { label: 'Reaktif ceza', advice: 'Aylık kVArh/kWh oranı ölçülmeli; kompanzasyon kademeleri ve röle ayarları gözden geçirilmeli.', svc: ['kompanzasyon', 'enerji-kalitesi'] },
    pano: { label: 'Pano ve bağlantı güvenliği', advice: 'Isınan bağlantılar ve yaşlanan panolar için kontrol ve revizyon planı yapılmalı.', svc: ['pano', 'periyodik'] },
    sureklilik: { label: 'Enerji sürekliliği', advice: 'Duruşların kök nedeni analiz edilmeli; izleme ve önleyici bakım programı kurulmalı.', svc: ['tesis', 'otomasyon'] },
    sorumluluk: { label: 'İşletme sorumluluğu', advice: 'YG tesislerinde EMO onaylı sözleşmeyle bir elektrik işletme sorumlusu atanmalıdır.', svc: ['trafo', 'smm'] },
    kalite: { label: 'Enerji kalitesi ve harmonikler', advice: 'Sürücü ve doğrusal olmayan yük oranı yüksekse harmonik ölçümü yapılmalı.', svc: ['enerji-kalitesi', 'kompanzasyon'] },
    dokuman: { label: 'Dokümantasyon', advice: 'Güncel tek hat şeması ve pano etiketleri arıza müdahalesini hızlandırır; kontrollerde tesisat projesi aranır.', svc: ['smm', 'pano'] }
  };

  var ILLER = 'Adana,Adıyaman,Afyonkarahisar,Ağrı,Aksaray,Amasya,Ankara,Antalya,Ardahan,Artvin,Aydın,Balıkesir,Bartın,Batman,Bayburt,Bilecik,Bingöl,Bitlis,Bolu,Burdur,Bursa,Çanakkale,Çankırı,Çorum,Denizli,Diyarbakır,Düzce,Edirne,Elazığ,Erzincan,Erzurum,Eskişehir,Gaziantep,Giresun,Gümüşhane,Hakkari,Hatay,Iğdır,Isparta,İstanbul,İzmir,Kahramanmaraş,Karabük,Karaman,Kars,Kastamonu,Kayseri,Kilis,Kırıkkale,Kırklareli,Kırşehir,Kocaeli,Konya,Kütahya,Malatya,Manisa,Mardin,Mersin,Muğla,Muş,Nevşehir,Niğde,Ordu,Osmaniye,Rize,Sakarya,Samsun,Siirt,Sinop,Sivas,Şanlıurfa,Şırnak,Tekirdağ,Tokat,Trabzon,Tunceli,Uşak,Van,Yalova,Yozgat,Zonguldak';

  /* Reaktif sınırlar (%): EPDK Tarife Uygulamaları Usul ve Esasları md. 13 (RG 30.04.2022/31825).
     hesaplama/reaktif-ceza-hesaplama.html'deki LIMITS ile aynı tutulmalı. Sınır aşılırsa aşan kısım değil,
     ölçülen reaktif enerjinin tamamı; iki sınır birden aşılırsa en yüksek sayaç değeri faturalanır (md. 13/4, 13/6).
     Takvim yılındaki ilk ihlalin bedeli aynı faturada düşülür (md. 13/1): yıllık tahmin 11 ay üzerinden. */
  var RK_LIMITS = {
    ge50: { ind: 20, cap: 15, label: '50 kVA ve üzeri' },
    lt50: { ind: 33, cap: 20, label: '50 kVA altı' }
  };
  var RK_BILLED_MONTHS = 11;

  var KEY_WIZ = 'vg_fx_wizard_v1';
  var KEY_HEALTH = 'vg_fx_health_v1';
  var KEY_CALC = 'vg_fx_calc_v1';
  var KEY_LAST_SUBMIT = 'vg_last_submit_at';   // js/main.js ile ortak (60 sn bekleme)
  var SUBMIT_COOLDOWN = 60000;
  var SUBMIT_TIMEOUT = 25000;                  // sunucu yanıt vermezse gönderimi kes

  /* =====================================================================
     Yardımcılar
     ===================================================================== */
  var doc = document;
  var win = window;
  win.__fxReady = true;
  var main = doc.querySelector('main.fx');
  if (!main) return;

  var mqReduce = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var mqHover = win.matchMedia ? win.matchMedia('(hover: hover) and (pointer: fine)') : { matches: false };
  function motionOK() { return !mqReduce.matches; }
  var hasIO = 'IntersectionObserver' in win;

  function qs(s, c) { return (c || doc).querySelector(s); }
  function qsa(s, c) { return [].slice.call((c || doc).querySelectorAll(s)); }
  function byId(id) { return doc.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var NF0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NF2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
  var NF3 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  function tl(n) { return NF0.format(Math.round(n)) + ' TL'; }
  function pct(n) { return '%' + NF1.format(n); }

  /* Türkçe sayı girişi: "120.000", "120000", "1,5", "1.250,75" */
  function parseNum(s) {
    s = String(s == null ? '' : s).replace(/\s|TL|₺|%/gi, '');
    if (!s) return NaN;
    if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  var store = {
    get: function (k) { try { var v = win.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { win.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { win.localStorage.removeItem(k); } catch (e) { /* yok say */ } },
    raw: function (k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } },
    setRaw: function (k, v) { try { win.localStorage.setItem(k, v); } catch (e) { /* yok say */ } }
  };

  /* Bir modül hata verirse diğerleri çalışmaya devam etsin; bozuk kayıt varsa silinsin */
  function guard(name, key, fn, fallback) {
    try { return fn(); } catch (err) {
      if (key) store.del(key);
      if (win.console && console.error) console.error('[factory.js] ' + name + ':', err);
      return fallback;
    }
  }

  /* İl adı: büyük/küçük harf ve Türkçe karakter farkını yok sayarak listedeki resmi adı döndürür */
  var ILLER_LIST = ILLER.split(',');
  function foldTr(v) {
    return String(v == null ? '' : v).trim().toLocaleLowerCase('tr-TR')
      .replace(/[çğıöşüâîû]/g, function (c) { return { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' }[c]; })
      .replace(/\u0307/g, '').replace(/\s+/g, ' ');
  }
  var ILLER_FOLD = ILLER_LIST.map(foldTr);
  function canonCity(v) {
    var i = ILLER_FOLD.indexOf(foldTr(v));
    return i > -1 ? ILLER_LIST[i] : '';
  }

  /* Speculation Rules ile önceden işlenen (prerender) sayfada animasyonları etkinleşmeye ertele */
  function whenActive(fn) {
    if (doc.prerendering) doc.addEventListener('prerenderingchange', fn, { once: true });
    else fn();
  }
  function onceVisible(target, fn, opts) {
    if (!target) return;
    if (!hasIO) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { io.disconnect(); whenActive(fn); }
      });
    }, opts || { threshold: 0.3 });
    io.observe(target);
  }
  function restartAnim(node, cls) {
    if (!motionOK()) return;
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  /* Ekran okuyucu duyuruları */
  var live = el('p', 'fx-sr');
  live.setAttribute('aria-live', 'polite');
  main.appendChild(live);
  function announce(msg) {
    live.textContent = '';
    setTimeout(function () { live.textContent = msg; }, 60);
  }

  function scrollToId(id) {
    if (win.VGShell && typeof win.VGShell.scrollTo === 'function') { win.VGShell.scrollTo(id); return; }
    var t = byId(id);
    if (t) t.scrollIntoView({ behavior: motionOK() ? 'smooth' : 'auto', block: 'start' });
  }

  /* =====================================================================
     Kaydırma ile beliren öğeler
     ===================================================================== */
  guard('reveal', null, function initReveal() {
    var els = qsa('.fx-rv');
    if (!hasIO || !motionOK()) { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
    els.forEach(function (e) {
      var i = 0, p = e.previousElementSibling;
      while (p && p.classList.contains('fx-rv') && i < 4) { i++; p = p.previousElementSibling; }
      if (i) e.style.transitionDelay = (i * 70) + 'ms';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    els.forEach(function (e) { io.observe(e); });
  });

  /* =====================================================================
     Sekmeler (hesaplayıcılar + sektörler)
     ===================================================================== */
  function initTabs(container, onChange) {
    var tabs = qsa('[role="tab"]', container);
    var list = qs('[role="tablist"]', container);
    var panels = tabs.map(function (t) { return byId(t.getAttribute('aria-controls')); });
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = j === i;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (panels[j]) {
          panels[j].hidden = !on;
          if (on) restartAnim(panels[j], 'is-enter');
        }
      });
      if (list && list.scrollWidth > list.clientWidth) {
        var t = tabs[i];
        var left = t.offsetLeft - (list.clientWidth - t.offsetWidth) / 2;
        list.scrollTo({ left: Math.max(0, left), behavior: motionOK() ? 'smooth' : 'auto' });
      }
      if (focus) tabs[i].focus();
      if (onChange) onChange(i);
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (e) {
        var n = tabs.length, j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % n;
        else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j !== null) { e.preventDefault(); select(j, true); }
      });
    });
    return { select: select, tabs: tabs };
  }

  /* =====================================================================
     Teklif Sihirbazı (diğer modüller Wizard API'sini kullanır)
     ===================================================================== */
  var WIZ_STUB = {
    setType: function () {}, setSector: function () {}, preselect: function () {}, attach: function () {},
    go: function () { scrollToId('teklif'); }
  };
  var Wizard = guard('wizard', KEY_WIZ, function () {
    var form = byId('fxWizForm');
    var wrap = byId('fxWiz');
    if (!form || !wrap) return WIZ_STUB;
    var steps = qsa('.fx-wstep', form);
    var stepLis = qsa('.fx-wiz__steps li', wrap);
    var bar = byId('fxWizBar');
    var status = byId('fxWizStatus');
    var btnPrev = qs('[data-fx-w="prev"]', form);
    var btnNext = qs('[data-fx-w="next"]', form);
    var btnSubmit = qs('[data-fx-w="submit"]', form);
    var errBox = byId('fxWizErr');
    var done = byId('fxWizDone');
    var attachedBox = byId('fxWizAttached');
    var attachedList = byId('fxWizAttachedList');
    var draftState = byId('fxDraftState');
    var heading = byId('fxWizTitle');
    var ts = byId('wzTs');
    var hp = byId('wzWebsite');
    var phone = byId('wzPhone');
    var note = byId('wzNote');
    var noteC = byId('wzNoteC');
    var preview = byId('wzPreview');
    var previewCount = byId('wzPreviewCount');
    var cap = byId('wzCaptcha');
    var capKey = cap ? (cap.getAttribute('data-sitekey') || '') : '';
    var capOn = !!cap && capKey !== '' && capKey.indexOf('REPLACE_WITH') !== 0;
    var capWidget = null, capLoading = false;
    var idx = 0;
    var attached = {};          // anahtar -> metin (sağlık testi / hesaplayıcı özetleri)
    var sending = false;
    var saveTimer = 0;

    /* İl listesi */
    var dl = byId('fxIller');
    if (dl && !dl.options.length) {
      var frag = doc.createDocumentFragment();
      ILLER.split(',').forEach(function (n) { var o = doc.createElement('option'); o.value = n; frag.appendChild(o); });
      dl.appendChild(frag);
    }

    function stamp() { if (ts) ts.value = String(Date.now()); }
    stamp();
    win.addEventListener('pageshow', function (e) { if (e.persisted) stamp(); });

    /* ---- Değer yardımcıları ---- */
    function radioVal(name) { var r = qs('input[name="' + name + '"]:checked', form); return r ? r.value : ''; }
    function setRadio(name, v) { qsa('input[name="' + name + '"]', form).forEach(function (r) { r.checked = r.value === v; }); }
    function checks(name) { return qsa('input[name="' + name + '"]:checked', form).map(function (c) { return c.value; }); }
    function val(id) { var e = byId(id); return e ? String(e.value || '').trim() : ''; }

    function collect() {
      return {
        type: radioVal('wzType') || 'on',
        sector: radioVal('wzSector'),
        facility: val('wzFacility'),
        trafo: val('wzTrafo'),
        trafoCount: val('wzTrafoCount'),
        power: val('wzPower'),
        ges: radioVal('wzGes'),
        services: checks('wzServices'),
        note: val('wzNote'),
        urgency: radioVal('wzUrgency'),
        city: canonCity(val('wzCity')) || val('wzCity'),
        osb: val('wzOsb'),
        name: val('wzName'),
        company: val('wzCompany'),
        phone: val('wzPhone'),
        email: val('wzEmail')
      };
    }

    function subjectFor(svcs) {
      var elek = ['trafo', 'smm', 'periyodik', 'topraklama', 'kompanzasyon', 'enerji-kalitesi', 'pano', 'tesis', 'ges'];
      var has = function (list) { return svcs.some(function (s) { return list.indexOf(s) > -1; }); };
      if (has(elek)) return 'elektrik';
      if (has(['otomasyon', 'vfd'])) return 'otomasyon';
      if (has(['mekanik'])) return 'mekanik';
      return 'diger';
    }
    var SUBJECT_LABELS = { elektrik: 'Elektrik Hizmetleri', otomasyon: 'Otomasyon Sistemleri', mekanik: 'Mekanik Sistemler', diger: 'Diğer / Genel Danışmanlık' };

    function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, '') + '…' : s; }

    /* contact.php: mesaj 20–1000 karakter. Önce not, sonra ekler kısaltılır. */
    function buildMessage(d) {
      var head = [];
      head.push('[Fabrika Teklif Sihirbazı] ' + (d.type === 'teklif' ? 'Fiyat teklifi talebi' : 'Ücretsiz ön değerlendirme talebi'));
      if (d.company) head.push('Firma: ' + d.company);
      head.push('Sektör: ' + (SECTOR_LABELS[d.sector] || '-') + (d.facility ? ' / ' + d.facility : ''));
      var g = 'Trafo: ' + (d.trafo || '-');
      if (d.trafoCount) g += ' (' + d.trafoCount + ' adet)';
      if (d.power) g += ' · Kurulu güç: ' + d.power + ' kW';
      if (d.ges) g += ' · GES: ' + d.ges;
      head.push(g);
      head.push('Hizmetler: ' + (d.services.length ? d.services.map(function (s) { return SVC_LABELS[s] || s; }).join(', ') : '-'));
      head.push('Aciliyet: ' + (d.urgency || '-'));
      head.push('Konum: ' + (d.city || '-') + (d.osb ? ' / ' + d.osb : ''));
      var tail = 'Kaynak: voltguard.com.tr/fabrika-cozumleri.html';
      var att = Object.keys(attached).map(function (k) { return attached[k]; });

      function compose(attLimit, noteLimit) {
        var lines = head.slice();
        att.forEach(function (a) { lines.push(cut(a, attLimit)); });
        if (d.note && noteLimit > 0) lines.push('Not: ' + cut(d.note.replace(/\s+/g, ' '), noteLimit));
        lines.push(tail);
        return lines.join('\n');
      }
      var msg = compose(260, 400);
      if (msg.length > 1000) {
        var over = msg.length - 1000;
        msg = compose(260, Math.max(0, Math.min(400, d.note.length) - over - 2));
      }
      if (msg.length > 1000) msg = compose(140, 0);
      if (msg.length > 1000) msg = msg.slice(0, 999) + '…';
      return msg;
    }

    /* ---- Doğrulama ---- */
    function isValidTrMobile(p) {
      var dg = String(p).replace(/\D/g, '');
      if (dg.length === 10 && dg.charAt(0) === '5') return true;
      if (dg.length === 11 && dg.charAt(0) === '0' && dg.charAt(1) === '5') return true;
      if (dg.length === 12 && dg.slice(0, 2) === '90' && dg.charAt(2) === '5') return true;
      return false;
    }
    /* contact.php FILTER_VALIDATE_EMAIL kullanır: yalnızca ASCII adresler, ardışık nokta yok */
    function isValidEmail(m) {
      m = String(m);
      if (m.length > 120 || m.indexOf('..') > -1) return false;
      if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(m)) return false;
      var local = m.split('@')[0];
      return local.charAt(0) !== '.' && local.charAt(local.length - 1) !== '.' && /\.[A-Za-z]{2,}$/.test(m);
    }

    function mark(fieldKey, bad) {
      var f = qs('[data-req="' + fieldKey + '"]', form);
      if (!f) return;
      f.classList.toggle('is-invalid', bad);
      var err = qs('.fx-err', f);
      if (err) err.hidden = !bad;
      var inp = qs('.fx-input', f) || (fieldKey === 'consent' ? qs('input[type="checkbox"]', f) : qs('[role="radiogroup"], [role="group"]', f));
      if (inp) { if (bad) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    }
    function firstFocusable(fieldKey) {
      var f = qs('[data-req="' + fieldKey + '"]', form);
      return f ? qs('input:not([type="hidden"]), select, textarea', f) : null;
    }

    /* Geçersizse ilk hatalı alanın anahtarını döndürür, geçerliyse null */
    function validateStep(i, show) {
      var bad = [];
      var d = collect();
      if (i === 0) { if (!d.sector) bad.push('wzSector'); }
      if (i === 1) { if (!d.trafo) bad.push('wzTrafo'); }
      if (i === 2) { if (!d.services.length) bad.push('wzServices'); }
      if (i === 3) {
        if (!d.urgency) bad.push('wzUrgency');
        if (!canonCity(d.city)) bad.push('wzCity');
      }
      if (i === 4) {
        if (d.name.length < 2 || d.name.length > 100) bad.push('name');
        if (!isValidTrMobile(d.phone)) bad.push('phone');
        if (d.email && !isValidEmail(d.email)) bad.push('email');
      }
      if (show) {
        var keys = { 0: ['wzSector'], 1: ['wzTrafo'], 2: ['wzServices'], 3: ['wzUrgency', 'wzCity'], 4: ['name', 'phone', 'email'] }[i] || [];
        keys.forEach(function (k) { mark(k, bad.indexOf(k) > -1); });
      }
      if (i === 4 && capOn) {
        var capBad = !capToken();
        var ce = byId('wzCaptchaE');
        if (show && ce) ce.hidden = !capBad;
        if (capBad) bad.push('captcha');
      }
      return bad.length ? bad[0] : null;
    }

    /* ---- Adım gösterimi ---- */
    function showStep(i, focus, noSave) {
      idx = clamp(i, 0, steps.length - 1);
      steps.forEach(function (s, j) {
        var on = j === idx;
        s.hidden = !on;
        if (on) restartAnim(s, 'is-enter');
      });
      stepLis.forEach(function (li, j) {
        li.classList.toggle('is-current', j === idx);
        li.classList.toggle('is-done', j < idx);
      });
      if (bar) bar.style.setProperty('--p', String((idx + 1) / steps.length));
      btnPrev.hidden = idx === 0;
      btnNext.hidden = idx === steps.length - 1;
      btnSubmit.hidden = idx !== steps.length - 1;
      hideErr();
      var legend = qs('.fx-wstep__t', steps[idx]);
      if (status) status.textContent = 'Adım ' + (idx + 1) + ' / ' + steps.length + ': ' + (legend ? legend.textContent : '');
      if (idx === steps.length - 1) { ensureCaptcha(); updatePreview(); }
      if (focus && legend) legend.focus({ preventScroll: true });
      if (focus) {
        var r = wrap.getBoundingClientRect();
        var hh = win.VGShell && win.VGShell.header ? win.VGShell.header.getBoundingClientRect().height : 70;
        if (r.top < hh || r.top > win.innerHeight * 0.6) {
          win.scrollTo({ top: win.pageYOffset + r.top - hh - 16, behavior: motionOK() ? 'smooth' : 'auto' });
        }
      }
      if (!noSave) saveSoon();
    }

    function showErr(msg) { errBox.textContent = msg; errBox.hidden = false; }
    function hideErr() { errBox.hidden = true; errBox.textContent = ''; }

    btnNext.addEventListener('click', function () {
      var bad = validateStep(idx, true);
      if (bad) {
        var f = firstFocusable(bad);
        if (f) f.focus();
        announce('Lütfen işaretli alanı tamamlayın.');
        return;
      }
      showStep(idx + 1, true);
    });
    btnPrev.addEventListener('click', function () { showStep(idx - 1, true); });

    /* Alan değişince o alanın hatasını kaldır */
    form.addEventListener('change', function (e) {
      var f = e.target.closest ? e.target.closest('[data-req]') : null;
      if (f && f.classList.contains('is-invalid')) mark(f.getAttribute('data-req'), false);
      if (e.target.id === 'wzConsent') mark('consent', false);
      saveSoon();
      if (idx === steps.length - 1) updatePreview();
    });
    form.addEventListener('input', function (e) {
      var f = e.target.closest ? e.target.closest('[data-req]') : null;
      if (f && f.classList.contains('is-invalid')) {
        var k = f.getAttribute('data-req');
        var d = collect();
        var ok = (k === 'name' && d.name.length >= 2) || (k === 'phone' && isValidTrMobile(d.phone)) ||
          (k === 'email' && (!d.email || isValidEmail(d.email))) || (k === 'wzCity' && !!canonCity(d.city));
        if (ok) mark(k, false);
      }
      saveSoon();
      if (idx === steps.length - 1) updatePreview();
    });
    /* Enter tuşu: son adım dışında formu göndermesin, sonraki adıma geçsin */
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && idx < steps.length - 1) {
        e.preventDefault();
        btnNext.click();
      }
    });

    /* Telefon biçimlendirme (js/main.js ile aynı kural) */
    if (phone) {
      phone.addEventListener('input', function () {
        var hasPlus = /^\s*\+/.test(this.value);
        var dg = this.value.replace(/\D/g, '');
        var out;
        /* Henüz rakam yoksa (ya da yalnızca "+9" yazıldıysa) baştaki "+" korunur */
        if (!dg) { this.value = hasPlus ? '+' : ''; return; }
        if (hasPlus && dg === '9') { this.value = '+9'; return; }
        if (dg.slice(0, 2) === '90') {
          dg = dg.slice(0, 12);
          out = (hasPlus ? '+' : '') + dg.slice(0, 2);
          if (dg.length > 2) out += ' ' + dg.slice(2, 5);
          if (dg.length > 5) out += ' ' + dg.slice(5, 8);
          if (dg.length > 8) out += ' ' + dg.slice(8, 10);
          if (dg.length > 10) out += ' ' + dg.slice(10, 12);
        } else {
          if (dg.length > 11) dg = dg.slice(0, 11);
          out = dg.slice(0, 4);
          if (dg.length > 4) out += ' ' + dg.slice(4, 7);
          if (dg.length > 7) out += ' ' + dg.slice(7, 9);
          if (dg.length > 9) out += ' ' + dg.slice(9, 11);
        }
        this.value = out;
      });
    }
    function syncNote() { if (note && noteC) noteC.textContent = note.value.length + ' / 400'; }
    if (note) note.addEventListener('input', syncNote);
    var tc = byId('wzTrafoCount');
    if (tc) tc.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 3); });
    /* İl: listeden biriyle eşleşiyorsa resmi yazımına çevir ("izmir" → "İzmir") */
    var city = byId('wzCity');
    if (city) city.addEventListener('blur', function () {
      var c = canonCity(city.value);
      if (c && c !== city.value) { city.value = c; saveSoon(); }
    });

    function updatePreview() {
      if (!preview) return;
      var m = buildMessage(collect());
      var subj = SUBJECT_LABELS[subjectFor(checks('wzServices'))];
      preview.textContent = 'Konu: ' + subj + '\n\n' + m;
      if (previewCount) previewCount.textContent = m.length + ' / 1000 karakter';
    }

    /* ---- Ekler (sağlık testi / hesaplayıcı özetleri) ---- */
    function renderAttached() {
      var keys = Object.keys(attached);
      attachedBox.hidden = !keys.length;
      attachedList.textContent = '';
      keys.forEach(function (k) {
        var li = el('li');
        li.appendChild(el('span', '', attached[k]));
        var b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Bu sonucu talepten çıkar');
        b.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
        b.addEventListener('click', function () {
          delete attached[k];
          renderAttached();
          saveSoon();
          announce('Sonuç talepten çıkarıldı.');
          if (idx === steps.length - 1) updatePreview();
        });
        li.appendChild(b);
        attachedList.appendChild(li);
      });
    }

    /* ---- Taslak ---- */
    var DRAFT_IDS = ['wzFacility', 'wzTrafo', 'wzTrafoCount', 'wzPower', 'wzNote', 'wzCity', 'wzOsb', 'wzName', 'wzCompany', 'wzPhone', 'wzEmail'];
    function saveSoon() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 350);
    }
    function saveDraft() {
      if (form.hidden) return;
      var d = { v: 1, step: idx, t: Date.now(), radios: {}, ids: {}, services: checks('wzServices'), attached: attached };
      DRAFT_RADIOS.forEach(function (n) { d.radios[n] = radioVal(n); });
      DRAFT_IDS.forEach(function (id) { var e = byId(id); if (e) d.ids[id] = e.value; });
      if (store.set(KEY_WIZ, d) && draftState) {
        var dt = new Date();
        draftState.textContent = 'Taslak bu cihazda kaydedildi · ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
      }
    }
    var DRAFT_RADIOS = ['wzType', 'wzSector', 'wzGes', 'wzUrgency'];
    var ATTACH_KEYS = ['health', 'reaktif', 'durus'];
    function restoreDraft() {
      var d = store.get(KEY_WIZ);
      if (!d || typeof d !== 'object' || d.v !== 1) return;
      try {
        var radios = (d.radios && typeof d.radios === 'object') ? d.radios : {};
        var ids = (d.ids && typeof d.ids === 'object') ? d.ids : {};
        DRAFT_RADIOS.forEach(function (n) { if (typeof radios[n] === 'string' && radios[n]) setRadio(n, radios[n]); });
        DRAFT_IDS.forEach(function (id) { var e = byId(id); if (e && typeof ids[id] === 'string') e.value = ids[id]; });
        var svcs = Array.isArray(d.services) ? d.services : [];
        qsa('input[name="wzServices"]', form).forEach(function (c) { c.checked = svcs.indexOf(c.value) > -1; });
        attached = {};
        if (d.attached && typeof d.attached === 'object') {
          ATTACH_KEYS.forEach(function (k) { if (typeof d.attached[k] === 'string' && d.attached[k]) attached[k] = d.attached[k].slice(0, 400); });
        }
        idx = clamp(+d.step || 0, 0, steps.length - 1);
      } catch (err) {
        store.del(KEY_WIZ);
        form.reset();
        attached = {};
        idx = 0;
        return;
      }
      renderAttached();
      syncNote();
      if (draftState) draftState.textContent = 'Kaldığınız yerden devam ediyorsunuz; taslak bu cihazda saklanır.';
    }
    function resetAll() {
      clearTimeout(saveTimer);
      form.reset();
      qsa('.is-invalid', form).forEach(function (f) { f.classList.remove('is-invalid'); });
      qsa('.fx-err', form).forEach(function (e) { e.hidden = true; });
      qsa('[aria-invalid]', form).forEach(function (e) { e.removeAttribute('aria-invalid'); });
      attached = {};
      renderAttached();
      store.del(KEY_WIZ);
      syncNote();
      stamp();
      resetCaptcha();
      if (draftState) draftState.textContent = 'Taslağınız bu cihazda saklanır.';
    }
    byId('fxDraftClear').addEventListener('click', function () {
      resetAll();
      showStep(0, true);
      store.del(KEY_WIZ);
      announce('Form temizlendi.');
    });

    /* ---- Turnstile (yalnızca gerçek site anahtarı tanımlıysa) ---- */
    function ensureCaptcha() {
      if (!capOn || capWidget !== null || capLoading) return;
      cap.hidden = false;
      var render = function () {
        try {
          capWidget = win.turnstile.render(cap, { sitekey: capKey, language: 'tr', theme: 'dark', retry: 'auto' });
        } catch (e) { capWidget = null; }
      };
      if (win.turnstile && win.turnstile.render) { render(); return; }
      capLoading = true;
      win.__fxTurnstileReady = function () { capLoading = false; render(); };
      var s = doc.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__fxTurnstileReady';
      s.async = true;
      s.defer = true;
      s.onerror = function () { capLoading = false; };
      doc.head.appendChild(s);
    }
    function capToken() {
      var i = cap ? qs('input[name="cf-turnstile-response"]', cap) : null;
      return i ? i.value.trim() : '';
    }
    function resetCaptcha() {
      if (capOn && win.turnstile && capWidget !== null) { try { win.turnstile.reset(capWidget); } catch (e) { /* yok say */ } }
    }

    /* ---- Gönderim ---- */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) return;
      hideErr();
      for (var i = 0; i < steps.length; i++) {
        var bad = validateStep(i, true);
        if (bad) {
          if (i !== idx) showStep(i, false);
          var f = bad === 'captcha' ? null : firstFocusable(bad);
          if (f) f.focus();
          showErr(bad === 'captcha' ? 'Lütfen güvenlik doğrulamasını tamamlayın.' : 'Lütfen işaretli alanları tamamlayın.');
          return;
        }
      }
      if (hp && hp.value.trim()) {
        hp.value = '';
        showErr('Form doğrulanamadı. Yazdıklarınız korundu; lütfen yeniden gönderin.');
        return;
      }
      var last = parseInt(store.raw(KEY_LAST_SUBMIT) || '0', 10);
      var now = Date.now();
      if (last && now - last < SUBMIT_COOLDOWN && now - last > 0) {
        showErr('Yeni gönderim için ' + Math.ceil((SUBMIT_COOLDOWN - (now - last)) / 1000) + ' saniye bekleyin.');
        return;
      }

      var d = collect();
      var fd = new FormData();
      fd.append('name', d.name);
      fd.append('phone', d.phone);
      fd.append('email', d.email);
      fd.append('subject', subjectFor(d.services));
      fd.append('message', buildMessage(d));
      fd.append('website', hp ? hp.value : '');
      fd.append('formTimestamp', (ts && ts.value) || String(now));
      if (capOn) fd.append('cf-turnstile-response', capToken());

      sending = true;
      form.setAttribute('aria-busy', 'true');
      var label = btnSubmit.innerHTML;
      /* disabled yerine aria-disabled: odak düğmede kalsın (çift gönderimi `sending` engeller) */
      btnSubmit.setAttribute('aria-disabled', 'true');
      btnPrev.disabled = true;
      btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Gönderiliyor...';

      var ac = ('AbortController' in win) ? new AbortController() : null;
      var timedOut = false;
      var to;
      var opts = { method: 'POST', body: fd, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
      if (ac) opts.signal = ac.signal;

      var request = Promise.resolve().then(function () { return fetch('/contact.php', opts); })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; }, function () {
            return { ok: false, status: res.status, data: { message: 'Sunucudan geçersiz yanıt alındı. Lütfen 0545 434 67 35 numarasından bize ulaşın.' } };
          });
        });
      var deadline = new Promise(function (resolve, reject) {
        to = setTimeout(function () { timedOut = true; if (ac) ac.abort(); reject(abortErr()); }, SUBMIT_TIMEOUT);
      });
      Promise.race([request, deadline])
        .then(function (r) {
          if (!r.ok || !r.data || !r.data.success) {
            var er = new Error((r.data && r.data.message) || 'Gönderim başarısız oldu.');
            er.status = r.status;
            throw er;
          }
          store.setRaw(KEY_LAST_SUBMIT, String(Date.now()));
          showDone(r.data.message);
        })
        .catch(function (err) {
          resetCaptcha();
          stamp();
          var msg;
          if (timedOut || (err && err.name === 'AbortError')) {
            msg = 'Gönderim yanıtı alınamadı. Taslağınız korundu. Yeniden göndermeden önce 0545 434 67 35 üzerinden durumu kontrol edebilirsiniz.';
          } else if (err && err.name === 'TypeError') {
            msg = 'Bağlantı hatası. İnternet bağlantınızı kontrol edip tekrar deneyin ya da 0545 434 67 35 numarasını arayın.';
          } else {
            msg = (err && err.message) || 'Gönderim sırasında bir hata oluştu.';
          }
          showErr(msg);
          /* Sunucu bir alanı reddettiyse (422) o alanı işaretle ve oraya odaklan */
          var field = null;
          if (err && err.status === 422) {
            var low = String(msg).toLocaleLowerCase('tr-TR');
            if (low.indexOf('e-posta') > -1) field = 'email';
            else if (low.indexOf('telefon') > -1) field = 'phone';
            else if (low.indexOf('ad soyad') > -1 || low.indexOf('adınız') > -1) field = 'name';
            else if (low.indexOf('kvkk') > -1) field = 'consent';
          }
          if (field) {
            if (idx !== steps.length - 1) showStep(steps.length - 1, false);
            mark(field, true);
            var fi = firstFocusable(field);
            if (fi) { fi.focus(); return; }
          }
          errBox.focus({ preventScroll: false });
        })
        .finally(function () {
          clearTimeout(to);
          sending = false;
          form.removeAttribute('aria-busy');
          btnSubmit.removeAttribute('aria-disabled');
          btnPrev.disabled = false;
          btnSubmit.innerHTML = label;
        });
    });
    function abortErr() { var e = new Error('timeout'); e.name = 'AbortError'; return e; }

    function showDone(msg) {
      resetAll();
      form.hidden = true;
      attachedBox.hidden = true;
      stepLis.forEach(function (li) { li.classList.remove('is-current'); li.classList.add('is-done'); });
      if (bar) bar.style.setProperty('--p', '1');
      byId('fxWizDoneMsg').textContent = msg || 'En kısa sürede sizinle iletişime geçeceğiz.';
      done.hidden = false;
      done.focus({ preventScroll: true });
      var r = done.getBoundingClientRect();
      if (r.top < 0 || r.top > win.innerHeight) scrollToId('teklif');
      announce('Talebiniz alındı.');
    }
    byId('fxWizNew').addEventListener('click', function () {
      done.hidden = true;
      form.hidden = false;
      showStep(0, true);
    });

    /* ---- Başlangıç ---- */
    restoreDraft();
    showStep(idx, false, true);
    syncNote();

    /* ---- Dış API ---- */
    function go() {
      scrollToId('teklif');
      setTimeout(function () { if (heading) heading.focus({ preventScroll: true }); }, 30);
    }
    return {
      setType: function (v) { if (v) { setRadio('wzType', v); saveSoon(); } },
      setSector: function (k) {
        if (!k) return;
        setRadio('wzSector', k);
        mark('wzSector', false);
        saveSoon();
      },
      preselect: function (keys) {
        (keys || []).forEach(function (k) {
          var c = qs('input[name="wzServices"][value="' + k + '"]', form);
          if (c) c.checked = true;
        });
        mark('wzServices', false);
        saveSoon();
      },
      attach: function (key, text) {
        attached[key] = text;
        renderAttached();
        saveSoon();
        if (idx === steps.length - 1) updatePreview();
      },
      go: function () {
        if (done && !done.hidden) { done.hidden = true; form.hidden = false; showStep(0, false); }
        go();
      }
    };
  }, WIZ_STUB);

  /* Sihirbaza giden bağlantılar (hero, yapışkan çubuk): kaydırmayı vg-shell.js yapar */
  qsa('[data-fx-goto="wizard"]').forEach(function (a) {
    a.addEventListener('click', function () {
      Wizard.setType(a.getAttribute('data-fx-type'));
      var h = byId('fxWizTitle');
      setTimeout(function () { if (h) h.focus({ preventScroll: true }); }, 30);
    });
  });

  /* Sayfa içi #çapa bağlantıları: kaydırmayı vg-shell.js yapar; burada odağı hedef bölümün başlığına
     taşırız ki klavye kullanıcısı Tab ile kaldığı yere geri dönmesin. Hesaplayıcı çapaları sekmeyi de seçer. */
  main.addEventListener('click', function (e) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || a.hasAttribute('data-fx-goto')) return;
    var id = a.getAttribute('href').slice(1);
    var t = id ? byId(id) : null;
    if (!t) return;
    if (calcHash) calcHash(id, false);
    var f = t.matches('a[href], button, input, select, textarea, summary, [tabindex]') && !t.classList.contains('fx-anchor') ? t : null;
    if (!f) {
      var sec = t.classList.contains('fx-anchor') ? t.closest('section') : t;
      f = sec ? qs('h2', sec) : null;
    }
    if (!f) return;
    if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1');
    setTimeout(function () { f.focus({ preventScroll: true }); }, 30);
  });

  /* =====================================================================
     Tek hat şeması
     ===================================================================== */
  guard('sld', null, function initSld() {
    var sld = byId('fxSld');
    var wrap = sld ? sld.parentNode : null;
    var pop = byId('fxPop');
    if (!sld || !pop) return;
    var svg = qs('svg', sld);
    var flows = byId('fxFlows');
    var hs = qsa('.fx-hs', sld);
    var popTitle = byId('fxPopTitle');
    var popKicker = byId('fxPopKicker');
    var popBody = byId('fxPopBody');
    var active = null, pinned = false, peek = false, tOpen = 0, tClose = 0, lastBtn = null;
    var BOTTOM_ROW = ['komp', 'tali', 'scada'];
    var hdr = qs('.vg-header');

    /* Akış katmanı: her segment kendi kırpma alanında, bir desen periyodu kadar kayar */
    (function buildFlows() {
      var NS = 'http://www.w3.org/2000/svg', P = 20;
      var defs = qs('defs', svg);
      var frag = doc.createDocumentFragment();
      FX_SEGMENTS.forEach(function (s, i) {
        var x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3], k = s[4];
        var vert = x1 === x2;
        var dir = vert ? (y2 > y1 ? 'down' : 'up') : (x2 > x1 ? 'right' : 'left');
        var cp = doc.createElementNS(NS, 'clipPath');
        cp.setAttribute('id', 'fxC' + i);
        var r = doc.createElementNS(NS, 'rect');
        if (vert) { r.setAttribute('x', x1 - 4); r.setAttribute('y', Math.min(y1, y2)); r.setAttribute('width', 8); r.setAttribute('height', Math.abs(y2 - y1)); }
        else { r.setAttribute('x', Math.min(x1, x2)); r.setAttribute('y', y1 - 4); r.setAttribute('width', Math.abs(x2 - x1)); r.setAttribute('height', 8); }
        cp.appendChild(r);
        defs.appendChild(cp);
        var lx1 = x1, ly1 = y1;
        if (dir === 'down') ly1 = y1 - P; else if (dir === 'up') ly1 = y1 + P;
        else if (dir === 'right') lx1 = x1 - P; else lx1 = x1 + P;
        var g = doc.createElementNS(NS, 'g');
        g.setAttribute('clip-path', 'url(#fxC' + i + ')');
        var ln = doc.createElementNS(NS, 'line');
        ln.setAttribute('x1', lx1); ln.setAttribute('y1', ly1); ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
        ln.setAttribute('class', 'fx-f fx-f--' + k + ' fx-f--' + dir);
        g.appendChild(ln);
        frag.appendChild(g);
      });
      flows.appendChild(frag);
    }());

    /* Ekran dışında / sekme gizliyken animasyonu durdur */
    var inView = true;
    function syncPause() { sld.classList.toggle('is-paused', !inView || doc.hidden); }
    if (hasIO) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        syncPause();
      }, { threshold: 0 }).observe(sld);
    }
    doc.addEventListener('visibilitychange', syncPause);

    function li(text) { return el('li', '', text); }
    /* Panel iki kipte açılır:
       - önizleme (is-peek): fareyle üzerine gelince; yalnızca başlık, ilk risk ve "tıklayın" ipucu. Küçük olduğu için
         komşu sıcak noktaları örtmeyen bir konuma yerleştirilir (placePeek).
       - tam panel: tıklama / Enter / dokunma; riskler, çözümler, kaynaklar ve eylem düğmeleri (.fx-pop__more). */
    function render(key) {
      var n = FX_NODES[key], L = FX_LINKS[key] || { items: [] };
      popKicker.textContent = n.kicker;
      popTitle.textContent = n.title;
      popBody.textContent = '';
      popBody.appendChild(el('p', 'fx-pop__teaser', n.risks[0]));
      popBody.appendChild(el('p', 'fx-pop__hint', 'Riskler, çözümler ve bağlantılar için tıklayın.'));
      popBody.appendChild(el('p', 'fx-pop__hint fx-pop__hint--s', 'Ayrıntılar için tıklayın.'));
      function more(node) { node.classList.add('fx-pop__more'); popBody.appendChild(node); return node; }
      more(el('h3', '', 'Tipik riskler'));
      var ul1 = el('ul');
      n.risks.forEach(function (t) { ul1.appendChild(li(t)); });
      more(ul1);
      more(el('h3', '', 'VoltGuard ne yapar?'));
      var ul2 = el('ul', 'fx-pop__do');
      n.does.forEach(function (t) { ul2.appendChild(li(t)); });
      more(ul2);
      if (L.items && L.items.length) {
        more(el('h3', '', 'İlgili kaynaklar'));
        var lk = el('div', 'fx-pop__links');
        L.items.forEach(function (it) {
          var a = el('a', '', it[0]);
          a.href = it[1];
          lk.appendChild(a);
        });
        more(lk);
      }
      var cta = el('div', 'fx-pop__cta fx-pop__more');
      var b = el('button', 'fx-btn fx-btn--primary fx-btn--sm', 'Ön değerlendirme iste');
      b.type = 'button';
      b.addEventListener('click', function () {
        Wizard.preselect(n.services);
        close(false);
        Wizard.go();
      });
      cta.appendChild(b);
      if (n.calc) {
        var c = el('button', 'fx-btn fx-btn--ghost fx-btn--sm', 'Ceza riskini hesapla');
        c.type = 'button';
        c.addEventListener('click', function () {
          close(false);
          if (calcTabs) calcTabs.select(0, false);
          scrollToId('hesaplayicilar');
        });
        cta.appendChild(c);
      }
      if (L.service) {
        var s = el('a', 'fx-btn fx-btn--ghost fx-btn--sm', 'Hizmet detayları');
        s.href = L.service;
        cta.appendChild(s);
      }
      popBody.appendChild(cta);
    }

    /* Önizleme konumu: düğmeye bitişik (sağ, sol, alt, üst) aday konumlar kenar boyunca kaydırılarak denenir.
       Maliyet: diğer sıcak noktalarla örtüşme (en ağır), düğmenin kendisiyle örtüşme, görünür alan (üst menü ile
       pencere altı) dışında kalan kısım ve düğmeye uzaklık. Bitişik olduğu için fare panele giderken başka bir
       bloğun üzerinden geçmez. Temiz yer yoksa panel küçültülerek yeniden denenir: is-mini (ilk risk cümlesi
       gizlenir), is-micro (yalnızca başlık ve kısa ipucu), is-narrow (micro, dar ve satır kırarak). Hiçbirinde temiz
       yer yoksa en düşük maliyetli seçilir. */
    function overlap(a, b) {
      var w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      return w > 0 && h > 0 ? w * h : 0;
    }
    function box(r, p) { return { l: r.left - p, t: r.top - p, r: r.right + p, b: r.bottom + p }; }
    /* Konum, destekleyen tarayıcıda left/top yerine translate ile verilir: panel fareyle bloktan bloğa geçerken
       yer değiştirdiğinde bu bir düzen kayması (CLS) sayılmaz. x/y: .fx-sld-wrap'e göre px; null = sıfırla. */
    var useTranslate = 'translate' in pop.style;
    function setPos(x, y) {
      var on = x !== null;
      if (useTranslate) { pop.style.translate = on ? Math.round(x) + 'px ' + Math.round(y) + 'px' : ''; return; }
      pop.style.left = on ? Math.round(x) + 'px' : '';
      pop.style.top = on ? Math.round(y) + 'px' : '';
    }
    function placePeek(btn) {
      pop.classList.remove('is-static');
      var vw = doc.documentElement.clientWidth, vh = win.innerHeight, m = 8, gap = 10;
      var top0 = m, bot0 = vh - m;
      if (hdr) { var hb = hdr.getBoundingClientRect().bottom; if (hb > 0) top0 = hb + m; }
      var br = btn.getBoundingClientRect(), self = box(br, 0);
      var others = hs.filter(function (h) { return h !== btn; }).map(function (h) {
        var r = h.getBoundingClientRect();
        return { hard: box(r, 0), soft: box(r, 6) };
      });
      function best() {
        var pw = pop.offsetWidth, ph = pop.offsetHeight, res = null, s;
        var bx = br.left + br.width / 2, by = br.top + br.height / 2;
        function test(x, y) {
          x = clamp(x, m, Math.max(m, vw - m - pw));
          var R = { l: x, t: y, r: x + pw, b: y + ph }, hard = 0, soft = 0;
          others.forEach(function (o) { hard += overlap(R, o.hard); soft += overlap(R, o.soft); });
          var mine = overlap(R, self);
          var off = (Math.max(0, top0 - R.t) + Math.max(0, R.b - bot0)) * pw;
          var dx = x + pw / 2 - bx, dy = y + ph / 2 - by;
          var cost = hard * 60 + soft * 4 + mine * 60 + off * 6 + Math.sqrt(dx * dx + dy * dy);
          if (!res || cost < res.cost) res = { x: x, y: y, cost: cost, bad: hard + mine + off };
        }
        var minV = Math.min(20, br.height / 2), minH = Math.min(24, br.width / 2);
        [br.right + gap, br.left - gap - pw].forEach(function (x) {
          for (s = br.top - ph + minV; s <= br.bottom - minV; s += 6) test(x, s);
        });
        [br.bottom + gap, br.top - gap - ph].forEach(function (y) {
          for (s = br.left - pw + minH; s <= br.right - minH; s += 6) test(s, y);
        });
        return res;
      }
      function level(i) {
        pop.classList.toggle('is-mini', i === 1);
        pop.classList.toggle('is-micro', i >= 2);
        pop.classList.toggle('is-narrow', i === 3);
      }
      var r = null, lv = 0;
      for (var i = 0; i < 4; i++) {
        level(i);
        var c = best();
        if (!r || c.cost < r.cost) { r = c; lv = i; }
        if (c.bad <= 0) { r = c; lv = i; break; }
      }
      level(lv);
      var wr = wrap.getBoundingClientRect();
      setPos(r.x - wr.left, r.y - wr.top);
    }

    function place(btn) {
      if (peek) { placePeek(btn); return; }
      var sw = sld.getBoundingClientRect().width;
      if (sw < 480) {
        pop.classList.add('is-static');
        setPos(null);
        return;
      }
      pop.classList.remove('is-static');
      var wr = wrap.getBoundingClientRect(), br = btn.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 10, m = 8;
      var left, top;
      var bottomRow = BOTTOM_ROW.indexOf(btn.getAttribute('data-node')) > -1;
      if (wr.right - br.right >= pw + gap + m) left = br.right - wr.left + gap;
      else if (br.left - wr.left >= pw + gap + m) left = br.left - wr.left - pw - gap;
      if (left !== undefined) {
        top = clamp(br.top - wr.top + br.height / 2 - ph / 2, m, Math.max(m, wr.height - ph - m));
      } else {
        left = clamp(br.left - wr.left + br.width / 2 - pw / 2, m, Math.max(m, wr.width - pw - m));
        /* Alt sıradaki bloklarda panel önce bloğun üstüne açılır (açıklama ve güven şeridini örtmesin) */
        if (bottomRow && br.top - wr.top - ph - gap >= m) top = br.top - wr.top - ph - gap;
        else {
          top = br.bottom - wr.top + gap;
          if (top + ph > wr.height - m && br.top - wr.top - ph - gap >= m) top = br.top - wr.top - ph - gap;
        }
      }
      setPos(left, top);
    }

    function open(key, btn, opts) {
      clearTimeout(tOpen); clearTimeout(tClose);
      pinned = !!opts.pin;
      peek = !pinned;
      pop.classList.toggle('is-peek', peek);
      pop.classList.remove('is-mini', 'is-micro', 'is-narrow');
      sld.classList.add('is-touched');
      if (active !== key) {
        render(key);
        hs.forEach(function (h) {
          var on = h === btn;
          h.classList.toggle('is-active', on);
          h.setAttribute('aria-expanded', on ? 'true' : 'false');
        });
        sld.setAttribute('data-active', key);
        active = key;
      }
      lastBtn = btn;
      var wasHidden = pop.hidden;
      pop.hidden = false;
      place(btn);
      if (wasHidden) {
        pop.classList.remove('is-in');
        void pop.offsetWidth;
      }
      pop.classList.add('is-in');
      if (opts.focus) popTitle.focus({ preventScroll: true });
      if (opts.pin) {
        /* Panelin düğmeleri ekran dışında kalmasın */
        var r = pop.getBoundingClientRect();
        if (r.bottom > win.innerHeight || r.top < 0) pop.scrollIntoView({ block: 'nearest', behavior: motionOK() ? 'smooth' : 'auto' });
      }
    }
    function close(returnFocus) {
      clearTimeout(tOpen); clearTimeout(tClose);
      if (!active) return;
      var inside = pop.contains(doc.activeElement);
      pop.classList.remove('is-in');
      pop.hidden = true;
      hs.forEach(function (h) { h.classList.remove('is-active'); h.setAttribute('aria-expanded', 'false'); });
      sld.removeAttribute('data-active');
      active = null;
      pinned = false;
      peek = false;
      if ((returnFocus || inside) && lastBtn) lastBtn.focus({ preventScroll: true });
    }

    hs.forEach(function (btn) {
      var key = btn.getAttribute('data-node');
      btn.addEventListener('click', function (e) {
        if (active === key && pinned) { close(false); return; }
        open(key, btn, { pin: true, focus: e.detail === 0 });
      });
      btn.addEventListener('mouseenter', function () {
        if (!mqHover.matches || pinned) return;
        clearTimeout(tClose);
        tOpen = setTimeout(function () {
          /* Önizleme bloktan bloğa geçiyorsa paneli bir kare gizleyip yeniden aç: içerik ve konum değişimi
             görünür bir öğenin kayması (CLS) olarak sayılmasın, yeni panel kısa giriş animasyonuyla gelsin. */
          if (active && active !== key && !pop.hidden) {
            pop.hidden = true;
            pop.classList.remove('is-in');
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (!pinned && btn.matches(':hover')) open(key, btn, { pin: false });
                else if (!pinned) close(false);
              });
            });
            return;
          }
          open(key, btn, { pin: false });
        }, 110);
      });
      btn.addEventListener('mouseleave', function () {
        clearTimeout(tOpen);
        if (!mqHover.matches || pinned) return;
        tClose = setTimeout(function () { close(false); }, 260);
      });
    });
    pop.addEventListener('mouseenter', function () { clearTimeout(tClose); });
    pop.addEventListener('mouseleave', function () {
      if (!mqHover.matches || pinned) return;
      tClose = setTimeout(function () { close(false); }, 260);
    });
    /* Önizlemeye tıklamak, bloğa tıklamak gibi tam paneli açar */
    pop.addEventListener('click', function () {
      if (active && !pinned && lastBtn) open(active, lastBtn, { pin: true });
    });
    qs('[data-fx-pop-close]', pop).addEventListener('click', function () { close(true); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && active) close(pinned || pop.contains(doc.activeElement) || sld.contains(doc.activeElement));
    });
    doc.addEventListener('click', function (e) {
      if (!active || !pinned) return;
      if (pop.contains(e.target) || (e.target.closest && e.target.closest('.fx-hs'))) return;
      close(false);
    });
    var rz = 0;
    win.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (active && lastBtn) place(lastBtn); }, 120);
    });
  });

  /* =====================================================================
     Fabrika Elektrik Sağlık Testi
     ===================================================================== */
  guard('health', KEY_HEALTH, function initHealth() {
    var form = byId('fxHealthForm');
    var res = byId('fxHealthRes');
    if (!form || !res) return;
    var qsEls = qsa('.fx-q', form);
    var count = byId('fxHealthCount');
    var bar = byId('fxHealthBar');
    var prev = qs('[data-fx-h="prev"]', form);
    var next = qs('[data-fx-h="next"]', form);
    var needle = byId('fxNeedle');
    var scoreEl = byId('fxScore');
    var topics = qsa('#fxTopics li');
    var idx = 0, pointer = false, advTimer = 0, last = null;
    form.classList.add('is-stepper');
    function syncTopics() {
      topics.forEach(function (t, j) {
        var cur = j === idx && !form.hidden;
        t.classList.toggle('is-current', cur);
        t.classList.toggle('is-done', !!qsEls[j] && answered(j) && !skip(j));
        t.classList.toggle('is-skip', skip(j));
        if (cur) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current');
      });
    }

    function answered(i) { return !!qs('input:checked', qsEls[i]); }
    function q1na() { var r = qs('input[name="q1"]:checked', form); return r && r.getAttribute('data-risk') === 'na'; }
    function skip(i) { return i === 7 && q1na(); }   // trafo yoksa 8. soru atlanır
    function nextIdx(i, d) { var j = i + d; while (j >= 0 && j < qsEls.length && skip(j)) j += d; return j; }

    function show(i, focus) {
      idx = i;
      qsEls.forEach(function (q, j) {
        q.hidden = j !== i;
        if (j === i) restartAnim(q, 'is-enter');
      });
      var n = qsEls.length;
      count.textContent = 'Soru ' + (i + 1) + ' / ' + n;
      bar.style.setProperty('--p', String(i / n));
      prev.disabled = i === 0;
      prev.style.visibility = i === 0 ? 'hidden' : '';
      var isLast = nextIdx(i, 1) >= n;
      next.innerHTML = isLast ? 'Sonucu Gör <i class="fas fa-gauge-high" aria-hidden="true"></i>' : 'İleri <i class="fas fa-arrow-right" aria-hidden="true"></i>';
      next.setAttribute('aria-disabled', answered(i) ? 'false' : 'true');
      syncTopics();
      if (focus) { var lg = qs('legend', qsEls[i]); if (lg) lg.focus({ preventScroll: true }); }
    }

    function goNext() {
      clearTimeout(advTimer);
      if (!answered(idx)) {
        var first = qs('input', qsEls[idx]);
        if (first) first.focus();
        announce('Lütfen bir seçenek belirleyin.');
        return;
      }
      var j = nextIdx(idx, 1);
      if (j >= qsEls.length) finish(true);
      else show(j, true);
    }
    next.addEventListener('click', goNext);
    prev.addEventListener('click', function () { var j = nextIdx(idx, -1); if (j >= 0) show(j, true); });

    form.addEventListener('pointerdown', function () { pointer = true; });
    form.addEventListener('keydown', function () { pointer = false; });
    form.addEventListener('change', function (e) {
      if (e.target.name === 'q1') {
        var q8na = qs('input[name="q8"][data-risk="na"]', form);
        if (q1na()) { if (q8na) q8na.checked = true; }
        else if (q8na && q8na.checked) q8na.checked = false;
      }
      next.setAttribute('aria-disabled', answered(idx) ? 'false' : 'true');
      syncTopics();
      save(false);
      if (pointer) {
        clearTimeout(advTimer);
        advTimer = setTimeout(goNext, motionOK() ? 320 : 120);
      }
    });

    function compute() {
      var tot = 0, max = 0, areas = {};
      qsEls.forEach(function (q) {
        var inp = qs('input:checked', q);
        if (!inp) return;
        var r = inp.getAttribute('data-risk');
        if (r === 'na') return;
        r = +r;
        tot += r;
        max += 3;
        var a = q.getAttribute('data-area');
        if (!areas[a] || areas[a] < r) areas[a] = r;
      });
      var score = max ? Math.round(100 * (1 - tot / max)) : 100;
      var risks = Object.keys(areas).filter(function (a) { return areas[a] >= 2; })
        .sort(function (a, b) { return areas[b] - areas[a]; })
        .map(function (a) { return { key: a, sev: areas[a] }; });
      var svc = [];
      risks.forEach(function (r) { AREAS[r.key].svc.forEach(function (s) { if (svc.indexOf(s) < 0) svc.push(s); }); });
      if (!svc.length) svc = ['periyodik'];
      return { score: score, risks: risks, svc: svc.slice(0, 5) };
    }

    function band(s) {
      if (s >= 80) return { lv: 'low', name: 'Düşük risk', text: 'Tesisiniz genel olarak iyi durumda görünüyor. Periyodik kontrol ve bakım takvimini korumanız yeterli olabilir.' };
      if (s >= 60) return { lv: 'mid', name: 'Orta risk', text: 'Bazı alanlarda iyileştirme gerekiyor. Aşağıdaki başlıklar planlı bir bakım ve ölçüm programıyla ele alınabilir.' };
      if (s >= 40) return { lv: 'high', name: 'Yüksek risk', text: 'Birden fazla alanda belirgin eksik görünüyor. Yasal uyum ve üretim sürekliliği için öncelikli bir saha değerlendirmesi öneriyoruz.' };
      return { lv: 'crit', name: 'Kritik', text: 'Yanıtlarınız hem iş güvenliği hem de üretim sürekliliği açısından acil aksiyon gerektiren bir tablo gösteriyor. Saha değerlendirmesini vakit kaybetmeden planlayalım.' };
    }

    function animateGauge(score) {
      var target = -90 + score * 1.8;
      if (!motionOK()) {
        needle.style.setProperty('--a', target + 'deg');
        scoreEl.textContent = String(score);
        return;
      }
      needle.style.setProperty('--a', '-90deg');
      scoreEl.textContent = '0';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { needle.style.setProperty('--a', target + 'deg'); });
      });
      var t0 = 0, dur = 1400;
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        scoreEl.textContent = String(Math.round(score * e));
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    function finish(focus, noAnim) {
      var r = compute();
      last = r;
      var b = band(r.score);
      byId('fxResTitle').textContent = 'Elektrik sağlık skorunuz';
      var bandEl = byId('fxResBand');
      bandEl.textContent = b.name;
      bandEl.setAttribute('data-level', b.lv);
      byId('fxResText').textContent = b.text;
      var ul = byId('fxResRisks');
      ul.textContent = '';
      if (!r.risks.length) {
        var ok = el('li');
        ok.appendChild(el('strong', '', 'Belirgin bir risk alanı görünmüyor'));
        ok.appendChild(doc.createTextNode('Mevcut kontrol ve bakım düzeninizi sürdürmenizi öneririz.'));
        ul.appendChild(ok);
      } else {
        r.risks.forEach(function (rk) {
          var a = AREAS[rk.key];
          var item = el('li');
          var st = el('strong', '', a.label);
          var em = el('em', '', rk.sev >= 3 ? 'Yüksek' : 'Orta');
          em.setAttribute('data-sev', String(rk.sev));
          st.appendChild(em);
          item.appendChild(st);
          item.appendChild(doc.createTextNode(a.advice));
          ul.appendChild(item);
        });
      }
      var sv = byId('fxResServices');
      sv.textContent = '';
      r.svc.forEach(function (s) { sv.appendChild(el('li', '', SVC_LABELS[s])); });

      form.hidden = true;
      res.hidden = false;
      bar.style.setProperty('--p', '1');
      syncTopics();
      save(true);
      if (noAnim) {
        needle.style.setProperty('--a', '-90deg');
        scoreEl.textContent = '0';
        onceVisible(res, function () { animateGauge(r.score); }, { threshold: 0.4 });
      } else {
        animateGauge(r.score);
      }
      if (focus) {
        res.focus({ preventScroll: true });
        var rect = res.getBoundingClientRect();
        if (rect.top < 60 || rect.top > win.innerHeight * 0.5) scrollToId('saglik-testi');
        announce('Sonuç hazır: ' + r.score + ' / 100, ' + b.name + '.');
      }
    }

    function save(isDone) {
      var a = {};
      qsEls.forEach(function (q) { var i = qs('input:checked', q); if (i) a[i.name] = i.value; });
      store.set(KEY_HEALTH, { v: 1, a: a, done: !!isDone, idx: idx });
    }

    byId('fxHealthRestart').addEventListener('click', function () {
      form.reset();
      store.del(KEY_HEALTH);
      res.hidden = true;
      form.hidden = false;
      show(0, true);
    });

    byId('fxHealthToWizard').addEventListener('click', function () {
      var r = last || compute();
      var b = band(r.score);
      var labels = r.risks.map(function (x) { return AREAS[x.key].label; });
      var txt = 'Sağlık testi: ' + r.score + '/100 (' + b.name + ')' + (labels.length ? '. Risk alanları: ' + labels.join(', ') : '. Belirgin risk alanı yok');
      Wizard.attach('health', txt);
      Wizard.preselect(r.svc);
      announce('Sağlık testi sonucu teklif sihirbazına eklendi.');
      Wizard.go();
    });

    /* Kayıtlı yanıtları geri yükle */
    var saved = store.get(KEY_HEALTH);
    if (saved && saved.v === 1 && saved.a && typeof saved.a === 'object') {
      Object.keys(saved.a).forEach(function (n) {
        if (!/^q\d{1,2}$/.test(n)) return;      // yalnızca q1…q10 (bozuk kayıt seçiciyi kırmasın)
        var r = qs('input[name="' + n + '"][value="' + String(saved.a[n]).replace(/[^0-9]/g, '') + '"]', form);
        if (r) r.checked = true;
      });
      if (saved.done && qsEls.every(function (q, i) { return answered(i) || skip(i); })) {
        show(qsEls.length - 1, false);
        finish(false, true);
        return;
      }
      var firstOpen = 0;
      while (firstOpen < qsEls.length - 1 && (answered(firstOpen) || skip(firstOpen))) firstOpen++;
      show(firstOpen, false);
      return;
    }
    show(0, false);
  });

  /* =====================================================================
     Hesaplayıcılar
     ===================================================================== */
  var calcTabs = null;
  var calcHash = null;          // hesaplayıcı çapaları (#reaktif-ceza, #durus-maliyeti) için sekme seçici
  guard('calcs', KEY_CALC, function initCalcs() {
    var tabsEl = qs('#hesaplayicilar [data-fx-tabs]');
    if (tabsEl) calcTabs = initTabs(tabsEl);
    var summaries = {};

    var badNum = false;
    function num(id) {
      var inp = byId(id), raw = String(inp.value || '').trim(), v = parseNum(raw);
      var bad = raw !== '' && !isFinite(v);
      if (bad) { inp.setAttribute('aria-invalid', 'true'); badNum = true; } else inp.removeAttribute('aria-invalid');
      return isFinite(v) ? v : NaN;
    }
    function pos(v) { return isFinite(v) && v > 0 ? v : 0; }

    /* Girişleri odaktan çıkınca Türkçe biçimle */
    qsa('#hesaplayicilar [data-num]').forEach(function (inp) {
      /* Örnek değerin üzerine kolayca yazılabilsin: odakta tümünü seç */
      inp.addEventListener('focus', function () { setTimeout(function () { try { inp.select(); } catch (e) { /* yok say */ } }, 0); });
      inp.addEventListener('blur', function () {
        var v = parseNum(inp.value);
        if (isFinite(v) && inp.value.trim() !== '') inp.value = NF2.format(v);
      });
    });

    function setBar(fill, wrapEl, limEl, v, lim, label, vText) {
      var max = Math.max(lim * 2, v * 1.1, 1);
      fill.style.setProperty('--v', String(clamp(v / max, 0, 1)));
      limEl.style.setProperty('--lim', (lim / max * 100) + '%');
      var lt = limEl.firstElementChild;
      if (lt) lt.textContent = 'Sınır %' + lim;
      var lv = v > lim ? 'bad' : (v > lim * 0.8 ? 'warn' : 'ok');
      wrapEl.setAttribute('data-level', lv);
      wrapEl.setAttribute('aria-label', label + ' ' + vText + ', sınır %' + lim);
      return lv;
    }
    /* Oran sınırın çok az üzerindeyse yuvarlama aşımı gizlemesin (%20,004 → "%20,0" değil "%20,004") */
    function pctLim(v, lim) {
      if (!(v > lim)) return pct(v);
      for (var d = 1; d <= 4; d++) {
        var f = Math.pow(10, d);
        if (Math.round(v * f) / f > lim) return '%' + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: d }).format(v);
      }
      return pct(v) + ' (sınırın üzerinde)';
    }
    function rkGroup() {
      var s = byId('rkGrup');
      if (s && !RK_LIMITS[s.value]) s.value = 'ge50';
      return s && RK_LIMITS[s.value] ? s.value : 'ge50';
    }

    /* ---- (a) Reaktif ceza riski ---- */
    var rk = byId('fxReaktif');
    function calcReaktif() {
      badNum = false;
      var kwh = num('rkAktif'), ind = pos(num('rkInd')), kap = pos(num('rkKap')), price = num('rkFiyat'), inv = num('rkYatirim');
      var L = RK_LIMITS[rkGroup()];
      var st = byId('rkStatus'), stT = byId('rkStatusText'), stI = qs('i', st);
      if (!(kwh > 0) || badNum) {
        st.setAttribute('data-level', 'idle');
        stI.className = 'fas fa-circle-info';
        stT.textContent = badNum ? 'Bir değer sayı olarak okunamadı. Örnek biçim: 120.000 veya 1,5' : 'Hesaplama için aylık aktif enerji tüketimini girin.';
        ['rkIndPct', 'rkKapPct', 'rkCos', 'rkBilled', 'rkMonthly', 'rkYearly'].forEach(function (id) { byId(id).textContent = '–'; });
        byId('rkPayback').textContent = 'Yatırım tutarı girin';
        summaries.reaktif = null;
        return;
      }
      var ri = ind / kwh * 100, rc = kap / kwh * 100;
      var riT = pctLim(ri, L.ind), rcT = pctLim(rc, L.cap);
      byId('rkIndPct').textContent = riT;
      byId('rkKapPct').textContent = rcT;
      var li = setBar(byId('rkIndBar'), byId('rkIndBarWrap'), byId('rkIndLim'), ri, L.ind, 'Endüktif oran', riT);
      var lc = setBar(byId('rkKapBar'), byId('rkKapBarWrap'), byId('rkKapLim'), rc, L.cap, 'Kapasitif oran', rcT);
      byId('rkCos').textContent = NF3.format(kwh / Math.sqrt(kwh * kwh + ind * ind));

      /* md. 13/4 ve 13/6: aşılan sayacın ölçülen değerinin tamamı; ikisi birden aşılırsa en yüksek sayaç değeri */
      var overI = li === 'bad', overC = lc === 'bad';
      var billed = overI && overC ? Math.max(ind, kap) : overI ? ind : overC ? kap : 0;
      byId('rkBilled').textContent = NF0.format(Math.round(billed)) + ' kVArh';

      if (billed > 0) {
        st.setAttribute('data-level', 'bad');
        stI.className = 'fas fa-triangle-exclamation';
        stT.textContent = 'Ceza bölgesindesiniz: ' + (overI && overC ? 'endüktif ve kapasitif oran' : overI ? 'endüktif oran' : 'kapasitif oran') +
          ' sınırı aşıyor. Aşan kısım değil, ' + (overI && overC ? 'en yüksek reaktif sayaç değerinin' : 'ölçülen ' + (overI ? 'endüktif' : 'kapasitif') + ' enerjinin') +
          ' tamamı (' + NF0.format(Math.round(billed)) + ' kVArh) faturalanır.';
      } else if (li === 'warn' || lc === 'warn') {
        st.setAttribute('data-level', 'warn');
        stI.className = 'fas fa-circle-exclamation';
        stT.textContent = 'Sınıra yakınsınız. Yükün azaldığı gece ve hafta sonlarında oran sınırı aşabilir; aşılırsa ölçülen reaktif enerjinin tamamı faturalanır.';
      } else {
        st.setAttribute('data-level', 'ok');
        stI.className = 'fas fa-circle-check';
        stT.textContent = 'Sınırların altındasınız; bu tüketim profiliyle reaktif bedel beklenmez.';
      }

      var priceOk = isFinite(price) && price > 0;
      var m = priceOk ? billed * price : 0, y = m * RK_BILLED_MONTHS;
      if (!priceOk) {
        byId('rkMonthly').textContent = billed > 0 ? 'Birim fiyat girin' : '0 TL';
        byId('rkYearly').textContent = billed > 0 ? '–' : '0 TL';
      } else {
        byId('rkMonthly').textContent = tl(m);
        byId('rkYearly').textContent = tl(y);
      }
      var pb = byId('rkPayback');
      if (isFinite(inv) && inv > 0 && priceOk) {
        if (y > 0) {
          var mo = inv / (y / 12);
          pb.textContent = mo < 1 ? '1 aydan kısa' : '≈ ' + NF0.format(Math.ceil(mo)) + ' ay' + (mo >= 24 ? ' (≈ ' + NF1.format(mo / 12) + ' yıl)' : '');
        } else {
          pb.textContent = 'Ceza yok; cezaya göre geri ödeme hesaplanamaz';
        }
      } else {
        pb.textContent = 'Yatırım tutarı girin';
      }
      summaries.reaktif = 'Reaktif hesap (' + L.label + '): endüktif ' + riT + ' (sınır %' + L.ind + '), kapasitif ' + rcT + ' (sınır %' + L.cap + ')' +
        (billed > 0
          ? '; faturalanacak ' + NF0.format(Math.round(billed)) + ' kVArh' + (priceOk ? ', tahmini aylık bedel ' + tl(m) + ', yıllık ≈ ' + tl(y) + ' (11 ay)' : '')
          : '; sınırların altında');
    }

    /* ---- (b) Plansız duruş maliyeti ---- */
    var ds = byId('fxDurus');
    var azOut = byId('dsAzalmaOut');
    var dsSt = byId('dsStatus'), dsStT = byId('dsStatusText');
    var imported = '';          // ana sayfadan aktarılan değerlerin notu (kullanıcı değiştirene kadar)
    function setDsStatus(msg) {
      if (!dsSt) return;
      dsSt.hidden = !msg;
      if (dsStT) dsStT.textContent = msg || '';
    }
    function calcDurus() {
      badNum = false;
      var c = pos(num('dsCiro')), p = pos(num('dsPersonel')), h = pos(num('dsSaat')), n = pos(num('dsAdet')), f = pos(num('dsFire'));
      var r = clamp((+byId('dsAzalma').value || 0) / 100, 0, 0.95), b = num('dsBakim');
      azOut.textContent = '%' + Math.round(r * 100);
      if (badNum) {
        setDsStatus('Bir değer sayı olarak okunamadı. Örnek biçim: 25.000 veya 1,5');
        ['dsTotal', 'dsV1', 'dsV2', 'dsV3', 'dsNowV', 'dsPmV', 'dsSave', 'dsNet'].forEach(function (id) { byId(id).textContent = '–'; });
        ['dsB1', 'dsB2', 'dsB3', 'dsNow', 'dsPm'].forEach(function (id) { byId(id).style.setProperty('--v', '0'); });
        summaries.durus = null;
        return;
      }
      setDsStatus(imported);
      var v1 = h * c, v2 = h * p, v3 = n * f, tot = v1 + v2 + v3;
      var pm = tot * (1 - r), save = tot - pm;
      byId('dsTotal').textContent = tl(tot);
      byId('dsV1').textContent = tl(v1);
      byId('dsV2').textContent = tl(v2);
      byId('dsV3').textContent = tl(v3);
      var mx = tot || 1;
      byId('dsB1').style.setProperty('--v', String(v1 / mx));
      byId('dsB2').style.setProperty('--v', String(v2 / mx));
      byId('dsB3').style.setProperty('--v', String(v3 / mx));
      byId('dsNow').style.setProperty('--v', tot ? '1' : '0');
      byId('dsPm').style.setProperty('--v', String(tot ? 1 - r : 0));
      byId('dsNowV').textContent = tl(tot);
      byId('dsPmV').textContent = tl(pm);
      byId('dsSave').textContent = tl(save);
      byId('dsNet').textContent = isFinite(b) && b > 0 ? tl(save - b) : 'Bütçe girin';
      summaries.durus = tot > 0
        ? 'Duruş maliyeti: yıllık ≈ ' + tl(tot) + ' (' + NF2.format(h) + ' saat, ' + NF2.format(n) + ' duruş); önleyici bakımla %' + Math.round(r * 100) + ' azalma varsayımıyla ≈ ' + tl(save) + ' kazanç'
        : null;
    }

    /* Ekran okuyucu: her tuşta tüm paneli değil, yazma durunca tek bir özet cümle oku */
    var liveT = {};
    function liveSay(k) {
      clearTimeout(liveT[k]);
      liveT[k] = setTimeout(function () {
        var out = byId(k === 'reaktif' ? 'rkLive' : 'dsLive');
        if (!out) return;
        var msg;
        if (k === 'reaktif') {
          msg = byId('rkStatusText').textContent;
          if (summaries.reaktif) msg += ' Endüktif oran ' + byId('rkIndPct').textContent + ', kapasitif oran ' + byId('rkKapPct').textContent + '. Tahmini aylık bedel: ' + byId('rkMonthly').textContent + '.';
        } else {
          msg = (dsSt && !dsSt.hidden && byId('dsTotal').textContent === '–') ? dsStT.textContent
            : 'Yıllık plansız duruş maliyeti ' + byId('dsTotal').textContent + '; önleyici bakım ile ' + byId('dsPmV').textContent + '.';
        }
        out.textContent = msg;
      }, 800);
    }

    /* Hesaplayıcı girişlerini cihazda sakla */
    var IDS = ['rkGrup', 'rkAktif', 'rkInd', 'rkKap', 'rkFiyat', 'rkYatirim', 'dsCiro', 'dsPersonel', 'dsSaat', 'dsAdet', 'dsFire', 'dsAzalma', 'dsBakim'];
    var savedC = store.get(KEY_CALC);
    if (savedC && typeof savedC === 'object') {
      IDS.forEach(function (id) { if (typeof savedC[id] === 'string' && byId(id)) byId(id).value = savedC[id]; });
    }
    var cT = 0;
    function saveCalc() {
      clearTimeout(cT);
      cT = setTimeout(function () {
        var o = {};
        IDS.forEach(function (id) { if (byId(id)) o[id] = byId(id).value; });
        store.set(KEY_CALC, o);
      }, 400);
    }
    if (rk) { rk.addEventListener('input', function () { calcReaktif(); saveCalc(); liveSay('reaktif'); }); rk.addEventListener('submit', function (e) { e.preventDefault(); }); }
    if (ds) { ds.addEventListener('input', function () { imported = ''; calcDurus(); saveCalc(); liveSay('durus'); }); ds.addEventListener('submit', function (e) { e.preventDefault(); }); }

    /* İlk hesaplama, bölüm görünür olunca (çubuklar dolarak gelsin) */
    var sec = byId('hesaplayicilar');
    var started = false;
    function start() { if (started) return; started = true; calcReaktif(); calcDurus(); }
    if (motionOK()) onceVisible(sec, start, { threshold: 0.15 }); else start();
    if (calcTabs) calcTabs.tabs.forEach(function (t) { t.addEventListener('click', start); });

    qsa('[data-fx-calc-add]').forEach(function (b) {
      var orig = b.innerHTML;
      b.addEventListener('click', function () {
        start();
        var k = b.getAttribute('data-fx-calc-add');
        var s = summaries[k];
        if (!s) { announce('Önce hesaplama için değerleri girin.'); return; }
        Wizard.attach(k, s);
        if (k === 'reaktif') Wizard.preselect(['kompanzasyon', 'enerji-kalitesi']);
        b.classList.add('is-done');
        b.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> Teklife eklendi';
        announce('Sonuç teklif sihirbazına eklendi. Sihirbaz sayfanın alt bölümündedir.');
        setTimeout(function () { b.classList.remove('is-done'); b.innerHTML = orig; }, 2600);
      });
    });

    /* Ana sayfadaki hızlı tahmin (index.html #downtimeCalc, GET formu; js/main.js gönderime dokunmaz):
       /fabrika-cozumleri.html?saat=<1-240, yıllık plansız duruş saati>&tl=<5.000-500.000, bir saatlik duruşun
       toplam maliyeti>#durus-maliyeti. Eşleme: saat → dsSaat (yıllık duruş saati), tl → dsCiro (saatlik kayıp);
       personel ve fire 0 yazılır ki yıllık sonuç ana sayfadaki saat × tl ile aynı çıksın (kullanıcı kalemlere
       ayırabilir). Sorgu, yenilemede tekrar uygulanmasın diye silinir; hash yoksa #durus-maliyeti eklenir. */
    function importParams() {
      var q;
      try { q = new URLSearchParams(win.location.search); } catch (e) { return; }
      if (!q.has('saat') && !q.has('tl')) return;
      var h = parseNum(q.get('saat')), t = parseNum(q.get('tl'));
      try { win.history.replaceState(win.history.state, '', win.location.pathname + (win.location.hash || '#durus-maliyeti')); } catch (e) { /* yok say */ }
      if (!(h > 0 && h <= 8760) || !(t > 0 && t < 1e10)) {
        imported = 'Ana sayfadan gelen değerler okunamadı; hesap formdaki değerlerle yapıldı.';
        return;
      }
      byId('dsSaat').value = NF2.format(h);
      byId('dsCiro').value = NF2.format(t);
      byId('dsPersonel').value = '0';
      byId('dsFire').value = '0';
      imported = 'Ana sayfadaki hızlı tahmininiz aktarıldı: yılda ' + NF2.format(h) + ' saat × ' + tl(t) + '/saat. Saatlik maliyeti ciro, personel ve fire kalemlerine ayırarak sonucu ayrıntılandırabilirsiniz.';
      saveCalc();
    }
    function applyHash(id, fromLoad) {
      if (!calcTabs) return false;
      if (id === 'reaktif-ceza') { calcTabs.select(0, false); start(); return true; }
      if (id === 'durus-maliyeti') {
        calcTabs.select(1, false);
        if (fromLoad) importParams();
        if (started) calcDurus(); else start();
        return true;
      }
      return false;
    }
    calcHash = applyHash;
    var h0 = '', hasQ = false;
    try { h0 = decodeURIComponent((win.location.hash || '').slice(1)); } catch (e) { h0 = ''; }
    try { var q0 = new URLSearchParams(win.location.search); hasQ = q0.has('saat') || q0.has('tl'); } catch (e) { hasQ = false; }
    if (h0) applyHash(h0, true);
    /* ?saat&tl hash'siz (paylaşılan / elle yazılan adres) ya da başka bir hash ile gelirse de aktar; hash yoksa
       duruş hesaplayıcısına kaydır (vg-shell.js yükleme sonunda hizalamayı düzeltir). */
    if (hasQ && h0 !== 'durus-maliyeti') {
      applyHash('durus-maliyeti', true);
      if (!h0) scrollToId('durus-maliyeti');
    }
    win.addEventListener('hashchange', function () {
      var h = '';
      try { h = decodeURIComponent((win.location.hash || '').slice(1)); } catch (e) { return; }
      applyHash(h, false);
    });
  });

  /* =====================================================================
     Sektörler
     ===================================================================== */
  guard('sectors', null, function initSectors() {
    var tabsEl = qs('#sektorler [data-fx-tabs]');
    if (tabsEl) initTabs(tabsEl);
    qsa('[data-fx-sector]').forEach(function (b) {
      b.addEventListener('click', function () {
        Wizard.setSector(b.getAttribute('data-fx-sector'));
        Wizard.preselect((b.getAttribute('data-fx-services') || '').split(',').filter(Boolean));
        Wizard.go();
      });
    });
  });

  /* =====================================================================
     Sayaçlar (yalnızca sitedeki gerçek sayılar: 5 disiplin, 50+ proje; 7/24 acil arıza hattı sabit metindir)
     ===================================================================== */
  guard('counters', null, function initCounters() {
    var nums = qsa('[data-fx-count]');
    if (!nums.length || !motionOK() || !hasIO) return;
    var box = nums[0].closest('.fx-stats');
    var r = box.getBoundingClientRect();
    if (r.top < win.innerHeight && r.bottom > 0) return;     // zaten görünüyorsa dokunma
    nums.forEach(function (n) { n.textContent = '0'; });
    onceVisible(box, function () {
      var t0 = 0, dur = 1500;
      function step(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        var e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
        nums.forEach(function (n) { n.textContent = String(Math.round(+n.getAttribute('data-fx-count') * e)); });
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
  });

  /* =====================================================================
     Süreç zaman çizelgesi
     ===================================================================== */
  guard('steps', null, function initSteps() {
    var s = byId('fxSteps');
    if (!s) return;
    if (!hasIO || !motionOK()) { s.classList.add('is-in'); return; }
    onceVisible(s, function () { s.classList.add('is-in'); }, { threshold: 0.25 });
  });

  /* =====================================================================
     Mobil yapışkan çağrı çubuğu
     ===================================================================== */
  guard('sticky', null, function initSticky() {
    var bar = byId('fxSticky');
    if (!bar || !hasIO) return;
    var links = qsa('a', bar);
    var heroOut = false, blocked = {}, typing = false;
    function update() {
      var on = heroOut && !typing && !Object.keys(blocked).some(function (k) { return blocked[k]; });
      bar.classList.toggle('is-on', on);
      doc.documentElement.classList.toggle('fx-sticky-on', on);   // CSS: odaklanan öğe çubuğun altında kalmasın
      bar.setAttribute('aria-hidden', on ? 'false' : 'true');
      links.forEach(function (a) { a.tabIndex = on ? 0 : -1; });
    }
    var hero = qs('.fx-hero');
    new IntersectionObserver(function (en) { heroOut = !en[0].isIntersecting; update(); }, { threshold: 0 }).observe(hero);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { blocked[en.target.id || 'f'] = en.isIntersecting; });
      update();
    }, { threshold: 0 });
    ['teklif', 'vgFooter'].forEach(function (id) { var t = byId(id); if (t) io.observe(t); });
    doc.addEventListener('focusin', function (e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { typing = true; update(); }
    });
    doc.addEventListener('focusout', function () {
      setTimeout(function () {
        var a = doc.activeElement;
        typing = !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
        update();
      }, 50);
    });
  });
}());
