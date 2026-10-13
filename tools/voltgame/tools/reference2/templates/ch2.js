'use strict';
// ============================================================================
// PARALAKS: TEK HAT — templates/ch2.js : Bölüm 2 "Trafo Merkezi" (34,5/0,4 kV) şablonları, kural sürümü 4 (R1)
// Biçim templates2.js başlığındaki gibidir (FİZİKSEL DÜNYA: 'kafa' yok; saha arketipi 'saha').
// Her şablon levels/ch2.js içindeki elle yazılmış seviyenin elektrik şemasıdır; gen2 yalnız sahayı arar:
//   node tools/reference2/gen2.js <şablon> <tohum> <saniye> out.json tools/reference2/levels/ch2.js#<id>
// T1 (2.2 Geri Besleme) şablonu kurallar ekibinindir: templates2.js 'geri_besleme_k'.
// Kural sürümü 3 seçici kafaları gerçek cihaza çevrildi: pompa fideri ayırıcısı (trafo_giris), hastane fideri
// bara ayırıcıları Q11/Q12 (kilitsiz_aciklik, uzak_toprak, hastane_kesintisiz), AG kuplajıyla yüksüz aktarma ve
// paralel çalışamayan iki indirici merkez (n1_bakim, G2 grup 2), kapalı kalmış AG kuplajı (n1_kapasite, merkez_sinav).
//  I = AÇMA EŞİĞİ (birim akım). K7: erişilen her yapılandırmada akım ile eşik arasında >= 0,5 (tamsayı olmayan
//  akımda >= 1) pay olacak biçimde eşikler, yük taleplerinin bütün alt toplamlarından uzak seçildi.
//  Tek Hat ızgarası (sld) şablon başına sabittir (geometriden bağımsız); seviye dosyasına kopyalanır.
//   sld.node[id] = [sütun, satır(, bitiş sütunu)]; sld.el[id] = [sütun, satır, yön]
//   yön: iki uçlu eleman için 'v' (dikey) | 'h' (yatay); tek uçlu ek (kaynak, yük, toprak, bara, kondansatör)
//   için sembolün düğüme göre yönü 'u' | 'd' | 'l' | 'r'. Satır aşağı doğru artar. Kapı Tek Hat'a çizilmez.
// ============================================================================
module.exports = {
  // 2.1 Trafo Ayırıcıyla Enerjilenmez (öğretici) — TR3'ü kesiciyle servise al; pompa fideri ayırıcısı ölüyken kapanır
  // elle yazılmış seviye: levels/ch2.js#T3 (gen2 tohumu olarak verilebilir)
  trafo_giris: {
    ch: 2, W: 5, D: 5, MAXH: 3, minPar: 4, maxPar: 12, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: { kv: 34.5 }, x: { kv: 34.5 }, b: { kv: 34.5 }, t: {}, ag: {}, y: {} },
      hedef: { kapali: ['Q01', 'Q91', 'Q03', 'Q05'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'OG fider (34,5 kV)' },
        { id: 'Q01', t: 'kesici', a: 'g', b: 'x', I: 9, kapali: true, ad: 'TR3 OG kesicisi' },
        { id: 'Q91', t: 'ayirici', a: 'x', b: 'b', ad: 'TR3 OG hat ayırıcısı' },
        { id: 'T1', t: 'trafo', a: 'b', b: 't', ad: 'TR3 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't', b: 'ag', I: 9, ad: 'TR3 AG kesicisi' },
        { id: 'Q05', t: 'ayirici', a: 'ag', b: 'y', ad: 'Pompa fideri ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'y', ad: 'Su pompa istasyonu', d: 1, w: 2 },
      ],
    },
    cells: ['G1', 'Q01', 'Q91', 'T1', 'Q05', 'Q03', 'Y1'],
    essential: ['noAyiriciKurali'],
    sld: { node: { g: [1, 0], x: [1, 2], b: [1, 4], t: [1, 6], ag: [1, 8], y: [1, 10] }, el: { G1: [0, 0, 'l'], Q01: [1, 1, 'v'], Q91: [1, 3, 'v'], T1: [1, 5, 'v'], Q03: [1, 7, 'v'], Q05: [1, 9, 'v'], Y1: [1, 11, 'd'] } },
  },

  // 2.3 Görünmeyen Açıklık (çekirdek) — AG Bara-1 bakımı; hastane fiderinin açık ama kilitsiz bara ayırıcısı da bir yoldur
  // elle yazılmış seviye: levels/ch2.js#T4 (gen2 tohumu olarak verilebilir)
  kilitsiz_aciklik: {
    ch: 2, W: 7, D: 5, MAXH: 3, minPar: 10, maxPar: 30, sinif: 'cekirdek', saha: 'asma_kat', work: true,
    base: {
      kilit: 3,
      is: { bolge: ['a1'], ad: 'AG Bara-1 bağlantı cıvatalarını sık ve temizle' },
      hedef: { yukler: ['Y1', 'Y2'], gerilimli: ['a1'], kapali: ['Q03', 'Q04', 'Q11'], acik: ['Q0K', 'Q12'] },
      dugum: { o1: { kv: 34.5 }, t1: {}, a1: {}, o2: { kv: 34.5 }, t2: {}, a2: {}, h: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2 (34,5 kV)' },
        { id: 'T1', t: 'trafo', a: 'o1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'T2', t: 'trafo', a: 'o2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'a1', I: 6, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB)' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 6, kademe: 1, kapali: true, ad: 'TR2 AG kesicisi' },
        { id: 'Q0K', t: 'kesici', a: 'a1', b: 'a2', I: 6, kademe: 2, cekmeli: true, ad: 'AG bara kuplaj kesicisi (çekmeli, normalde açık)' },
        { id: 'B1', t: 'bara', dugum: 'a1', r: 1, ad: 'AG Bara-1' },
        { id: 'Q81', t: 'toprak', dugum: 'a1', ad: 'AG Bara-1 topraklama ayırıcısı' },
        { id: 'Q11', t: 'ayirici', a: 'a1', b: 'h', kapali: true, ad: 'Hastane fideri Bara-1 ayırıcısı' },
        { id: 'Q12', t: 'ayirici', a: 'a2', b: 'h', ad: 'Hastane fideri Bara-2 ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane', d: 2, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 1, w: 1 },
      ],
    },
    cells: ['B1', 'Q03', 'Q11', 'Q0K', 'Q12', 'Q04', 'Q81', 'G1', 'G2', 'T1', 'Y1', 'Y2', 'T2'],
    essential: ['noLoto', 'noZones', 'noAyiriciKurali:kesinti'],
    sld: { node: { o1: [1, 0], t1: [1, 2], a1: [1, 4, 3], o2: [7, 0], t2: [7, 2], a2: [5, 4, 7], h: [2, 6, 6] }, el: { G1: [0, 0, 'l'], T1: [1, 1, 'v'], Q03: [1, 3, 'v'], G2: [8, 0, 'r'], T2: [7, 1, 'v'], Q04: [7, 3, 'v'], Q0K: [4, 4, 'h'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], Q11: [2, 5, 'v'], Q12: [6, 5, 'v'], Y1: [4, 7, 'd'], Y2: [8, 4, 'r'] } },
  },

  // 2.4 Uzak Uçtan Topraklama (çekirdek) — topraklama kolu yaklaşma sınırında; kabloyu RMU ucundan toprakla
  // elle yazılmış seviye: levels/ch2.js#T5 (gen2 tohumu olarak verilebilir)
  uzak_toprak: {
    ch: 2, W: 7, D: 6, MAXH: 3, minPar: 10, maxPar: 30, sinif: 'cekirdek', saha: 'galeri', work: true,
    base: {
      kilit: 2,
      is: { bolge: ['b1'], ad: 'TR1 OG kablo başlığını temizle ve yeniden bantla' },
      hedef: { yukler: ['Y1', 'Y2'], gerilimli: ['b1'], kapali: ['QL1', 'Q03', 'Q04'] },
      dugum: { o1: { kv: 34.5 }, k: { kv: 34.5 }, b1: { kv: 34.5 }, t1: {}, ag: {}, o2: { kv: 34.5 }, t2: {}, a2: {}, h: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG ring fideri (RMU-1)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', grup: 2, ad: 'OG fider 2 (34,5 kV, başka TM; RMU ringiyle paralel çalışmaz)' },
        { id: 'QL1', t: 'yuk_ayirici', a: 'o1', b: 'k', kapali: true, ad: 'RMU-1 TR1 çıkış yük ayırıcısı' },
        { id: 'W1', t: 'kablo', a: 'k', b: 'b1', ad: 'TR1 OG kablosu' },
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' },
        { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı (kolu yaklaşma sınırında)' },
        { id: 'Q82', t: 'toprak', dugum: 'k', ad: 'RMU-1 kablo topraklama ayırıcısı' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'ag', I: 6, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB)' },
        { id: 'T2', t: 'trafo', a: 'o2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 6, kademe: 1, kapali: true, ad: 'TR2 AG kesicisi' },
        { id: 'Q11', t: 'ayirici', a: 'ag', b: 'h', kapali: true, ad: 'Hastane fideri TR1 barası ayırıcısı' },
        { id: 'Q12', t: 'ayirici', a: 'a2', b: 'h', ad: 'Hastane fideri TR2 barası ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane', d: 2, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 1, w: 1 },
      ],
    },
    cells: ['B1', 'G1', 'Q81', 'QL1', 'Q82', 'T1', 'T2', 'Q03', 'Q11', 'Q12', 'Q04', 'Y1', 'Y2'],
    essential: ['noZones', 'noLoto'],
    sld: { node: { o1: [1, 0], k: [1, 2], b1: [1, 4], t1: [1, 6], ag: [1, 8, 3], o2: [7, 4], t2: [7, 6], a2: [5, 8, 7], h: [2, 10, 6] }, el: { G1: [0, 0, 'l'], QL1: [1, 1, 'v'], Q82: [0, 2, 'l'], W1: [1, 3, 'v'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], T1: [1, 5, 'v'], Q03: [1, 7, 'v'], G2: [8, 4, 'r'], T2: [7, 5, 'v'], Q04: [7, 7, 'v'], Q11: [2, 9, 'v'], Q12: [6, 9, 'v'], Y1: [4, 11, 'd'], Y2: [8, 8, 'r'] } },
  },

  // 2.5 Trafo N-1 Bakımı (zor) — TR2 paralel çalışamaz (senkron): hastaneyi kuplajla yüksüz aktar; kondansatör deşarjı
  // elle yazılmış seviye: levels/ch2.js#T2 (gen2 tohumu olarak verilebilir)
  n1_bakim: {
    ch: 2, W: 7, D: 7, MAXH: 3, minPar: 18, maxPar: 50, sinif: 'zor', saha: 'galeri', work: true, hard: true,
    base: {
      kilit: 2,
      is: { bolge: ['b1'], ad: 'TR1 OG barası bağlantılarını temizle ve sık' },
      hedef: { yukler: ['Y1', 'Y2'], gerilimli: ['b1'], kapali: ['Q01', 'Q91', 'Q03', 'Q04', 'Q02', 'QC1'], acik: ['Q0K'] },
      dugum: { o1: { kv: 34.5 }, x1: { kv: 34.5 }, b1: { kv: 34.5 }, t1: {}, a1: {}, o2: { kv: 34.5 }, y2: { kv: 34.5 }, t2: {}, a2: {}, c1: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV, İndirici Merkez A)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', grup: 2, ad: 'OG fider 2 (34,5 kV, İndirici Merkez B; fider 1 ile paralel çalışmaz)' },
        { id: 'Q01', t: 'kesici', a: 'o1', b: 'x1', I: 9, kapali: true, ad: 'TR1 OG kesicisi' },
        { id: 'Q91', t: 'ayirici', a: 'x1', b: 'b1', kapali: true, ad: 'TR1 OG hat ayırıcısı' },
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' },
        { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'a1', I: 4, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB, eşik 4)' },
        { id: 'Q02', t: 'kesici', a: 'o2', b: 'y2', I: 9, kapali: true, ad: 'TR2 OG kesicisi' },
        { id: 'T2', t: 'trafo', a: 'y2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 4, kademe: 1, kapali: true, cekmeli: true, ad: 'TR2 AG kesicisi (çekmeli ACB, eşik 4)' },
        { id: 'Q0K', t: 'kesici', a: 'a1', b: 'a2', I: 9, cekmeli: true, ad: 'AG bara kuplaj kesicisi (çekmeli, normalde açık)' },
        { id: 'Y1', t: 'yuk', dugum: 'a1', ad: 'Hastane', d: 2, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 1, w: 1 },
        { id: 'QC1', t: 'kesici', a: 'a1', b: 'c1', I: 9, kapali: true, ad: 'Kompanzasyon kademe kesicisi' },
        { id: 'C1', t: 'kondansator', dugum: 'c1', q: 1, r: 1, ad: 'Kompanzasyon kondansatör bataryası' },
      ],
    },
    cells: ['G1', 'Q01', 'B1', 'Q91', 'Q81', 'T1', 'T2', 'G2', 'Q03', 'Q0K', 'Q04', 'Q02', 'C1', 'QC1', 'Y1', 'Y2'],
    essential: ['noLoto', 'noBackfeed', 'noSync:kesinti', 'noCapLock:kesinti'],
    sld: { node: { o1: [1, 0], x1: [1, 2], b1: [1, 4], t1: [1, 6], a1: [1, 8, 4], o2: [9, 2], y2: [9, 4], t2: [9, 6], a2: [6, 8, 9], c1: [3, 10] }, el: { G1: [0, 0, 'l'], Q01: [1, 1, 'v'], Q91: [1, 3, 'v'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], T1: [1, 5, 'v'], Q03: [1, 7, 'v'], G2: [10, 2, 'r'], Q02: [9, 3, 'v'], T2: [9, 5, 'v'], Q04: [9, 7, 'v'], Q0K: [5, 8, 'h'], Y1: [1, 9, 'd'], Y2: [8, 9, 'd'], QC1: [3, 9, 'v'], C1: [3, 11, 'd'] } },
  },

  // 2.6 Hastane Kesintisiz (zor) — sabit tip TR1 AG kesicisi: Bara-1 her çıkışından kilitlenir; bara ayırıcılarıyla komütasyon
  // elle yazılmış seviye: levels/ch2.js#T6 (gen2 tohumu olarak verilebilir)
  hastane_kesintisiz: {
    ch: 2, W: 7, D: 7, MAXH: 4, minPar: 18, maxPar: 50, sinif: 'zor', saha: 'galeri', work: true, hard: true,
    base: {
      kilit: 3,
      is: { bolge: ['b1'], ad: 'TR1 OG barası mesnet izolatörlerini değiştir' },
      hedef: { yukler: ['Y1', 'Y2'], gerilimli: ['b1'], kapali: ['Q01', 'Q91', 'Q03', 'Q04', 'Q11', 'QC1'], acik: ['Q0K', 'Q12'] },
      dugum: { o1: { kv: 34.5 }, x1: { kv: 34.5 }, b1: { kv: 34.5 }, t1: {}, a1: {}, o2: { kv: 34.5 }, t2: {}, a2: {}, h: {}, c1: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2 (34,5 kV)' },
        { id: 'Q01', t: 'kesici', a: 'o1', b: 'x1', I: 9, kapali: true, ad: 'TR1 OG kesicisi' },
        { id: 'Q91', t: 'ayirici', a: 'x1', b: 'b1', kapali: true, ad: 'TR1 OG hat ayırıcısı' },
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası (bara bölmesi)' },
        { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'a1', I: 4, kademe: 1, kapali: true, ad: 'TR1 AG kesicisi (sabit tip, kilitlenemez; eşik 4)' },
        { id: 'T2', t: 'trafo', a: 'o2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 4, kademe: 1, kapali: true, ad: 'TR2 AG kesicisi (eşik 4)' },
        { id: 'Q0K', t: 'kesici', a: 'a1', b: 'a2', I: 9, cekmeli: true, ad: 'AG bara kuplaj kesicisi (çekmeli, normalde açık)' },
        { id: 'Q11', t: 'ayirici', a: 'a1', b: 'h', kapali: true, ad: 'Hastane fideri Bara-1 ayırıcısı' },
        { id: 'Q12', t: 'ayirici', a: 'a2', b: 'h', ad: 'Hastane fideri Bara-2 ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane', d: 2, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 1, w: 1 },
        { id: 'QC1', t: 'kesici', a: 'a1', b: 'c1', I: 9, kapali: true, ad: 'Kompanzasyon kademe kesicisi' },
        { id: 'C1', t: 'kondansator', dugum: 'c1', q: 1, r: 1, ad: 'Kompanzasyon kondansatör bataryası' },
      ],
    },
    cells: ['G1', 'Q01', 'Q91', 'Q81', 'B1', 'T1', 'T2', 'G2', 'Q03', 'Q11', 'Q0K', 'Q04', 'C1', 'QC1', 'Y1', 'Q12', 'Y2'],
    essential: ['noBackfeed', 'noLoto', 'noAyiriciKurali:kesinti'],
    sld: { node: { o1: [1, 0], x1: [1, 2], b1: [1, 4], t1: [1, 6], a1: [1, 8, 4], o2: [9, 4], t2: [9, 6], a2: [6, 8, 9], h: [2, 10, 7], c1: [0, 10] }, el: { G1: [0, 0, 'l'], Q01: [1, 1, 'v'], Q91: [1, 3, 'v'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], T1: [1, 5, 'v'], Q03: [1, 7, 'v'], G2: [10, 4, 'r'], T2: [9, 5, 'v'], Q04: [9, 7, 'v'], Q0K: [5, 8, 'h'], Q11: [2, 9, 'v'], Q12: [7, 9, 'v'], Y1: [4, 11, 'd'], Y2: [10, 8, 'r'], QC1: [0, 9, 'v'], C1: [0, 11, 'd'] } },
  },

  // 2.7 N-1 Kapasitesi (zor) — kapalı kalmış kuplaj: kalan trafo bütün yükü taşıyamaz; depoyu bilerek at, hastaneyi koru
  // elle yazılmış seviye: levels/ch2.js#T7 (gen2 tohumu olarak verilebilir)
  n1_kapasite: {
    ch: 2, W: 7, D: 7, MAXH: 3, minPar: 18, maxPar: 50, sinif: 'zor', saha: 'galeri', work: true, hard: true,
    base: {
      kilit: 2,
      is: { bolge: ['b1'], ad: 'TR1 OG barası bağlantılarını temizle ve sık' },
      hedef: { yukler: ['Y1', 'Y2', 'Y3'], gerilimli: ['b1'], kapali: ['Q01', 'Q91', 'Q03', 'Q04', 'Q06'], acik: ['Q0K'] },
      dugum: { o1: { kv: 34.5 }, x1: { kv: 34.5 }, b1: { kv: 34.5 }, t1: {}, a1: {}, o2: { kv: 34.5 }, t2: {}, a2: {}, d: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2 (34,5 kV)' },
        { id: 'Q01', t: 'kesici', a: 'o1', b: 'x1', I: 15, kademe: 3, kapali: true, ad: 'TR1 OG kesicisi' },
        { id: 'Q91', t: 'ayirici', a: 'x1', b: 'b1', kapali: true, ad: 'TR1 OG hat ayırıcısı' },
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' },
        { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı' },
        { id: 'K1', t: 'kapi', kilitli: 'Q91', ad: 'TR1 OG bara hücresi kapısı — Q91 kilitlemeli' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'T2', t: 'trafo', a: 'o2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'a1', I: 9, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB, eşik 9)' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 9, kademe: 1, kapali: true, cekmeli: true, ad: 'TR2 AG kesicisi (çekmeli ACB, eşik 9)' },
        { id: 'Q0K', t: 'kesici', a: 'a1', b: 'a2', I: 15, kademe: 2, kapali: true, cekmeli: true, ad: 'AG bara kuplaj kesicisi (normalde açık; şu an kapalı)' },
        { id: 'Q06', t: 'kesici', a: 'a2', b: 'd', I: 9, kademe: 0, kapali: true, ad: 'Soğuk depo fider kesicisi' },
        { id: 'Y1', t: 'yuk', dugum: 'a1', ad: 'Hastane', d: 4, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 2, w: 1 },
        { id: 'Y3', t: 'yuk', dugum: 'd', ad: 'Soğuk hava deposu', d: 4, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'Q91', 'B1', 'Q81', 'T1', 'T2', 'G2', 'Q03', 'Q0K', 'Q04', 'Y1', 'Y2', 'Q06', 'Y3'],
    essential: ['noProtection:kesinti', 'noLoto', 'noBackfeed'],
    sld: { node: { o1: [1, 0], x1: [1, 2], b1: [1, 4], t1: [1, 6], a1: [1, 8, 4], o2: [9, 4], t2: [9, 6], a2: [6, 8, 9], d: [11, 10] }, el: { G1: [0, 0, 'l'], Q01: [1, 1, 'v'], Q91: [1, 3, 'v'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], T1: [1, 5, 'v'], Q03: [1, 7, 'v'], G2: [10, 4, 'r'], T2: [9, 5, 'v'], Q04: [9, 7, 'v'], Q0K: [5, 8, 'h'], Q06: [11, 9, 'v'], Y1: [2, 9, 'd'], Y2: [8, 9, 'd'], Y3: [11, 11, 'd'] } },
  },

  // 2.8 Trafo Merkezi Sınavı — TR1 genel bakımı: trafo iki taraftan ayrılır ve topraklanır; N-1 kapasitesi; kondansatör çeldirici
  // elle yazılmış seviye: levels/ch2.js#T8 (gen2 tohumu olarak verilebilir)
  merkez_sinav: {
    ch: 2, W: 7, D: 7, MAXH: 3, minPar: 24, maxPar: 60, sinif: 'sinav', saha: 'galeri', work: true, hard: true,
    base: {
      kilit: 3,
      is: { bolge: ['b1', 't1'], ad: 'TR1 genel bakımı: OG barası ve AG çıkış bağlantıları' },
      hedef: { yukler: ['Y1', 'Y2', 'Y3'], gerilimli: ['b1', 't1'], kapali: ['Q01', 'Q91', 'Q03', 'Q04', 'Q06', 'QC1'], acik: ['Q0K'] },
      dugum: { o1: { kv: 34.5 }, x1: { kv: 34.5 }, b1: { kv: 34.5 }, t1: {}, a1: {}, o2: { kv: 34.5 }, t2: {}, a2: {}, d: {}, c1: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV)' },
        { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2 (34,5 kV)' },
        { id: 'Q01', t: 'kesici', a: 'o1', b: 'x1', I: 15, kademe: 3, kapali: true, ad: 'TR1 OG kesicisi' },
        { id: 'Q91', t: 'ayirici', a: 'x1', b: 'b1', kapali: true, ad: 'TR1 OG hat ayırıcısı' },
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' },
        { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı' },
        { id: 'K1', t: 'kapi', kilitli: 'Q91', ad: 'TR1 OG bara hücresi kapısı — Q91 kilitlemeli' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        { id: 'Q83', t: 'toprak', dugum: 't1', ad: 'TR1 AG buşing topraklama ayırıcısı (trafo üstünde)' },
        { id: 'T2', t: 'trafo', a: 'o2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        { id: 'Q03', t: 'kesici', a: 't1', b: 'a1', I: 9, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB, eşik 9)' },
        { id: 'Q04', t: 'kesici', a: 't2', b: 'a2', I: 9, kademe: 1, kapali: true, cekmeli: true, ad: 'TR2 AG kesicisi (çekmeli ACB, eşik 9)' },
        { id: 'Q0K', t: 'kesici', a: 'a1', b: 'a2', I: 15, kademe: 2, kapali: true, ad: 'AG bara kuplaj kesicisi (sabit tip, kilitlenemez; normalde açık, şu an kapalı)' },
        { id: 'Q06', t: 'kesici', a: 'a2', b: 'd', I: 9, kademe: 0, kapali: true, ad: 'Soğuk depo fider kesicisi' },
        { id: 'Y1', t: 'yuk', dugum: 'a1', ad: 'Hastane', d: 4, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 2, w: 1 },
        { id: 'Y3', t: 'yuk', dugum: 'd', ad: 'Soğuk hava deposu', d: 4, w: 1 },
        { id: 'QC1', t: 'kesici', a: 'a1', b: 'c1', I: 9, kapali: true, ad: 'Kompanzasyon kademe kesicisi' },
        { id: 'C1', t: 'kondansator', dugum: 'c1', q: 1, r: 1, ad: 'Kompanzasyon kondansatör bataryası' },
      ],
    },
    cells: ['Q83', 'G1', 'Q91', 'B1', 'Q81', 'Q01', 'T1', 'T2', 'G2', 'Y1', 'Q03', 'Q0K', 'Q04', 'C1', 'QC1', 'Q06', 'Y3', 'Y2'],
    essential: ['noProtection:kesinti', 'noLoto', 'noZones', 'noAyiriciKurali'],
    sld: { node: { o1: [1, 0], x1: [1, 2], b1: [1, 4], t1: [1, 6], a1: [1, 8, 4], o2: [9, 4], t2: [9, 6], a2: [6, 8, 9], d: [11, 10], c1: [3, 10] }, el: { G1: [0, 0, 'l'], Q01: [1, 1, 'v'], Q91: [1, 3, 'v'], B1: [2, 4, 'r'], Q81: [0, 4, 'l'], T1: [1, 5, 'v'], Q83: [0, 6, 'l'], Q03: [1, 7, 'v'], G2: [10, 4, 'r'], T2: [9, 5, 'v'], Q04: [9, 7, 'v'], Q0K: [5, 8, 'h'], Q06: [11, 9, 'v'], QC1: [3, 9, 'v'], C1: [3, 11, 'd'], Y1: [1, 9, 'd'], Y2: [8, 9, 'd'], Y3: [11, 11, 'd'] } },
  }
};
