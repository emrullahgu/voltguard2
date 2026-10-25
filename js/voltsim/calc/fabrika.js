/* VoltSim · Fabrika Senaryosu ortak hesap durumu (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.fabrika, Node'da require() ile kullanılır; testleri tools/tests/voltsim-fabrika.test.cjs.
 *
 * Tek senaryo verisi (tesis, OG besleme, trafo, ana dağıtım panosu, yük grupları, kompanzasyon) mevcut modül
 * motorlarına aynı sırayla verilir; hiçbir modülün hesabı burada yeniden yazılmaz:
 *   1. yükler            → yük P, Q ve harmonik akımları (E.pano.circuitFlow ile aynı güç üçgeni)
 *   2. kompanzasyon      → kademe seçimi ext.komp.controller, cosφ/harmonik/rezonans E.komp.compute
 *   3. ana dağıtım panosu → E.pano.compute (yükler + kondansatör bankası çıkışı, bara Ik3, Ib ≤ In ≤ Iz, ΔU, otomatik kesme)
 *   4. trafo             → E.trafo.compute (pano barasının P ve cosφ'si ile; kayıp, ısınma, gerilim değişimi)
 * Böylece pano, kompanzasyon ve trafo sonuçları aynı girdiden türetilir ve birbirini tutar.
 * Kapsam: eğitim ve ön değerlendirme modeli; gerçek zamanlı tesis verisi kullanmaz (canlı dijital ikiz değildir). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const E = node ? require('../engine.js') : root.VoltSimEngine;
  if (node) { E.ext = E.ext || {}; if (!E.ext.trafo) E.ext.trafo = require('./trafo.js'); if (!E.ext.komp) E.ext.komp = require('./komp.js'); }
  const api = factory(E);
  if (node) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.fabrika = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const SQRT3 = Math.sqrt(3);
  const SCHEMA = 1;
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = (v, d) => { v = Number(v); return isFinite(v) ? v : d; };
  const XT = () => E.ext.trafo, XK = () => E.ext.komp;

  /* ------------------------------------------------------------ katalog verileri */
  /** Yük tipleri: elektriksel davranış (motor mu, yol verme), tipik cosφ ve harmonik profili. Değerler örnektir. */
  const LOAD_TYPES = {
    motor: { label: 'Asenkron motor · doğrudan yol verme', motor: true, start: 'DOL', cos: 0.86, eff: 0.93, harm: 'none', vis: 'press' },
    vfd: { label: 'Sürücülü motor (VFD)', motor: true, start: 'VFD', cos: 0.95, eff: 0.93, harm: 'vfd6c', vis: 'pump' },
    compressor: { label: 'Kompresör (yıldız-üçgen)', motor: true, start: 'YD', cos: 0.87, eff: 0.94, harm: 'none', vis: 'compressor' },
    hvac: { label: 'Soğutma grubu (chiller)', motor: true, start: 'SOFT', cos: 0.88, eff: 0.94, harm: 'none', vis: 'chiller' },
    cnc: { label: 'CNC / servo sürücülü tezgâh', motor: false, cos: 0.9, eff: 1, harm: 'cnc', vis: 'cnc' },
    resistive: { label: 'Rezistif ısıtıcı / fırın', motor: false, cos: 1, eff: 1, harm: 'none', vis: 'furnace' },
    lighting: { label: 'LED aydınlatma', motor: false, cos: 0.95, eff: 1, harm: 'led', vis: 'lighting' }
  };
  /** Görünüm (3D model) seçenekleri; hesabı etkilemez. */
  const VISUALS = { press: 'Hidrolik pres', compressor: 'Vidalı kompresör', extruder: 'Ekstrüder', pump: 'Pompa grubu', cnc: 'İşleme merkezi', furnace: 'Isıl işlem fırını', lighting: 'Aydınlatma', chiller: 'Soğutma grubu', generic: 'Genel makine' };
  /** Harmonik akım profilleri (% yükün temel bileşen akımı). vfd6c/vfd6/vfd12 kompanzasyon modülündeki önayarlarla aynıdır.
   * led: IEC 61000-3-2 sınıf C (> 25 W aydınlatma) sınır değerleri — en kötü durum. cnc: tezgâh gücünün ~%70'i 6 darbeli
   * DC şoklu sürücüden (vfd6c × 0,7) varsayımı. */
  const HARM = {
    none: { label: 'Harmoniksiz (doğrusal yük)', h: {} },
    vfd6c: { label: '6 darbeli sürücü · DC şoklu', h: { 5: 33, 7: 11, 11: 7.5, 13: 5, 17: 3, 19: 2.5 } },
    vfd6: { label: '6 darbeli sürücü · şoksuz', h: { 5: 60, 7: 38, 11: 9, 13: 6, 17: 4, 19: 3 } },
    vfd12: { label: '12 darbeli sürücü', h: { 5: 3, 7: 2, 11: 8, 13: 5, 17: 1, 19: 1 } },
    cnc: { label: 'Servo/sürücülü tezgâh (6 darbeli × 0,7)', h: { 5: 23.1, 7: 7.7, 11: 5.25, 13: 3.5, 17: 2.1, 19: 1.75 } },
    led: { label: 'LED sürücü (IEC 61000-3-2 sınıf C sınırı)', h: { 5: 10, 7: 7, 11: 3, 13: 3, 17: 3, 19: 3 } }
  };
  const ORDERS = [5, 7, 11, 13, 17, 19];
  const MCCB_IN = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
  const ACB_IN = [630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000];
  const CABLES = E.CABLE_SIZES.filter(s => s <= 120); // pano motoru çıkış kesitini 120 mm²'ye kadar kabul eder; üstü paralel kabloyla
  const SHIFTS = { v1: 'Tek vardiya (08–17)', v2: 'İki vardiya (06–22)', v3: 'Üç vardiya (7/24)' };
  const COMP_MODES = { auto: 'Otomatik (reaktif güç rölesi)', manual: 'Elle kademe', off: 'Kapalı' };

  /* ------------------------------------------------------------ varsayılan senaryo */
  const L = (o) => Object.assign({ id: '', name: '', type: 'motor', vis: '', P_kW: 10, cos: 0.86, eff: 0.93, on: true, critical: false, L: 30, S: 10, par: 1, In: 32, harm: '' }, o);
  function defaults() {
    return {
      ui: { mode: 'guided' },
      facility: { name: 'Örnek Metal İşleme Tesisi', note: '', shift: 'v2', price: 3.5 },
      supply: { U1_kV: 34.5, SkQ_MVA: 500 },
      trafo: { Sr_kVA: 1000, P0: 690, Pk: 7600, uk: 6, U2_V: 400, ambient: 30 },
      board: { mainIn: 1600, mainIrF: 0.95, mainIcu_kA: 50, busbarIn: 2000, feedL: 12, feedS: 240, feedN: 4 },
      loads: [
        L({ id: 'pres', name: 'Pres hattı', type: 'motor', vis: 'press', P_kW: 90, cos: 0.86, eff: 0.94, critical: true, L: 60, S: 95, In: 200 }),
        L({ id: 'komp', name: 'Kompresör istasyonu', type: 'compressor', vis: 'compressor', P_kW: 110, cos: 0.87, eff: 0.95, critical: true, L: 45, S: 120, In: 250 }),
        L({ id: 'ekst', name: 'Ekstrüzyon hattı', type: 'vfd', vis: 'extruder', P_kW: 160, cos: 0.95, eff: 0.93, critical: true, L: 70, S: 95, par: 2, In: 320 }),
        L({ id: 'cnc', name: 'CNC atölyesi', type: 'cnc', vis: 'cnc', P_kW: 120, cos: 0.9, eff: 1, L: 80, S: 120, In: 250 }),
        L({ id: 'firin', name: 'Isıl işlem fırını', type: 'resistive', vis: 'furnace', P_kW: 150, cos: 1, eff: 1, on: false, L: 50, S: 120, In: 250 }),
        L({ id: 'isik', name: 'Hol aydınlatması', type: 'lighting', vis: 'lighting', P_kW: 40, cos: 0.95, eff: 1, critical: true, L: 90, S: 35, In: 80 }),
        L({ id: 'chiller', name: 'Proses soğutma grubu', type: 'hvac', vis: 'chiller', P_kW: 75, cos: 0.88, eff: 0.94, L: 40, S: 70, In: 160 }),
        L({ id: 'pompa', name: 'Soğutma suyu pompaları', type: 'vfd', vis: 'pump', P_kW: 45, cos: 0.95, eff: 0.93, critical: true, L: 55, S: 25, In: 100 })
      ],
      comp: { mode: 'auto', target: 0.99, detune: 7, steps: [25, 25, 50, 50, 100, 100], manual: [false, false, false, false, false, false], L: 6, S: 120, par: 3, In: 800 }
    };
  }

  /* ------------------------------------------------------------ yardımcılar */
  const typeOf = l => LOAD_TYPES[l.type] || LOAD_TYPES.motor;
  const harmOf = l => HARM[l.harm] || HARM[typeOf(l).harm] || HARM.none;
  /** Yükün çektiği elektriksel güç (kW): motorlarda P_kW mil gücüdür → P/η. */
  function elec(l) { return typeOf(l).motor ? num(l.P_kW, 0) / Math.max(0.3, num(l.eff, 1)) : num(l.P_kW, 0); }
  /** Tasarım akımı (A): yük açık olsun ya da olmasın çıkışın taşıması gereken akım. */
  function designI(l, U) { return elec(l) * 1e3 / (SQRT3 * U * Math.max(0.1, num(l.cos, 1))); }
  /** Yeni/yeniden boyutlandırılan çıkış için öneri: In ≥ Ib (MCCB), Iz ≥ In ve I2 ≤ 1,45·Iz (yöntem E), gerilim düşümü
   * motorda %2,7, diğerlerinde %1,3 (besleme kablosu için pay bırakılır); gerekirse paralel kablo. Öneridir; proje yerine geçmez. */
  function autoSize(l, U) {
    U = U || 400;
    const Ib = designI(l, U), motor = typeOf(l).motor, lim = motor ? 2.7 : 1.3;
    const In = MCCB_IN.find(x => x >= Ib) || MCCB_IN[MCCB_IN.length - 1];
    for (let par = 1; par <= 12; par++) {
      const S = CABLES.find(s => {
        const Iz = E.cableIz(s, 'E', 3, par);
        if (!(Iz >= In && 1.3 * In <= 1.45 * Iz)) return false;
        return E.pano.voltageDrop({ phase: '3F', L: num(l.L, 0), S: s, parallel: par, material: 'Cu', cos: Math.max(0.1, num(l.cos, 1)) }, Ib, U).pct <= lim;
      });
      if (S) return { In: In, S: S, par: par, Ib: Ib };
    }
    return { In: In, S: 120, par: 12, Ib: Ib };
  }
  /** Senaryonun hesaba giren kısmı (arayüz tercihi hariç). */
  function scenarioOf(s) { const o = clone(s); delete o.ui; return o; }
  /** Paylaşım için: tesis adı ve notu çıkarılır (özel bilgi varsayılan olarak bağlantıya konmaz). */
  function anonymize(s, keepName) {
    const o = scenarioOf(s);
    if (!keepName) o.facility.name = '';
    o.facility.note = '';
    return o;
  }

  /* ------------------------------------------------------------ 1–2: yükler ve kompanzasyon */
  /** Yük toplamları ve harmonik akımlar. Harmonik akımlar aritmetik toplanır (aynı faz açısı varsayımı: güvenli tarafta üst tahmin). */
  function loadSums(loads, U, frac) {
    const f = frac === undefined ? 1 : frac;
    let P = 0, Q = 0;
    const Ih = {}; ORDERS.forEach(h => { Ih[h] = 0; });
    loads.forEach(l => {
      if (!l.on) return;
      const Pel = elec(l) * f, cos = Math.max(0.1, num(l.cos, 1));
      P += Pel; Q += Pel * Math.tan(Math.acos(Math.min(1, cos)));
      const I = Pel * 1e3 / (SQRT3 * U * cos), h = harmOf(l).h;
      ORDERS.forEach(o => { Ih[o] += I * num(h[o], 0) / 100; });
    });
    const S = Math.hypot(P, Q);
    return { P: P, Q: Q, S: S, cos: S > 0 ? P / S : 1, Ih: Ih };
  }
  /** Kademe seçimi: otomatikte reaktif güç rölesi (ideal, kalıcı durum), elle seçimde kullanıcı kademeleri, kapalıda hiçbiri. */
  function stepSelection(comp, sums) {
    const steps = comp.steps.map(q => Math.max(0, num(q, 0)));
    if (comp.mode === 'off') return steps.map(() => false);
    if (comp.mode === 'manual') return steps.map((_, i) => !!(comp.manual || [])[i]);
    const Qneed = E.komp.requiredQc(sums.P, Math.max(0.3, sums.cos), num(comp.target, 0.95));
    return XK().controller({ steps: steps, shunt: [], Ql: sums.Q, Qneed: Qneed, Qcap: 0, program: 'optimal' }).capOn;
  }
  function kompInput(s, sums, on) {
    const U = num(s.trafo.U2_V, 400), harmonics = {};
    const I1 = sums.P > 0 ? sums.P * 1e3 / (SQRT3 * U * Math.max(0.3, sums.cos)) : 0;
    ORDERS.forEach(h => { harmonics[h] = I1 > 0 ? Math.min(100, sums.Ih[h] / I1 * 100) : 0; });
    return { U_LL: U, P_kW: sums.P, cos1: Math.max(0.3, Math.min(1, sums.cos)), cos2: num(s.comp.target, 0.95), Sr_kVA: s.trafo.Sr_kVA, uk: s.trafo.uk,
      detune: num(s.comp.detune, 0), steps: s.comp.steps, manual: on, harmonics: harmonics, installed_kVA: s.trafo.Sr_kVA };
  }

  /* ------------------------------------------------------------ 3: pano */
  const BANK = 'Kompanzasyon panosu';
  function panoInput(s, Qon) {
    const t = s.trafo, b = s.board;
    const circuits = s.loads.map(l => {
      const ty = typeOf(l);
      return { name: l.name, phase: '3F', P_kW: num(l.P_kW, 0), cos: num(l.cos, 1), eff: ty.motor ? num(l.eff, 1) : 1, motor: ty.motor, running: true, on: !!l.on, start: ty.start || 'DOL',
        kind: 'MCCB', In: num(l.In, 16), S: num(l.S, 2.5), parallel: Math.max(1, Math.round(num(l.par, 1))), L: num(l.L, 0), method: 'E', material: 'Cu' };
    });
    circuits.push({ name: BANK, phase: '3F', cap: true, P_kW: Qon, detune: num(s.comp.detune, 0), cos: 0.1, on: Qon > 0, kind: 'MCCB', In: num(s.comp.In, 160), S: num(s.comp.S, 50), parallel: Math.max(1, Math.round(num(s.comp.par, 1))), L: num(s.comp.L, 0), method: 'E', material: 'Cu' });
    return { U_LL: num(t.U2_V, 400), mainIn: b.mainIn, mainIrF: b.mainIrF, mainIiF: 10, busbarIn: b.busbarIn, mainIcu_kA: b.mainIcu_kA, source: 'grid',
      SkQ_MVA: s.supply.SkQ_MVA, trafo_kVA: t.Sr_kVA, trafo_uk: t.uk, trafo_Pk: t.Pk, feedL: b.feedL, feedS: b.feedS, feedN: b.feedN, circuits: circuits };
  }

  /* ------------------------------------------------------------ 4: trafo ve gerilim */
  /** IEC 60076-1 yaklaşık gerilim değişimi; sinφ işaretli (kapasitif yükte negatif). */
  function regulation(K, cos, sinSigned, ur, ux) {
    return K * (ur * cos + ux * sinSigned) + Math.pow(K * (ux * cos - ur * sinSigned), 2) / 200;
  }

  /** Bir saatlik/anlık zincir: yük oranı frac ile ölçeklenir (tüm aktif yükler aynı oranda, cosφ sabit). */
  function chain(s, frac) {
    const U = num(s.trafo.U2_V, 400);
    const sums = loadSums(s.loads, U, frac);
    const on = stepSelection(s.comp, sums);
    const kin = kompInput(s, sums, on);
    const kr = E.komp.compute(kin);
    const Qon = s.comp.steps.reduce((a, q, i) => a + (on[i] ? Math.max(0, num(q, 0)) : 0), 0);
    const pin = panoInput(Object.assign({}, s, { loads: s.loads.map(l => Object.assign({}, l, { P_kW: num(l.P_kW, 0) * (frac === undefined ? 1 : frac) })) }), Qon);
    const pr = E.pano.compute(pin);
    const Pbus = pr.values.P / 1e3, Qbus = pr.values.Q / 1e3, Sbus = Math.hypot(Pbus, Qbus);
    const tin = { Sr_kVA: s.trafo.Sr_kVA, U1_kV: s.supply.U1_kV, U2_V: U, P0: s.trafo.P0, Pk: s.trafo.Pk, uk: s.trafo.uk, P_kW: Pbus, cos: Sbus > 0 ? Pbus / Sbus : 1, ambient: s.trafo.ambient, SkQ_MVA: s.supply.SkQ_MVA };
    const tr = E.trafo.compute(tin);
    return { sums: sums, on: on, Qon: Qon, kr: kr, pr: pr, tr: tr, kin: kin, pin: pin, tin: tin, Pbus: Pbus, Qbus: Qbus, Sbus: Sbus };
  }

  /** 24 saatlik profil: her saat aynı zincir (röle o saatin yüküne göre kademe seçer). Günlük enerji oranları EPDK 5999-3 Md. 13
   * ölçütüyle (ext.komp.dailyEnergy / epdkLimits), trafo kayıp enerjisi Σ(P0 + Pk·K²)·1 sa. */
  function day(s) {
    const prof = (XK().PROFILES[s.facility.shift] || XK().PROFILES.v2).f;
    const hours = prof.map((f, h) => {
      const c = chain(s, f), v = c.tr.values;
      return { h: h, f: f, P: c.Pbus, Q: c.Qbus, K: v.k, loss: v.losses / 1e3, Qc: c.Qon, cos: c.Sbus > 0 ? c.Pbus / c.Sbus : 1, cap: c.Qbus < 0 };
    });
    const en = XK().dailyEnergy(hours);
    const lim = XK().epdkLimits(num(s.trafo.Sr_kVA, 1000));
    const lossDay = hours.reduce((a, x) => a + x.loss, 0);
    return Object.assign(en, { hours: hours, limit: lim, indOk: en.indPct <= lim.ind, capOk: en.capPct <= lim.cap, lossDay: lossDay, lossYear: lossDay * 365, costYear: lossDay * 365 * num(s.facility.price, 0), Kmax: Math.max.apply(null, hours.map(x => x.K)) });
  }

  /* ------------------------------------------------------------ ana hesap */
  function evaluate(s) {
    const errors = [], warnings = [];
    if (!s || !Array.isArray(s.loads) || !s.comp || !Array.isArray(s.comp.steps)) return { ok: false, errors: ['Senaryo verisi eksik.'], warnings: [], checks: [], values: {} };
    const Sr = num(s.trafo.Sr_kVA, 0);
    if (Sr > 5000) errors.push('Trafo gücü: bu senaryoda en çok 5000 kVA (AG ana dağıtım modeli).');
    const ids = new Set();
    s.loads.forEach((l, i) => { if (!l.id || ids.has(l.id)) errors.push('Yük ' + (i + 1) + ': benzersiz kimlik gerekli.'); ids.add(l.id); if (!LOAD_TYPES[l.type]) errors.push((l.name || 'Yük ' + (i + 1)) + ': bilinmeyen yük tipi.'); });
    if (!COMP_MODES[s.comp.mode]) errors.push('Kompanzasyon modu geçersiz.');
    const c = chain(s);
    const pref = (p, list) => list.map(x => p + ': ' + x);
    errors.push.apply(errors, pref('Kompanzasyon', c.kr.errors).concat(pref('Ana pano', c.pr.errors), pref('Trafo', c.tr.errors)));
    const ok = errors.length === 0;
    const kv = c.kr.values, pv = c.pr.values, tv = c.tr.values;
    const U = num(s.trafo.U2_V, 400);
    const dy = ok ? day(s) : null;

    // bara gerilimi (trafo AG uçları): işaretli sinφ ile
    const sinS = c.Sbus > 0 ? c.Qbus / c.Sbus : 0, cosS = c.Sbus > 0 ? c.Pbus / c.Sbus : 1;
    const eps = regulation(tv.k, cosS, sinS, tv.ur, tv.ux);
    const Ubus = U * (1 - eps / 100);
    const QcTot = s.comp.steps.reduce((a, q) => a + Math.max(0, num(q, 0)), 0);
    const Sk = XK().trafoSk(Sr, num(s.trafo.uk, 6));
    const acb = XT().acbCheck({ In: s.board.mainIn, Ir: s.board.mainIrF, I2: tv.I2, I2n: tv.I2n, Icu_kA: s.board.mainIcu_kA, Ik: pv.Ik3 });

    /* --- kontroller: kaynak modülün kontrolleri alan önekiyle; çıkış kontrolleri yük kimliğine bağlanır */
    const checks = [];
    const dec = t => String(t || '').replace(/(\d)\.(\d)/g, '$1,$2');
    const add = (area, key, x, label) => checks.push({ id: area + '.' + key, area: area, label: dec(label || x.label), status: x.status, detail: dec(x.detail), ref: x.ref, src: x.id });
    const bankIdx = s.loads.length;
    c.pr.checks.forEach(x => {
      const m = /^(coord|vd|ad|iz)(\d+)$/.exec(x.id);
      if (m) {
        const i = Number(m[2]);
        if (i === bankIdx) return; // banka çıkışı aşağıda tüm kademelerin toplamıyla kontrol edilir
        const l = s.loads[i];
        add('load:' + l.id, m[1], x, l.name + ': ' + x.label.replace(/^.*?:\s*/, ''));
      } else if (x.id !== 'unb') add('adp', x.id, x, 'ADP · ' + x.label);
    });
    add('adp', 'acbTr', { label: 'ACB Ir ≤ 1,1·I2n (trafo aşırı yük koruması)', status: acb.trafoOk ? 'ok' : 'warn', detail: 'Ir ' + Math.round(acb.Ir) + ' A · trafo I2n ' + Math.round(tv.I2n) + ' A', ref: 'Ön kontrol (genel uygulama)' });
    // kondansatör bankası çıkışı: kademelerin tamamı devrede olabileceğinden tasarım akımı toplam güçten (1,43·Ic)
    const IbBank = 1.43 * QcTot * 1e3 / (SQRT3 * U), IzBank = E.cableIz(num(s.comp.S, 50), 'E', 3, Math.max(1, num(s.comp.par, 1)));
    if (QcTot > 0) add('komp', 'feed', { label: 'Banka çıkışı: Ib ≤ In ≤ Iz (Ib = 1,43·Ic, tüm kademeler)', status: IbBank <= s.comp.In && s.comp.In <= IzBank ? 'ok' : 'fail', detail: 'Ib ' + Math.round(IbBank) + ' A · In ' + s.comp.In + ' A · Iz ' + Math.round(IzBank) + ' A', ref: 'IEC 60831-1 · TS HD 60364-4-43' });
    c.kr.checks.forEach(x => { if (x.id !== 'reg') add('komp', x.id, x, 'Kompanzasyon · ' + x.label); });
    if (dy) {
      const st = dy.indOk && dy.capOk ? 'ok' : 'fail';
      add('komp', 'day', { label: 'Kompanzasyon · günlük reaktif/aktif enerji oranı', status: st, detail: 'Endüktif %' + E.round(dy.indPct, 1) + ' (sınır %' + dy.limit.ind + ') · kapasitif %' + E.round(dy.capPct, 1) + ' (sınır %' + dy.limit.cap + ') · ' + SHIFTS[s.facility.shift] + ' profiliyle', ref: 'EPDK Kurul Kararı 5999-3, Madde 13' });
    }
    c.tr.checks.forEach(x => { if (x.id !== 'pf') add('trafo', x.id, x, 'Trafo · ' + x.label); });
    if (tv.k > 0) add('trafo', 'u', { label: 'Trafo · AG uç gerilimi (yükte)', status: Ubus >= 0.95 * U && Ubus <= 1.05 * U ? 'ok' : 'warn', detail: Math.round(Ubus * 10) / 10 + ' V (ε = %' + E.round(eps, 2) + '; kademe ±0)', ref: 'IEC 60076-1 yaklaşık bağıntı' });

    const loads = s.loads.map((l, i) => {
      const r = pv.circuits ? pv.circuits[i] : null;
      const st = checks.filter(x => x.area === 'load:' + l.id).reduce((a, x) => (x.status === 'fail' ? 'fail' : a === 'fail' ? a : x.status === 'warn' ? 'warn' : a), 'ok');
      return { id: l.id, name: l.name, on: !!l.on, critical: !!l.critical, type: l.type, Pel: l.on ? elec(l) : 0, PelRated: elec(l), Q: l.on ? elec(l) * Math.tan(Math.acos(Math.min(1, Math.max(0.1, num(l.cos, 1))))) : 0,
        I: r ? r.I : 0, Ib: r ? r.Ib : 0, In: num(l.In, 0), Iz: r ? r.Iz : NaN, vd: r ? r.vd : 0, Ik1: r ? r.Ik1 : 0, Ia: r ? r.Ia : 0, disconnectOK: r ? r.disconnectOK : false, coord: r ? r.coord : false, startI: r ? r.startI : 0, loadPct: r ? r.loadPct : 0, status: st };
    });

    const values = {
      U: U, loads: loads,
      load: { P: c.sums.P, Q: c.sums.Q, S: c.sums.S, cos: c.sums.cos, Ih: c.sums.Ih },
      comp: { on: c.on, Qon: c.Qon, Qtot: QcTot, Qneed: kv.Qneed, cosNew: kv.cosNew, Qnet: kv.Qnet, state: kv.state, THDv: kv.THDv, THDiLoad: kv.THDiLoad, THDiSupply: kv.THDiSupply, hPar: kv.hPar, hRes: kv.hRes, capOver: kv.capOver, spectrum: kv.spectrum, rise: XK().voltageRise(c.Qon, Sk), Sk: Sk, harmonics: c.kin.harmonics },
      bus: { P: c.Pbus, Q: c.Qbus, S: c.Sbus, pf: cosS, I: pv.Imax, Ik3: pv.Ik3, ip: pv.ip, loading: pv.loading, mainIr: pv.mainIr, U: Ubus, eps: eps },
      trafo: { Sr: Sr, k: tv.k, S: tv.S / 1e3, I1: tv.I1, I2: tv.I2, I1n: tv.I1n, I2n: tv.I2n, P0: tv.P0, Pcu: tv.Pcu, losses: tv.losses, eff: tv.eff, kOpt: tv.kOpt, Ik: tv.Ik, IkT: tv.IkT, temps: tv.temps, aging: tv.aging, ur: tv.ur, ux: tv.ux },
      acb: acb, day: dy,
      // zincir: her aşamanın aynı girdiden aldığı/verdiği değer (tutarlılık gösterimi ve testi için)
      chain: [
        { stage: 'Yükler', P: c.sums.P, Q: c.sums.Q, note: s.loads.filter(l => l.on).length + ' / ' + s.loads.length + ' yük devrede' },
        { stage: 'Kompanzasyon', P: c.Pbus - c.sums.P, Q: -c.Qon, note: c.on.filter(Boolean).length + ' / ' + c.on.length + ' kademe · ' + Math.round(c.Qon) + ' kVAr' },
        { stage: 'ADP bara', P: c.Pbus, Q: c.Qbus, note: Math.round(pv.Imax) + ' A · cosφ ' + E.round(cosS, 3) },
        { stage: 'Trafo AG', P: tv.P / 1e3, Q: c.Qbus, note: 'K %' + E.round(tv.k * 100, 1) + ' · kayıp ' + E.round(tv.losses / 1e3, 2) + ' kW' },
        { stage: 'OG şebeke', P: tv.P / 1e3 + tv.losses / 1e3, Q: null, note: 'I1 ' + E.round(tv.I1, 1) + ' A @ ' + s.supply.U1_kV + ' kV' }
      ]
    };
    const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
    return {
      ok: ok, errors: errors, warnings: warnings, checks: checks, values: values,
      assumptions: [
        'Kapsam: eğitim ve ön değerlendirme modeli. Gerçek zamanlı tesis bağlantısı yoktur; değerler ölçüm değil, girdilerden hesaplanır (canlı dijital ikiz değildir).',
        'Kalıcı durum hesabıdır: yol alma akımları, anahtarlama geçici olayları ve röle gecikmeleri sonuçlara katılmaz.',
        'Hesap sırası: yükler → kompanzasyon → ADP bara → trafo. Akımlar anma bara geriliminde (' + U + ' V) hesaplanır; gerilim düşümünün akıma geri etkisi ihmal edilir.',
        'Tüm yükler dengeli üç faz kabul edilir. Motorlarda girilen güç mil gücüdür; elektriksel güç P/η.',
        'Harmonik akımlar aritmetik toplanır (aynı faz açısı): güvenli tarafta üst tahmin. Profiller örnektir; gerçek değerlendirme TS EN 61000-4-30 sınıf A ölçümüyle yapılır.',
        'Otomatik kompanzasyon ideal reaktif güç rölesidir: anlık durumda hedefi aşmayan en büyük kademe toplamını seçer.',
        'Günlük profil: tüm aktif yükler aynı oranla değişir, cosφ sabittir; anlık durum profilin tepe saatidir.',
        'Trafo kademesi ±0 alınır; OG şebeke gerilimi anma değerindedir.'
      ].concat(uniq(c.pr.assumptions.concat(c.kr.assumptions, c.tr.assumptions))),
      formulas: uniq(['P_el = P_mil / η', 'Q = P·tanφ', 'Q_bara = Σ Q_yük − Σ Q_kademe', 'K = S_bara / Sr', 'ε ≈ K·(uR·cosφ + uX·sinφ) + K²·(uX·cosφ − uR·sinφ)²/200', 'E_kayıp,gün = Σ (P0 + Pk·K_h²)·1 sa']
        .concat(c.kr.formulas, c.pr.formulas, c.tr.formulas)),
      limits: [
        'OG tarafı sonsuz güçlü kaynak + girilen SkQ ile modellenir; OG koruma, röle ayarı ve OG kablo hesabı bu senaryoda yoktur (Trafo modülü).',
        'Tek trafo, tek ADP barası; tali panolar ve çıkışların seçiciliği yoktur (Selektivite modülü).',
        'Yük çıkışları: bakır, yöntem E (delikli tava), 30 °C, gruplama düzeltmesi yok; kesit en çok 120 mm² (üstü paralel).',
        'Kısa devre IEC 60909 basitleştirilmiş (c = 1,05); motor katkısı ve ark direnci ihmal.',
        'Kademe güçleri bara anma gerilimindeki etkin güçtür; kapasite kaybı ve kademe arızası (Kompanzasyon modülü) yoktur.',
        'Isıl sonuçlar kararlı haldir (IEC 60076-7 ONAN varsayılanları); zaman içinde ısınma Trafo modülündedir.'
      ]
    };
  }

  /* ------------------------------------------------------------ A/B karşılaştırma */
  /** Aynı motor ve aynı varsayımlarla iki senaryo: satırlar sabit birim ve basamakla. better: düşük/yüksek olanın iyi olduğu yön. */
  const COMPARE = [
    { key: 'Pload', label: 'Yük aktif gücü', unit: 'kW', d: 1, get: r => r.values.load.P },
    { key: 'cos0', label: 'cosφ (kompanzasyon öncesi)', unit: '', d: 3, get: r => r.values.load.cos, better: 'high' },
    { key: 'Qc', label: 'Devredeki kondansatör', unit: 'kVAr', d: 0, get: r => r.values.comp.Qon },
    { key: 'cos1', label: 'cosφ (bara)', unit: '', d: 3, get: r => r.values.bus.pf, better: 'high' },
    { key: 'S', label: 'Bara görünür gücü', unit: 'kVA', d: 1, get: r => r.values.bus.S, better: 'low' },
    { key: 'I', label: 'Bara akımı', unit: 'A', d: 0, get: r => r.values.bus.I, better: 'low' },
    { key: 'Sr', label: 'Trafo anma gücü', unit: 'kVA', d: 0, get: r => r.values.trafo.Sr },
    { key: 'K', label: 'Trafo yüklenmesi', unit: '%', d: 1, get: r => r.values.trafo.k * 100, better: 'low' },
    { key: 'loss', label: 'Trafo kaybı (anlık)', unit: 'kW', d: 2, get: r => r.values.trafo.losses / 1e3, better: 'low' },
    { key: 'lossY', label: 'Trafo kayıp enerjisi (yıllık)', unit: 'MWh', d: 1, get: r => r.values.day.lossYear / 1e3, better: 'low' },
    { key: 'cost', label: 'Kayıp maliyeti (yıllık)', unit: 'TL', d: 0, get: r => r.values.day.costYear, better: 'low' },
    { key: 'hs', label: 'Sıcak nokta (kararlı)', unit: '°C', d: 1, get: r => r.values.trafo.temps.hotSpot, better: 'low' },
    { key: 'U', label: 'AG uç gerilimi', unit: 'V', d: 1, get: r => r.values.bus.U },
    { key: 'Ik3', label: 'ADP barası Ik3', unit: 'kA', d: 2, get: r => r.values.bus.Ik3 / 1e3 },
    { key: 'THDv', label: 'THDv (hesaplanan)', unit: '%', d: 2, get: r => r.values.comp.THDv, better: 'low' },
    { key: 'ind', label: 'Günlük endüktif oran', unit: '%', d: 1, get: r => r.values.day.indPct, better: 'low' },
    { key: 'cap', label: 'Günlük kapasitif oran', unit: '%', d: 1, get: r => r.values.day.capPct, better: 'low' },
    { key: 'fail', label: 'Uygunsuz ön kontrol', unit: 'adet', d: 0, get: r => r.checks.filter(c => c.status === 'fail').length, better: 'low' },
    { key: 'warn', label: 'Uyarı', unit: 'adet', d: 0, get: r => r.checks.filter(c => c.status === 'warn').length, better: 'low' }
  ];
  function compare(sa, sb) {
    const ra = evaluate(sa), rb = evaluate(sb);
    if (!ra.ok || !rb.ok) return { ok: false, errors: (ra.ok ? [] : ['A: ' + ra.errors.join('; ')]).concat(rb.ok ? [] : ['B: ' + rb.errors.join('; ')]), rows: [] };
    const rows = COMPARE.map(c => {
      const a = c.get(ra), b = c.get(rb), dlt = b - a;
      const eq = Math.abs(dlt) < Math.pow(10, -c.d) / 2;
      return { key: c.key, label: c.label, unit: c.unit, d: c.d, a: a, b: b, delta: dlt, better: eq || !c.better ? null : (c.better === 'low') === (dlt < 0) ? 'B' : 'A' };
    });
    return { ok: true, rows: rows, ra: ra, rb: rb, diff: inputDiff(sa, sb) };
  }
  /** İki senaryonun girdi farkları (insan okunur). */
  function inputDiff(a, b) {
    const out = [];
    const walk = (x, y, p) => {
      if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) { Object.keys(Object.assign({}, x, y)).forEach(k => { if (k !== 'ui') walk(x[k], y[k], p ? p + '.' + k : k); }); return; }
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p);
    };
    const byId = list => Object.fromEntries((list || []).map(l => [l.id, l]));
    walk(Object.assign({}, a, { loads: null }), Object.assign({}, b, { loads: null }), '');
    const la = byId(a.loads), lb = byId(b.loads);
    Object.keys(Object.assign({}, la, lb)).forEach(id => {
      if (!la[id]) out.push('+ ' + lb[id].name); else if (!lb[id]) out.push('− ' + la[id].name);
      else if (JSON.stringify(la[id]) !== JSON.stringify(lb[id])) out.push(lb[id].name + (la[id].on !== lb[id].on ? (lb[id].on ? ' (açık)' : ' (kapalı)') : ' (parametre)'));
    });
    return out;
  }

  /* ------------------------------------------------------------ olay özeti */
  /** Olay geçmişi için kısa özet: yük, cosφ, trafo yüklenmesi, kademe ve uygunsuzluklar. */
  function summary(r) {
    if (!r || !r.ok) return null;
    const v = r.values;
    return { P: v.load.P, cos: v.bus.pf, K: v.trafo.k, Qc: v.comp.Qon, steps: v.comp.on.filter(Boolean).length, I: v.bus.I, fails: r.checks.filter(c => c.status === 'fail').map(c => c.id) };
  }
  const tr = (v, d) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ',');
  function deltaText(a, b) {
    if (!a || !b) return '';
    const parts = [];
    if (Math.abs(a.P - b.P) >= 0.05) parts.push('P ' + tr(a.P, 1) + ' → ' + tr(b.P, 1) + ' kW');
    if (Math.abs(a.K - b.K) >= 0.0005) parts.push('K %' + tr(a.K * 100, 1) + ' → %' + tr(b.K * 100, 1));
    if (Math.abs(a.cos - b.cos) >= 0.0005) parts.push('cosφ ' + tr(a.cos, 3) + ' → ' + tr(b.cos, 3));
    if (a.Qc !== b.Qc) parts.push('kademe ' + tr(a.Qc, 0) + ' → ' + tr(b.Qc, 0) + ' kVAr');
    return parts.join(' · ');
  }

  /* ------------------------------------------------------------ uyumluluk */
  /** Kayıtlı/içe aktarılan durumu bu sürüme taşır. from: dosyadaki şema. Dönüş { state, notes }. Şema 1 ilk sürümdür;
   * yeni şema eklendiğinde dönüşüm buraya MIGRATIONS[n] (n → n+1) olarak yazılır. */
  const MIGRATIONS = {};
  function migrate(state, from) {
    const notes = [];
    let st = clone(state || {}), v = num(from, 1);
    if (v > SCHEMA) throw new Error('Kayıt bu sayfadan daha yeni bir sürümle (şema ' + v + ') yapılmış; sayfayı yenileyin.');
    while (v < SCHEMA) { const m = MIGRATIONS[v]; if (!m) { notes.push('Şema ' + v + ' için dönüşüm yok; eksik alanlar varsayılanla tamamlandı.'); break; } st = m(st, notes); v++; }
    return { state: st, notes: notes };
  }
  /** Diğer VoltSim modüllerinin (trafo, kompanzasyon, pano) proje dosyalarından ortak senaryoya aktarım. Taşınamayan alanlar notlarda. */
  function importForeign(obj, base) {
    const s = clone(base || defaults()), st = obj && obj.state, notes = [];
    if (!st || typeof st !== 'object') return null;
    const pick = (dst, k, v) => { if (typeof v === 'number' && isFinite(v)) dst[k] = v; };
    if (obj.module === 'trafo') {
      pick(s.trafo, 'Sr_kVA', st.Sr_kVA); pick(s.trafo, 'P0', st.P0); pick(s.trafo, 'Pk', st.Pk); pick(s.trafo, 'uk', st.uk); pick(s.trafo, 'U2_V', st.U2_V); pick(s.trafo, 'ambient', st.ambient);
      pick(s.supply, 'U1_kV', st.U1_kV); pick(s.supply, 'SkQ_MVA', st.SkQ_MVA); pick(s.facility, 'price', st.lossPrice);
      notes.push('Trafo projesinden alındı: anma gücü, P0, Pk, uk, gerilimler, ortam sıcaklığı, SkQ, kayıp fiyatı.', 'Alınmadı: tek yük değeri (yük grupları korunur), OG hücreleri, röle, kademe, ısıl zaman simülasyonu.');
    } else if (obj.module === 'komp') {
      if (Array.isArray(st.steps) && st.steps.every(q => typeof q === 'number' && q >= 0)) { s.comp.steps = st.steps.slice(); s.comp.manual = st.steps.map((_, i) => !!(st.manualOn || [])[i]); }
      pick(s.comp, 'detune', st.detune); pick(s.comp, 'target', st.cos2); pick(s.trafo, 'Sr_kVA', st.Sr_kVA); pick(s.trafo, 'uk', st.uk);
      if (st.mode === 'manual' || st.mode === 'auto') s.comp.mode = st.mode;
      notes.push('Kompanzasyon projesinden alındı: kademeler, ayar oranı p, hedef cosφ, çalışma modu, trafo gücü ve uk.', 'Alınmadı: tek yük P/cosφ ve harmonik spektrum (yük gruplarından hesaplanır), kademe arızaları, AHF, şönt reaktör.');
      if (st.Sr_kVA && E.trafo.PRESETS[st.Sr_kVA]) { s.trafo.P0 = E.trafo.PRESETS[st.Sr_kVA].P0; s.trafo.Pk = E.trafo.PRESETS[st.Sr_kVA].Pk; notes.push('P0 ve Pk, ' + st.Sr_kVA + ' kVA örnek katalog değerlerinden.'); }
    } else if (obj.module === 'pano') {
      const cs = Array.isArray(st.circuits) ? st.circuits.filter(c => c && !c.cap && !c.shunt) : [];
      if (cs.length) {
        let n1 = 0;
        s.loads = cs.map((c, i) => {
          if (c.phase !== '3F') n1++;
          const type = c.motor ? (c.start === 'VFD' ? 'vfd' : 'motor') : 'resistive';
          return L({ id: 'p' + (i + 1), name: String(c.name || 'Devre ' + (i + 1)).slice(0, 60), type: type, vis: c.motor ? 'generic' : 'generic', P_kW: num(c.P_kW, 1) * (c.phase === '3F' ? 1 : 1), cos: num(c.cos, 0.9), eff: num(c.eff, 0.9), on: c.on !== false && (!c.motor || c.running !== false),
            L: num(c.L, 20), S: Math.min(120, num(c.S, 2.5)), par: Math.max(1, num(c.parallel, 1)), In: num(c.In, 16) });
        });
        if (n1) notes.push(n1 + ' tek fazlı devre üç fazlı dengeli yük olarak alındı (faz dengesizliği bu senaryoda yok).');
      }
      ['mainIn', 'mainIrF', 'mainIcu_kA', 'busbarIn', 'feedL', 'feedS', 'feedN'].forEach(k => pick(s.board, k, st[k]));
      pick(s.trafo, 'Sr_kVA', st.trafo_kVA); pick(s.trafo, 'uk', st.trafo_uk); pick(s.trafo, 'Pk', st.trafo_Pk); pick(s.supply, 'SkQ_MVA', st.SkQ_MVA);
      notes.push('Pano projesinden alındı: çıkışlar (yük grupları), ana şalter, bara, besleme kablosu, trafo gücü/uk/Pk.', 'Alınmadı: MCB eğrileri, kaçak akım, açma durumu, kondansatör/şönt çıkışları, jeneratör kaynağı.');
    } else return null;
    return { state: s, notes: notes };
  }

  return { SCHEMA: SCHEMA, LOAD_TYPES: LOAD_TYPES, VISUALS: VISUALS, HARM: HARM, ORDERS: ORDERS, MCCB_IN: MCCB_IN, ACB_IN: ACB_IN, CABLES: CABLES, SHIFTS: SHIFTS, COMP_MODES: COMP_MODES, BANK: BANK,
    defaults: defaults, newLoad: L, elec: elec, designI: designI, autoSize: autoSize, scenarioOf: scenarioOf, anonymize: anonymize,
    loadSums: loadSums, stepSelection: stepSelection, chain: chain, day: day, evaluate: evaluate, regulation: regulation,
    COMPARE: COMPARE, compare: compare, inputDiff: inputDiff, summary: summary, deltaText: deltaText, migrate: migrate, importForeign: importForeign };
});
