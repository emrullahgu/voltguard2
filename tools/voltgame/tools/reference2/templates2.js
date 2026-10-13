'use strict';
// ============================================================================
// PARALAKS: TEK HAT — templates2.js : seviye üreticisinin ELEKTRİK şablonları (kural sürümü 4: FİZİKSEL DÜNYA)
// Her şablon gerçek bir manevra senaryosudur (tek hat şeması sabit); üretici (gen2.js) yalnız SAHAYI arar:
// sütun yükseklikleri, duvarlar, merdivenler, iskeleler, kapılar, ekipman yerleşimi, başlangıç/iş karosu.
//  Cihaz kodları IEC 81346 alışkanlığıyla: -Q0x kesici, -Q1x bara ayırıcısı, -Q9x hat ayırıcısı, -Q8x topraklama
//  ayırıcısı, -QLx yük ayırıcısı, -QCx kondansatör kademe kesicisi, -F sigorta, -K kontaktör, -S buton, -T trafo,
//  -C kondansatör, -G kaynak, -W kablo, Y yük (cihaz değil, tüketici), K (kapı) hücre kapısı (kilitlemeli).
//  Kural sürümü 4: izdüşüm seçicisi (kafa) YOK. Eski kafa çiftleri sahada gerçek anahtarlama cihazına çevrildi
//  (bara seçici ayırıcısı, transfer ayırıcısı, ring normalde açık noktası yük ayırıcısı, kumanda MCB'si).
//  I = AÇMA EŞİĞİ (birim akım; akım eşiği AŞARSA açar). Yük talebi d iş emri kartında yazılır. Her elemanın `ad`ı
//  oyuncuya gösterilen GERÇEK İŞLEVİDİR ("Q01 Okul fideri kesicisi") — amaç kapısı (lint2.purpose) ister.
//  cells     : küp olarak sahaya yerleşecek elemanlar (kapı elemanları ayrıca yerleşir)
//  essential : ablasyonu optimumu DEĞİŞTİRMESİ gereken mekanikler ('bayrak' Hamle, 'bayrak:kesinti' Kesinti-opt)
//  saha      : 'duz' | 'asma_kat' | 'galeri' | 'kosk' | 'kanal' — çok katlı saha arketipi (gen2.js başlığı)
//  W,D,MAXH  : diorama sınırları; minPar/maxPar: Hamle aralığı (komut; yürüyüş koşusu 1)
//  work      : iş noktası var (def.is.bolge + def.is.ad zorunlu); hard: zor seviye; zeroKesinti: Kesinti-opt 0 ödüllenir
// ============================================================================
const K = (id, a, b, o) => Object.assign({ id, t: 'kesici', a, b, I: 9 }, o || {});
const A = (id, a, b, o) => Object.assign({ id, t: 'ayirici', a, b }, o || {});
const OG = { kv: 34.5 };

module.exports = {
  // ---------------------------------------------------------------- Prolog (AG)
  ilk_manevra: {
    ch: 0, W: 6, D: 5, MAXH: 3, minPar: 5, maxPar: 12, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: {}, a: {}, b: {}, c: {}, f: {}, o: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'Depo UPS çıkışı' },
        K('Q01', 'g', 'a', { I: 3.5, kapali: true, ad: 'UPS çıkış kesicisi (açma eşiği 3,5)' }),
        A('Q11', 'a', 'b', { ad: 'Depo aydınlatması ayırıcısı' }), A('Q12', 'a', 'c', { ad: 'Kapı motoru ayırıcısı' }),
        A('Q13', 'a', 'f', { kapali: true, ad: 'Forklift şarj ünitesi ayırıcısı' }), A('Q14', 'a', 'o', { kapali: true, ad: 'Ofis prizleri ayırıcısı' }),
        { id: 'Y1', t: 'yuk', dugum: 'b', ad: 'Depo aydınlatması', d: 1, w: 1 },
        { id: 'Y2', t: 'yuk', dugum: 'c', ad: 'Kapı motoru', d: 1, w: 1 },
        { id: 'Y3', t: 'yuk', dugum: 'f', ad: 'Forklift şarj ünitesi', d: 2, w: 1, zorunlu: false },
        { id: 'Y4', t: 'yuk', dugum: 'o', ad: 'Ofis prizleri', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'Q11', 'Q12', 'Q13', 'Q14', 'Y1', 'Y2', 'Y3', 'Y4'], essential: ['noAyiriciKurali', 'noProtection'],
  },
  // ---------------------------------------------------------------- Bölüm 1 (AG şebeke, RMU)
  bes_kural: {
    ch: 1, W: 6, D: 6, MAXH: 3, minPar: 8, maxPar: 16, work: true, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: {}, a: {}, n: {}, y: {} }, kilit: 1, is: { bolge: ['n'], ad: 'Pano bara bağlantısını sık' },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'Mahalle trafosu AG çıkışı' },
        K('Q01', 'g', 'a', { kapali: true, ad: 'Fider kesicisi (sokak dağıtım kutusu)' }),
        A('Q11', 'a', 'n', { kapali: true, ad: 'Pano bara ayırıcısı' }),
        { id: 'B1', t: 'bara', dugum: 'n', r: 1, ad: 'Pano açık barası' },
        { id: 'Q81', t: 'toprak', dugum: 'n', ad: 'Pano bara topraklama ayırıcısı' },
        { id: 'W1', t: 'kablo', a: 'n', b: 'y', ad: 'Besleme kablosu' },
        { id: 'Y1', t: 'yuk', dugum: 'y', ad: 'Fırın', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'Q11', 'B1', 'Q81', 'Y1'], essential: ['noZones', 'noLoto', 'noAyiriciKurali'],
  },
  // eski seçici kafaları (Trafo-2 tarafı) -> iki transfer ayırıcısı: Q12 sanayi, Q13 fırın fideri Trafo-2 barasına
  secicilik: {
    ch: 1, W: 6, D: 6, MAXH: 3, minPar: 10, maxPar: 24, sinif: 'cekirdek', saha: 'asma_kat',
    base: {
      dugum: { g1: {}, bus: {}, h: {}, fr: {}, sn: {}, g2: {}, m: {} }, yedek: 1,
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g1', ad: 'Trafo-1 AG' }, { id: 'G2', t: 'kaynak', dugum: 'g2', grup: 2, ad: 'Trafo-2 AG (başka OG fideri, senkron değil)' },
        K('Q01', 'g1', 'bus', { I: 4, kademe: 2, kapali: true, ad: 'Trafo-1 giriş kesicisi (açma eşiği 4)' }),
        { id: 'F1', t: 'sigorta', a: 'bus', b: 'h', I: 3, kademe: 0, ad: 'Hastane NH sigortası (eşik 3)' },
        { id: 'F2', t: 'sigorta', a: 'bus', b: 'fr', I: 2, kademe: 0, saglam: false, ad: 'Fırın NH sigortası (eşik 2, ERİMİŞ)' },
        K('Q02', 'bus', 'sn', { I: 4, kademe: 1, ad: 'Sanayi fider kesicisi (eşik 4)' }),
        K('Q05', 'g2', 'm', { I: 5, kademe: 2, kapali: true, ad: 'Trafo-2 giriş kesicisi (eşik 5)' }),
        A('Q12', 'm', 'sn', { ad: 'Sanayi fideri Trafo-2 transfer ayırıcısı' }),
        A('Q13', 'm', 'fr', { ad: 'Fırın fideri Trafo-2 transfer ayırıcısı' }),
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane', d: 2, w: 3 },
        { id: 'Y2', t: 'yuk', dugum: 'fr', ad: 'Fırın', d: 1, w: 1 },
        { id: 'Y3', t: 'yuk', dugum: 'sn', ad: 'Sanayi', d: 3, w: 1 },
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'F1', 'F2', 'Q02', 'Q05', 'Q12', 'Q13', 'Y1', 'Y2', 'Y3'], essential: ['noProtection', 'noAyiriciKurali'],
  },
  // eski seçici kafaları (ring uçları) -> ring normalde açık noktası yük ayırıcıları
  ariza_ayirma: {
    ch: 1, W: 6, D: 6, MAXH: 3, minPar: 10, maxPar: 24, sinif: 'cekirdek', saha: 'kanal',
    base: {
      dugum: { g1: OG, r1: OG, r2: OG, x: OG, r3: OG, r4: OG, g2: OG },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g1', ad: 'OG ring fideri A' }, { id: 'G2', t: 'kaynak', dugum: 'g2', ad: 'OG ring fideri B' },
        K('Q01', 'g1', 'r1', { kademe: 2, ad: 'Fider A kesicisi (arızada açtı)' }), { id: 'W1', t: 'kablo', a: 'r1', b: 'r2', ad: 'Ring kablosu A' },
        { id: 'Y1', t: 'yuk', dugum: 'r2', ad: 'Okul trafo merkezi', d: 1, w: 1 },
        { id: 'QL2', t: 'yuk_ayirici', a: 'r2', b: 'x', kapali: true, ad: 'RMU-2 kablo yük ayırıcısı' },
        { id: 'XF', t: 'ariza', dugum: 'x', ad: 'Arızalı kablo eki' },
        { id: 'QL3', t: 'yuk_ayirici', a: 'x', b: 'r3', kapali: true, ad: 'RMU-3 kablo yük ayırıcısı' },
        { id: 'Y2', t: 'yuk', dugum: 'r3', ad: 'Hastane trafo merkezi', d: 2, w: 3 },
        { id: 'QL4', t: 'yuk_ayirici', a: 'r3', b: 'r4', ad: 'RMU-3 ring yük ayırıcısı (normalde açık nokta)' },
        { id: 'QL5', t: 'yuk_ayirici', a: 'r2', b: 'r4', ad: 'RMU-2 yedek ring yük ayırıcısı (normalde açık)' },
        { id: 'Y3', t: 'yuk', dugum: 'r4', ad: 'Fırın trafo merkezi', d: 1, w: 1 },
        K('Q02', 'g2', 'r4', { kademe: 2, kapali: true, ad: 'Fider B kesicisi' }),
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'Y1', 'QL2', 'XF', 'QL3', 'Y2', 'QL4', 'QL5', 'Y3', 'Q02'], essential: ['noProtection', 'noAyiriciKurali'],
  },
  // ---------------------------------------------------------------- Bölüm 2 (Trafo merkezi 34,5/0,4 kV)
  // T1 kanıt seviyesinin şeması: OG hücre galerisi + kilitlemeli bara hücresi kapısı, AG avlusu, AG kuplajı (çekmeli)
  geri_besleme_k: {
    ch: 2, W: 7, D: 7, MAXH: 3, minPar: 18, maxPar: 40, work: true, hard: true, sinif: 'zor', saha: 'galeri',
    base: {
      dugum: { o1: OG, x1: OG, b1: OG, o2: OG, x2: OG, y2: OG, t1: {}, t2: {}, ag: {}, r2: {}, sc: {} }, kilit: 2,
      is: { bolge: ['b1'], ad: 'TR1 OG barası mesnet izolatörü değişimi' },
      hedef: { gerilimli: ['b1'], kapali: ['Q01', 'Q91', 'Q03', 'Q04', 'Q02', 'Q92', 'Q05'], acik: ['Q0K'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1 (34,5 kV)' }, { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2 (34,5 kV)' },
        K('Q01', 'o1', 'x1', { kapali: true, ad: 'TR1 OG kesicisi' }), A('Q91', 'x1', 'b1', { kapali: true, ad: 'TR1 OG hat ayırıcısı' }),
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' }, { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG bara topraklama ayırıcısı' },
        { id: 'K1', t: 'kapi', toprak: 'Q81', ad: 'TR1 OG bara hücresi kapısı — Q81 kilitlemeli' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV Dyn11' },
        K('Q03', 't1', 'ag', { kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (çekmeli ACB)' }),
        K('Q02', 'o2', 'x2', { kapali: true, ad: 'TR2 OG kesicisi' }), A('Q92', 'x2', 'y2', { kapali: true, ad: 'TR2 OG hat ayırıcısı' }),
        { id: 'T2', t: 'trafo', a: 'y2', b: 't2', ad: 'TR2 34,5/0,4 kV Dyn11' },
        K('Q04', 't2', 'r2', { I: 3.5, kapali: true, ad: 'TR2 AG kesicisi (açma eşiği 3,5)' }),
        K('Q0K', 'ag', 'r2', { cekmeli: true, ad: 'AG bara kuplaj kesicisi (çekmeli, normalde açık)' }),
        { id: 'Y1', t: 'yuk', dugum: 'ag', ad: 'Hastane', d: 2, w: 3 },
        K('Q05', 'r2', 'sc', { kapali: true, ad: 'Okul fider kesicisi' }), { id: 'Y2', t: 'yuk', dugum: 'sc', ad: 'Okul', d: 2, w: 1 },
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'Q91', 'B1', 'Q81', 'T1', 'Q03', 'Q02', 'Q92', 'T2', 'Q04', 'Q0K', 'Y1', 'Q05', 'Y2'],
    essential: ['noAyiriciKurali', 'noLoto', 'noBackfeed', 'noProtection:kesinti'],
  },
  // eski seçici kafaları (hastane fideri bara seçimi) -> hastane fideri AG bara seçici ayırıcıları Q11/Q12
  usta_merkez: {
    ch: 2, W: 7, D: 7, MAXH: 3, minPar: 18, maxPar: 50, work: true, hard: true, sinif: 'zor', saha: 'galeri',
    base: {
      dugum: { o1: OG, x1: OG, b1: OG, o2: OG, y2: OG, t1: {}, t2: {}, a1: {}, a2: {}, h: {}, c1: {} },
      kilit: 3, is: { bolge: ['b1'], ad: 'TR1 OG barası bakımı' }, hedef: { yukler: ['Y1', 'Y2'], gerilimli: ['b1'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'o1', ad: 'OG fider 1' }, { id: 'G2', t: 'kaynak', dugum: 'o2', ad: 'OG fider 2' },
        K('Q01', 'o1', 'x1', { kapali: true, ad: 'TR1 OG kesicisi' }), A('Q91', 'x1', 'b1', { kapali: true, ad: 'TR1 OG hat ayırıcısı' }),
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'TR1 OG barası' }, { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'TR1 OG topraklama ayırıcısı' },
        { id: 'T1', t: 'trafo', a: 'b1', b: 't1', ad: 'TR1 34,5/0,4 kV' }, { id: 'T2', t: 'trafo', a: 'y2', b: 't2', ad: 'TR2 34,5/0,4 kV' },
        K('Q03', 't1', 'a1', { I: 4, kademe: 1, kapali: true, cekmeli: true, ad: 'TR1 AG kesicisi (eşik 4)' }),
        K('Q02', 'o2', 'y2', { kapali: true, ad: 'TR2 OG kesicisi' }),
        K('Q04', 't2', 'a2', { I: 4, kademe: 1, kapali: true, cekmeli: true, ad: 'TR2 AG kesicisi (eşik 4)' }),
        K('Q0K', 'a1', 'a2', { cekmeli: true, ad: 'AG bara kuplaj kesicisi' }),
        A('Q11', 'a1', 'h', { kapali: true, ad: 'Hastane fideri AG Bara-1 seçici ayırıcısı' }), A('Q12', 'a2', 'h', { ad: 'Hastane fideri AG Bara-2 seçici ayırıcısı' }),
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane', d: 2, w: 3 }, { id: 'Y2', t: 'yuk', dugum: 'a2', ad: 'Fırın', d: 1, w: 1 },
        K('QC1', 'a1', 'c1', { kapali: true, ad: 'Kompanzasyon kademe kesicisi' }), { id: 'C1', t: 'kondansator', dugum: 'c1', q: 1, r: 1, ad: 'Kondansatör bataryası' },
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'Q91', 'B1', 'Q81', 'T1', 'T2', 'Q03', 'Q02', 'Q04', 'Q0K', 'Q11', 'Q12', 'Y1', 'Y2', 'QC1', 'C1'],
    essential: ['noBackfeed', 'noLoto', 'noAyiriciKurali'],
  },
  // ---------------------------------------------------------------- Bölüm 3 (Fabrika: motor kontrol, kompanzasyon)
  // eski seçici kafaları -> kumanda devresi MCB'si (k0-k1) ve aydınlatma ayırıcısı (lx-lmp)
  muhurleme: {
    ch: 3, W: 6, D: 6, MAXH: 3, minPar: 6, maxPar: 18, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: {}, m: {}, mot: {}, k0: { kv: 0.23 }, k1: { kv: 0.23 }, k2: { kv: 0.23 }, coil: { kv: 0.23 }, lx: {}, lmp: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'Pano beslemesi' },
        K('Q01', 'g', 'm', { ad: 'Pano ana kesicisi' }),
        { id: 'T1', t: 'trafo', a: 'm', b: 'k0', ad: 'Kumanda trafosu 400/230 V' },
        K('Q09', 'k0', 'k1', { I: 2, ad: 'Kumanda devresi MCB (açma eşiği 2)' }),
        { id: 'S0', t: 'buton', a: 'k1', b: 'k2', nc: true, ad: 'STOP (NK)' },
        { id: 'S1', t: 'buton', a: 'k2', b: 'coil', ad: 'START (NA)' },
        { id: 'K1', t: 'kontaktor', a: 'm', b: 'mot', bobin: 'coil', ad: 'Pompa kontaktörü (AC-3)' },
        { id: 'K1A', t: 'yardimci', a: 'k2', b: 'coil', ait: 'K1', ad: 'Mühürleme kontağı (NA 13-14)' },
        { id: 'Y1', t: 'yuk', dugum: 'mot', ad: 'Su pompası', d: 1, w: 2 },
        K('Q02', 'm', 'lx', { ad: 'Aydınlatma fider kesicisi' }),
        A('Q12', 'lx', 'lmp', { ad: 'Pompa istasyonu aydınlatma ayırıcısı' }),
        { id: 'Y2', t: 'yuk', dugum: 'lmp', ad: 'Pompa istasyonu aydınlatması', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'T1', 'Q09', 'S0', 'S1', 'K1', 'Y1', 'Q02', 'Q12', 'Y2'], essential: ['noAyiriciKurali'],
  },
  // eski seçici kafaları -> kompanzasyon panosu giriş ayırıcısı (bus-k1)
  kademe_k: {
    ch: 3, W: 6, D: 6, MAXH: 3, minPar: 10, maxPar: 30, sinif: 'cekirdek', saha: 'asma_kat',
    base: {
      dugum: { g: {}, bus: {}, m1: {}, m2: {}, c1: {}, k1: {}, c2: {}, c3: {} },
      hedef: { yukler: ['Y1', 'Y2', 'Y3'], cosphi: { dugum: 'bus', ind: 200, kap: 150 } },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'Fabrika trafosu AG' },
        K('Q01', 'g', 'bus', { I: 20, kapali: true, ad: 'Ana kesici (eşik 20)' }),
        { id: 'Y3', t: 'yuk', dugum: 'bus', ad: 'Atölye aydınlatması', d: 1, p: 2, q: 0, w: 1 },
        K('Q02', 'bus', 'm1', { kapali: true, ad: 'Kompresör motor fideri' }), { id: 'Y1', t: 'yuk', dugum: 'm1', ad: 'Kompresör motoru', d: 1, p: 4, q: 3, w: 1 },
        K('Q03', 'bus', 'm2', { ad: 'Konveyör motor fideri' }), { id: 'Y2', t: 'yuk', dugum: 'm2', ad: 'Konveyör motoru', d: 1, p: 4, q: 4, w: 1 },
        A('Q10', 'bus', 'k1', { ad: 'Kompanzasyon panosu giriş ayırıcısı' }),
        K('QC1', 'k1', 'c1', { kapali: true, ad: 'Kademe-1 kondansatör kontaktörü (NH sigortalı)' }), { id: 'C1', t: 'kondansator', dugum: 'c1', q: 3, r: 1, ad: 'Kademe-1 (3 kVAr birimi)' },
        K('QC2', 'bus', 'c2', { ad: 'Kademe-2 kondansatör kontaktörü' }), { id: 'C2', t: 'kondansator', dugum: 'c2', q: 2, r: 1, sarj: 3, ad: 'Kademe-2 (2 birim, yeni ayrıldı: yüklü)' },
        K('QC3', 'bus', 'c3', { ad: 'Kademe-3 kondansatör kontaktörü' }), { id: 'C3', t: 'kondansator', dugum: 'c3', q: 1, r: 1, ad: 'Kademe-3 (1 birim)' },
      ],
    },
    cells: ['G1', 'Q01', 'Q02', 'Y1', 'Q03', 'Y2', 'Q10', 'QC1', 'C1', 'QC2', 'C2', 'QC3', 'C3'], essential: ['noCapLock', 'noAyiriciKurali'],
  },
  // ---------------------------------------------------------------- Bölüm 5 (34,5 kV dağıtım merkezi, çift bara)
  cift_bara: {
    ch: 5, W: 6, D: 6, MAXH: 3, minPar: 18, maxPar: 50, work: true, hard: true, sinif: 'zor', saha: 'galeri',
    base: {
      dugum: { g1: OG, b1: OG, g2: OG, b2: OG, f: OG, h: OG }, kilit: 3, is: { bolge: ['b1'], ad: 'Bara A mesnet izolatörlerinin temizliği' },
      hedef: { gerilimli: ['b1'], kapali: ['Q01', 'Q02', 'Q11', 'Q03'], acik: ['Q12', 'Q0K'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g1', ad: 'Giriş fideri 1 (TEİAŞ TM-1)' }, { id: 'G2', t: 'kaynak', dugum: 'g2', ad: 'Giriş fideri 2 (TEİAŞ TM-1)' },
        K('Q01', 'g1', 'b1', { kapali: true, cekmeli: true, ad: 'Bara A giriş kesicisi' }),
        K('Q02', 'g2', 'b2', { kapali: true, cekmeli: true, ad: 'Bara B giriş kesicisi' }),
        K('Q0K', 'b1', 'b2', { cekmeli: true, ad: 'Bara kuplaj kesicisi' }),
        A('Q11', 'b1', 'f', { kapali: true, ad: 'Hastane fideri Bara A ayırıcısı' }), A('Q12', 'b2', 'f', { ad: 'Hastane fideri Bara B ayırıcısı' }),
        K('Q03', 'f', 'h', { kapali: true, ad: 'Hastane fider kesicisi' }),
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'Bara A' }, { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'Bara A topraklama ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane trafo merkezi', d: 2, w: 3 }, { id: 'Y2', t: 'yuk', dugum: 'b2', ad: 'Okul trafo merkezi', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'Q02', 'Q0K', 'Q11', 'Q12', 'Q03', 'B1', 'Q81', 'Y1', 'Y2'], essential: ['noAyiriciKurali:kesinti', 'noLoto', 'noZones'],
  },
  // eski seçici kafaları (hastane + okul fideri bara seçimi) -> iki fiderin Bara A / Bara B seçici ayırıcıları
  cift_bara_iki_fider: {
    ch: 5, W: 7, D: 7, MAXH: 3, minPar: 16, maxPar: 50, work: true, hard: true, sinif: 'zor', saha: 'galeri',
    base: {
      dugum: { g1: OG, b1: OG, g2: OG, b2: OG, h: OG, o: OG }, kilit: 3, is: { bolge: ['b1'], ad: 'Bara A bakımı' },
      hedef: { gerilimli: ['b1'], kapali: ['Q01', 'Q02', 'Q11', 'Q14'], acik: ['Q0K', 'Q12', 'Q13'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g1', ad: 'Giriş fideri 1' }, { id: 'G2', t: 'kaynak', dugum: 'g2', ad: 'Giriş fideri 2' },
        K('Q01', 'g1', 'b1', { kapali: true, cekmeli: true, ad: 'Bara A giriş kesicisi' }),
        K('Q02', 'g2', 'b2', { kapali: true, cekmeli: true, ad: 'Bara B giriş kesicisi' }),
        K('Q0K', 'b1', 'b2', { cekmeli: true, ad: 'Bara kuplaj kesicisi' }),
        A('Q11', 'b1', 'h', { kapali: true, ad: 'Hastane fideri Bara A seçici ayırıcısı' }), A('Q12', 'b2', 'h', { ad: 'Hastane fideri Bara B seçici ayırıcısı' }),
        A('Q13', 'b1', 'o', { ad: 'Okul fideri Bara A seçici ayırıcısı' }), A('Q14', 'b2', 'o', { kapali: true, ad: 'Okul fideri Bara B seçici ayırıcısı' }),
        { id: 'B1', t: 'bara', dugum: 'b1', r: 1, ad: 'Bara A' }, { id: 'Q81', t: 'toprak', dugum: 'b1', ad: 'Bara A topraklama ayırıcısı' },
        { id: 'Y1', t: 'yuk', dugum: 'h', ad: 'Hastane trafo merkezi', d: 2, w: 3 }, { id: 'Y2', t: 'yuk', dugum: 'o', ad: 'Okul trafo merkezi', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'G2', 'Q01', 'Q02', 'Q0K', 'Q11', 'Q12', 'Q13', 'Q14', 'B1', 'Q81', 'Y1', 'Y2'], essential: ['noAyiriciKurali', 'noLoto'],
  },
};
