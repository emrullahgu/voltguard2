'use strict';
// ============================================================================
// PARALAKS: TEK HAT — templates/ch0.js : Bölüm 0 "Prolog: VoltGuard Deposu" (AG) şablonları (kural sürümü 4: FİZİKSEL DÜNYA)
// Sahip: Bölüm 0 seviye tasarımcısı. gen2.js bu dosyayı templates2.js'ten sonra yükler.
//   0.1 P1 İlk Manevra            -> templates2.js 'ilk_manevra' (kanıt seviyesi, değişmedi)
//   0.2 P2 Görünmeyen Yoktur      -> 'gorunmeyen_yok'  (fider bara ayırıcıları; UPS kesicisi yangın panelini de düşürür)
//   0.3 P3 Kesici mi, Ayırıcı mı? -> 'kesici_ayirici'  (dizel -> şebeke kesintili aktarma; ana pano giriş kesicisi)
//   0.4 P4 Depo Kapısı            -> 'depo_kapisi'     (çift bara, her yükte A/B bara seçici ayırıcısı, kuplaj, koruma eşiği)
// Kural sürümü 3'teki izdüşüm seçicisi (kafa) yok: kafa çiftleri sahada gerçek ayırıcıya çevrildi. Yayımlanan
// seviyelerin sahaları elle yazıldı (levels/ch0.js); bu şablonlar gen2 ile yeni saha denemeleri içindir:
//   node tools/reference2/gen2.js depo_kapisi 7 120 out.json
// I = AÇMA EŞİĞİ (birim akım). Yük talepleri d iş emri kartında yazılır. Bütün düğümler 0,4 kV (AG).
// Her elemanın 'ad' alanı oyuncuya gösterilen gerçek işlevidir (amaç kapısı A1).
// ============================================================================
const K = (id, a, b, o) => Object.assign({ id, t: 'kesici', a, b, I: 9 }, o || {});
const A = (id, a, b, o) => Object.assign({ id, t: 'ayirici', a, b }, o || {});

module.exports = {
  // 0.2 — Ayırıcı yük alamaz. Şarj ve aydınlatma fiderleri UPS barasına fider bara ayırıcılarıyla (Q21, Q31) bağlanır.
  // Ayırıcıyı kapatmadan önce ya fider kesicisi (Q02/Q03: yalnız o fider, zaten beslenmiyor) ya UPS çıkış kesicisi
  // (Q01: aynı baradaki yangın paneli de düşer) açılır. Kısa plan Kesinti öder; kesintisiz plan fider kesicilerine yürür.
  gorunmeyen_yok: {
    ch: 0, W: 7, D: 5, MAXH: 3, minPar: 5, maxPar: 14, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: {}, a: {}, b: {}, c: {}, y1: {}, y2: {} },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', ad: 'Depo UPS çıkışı' },
        K('Q01', 'g', 'a', { kapali: true, ad: 'UPS çıkış kesicisi' }),
        { id: 'Y3', t: 'yuk', dugum: 'a', ad: 'Yangın algılama paneli', d: 1, w: 2 },
        A('Q21', 'a', 'b', { ad: 'Şarj fideri bara ayırıcısı (asma kat)' }),
        K('Q02', 'b', 'y1', { kapali: true, ad: 'Şarj istasyonu fider kesicisi' }),
        A('Q31', 'a', 'c', { ad: 'Aydınlatma fideri bara ayırıcısı (asma kat)' }),
        K('Q03', 'c', 'y2', { kapali: true, ad: 'Raf aydınlatması fider kesicisi' }),
        { id: 'Y1', t: 'yuk', dugum: 'y1', ad: 'Forklift akü şarj istasyonu', d: 1, w: 1 },
        { id: 'Y2', t: 'yuk', dugum: 'y2', ad: 'Raf koridoru aydınlatması', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'Y3', 'Q21', 'Q31', 'Q02', 'Y1', 'Q03', 'Y2'], essential: ['noAyiriciKurali'],
  },
  // 0.3 — Ayırıcı yük akımı kesemez ve yük alamaz; kesici -> ayırıcı sırası. Gece boyu depoyu dizel taşıdı;
  // şebeke geri geldi. Dizelin senkron rölesi yok (grup 2): iki kaynak paralellenemez, aktarım "önce kes, sonra
  // bağla"dır. Ana pano giriş kesicisi (Q03) ayırıcıların yanında: kısa plan onu açıp ayırıcıları yüksüz değiştirir;
  // kısa karartma planı şebeke ayırıcısını önce yüksüz kapatır, karartma yalnız kaynak kesicileri arasında olur.
  // Normal konum: dizel tarafı görünür açıklıkla ayrılmış (Q01, Q11 açık), yük şebekeden (Q12, Q02 kapalı).
  kesici_ayirici: {
    ch: 0, W: 7, D: 5, MAXH: 3, minPar: 6, maxPar: 14, sinif: 'ogretici', saha: 'asma_kat',
    base: {
      dugum: { g: {}, a: {}, s: {}, b: {}, y: {}, p: {} },
      hedef: { kapali: ['Q02', 'Q12'], acik: ['Q01', 'Q11'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'g', grup: 2, acil: true, ad: 'Dizel jeneratör (senkron rölesi yok)' },
        { id: 'G2', t: 'kaynak', dugum: 's', ad: 'Şebeke beslemesi (geri geldi)' },
        K('Q01', 'g', 'a', { kapali: true, ad: 'Jeneratör çıkış kesicisi (avlu)' }),
        A('Q11', 'a', 'y', { kapali: true, ad: 'Jeneratör tarafı ayırıcısı (ana pano)' }),
        K('Q02', 's', 'b', { kapali: true, ad: 'Şebeke giriş kesicisi (avlu)' }),
        A('Q12', 'b', 'y', { ad: 'Şebeke tarafı ayırıcısı (ana pano)' }),
        K('Q03', 'y', 'p', { kapali: true, ad: 'Ana pano giriş kesicisi' }),
        { id: 'Y1', t: 'yuk', dugum: 'p', ad: 'Depo ana panosu (aydınlatma + kapı)', d: 2, w: 2 },
      ],
    },
    cells: ['Y1', 'Q03', 'Q11', 'Q12', 'G1', 'Q01', 'G2', 'Q02'], essential: ['noAyiriciKurali'],
  },
  // 0.4 — Bölüm sınavı (çekirdek). Kapı motoru ve aydınlatma UPS barasında (A); her yükün A ve B barasına giden
  // bara seçici ayırıcısı var. UPS (acil) son enerjisinde: yükler şebeke barasına (B) alınır, UPS görünür açıklıkla
  // ayrılır. Şebeke barasında bekçi kulübesi kalıcı olarak bağlı (B ölü barası ayırıcıyla yük alamaz) ve forklift
  // şarjı var; şebeke giriş kesicisi Q02 5,5'te açar (2+1+1+2 = 6): şarj ayrılmalı (noProtection esaslı).
  //   en az Hamle : UPS kesicisiyle yükleri düşür, seçici ayırıcıları gerilimsiz değiştir, şebekeden ver;
  //   en az Kesinti: kuplajı kapat (UPS baypası şebekeyle senkron, grup 1), yükleri önce-kapa-sonra-aç ile B'ye al,
  //                  şebekeyi kesiciyle paralel bağla, kuplajı aç (Sıfır Kesinti).
  depo_kapisi: {
    ch: 0, W: 8, D: 6, MAXH: 3, minPar: 12, maxPar: 26, sinif: 'cekirdek', saha: 'asma_kat', zeroKesinti: true,
    base: {
      dugum: { u: {}, w: {}, a: {}, s: {}, x: {}, b: {}, k: {}, f: {}, l: {} },
      hedef: { acik: ['Q01', 'Q11', 'Q0K', 'Q1A', 'Q2A'] },
      el: [
        { id: 'G1', t: 'kaynak', dugum: 'u', acil: true, ad: 'Depo UPS çıkışı (akü son %8)' },
        { id: 'G2', t: 'kaynak', dugum: 's', ad: 'Şebeke beslemesi' },
        K('Q01', 'u', 'w', { kapali: true, ad: 'UPS çıkış kesicisi (UPS odası)' }),
        A('Q11', 'w', 'a', { kapali: true, ad: 'UPS barası giriş ayırıcısı' }),
        A('Q91', 's', 'x', { ad: 'Şebeke hat ayırıcısı (giriş kutusu)' }),
        K('Q02', 'x', 'b', { I: 5.5, ad: 'Şebeke giriş kesicisi (açma eşiği 5,5)' }),
        K('Q0K', 'a', 'b', { ad: 'Bara kuplaj kesicisi (normalde açık)' }),
        A('Q1A', 'a', 'k', { kapali: true, ad: 'Kapı motoru A barası seçici ayırıcısı' }),
        A('Q1B', 'b', 'k', { ad: 'Kapı motoru B barası seçici ayırıcısı' }),
        A('Q2A', 'a', 'l', { kapali: true, ad: 'Aydınlatma A barası seçici ayırıcısı' }),
        A('Q2B', 'b', 'l', { ad: 'Aydınlatma B barası seçici ayırıcısı' }),
        K('Q03', 'b', 'f', { kapali: true, ad: 'Forklift şarj fideri kesicisi' }),
        { id: 'Y1', t: 'yuk', dugum: 'k', ad: 'Depo kapısı motoru', d: 2, w: 2 },
        { id: 'Y2', t: 'yuk', dugum: 'l', ad: 'Depo aydınlatması', d: 1, w: 1 },
        { id: 'Y3', t: 'yuk', dugum: 'f', ad: 'Forklift şarj ünitesi', d: 2, w: 1, zorunlu: false },
        { id: 'Y4', t: 'yuk', dugum: 'b', ad: 'Bekçi kulübesi ve güvenlik sistemi', d: 1, w: 1 },
      ],
    },
    cells: ['G1', 'Q01', 'G2', 'Q91', 'Q11', 'Q1A', 'Q2A', 'Q0K', 'Q1B', 'Q2B', 'Q02', 'Q03', 'Y1', 'Y2', 'Y3', 'Y4'],
    essential: ['noAyiriciKurali:kesinti', 'noProtection'],
  },
};
