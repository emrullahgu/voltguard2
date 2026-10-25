/* VoltSim · ups ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.ups, Node'da require() ile kullanılır; testleri tools/tests/voltsim-ups.test.cjs.
 * İçerik: UPS bypass durum makinesi (statik ve bakım bypass, kilitlemeler), akü sıcaklık/yaşlanma katsayıları,
 * akü boyutlandırma, jeneratör adım yük kabulü (ISO 8528-5 sınıfları bilgi amaçlı) ve "black start" test planı. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.ups = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  /* ---------------------------------------------------------------- bypass durum makinesi
   * Anahtarlar: Q2 UPS çıkış ayırıcısı, Q3 bakım bypass anahtarı, SS statik transfer anahtarı ('inv' | 'byp').
   * Kurallar:
   *  1) İnverter, bypass kaynağıyla yalnız senkronken statik anahtar üzerinden kesintisiz (make-before-break) aktarılır.
   *  2) Senkron değilse elle aktarma REDDEDİLİR (aksi hâlde senkronsuz iki kaynak paralel olur ya da yük kesilir).
   *  3) Bakım bypass (Q3) yalnız yük statik bypass üzerindeyken kapatılabilir (aynı kaynak: paralel güvenli).
   *  4) Q2 yalnız Q3 kapalıyken açılabilir; Q3 yalnız Q2 kapalı ve statik bypass etkinken açılabilir.
   *  5) Q3 kapalı ve SS = 'inv' ve Q2 kapalı: inverter ile ham bypass paralel → assertSafe hata fırlatır. */
  const BYPASS_INIT = { SS: 'inv', Q2: true, Q3: false };
  function assertSafe(st) {
    if (st.Q3 && st.Q2 && st.SS === 'inv') throw new Error('Kilitleme ihlali: inverter çıkışı bakım bypass ile paralel (senkronsuz kaynak paralelliği)');
    return st;
  }
  /** Yükü besleyen yol: 'inv' | 'static' | 'maint' | null. cond = { bypassOK, invOK }. */
  function loadPath(st, cond) {
    if (st.Q3) return cond.bypassOK ? 'maint' : null;
    if (!st.Q2) return null;
    if (st.SS === 'inv') return cond.invOK ? 'inv' : null;
    return cond.bypassOK ? 'static' : null;
  }
  /** Komut uygular. cmd: toStatic | toInverter | closeQ3 | openQ2 | closeQ2 | openQ3.
   * cond = { bypassOK, sync, invOK }. Dönüş: { ok, st, msg } — reddedilirse st değişmez. */
  function bypassCommand(st, cmd, cond) {
    const s = Object.assign({}, st);
    const no = msg => ({ ok: false, st: st, msg: msg });
    switch (cmd) {
      case 'toStatic':
        if (s.SS === 'byp') return no('Yük zaten statik bypass üzerinde.');
        if (!cond.bypassOK) return no('Bypass kaynağı yok: aktarma yapılamaz.');
        if (!cond.sync) return no('Bypass senkron değil: kesintisiz aktarma yapılamaz, aktarma reddedildi.');
        s.SS = 'byp'; break;
      case 'toInverter':
        if (s.SS === 'inv') return no('Yük zaten inverter üzerinde.');
        if (s.Q3) return no('Önce bakım bypass (Q3) açılmalı.');
        if (!s.Q2) return no('Q2 açık: önce UPS çıkışı devreye alınmalı.');
        if (!cond.invOK) return no('İnverter hazır değil.');
        if (!cond.sync) return no('İnverter bypass ile senkron değil: geri aktarma reddedildi.');
        s.SS = 'inv'; break;
      case 'closeQ3':
        if (s.Q3) return no('Q3 zaten kapalı.');
        if (s.SS !== 'byp' || !s.Q2) return no('Q3 yalnız yük statik bypass üzerindeyken kapatılabilir (inverterle paralel olmamalı).');
        if (!cond.bypassOK) return no('Bypass kaynağı yok.');
        s.Q3 = true; break;
      case 'openQ2':
        if (!s.Q2) return no('Q2 zaten açık.');
        if (!s.Q3) return no('Q3 kapalı değil: Q2 açılırsa kritik yük kesilir, işlem reddedildi.');
        s.Q2 = false; break;
      case 'closeQ2':
        if (s.Q2) return no('Q2 zaten kapalı.');
        if (s.SS !== 'byp') return no('Q2 kapatılmadan önce statik anahtar bypass konumunda olmalı.');
        s.Q2 = true; break;
      case 'openQ3':
        if (!s.Q3) return no('Q3 zaten açık.');
        if (!s.Q2 || s.SS !== 'byp') return no('Q3 yalnız Q2 kapalı ve statik bypass etkinken açılabilir (aksi hâlde yük kesilir).');
        s.Q3 = false; break;
      default: return no('Bilinmeyen komut.');
    }
    assertSafe(s);
    return { ok: true, st: s, msg: '' };
  }
  /** İnverter arızası / aşırı yük: statik anahtar otomatik bypass’a geçer. Senkronsa kesintisiz, değilse kesintili. */
  function autoTransfer(st, cond) {
    if (st.SS === 'byp' || st.Q3) return { st: st, interrupted: false };
    if (!cond.bypassOK) return { st: st, interrupted: true };
    return { st: Object.assign({}, st, { SS: 'byp' }), interrupted: !cond.sync };
  }
  function modeName(st) { return st.Q3 ? (st.Q2 ? 'Bakım bypass (Q2 kapalı)' : 'Bakım bypass') : st.SS === 'byp' ? 'Statik bypass' : 'İnverter (normal)'; }

  /* ---------------------------------------------------------------- akü katsayıları
   * Sıcaklık: VRLA kapasitesi 25 °C altında ≈ %0,6/°C azalır, üstünde en çok %5 artar (kT = 1 + 0,006·(T − 25)).
   * Ömür: tasarım ömrü 20 °C için verilir; her +10 °C ömrü yarıya indirir (Arrhenius yaklaşımı).
   * Yaşlanma: kapasite ömür sonunda %80’e doğrusal düşer, en az 0,5. Değerler eğitim varsayımıdır; üretici verisi esastır. */
  function batteryDerating(o) {
    const T = o.T, kTemp = E.clamp(1 + 0.006 * (T - 25), 0.5, 1.05);
    const lifeEff = o.designLife / Math.pow(2, Math.max(0, T - 20) / 10);
    const kAge = Math.max(0.5, 1 - 0.2 * o.age / lifeEff);
    return { kTemp: kTemp, kAge: kAge, lifeEff: lifeEff, endOfLife: o.age >= lifeEff };
  }
  /** Akü boyutlandırma: hedef süre için gereken Ah (sabit güç; engine ups.runtime ile aynı bağıntı) ve listeden seçim. */
  function batterySizing(o) {
    const Pdc = o.P_kW * 1000 / o.etaInv;                       // W
    const Wh = Pdc * o.minutes / 60;
    const V = o.nBlocks * o.Vblock;
    const AhReq = Wh / (V * o.dod * o.kTemp * o.kAge);
    const list = (o.AhList || []).slice().sort((a, b) => a - b);
    let pick = null;
    for (let n = 1; n <= (o.maxStrings || 4) && !pick; n++) { const a = list.find(x => x * n >= AhReq); if (a) pick = { Ah: a, strings: n }; }
    return { Wh: Wh, V: V, AhReq: AhReq, pick: pick };
  }

  /* ---------------------------------------------------------------- jeneratör adım yük kabulü
   * ISO 8528-5 performans sınıfları G1–G3 frekans/gerilim sapma sınırlarını tanımlar; izin verilen yük adımı motorun
   * ortalama efektif basıncına ve üreticiye bağlıdır. Buradaki adım sınırları TEMSİLİ eğitim varsayımıdır:
   * G1 ≈ %60, G2 ≈ %45, G3 ≈ %33 (turbo dizel, ilk adım). */
  const STEP_LIMIT = { G1: 60, G2: 45, G3: 33 };
  function stepLoad(stepsKVA, genKVA, cls) {
    const lim = STEP_LIMIT[cls] || STEP_LIMIT.G2;
    let cum = 0;
    const steps = stepsKVA.map(k => { cum += k; const pct = k / genKVA * 100; return { kVA: k, pct: pct, cum: cum / genKVA * 100, ok: pct <= lim + 1e-9 }; });
    return { limit: lim, steps: steps, ok: steps.every(x => x.ok) && cum <= genKVA + 1e-9, maxPct: steps.reduce((m, x) => Math.max(m, x.pct), 0), totalPct: cum / genKVA * 100 };
  }
  /** Yük devreye alma planından adımlar: 'all' tek adım; 'two' UPS sonra diğer; 'three' UPS, diğer yarı, diğer yarı.
   * UPS doğrultucusu yumuşak girişle (walk-in) yüklense de güvenli tarafta tek adım sayılır. */
  function loadSteps(plan, upsKVA, otherKVA) {
    if (plan === 'two') return [upsKVA, otherKVA].filter(x => x > 0);
    if (plan === 'three') return [upsKVA, otherKVA / 2, otherKVA / 2].filter(x => x > 0);
    return [upsKVA + otherKVA];
  }

  /* ---------------------------------------------------------------- black start test planı */
  function blackStartPlan(o) {
    const steps = [
      ['Ön kontrol', 'Yakıt ≥ %' + o.minFuelPct + ' (' + Math.round(o.tank * o.minFuelPct / 100) + ' l), marş aküsü, soğutma suyu ve yağ seviyesi; UPS akü SOC tam, alarm yok.'],
      ['Yetki ve iletişim', 'Kritik yük sahiplerine bilgi; acil geri dönüş için şebeke kesicisi sorumlusu belirlenir.'],
      ['Şebeke kesintisi', 'AG giriş (şebeke) kesicisi açılarak gerçek kesinti oluşturulur; UPS akü moduna geçmeli, kritik yük kesilmemeli.'],
      ['Jeneratör yol alma', 'ATS ' + o.tConfirm + ' s onaydan sonra jeneratörü çalıştırır; gerilim/frekans ' + o.tGenReady + ' s içinde hazır olmalı.'],
      ['Aktarma', 'QM açık, ' + o.tDead + ' s ölü zaman, QG kapanır (mekanik kilit kontrolü).']
    ];
    o.steps.forEach((k, i) => steps.push(['Yük adımı ' + (i + 1), Math.round(k) + ' kVA (%' + Math.round(k / o.genKVA * 100) + ') devreye alınır; frekans ve gerilim toparlanması kaydedilir (ISO 8528-5 ' + o.cls + ').']));
    steps.push(['Ölçüm', 'En az 30 dk yükte: gerilim, frekans, yüklenme %' + Math.round(o.genPct) + ', egzoz/soğutma sıcaklığı, yakıt tüketimi.']);
    steps.push(['Şebekeye dönüş', 'Şebeke verilir; ' + o.tReturn + ' s kararlılık beklemesi, QG açık → ölü zaman → QM kapalı; jeneratör ' + o.tCool + ' s yüksüz soğur.']);
    steps.push(['Rapor', 'Süreler, kesinti olup olmadığı, akü SOC düşümü ve anormallikler test tutanağına yazılır.']);
    return steps.map((x, i) => ({ n: i + 1, title: x[0], detail: x[1] }));
  }

  /* ---------------------------------------------------------------- modüler / paralel UPS
   * Güç modülleri ortak DC/AC çıkışta yükü eşit paylaşır (eşit paylaşım varsayımı). Bir modülün kVA ve kW sınırı:
   * modKVA ve modKVA·pf. N = yükü taşımak için gereken en az modül; N+1 = bir modül arızasında yük yine taşınır.
   * o: { nMod, modKVA, pf, Scrit (kVA), Pcrit (kW), failed, redundancy: 'N' | 'N+1' } */
  function upsModular(o) {
    const capS = o.modKVA, capP = o.modKVA * o.pf;
    const N = Math.max(1, Math.ceil(Math.max(o.Scrit / capS, o.Pcrit / capP) - 1e-9));
    const active = Math.max(0, o.nMod - (o.failed || 0));
    const pct = n => (n > 0 ? Math.max(o.Scrit / (n * capS), o.Pcrit / (n * capP)) * 100 : Infinity);
    const need = N + (o.redundancy === 'N+1' ? 1 : 0);
    return { N: N, need: need, active: active, activeKVA: active * o.modKVA, totalKVA: o.nMod * o.modKVA,
      perModPct: pct(active), afterLossPct: pct(active - 1), carries: active >= N, survivesOne: active - 1 >= N,
      configOK: o.nMod >= need, spare: o.nMod - N };
  }

  /* ---------------------------------------------------------------- paralel jeneratörler
   * Eş setler senkron bara üzerinde yükü eşit paylaşır (kW ve kVAr paylaşımı ideal kabul). Özgül yakıt tüketimi
   * yükten bağımsız sabit alınır (gerçekte düşük yükte l/kWh artar). tankPerSet: her setin kaide deposu (l).
   * o: { nGen, genKVA, loadKVA, loadKW, fuel (l/kWh), tankPerSet } */
  function genParallel(o) {
    // setler kVA'da cosφ 0,8 ile anmalıdır (ISO 8528-1): kW sınırı 0,8·kVA; yüklenme kVA ve kW oranlarının büyüğüdür
    const n = Math.max(1, o.nGen), total = n * o.genKVA;
    const per = sets => Math.max(o.loadKVA / (sets * o.genKVA), (o.loadKW || 0) / (sets * o.genKVA * 0.8));
    const Nreq = Math.max(1, Math.ceil(per(1) - 1e-9));
    const perSetKW = o.loadKW / n, fuelPerSet = perSetKW * o.fuel;
    return { n: n, totalKVA: total, perSetPct: per(n) * 100, Nreq: Nreq, n1: n - 1 >= Nreq,
      afterLossPct: n > 1 ? per(n - 1) * 100 : Infinity,
      perSetKW: perSetKW, fuelPerSet: fuelPerSet, fuelTotal: fuelPerSet * n, hours: fuelPerSet > 0 ? o.tankPerSet / fuelPerSet : Infinity };
  }
  /** Senkronizasyon kontrolü (ANSI 25 benzeri izin). Sınırlar TEMSİLİDİR: ΔU ≤ %5, Δf ≤ 0,2 Hz, Δφ ≤ 10°.
   * d = { dU (%), df (Hz), dphi (°) } → { ok, reasons[] } */
  const SYNC_LIMIT = { dU: 5, df: 0.2, dphi: 10 };
  function syncCheck(d, lim) {
    lim = lim || SYNC_LIMIT;
    const reasons = [];
    if (Math.abs(d.dU) > lim.dU) reasons.push('ΔU %' + Math.abs(d.dU) + ' > %' + lim.dU);
    if (Math.abs(d.df) > lim.df) reasons.push('Δf ' + Math.abs(d.df) + ' Hz > ' + lim.df + ' Hz');
    if (Math.abs(d.dphi) > lim.dphi) reasons.push('Δφ ' + Math.abs(d.dphi) + '° > ' + lim.dphi + '°');
    return { ok: reasons.length === 0, reasons: reasons };
  }
  /** Jeneratör kesicisini ortak baraya kapatma izni: ölü baraya ilk set serbest; canlı baraya yalnız senkronken.
   * Senkronsuz kaynakların paralellenmesi (ör. şebeke + jeneratör açık geçişli ATS’de) hiçbir durumda izinli değildir. */
  function canCloseGen(busLive, d) {
    if (!busLive) return { ok: true, msg: 'Ölü bara: ilk set doğrudan kapatılır.' };
    const c = syncCheck(d);
    return c.ok ? { ok: true, msg: 'Senkron: paralel bağlama izinli.' } : { ok: false, msg: 'Senkron değil (' + c.reasons.join(', ') + '): kapama engellendi.' };
  }

  return { BYPASS_INIT: BYPASS_INIT, assertSafe: assertSafe, loadPath: loadPath, bypassCommand: bypassCommand, autoTransfer: autoTransfer, modeName: modeName,
    batteryDerating: batteryDerating, batterySizing: batterySizing, STEP_LIMIT: STEP_LIMIT, stepLoad: stepLoad, loadSteps: loadSteps, blackStartPlan: blackStartPlan,
    upsModular: upsModular, genParallel: genParallel, SYNC_LIMIT: SYNC_LIMIT, syncCheck: syncCheck, canCloseGen: canCloseGen };
});
