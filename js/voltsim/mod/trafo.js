/* VoltSim · 3D Trafo ve Trafo Merkezi Simülasyonu
 * Hesap: VoltSimEngine.trafo (I = S/(√3·U), P0 + Pk·K², verim, IEC 60076-1 gerilim değişimi, yaklaşık Ik,
 * IEC 60076-7 kararlı hal ve birinci derece ısıl yaklaşım, bağıl yaşlanma) ve VoltSimEngine.ext.trafo
 * (js/voltsim/calc/trafo.js: manevra durum makinesi ve kilitlemeler, yüksüz kademe, kompanzasyon, günlük kayıp,
 * ONAF fan kontrolü, kuru tip sıcaklık, röle/sigorta/ACB ön kontrolleri, paralel çalışma).
 * Sahne: prefabrik beton köşk (OG hücreler, yağlı veya kuru tip trafo, AG ana pano, kompanzasyon); hesap sonucunu gösterir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const TR = E.trafo, C = E.ext.trafo;
  const clamp = E.clamp;
  const MIN_PER_S = 10; // hızlandırılmış zaman: 1 s = 10 dk
  const SR_LIST = Object.keys(TR.PRESETS).map(Number);
  const U1_LIST = [['34.5', '34,5 kV'], ['31.5', '31,5 kV'], ['15.8', '15,8 kV'], ['10.5', '10,5 kV'], ['6.3', '6,3 kV']];
  const CELL_TYPES = {
    line: { name: 'Hat hücresi (giriş/çıkış)', short: 'HAT' },
    cb: { name: 'Kesicili trafo koruma hücresi', short: 'KESİCİ' },
    fuse: { name: 'Sigortalı yük ayırıcı (trafo koruma)', short: 'SİGORTA' },
    meas: { name: 'Ölçü hücresi (AT/GT)', short: 'ÖLÇÜ' },
    coup: { name: 'Kuplaj / bara bölümleme', short: 'KUPLAJ' }
  };
  const ACB_IN = [400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];

  function defaults() {
    return {
      type: 'oil', SrSel: '630', Sr_kVA: 630, U1sel: '34.5', U1_kV: 34.5, U2_V: 400, vg: 'Dyn11',
      P0: 540, Pk: 4600, uk: 4,
      cooling: 'AN', fanFactor: 1.25, fanOn: 65, fanOff: 55, dryClass: 'F',
      P_kW: 450, cos: 0.95, profile: 'sabit', ambient: 25, SkQ_MVA: 500, uNet: 100, tap: 0,
      cells: [{ type: 'line', name: 'Giriş' }, { type: 'line', name: 'Çıkış' }, { type: 'meas', name: 'Ölçü' }, { type: 'cb', name: 'Trafo koruma' }],
      relay: { Ip: 13, tp: 0.3, Ihs: 350, Ie: 2 }, fuseIn: 25,
      acb: { In: 1000, Ir: 0.9, Icu: 50 },
      cap: { on: false, kvar: 150, steps: 6 },
      sw: C.initialSw(),
      alarmOil: 90, tripOil: 100, cutaway: true, lossPrice: 3.5,
      par: { on: false, Sr: 630, uk: 4, vg: 'Dyn11', ratioDiff: 0 },
      thermalOn: false, th: Object.assign({}, TR.THERMAL_ONAN)
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  function num(v, d, lo, hi) { v = Number(v); if (!isFinite(v)) v = d; return clamp(v, lo, hi); }
  function tpIndex(s) { return (s.cells || []).findIndex(c => c.type === 'cb' || c.type === 'fuse'); }
  function kindOf(s) { const i = tpIndex(s); return i < 0 ? null : s.cells[i].type; }
  function clock(min) { const d = Math.floor(min / 1440) + 1, m = ((min % 1440) + 1440) % 1440; return 'Gün ' + d + ' · ' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'); }
  const dry = s => s.type === 'dry';
  const coolName = s => (dry(s) ? (s.cooling === 'AF' ? 'AN/AF' : 'AN') : (s.cooling === 'AF' ? 'ONAN/ONAF' : 'ONAN'));
  const tapLabel = t => (t > 0 ? '+' : t < 0 ? '−' : '±') + fmt(Math.abs(t), 1) + ' %';

  /** Anma değerlerine göre önerilen koruma ayarları (röle, OG sigorta, ACB) — calc/trafo.js kontrolleriyle tutarlı. */
  function protDefaults(st) {
    const r = TR.compute({ Sr_kVA: st.Sr_kVA, U1_kV: st.U1_kV, U2_V: st.U2_V, P0: st.P0, Pk: st.Pk, uk: st.uk, P_kW: 0, cos: 1, ambient: 20, SkQ_MVA: st.SkQ_MVA });
    if (!r.ok) return {};
    const v = r.values, rc = C.relayCheck({ I1n: v.I1n, IkLV: v.Ik, U2: st.U2_V, U1: st.U1_kV * 1000, Ip: 0, Ihs: 0, Ie: 0 });
    const In = ACB_IN.find(x => x >= v.I2n) || ACB_IN[ACB_IN.length - 1];
    return { relay: { Ip: Math.round(1.3 * v.I1n * 2) / 2, tp: 0.3, Ihs: Math.ceil(rc.ihsMin * 1.15 / 10) * 10, Ie: Math.max(1, Math.round(0.2 * v.I1n * 2) / 2) }, fuseIn: C.fuseSuggest(v.I1n) || 25,
      acb: { In: In, Ir: Math.min(1, Math.floor(v.I2n / In * 20) / 20), Icu: [25, 36, 42, 50, 65, 80, 100, 150].find(x => x * 1000 >= v.Ik * 1.1) || 150 } };
  }

  /* ---------------------------------------------------------------- hesap */
  function compute(s, app) {
    const L = app && app.live;
    const kind = kindOf(s);
    const en = kind ? C.energized(s.sw || C.initialSw(), kind) : { mv: false, lv: false };
    const hour = L ? (L.clock / 60) % 24 : 12;
    const mult = C.profileMult(s.profile, hour);
    let P = en.lv ? Number(s.P_kW) * mult : 0;
    let cosE = Number(s.cos), pf = null;
    if (s.cap && s.cap.on && en.lv && P > 0) { pf = C.pfCorrection(P, Number(s.cos), Number(s.cap.kvar)); cosE = clamp(pf.cos1, 0.1, 1); }
    const thermal = s.thermalOn ? s.th : undefined;
    const r = TR.compute({ Sr_kVA: s.Sr_kVA, U1_kV: s.U1_kV, U2_V: s.U2_V, P0: s.P0, Pk: s.Pk, uk: s.uk, P_kW: P, cos: cosE, ambient: s.ambient, SkQ_MVA: s.SkQ_MVA, thermal: thermal, energized: en.mv });
    const errs = [];
    if (!kind) errs.push('Trafo koruma hücresi gerekli: hücre listesine kesicili veya sigortalı yük ayırıcı hücresi ekleyin.');
    if (!(Number(s.alarmOil) < Number(s.tripOil))) errs.push('Sıcaklık alarm ayarı, açma ayarından küçük olmalı.');
    if (s.cooling === 'AF' && !(Number(s.fanOff) < Number(s.fanOn))) errs.push('Fan durma sıcaklığı, devreye girme sıcaklığından küçük olmalı.');
    if (errs.length) { r.errors = r.errors.concat(errs); r.ok = false; }
    if (!r.ok) return r;
    const v = r.values, ck = (id, label, status, detail, ref) => r.checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    const amb = Number(s.ambient), ff = num(s.fanFactor, 1.25, 1, 2);
    // soğutma ve kuru tip: kararlı hal sıcaklıkları calc/trafo.js ile (motorun steadyTemps bağıntısı)
    let fansSteady = false;
    if (en.mv) {
      if (dry(s)) {
        const t0 = C.dryTemps(v.k, amb, s.dryClass, 1);
        fansSteady = s.cooling === 'AF' && (t0.hotSpot >= s.fanOn || (L && L.fans));
        const t = C.dryTemps(v.k, amb, s.dryClass, fansSteady ? ff : 1);
        v.temps = { topOil: amb, hotSpot: t.hotSpot, dTo: 0, dTh: t.dTh }; v.dryLimit = t.limit; v.aging = null;
      } else if (s.cooling === 'AF') {
        fansSteady = TR.steadyTemps(v.k, amb, v.thermal).topOil >= s.fanOn || !!(L && L.fans);
        if (fansSteady) { v.temps = C.onafTemps(v.k, amb, v.thermal, ff); v.aging = TR.agingRate(v.temps.hotSpot); }
      }
    }
    // motorun yağlı trafo kontrollerini soğutma/tip ile güncelle
    r.checks = r.checks.filter(c => ['hs', 'to', 'th'].indexOf(c.id) < 0 || !dry(s));
    if (dry(s)) ck('dry', 'Sargı sıcak noktası (kuru tip, sınıf ' + s.dryClass + ')', v.temps.hotSpot <= v.dryLimit - 10 ? 'ok' : v.temps.hotSpot <= v.dryLimit ? 'warn' : 'fail', E.round(v.temps.hotSpot, 1) + ' °C / sınır ' + v.dryLimit + ' °C' + (fansSteady ? ' (fanlar çalışıyor)' : ''), 'IEC 60076-11/-12');
    else {
      const hs = r.checks.find(c => c.id === 'hs'), to = r.checks.find(c => c.id === 'to');
      if (hs) { hs.status = v.temps.hotSpot <= 98 ? 'ok' : v.temps.hotSpot <= 120 ? 'warn' : 'fail'; hs.detail = E.round(v.temps.hotSpot, 1) + ' °C · bağıl yaşlanma ' + E.round(v.aging, 2) + '×' + (fansSteady ? ' · ONAF fanlar çalışıyor' : ''); }
      if (to) { to.status = v.temps.topOil <= 105 ? 'ok' : 'fail'; to.detail = E.round(v.temps.topOil, 1) + ' °C'; }
    }
    const mon = dry(s) ? v.temps.hotSpot : v.temps.topOil;
    ck('thermo', (dry(s) ? 'Sargı sıcaklık rölesi' : 'Yağ termometresi') + ' (örnek ayar)', mon >= s.tripOil ? 'fail' : mon >= s.alarmOil ? 'warn' : 'ok', 'Kararlı ' + E.round(mon, 1) + ' °C · alarm ' + s.alarmOil + ' °C / açma ' + s.tripOil + ' °C. Ayarlar örnektir; üretici ve işletme talimatı esastır.');
    // gerilim ve kademe
    const lvU = en.mv ? C.lvVoltage({ U2n: s.U2_V, uNetPct: s.uNet, tapPct: s.tap, regPct: v.reg }) : { U0: 0, Uload: 0 };
    const dev = en.mv ? (lvU.Uload / s.U2_V - 1) * 100 : 0;
    if (en.mv) ck('ulv', 'AG bara gerilimi (yükte)', Math.abs(dev) <= 5 ? 'ok' : Math.abs(dev) <= 10 ? 'warn' : 'fail', fmt(lvU.Uload, 1) + ' V (%' + fmt(dev, 1) + ') · şebeke %' + fmt(s.uNet, 1) + ' · kademe ' + tapLabel(s.tap) + '. İşletme bandı örneği ±%5; TS EN 50160 dağıtım sınırı ±%10.', 'TS EN 50160');
    // koruma
    const rc = C.relayCheck({ I1n: v.I1n, IkLV: v.Ik, U2: s.U2_V, U1: s.U1_kV * 1000, Ip: s.relay.Ip, Ihs: s.relay.Ihs, Ie: s.relay.Ie });
    if (kind === 'cb') {
      ck('r51', 'Röle 51 (I>) ayarı', rc.ipOk ? 'ok' : 'warn', 'I> ' + fmt(s.relay.Ip, 1) + ' A, t ' + fmt(s.relay.tp, 2) + ' s · önerilen 1,1–1,6·I1n = ' + fmt(rc.ipMin, 1) + '–' + fmt(rc.ipMax, 1) + ' A. Bilgi amaçlıdır; seçicilik çalışması gerekir.');
      ck('r50', 'Röle 50 (I>>) ayarı', rc.ihsOk ? 'ok' : 'fail', 'I>> ' + fmt(s.relay.Ihs, 0) + ' A · AG 3F kısa devrenin OG’ye yansıyanı ' + fmt(rc.IkLVrefl, 0) + ' A; AG arızasında açmaması için ≥ 1,3× = ' + fmt(rc.ihsMin, 0) + ' A. Mıknatıslanma akımı ani yükselmesi röle 2. harmonik blokajıyla ayrıca ele alınır.');
      ck('r50n', 'Röle 50N/51N (Io>)', rc.ieOk ? 'info' : 'warn', 'Io> ' + fmt(s.relay.Ie, 1) + ' A primer. Değer OG nötr topraklama şekline ve dağıtım şirketi koordinasyonuna bağlıdır.');
    } else if (kind === 'fuse') {
      const fsug = C.fuseSuggest(v.I1n);
      ck('fuse', 'OG HRC sigortası', s.fuseIn >= 2 * v.I1n && s.fuseIn <= 3 * v.I1n + 1e-9 ? 'ok' : 'warn', fmt(s.fuseIn, 1) + ' A seçili · I1n ' + fmt(v.I1n, 1) + ' A · tipik ≈ 2·I1n → ' + (fsug || '—') + ' A. Üretici sigorta seçim tablosu esastır.', 'IEC 60282-1');
    }
    const ab = C.acbCheck({ In: s.acb.In, Ir: s.acb.Ir, I2: v.I2, I2n: v.I2n, Icu_kA: s.acb.Icu, Ik: v.Ik });
    ck('acb', 'AG ana şalter (ACB)', ab.loadOk && ab.trafoOk && ab.icuOk ? 'ok' : ab.icuOk ? 'warn' : 'fail', 'Ir = ' + fmt(ab.Ir, 0) + ' A (' + s.acb.In + ' A × ' + fmt(s.acb.Ir, 2) + ') · yük ' + fmt(v.I2, 0) + ' A · trafo I2n ' + fmt(v.I2n, 0) + ' A · Icu ' + s.acb.Icu + ' kA / Ik ≈ ' + fmt(v.Ik / 1e3, 1) + ' kA' + (!ab.loadOk ? ' · Ir yük akımının altında!' : '') + (!ab.trafoOk ? ' · Ir, 1,1·I2n üstünde: trafoyu aşırı yükten korumaz.' : ''));
    if (pf) ck('cap', 'AG kompanzasyon', pf.capacitive ? 'warn' : 'ok', fmt(s.cap.kvar, 0) + ' kVAr (' + s.cap.steps + ' kademe) · cosφ ' + fmt(s.cos, 2) + ' → ' + fmt(pf.cos1, 3) + (pf.capacitive ? ' · aşırı kompanzasyon (kapasitif)!' : '') + '. Röle kademeleri yüke göre devreye alır (burada tamamı devrede varsayıldı).');
    if (s.par && s.par.on) {
      const pc = C.parallelCheck({ Sr: s.Sr_kVA, uk: s.uk, vg: s.vg }, { Sr: Number(s.par.Sr), uk: Number(s.par.uk), vg: s.par.vg, ratioDiff: Number(s.par.ratioDiff) }, v.S / 1e3);
      const ok = pc.vgOk && pc.ratioOk && pc.ukOk && pc.powerOk;
      ck('par', 'Paralel çalışma koşulları (bilgi)', !pc.vgOk ? 'fail' : ok ? 'ok' : 'warn', 'Bağlantı grubu ' + (pc.vgOk ? 'aynı' : 'FARKLI (paralel bağlanamaz)') + ' · oran farkı ' + (pc.ratioOk ? '≤ %0,5' : '> %0,5') + ' · uk farkı %' + fmt(pc.ukDiff, 1) + (pc.ukOk ? '' : ' (> %10)') + ' · güç oranı ' + (pc.powerOk ? '≤ 3' : '> 3') + '. Bu yükte paylaşım: ' + fmt(pc.Sa, 0) + ' / ' + fmt(pc.Sb, 0) + ' kVA (K %' + fmt(pc.Ka * 100, 0) + ' / %' + fmt(pc.Kb * 100, 0) + ').', 'IEC 60076-8');
    }
    if (!en.mv) ck('deen', 'Trafo enerjisiz', 'info', C.isSafe(s.sw, kind) ? 'Güvenli çalışma durumu: AG açık, OG ayrılmış ve topraklı.' : 'OG tarafı açık; güvenli çalışma için topraklama da gerekir.');
    else if (!en.lv) ck('lvopen', 'AG ana şalter açık', 'info', 'Trafo boşta enerjili: yalnız boşta kayıp P0 harcanır.');
    const dl = C.dailyLosses({ Sr_kVA: s.Sr_kVA, cos: cosE, Ppeak_kW: en.lv ? Number(s.P_kW) : 0, profile: s.profile, P0: s.P0, Pk: s.Pk, price: s.lossPrice, energized: en.mv });
    r.assumptions = r.assumptions.concat([
      dry(s) ? 'Kuru tip: θh = θa + 1,1·Δθw,r·K^1,6 (sınıf ' + s.dryClass + ': Δθw,r ' + C.DRY[s.dryClass].rise + ' K, sınır ' + C.DRY[s.dryClass].limit + ' °C); yaşlanma hesaplanmaz. Üretici verisi esastır.' : 'Yağlı trafo: IEC 60076-7 ısıl modeli' + (s.thermalOn ? ' (kullanıcı verisi).' : ' varsayılanları.'),
      s.cooling === 'AF' ? 'Fanlı soğutma: fanlar çalışınca soğutma kapasitesi ×' + fmt(ff, 2) + ' (sıcaklıklar K/' + fmt(ff, 2) + ' yüklenmesiyle hesaplanır); fan devreye girme/durma ' + s.fanOn + '/' + s.fanOff + ' °C örnek ayardır.' : 'Doğal soğutma.',
      'Yüksüz kademe değiştirici: OG sarımı +t % → AG boşta gerilimi U2n·(U1/U1n)/(1 + t). Kademe yalnız trafo enerjisizken değiştirilir.',
      'Günlük kayıp: seçili yük profiliyle 24 saatlik Σ(P0 + Pk·K²); yıllık = 365 gün.',
      'Manevra kilitlemeleri genel bir trafo koruma hücresi içindir; gerçek hücrenin üretici kilitleme şeması ve işletme talimatı esastır.'
    ]);
    r.formulas = r.formulas.concat(['U2 = U2n·(U1/U1n)/(1 + t)·(1 − ε)', 'cosφ₂: Q₂ = P·tanφ₁ − Qc', 'E_kayıp,gün = Σ(P0 + Pk·K_h²)·1 sa', 'Sa/Sb = (Sra/uka)/(Srb/ukb)']);
    v.ext = { kind: kind, en: en, mult: mult, cosE: cosE, pf: pf, U0: lvU.U0, Ulv: lvU.Uload, dev: dev, fansSteady: fansSteady, dl: { Eday: dl.Eday, Eyear: dl.Eyear, costYear: dl.costYear, lossPct: dl.lossPct, E0: dl.E0, Ecu: dl.Ecu, hours: dl.hours.map(h => [h.h, h.loss / 1000]) }, relay: rc, acb: ab };
    return r;
  }

  /* ---------------------------------------------------------------- manevra */
  function doOp(app, op) {
    const s = app.state, kind = kindOf(s);
    if (!kind) { VS.toast('Trafo koruma hücresi yok.', 'bad'); return false; }
    const r = C.apply(s.sw, op, kind);
    const L = app.live;
    if (!r.ok) { VS.toast('Kilitleme: ' + r.reason, 'bad'); L.events.push(clock(L.clock) + ' reddedildi: ' + C.opLabel(op, kind) + ' — ' + r.reason); return false; }
    s.sw = r.sw;
    if (op === 'cbClose') { L.tripped = false; }
    L.events.push(clock(L.clock) + ' ' + C.opLabel(op, kind));
    if (r.warn) VS.toast(r.warn);
    return true;
  }
  function setTap(app, dir) {
    const s = app.state, kind = kindOf(s);
    if (kind && C.energized(s.sw, kind).mv) { VS.toast('Yüksüz kademe değiştirici: önce trafoyu enerjisiz bırakın (AG ve OG açık).', 'bad'); return; }
    const i = C.TAPS.indexOf(Number(s.tap)), j = clamp((i < 0 ? 2 : i) + dir, 0, C.TAPS.length - 1);
    s.tap = C.TAPS[j];
    app.live.events.push(clock(app.live.clock) + ' kademe ' + (j + 1) + ' (OG ' + tapLabel(s.tap) + ')');
  }
  function swSummary(s) {
    const kind = kindOf(s), sw = s.sw || {};
    if (!kind) return 'Trafo koruma hücresi yok';
    return 'AG ' + (sw.lv ? 'kapalı' : 'açık') + ' · ' + (kind === 'fuse' ? 'yük ayırıcı ' : 'kesici ') + (sw.cb ? 'kapalı' : 'açık') + (kind === 'cb' ? ' · ayırıcı ' + (sw.ds ? 'kapalı' : 'açık') : '') + ' · topraklama ' + (sw.es ? 'kapalı' : 'açık') + ' · kapak ' + (sw.door ? 'açık' : 'kapalı');
  }
  function opButtons(s) {
    const kind = kindOf(s), sw = s.sw || {};
    if (!kind) return [];
    const b = [
      { label: sw.lv ? 'AG ACB’yi aç' : 'AG ACB’yi kapat', op: sw.lv ? 'lvOpen' : 'lvClose' },
      { label: (kind === 'fuse' ? 'Yük ayırıcıyı ' : 'Kesiciyi ') + (sw.cb ? 'aç' : 'kapat'), op: sw.cb ? 'cbOpen' : 'cbClose' }
    ];
    if (kind === 'cb') b.push({ label: 'Ayırıcıyı ' + (sw.ds ? 'aç' : 'kapat'), op: sw.ds ? 'dsOpen' : 'dsClose' });
    b.push({ label: 'Topraklamayı ' + (sw.es ? 'aç' : 'kapat'), op: sw.es ? 'esOpen' : 'esClose', variant: sw.es ? '' : 'warn' });
    b.push({ label: 'Kablo kapağını ' + (sw.door ? 'kapat' : 'aç'), op: sw.door ? 'doorClose' : 'doorOpen' });
    return b;
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const preset = TR.PRESETS[s.SrSel];
    const r = app.validResult && app.validResult.values;
    const Pmax = Math.max(50, Math.round(s.Sr_kVA * 1.5 / 10) * 10);
    const kind = kindOf(s), isDry = dry(s);
    return [
      { title: 'Trafo', items: [
        { type: 'seg', key: 'type', label: 'Trafo tipi', options: [['oil', 'Yağlı (ONAN)'], ['dry', 'Kuru tip (döküm reçine)']],
          onChange: (v, a) => { const d = v === 'dry'; Object.assign(a.state, d ? { alarmOil: 140, tripOil: 155, fanOn: 110, fanOff: 95 } : { alarmOil: 90, tripOil: 100, fanOn: 65, fanOff: 55 }); a.live = initLive(a.state); a.renderControls(); a.invalidate(); } },
        { type: 'select', key: 'SrSel', label: 'Anma gücü Sr', rebuild: true, options: SR_LIST.map(v => [String(v), v + ' kVA']).concat([['custom', 'Özel değer…']]),
          onChange: (v, a) => { const p = TR.PRESETS[v]; if (p) { Object.assign(a.state, { Sr_kVA: Number(v), P0: p.P0, Pk: p.Pk, uk: p.uk }); a.state.P_kW = Math.min(a.state.P_kW, Math.round(Number(v) * 1.5)); } Object.assign(a.state, protDefaults(a.state)); VS.toast('Koruma ayarları yeni anma değerlerine göre önerilen değerlere getirildi (röle, OG sigorta, ACB).'); a.renderControls(); a.invalidate(); } },
        s.SrSel === 'custom' ? { type: 'number', key: 'Sr_kVA', label: 'Özel anma gücü', min: 25, max: 40000, step: 5, unit: 'kVA' } : null,
        { type: 'select', key: 'U1sel', label: 'OG anma gerilimi U1', rebuild: true, options: U1_LIST.concat([['custom', 'Özel değer…']]),
          onChange: (v, a) => { if (v !== 'custom') a.state.U1_kV = Number(v); a.renderControls(); a.invalidate(); } },
        s.U1sel === 'custom' ? { type: 'number', key: 'U1_kV', label: 'Özel OG gerilimi', min: 1, max: 154, step: 0.1, unit: 'kV', digits: 1 } : null,
        { type: 'seg', key: 'U2_V', label: 'AG anma gerilimi U2', options: [[400, '400 V'], [690, '690 V']] },
        { type: 'select', key: 'vg', label: 'Bağlantı grubu', options: [['Dyn11', 'Dyn11'], ['Dyn5', 'Dyn5'], ['Yzn11', 'Yzn11'], ['Yyn0', 'Yyn0']] },
        { type: 'number', key: 'P0', label: 'Boşta kayıp P0', min: 0, max: 100000, step: 10, unit: 'W', help: preset ? 'Önayar: ' + preset.P0 + ' W (örnek katalog değeri)' : 'Katalog veya etiket değeri' },
        { type: 'number', key: 'Pk', label: 'Yük (bakır) kaybı Pk', min: 0, max: 500000, step: 50, unit: 'W', help: preset ? 'Önayar: ' + preset.Pk + ' W (örnek katalog değeri)' : null },
        { type: 'number', key: 'uk', label: 'Kısa devre gerilimi uk', min: 2, max: 20, step: 0.1, unit: '%', digits: 1, help: preset ? 'Önayar: %' + preset.uk + ' (örnek katalog değeri)' : null },
        { type: 'seg', key: 'cooling', label: 'Soğutma', options: isDry ? [['AN', 'AN (doğal)'], ['AF', 'AN/AF (fanlı)']] : [['AN', 'ONAN'], ['AF', 'ONAN/ONAF (fanlı)']] },
        s.cooling === 'AF' ? { type: 'range', key: 'fanFactor', label: 'Fanla güç artışı', min: 1.1, max: 1.5, step: 0.05, digits: 2, fmt: v => '×' + fmt(v, 2), help: 'ONAN/ONAF 100/125 % için ×1,25 (üretici verisi esastır).' } : null,
        s.cooling === 'AF' ? { type: 'number', key: 'fanOn', label: 'Fan devreye girme (' + (isDry ? 'sargı' : 'üst yağ') + ')', min: 30, max: 160, step: 1, unit: '°C', help: 'Örnek ayar.' } : null,
        s.cooling === 'AF' ? { type: 'number', key: 'fanOff', label: 'Fan durma', min: 20, max: 150, step: 1, unit: '°C' } : null,
        isDry ? { type: 'seg', key: 'dryClass', label: 'Yalıtım sınıfı', options: [['F', 'F (155 °C)'], ['H', 'H (180 °C)']] } : null,
        { type: 'note', text: 'Önayarlar 36 kV sınıfı yağlı dağıtım trafoları için örnek katalog değerleridir; kuru tip ve projedeki trafo için etiket/katalog değerlerini girin. 34,5/0,4 kV yalnızca örnektir; bölgenizdeki OG işletme gerilimini dağıtım şirketinden doğrulayın.' }
      ] },
      { title: 'Yük', items: [
        { type: 'range', key: 'P_kW', label: s.profile !== 'sabit' ? 'Tepe yük (aktif güç)' : 'Yük aktif gücü P', min: 0, max: Pmax, step: s.Sr_kVA > 800 ? 10 : 5, unit: 'kW' },
        { type: 'range', key: 'cos', label: 'Yük cosφ (kompanzasyonsuz)', min: 0.6, max: 1, step: 0.01, digits: 2 },
        { type: 'select', key: 'profile', label: 'Günlük yük profili', options: Object.keys(C.PROFILES).map(k => [k, C.PROFILES[k].name]) },
        { type: 'range', key: 'ambient', label: 'Ortam sıcaklığı (köşk içi)', min: -10, max: 45, step: 1, unit: '°C' },
        { type: 'number', key: 'lossPrice', label: 'Kayıp enerjisi birim fiyatı', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2, help: 'Yıllık kayıp maliyeti için; güncel tarifenizi girin.' },
        r ? { type: 'note', html: 'S <b>' + fmt(r.S / 1e3, 1, 'kVA') + '</b> · K <b>%' + fmt(r.k * 100, 0) + '</b> · I2 <b>' + fmt(r.I2, 0, 'A') + '</b> / ' + fmt(r.I2n, 0, 'A') } : null
      ] },
      { title: 'AG kompanzasyon', items: [
        { type: 'toggle', key: 'cap.on', label: 'Kondansatör bankası (AG bara)', rebuild: true },
        s.cap.on ? { type: 'number', key: 'cap.kvar', label: 'Toplam güç Qc', min: 0, max: 20000, step: 5, unit: 'kVAr' } : null,
        s.cap.on ? { type: 'number', key: 'cap.steps', label: 'Kademe sayısı', min: 1, max: 24, step: 1 } : null,
        { type: 'note', html: 'cosφ 0,95 için gereken ≈ <b>' + fmt(C.capNeeded(Number(s.P_kW), Number(s.cos), 0.95), 0, 'kVAr') + '</b>. Harmonik ortamda ayarlı reaktörlü bankayı Kompanzasyon simülasyonunda inceleyin.' }
      ] },
      { title: 'OG şebeke, gerilim ve kademe', items: [
        { type: 'range', key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü SkQ', min: 20, max: 1500, step: 10, unit: 'MVA', help: 'Dağıtım şirketinden alınan bağlantı noktası değeri; kısa devre sonucu yaklaşıktır.' },
        { type: 'range', key: 'uNet', label: 'OG şebeke gerçek gerilimi', min: 90, max: 110, step: 0.5, unit: '%', digits: 1 },
        { type: 'buttons', items: [{ label: 'Kademe ↑ (OG +%2,5 → AG düşer)', onClick: a => { setTap(a, -1); a.renderControls(); a.invalidate(); } }, { label: 'Kademe ↓ (OG −%2,5 → AG yükselir)', onClick: a => { setTap(a, 1); a.renderControls(); a.invalidate(); } }] },
        { type: 'note', html: 'Kademe: <b>' + (C.TAPS.indexOf(Number(s.tap)) + 1) + ' / 5</b> (OG sarımı ' + tapLabel(Number(s.tap)) + ')' + (r && r.ext.en.mv ? ' · AG yükte <b>' + fmt(r.ext.Ulv, 1, 'V') + '</b>' : '') + '. Yüksüz kademe değiştirici yalnız trafo enerjisizken çevrilir.' }
      ] },
      { title: 'OG hücreler (' + s.cells.length + ')', items: [
        { type: 'custom', render: (box, a) => {
          const list = VS.el('div', { class: 'vs-cl', style: s.cells.length > 8 ? 'max-height:300px;overflow:auto' : null });
          const tpi = tpIndex(s);
          s.cells.forEach((c, i) => {
            const row = VS.el('div', { class: 'vs-cl__row', 'data-level': i === tpi ? 'warn' : 'ok' });
            row.appendChild(VS.el('div', { class: 'vs-cl__name', title: CELL_TYPES[c.type].name }, [VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: (i + 1) + '. ' + c.name }), VS.el('small', { text: CELL_TYPES[c.type].name + (i === tpi ? ' · trafo beslemesi' : '') })]));
            row.appendChild(VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-label': c.name + ' hücresini sil', text: 'Sil', onclick: () => {
              if (a.state.cells.length <= 1) { VS.toast('En az bir hücre kalmalı.'); return; }
              a.state.cells.splice(i, 1); if (!kindOf(a.state)) VS.toast('Trafo koruma hücresi kalmadı: kesicili ya da sigortalı hücre ekleyin.', 'bad');
              // manevra durumu yalnız trafo koruma hücresi silinince sıfırlanır (topraklı/ayrılmış trafo sessizce enerjilenmez)
              if (i === tpi) { a.state.sw = C.initialSw(); if (a.live.events) a.live.events.push(clock(a.live.clock) + ' trafo koruma hücresi silindi — manevra durumu başlangıca alındı'); }
              a.renderControls(); a.invalidate();
            } }));
            list.appendChild(row);
          });
          box.appendChild(list);
          const add = VS.el('div', { class: 'vs-btns' });
          Object.keys(CELL_TYPES).forEach(t => add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ ' + CELL_TYPES[t].short.charAt(0) + CELL_TYPES[t].short.slice(1).toLocaleLowerCase('tr-TR'), title: CELL_TYPES[t].name, onclick: () => {
            const n = a.state.cells.filter(c => c.type === t).length + 1;
            a.state.cells.push({ type: t, name: { line: 'Hat ', cb: 'Trafo koruma ', fuse: 'Trafo koruma ', meas: 'Ölçü ', coup: 'Kuplaj ' }[t] + n });
            a.renderControls(); a.invalidate();
          } })));
          box.appendChild(add);
        } },
        kind === 'cb' ? { type: 'number', key: 'relay.Ip', label: 'Röle 51 · I> (primer)', min: 0.1, max: 5000, step: 0.5, unit: 'A', digits: 1, help: r ? 'Önerilen ' + fmt(r.ext.relay.ipMin, 1) + '–' + fmt(r.ext.relay.ipMax, 1) + ' A (bilgi).' : null } : null,
        kind === 'cb' ? { type: 'number', key: 'relay.tp', label: 'Röle 51 · zaman çarpanı / gecikme', min: 0.05, max: 10, step: 0.05, unit: 's', digits: 2 } : null,
        kind === 'cb' ? { type: 'number', key: 'relay.Ihs', label: 'Röle 50 · I>> (primer)', min: 1, max: 50000, step: 5, unit: 'A', help: r ? 'AG arızasında seçicilik için ≥ ' + fmt(r.ext.relay.ihsMin, 0) + ' A.' : null } : null,
        kind === 'cb' ? { type: 'number', key: 'relay.Ie', label: 'Röle 50N/51N · Io> (primer)', min: 0.1, max: 1000, step: 0.5, unit: 'A', digits: 1 } : null,
        kind === 'fuse' ? { type: 'select', key: 'fuseIn', label: 'OG HRC sigortası', options: C.MV_FUSES.map(f => [f, fmt(f, f % 1 ? 1 : 0) + ' A']) } : null
      ] },
      { title: 'OG manevra (trafo hücresi)', items: [
        { type: 'note', html: '<b>Durum:</b> ' + VS.esc(swSummary(s)) },
        { type: 'buttons', items: opButtons(s).map(b => ({ label: b.label, variant: b.variant, onClick: a => { doOp(a, b.op); a.renderControls(); a.invalidate(); } })) },
        kind ? { type: 'note', text: 'Güvenli enerjisiz bırakma: ' + C.isolationSequence(kind).map(op => C.opLabel(op, kind)).join(' → ') + '. Enerjilemede ters sıra. Kilitlemeye aykırı işlem reddedilir; 3D’de hücreye tıklayarak da yapılabilir.' } : null
      ] },
      { title: 'AG ana şalter (ACB)', items: [
        { type: 'select', key: 'acb.In', label: 'Çerçeve anma akımı In', options: ACB_IN.map(v => [v, v + ' A']) },
        { type: 'range', key: 'acb.Ir', label: 'Uzun gecikme ayarı Ir', min: 0.4, max: 1, step: 0.05, digits: 2, fmt: v => fmt(v, 2) + ' × In' },
        { type: 'select', key: 'acb.Icu', label: 'Kesme kapasitesi Icu', options: [25, 36, 42, 50, 65, 80, 100, 150].map(v => [v, v + ' kA']) }
      ] },
      { title: 'Koruma ve alarmlar', items: [
        { type: 'range', key: 'alarmOil', label: (isDry ? 'Sargı sıcaklık rölesi' : 'Yağ termometresi') + ' · alarm', min: 50, max: 200, step: 1, unit: '°C', help: 'Örnek röle ayarı.' },
        { type: 'range', key: 'tripOil', label: (isDry ? 'Sargı sıcaklık rölesi' : 'Yağ termometresi') + ' · açma', min: 60, max: 210, step: 1, unit: '°C', help: 'Örnek röle ayarı. Açmada OG kesici/yük ayırıcı açar.' },
        { type: 'buttons', items: [
          { label: 'Soğuk başlangıç', onClick: a => { a.live = initLive(a.state); a.running = true; a.paused = false; a.syncToolbar(); } },
          { label: 'Buchholz testi (gaz alarmı)', onClick: a => { if (dry(a.state)) { VS.toast('Kuru tip trafoda Buchholz rölesi yoktur.'); return; } a.live.buch = !a.live.buch; a.live.events.push(clock(a.live.clock) + (a.live.buch ? ' Buchholz test: gaz alarmı' : ' Buchholz alarmı sıfırlandı')); } }
        ] },
        { type: 'note', text: 'Yağlı trafoda Buchholz (gaz/ani yağ akışı), yağ seviyesi ve termometre alarmları; kuru tipte PT100 sargı sıcaklık rölesi. Ayarlar örnektir.' }
      ] },
      { title: 'Paralel çalışma (bilgi)', collapsed: true, summary: 'İkinci trafo ile koşullar', items: [
        { type: 'toggle', key: 'par.on', label: 'İkinci trafo ile paralel kontrolü', rebuild: true },
        s.par.on ? { type: 'number', key: 'par.Sr', label: 'İkinci trafo Sr', min: 25, max: 40000, step: 5, unit: 'kVA' } : null,
        s.par.on ? { type: 'number', key: 'par.uk', label: 'İkinci trafo uk', min: 2, max: 20, step: 0.1, unit: '%', digits: 1 } : null,
        s.par.on ? { type: 'select', key: 'par.vg', label: 'İkinci trafo bağlantı grubu', options: [['Dyn11', 'Dyn11'], ['Dyn5', 'Dyn5'], ['Yzn11', 'Yzn11'], ['Yyn0', 'Yyn0']] } : null,
        s.par.on ? { type: 'number', key: 'par.ratioDiff', label: 'Dönüştürme oranı farkı', min: -5, max: 5, step: 0.1, unit: '%', digits: 1 } : null
      ] },
      { title: 'Görünüm', items: [
        { type: 'toggle', key: 'cutaway', label: 'Kesit görünümü (ön duvar ve çatı gizli)', help: 'Kapatınca köşk kapalı görünür; içini “Şeffaf kapak” aracıyla görebilirsiniz.' },
        { type: 'note', html: 'Köşk içi yerleşim ve ölçüler için <a class="vs-jump" href="/araclar/beton-kosk-yerlesim/">Beton köşk yerleşim aracı</a>.' }
      ] },
      isDry ? null : { title: 'Isıl parametreler', collapsed: true, summary: 'IEC 60076-7 varsayılanları / üretici verisi', items: [
        { type: 'note', text: 'Üretici ısıl verisi girilmezse IEC 60076-7 dağıtım trafosu (ONAN) varsayılanları kullanılır; sıcaklık ve yaşlanma sonuçları bu durumda göstergedir.' },
        { type: 'toggle', key: 'thermalOn', label: 'Üretici ısıl verisini kullan', rebuild: true },
        s.thermalOn ? { type: 'number', key: 'th.dThetaOr', label: 'Anma üst yağ sıcaklık artışı Δθor', min: 20, max: 80, step: 1, unit: 'K' } : null,
        s.thermalOn ? { type: 'number', key: 'th.Hgr', label: 'Sıcak nokta – üst yağ farkı H·gr', min: 5, max: 50, step: 0.5, unit: 'K', digits: 1 } : null,
        s.thermalOn ? { type: 'number', key: 'th.R', label: 'Kayıp oranı R = Pk/P0', min: 1, max: 20, step: 0.1, digits: 1 } : null,
        s.thermalOn ? { type: 'number', key: 'th.x', label: 'Yağ üssü x', min: 0.5, max: 1.2, step: 0.05, digits: 2 } : null,
        s.thermalOn ? { type: 'number', key: 'th.y', label: 'Sargı üssü y', min: 1, max: 2.5, step: 0.05, digits: 2 } : null,
        s.thermalOn ? { type: 'number', key: 'th.tauO', label: 'Yağ zaman sabiti τo', min: 30, max: 400, step: 5, unit: 'dk' } : null,
        s.thermalOn ? { type: 'number', key: 'th.tauW', label: 'Sargı zaman sabiti τw', min: 1, max: 20, step: 0.5, unit: 'dk', digits: 1 } : null,
        s.thermalOn ? { type: 'buttons', items: [{ label: 'IEC 60076-7 varsayılanlarına dön', onClick: a => { a.state.th = Object.assign({}, TR.THERMAL_ONAN); a.renderControls(); a.invalidate(); } }] } : null
      ] }
    ];
  }

  /* ---------------------------------------------------------------- zaman adımı */
  function initLive(s) {
    const a = Number(s && s.ambient) || 20;
    return { temps: { topOil: a, dTh: 0, hotSpot: a }, clock: 6 * 60, hist: [], histT: 0, ageH: 0, tripped: false, alarm: false, fans: false, buch: false, events: [], bucket: -1 };
  }
  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const s = app.state, L = app.live, v = res.values;
    const dtMin = dt * MIN_PER_S;
    L.clock += dtMin;
    if (dry(s)) {
      const a = 1 - Math.exp(-dtMin / 60); // döküm reçine sargı zaman sabiti ≈ 60 dk (örnek)
      const dTh = L.temps.dTh + (v.temps.dTh - L.temps.dTh) * a;
      L.temps = { topOil: Number(s.ambient), dTh: dTh, hotSpot: Number(s.ambient) + dTh };
    } else {
      L.temps = TR.stepTemps(L.temps, v.temps, dtMin, v.thermal);
      L.ageH += TR.agingRate(L.temps.hotSpot) * dtMin / 60;
    }
    const mon = dry(s) ? L.temps.hotSpot : L.temps.topOil;
    if (s.cooling === 'AF') {
      const f = C.fanControl(L.fans, mon, s.fanOn, s.fanOff);
      if (f !== L.fans) { L.fans = f; L.events.push(clock(L.clock) + (f ? ' fanlar devreye girdi' : ' fanlar durdu') + ' (' + fmt(mon, 0) + ' °C)'); app.invalidate(); }
    } else L.fans = false;
    const wasAlarm = L.alarm;
    L.alarm = !L.tripped && mon >= s.alarmOil;
    if (L.alarm && !wasAlarm) L.events.push(clock(L.clock) + ' sıcaklık alarmı (' + fmt(mon, 0) + ' °C)');
    const kind = kindOf(s);
    if (!L.tripped && kind && s.sw.cb && mon >= s.tripOil) {
      L.tripped = true; L.alarm = false; s.sw = Object.assign({}, s.sw, { cb: false });
      L.events.push(clock(L.clock) + ' sıcaklık açma kontağı: ' + (kind === 'cb' ? 'OG kesici' : 'yük ayırıcı') + ' açtı');
      VS.toast('Sıcaklık ' + s.tripOil + ' °C açma ayarına ulaştı: trafo devre dışı (örnek röle ayarı).', 'bad');
      app.invalidate(); if (VS.app === app) app.renderControls();
    }
    if (s.profile !== 'sabit') { const b = Math.floor(L.clock / 15); if (b !== L.bucket) { L.bucket = b; app.invalidate(); } }
    L.histT += dtMin;
    if (L.histT >= 10 || !L.hist.length) { L.histT = 0; L.hist.push([L.clock / 60, L.temps.topOil, L.temps.hotSpot]); if (L.hist.length > 433) L.hist.shift(); }
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, x = v.ext;
    const st = id => (res.checks.find(c => c.id === id) || {}).status;
    const lv = id => ({ ok: 'ok', warn: 'warn', fail: 'bad' }[st(id)]);
    const isDry = dry(s);
    const prot = live.tripped ? 'AÇTI' : live.alarm ? 'ALARM' : live.buch ? 'BUCHHOLZ ALARM' : 'Normal';
    const out = [
      { label: 'Görünür güç S', value: fmt(v.S / 1e3, 1, 'kVA'), sub: 'P ' + fmt(v.P / 1e3, 1) + ' kW · Q ' + fmt(v.Q / 1e3, 1) + ' kVAr · cosφ ' + fmt(x.cosE, 2) },
      { label: 'Yüklenme K', value: '%' + fmt(v.k * 100, 1), level: lv('load'), sub: 'K_opt (en yüksek verim) %' + fmt(v.kOpt * 100, 0) },
      { label: 'OG akımı I1', value: fmt(v.I1, 1, 'A'), sub: 'anma I1n ' + fmt(v.I1n, 1, 'A') + ' · ' + fmt(s.U1_kV, 1) + ' kV' },
      { label: 'AG akımı I2', value: fmt(v.I2, 0, 'A'), sub: 'anma I2n ' + fmt(v.I2n, 0, 'A') + ' · ' + s.U2_V + ' V' },
      { label: 'Boşta kayıp P0', value: fmt(x.en.mv ? v.P0 : 0, 0, 'W'), sub: x.en.mv ? 'enerjili olduğu sürece sabit' : 'trafo enerjisiz' },
      { label: 'Yük kaybı Pk·K²', value: fmt(v.Pcu, 0, 'W'), sub: 'Pk ' + fmt(s.Pk, 0) + ' W @ K = 1' },
      { label: 'Toplam kayıp', value: fmt(v.losses / 1e3, 2, 'kW'), sub: 'verim ' + (v.P > 0 ? '%' + fmt(v.eff, 2) : '—') },
      { label: 'Kayıp enerjisi', value: fmt(x.dl.Eday, 1, 'kWh/gün'), sub: 'yıllık ' + VS.fmtEnergy(x.dl.Eyear) + ' · ' + fmt(x.dl.costYear, 0, 'TL/yıl') },
      { label: 'AG gerilimi (yükte)', value: x.en.mv ? fmt(x.Ulv, 1, 'V') : '—', level: x.en.mv ? lv('ulv') : undefined, sub: x.en.mv ? 'ΔU %' + fmt(v.reg, 2) + ' · kademe ' + tapLabel(Number(s.tap)) + ' · şebeke %' + fmt(s.uNet, 1) : 'trafo enerjisiz' },
      { label: 'Ik3 yalnız trafo', value: fmt(v.IkT / 1e3, 1, 'kA'), sub: 'In/uk, sonsuz şebeke · yaklaşık' },
      { label: 'Ik3 şebeke dahil', value: fmt(v.Ik / 1e3, 1, 'kA'), sub: 'ip ' + fmt(v.ip / 1e3, 1) + ' kA · yaklaşık, tam IEC 60909 değil' },
      isDry ? { label: 'Kararlı sargı sıcak noktası', value: fmt(v.temps.hotSpot, 0, '°C'), level: lv('dry'), sub: 'sınıf ' + s.dryClass + ' sınırı ' + v.dryLimit + ' °C' }
        : { label: 'Kararlı üst yağ / sıcak nokta', value: fmt(v.temps.topOil, 0) + ' / ' + fmt(v.temps.hotSpot, 0) + ' °C', level: lv('hs'), sub: (s.thermalOn ? 'üretici verisi' : 'IEC 60076-7 varsayılanı') + (x.fansSteady ? ' · fanlı' : '') },
      { label: isDry ? 'Anlık sargı sıcaklığı' : 'Anlık üst yağ / sıcak nokta', value: isDry ? fmt(live.temps.hotSpot, 0, '°C') : fmt(live.temps.topOil, 0) + ' / ' + fmt(live.temps.hotSpot, 0) + ' °C', level: live.tripped ? 'bad' : live.alarm ? 'warn' : undefined, sub: clock(live.clock) + ' · 1 s = ' + MIN_PER_S + ' dk' },
      isDry ? { label: 'Soğutma', value: coolName(s), sub: s.cooling === 'AF' ? 'fanlar ' + (live.fans ? 'çalışıyor' : 'duruyor') : 'doğal hava' }
        : { label: 'Bağıl yaşlanma V', value: fmt(v.aging, 2) + '×', level: v.aging > 2 ? 'bad' : v.aging > 1 ? 'warn' : 'ok', sub: coolName(s) + (s.cooling === 'AF' ? ' · fanlar ' + (live.fans ? 'çalışıyor' : 'duruyor') : '') + ' · birikmiş ' + fmt(live.ageH, 1) + ' eşd. sa' },
      { label: 'OG manevra', value: x.en.lv ? 'Enerjili · yükte' : x.en.mv ? 'Enerjili · boşta' : C.isSafe(s.sw, x.kind) ? 'Güvenli · topraklı' : 'Enerjisiz', level: x.en.mv ? 'ok' : C.isSafe(s.sw, x.kind) ? 'ok' : 'warn', sub: swSummary(s), wide: true },
      { label: (isDry ? 'Sargı sıcaklık rölesi' : 'Yağ termometresi') + ' (örnek ayar)', value: prot, level: live.tripped ? 'bad' : live.alarm || live.buch ? 'warn' : 'ok', sub: 'alarm ' + s.alarmOil + ' °C · açma ' + s.tripOil + ' °C', wide: true }
    ];
    if (s.profile !== 'sabit') out.push({ label: 'Günlük yük profili', value: '×' + fmt(x.mult, 2) + ' tepe yük', sub: C.PROFILES[s.profile].name + ' · ' + clock(live.clock), wide: true });
    if (live.events.length) out.push({ label: 'Son olay', value: live.events[live.events.length - 1], wide: true });
    return out;
  }
  let curveCache = { key: '', pts: [] };
  function curve(s, cosE) {
    const base = { Sr_kVA: s.Sr_kVA, U1_kV: s.U1_kV, U2_V: s.U2_V, P0: s.P0, Pk: s.Pk, uk: s.uk, cos: cosE, ambient: s.ambient, SkQ_MVA: s.SkQ_MVA };
    const key = JSON.stringify(base);
    if (curveCache.key === key) return curveCache.pts;
    const pts = [];
    for (let K = 0.05; K <= 1.301; K += 0.025) {
      const r = TR.compute(Object.assign({}, base, { P_kW: K * base.Sr_kVA * base.cos }));
      if (r.ok) pts.push({ K: K, eff: r.values.eff, P0: r.values.P0, Pcu: r.values.Pcu, tot: r.values.losses });
    }
    curveCache = { key: key, pts: pts };
    return pts;
  }
  function charts(res, s, live) {
    const v = res.values, x = v.ext, c = curve(s, x.cosE);
    const effMin = c.filter(p => p.K >= 0.1).reduce((a, p) => Math.min(a, p.eff), 100);
    const isDry = dry(s);
    const h = live.hist.length > 1 ? live.hist : [[live.clock / 60, live.temps.topOil, live.temps.hotSpot]];
    return [{
      id: 'eff', title: 'Verim – yüklenme eğrisi (cosφ sabit)', height: 160,
      series: [{ name: 'η (%)', color: 'green', data: c.filter(p => p.K >= 0.1).map(p => [p.K * 100, p.eff]) }],
      markers: [{ x: v.kOpt * 100, label: 'K_opt %' + fmt(v.kOpt * 100, 0), color: '#22b8cf' }].concat(v.P > 0 ? [{ x: v.k * 100, y: v.eff, label: 'işletme', color: '#fcd34d' }] : []),
      x: { min: 10, max: 130, label: 'K %' }, y: { min: Math.floor(effMin * 2) / 2 - 0.2, max: 100, label: '%', fmt: y => fmt(y, 1) },
      alt: 'Verim en yüksek K_opt = %' + fmt(v.kOpt * 100, 0) + ' yüklenmede. İşletme noktası K = %' + fmt(v.k * 100, 0) + ', η = %' + fmt(v.eff, 2) + '.'
    }, {
      id: 'loss', title: 'Kayıplar: P0 sabit, Pk·K² karesel', height: 150,
      series: [
        { name: 'P0 (kW)', color: 'cyan', data: c.map(p => [p.K * 100, p.P0 / 1e3]) },
        { name: 'Pk·K² (kW)', color: 'amber', data: c.map(p => [p.K * 100, p.Pcu / 1e3]) },
        { name: 'Toplam (kW)', color: 'red', dash: [4, 3], data: c.map(p => [p.K * 100, p.tot / 1e3]) }
      ],
      markers: [{ x: v.k * 100, y: v.losses / 1e3, label: fmt(v.losses / 1e3, 2) + ' kW', color: '#fcd34d' }],
      x: { min: 0, max: 130, label: 'K %' }, y: { label: 'kW' },
      alt: 'Boşta kayıp ' + fmt(v.P0, 0) + ' W sabit; yük kaybı K² ile artar. K_opt’ta iki kayıp eşittir. Şu an toplam ' + fmt(v.losses, 0) + ' W.'
    }, {
      id: 'dayloss', title: 'Günlük kayıp profili (seçili yük profili)', height: 140, type: 'bar',
      series: [{ name: 'Kayıp (kW)', type: 'bar', color: 'amber', data: x.dl.hours.map(p => [p[0] + 0.5, p[1]]) }],
      x: { min: 0, max: 24, ticks: [0, 6, 12, 18, 24], fmt: t => String(t).padStart(2, '0') + ':00', label: 'saat' }, y: { label: 'kW' },
      alt: 'Günlük kayıp ' + fmt(x.dl.Eday, 1) + ' kWh (boşta ' + fmt(x.dl.E0, 1) + ', yük ' + fmt(x.dl.Ecu, 1) + ' kWh); yıllık ' + fmt(x.dl.Eyear, 0) + ' kWh ≈ ' + fmt(x.dl.costYear, 0) + ' TL.'
    }, {
      id: 'temp', title: 'Sıcaklık geçmişi (hızlandırılmış zaman)', height: 160,
      series: isDry ? [{ name: 'Sargı (°C)', color: 'red', data: h.map(p => [p[0], p[2]]) }] : [{ name: 'Üst yağ (°C)', color: 'amber', data: h.map(p => [p[0], p[1]]) }, { name: 'Sıcak nokta (°C)', color: 'red', data: h.map(p => [p[0], p[2]]) }],
      hLines: [{ y: s.alarmOil, label: 'Alarm ' + s.alarmOil, color: '#f59e0b' }, { y: s.tripOil, label: 'Açma ' + s.tripOil, color: '#ef4444' }],
      x: { label: 'saat', fmt: t => String(Math.round(((t % 24) + 24) % 24)).padStart(2, '0') }, y: { label: '°C', min: Math.min(0, Math.floor(Number(s.ambient) / 10) * 10) },
      alt: clock(live.clock) + ' itibarıyla ' + (isDry ? 'sargı ' + fmt(live.temps.hotSpot, 1) + ' °C' : 'üst yağ ' + fmt(live.temps.topOil, 1) + ' °C, sıcak nokta ' + fmt(live.temps.hotSpot, 1) + ' °C') + '; kararlı hedef ' + fmt(v.temps.hotSpot, 1) + ' °C (sıcak nokta).'
    }];
  }

  /* ---------------------------------------------------------------- 3D sahne */
  let A = null;
  const trash = [];
  function canvasTex(T, w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function std(k, hex, o) { return k.mat ? k.mat(hex, o) : new k.T.MeshStandardMaterial(Object.assign({ color: hex }, o || {})); }
  function assets(k) {
    if (A && A.kit === k) return A;
    const T = k.T; A = { kit: k };
    A.unit = new T.BoxGeometry(1, 1, 1);
    A.cyl = new T.CylinderGeometry(1, 1, 1, 20);
    A.shed = new T.CylinderGeometry(1, 1, 1, 20);
    A.tube = new T.CylinderGeometry(1, 1, 1, 24, 1, true);
    A.louvre = canvasTex(T, 64, 128, (g, w, h) => { g.fillStyle = '#6b737c'; g.fillRect(0, 0, w, h); for (let y = 6; y < h - 6; y += 9) { g.fillStyle = '#2a3037'; g.fillRect(4, y, w - 8, 5); g.fillStyle = '#9aa2aa'; g.fillRect(4, y + 5, w - 8, 1); } });
    A.concTex = canvasTex(T, 128, 128, (g, w, h) => { g.fillStyle = '#c9c4ba'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const c = 170 + Math.floor(Math.random() * 50); g.fillStyle = 'rgb(' + c + ',' + (c - 4) + ',' + (c - 12) + ')'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } });
    A.concTex.wrapS = A.concTex.wrapT = T.RepeatWrapping; A.concTex.repeat.set(3, 2);
    return A;
  }
  function inst(im, i, x, y, z, sx, sy, sz, tmp) { tmp.p.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.m.compose(tmp.p, tmp.q, tmp.s); im.setMatrixAt(i, tmp.m); }
  function cylM(k, geo, mat, r, h, x, y, z, parent) { const m = new k.T.Mesh(geo, mat); m.scale.set(r, h, r); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

  const CW = 0.5;
  function dims(s) {
    const Sr = clamp(Number(s.Sr_kVA) || 630, 25, 40000);
    const sT = clamp(Math.cbrt(Sr / 630), 0.75, 1.6);
    const isDry = dry(s);
    const L = (isDry ? 1.45 : 1.3) * sT, Wd = (isDry ? 0.85 : 0.78) * sT, Ht = (isDry ? 1.45 : 1.1) * sT, fd = isDry ? 0 : 0.24 * sT;
    const nC = Math.max(1, (s.cells || []).length);
    const mvW = Math.max(2.0, nC * CW + 0.7), trW = Math.max(2.5, L + 1.3), lvW = s.cap && s.cap.on ? 3.0 : 2.0, pt = 0.1, t = 0.14;
    const Lk = mvW + trW + lvW + 2 * pt, Dk = Math.max(2.5, Wd + 2 * fd + 1.2);
    return { Sr: Sr, sT: sT, L: L, Wd: Wd, Ht: Ht, fd: fd, mvW: mvW, trW: trW, lvW: lvW, pt: pt, t: t, Lk: Lk, Dk: Dk, FY: 0.35, Hi: 2.5, isDry: isDry };
  }
  function rebuildOn(s) { const d = dims(s); return [d.sT.toFixed(3), s.type, s.cooling, (s.cells || []).map(c => c.type + c.name).join(','), s.cap && s.cap.on ? 1 : 0].join('|'); }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    trash.forEach(x => x.dispose()); trash.length = 0;
    const a = assets(k), d = dims(s);
    const sc = { flows: [], cool: [], cells: [], fans: [] };
    app.scene3 = sc;
    const tmp = { p: new T.Vector3(), s: new T.Vector3(), m: new T.Matrix4(), q: new T.Quaternion() };
    const x0 = -d.Lk / 2, FY = d.FY, Hi = d.Hi, zb = -d.Dk / 2, zf = d.Dk / 2;
    const xTr = x0 + d.mvW + d.pt + d.trW / 2, xLV = x0 + d.mvW + d.trW + 2 * d.pt + d.lvW / 2;
    const xP1 = x0 + d.mvW + d.pt / 2, xP2 = x0 + d.mvW + d.pt + d.trW + d.pt / 2;

    k.ground(Math.max(120, d.Lk * 10), std(k, 0x34482a, { roughness: 1 }), 0);
    const gr = k.box(d.Lk + 6, 0.03, d.Dk + 5, M.gravel, 0, 0.015, 0.4, v.root, { noShadow: true }); gr.userData.noClip = true;

    /* --- beton köşk */
    const conc = std(k, 0xffffff, { map: a.concTex, roughness: 0.93 });
    const kiosk = k.group(null, 0, 0, 0);
    const Hw = FY + Hi;
    k.box(d.Lk + 2 * d.t, FY, d.Dk + 2 * d.t, conc, 0, FY / 2, 0, kiosk);
    k.box(d.Lk, 0.02, d.Dk, std(k, 0x8d939a, { roughness: 0.6 }), 0, FY + 0.01, 0, kiosk);
    k.box(d.Lk + 2 * d.t, Hw, d.t, conc, 0, Hw / 2, zb - d.t / 2, kiosk);
    k.box(d.t, Hw, d.Dk, conc, x0 - d.t / 2, Hw / 2, 0, kiosk);
    k.box(d.t, Hw, d.Dk, conc, -x0 + d.t / 2, Hw / 2, 0, kiosk);
    k.box(d.pt, Hi, d.Dk, conc, xP1, FY + Hi / 2, 0, kiosk);
    k.box(d.pt, Hi - 0.5, d.Dk, conc, xP2, FY + (Hi - 0.5) / 2, 0, kiosk);
    const front = k.group(kiosk, 0, 0, 0); sc.front = front;
    k.box(d.Lk + 2 * d.t, Hw, d.t, conc, 0, Hw / 2, zf + d.t / 2, front);
    const louvMat = std(k, 0xffffff, { map: a.louvre, roughness: 0.5, metalness: 0.5 });
    const doorMat = std(k, 0x5d6670, { roughness: 0.5, metalness: 0.5 });
    const xMV = x0 + d.mvW / 2;
    [[xMV, 1.0, doorMat], [xTr - d.trW * 0.22, d.trW * 0.42, louvMat], [xTr + d.trW * 0.22, d.trW * 0.42, louvMat], [xLV, 0.95, doorMat]].forEach(dr => {
      k.box(dr[1], 2.15, 0.04, dr[2], dr[0], FY + 1.1, zf + d.t + 0.02, front);
      const sg = k.screen(0.34, 0.3, 128, drawWarn, front); sg.position.set(dr[0], FY + 1.75, zf + d.t + 0.045);
    });
    const plate = k.screen(1.2, 0.2, 512, (g, w, h) => { g.fillStyle = '#0a1628'; g.fillRect(0, 0, w, h); g.fillStyle = '#fcd34d'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TRAFO MERKEZİ', w / 2, h / 2 + 2); }, front);
    plate.position.set(xTr, FY + 2.38, zf + d.t + 0.01);
    k.shell(front);
    const roof = k.group(kiosk, 0, 0, 0); sc.roof = roof;
    k.box(d.Lk + 2 * d.t + 0.24, 0.16, d.Dk + 2 * d.t + 0.24, std(k, 0x9d988f, { roughness: 0.9 }), 0, Hw + 0.08, 0, roof);
    k.shell(roof); k.explodable(roof, [0, 1.6, 0]);
    const lv1 = k.box(d.trW * 0.6, 0.5, 0.03, louvMat, xTr, FY + Hi - 0.42, zb + 0.02, kiosk);
    k.box(0.03, 0.45, 0.7, louvMat, -x0 - 0.02, FY + Hi - 0.45, 0, kiosk);
    k.pickable(lv1, 'Havalandırma panjurları', () => { const r = app.validResult && app.validResult.values; return ['Doğal havalandırma: soğuk hava kapı panjurlarından alttan girer, ısınan hava arka duvarın üstünden çıkar.', r ? 'Atılması gereken ısı ≈ trafo kayıpları ' + fmt(r.losses / 1e3, 2, 'kW') : '', 'Köşk havalandırma yeterliliği IEC 62271-202 tip testiyle doğrulanır.'].filter(Boolean); });

    /* --- OG hücreler (liste kadar; genel modüler hücre, IEC 62271-200 fikri) */
    const ch = 1.9, cd = 0.95, cz = zb + 0.06 + cd / 2;
    const cx0 = x0 + 0.35 + CW / 2;
    const tpi = tpIndex(s);
    s.cells.forEach((c, i) => {
      const x = cx0 + i * CW;
      const g = k.group(null, x, FY, cz);
      k.box(CW - 0.01, ch, cd, M.panelRAL7035, 0, ch / 2, 0, g);
      k.box(CW - 0.01, 0.05, cd + 0.01, M.darkSteel, 0, ch - 0.38, 0, g);
      const scr = k.screen(CW - 0.06, 1.0, 256, (gx, w, h) => drawCell(gx, w, h, app, i), g);
      scr.position.set(0, 1.05, cd / 2 + 0.006);
      let door = null;
      if (i === tpi) {
        k.box(CW - 0.02, 0.38, 0.45, M.panelRAL7035, 0, ch + 0.19, cd / 2 - 0.24, g);
        if (c.type === 'cb') { const relay = k.screen(0.2, 0.14, 160, (gx, w, h) => drawRelay(gx, w, h, app), g, { emissive: 0.9 }); relay.position.set(0, ch + 0.2, cd / 2 + 0.006); sc.relay = relay; }
        // kablo bölmesi: kapak (menteşeli) ve arkasında 3 kablo başlığı
        for (let j = 0; j < 3; j++) cylM(k, a.cyl, std(k, 0x8c1c1c, { roughness: 0.6 }), 0.03, 0.3, -0.13 + j * 0.13, 0.3, cd / 2 - 0.15, g);
        const piv = k.group(g, -CW / 2 + 0.01, 0, cd / 2 + 0.01);
        door = k.box(CW - 0.04, 0.5, 0.02, M.panelRAL7035, CW / 2 - 0.01, 0.3, 0.01, piv);
        k.box(0.02, 0.08, 0.03, M.plasticDark, CW - 0.07, 0.3, 0.025, piv);
        door = piv;
      } else k.box(CW - 0.04, 0.5, 0.02, M.panelRAL7035, 0, 0.3, cd / 2 + 0.01, g);
      const leds = [0, 1, 2].map(j => k.sphere(0.009, M.ledOff, -0.06 + j * 0.06, 1.62, cd / 2 + 0.012, g));
      k.explodable(g, [0, 0, 0.5]);
      k.pickable(g, () => (i + 1) + '. ' + c.name + ' · ' + CELL_TYPES[c.type].name, () => cellInfo(app, i), i === tpi ? ap => opButtons(ap.state).map(b => ({ label: b.label, variant: b.variant, onClick: x => doOp(x, b.op) })) : null);
      sc.cells.push({ i: i, scr: scr, leds: leds, door: door });
    });
    sc.lMV = k.label('OG hücreler', null, [cx0 + (s.cells.length - 1) * CW / 2, FY + ch + 0.55, cz]);

    /* --- trafo */
    const tr = k.group(null, xTr, FY, -0.05); sc.tr = tr;
    const yT0 = 0.2, top = yT0 + d.Ht;
    [-1, 1].forEach(j => { k.box(d.trW - 0.4, 0.04, 0.07, M.darkSteel, 0, 0.02, j * d.Wd * 0.32, tr); });
    [-1, 1].forEach(i => [-1, 1].forEach(j => { const w = cylM(k, a.cyl, M.darkSteel, 0.07, 0.05, i * d.L * 0.36, 0.11, j * d.Wd * 0.32, tr); w.rotation.x = Math.PI / 2; }));
    k.box(d.L * 0.9, 0.06, d.Wd * 0.85, M.darkSteel, 0, 0.17, 0, tr);
    const wMat = M.copper.clone(); wMat.emissive = new T.Color(0, 0, 0); sc.wMat = wMat;
    const bushTop = [], lvTop = [];
    if (d.isDry) {
      // döküm reçine kuru tip: açık nüve, üç bobin, üstte OG üçgen bağlantı baraları ve AG baraları
      const coilMat = std(k, 0x56657a, { roughness: 0.35, metalness: 0.05 });
      sc.coilMat = coilMat; coilMat.emissive = new T.Color(0, 0, 0);
      k.box(d.L * 0.95, 0.14, d.Wd * 0.5, M.darkSteel, 0, yT0 + 0.12, 0, tr);
      k.box(d.L * 0.95, 0.14, d.Wd * 0.5, M.darkSteel, 0, top - 0.1, 0, tr);
      [-1, 0, 1].forEach(i => {
        const cx = i * d.L * 0.32;
        cylM(k, a.cyl, coilMat, d.Wd * 0.36, d.Ht * 0.7, cx, yT0 + d.Ht * 0.5, 0, tr);
        cylM(k, a.cyl, wMat, d.Wd * 0.26, d.Ht * 0.72, cx, yT0 + d.Ht * 0.5, 0, tr);
        cylM(k, a.cyl, M.darkSteel, d.Wd * 0.13, d.Ht * 0.86, cx, yT0 + d.Ht * 0.5, 0, tr);
        bushTop.push([xTr + cx, FY + top + 0.05, -0.05 - d.Wd * 0.38]);
        lvTop.push([xTr + cx, FY + top + 0.02, -0.05 + d.Wd * 0.3, i + 1]);
      });
      lvTop.push([xTr, FY + top + 0.02, -0.05 + d.Wd * 0.3, 0]);
      k.box(d.L * 0.8, 0.03, 0.03, M.copper, 0, top - d.Ht * 0.08, -d.Wd * 0.38, tr);
      ['L1', 'L2', 'L3', 'N'].forEach((p, j) => k.box(d.L * 0.85, 0.05, 0.012, M.copper, 0, top + 0.02 - j * 0.0, d.Wd * 0.3 + j * 0.04 - 0.06, tr));
      const mon = k.box(0.22, 0.28, 0.08, M.plasticDark, d.L / 2 + 0.2, yT0 + d.Ht * 0.6, d.Wd / 2, tr);
      const dial = k.screen(0.17, 0.17, 256, (g, w, h) => drawDial(g, w, h, app), tr); dial.position.set(d.L / 2 + 0.2, yT0 + d.Ht * 0.62, d.Wd / 2 + 0.041); sc.dial = dial;
      k.pickable(mon, 'Sargı sıcaklık rölesi (PT100)', () => { const L = app.live; return ['Anlık sargı ' + fmt(L.temps.hotSpot, 1) + ' °C', 'Alarm ' + s.alarmOil + ' °C · açma ' + s.tripOil + ' °C (örnek ayar)', s.cooling === 'AF' ? 'Fanlar: ' + s.fanOn + ' °C’de devreye, ' + s.fanOff + ' °C’de durur' : 'Doğal soğutma']; });
      k.pickable(tr, 'Kuru tip trafo · döküm reçine', () => trafoInfo(app), tapActions);
      if (s.cooling === 'AF') [-1, 0, 1].forEach(i => { const f = buildFan(k, a, tr, i * d.L * 0.32, yT0 + 0.08, d.Wd * 0.45, 0.11); f.rotation.x = 0; sc.fans.push(f); });
    } else {
      const tank = k.box(d.L, d.Ht, d.Wd, M.trafoPaint, 0, yT0 + d.Ht / 2, 0, tr); k.shell(tank);
      k.shell(k.box(d.L + 0.06, 0.05, d.Wd + 0.06, M.trafoPaint, 0, top + 0.025, 0, tr));
      const finH = d.Ht * 0.84, fins = [];
      for (let x = -d.L / 2 + 0.06; x <= d.L / 2 - 0.06 + 1e-6; x += 0.05) { fins.push([x, -1]); if (x > -d.L / 2 + 0.42) fins.push([x, 1]); }
      const finIM = new T.InstancedMesh(a.unit, M.trafoPaint, fins.length);
      fins.forEach((f, i) => inst(finIM, i, f[0], yT0 + d.Ht * 0.47, f[1] * (d.Wd / 2 + d.fd / 2), 0.012, finH, d.fd, tmp));
      finIM.castShadow = true; finIM.receiveShadow = true; finIM.frustumCulled = false; tr.add(finIM); k.shell(finIM);
      k.pickable(finIM, 'Oluklu radyatör kanatları (' + coolName(s) + ')', () => { const r = app.validResult && app.validResult.values; return r ? ['Yağ doğal dolaşım; ' + (s.cooling === 'AF' ? 'fanlar ' + (app.live.fans ? 'çalışıyor (ONAF)' : 'duruyor (ONAN)') : 'hava doğal (ONAN)') + '.', 'Atılan ısı = toplam kayıp ≈ ' + fmt(r.losses / 1e3, 2, 'kW'), 'Kararlı üst yağ ' + fmt(r.temps.topOil, 1) + ' °C'] : []; });
      if (s.cooling === 'AF') [-0.3, 0.3].forEach(fx => { const f = buildFan(k, a, tr, fx * d.L, yT0 + d.Ht * 0.25, -(d.Wd / 2 + d.fd + 0.12), 0.16); f.rotation.x = Math.PI / 2; sc.fans.push(f); });
      const core = k.group(tr, 0, 0, 0);
      k.box(d.L * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + 0.1, 0, core);
      k.box(d.L * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + d.Ht * 0.86, 0, core);
      [-1, 0, 1].forEach(i => { cylM(k, a.cyl, wMat, d.Wd * 0.21, d.Ht * 0.66, i * d.L * 0.29, yT0 + d.Ht * 0.48, 0, core); cylM(k, a.cyl, M.darkSteel, d.Wd * 0.1, d.Ht * 0.78, i * d.L * 0.29, yT0 + d.Ht * 0.48, 0, core); });
      k.pickable(core, 'Sargılar ve nüve', () => { const L = app.live; return ['Üç fazlı nüve; iç AG, dış OG sargısı (temsilî).', 'Anlık sıcak nokta ' + fmt(L.temps.hotSpot, 1) + ' °C · üst yağ ' + fmt(L.temps.topOil, 1) + ' °C', 'Renk: sıcak nokta sıcaklığı (şeffaf kapakta görünür).']; });
      k.pickable(tank, 'Güç trafosu · yağlı, ' + coolName(s), () => trafoInfo(app), tapActions);
      const lid = k.group(tr, 0, 0, 0); k.explodable(lid, [0, 0.7, 0]);
      const mvB = k.group(lid, 0, 0, 0), lvB = k.group(lid, 0, 0, 0);
      [-1, 0, 1].forEach(i => {
        const bx = i * d.L * 0.28, bz = -d.Wd * 0.24;
        cylM(k, a.cyl, M.porcelainGrey, 0.035, 0.44, bx, top + 0.27, bz, mvB);
        for (let j = 0; j < 5; j++) cylM(k, a.shed, M.porcelainGrey, 0.075, 0.016, bx, top + 0.1 + j * 0.075, bz, mvB);
        cylM(k, a.cyl, M.brass, 0.022, 0.06, bx, top + 0.52, bz, mvB);
        bushTop.push([xTr + bx, FY + top + 0.55, -0.05 + bz]);
      });
      [-1.5, -0.5, 0.5, 1.5].forEach((i, j) => {
        const bx = i * d.L * 0.18, bz = d.Wd * 0.27;
        cylM(k, a.cyl, M.porcelainGrey, 0.032, 0.18, bx, top + 0.11, bz, lvB);
        for (let q = 0; q < 2; q++) cylM(k, a.shed, M.porcelainGrey, 0.06, 0.014, bx, top + 0.08 + q * 0.06, bz, lvB);
        k.box(0.06, 0.12, 0.014, M.copper, bx, top + 0.26, bz, lvB);
        lvTop.push([xTr + bx, FY + top + 0.3, -0.05 + bz, j]);
      });
      k.pickable(mvB, 'OG buşingleri', () => { const r = app.validResult && app.validResult.values; return r ? ['U1 = ' + fmt(s.U1_kV, 1) + ' kV · I1 = ' + fmt(r.I1, 1, 'A') + ' (anma ' + fmt(r.I1n, 1, 'A') + ')', 'Porselen buşing, kablo pabucu bağlantılı (temsilî).'] : []; });
      k.pickable(lvB, 'AG buşingleri (L1 L2 L3 N)', () => { const r = app.validResult && app.validResult.values; return r ? ['AG yükte ≈ ' + fmt(r.ext.Ulv, 1, 'V') + ' (kademe ' + tapLabel(Number(s.tap)) + ')', 'I2 = ' + fmt(r.I2, 0, 'A') + ' (anma ' + fmt(r.I2n, 0, 'A') + ')', 'Bağlantı grubu ' + s.vg + '.'] : []; });
      const tap = cylM(k, a.cyl, M.darkSteel, 0.06, 0.08, -d.L * 0.42, top + 0.09, 0.02, lid);
      sc.tapH = k.box(0.14, 0.025, 0.03, M.plasticDark, -d.L * 0.42, top + 0.145, 0.02, lid);
      k.pickable(tap, 'Kademe değiştirici (yüksüz, 5 kademe)', () => { const r = app.validResult && app.validResult.values; return ['Kademe ' + (C.TAPS.indexOf(Number(s.tap)) + 1) + ' / 5 · OG sarımı ' + tapLabel(Number(s.tap)), r && r.ext.en.mv ? 'AG yükte ≈ ' + fmt(r.ext.Ulv, 1, 'V') : 'Trafo enerjisiz: kademe değiştirilebilir.', 'Yalnız trafo enerjisizken çevrilir (AG ve OG açık).']; }, tapActions);
      const thg = k.group(lid, -d.L / 2 + 0.2, top + 0.2, d.Wd / 2 - 0.02);
      k.box(0.04, 0.2, 0.04, M.darkSteel, 0, -0.1, -0.04, thg);
      cylM(k, a.cyl, M.darkSteel, 0.1, 0.05, 0, 0.06, 0, thg).rotation.x = Math.PI / 2;
      const dial = k.screen(0.17, 0.17, 256, (g, w, h) => drawDial(g, w, h, app), thg); dial.position.set(0, 0.06, 0.027);
      sc.dial = dial;
      k.pickable(thg, 'Yağ termometresi (alarm/açma kontaklı)', () => { const L = app.live; return ['Anlık üst yağ ' + fmt(L.temps.topOil, 1) + ' °C', 'Alarm ' + s.alarmOil + ' °C · açma ' + s.tripOil + ' °C (örnek röle ayarı)', 'Durum: ' + (L.tripped ? 'AÇTI' : L.alarm ? 'ALARM' : 'normal')]; });
      const rp = k.screen(0.27, 0.19, 384, (g, w, h) => drawPlate(g, w, h, app), tr); rp.position.set(-d.L / 2 + 0.22, yT0 + d.Ht * 0.56, d.Wd / 2 + 0.004);
      sc.plate = rp;
      const cons = k.group(tr, d.L / 2 - 0.08, top + 0.5 * d.sT + 0.05, 0); k.explodable(cons, [0, 1.0, 0]);
      const rc = 0.13 * d.sT, lc = d.Wd * 0.95;
      const cyl = cylM(k, a.cyl, M.trafoPaint, rc, lc, 0, 0, 0, cons); cyl.rotation.x = Math.PI / 2;
      [-1, 1].forEach(j => k.box(0.04, 0.5 * d.sT, 0.04, M.darkSteel, 0, -0.25 * d.sT, j * lc * 0.35, cons));
      cylM(k, a.cyl, M.plasticWhite, rc * 0.5, 0.01, 0, 0, lc / 2 + 0.006, cons).rotation.x = Math.PI / 2;
      cylM(k, a.cyl, M.darkSteel, 0.022, 0.5 * d.sT, -0.12, -0.25 * d.sT, -lc * 0.1, cons).rotation.z = 0.5;
      const buch = k.box(0.12, 0.1, 0.11, M.panelDark, -0.12, -0.24 * d.sT, -lc * 0.1, cons);
      sc.buchLed = k.sphere(0.012, M.ledOff, -0.12, -0.17 * d.sT, -lc * 0.1 + 0.058, cons);
      const br = cylM(k, a.cyl, M.glass, 0.05, 0.22, 0.08, -0.38 * d.sT, -lc / 2 + 0.05, cons);
      cylM(k, a.cyl, std(k, 0xf08a24, { roughness: 0.8 }), 0.04, 0.16, 0.08, -0.38 * d.sT, -lc / 2 + 0.05, cons);
      k.pickable(cyl, 'Genleşme tankı (konservatör) ve yağ seviye göstergesi', () => ['Yağın sıcaklıkla genleşmesini karşılar; düşük yağ seviyesi kontağı alarm verir.', 'Anlık üst yağ ' + fmt(app.live.temps.topOil, 1) + ' °C']);
      k.pickable(buch, 'Buchholz rölesi', () => ['İç arızada biriken gazda alarm, ani yağ akışında açma verir.', 'Durum: ' + (app.live.buch ? 'GAZ ALARMI (test)' : 'normal'), 'Test düğmesi alarm kontağını dener; iç arıza modeli yoktur.'],
        () => [{ label: app.live.buch ? 'Alarmı sıfırla' : 'Test: gaz alarmı', variant: app.live.buch ? '' : 'warn', onClick: x => { x.live.buch = !x.live.buch; x.live.events.push(clock(x.live.clock) + (x.live.buch ? ' Buchholz test: gaz alarmı' : ' Buchholz alarmı sıfırlandı')); } }]);
      k.pickable(br, 'Nem alıcı (silikajel)', () => ['Genleşme tankına giren havanın nemini tutar; renk değişimi bakım ihtiyacını gösterir.']);
    }
    sc.lTr = k.label('Trafo', tr, [0, top + 0.95, 0]);

    /* --- OG kablolar: trafo koruma hücresi → arka duvar → trafo */
    const mvCab = std(k, 0x8c1c1c, { roughness: 0.6 });
    const xCellR = cx0 + Math.max(0, tpi) * CW + CW / 2;
    bushTop.forEach((b, j) => {
      const zc = zb + 0.22 + j * 0.09;
      const t1 = k.tube([[xCellR - 0.15, FY + 0.15, cz], [xCellR + 0.1, FY + 0.18, zc + 0.2], [xP1 + 0.3, FY + 0.22, zc], [b[0], FY + 0.25, zc], [b[0], Math.max(b[1] + 0.15, FY + 1.0), zc], [b[0], b[1] + 0.12, b[2] - 0.05], [b[0], b[1], b[2]]], 0.022, mvCab, v.root, 90);
      trash.push(t1.geometry);
      if (j === 1) { sc.flows.push({ f: k.flow(t1.userData.curve, 18, 0xfcd34d, 0.018), kind: 'mv' }); k.pickable(t1, 'OG kablo (tek damarlı, XLPE)', () => { const r = app.validResult && app.validResult.values; return r ? ['I1 = ' + fmt(r.I1, 1, 'A') + ' · ' + fmt(s.U1_kV, 1) + ' kV', 'Kablo kesiti ve ekran topraklaması projede seçilir (temsilî).'] : []; }); }
    });
    s.cells.forEach((c, i) => { if (c.type !== 'line') return; const t = k.tube([[cx0 + i * CW, FY + 0.12, cz], [cx0 + i * CW, FY - 0.05, cz + 0.2], [cx0 + i * CW - 0.3, -0.3, zb - 0.6]], 0.025, mvCab, v.root, 30); trash.push(t.geometry); });

    /* --- AG ana dağıtım panosu ve AG bağlantısı */
    const pw = 1.4, pz = zb + 0.06 + 0.3;
    const xPan = s.cap.on ? xLV - 0.55 : xLV;
    const lvp = k.group(null, xPan, FY, pz); k.explodable(lvp, [0, 0, 0.5]);
    k.box(pw, 0.1, 0.6, M.plasticDark, 0, 0.05, 0, lvp);
    k.box(pw, 2.0, 0.02, M.panelRAL7035, 0, 1.1, -0.29, lvp);
    [-1, 1].forEach(j => k.box(0.02, 2.0, 0.6, M.panelRAL7035, j * (pw / 2 - 0.01), 1.1, 0, lvp));
    k.box(pw, 0.03, 0.6, M.panelRAL7035, 0, 2.1, 0, lvp);
    k.box(pw - 0.04, 1.85, 0.01, M.galv, 0, 1.08, -0.26, lvp);
    k.rbox(0.42, 0.42, 0.34, 0.02, M.plasticDark, 0, 1.45, -0.08, lvp);
    k.box(0.34, 0.28, 0.02, M.plasticGrey, 0, 1.45, 0.1, lvp);
    sc.acbLed = k.sphere(0.012, M.ledGreen, 0.14, 1.6, 0.11, lvp);
    sc.acbH = k.box(0.05, 0.08, 0.04, M.plasticBlue, -0.1, 1.42, 0.12, lvp);
    const ana = k.screen(0.14, 0.14, 192, (g, w, h) => drawAnalyzer(g, w, h, app), lvp, { emissive: 0.9 }); ana.position.set(-pw / 2 + 0.16, 1.85, 0.0); sc.analyzer = ana;
    for (let i = 0; i < 4; i++) { k.rbox(0.11, 0.17, 0.1, 0.008, M.plasticDark, -pw / 2 + 0.2 + i * (pw - 0.4) / 3, 0.8, -0.18, lvp); k.box(0.03, 0.05, 0.03, M.plasticBlue, -pw / 2 + 0.2 + i * (pw - 0.4) / 3, 0.8, -0.12, lvp); }
    ['L1', 'L2', 'L3', 'N'].forEach((p, j) => k.box(pw - 0.1, 0.04, 0.01, M.copper, 0, 1.15 - j * 0.06, -0.24, lvp));
    k.pickable(lvp, 'AG ana dağıtım panosu · ACB', () => { const r = app.validResult && app.validResult.values; return r ? ['ACB ' + s.acb.In + ' A · Ir ' + fmt(r.ext.acb.Ir, 0, 'A') + ' · Icu ' + s.acb.Icu + ' kA · ' + (s.sw.lv ? 'kapalı' : 'açık'), 'I2 = ' + fmt(r.I2, 0, 'A') + ' (trafo anma ' + fmt(r.I2n, 0, 'A') + ')', 'AG bara yükte ≈ ' + (r.ext.en.mv ? fmt(r.ext.Ulv, 1, 'V') : '0 V'), 'AG barada Ik3 ≈ ' + fmt(r.Ik / 1e3, 1, 'kA') + ' (yaklaşık)'] : []; },
      ap => [{ label: ap.state.sw.lv ? 'ACB’yi aç' : 'ACB’yi kapat', variant: ap.state.sw.lv ? 'warn' : 'primary', onClick: x => doOp(x, x.state.sw.lv ? 'lvOpen' : 'lvClose') }]);
    sc.lLV = k.label('AG ana pano', lvp, [0, 2.35, 0]);
    if (s.cap.on) {
      const cp = k.group(null, xLV + 0.85, FY, zb + 0.06 + 0.3); k.explodable(cp, [0, 0, 0.5]);
      k.box(0.7, 1.9, 0.55, M.panelRAL7035, 0, 1.0, 0, cp);
      const n = clamp(Math.round(Number(s.cap.steps) || 1), 1, 24);
      for (let j = 0; j < Math.min(n, 12); j++) cylM(k, a.cyl, M.alu, 0.05, 0.22, -0.2 + (j % 4) * 0.13, 0.4 + Math.floor(j / 4) * 0.4, 0.2, cp);
      const rel = k.screen(0.14, 0.1, 160, (g, w, h) => drawPfRelay(g, w, h, app), cp, { emissive: 0.9 }); rel.position.set(0, 1.65, 0.28); sc.pfRelay = rel;
      k.pickable(cp, 'AG kompanzasyon panosu', () => { const r = app.validResult && app.validResult.values; return r ? [fmt(s.cap.kvar, 0) + ' kVAr · ' + s.cap.steps + ' kademe · reaktif güç rölesi', 'cosφ ' + fmt(s.cos, 2) + ' → ' + fmt(r.ext.cosE, 3), 'Trafo kVA yükünü azaltır; ayrıntı: Kompanzasyon simülasyonu.'] : []; },
        () => [{ label: 'Bankayı devreden çıkar', onClick: x => { x.state.cap.on = false; } }]);
      const t = k.tube([[xPan + pw / 2, FY + 2.0, pz], [xLV + 0.85, FY + 2.05, pz]], 0.02, M.cableBlack, v.root, 10); trash.push(t.geometry);
    }
    lvTop.forEach(b => {
      const off = (b[3] - 1.5) * 0.08;
      const t = k.tube([[b[0], b[1], b[2]], [b[0], FY + Hi - 0.25, b[2] - 0.2], [xP2 - 0.2, FY + Hi - 0.2, zb + 0.5 + off], [xP2 + 0.3, FY + Hi - 0.2, zb + 0.5 + off], [xPan + off * 3, FY + 2.12, pz + off]], 0.028, M.cableBlack, v.root, 80);
      trash.push(t.geometry);
      if (b[3] === 0) sc.flows.push({ f: k.flow(t.userData.curve, 20, 0xfcd34d, 0.02), kind: 'lv' });
    });

    /* --- topraklama */
    const ring = k.group(null, 0, 0, 0);
    const rx = d.Lk / 2 + 1.0, rz = d.Dk / 2 + 1.0;
    [rz, -rz].forEach(z => k.box(2 * rx, 0.012, 0.04, M.copper, 0, 0.035, z, ring));
    [rx, -rx].forEach(x => k.box(0.04, 0.012, 2 * rz, M.copper, x, 0.035, 0.0, ring));
    [[rx, rz], [rx, -rz], [-rx, rz], [-rx, -rz]].forEach(p => { k.box(0.3, 0.05, 0.3, M.concreteDark, p[0], 0.03, p[1], ring); cylM(k, a.cyl, M.copper, 0.012, 0.08, p[0], 0.08, p[1], ring); });
    const eb = k.box(0.6, 0.05, 0.012, M.copper, xP2 - 0.45, FY + 0.45, zb + 0.012, v.root);
    [[xTr + d.L * 0.3, FY + 0.25, -0.05 + d.Wd / 2], [xPan - 0.3, FY + 0.2, pz], [cx0 + Math.max(0, tpi) * CW, FY + 0.1, zb + 0.1]].forEach(tg => {
      const t = k.tube([[xP2 - 0.45, FY + 0.45, zb + 0.03], [(xP2 - 0.45 + tg[0]) / 2, FY + 0.08, zb + 0.15], [tg[0], tg[1], tg[2]]], 0.009, M.PE, v.root, 30); trash.push(t.geometry);
    });
    k.pickable(eb, 'Ana topraklama barası', () => ['Koruma topraklaması: köşk donatısı, trafo gövdesi, OG hücre gövdeleri, AG pano PE barası.', 'İşletme (nötr) ve koruma topraklamasının birleştirilmesi topraklama direnci ve dokunma gerilimi hesabına bağlıdır (Elektrik Tesislerinde Topraklamalar Yönetmeliği).', 'Hesap için: 3D Topraklama simülasyonu.']);
    k.pickable(ring, 'Topraklama halkası', () => ['Köşk temelini çevreleyen yatay topraklayıcı (temsilî).']);
    k.label('Topraklama barası', eb, [0, 0.12, 0.05], 'vs-label--sm');

    /* --- soğutma havası akışı (yalnız görsel) */
    [-1, 1].forEach(j => {
      const xo = xTr + j * d.L * 0.25, zo = d.Wd / 2 + d.fd + 0.1;
      const inC = new T.CatmullRomCurve3([[xo, FY + 0.3, zf + 0.2], [xo, FY + 0.25, zo], [xo, FY + 0.9, zo - 0.02]].map(p => new T.Vector3(p[0], p[1], p[2])));
      const outC = new T.CatmullRomCurve3([[xo, FY + 0.95, zo - 0.02], [xo, FY + top + 0.4, d.Wd * 0.2], [xo * 0.5 + xTr * 0.5, FY + Hi - 0.35, zb + 0.3], [xo * 0.5 + xTr * 0.5, FY + Hi - 0.42, zb - 0.4]].map(p => new T.Vector3(p[0], p[1], p[2])));
      sc.cool.push(k.flow(inC, 10, 0x7dd3fc, 0.022), k.flow(outC, 16, 0xfb923c, 0.024));
    });

    app.def.scene.bounds = [x0 - 0.3, -x0 + 0.3];
    const vkey = d.Lk.toFixed(1);
    if (v.__trViewKey !== vkey) {
      v.__trViewKey = vkey;
      v.setView({ target: [0, 1.25, 0], r: d.Lk * 0.95 + 3.2, theta: 0.32, phi: 1.12, limits: { rMin: 1.2, rMax: Math.max(30, d.Lk * 4), phiMax: 1.5 } });
    }
    v.setShadowBox(Math.max(6, d.Lk * 0.85), 50);
    v.sun.position.set(5, 11, 8); v.sun.target.position.set(0, 1, 0); v.sun.target.updateMatrixWorld();
    sc.state = '';
  }
  function buildFan(k, a, parent, x, y, z, r) {
    const g = k.group(parent, x, y, z);
    cylM(k, a.tube, k.mats.darkSteel, r, 0.06, 0, 0, 0, g);
    const rot = k.group(g, 0, 0, 0);
    for (let j = 0; j < 4; j++) { const b = k.box(r * 1.7, 0.01, r * 0.35, k.mats.plasticDark, 0, 0, 0, rot); b.rotation.y = j * Math.PI / 4 * 2; b.rotation.x = 0.35; }
    g.userData.rot = rot;
    return g;
  }
  function tapActions(ap) {
    return [{ label: 'Kademe ↑ (AG düşer)', onClick: x => setTap(x, -1) }, { label: 'Kademe ↓ (AG yükselir)', onClick: x => setTap(x, 1) }];
  }

  function cellInfo(app, i) {
    const r = app.validResult && app.validResult.values, s = app.state, L = app.live, c = s.cells[i];
    if (!r || !c) return [];
    const tpi = tpIndex(s);
    const base = ['Metal muhafazalı modüler OG hücre (genel temsil, IEC 62271-200) · ' + fmt(s.U1_kV, 1) + ' kV'];
    if (c.type === 'line') return base.concat(['Yük ayırıcı + topraklama ayırıcısı; ring (halka) beslemede giriş/çıkış.', 'Gerilim varlık göstergeleri kapakta.']);
    if (c.type === 'meas') return base.concat(['Akım (AT) ve gerilim (GT) trafoları ile OG ölçü — temsilî.', 'Ölçü düzeni dağıtım şirketi ve ölçüm mevzuatına göre belirlenir.']);
    if (c.type === 'coup') return base.concat(['Kuplaj / bara bölümleme: iki bara bölümünü kesici veya yük ayırıcı ile bağlar (temsilî).']);
    if (i !== tpi) return base.concat(['Ek trafo koruma hücresi (temsilî): bu simülasyonda trafo ilk koruma hücresinden beslenir.']);
    const x = r.ext;
    return base.concat([c.type === 'cb' ? 'Vakum kesici + ayırıcı + topraklama ayırıcısı; koruma rölesi 50/51/50N/51N: I> ' + fmt(s.relay.Ip, 1) + ' A, I>> ' + fmt(s.relay.Ihs, 0) + ' A, Io> ' + fmt(s.relay.Ie, 1) + ' A.' : 'Sigortalı yük ayırıcı: ' + fmt(s.fuseIn, 1) + ' A HRC sigorta kısa devreyi keser; sıcaklık kontağı açma bobiniyle açtırır.',
      'I1 = ' + fmt(r.I1, 1, 'A') + ' · I1n = ' + fmt(r.I1n, 1, 'A'), 'Manevra: ' + swSummary(s), x.en.mv ? 'Kablo tarafı gerilim altında' : C.isSafe(s.sw, x.kind) ? 'Topraklı, güvenli çalışma durumu' : 'Enerjisiz (topraklanmamış)', L.tripped ? 'Sıcaklık açması ile açıldı.' : null].filter(Boolean));
  }
  function trafoInfo(app) {
    const r = app.validResult && app.validResult.values, s = app.state; if (!r) return [];
    return [(dry(s) ? 'Kuru tip (döküm reçine), sınıf ' + s.dryClass : 'Yağlı') + ' · ' + coolName(s) + ' · ' + s.vg,
      'Sr = ' + fmt(s.Sr_kVA, 0) + ' kVA · ' + fmt(s.U1_kV, 1) + ' / ' + fmt(s.U2_V / 1000, 2) + ' kV · kademe ' + tapLabel(Number(s.tap)),
      'uk %' + fmt(s.uk, 1) + ' (uR %' + fmt(r.ur, 2) + ', uX %' + fmt(r.ux, 2) + ') · P0 ' + fmt(s.P0, 0) + ' W · Pk ' + fmt(s.Pk, 0) + ' W',
      'K = %' + fmt(r.k * 100, 1) + ' · kayıp ' + fmt(r.losses / 1e3, 2, 'kW') + ' · η %' + fmt(r.eff, 2),
      'AG yükte ≈ ' + (r.ext.en.mv ? fmt(r.ext.Ulv, 1, 'V') : '0 V (enerjisiz)')];
  }

  /* kanvas çizimleri */
  function drawWarn(g, w, h) {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c200'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 16, h * 0.66); g.lineTo(16, h * 0.66); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2 + 6, 24); g.lineTo(w / 2 - 8, 50); g.lineTo(w / 2 + 2, 50); g.lineTo(w / 2 - 6, 68); g.lineTo(w / 2 + 10, 42); g.lineTo(w / 2, 42); g.closePath(); g.fill();
    g.font = 'bold 12px Arial'; g.textAlign = 'center'; g.fillText('DİKKAT! YÜKSEK', w / 2, h * 0.8); g.fillText('GERİLİM', w / 2, h * 0.93);
  }
  /** Hücre ön yüzü: mimik şema hücre tipine ve (trafo hücresinde) manevra durumuna göre çizilir. */
  function drawCell(g, w, h, app, i) {
    const s = app.state, c = s.cells[i]; if (!c) return;
    const tp = i === tpIndex(s), sw = s.sw || {};
    g.fillStyle = '#d7d9d6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0a1628'; g.fillRect(8, 8, w - 16, 40); g.fillStyle = '#fcd34d'; g.font = 'bold 22px Arial'; g.textAlign = 'center';
    g.fillText(CELL_TYPES[c.type].short, w / 2, 36);
    g.fillStyle = '#1b2430'; g.font = '15px Arial'; g.fillText(String(c.name).slice(0, 16), w / 2, 70);
    g.strokeStyle = '#1b2430'; g.lineWidth = 6; g.lineCap = 'round';
    const cx = w / 2, y0 = 100;
    g.beginPath(); g.moveTo(14, y0); g.lineTo(w - 14, y0); g.stroke();
    const sym = (closed, y, kind) => {
      g.beginPath(); g.moveTo(cx, y); g.lineTo(closed ? cx : cx + 26, y + 46); g.stroke();
      if (kind === 'cb') g.strokeRect(cx - 18, y + 4, 36, 38);
    };
    g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + 30); g.stroke();
    if (c.type === 'cb') { sym(tp ? sw.ds : true, y0 + 30); g.beginPath(); g.moveTo(cx, y0 + 76); g.lineTo(cx, y0 + 96); g.stroke(); sym(tp ? sw.cb : true, y0 + 96, 'cb'); }
    else if (c.type === 'fuse') { sym(tp ? sw.cb : true, y0 + 30); g.strokeRect(cx - 10, y0 + 90, 20, 46); }
    else if (c.type === 'meas') { sym(true, y0 + 30); g.beginPath(); g.arc(cx - 14, y0 + 116, 16, 0, Math.PI * 2); g.arc(cx + 14, y0 + 116, 16, 0, Math.PI * 2); g.stroke(); }
    else if (c.type === 'coup') { sym(true, y0 + 30, 'cb'); g.beginPath(); g.moveTo(cx, y0 + 76); g.lineTo(cx, y0 + 110); g.lineTo(w - 14, y0 + 110); g.stroke(); }
    else sym(true, y0 + 30);
    g.beginPath(); g.moveTo(cx, y0 + 142); g.lineTo(cx, y0 + 230); g.stroke();
    // topraklama ayırıcısı
    const es = tp ? sw.es : false;
    g.beginPath(); g.moveTo(cx, y0 + 190); g.lineTo(es ? cx + 40 : cx + 34, es ? y0 + 190 : y0 + 172); g.moveTo(cx + 40, y0 + 190); g.lineTo(cx + 40, y0 + 204); g.moveTo(cx + 26, y0 + 208); g.lineTo(cx + 54, y0 + 208); g.moveTo(cx + 32, y0 + 216); g.lineTo(cx + 48, y0 + 216); g.stroke();
    g.fillStyle = '#1b2430'; g.beginPath(); g.moveTo(cx - 12, y0 + 232); g.lineTo(cx + 12, y0 + 232); g.lineTo(cx, y0 + 250); g.fill();
    const on = tp ? !!(sw.cb && (c.type === 'fuse' || sw.ds) && !sw.es) : true;
    g.fillStyle = on ? '#b91c1c' : '#15803d'; g.fillRect(cx - 44, y0 + 268, 88, 30);
    g.fillStyle = '#fff'; g.font = 'bold 18px Arial'; g.fillText(on ? 'GERİLİMDE' : (es ? 'TOPRAKLI' : 'AÇIK'), cx, y0 + 290);
    g.fillStyle = '#2d333b'; [[cx - 30, y0 + 330], [cx + 30, y0 + 330]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 13, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = '#3a4250'; g.font = '14px Arial'; g.fillText(fmt(s.U1_kV, 1) + ' kV', cx, y0 + 372);
  }
  function drawRelay(g, w, h, app) {
    const r = app.validResult && app.validResult.values, L = app.live || {}, s = app.state;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 14px monospace'; g.fillText('RÖLE 50/51/N', 8, 18);
    if (!r) return;
    g.fillStyle = '#e2e8f0'; g.font = 'bold 16px monospace'; g.fillText('I1 ' + fmt(r.I1, 1) + ' A', 8, 44);
    g.font = '12px monospace'; g.fillStyle = '#94a3b8'; g.fillText('I> ' + fmt(s.relay.Ip, 0) + ' I>> ' + fmt(s.relay.Ihs, 0), 8, 62);
    g.fillStyle = L.tripped ? '#ef4444' : L.alarm ? '#f59e0b' : s.sw.cb ? '#4ade80' : '#94a3b8'; g.font = 'bold 16px monospace';
    g.fillText(L.tripped ? 'AÇMA: TERMİK' : L.alarm ? 'ALARM' : s.sw.cb ? 'NORMAL' : 'KESİCİ AÇIK', 8, 88);
  }
  function drawPfRelay(g, w, h, app) {
    const r = app.validResult && app.validResult.values;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 14px monospace'; g.fillText('cosφ RÖLESİ', 8, 20);
    if (!r) return;
    g.fillStyle = '#fcd34d'; g.font = 'bold 26px monospace'; g.fillText(fmt(r.ext.cosE, 3), 8, 60);
  }
  function drawAnalyzer(g, w, h, app) {
    const r = app.validResult && app.validResult.values;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 18px monospace'; g.fillText('AG ANALİZÖR', 10, 24);
    if (!r) return;
    const rows = [['U', fmt(r.ext.en.mv ? r.ext.Ulv : 0, 0) + ' V'], ['I', fmt(r.I2, 0) + ' A'], ['P', fmt(r.P / 1e3, 0) + ' kW'], ['PF', fmt(r.ext.cosE, 2)]];
    g.font = 'bold 22px monospace';
    rows.forEach((x, i) => { g.fillStyle = '#94a3b8'; g.textAlign = 'left'; g.fillText(x[0], 10, 60 + i * 34); g.fillStyle = '#fcd34d'; g.textAlign = 'right'; g.fillText(x[1], w - 10, 60 + i * 34); });
    g.textAlign = 'left';
  }
  function drawDial(g, w, h, app) {
    const s = app.state, L = app.live || { temps: { topOil: 20, hotSpot: 20 } };
    const isDry = dry(s), maxT = isDry ? 200 : 140, val = isDry ? L.temps.hotSpot : L.temps.topOil;
    const cx = w / 2, cy = h / 2, R = w * 0.46;
    g.fillStyle = '#1b2430'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5, ang = t => a0 + clamp(t / maxT, 0, 1) * span;
    g.lineWidth = 12;
    g.strokeStyle = '#f59e0b'; g.beginPath(); g.arc(cx, cy, R - 14, ang(s.alarmOil), ang(s.tripOil)); g.stroke();
    g.strokeStyle = '#ef4444'; g.beginPath(); g.arc(cx, cy, R - 14, ang(s.tripOil), ang(maxT)); g.stroke();
    if (s.cooling === 'AF') { g.strokeStyle = '#3b82f6'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R - 26, ang(s.fanOff), ang(s.fanOn)); g.stroke(); }
    g.strokeStyle = '#111'; g.lineWidth = 3; g.fillStyle = '#111'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const step = isDry ? 40 : 20;
    for (let t = 0; t <= maxT; t += step) { const a = ang(t); g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); g.stroke(); g.fillText(String(t), cx + Math.cos(a) * (R - 44), cy + Math.sin(a) * (R - 44)); }
    g.font = 'bold 16px Arial'; g.fillText(isDry ? '°C SARGI' : '°C YAĞ', cx, cy + R * 0.5);
    const a = ang(val);
    g.strokeStyle = '#b91c1c'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
    g.textBaseline = 'alphabetic';
  }
  function drawPlate(g, w, h, app) {
    const s = app.state;
    g.fillStyle = '#c9ced3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#333'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('GÜÇ TRAFOSU · ÖRNEK ETİKET', w / 2, 34);
    g.textAlign = 'left'; g.font = '19px Arial';
    const rows = [['Sr', fmt(s.Sr_kVA, 0) + ' kVA'], ['U1 / U2', fmt(s.U1_kV, 1) + ' kV / ' + s.U2_V + ' V'], ['Bağlantı', s.vg + ' · kademe ±2×2,5 %'], ['uk', '%' + fmt(s.uk, 1)], ['P0 / Pk', fmt(s.P0, 0) + ' W / ' + fmt(s.Pk, 0) + ' W'], ['Soğutma', coolName(s) + ' · IEC 60076']];
    rows.forEach((r, i) => { g.fillText(r[0], 20, 66 + i * 30); g.fillText(r[1], 140, 66 + i * 30); });
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, x = v.ext, M = k.mats;
    sc.front.visible = !s.cutaway; sc.roof.visible = !s.cutaway;
    const sp = k.reducedMotion ? 0 : 1;
    sc.flows.forEach(f => { f.f.speed = sp * (f.kind === 'mv' ? (x.en.mv ? 0.05 + clamp(v.k, 0, 1.5) * 0.25 : 0) : clamp(v.k, 0, 1.5) * 0.4); });
    const heat = clamp(v.losses / Math.max(1, v.P0 + Number(s.Pk)), 0, 2);
    sc.cool.forEach(f => { f.speed = sp * (x.en.mv ? 0.08 + 0.35 * heat * (live.fans ? 1.6 : 1) : 0); });
    sc.lMV.set('OG (' + s.cells.length + ' hücre) · I1 ' + fmt(v.I1, 1) + ' A');
    sc.lMV.level(x.en.mv ? 'ok' : C.isSafe(s.sw, x.kind) ? 'ok' : 'warn');
    sc.lLV.set('AG · ' + fmt(v.I2, 0) + ' A · ' + (x.en.mv ? fmt(x.Ulv, 0) + ' V' : 'enerjisiz'));
    sc.lLV.level(!x.en.lv ? 'warn' : v.k > 1 ? 'warn' : 'ok');
    sc.analyzer.redraw(); if (sc.plate) sc.plate.redraw(); if (sc.pfRelay) sc.pfRelay.redraw();
    sc.acbLed.material = x.en.lv ? M.ledGreen : M.ledRed;
    sc.acbH.position.y = s.sw.lv ? 1.42 : 1.36;
    if (sc.tapH) sc.tapH.rotation.y = (C.TAPS.indexOf(Number(s.tap)) - 2) * 0.5;
    sc.state = '';
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    const x = res.values.ext;
    let moving = false;
    // hücre kapağı ve fanlar (yalnız görsel)
    sc.cells.forEach(c => { if (c.door) { const tgt = s.sw.door ? -1.6 : 0, e = tgt - c.door.rotation.y; if (Math.abs(e) > 1e-4) { c.door.rotation.y += e * Math.min(1, dt * 5 || 1); moving = true; } else c.door.rotation.y = tgt; } });
    if (!k.reducedMotion && live.fans && x.en.mv && dt > 0 && sc.fans.length) { sc.fans.forEach(f => { f.userData.rot.rotation.y += dt * 18; }); moving = true; }
    const st = [live.tripped, live.alarm, live.buch, JSON.stringify(s.sw), s.cells.length].join('|');
    if (st !== sc.state) {
      sc.state = st;
      const tpi = tpIndex(s);
      sc.cells.forEach(c => { c.scr.redraw(); const live3 = c.i === tpi ? x.en.mv : true; c.leds.forEach(l => { l.material = live3 ? k.mats.ledRed : k.mats.ledOff; }); });
      if (sc.relay) sc.relay.redraw();
      if (sc.buchLed) sc.buchLed.material = live.buch ? k.mats.ledAmber : k.mats.ledOff;
      moving = true;
    }
    const now = performance.now();
    if (now - (sc.last || 0) < 200) return moving;
    sc.last = now;
    const hs = live.temps.hotSpot;
    // sıcaklık göstergesi ve sargı rengi yalnız gösterilen değer değişince (0,5 °C adım) güncellenir
    const tSig = [Math.round(hs * 2), Math.round(live.temps.topOil * 2), x.en.mv, s.alarmOil, s.tripOil, s.fanOn, s.fanOff, s.cooling, live.tripped, live.alarm, live.fans, v0(res)].join('|');
    if (tSig === sc.tSig) return moving;
    sc.tSig = tSig; moving = true;
    if (sc.dial) sc.dial.redraw();
    const h = clamp((hs - 40) / (dry(s) ? 140 : 100), 0, 1);
    k.heat(h, sc.wMat.emissive); sc.wMat.emissive.convertSRGBToLinear(); sc.wMat.emissiveIntensity = x.en.mv ? 0.25 + h * 1.4 : 0;
    if (sc.coilMat) { k.heat(h, sc.coilMat.emissive); sc.coilMat.emissive.convertSRGBToLinear(); sc.coilMat.emissiveIntensity = x.en.mv ? h * 0.6 : 0; }
    const v = res.values;
    sc.lTr.set(fmt(s.Sr_kVA, 0) + ' kVA · ' + (x.en.mv ? 'K %' + fmt(v.k * 100, 0) + ' · ' + (dry(s) ? 'θ ' + fmt(hs, 0) : 'θ ' + fmt(live.temps.topOil, 0) + '/' + fmt(hs, 0)) + ' °C' : 'ENERJİSİZ') + (live.tripped ? ' · AÇTI' : live.alarm ? ' · ALARM' : '') + (live.fans && x.en.mv ? ' · fan' : ''));
    sc.lTr.level(live.tripped ? 'bad' : live.alarm || v.k > 1 || live.buch ? 'warn' : x.en.mv ? 'ok' : '');
    return moving;
  }
  const v0 = res => Math.round(res.values.k * 100) + ',' + res.values.ext.en.mv;

  /* ---------------------------------------------------------------- 2D tek hat şeması (hücre sayısıyla ölçeklenir) */
  function layout2d(W, s) {
    const n = Math.max(1, s.cells.length), sm = W < 560;
    const pitch = sm ? 66 : 84;
    const perRow = Math.max(1, Math.min(n, Math.floor((W - 90) / pitch)));
    const rows = Math.ceil(n / perRow);
    const top = 104, rowH = 128;
    const trY = top + rows * rowH + 20;
    const wide = W >= 700;
    const tempY = wide ? trY + 18 : trY + 290;
    return { n: n, sm: sm, pitch: pitch, perRow: perRow, rows: rows, top: top, rowH: rowH, trY: trY, wide: wide, tempY: tempY, total: (wide ? trY + 320 : tempY + 230) + 20 };
  }
  function view2dHeight(W, res, s) { return layout2d(W, s).total; }
  function fit(g, text, w) {
    text = String(text); if (g.measureText(text).width <= w) return text;
    while (text.length > 1 && g.measureText(text + '…').width > w) text = text.slice(0, -1);
    return text + '…';
  }
  function view2d(g, W, H, res, s, live) {
    const v = res.values, x = v.ext, L = layout2d(W, s);
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', amb: '#fcd34d' };
    const f = L.sm ? 10 : 12;
    const txt = (t, px, py, c, w, al, b, sz) => { g.font = (b ? 'bold ' : '') + (sz || f) + 'px Inter, sans-serif'; g.fillStyle = c || col.text; g.textAlign = al || 'left'; g.fillText(w ? fit(g, t, w) : t, px, py); };
    const st = id => (res.checks.find(c => c.id === id) || {}).status;
    const C2 = c => ({ ok: col.ok, warn: col.warn, fail: col.bad }[c] || col.dim);
    g.lineWidth = 2; g.lineCap = 'round'; g.textBaseline = 'alphabetic';
    txt('Trafo merkezi tek hat şeması', 16, 62, col.text, W - 32, 'left', true);
    txt('OG şebeke ' + fmt(s.U1_kV, 1) + ' kV · SkQ ' + fmt(s.SkQ_MVA, 0) + ' MVA · gerçek gerilim %' + fmt(s.uNet, 1), 16, 80, col.dim, W - 32);
    const tpi = tpIndex(s), sw = s.sw;
    let tpX = W / 2;
    for (let r = 0; r < L.rows; r++) {
      const by = L.top + r * L.rowH + 10;
      const i0 = r * L.perRow, i1 = Math.min(L.n, i0 + L.perRow);
      const xL = 20, xR = 20 + (i1 - i0) * L.pitch;
      g.strokeStyle = col.cu; g.lineWidth = 5; g.beginPath(); g.moveTo(xL, by); g.lineTo(xR, by); g.stroke(); g.lineWidth = 2;
      if (r > 0) { g.strokeStyle = col.cu; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(xL, by - L.rowH); g.lineTo(xL, by); g.stroke(); g.setLineDash([]); }
      for (let i = i0; i < i1; i++) {
        const c = s.cells[i], cx = 20 + (i - i0 + 0.5) * L.pitch;
        const tp = i === tpi;
        const closed = (k2) => (tp ? !!sw[k2] : true);
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, by); g.lineTo(cx, by + 14); g.stroke();
        const sym = (y, cl, box) => { g.strokeStyle = cl ? col.ok : col.bad; g.beginPath(); g.moveTo(cx, y); g.lineTo(cl ? cx : cx + 10, y + 18); g.stroke(); if (box) { g.strokeRect(cx - 8, y + 1, 16, 16); } };
        if (c.type === 'cb') { sym(by + 14, closed('ds')); sym(by + 36, closed('cb'), true); }
        else if (c.type === 'fuse') { sym(by + 14, closed('cb')); g.strokeStyle = col.line; g.strokeRect(cx - 5, by + 36, 10, 18); }
        else if (c.type === 'meas') { sym(by + 14, true); g.strokeStyle = col.line; g.beginPath(); g.arc(cx - 6, by + 46, 8, 0, Math.PI * 2); g.arc(cx + 6, by + 46, 8, 0, Math.PI * 2); g.stroke(); }
        else if (c.type === 'coup') { sym(by + 14, true, true); }
        else sym(by + 14, true);
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, by + 56); g.lineTo(cx, by + 70); g.stroke();
        if (tp && sw.es) { g.strokeStyle = col.warn; g.beginPath(); g.moveTo(cx, by + 64); g.lineTo(cx + 12, by + 64); g.moveTo(cx + 6, by + 64); g.lineTo(cx + 6, by + 70); g.moveTo(cx + 1, by + 72); g.lineTo(cx + 11, by + 72); g.stroke(); }
        txt(c.name, cx, by + 88, tp ? col.amb : col.text, L.pitch - 6, 'center', tp);
        txt(CELL_TYPES[c.type].short, cx, by + 102, col.dim, L.pitch - 6, 'center', false, f - 1);
        if (tp) { tpX = cx; txt(c.type === 'cb' ? 'I> ' + fmt(s.relay.Ip, 0) + ' · I>> ' + fmt(s.relay.Ihs, 0) + ' A' : fmt(s.fuseIn, 1) + ' A HRC', cx, by + 116, C2(st(c.type === 'cb' ? 'r50' : 'fuse')), L.pitch - 4, 'center', false, f - 1); }
      }
    }
    // trafo ve AG tarafı
    const tx = 90;
    const ty = L.trY + 30;
    if (tpi >= 0) {
      const tr = Math.floor(tpi / L.perRow), cellBottom = L.top + tr * L.rowH + 10 + 122;
      g.strokeStyle = x.en.mv ? col.amb : col.line; g.beginPath(); g.moveTo(tpX, cellBottom); g.lineTo(tpX, L.trY); g.lineTo(tx, L.trY); g.lineTo(tx, ty - 18); g.stroke();
    }
    g.strokeStyle = col.line; g.beginPath(); g.arc(tx, ty - 2, 16, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(tx, ty + 20, 16, 0, Math.PI * 2); g.stroke();
    const tw = (L.wide ? W * 0.58 : W) - tx - 44;
    const kl = v.k > 1 ? col.bad : v.k > 0.8 ? col.warn : col.ok;
    txt(fmt(s.Sr_kVA, 0) + ' kVA · ' + s.vg + ' · ' + (dry(s) ? 'kuru' : 'yağlı') + ' ' + coolName(s), tx + 28, ty - 6, col.text, tw, 'left', true);
    txt('uk %' + fmt(s.uk, 1) + ' · K %' + fmt(v.k * 100, 0) + ' · η %' + fmt(v.eff, 2), tx + 28, ty + 10, kl, tw);
    txt('kademe ' + tapLabel(Number(s.tap)) + ' · kayıp ' + fmt(v.losses / 1e3, 2) + ' kW', tx + 28, ty + 26, col.dim, tw);
    const ya = ty + 52;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(tx, ty + 36); g.lineTo(tx, ya); g.stroke();
    g.strokeStyle = sw.lv ? col.ok : col.bad; g.strokeRect(tx - 9, ya, 18, 18); g.beginPath(); g.moveTo(tx, ya); g.lineTo(sw.lv ? tx : tx + 10, ya + 18); g.stroke();
    txt('ACB ' + s.acb.In + ' A · Ir ' + fmt(x.acb.Ir, 0) + ' A · ' + (sw.lv ? 'kapalı' : 'açık'), tx + 28, ya + 14, C2(st('acb')), tw);
    const yB = ya + 46;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(tx, ya + 18); g.lineTo(tx, yB); g.stroke();
    const bw = Math.min(160, (L.wide ? W * 0.5 : W) - 40);
    g.strokeStyle = col.cu; g.lineWidth = 5; g.beginPath(); g.moveTo(tx - bw / 2, yB); g.lineTo(tx + bw / 2, yB); g.stroke(); g.lineWidth = 2;
    txt('AG ' + (x.en.mv ? fmt(x.Ulv, 0) + ' V' : 'enerjisiz') + ' · Ik ≈ ' + fmt(v.Ik / 1e3, 1) + ' kA', tx + bw / 2 + 8, yB + 4, C2(st('ulv')), Math.max(60, (L.wide ? W * 0.5 : W) - tx - bw / 2 - 16));
    g.strokeStyle = col.line;
    [-bw / 3, 0].forEach(dx => { g.beginPath(); g.moveTo(tx + dx, yB); g.lineTo(tx + dx, yB + 30); g.stroke(); g.beginPath(); g.moveTo(tx + dx - 6, yB + 22); g.lineTo(tx + dx, yB + 32); g.lineTo(tx + dx + 6, yB + 22); g.stroke(); });
    if (s.cap.on) { const cx = tx + bw / 3; g.beginPath(); g.moveTo(cx, yB); g.lineTo(cx, yB + 20); g.moveTo(cx - 9, yB + 20); g.lineTo(cx + 9, yB + 20); g.moveTo(cx - 9, yB + 26); g.lineTo(cx + 9, yB + 26); g.stroke(); }
    txt('Yük ' + fmt(v.P / 1e3, 0) + ' kW · Q ' + fmt(v.Q / 1e3, 0) + ' kVAr · cosφ ' + fmt(x.cosE, 2) + (s.cap.on ? ' (' + fmt(s.cap.kvar, 0) + ' kVAr komp.)' : ''), 16, yB + 52, col.text, (L.wide ? W * 0.5 : W) - 32);
    txt('Kayıp ' + fmt(x.dl.Eday, 1) + ' kWh/gün · ' + fmt(x.dl.costYear, 0) + ' TL/yıl', 16, yB + 68, col.dim, (L.wide ? W * 0.5 : W) - 32);
    txt(swSummary(s), 16, yB + 84, x.en.mv ? col.dim : col.warn, (L.wide ? W * 0.5 : W) - 32);
    // sıcaklık çubukları
    const isDry = dry(s);
    const bx0 = L.wide ? W * 0.64 : 30, by = L.tempY + 36, bh = 160, bwd = 34, maxT = isDry ? 200 : 140;
    const Y = t => by + bh - clamp(t / maxT, 0, 1) * bh;
    const bars = isDry ? [['Sargı', live.temps.hotSpot, v.temps.hotSpot]] : [['Üst yağ', live.temps.topOil, v.temps.topOil], ['Sıcak nokta', live.temps.hotSpot, v.temps.hotSpot]];
    txt('Sıcaklık (anlık · kesikli: kararlı)', bx0 - 10, L.tempY + 8, col.text, Math.min(260, W - bx0), 'left', true);
    bars.forEach((r, i) => {
      const bx = bx0 + i * (bwd + 70);
      g.strokeStyle = '#2c4466'; g.strokeRect(bx, by, bwd, bh);
      const mon = i === 0;
      const c = mon && r[1] >= s.tripOil ? col.bad : mon && r[1] >= s.alarmOil ? col.warn : col.ok;
      g.fillStyle = c; g.fillRect(bx + 2, Y(r[1]), bwd - 4, by + bh - Y(r[1]));
      g.strokeStyle = col.text; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(bx - 4, Y(r[2])); g.lineTo(bx + bwd + 4, Y(r[2])); g.stroke(); g.setLineDash([]);
      txt(r[0], bx + bwd / 2, by + bh + 16, col.dim, bwd + 60, 'center');
      txt(fmt(r[1], 0) + ' °C', bx + bwd / 2, by - 6, col.text, bwd + 60, 'center', true);
    });
    g.strokeStyle = col.warn; g.beginPath(); g.moveTo(bx0 - 6, Y(s.alarmOil)); g.lineTo(bx0 + bwd + 6, Y(s.alarmOil)); g.stroke();
    g.strokeStyle = col.bad; g.beginPath(); g.moveTo(bx0 - 6, Y(s.tripOil)); g.lineTo(bx0 + bwd + 6, Y(s.tripOil)); g.stroke();
    txt(clock(live.clock) + (live.fans ? ' · fanlar çalışıyor' : ''), bx0 - 10, by + bh + 34, col.dim, Math.min(260, W - bx0));
    txt('Isıl sonuçlar ' + (isDry ? 'kuru tip yaklaşımıyla (IEC 60076-11/-12 sınırları)' : s.thermalOn ? 'üretici verisiyle' : 'IEC 60076-7 varsayılanlarıyla') + ' hesaplanır.', 16, H - 10, col.dim, W - 32);
  }

  /* ---------------------------------------------------------------- senaryolar ve görevler */
  const scen = o => Object.assign(defaults(), o);
  const pre = (sr, o) => { const p = TR.PRESETS[sr]; const b = scen(Object.assign({ SrSel: String(sr), Sr_kVA: sr, P0: p.P0, Pk: p.Pk, uk: p.uk }, o)); return Object.assign(b, protDefaults(b), o); };
  const st0 = (r, id) => (r.checks.find(c => c.id === id) || {}).status;
  VS.register({
    id: 'trafo', title: '3D Trafo ve Trafo Merkezi Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Isıl simülasyon soğuk başlangıçtan çalışıyor: 1 s = 10 dakika.',
    start: app => { app.live = initLive(app.state); app._startedOnce = true; app.invalidate(); },
    tasks: [
      { id: 'isolate', title: 'Trafoyu güvenli şekilde enerjisiz bırak ve topraklayın', goal: 'Bakım için trafoyu enerjisiz bırakın ve OG kablo tarafını topraklayın. Kilitlemeler yanlış sırayı reddeder.', hint: 'Sıra: AG ACB’yi aç → kesiciyi aç → ayırıcıyı aç → topraklamayı kapat. 3D’de trafo koruma hücresine veya AG panoya tıklayın ya da “OG manevra” düğmelerini kullanın.',
        check: (r, s) => C.isSafe(s.sw, kindOf(s)) },
      { id: 'tap', title: 'AG gerilimini kademe ile banda getir', goal: 'OG şebeke %96’da ve trafo yüklü: AG bara gerilimi yükte 390–410 V aralığının altında. Yükü azaltmadan kademe ile banda getirin ve trafoyu yeniden yüke verin.', hint: 'Yüksüz kademe değiştirici yalnız enerjisizken çevrilir: AG ve OG’yi açın, “Kademe ↓ (AG yükselir)”, sonra kesiciyi ve ACB’yi kapatın.',
        state: pre(630, { uNet: 96, P_kW: 560 }), check: (r, s) => r.values.ext.en.lv && Number(s.P_kW) >= 560 && r.values.ext.Ulv >= 390 && r.values.ext.Ulv <= 410 },
      { id: 'hot', title: '40 °C’de sıcak noktayı 98 °C’nin altında tut', goal: '630 kVA trafo 40 °C köşk sıcaklığında 600 kW besliyor; kararlı sıcak nokta 98 °C’yi aşıyor. Yükü azaltmadan kararlı sıcak noktayı 98 °C’nin altına indirin.', hint: 'Daha büyük anma gücü seçin veya ONAN/ONAF (fanlı) soğutmaya geçin.',
        state: pre(630, { P_kW: 600, ambient: 40 }), check: (r, s) => s.type === 'oil' && Number(s.ambient) >= 40 && Number(s.P_kW) >= 600 && r.values.ext.en.lv && r.values.temps.hotSpot < 98 },
      { id: 'eff', title: 'En yüksek verim yüklenmesine yaklaş', goal: '1600 kVA trafo yalnız 200 kW besliyor; boşta kayıp baskın. Yük aynı kalırken yüklenmeyi K_opt’un ±5 puan yakınına getirin.', hint: 'K_opt = √(P0/Pk). Yüke uygun daha küçük anma gücü seçin.',
        state: pre(1600, { P_kW: 200 }), check: (r, s) => Number(s.P_kW) >= 200 && r.values.ext.en.lv && Math.abs(r.values.k - r.values.kOpt) <= 0.05 },
      { id: 'cap', title: 'Kompanzasyonla yüklenmeyi %80’in altına indir', goal: '400 kVA trafo 300 kW’ı cosφ 0,75 ile besliyor (K ≈ %100). Aktif gücü azaltmadan AG kondansatör bankasıyla yüklenmeyi %80’in altına indirin; aşırı kompanzasyona düşmeyin.', hint: 'AG kompanzasyon → bankayı açıp kVAr değerini artırın; Analiz’de cosφ ve K’yı izleyin.',
        state: pre(400, { P_kW: 300, cos: 0.75 }), check: (r, s) => Number(s.P_kW) >= 300 && r.values.ext.en.lv && r.values.k < 0.8 && !(r.values.ext.pf && r.values.ext.pf.capacitive) },
      { id: 'relay', title: 'Röle I>> ayarını seçici yap', goal: 'Kesicili trafo hücresinde I>> 100 A: AG barasındaki bir arızada OG kesici de açar. I> ve I>> ayarlarını önerilen aralıklara getirin.', hint: 'I>> ≥ 1,3 × (AG kısa devre akımının OG’ye yansıyanı); I> 1,1–1,6·I1n. OG hücreler grubundaki röle alanları.',
        state: pre(630, { relay: { Ip: 13, tp: 0.3, Ihs: 100, Ie: 2 } }), check: r => st0(r, 'r50') === 'ok' && st0(r, 'r51') === 'ok' }
    ],
    scenarios: [
      { id: 'normal', name: 'Fabrika trafosu · 630 kVA normal işletme', desc: '34,5/0,4 kV (örnek), 450 kW, cosφ 0,95: K ≈ %75. Sıcaklıkların kararlı hale yaklaşmasını izleyin.', state: pre(630, { P_kW: 450 }), start: true },
      { id: 'over', name: 'Yaz günü aşırı yük · termometre açması', desc: '630 kVA, 650 kW cosφ 0,9 (K ≈ %115), köşk içi 40 °C: üst yağ alarm ve açma ayarlarına (örnek) ulaşır.', state: pre(630, { P_kW: 650, cos: 0.9, ambient: 40 }), start: true },
      { id: 'onaf', name: 'ONAN/ONAF · fanlar sıcaklıkla devreye girer', desc: '1000 kVA, 1050 kW, 35 °C: üst yağ 65 °C’yi geçince fanlar çalışır (örnek ayar).', state: pre(1000, { P_kW: 1050, cos: 0.95, ambient: 35, cooling: 'AF' }), start: true },
      { id: 'dry', name: 'Kuru tip 1000 kVA · AN/AF', desc: 'Döküm reçine trafo, sınıf F; sargı sıcaklık rölesi ve fanlar (örnek ayarlar).', state: pre(1000, { type: 'dry', cooling: 'AF', P_kW: 900, ambient: 30, alarmOil: 140, tripOil: 155, fanOn: 110, fanOff: 95 }), start: true },
      { id: 'low', name: 'Düşük yük · boşta kayıp baskın', desc: '1600 kVA trafo yalnız 200 kW besliyor: verim eğrisinde K_opt’un çok altındasınız.', state: pre(1600, { P_kW: 200 }) },
      { id: 'cycle', name: 'Günlük yük profili · kayıp maliyeti', desc: 'İki vardiyalı fabrika, tepe 900 kW: gece–gündüz yük değişimi, günlük ve yıllık kayıp enerjisi.', state: pre(1000, { P_kW: 900, profile: 'iki', cos: 0.93 }), start: true },
      { id: 'cap', name: 'Düşük cosφ ve AG kompanzasyon', desc: '400 kVA, 300 kW, cosφ 0,75: kondansatör bankası trafo kVA yükünü azaltır.', state: pre(400, { P_kW: 300, cos: 0.75, cap: { on: true, kvar: 180, steps: 6 } }) },
      { id: 'big', name: 'Büyük merkez · 8 OG hücre, 2500 kVA', desc: 'İki giriş, dört çıkış, ölçü ve kesicili trafo hücresi; 10,5 kV (örnek), SkQ 250 MVA.', state: pre(2500, { P_kW: 1800, U1sel: '10.5', U1_kV: 10.5, SkQ_MVA: 250, cells: [{ type: 'line', name: 'Giriş A' }, { type: 'line', name: 'Giriş B' }, { type: 'line', name: 'Çıkış 1' }, { type: 'line', name: 'Çıkış 2' }, { type: 'line', name: 'Çıkış 3' }, { type: 'coup', name: 'Kuplaj' }, { type: 'meas', name: 'Ölçü' }, { type: 'cb', name: 'Trafo koruma' }] }) },
      { id: 'fuse', name: 'Sigortalı yük ayırıcı ile trafo koruma', desc: '400 kVA, sigortalı yük ayırıcı hücresi ve HRC sigorta seçimi.', state: pre(400, { P_kW: 280, cells: [{ type: 'line', name: 'Giriş' }, { type: 'line', name: 'Çıkış' }, { type: 'fuse', name: 'Trafo koruma' }] }) }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => live.tripped ? { level: 'bad', text: 'Sıcaklık açması · trafo devre dışı' } : live.buch ? { level: 'warn', text: 'Buchholz alarmı (test)' } : live.alarm ? { level: 'warn', text: 'Sıcaklık alarmı' } : !res.values.ext.en.mv ? { level: C.isSafe(s.sw, res.values.ext.kind) ? 'info' : 'warn', text: C.isSafe(s.sw, res.values.ext.kind) ? 'Enerjisiz · topraklı' : 'Trafo enerjisiz' } : null,
    reportInputs: (s, app) => [{ group: 'Simülasyon', label: 'Simülasyon saati', value: clock(app.live.clock) + ' (1 s = ' + MIN_PER_S + ' dk)' }, { group: 'OG hücreler', label: 'Hücre listesi', value: s.cells.map((c, i) => (i + 1) + '. ' + c.name + ' (' + CELL_TYPES[c.type].name + ')').join('; ') }, { group: 'OG manevra', label: 'Durum', value: swSummary(s) }, { group: 'Trafo', label: 'Kademe', value: (C.TAPS.indexOf(Number(s.tap)) + 1) + ' / 5 (OG ' + tapLabel(Number(s.tap)) + ')' }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-4, 4] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
