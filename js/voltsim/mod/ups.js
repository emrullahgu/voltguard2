/* VoltSim · 3D UPS ve Jeneratör Simülasyonu
 * Hesap: VoltSimEngine.ups (UPS yüklenmesi, akü yedekleme süresi, jeneratör yüklenmesi, yakıt süresi) ve
 * ups.atsStep (açık geçişli ATS durum makinesi; QM ve QG aynı anda kapanırsa motor hata fırlatır).
 * Ek hesaplar (js/voltsim/calc/ups.js → E.ext.ups): bypass durum makinesi (statik / bakım bypass kilitlemeleri),
 * akü sıcaklık ve yaşlanma katsayıları, akü boyutlandırma, jeneratör adım yük kabulü, black start test planı.
 * Sahne: hesap ve durum makinesi sonucunu gösterir (kesici konumları, enerji akışı, akü doluluk rengi). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const U = E.ups;
  const X = E.ext.ups;
  const AH_LIST = [7, 9, 12, 18, 26, 40, 55, 65, 80, 100, 150, 200, 300, 500];

  /* ---------------------------------------------------------------- girdiler ve önayarlar */
  function defaults() {
    return {
      Pcrit: 32, pfCrit: 0.95, upsKVA: 60, upsPF: 0.9, etaInv: 95,
      nBlocks: 40, Vblock: 12, Ah: 100, strings: 1, dod: 80, battT: 25, batAge: 2, designLife: 10,
      upsArch: 'mono', upsModules: 3, modKVA: 20, redundancy: 'N+1', failedMods: 0,
      genKVA: 200, nGen: 1, Pother: 60, pfOther: 0.85, fuel: 0.27, tank: 400, genClass: 'G2', stepPlan: 'two',
      tConfirm: 3, tGenReady: 10, tDead: 1, tReturn: 30, tCool: 60,
      plan: true, cutAt: 5, outDur: 120, accel: 2, bypSync: true, startBypass: false
    };
  }
  const ATS_NAME = { MAINS: 'Şebeke', CONFIRM_FAIL: 'Kesinti onayı', GEN_START: 'Jeneratör yol alıyor', TRANSFER_GEN: 'Jeneratöre aktarma (ölü zaman)', ON_GEN: 'Jeneratörde', RETRANSFER: 'Şebekeye geri aktarma', COOLDOWN: 'Jeneratör soğutma' };
  const RECHARGE_H = 8;      // varsayım: boş aküden tam doluma ≈ 8 saat (temsili, ~C/10 şarj)
  const MAX_SHOWN = 192;     // 3D'de gösterilen en çok akü bloğu (4 raf × 48)

  function cfgOf(s) { return { tConfirm: s.tConfirm, tGenReady: s.tGenReady, tDead: s.tDead, tReturn: s.tReturn, tCool: s.tCool }; }
  function initLive(s) {
    return { mains: true, ats: { state: 'MAINS', t: 0, timer: 0, QM: true, QG: false, genRunning: false }, soc: 1, fuelL: s.tank * (s.nGen || 1), dropped: false,
      t: 0, hist: [], histT: 0, events: [], planCut: false, planBack: false, manual: false, onBatT: 0, maxGap: 0,
      byp: s.startBypass ? { SS: 'byp', Q2: true, Q3: false } : Object.assign({}, X.BYPASS_INIT), interrupts: 0, critPrev: true };
  }
  /** Anlık güç yolu: ATS barası, UPS girişi, akü modu (hepsi durum makinesinden türetilir). */
  function paths(L) {
    const a = L.ats;
    const genV = a.genRunning && a.state !== 'GEN_START' && L.fuelL > 0;
    const viaMains = a.QM && L.mains, viaGen = a.QG && genV;
    const bus = viaMains || viaGen;
    // UPS çıkış yolu bypass durum makinesinden: inverter yolunda akü köprü olur; statik/bakım bypass yolunda yük doğrudan ATS barasındadır
    const b = L.byp || X.BYPASS_INIT;
    const path = X.loadPath(b, { bypassOK: bus, invOK: bus || (!L.dropped && L.soc > 0) });
    const invMode = b.SS === 'inv' && b.Q2 && !b.Q3;
    return { genV: genV, viaMains: viaMains, viaGen: viaGen, bus: bus, invMode: invMode, path: path, onBat: invMode && !bus && !L.dropped, crit: !!path && !(invMode && L.dropped) };
  }
  /** Bypass komutu: kilitlemeler calc/ups.js durum makinesinde; reddedilen komut durum değiştirmez. */
  function bypCmd(app, cmd) {
    const L = app.live, s = app.state, p = paths(L);
    const r = X.bypassCommand(L.byp, cmd, { bypassOK: p.bus, sync: p.bus && s.bypSync, invOK: p.bus || L.soc > 0 });
    if (r.ok) L.events.push(fmtT(L.t) + ' · Bypass: ' + CMD_NAME[cmd] + ' → ' + X.modeName(L.byp = r.st));
    else { L.events.push(fmtT(L.t) + ' · Reddedildi (' + CMD_NAME[cmd] + '): ' + r.msg); VS.toast(r.msg, 'bad'); }
    app.running = true; app.paused = false; if (app.syncToolbar) app.syncToolbar(); if (app.invalidate) app.invalidate();
    return r.ok;
  }
  const CMD_NAME = { toStatic: 'statik bypass’a aktar', toInverter: 'inverter’e dön', closeQ3: 'Q3 kapat', openQ2: 'Q2 aç', closeQ2: 'Q2 kapat', openQ3: 'Q3 aç' };
  function bypActions(app) {
    const b = app.live.byp;
    return [
      b.SS === 'inv' ? { label: 'Statik bypass’a aktar', onClick: a => bypCmd(a, 'toStatic') } : !b.Q3 ? { label: 'İnverter’e dön', variant: 'primary', onClick: a => bypCmd(a, 'toInverter') } : null,
      b.Q3 ? null : { label: 'Q3 bakım bypass kapat', onClick: a => bypCmd(a, 'closeQ3') },
      b.Q2 ? { label: 'Q2 UPS çıkışı aç', variant: 'warn', onClick: a => bypCmd(a, 'openQ2') } : { label: 'Q2 UPS çıkışı kapat', onClick: a => bypCmd(a, 'closeQ2') },
      b.Q3 ? { label: 'Q3 bakım bypass aç', onClick: a => bypCmd(a, 'openQ3') } : null
    ].filter(Boolean);
  }

  /** Engine ups.compute + ek hesaplar: akü katsayıları sıcaklık/yaştan, adım yük kabulü, 15 dk akü boyutu, black start planı. */
  /** Modüler UPS durumu (calc/ups.js upsModular); tek blok mimaride null. Arızalı modül sayısı en çok nMod − 1. */
  function modOf(s) {
    if (s.upsArch !== 'modular') return null;
    return X.upsModular({ nMod: s.upsModules, modKVA: s.modKVA, pf: s.upsPF, Scrit: s.Pcrit / s.pfCrit, Pcrit: s.Pcrit, failed: Math.min(s.failedMods || 0, s.upsModules - 1), redundancy: s.redundancy });
  }
  function compute(s) {
    const d = X.batteryDerating({ T: s.battT, age: s.batAge, designLife: s.designLife });
    const nGen = s.nGen || 1, mod = modOf(s);
    // modüler UPS’te engine’e çalışan modüllerin toplam gücü, paralel setlerde toplam jeneratör gücü ve toplam depo verilir
    const r = U.compute(Object.assign({}, s, { tGap: s.tConfirm + s.tGenReady + s.tDead, kTemp: d.kTemp, kAge: d.kAge,
      upsKVA: mod ? mod.activeKVA : s.upsKVA, genKVA: s.genKVA * nGen, tank: s.tank * nGen }));
    if (!r.ok) return r;
    const v = r.values;
    const upsKVAin = s.Pcrit / (s.etaInv / 100) / 0.95, otherKVA = s.Pother / s.pfOther; // engine genLoadKVA ile aynı ayrıştırma
    v.derate = d;
    v.mod = mod;
    v.gp = X.genParallel({ nGen: nGen, genKVA: s.genKVA, loadKVA: v.genLoadKVA, loadKW: v.genLoadKW, fuel: s.fuel, tankPerSet: s.tank });
    if (mod) r.checks.push({ id: 'mod', label: 'Modüler UPS yedekliliği', status: !mod.carries ? 'fail' : mod.configOK ? 'ok' : 'warn',
      detail: mod.active + ' / ' + s.upsModules + ' modül çalışıyor (' + s.modKVA + ' kVA); yük için N = ' + mod.N + ', hedef ' + s.redundancy + ' → ' + mod.need + ' modül. Modül başına %' + Math.round(mod.perModPct) + (mod.survivesOne ? '; bir modül daha arızalanırsa %' + Math.round(mod.afterLossPct) + '.' : '; bir modül daha arızalanırsa yük taşınamaz (statik bypass’a geçer).'), ref: 'IEC 62040-3' });
    if (nGen > 1) r.checks.push({ id: 'genN1', label: 'Paralel jeneratör yedekliliği', status: v.gp.n1 ? 'ok' : 'warn',
      detail: nGen + ' × ' + s.genKVA + ' kVA senkron barada; set başına %' + Math.round(v.gp.perSetPct) + '. Bir set devre dışı kalırsa kalanlar %' + Math.round(v.gp.afterLossPct) + (v.gp.n1 ? ' yüklenir (N+1 sağlanıyor).' : ' yüklenir: N+1 sağlanmıyor.'), ref: 'ISO 8528-1' });
    v.steps = X.stepLoad(X.loadSteps(s.stepPlan, upsKVAin, otherKVA), s.genKVA * nGen, s.genClass);
    v.sizing15 = X.batterySizing({ P_kW: s.Pcrit, minutes: 15, etaInv: s.etaInv / 100, nBlocks: s.nBlocks, Vblock: s.Vblock, dod: s.dod / 100, kTemp: d.kTemp, kAge: d.kAge, AhList: AH_LIST, maxStrings: 4 });
    v.plan = X.blackStartPlan({ minFuelPct: 50, tank: s.tank, tConfirm: s.tConfirm, tGenReady: s.tGenReady, tDead: s.tDead, tReturn: s.tReturn, tCool: s.tCool, steps: v.steps.steps.map(x => x.kVA), genKVA: s.genKVA * nGen, cls: s.genClass, genPct: v.genPct });
    r.checks.push({ id: 'step', label: 'Jeneratör adım yük kabulü', status: v.steps.ok ? 'ok' : 'warn', detail: 'En büyük adım %' + Math.round(v.steps.maxPct) + ', ' + s.genClass + ' için temsili sınır %' + v.steps.limit + '. Gerçek kabul üretici verisine ve motorun ortalama efektif basıncına bağlıdır.', ref: 'ISO 8528-5' });
    r.checks.push({ id: 'age', label: 'Akü ömrü ve sıcaklık', status: d.endOfLife || s.battT > 30 ? 'warn' : 'ok', detail: 'Etkin ömür ≈ ' + Math.round(d.lifeEff * 10) / 10 + ' yıl (' + s.battT + ' °C), yaş ' + s.batAge + ' yıl. ' + (d.endOfLife ? 'Ömür sonu: değişim planlanmalı.' : 'Akü odası 20–25 °C’de tutulmalıdır.'), ref: 'TS EN IEC 62485-2' });
    r.assumptions.push('Akü k_T = 1 + 0,006·(T − 25) (en çok 1,05); ömür 20 °C üstünde her +10 °C’de yarıya iner; kapasite ömür sonunda %80’e doğrusal düşer (eğitim varsayımı).');
    r.assumptions.push('Jeneratör adım sınırları (G1 %60, G2 %45, G3 %33) temsilidir; ISO 8528-5 yalnız sapma sınırlarını tanımlar.');
    r.assumptions.push('Modüler UPS: modüller yükü eşit paylaşır; çalışan modüllerin gücü yükü taşıyamazsa UPS statik bypass’a geçer (gerçek cihazlarda süreli aşırı yük kapasitesi vardır; burada anında, temsili).');
    r.assumptions.push('Paralel jeneratörler senkron barada eşit yük paylaşır; ilk set ölü baraya, diğerleri senkron kontrolüyle (temsili sınırlar ΔU ≤ %5, Δf ≤ 0,2 Hz, Δφ ≤ 10°) kapanır. Yük adımları tüm setler baraya bağlandıktan sonra uygulanır.');
    r.assumptions.push('Bypass: statik anahtar yalnız senkronken kesintisiz aktarır; bakım bypass yalnız statik bypass üzerinden kapatılır (kilitleme). Bypass yolunda akü köprüsü yoktur.');
    return r;
  }

  /* ---------------------------------------------------------------- kontroller */
  function cut(app, on) {
    const L = app.live; L.manual = true;
    if (L.mains === !on) return;
    L.mains = !on; L.events.push(fmtT(L.t) + ' · ' + (on ? 'Şebeke kesildi (elle).' : 'Şebeke geri verildi (elle).'));
    app.running = true; app.paused = false; app.syncToolbar(); app.invalidate();
  }
  function controls(s, app) {
    const r = app.validResult && app.validResult.values;
    return [
      { title: 'Şebeke kesintisi', items: [
        { type: 'buttons', items: [
          { label: 'Şebekeyi kes', variant: 'danger', onClick: a => cut(a, true) },
          { label: 'Şebekeyi geri ver', variant: 'primary', onClick: a => cut(a, false) }
        ] },
        { type: 'note', text: 'Elle kesme/geri verme otomatik test planını devre dışı bırakır. “Simülasyonu başlat” planı baştan çalıştırır.' }
      ] },
      { title: 'UPS bypass (statik ve bakım)', items: [
        { type: 'note', html: 'Çıkış yolu: <b>' + VS.esc(X.modeName(app.live.byp)) + '</b> · SS ' + (app.live.byp.SS === 'inv' ? 'inverter' : 'bypass') + ' · Q2 ' + (app.live.byp.Q2 ? 'kapalı' : 'açık') + ' · Q3 ' + (app.live.byp.Q3 ? 'kapalı' : 'açık') },
        { type: 'buttons', items: bypActions(app).map(x => ({ label: x.label, variant: x.variant, onClick: a => { x.onClick(a); a.renderControls(); } })) },
        { type: 'toggle', key: 'bypSync', label: 'Bypass kaynağı inverterle senkron' },
        { type: 'note', text: 'Bakım sırası: statik bypass’a aktar → Q3 kapat → Q2 aç. Dönüş: Q2 kapat → Q3 aç → inverter’e dön. Bypass yolunda akü köprüsü yoktur: şebeke kesilirse yük düşer. Senkron kapalıyken (ör. jeneratör frekansı tolerans dışı) kesintisiz aktarma reddedilir.' }
      ] },
      { title: 'Kritik yük ve UPS', items: [
        { type: 'range', key: 'Pcrit', label: 'Kritik yük (UPS çıkışı)', min: 1, max: 400, step: 1, unit: 'kW' },
        { type: 'range', key: 'pfCrit', label: 'Kritik yük cosφ', min: 0.7, max: 1, step: 0.01, digits: 2 },
        { type: 'seg', key: 'upsArch', label: 'UPS mimarisi', options: [['mono', 'Tek blok'], ['modular', 'Modüler (paralel modül)']] },
        s.upsArch === 'modular' ? null : { type: 'select', key: 'upsKVA', label: 'UPS gücü', options: [10, 20, 30, 40, 60, 80, 100, 120, 160, 200, 300, 400, 500].map(v => [v, v + ' kVA']) },
        s.upsArch === 'modular' ? { type: 'select', key: 'upsModules', label: 'Güç modülü sayısı', options: [1, 2, 3, 4, 5, 6].map(v => [v, v + ' modül']), rebuild: true } : null,
        s.upsArch === 'modular' ? { type: 'select', key: 'modKVA', label: 'Modül gücü', options: [10, 15, 20, 25, 30, 40, 50, 60, 100].map(v => [v, v + ' kVA']) } : null,
        s.upsArch === 'modular' ? { type: 'seg', key: 'redundancy', label: 'Yedeklilik hedefi', options: [['N', 'N'], ['N+1', 'N+1']] } : null,
        s.upsArch === 'modular' ? { type: 'select', key: 'failedMods', label: 'Arızalı modül (deneme)', options: Array.from({ length: s.upsModules }, (x, i) => [i, i ? i + ' modül arızalı' : 'Yok']), rebuild: true } : null,
        s.upsArch === 'modular' && r && r.mod ? { type: 'note', html: 'N = <b>' + r.mod.N + '</b> modül gerekli · ' + s.redundancy + ' için ' + r.mod.need + ' · kurulu ' + s.upsModules + ' → <b>' + (r.mod.configOK ? 'sağlanıyor' : 'sağlanmıyor') + '</b><br>Çalışan ' + r.mod.active + ' modül, modül başına <b>%' + fmt(r.mod.perModPct, 0) + '</b>' + (r.mod.carries ? '' : ' → yük taşınamıyor, statik bypass') + '<br>3D’de modüle tıklayarak arıza oluşturabilir / giderebilirsiniz.' } : null,
        { type: 'range', key: 'upsPF', label: 'UPS çıkış güç faktörü', min: 0.8, max: 1, step: 0.01, digits: 2 },
        { type: 'range', key: 'etaInv', label: 'İnverter verimi', min: 85, max: 98, step: 0.5, unit: '%', digits: 1 }
      ] },
      { title: 'Akü grubu', items: [
        { type: 'range', key: 'nBlocks', label: 'Seri blok sayısı', min: 2, max: 100, step: 1 },
        { type: 'select', key: 'Vblock', label: 'Blok gerilimi', options: [[2, '2 V (OPzV hücre)'], [6, '6 V'], [12, '12 V (VRLA)']] },
        { type: 'select', key: 'Ah', label: 'Blok kapasitesi', options: [7, 9, 12, 18, 26, 40, 55, 65, 80, 100, 150, 200, 300, 500].map(v => [v, v + ' Ah']) },
        { type: 'select', key: 'strings', label: 'Paralel akü grubu', options: [1, 2, 3, 4].map(v => [v, v + ' grup']) },
        { type: 'range', key: 'dod', label: 'Kullanılabilir kapasite (DoD)', min: 50, max: 100, step: 5, unit: '%' },
        { type: 'range', key: 'battT', label: 'Akü odası sıcaklığı', min: 0, max: 45, step: 1, unit: '°C', help: 'Varsayım: 25 °C altında kapasite ≈ %0,6/°C düşer; 20 °C üstünde her +10 °C ömrü yarıya indirir.' },
        { type: 'range', key: 'batAge', label: 'Akü yaşı', min: 0, max: 15, step: 0.5, unit: 'yıl', digits: 1 },
        { type: 'select', key: 'designLife', label: 'Tasarım ömrü (20 °C)', options: [5, 10, 12, 15, 20].map(v => [v, v + ' yıl']) },
        r ? { type: 'note', html: 'k_T <b>' + fmt(r.derate.kTemp, 2) + '</b> · k_yaş <b>' + fmt(r.derate.kAge, 2) + '</b> · etkin ömür ' + fmt(r.derate.lifeEff, 1, 'yıl') + '<br>Akü gerilimi <b>' + fmt(r.Vbat, 0, 'V') + '</b> · toplam enerji <b>' + fmt(r.Ebat, 1, 'kWh') + '</b> · yedekleme <b>' + VS.fmtDuration(r.runtime) + '</b><br>15 dk için gereken: <b>' + fmt(r.sizing15.AhReq, 1, 'Ah') + '</b>' + (r.sizing15.pick ? ' → ' + r.sizing15.pick.strings + ' × ' + r.sizing15.pick.Ah + ' Ah' : ' → seri blok sayısını artırın') } : null
      ] },
      { title: 'Jeneratör ve diğer yükler', items: [
        { type: 'select', key: 'genKVA', label: 'Jeneratör gücü (set başına, prime)', options: [60, 100, 150, 200, 250, 300, 400, 500, 750, 1000].map(v => [v, v + ' kVA']) },
        { type: 'select', key: 'nGen', label: 'Paralel jeneratör seti', options: [1, 2, 3, 4].map(v => [v, v === 1 ? '1 set' : v + ' set (senkron bara)']), rebuild: true },
        s.nGen > 1 && r ? { type: 'note', html: 'Toplam ' + fmt(r.gp.totalKVA, 0, 'kVA') + ' · set başına <b>%' + fmt(r.gp.perSetPct, 0) + '</b> · N = ' + r.gp.Nreq + ' → N+1 <b>' + (r.gp.n1 ? 'var' : 'yok') + '</b> · set başına ' + fmt(r.gp.fuelPerSet, 1, 'l/sa') + '<br>İlk set ölü baraya kapanır; diğerleri senkron kontrolüyle (ΔU, Δf, Δφ) paralel bağlanır. Senkronsuz kaynak paralelliği engellenir.' } : null,
        { type: 'range', key: 'Pother', label: 'Jeneratöre bağlı diğer yük', min: 0, max: 1000, step: 5, unit: 'kW', help: 'HVAC, aydınlatma, pompa gibi UPS’siz ama jeneratör destekli yükler.' },
        { type: 'range', key: 'pfOther', label: 'Diğer yük cosφ', min: 0.6, max: 1, step: 0.01, digits: 2 },
        { type: 'range', key: 'fuel', label: 'Özgül yakıt tüketimi', min: 0.2, max: 0.4, step: 0.01, unit: 'l/kWh', digits: 2 },
        { type: 'range', key: 'tank', label: 'Yakıt deposu (set başına)', min: 50, max: 5000, step: 10, unit: 'l' },
        { type: 'select', key: 'genClass', label: 'Performans sınıfı (ISO 8528-5)', options: [['G1', 'G1 · genel yükler'], ['G2', 'G2 · ticari / aydınlatma + motor'], ['G3', 'G3 · hassas (telekom, UPS)']] },
        { type: 'select', key: 'stepPlan', label: 'Yük devreye alma planı', options: [['all', 'Tek adım (tüm yük)'], ['two', '2 adım: UPS → diğer yük'], ['three', '3 adım: UPS → diğer ½ → diğer ½']] },
        r ? { type: 'note', html: 'Adım sınırı (temsili) <b>%' + r.steps.limit + '</b> · ' + r.steps.steps.map((x, i) => (i + 1) + '. adım %' + fmt(x.pct, 0)).join(' · ') + ' → <b>' + (r.steps.ok ? 'uygun' : 'aşılıyor') + '</b>' } : null
      ] },
      { title: 'ATS süreleri', items: [
        { type: 'range', key: 'tConfirm', label: 'Kesinti onay süresi', min: 0.5, max: 30, step: 0.5, unit: 's', digits: 1 },
        { type: 'range', key: 'tGenReady', label: 'Jeneratör yol alma (gerilim/frekans hazır)', min: 3, max: 300, step: 1, unit: 's' },
        { type: 'range', key: 'tDead', label: 'Ölü zaman (açık geçiş)', min: 0.1, max: 5, step: 0.1, unit: 's', digits: 1 },
        { type: 'range', key: 'tReturn', label: 'Şebeke dönüş bekleme', min: 5, max: 600, step: 5, unit: 's' },
        { type: 'range', key: 'tCool', label: 'Jeneratör soğutma (yüksüz)', min: 10, max: 600, step: 10, unit: 's' },
        { type: 'note', text: 'Kesicilerin aynı anda kapanması durum makinesinde engellenir (break-before-make). Senkron paralel / kapalı geçiş bu modelde yoktur.' }
      ] },
      { title: 'Test planı ve zaman', items: [
        { type: 'toggle', key: 'plan', label: 'Otomatik kesinti testi' },
        s.plan ? { type: 'range', key: 'cutAt', label: 'Kesinti anı', min: 1, max: 120, step: 1, unit: 's' } : null,
        s.plan ? { type: 'range', key: 'outDur', label: 'Kesinti süresi', min: 1, max: 14400, step: 1, fmt: v => VS.fmtDuration(v / 60) } : null,
        { type: 'select', key: 'accel', label: 'Zaman hızlandırma', options: [1, 2, 5, 10, 30, 60, 120, 600].map(v => [v, '×' + v]) },
        { type: 'note', text: 'Varsayım (temsili): şebeke/jeneratör dönünce akü ≈ ' + RECHARGE_H + ' saatte boştan tam doluma şarj olur; yakıt yalnız yüklü çalışmada hesaplanır.' }
      ] },
      r ? { title: 'Black start test planı', collapsed: true, summary: r.plan.length + ' adım', items: [
        { type: 'note', html: '<ol style="margin:0;padding-left:18px">' + r.plan.map(x => '<li><b>' + VS.esc(x.title) + ':</b> ' + VS.esc(x.detail) + '</li>').join('') + '</ol>' },
        { type: 'note', text: 'Plan girdilerden üretilir; gerçek test yetkili ekip, iş güvenliği önlemleri ve üretici talimatıyla yapılır.' }
      ] } : null
    ];
  }

  /* ---------------------------------------------------------------- zaman adımı */
  function fmtT(t) { return t < 120 ? fmt(t, 0) + ' s' : VS.fmtDuration(t / 60); }
  function record(L) {
    const p = paths(L);
    L.hist.push({ t: L.t, m: L.mains ? 1 : 0, qm: L.ats.QM ? 1 : 0, qg: L.ats.QG ? 1 : 0, b: p.onBat ? 1 : 0, d: p.crit ? 0 : 1, soc: L.soc });
    if (L.hist.length > 900) L.hist = L.hist.filter((h, i) => i % 2 === 0 || i === L.hist.length - 1); // seyrelt, tüm zaman çizelgesi kalsın
  }
  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const L = app.live, s = app.state, v = res.values, cfg = cfgOf(s);
    const tankTot = s.tank * (s.nGen || 1);
    if (L.fuelL > tankTot) L.fuelL = tankTot;
    let simDt = dt * (s.accel || 1);
    const n = Math.max(1, Math.ceil(simDt / 0.25)), h = simDt / n;
    let changed = false;
    for (let i = 0; i < n; i++) {
      // otomatik test planı
      if (s.plan && !L.manual) {
        if (!L.planCut && L.t >= s.cutAt) { L.planCut = true; L.mains = false; L.events.push(fmtT(L.t) + ' · Şebeke kesildi (test planı).'); }
        if (L.planCut && !L.planBack && L.t >= s.cutAt + s.outDur) { L.planBack = true; L.mains = true; L.events.push(fmtT(L.t) + ' · Şebeke geri geldi (test planı).'); }
      }
      const prev = L.ats;
      L.ats = U.atsStep(prev, { mains: L.mains }, h, cfg); // QM ∧ QG ihlalinde motor hata fırlatır
      if (L.ats.state !== prev.state) { L.events.push(fmtT(L.t) + ' · ATS: ' + ATS_NAME[L.ats.state]); record(L); changed = true; }
      if (L.ats.QG && !prev.QG && !v.steps.ok) L.events.push(fmtT(L.t) + ' · Uyarı: yük adımı %' + fmt(v.steps.maxPct, 0) + ' > ' + s.genClass + ' sınırı %' + v.steps.limit + ' (frekans düşümü sınır dışı olabilir).');
      let p = paths(L);
      // UPS aşırı yükü (ör. modül arızası sonrası): statik anahtar bypass’a geçer (senkronsa kesintisiz)
      if (v.upsLoad > 100 && L.byp.SS === 'inv' && L.byp.Q2 && !L.byp.Q3 && p.bus) {
        const at = X.autoTransfer(L.byp, { bypassOK: true, sync: s.bypSync });
        L.byp = at.st; if (at.interrupted) L.interrupts++;
        L.events.push(fmtT(L.t) + ' · UPS aşırı yük (%' + fmt(v.upsLoad, 0) + '): statik bypass’a ' + (at.interrupted ? 'KESİNTİLİ' : 'kesintisiz') + ' geçti.'); record(L); changed = true;
        p = paths(L);
      }
      // kritik yük kesintisi sayacı (akü bitmesi ya da bypass yolunda kaynak kaybı)
      if (L.critPrev && !p.crit) { L.interrupts++; L.events.push(fmtT(L.t) + ' · KRİTİK YÜK KESİLDİ (' + (p.invMode ? 'akü bitti' : 'bypass yolunda kaynak yok') + ')'); record(L); changed = true; }
      if (!L.critPrev && p.crit) { L.events.push(fmtT(L.t) + ' · Kritik yük yeniden beslendi.'); changed = true; }
      L.critPrev = p.crit;
      if (!p.bus && p.invMode) {
        // akü modu: sabit güçte doğrusal deşarj, motorun yedekleme süresi kadar
        if (!L.dropped) {
          L.soc -= h / (v.runtime * 60); L.onBatT += h; L.maxGap = Math.max(L.maxGap, L.onBatT);
          if (L.soc <= 0) { L.soc = 0; L.dropped = true; L.events.push(fmtT(L.t) + ' · Akü bitti: inverter durdu.'); record(L); changed = true; }
        }
      } else if (p.bus) {
        L.onBatT = 0;
        if (L.dropped) { L.dropped = false; L.events.push(fmtT(L.t) + ' · UPS girişi geri geldi, inverter yeniden çalıştı.'); record(L); changed = true; }
        L.soc = Math.min(1, L.soc + h / (RECHARGE_H * 3600));
      }
      if (p.viaGen) { L.fuelL = Math.max(0, L.fuelL - v.genLoadKW * s.fuel * h / 3600); if (L.fuelL === 0 && p.genV) L.events.push(fmtT(L.t) + ' · Yakıt bitti!'); }
      L.t += h;
    }
    L.histT += simDt;
    if (L.histT >= Math.max(0.25, (s.accel || 1) * 0.2)) { L.histT = 0; record(L); changed = true; }
    return changed;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function supplyText(L) {
    const p = paths(L);
    if (!p.crit) return 'KESİK';
    const src = p.viaMains ? 'Şebeke' : p.viaGen ? 'Jeneratör' : 'Akü';
    return p.path === 'inv' ? (p.bus ? src + ' → UPS' : 'Akü (inverter)') : src + ' → ' + (p.path === 'maint' ? 'bakım bypass' : 'statik bypass');
  }
  function readouts(res, s, L) {
    const v = res.values, p = paths(L), a = L.ats;
    const lvl = (x, w, b) => x > b ? 'bad' : x > w ? 'warn' : 'ok';
    const out = [
      { label: 'Kritik yük beslemesi', value: supplyText(L), level: !p.crit ? 'bad' : p.onBat || !p.invMode ? 'warn' : 'ok', sub: (p.onBat ? 'Kalan ≈ ' + VS.fmtDuration(L.soc * v.runtime) : p.invMode ? 'UPS çift dönüşüm (online)' : 'Korumasız: bypass yolunda akü köprüsü yok') + ' · kesinti sayısı ' + L.interrupts, wide: true },
      { label: 'UPS çıkış yolu', value: X.modeName(L.byp), level: p.invMode ? 'ok' : 'warn', sub: 'SS ' + (L.byp.SS === 'inv' ? 'inverter' : 'bypass') + ' · Q2 ' + (L.byp.Q2 ? 'kapalı' : 'açık') + ' · Q3 ' + (L.byp.Q3 ? 'kapalı' : 'açık') + (s.bypSync ? '' : ' · senkron dışı') },
      { label: 'Adım yük kabulü', value: v.steps.ok ? 'Uygun' : 'Aşılıyor', level: v.steps.ok ? 'ok' : 'warn', sub: 'En büyük adım %' + fmt(v.steps.maxPct, 0) + ' / sınır %' + v.steps.limit + ' (' + s.genClass + ', temsili)' },
      { label: 'UPS yüklenmesi', value: '%' + fmt(v.upsLoad, 0), level: lvl(v.upsLoad, 80, 100), sub: fmt(s.Pcrit, 0, 'kW') + ' · ' + fmt(v.Scrit, 1, 'kVA') + ' / ' + (v.mod ? fmt(v.mod.activeKVA, 0) + ' kVA (çalışan modüller)' : s.upsKVA + ' kVA') },
      v.mod ? { label: 'UPS modülleri', value: v.mod.active + ' / ' + s.upsModules + ' çalışıyor', level: !v.mod.carries ? 'bad' : v.mod.survivesOne ? 'ok' : 'warn', sub: 'N = ' + v.mod.N + ' · ' + (v.mod.survivesOne ? 'bir arızaya dayanıklı (N+1)' : v.mod.carries ? 'yedek yok' : 'yük taşınamıyor') + ' · ' + s.modKVA + ' kVA/modül' } : null,
      { label: 'Akü yedekleme süresi', value: VS.fmtDuration(v.runtime), level: v.runtime * 60 >= (s.tConfirm + s.tGenReady + s.tDead) * 3 ? 'ok' : v.runtime * 60 >= s.tConfirm + s.tGenReady + s.tDead ? 'warn' : 'bad', sub: 'tam akü · k_T ' + fmt(v.derate.kTemp, 2) + ' · k_yaş ' + fmt(v.derate.kAge, 2) },
      { label: 'Akü enerjisi', value: fmt(v.Ebat, 1, 'kWh'), sub: fmt(v.Vbat, 0, 'V') + ' · ' + s.Ah * s.strings + ' Ah' },
      { label: 'Akü doluluğu (SOC)', value: '%' + fmt(L.soc * 100, 0), level: L.soc < 0.2 ? 'bad' : L.soc < 0.5 ? 'warn' : 'ok', sub: p.onBat ? 'deşarj' : L.soc < 1 ? 'şarj (temsili)' : 'dolu' },
      { label: 'Jeneratör yüklenmesi', value: '%' + fmt(v.genPct, 0), level: lvl(v.genPct, 80, 100), sub: fmt(v.genLoadKVA, 0) + ' / ' + fmt(v.gp.totalKVA, 0) + ' kVA' + (s.nGen > 1 ? ' (' + s.nGen + ' × ' + s.genKVA + ', N+1 ' + (v.gp.n1 ? 'var' : 'yok') + ')' : '') + ' · ' + (a.genRunning ? (a.QG ? 'yükte' : 'yüksüz çalışıyor') : 'duruyor') },
      { label: 'Yakıt süresi (tam depo)', value: isFinite(v.fuelHours) ? fmt(v.fuelHours, 1, 'sa') : '—', sub: 'Depoda ' + fmt(L.fuelL, 0, 'l') + ' · ' + fmt(v.genLoadKW * s.fuel, 1, 'l/sa') + (s.nGen > 1 ? ' (set başına ' + fmt(v.gp.fuelPerSet, 1) + ')' : '') },
      { label: 'ATS durumu', value: ATS_NAME[a.state], level: a.state === 'MAINS' ? 'ok' : a.state === 'ON_GEN' || a.state === 'COOLDOWN' ? 'info' : 'warn', sub: atsSub(a, s, L) },
      { label: 'Kilitleme', value: a.QM && a.QG ? 'İHLAL' : 'Sağlam', level: a.QM && a.QG ? 'bad' : 'ok', sub: 'QM ' + (a.QM ? 'kapalı' : 'açık') + ' · QG ' + (a.QG ? 'kapalı' : 'açık') },
      { label: 'Simülasyon zamanı', value: fmtT(L.t), sub: 'hız ×' + s.accel + (L.maxGap ? ' · en uzun akü modu ' + fmtT(L.maxGap) : '') }
    ];
    if (L.events.length) out.push({ label: 'Son olay', value: L.events[L.events.length - 1], wide: true });
    return out.filter(Boolean);
  }
  function atsSub(a, s, L) {
    if (a.state === 'CONFIRM_FAIL') return fmt(a.timer, 1) + ' / ' + s.tConfirm + ' s';
    if (a.state === 'GEN_START') return fmt(a.timer, 0) + ' / ' + s.tGenReady + ' s';
    if (a.state === 'TRANSFER_GEN' || a.state === 'RETRANSFER') return fmt(a.timer, 1) + ' / ' + s.tDead + ' s (ikisi de açık)';
    if (a.state === 'ON_GEN') return L.mains ? 'şebeke döndü · ' + fmt(a.timer, 0) + ' / ' + s.tReturn + ' s' : 'şebeke bekleniyor';
    if (a.state === 'COOLDOWN') return fmt(a.timer, 0) + ' / ' + s.tCool + ' s';
    return L.mains ? 'şebeke normal' : '';
  }
  function charts(res, s, L) {
    const v = res.values, H = L.hist.slice();
    const last = { t: L.t, m: L.mains ? 1 : 0, qm: L.ats.QM ? 1 : 0, qg: L.ats.QG ? 1 : 0, b: paths(L).onBat ? 1 : 0, soc: L.soc };
    if (!H.length || H[H.length - 1].t < L.t) H.push(last);
    const tMax = Math.max(10, L.t), useMin = tMax > 600, k = useMin ? 1 / 60 : 1;
    // basamak çizimi: her değişimde önceki değer yeni zamanda tekrarlanır
    const step = (key, base) => { const d = []; H.forEach((h, i) => { if (i) d.push([h.t * k, base + H[i - 1][key] * 0.7]); d.push([h.t * k, base + h[key] * 0.7]); }); return d; };
    const xs = { label: useMin ? 'dk' : 's', min: 0, max: tMax * k };
    const nOut = H.filter((h, i) => i && h.m === 0 && H[i - 1].m === 1).length;
    return [{
      id: 'timeline', title: 'Kaynak zaman çizelgesi', height: 170,
      series: [
        { name: 'Şebeke var', color: 'amber', width: 2, data: step('m', 3) },
        { name: 'QM kapalı', color: 'blue', width: 2, data: step('qm', 2) },
        { name: 'QG kapalı', color: 'green', width: 2, data: step('qg', 1) },
        { name: 'UPS akü modunda', color: 'red', width: 2, data: step('b', 0) }
      ],
      x: xs, y: { min: -0.2, max: 4, fmt: y => ['Akü', 'QG', 'QM', 'Şebeke', ''][Math.round(y)] || '' },
      alt: 'Simülasyon süresince şebeke varlığı, QM ve QG kesici konumları ve UPS akü modu basamak grafiği. ' + nOut + ' kesinti; ATS şu an ' + ATS_NAME[L.ats.state] + '. QM ve QG hiçbir anda birlikte kapalı değildir.'
    }, {
      id: 'soc', title: 'Akü doluluğu (SOC)',
      series: [{ name: 'SOC %', color: 'cyan', area: true, data: H.map(h => [h.t * k, h.soc * 100]) }],
      hLines: [{ y: 20, label: '%20', color: '#f59e0b' }],
      x: xs, y: { min: 0, max: 105, label: '%' },
      alt: 'Akü doluluğu şu an %' + fmt(L.soc * 100, 0) + '. Tam akü yedekleme süresi ' + VS.fmtDuration(v.runtime) + '.'
    }, {
      id: 'loads', title: 'Yüklenme oranları', type: 'bar',
      series: [{ name: 'Yüklenme %', type: 'bar', color: 'violet', data: [[1, v.upsLoad], [2, v.genPct]] }],
      hLines: [{ y: 80, label: '%80', color: '#f59e0b' }, { y: 100, label: '%100', color: '#ef4444' }],
      x: { min: 0.4, max: 2.6, ticks: [1, 2], fmt: x => ['', 'UPS', 'Jeneratör'][x] || '' }, y: { label: '%' },
      alt: 'UPS yüklenmesi %' + fmt(v.upsLoad, 0) + ', jeneratör yüklenmesi %' + fmt(v.genPct, 0) + '.'
    }, {
      id: 'steps', title: 'Jeneratör yük adımları (ISO 8528-5, temsili sınır)',
      series: [{ name: 'Adım %', type: 'bar', color: 'amber', data: v.steps.steps.map((x, i) => [i + 1, x.pct]) },
        { name: 'Kümülatif %', color: 'cyan', data: v.steps.steps.map((x, i) => [i + 1, x.cum]) }],
      hLines: [{ y: v.steps.limit, label: s.genClass + ' adım sınırı %' + v.steps.limit, color: '#ef4444' }],
      x: { min: 0.4, max: v.steps.steps.length + 0.6, ticks: v.steps.steps.map((x, i) => i + 1), fmt: x => x + '. adım' }, y: { min: 0, max: 110, label: '%' },
      alt: v.steps.steps.map((x, i) => (i + 1) + '. adım ' + fmt(x.kVA, 0) + ' kVA (%' + fmt(x.pct, 0) + ')').join(', ') + '; sınır %' + v.steps.limit + ' → ' + (v.steps.ok ? 'uygun.' : 'aşılıyor.')
    }];
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return Math.min(s.nBlocks * s.strings, MAX_SHOWN) + '|' + s.strings + '|' + s.upsArch + (s.upsArch === 'modular' ? s.upsModules : '') + '|' + (s.nGen || 1); }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const sc = { flows: {}, fans: [], puffs: [] };
    app.scene3 = sc;
    // zemin: tesis avlusu (beton) ve kablo kanalı kapakları
    k.ground(60, M.concrete, 0);
    const pad = k.box(16, 0.06, 11, M.concreteDark, -2.2, 0.03, -1.8); pad.userData.noClip = true;
    buildTrafo(k, sc, app);
    buildATS(k, sc, app);
    const nGen = s.nGen || 1;
    sc.gens = [];
    for (let i = 0; i < nGen; i++) buildGenset(k, sc, app, GEN_X0 + i * GEN_DX, i, nGen);
    if (nGen > 1) buildSync(k, sc, app);
    buildUPS(k, sc, app);
    buildBattery(k, sc, s, app);
    buildServers(k, sc, app);
    buildOther(k, sc, app);
    // kablolar (kanal içinde) ve enerji akış parçacıkları
    const cab = (key, pts, col, r) => { const t = k.tube(pts, r || 0.035, M.cableBlack, null); sc.flows[key] = k.flow(t.userData.curve, 14, col, 0.055); };
    const y = 0.08;
    cab('mains', [[-7.3, y, -1.25], [-6.2, y, -1.25], [-5.0, y, -1.3], [-4.9, y, -1.65]], 0xfcd34d);
    cab('gen', [[-3.1, y, -5.45], [-3.1, y, -3.6], [-4.3, y, -2.9], [-4.3, y, -2.35]], 0xfb923c);
    // paralel setler: ortak senkron bara kablosu (setlerin önünden sola)
    if (nGen > 1) cab('genBus', [[GEN_X0 + (nGen - 1) * GEN_DX - 1.9, y, -5.3], [GEN_X0 + (nGen - 1) * GEN_DX / 2, y, -5.3], [-3.1, y, -5.3]], 0xfb923c);
    cab('atsUps', [[-4.4, y, -1.65], [-3.6, y, -1.0], [-1.0, y, -1.0], [-0.45, y, -1.7]], 0xfcd34d);
    cab('other', [[-4.8, y, -1.65], [-4.85, y, -0.6], [-4.85, y, 0.4], [-4.7, y, 1.2]], 0xfcd34d);
    cab('bat', [[1.2, y, -1.6], [0.7, y, -1.35], [0.25, y, -1.7]], 0x22d3ee);
    cab('crit', [[0.0, y, -1.7], [0.3, y, -0.6], [0.9, y, 0.4], [1.2, y, 1.15]], 0x4ade80);
    const xr = Math.max(6.4, GEN_X0 + (nGen - 1) * GEN_DX + 2.4);
    app.def.scene.bounds = [-9.6, xr];
    v.setView({ target: [-2.3 + (nGen - 1) * 1.6, 0.5, -1.8 - (nGen > 1 ? 0.6 : 0)], r: 16 + (nGen - 1) * 2.2, theta: 0.26, phi: 1.04, limits: { rMin: 2, rMax: 36 } });
    v.setShadowBox(11 + (nGen - 1) * 2.5, 60);
    v.sun.position.set(6, 14, 9);
    sc.sig = '';
    applyState(k, app);
  }

  /* dağıtım trafosu + sayaç panosu (şebeke kaynağı) */
  function buildTrafo(k, sc, app) {
    const T = k.T, M = k.mats;
    const g = k.group(null, -8.2, 0, -2.0);
    k.box(2.6, 0.2, 1.8, M.concrete, 0.3, 0.1, 0, g);
    const tank = k.group(g, 0, 0, 0);
    k.box(1.3, 1.25, 0.8, M.trafoPaint, 0, 0.2 + 0.625, 0, tank);
    k.box(1.38, 0.05, 0.88, M.trafoPaint, 0, 1.47, 0, tank);
    // radyatör dilimleri (InstancedMesh, ön ve arka yüz)
    const fin = new T.InstancedMesh(new T.BoxGeometry(0.03, 1.0, 0.26), M.trafoPaint, 22);
    const d = new T.Object3D(); let n = 0;
    [-1, 1].forEach(side => { for (let i = 0; i < 11; i++) { d.position.set(-0.55 + i * 0.11, 0.85, side * 0.53); d.updateMatrix(); fin.setMatrixAt(n++, d.matrix); } });
    fin.castShadow = true; fin.receiveShadow = true; tank.add(fin);
    // genleşme kabı
    const cons = k.cyl(0.13, 0.13, 0.95, M.trafoPaint, 0, 1.78, -0.25, tank, 20); cons.rotation.z = Math.PI / 2;
    [-0.35, 0.35].forEach(x => k.box(0.04, 0.3, 0.04, M.trafoPaint, x, 1.6, -0.25, tank));
    // OG ve AG buşingleri
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.cyl(0.055 - j * 0.004, 0.06 - j * 0.004, 0.06, M.porcelain, -0.35 + i * 0.35, 1.53 + j * 0.065, -0.05, tank, 14);
    for (let i = 0; i < 4; i++) { k.cyl(0.035, 0.04, 0.16, M.porcelainGrey, -0.39 + i * 0.26, 1.58, 0.25, tank, 12); k.box(0.03, 0.05, 0.05, M.copper, -0.39 + i * 0.26, 1.69, 0.25, tank); }
    k.pickable(tank, 'Dağıtım trafosu (şebeke beslemesi)', a => {
      const r = a.validResult && a.validResult.values;
      return ['Şebeke: ' + (a.live.mains ? 'var' : 'YOK'), 'ATS üzerinden QM kesicisine bağlanır (açık geçiş).', r ? 'Tesis yükü ≈ ' + fmt(r.genLoadKVA, 0, 'kVA') + ' → ' + fmt(E.currentFromS(r.genLoadKVA * 1000, 400), 0, 'A') + ' (400 V, akü şarjı hariç)' : ''];
    });
    // sayaç / AG giriş panosu
    const mp = k.group(g, 1.25, 0.2, 0.1);
    k.rbox(0.62, 1.3, 0.32, 0.02, M.panelRAL7035, 0, 0.65, 0, mp);
    const scr = k.screen(0.22, 0.1, 256, (gx, w, h) => {
      const L = app.live; gx.fillStyle = '#0d1f12'; gx.fillRect(0, 0, w, h); gx.fillStyle = L && L.mains ? '#86efac' : '#334155'; gx.font = 'bold 44px monospace'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.fillText(L && L.mains ? '400 V' : '---', w / 2, h / 2);
    }, mp, { emissive: 0.8 });
    scr.position.set(0, 0.95, 0.17); sc.meter = scr;
    k.box(0.5, 0.02, 0.01, M.plasticDark, 0, 0.75, 0.165, mp);
    k.pickable(mp, 'Sayaç ve AG giriş panosu', a => ['Şebeke gerilimi: ' + (a.live.mains ? '400 V' : 'yok'), 'Ölçü: aktif/reaktif sayaç, AG giriş koruması'], mainsActions);
    k.explodable(mp, [0.5, 0, 0.3]);
    sc.trafoLabel = k.label('Şebeke · trafo', tank, [0, 2.15, 0]);
  }

  /* ATS (otomatik transfer) panosu: QM / QG kesicileri ve mekanik kilit */
  function buildATS(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -4.6, 0, -2.0);
    k.box(1.5, 0.1, 0.6, M.plasticDark, 0, 0.05, 0, g);
    const body = k.box(1.5, 2.0, 0.6, M.panelRAL7035, 0, 1.1, 0, g);
    k.box(1.52, 0.03, 0.62, M.panelRAL7035, 0, 2.115, 0, g);
    k.box(0.02, 1.96, 0.03, M.darkSteel, 0, 1.1, 0.305, g); void body;
    // kontrolör ekranı
    const scr = k.screen(0.36, 0.2, 384, (gx, w, h) => drawATS(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(0, 1.72, 0.306); sc.atsScreen = scr;
    k.box(0.4, 0.24, 0.01, M.plasticDark, 0, 1.72, 0.302, g);
    k.pickable(scr, 'ATS kontrolörü', a => { const L = a.live; return ['Durum: ' + ATS_NAME[L.ats.state], 'Onay ' + a.state.tConfirm + ' s · yol alma ' + a.state.tGenReady + ' s · ölü zaman ' + a.state.tDead + ' s', 'Dönüş bekleme ' + a.state.tReturn + ' s · soğutma ' + a.state.tCool + ' s', 'TS EN 60947-6-1: transfer anahtarlama cihazları']; }, mainsActions);
    sc.brk = {};
    [['QM', -0.36], ['QG', 0.36]].forEach(b => {
      const dev = k.group(g, b[1], 1.12, 0.3);
      k.rbox(0.44, 0.46, 0.14, 0.02, M.plasticDark, 0, 0, 0.02, dev);
      k.box(0.34, 0.3, 0.02, M.plasticGrey, 0, 0.02, 0.095, dev);
      const handle = k.box(0.05, 0.12, 0.06, M.plasticBlue, 0, 0.02, 0.12, dev);
      const flag = k.box(0.08, 0.035, 0.01, M.plasticGreen, 0.1, 0.15, 0.108, dev);
      const plate = k.screen(0.14, 0.05, 128, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 34px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(b[0], w / 2, h / 2 + 2); }, dev);
      plate.position.set(-0.1, 0.17, 0.108);
      const lamp = k.sphere(0.022, M.ledOff, 0, 0.32, 0.02, dev);
      k.pickable(dev, b[0] === 'QM' ? 'QM · şebeke kesicisi' : 'QG · jeneratör kesicisi', a => {
        const L = a.live, on = L.ats[b[0]];
        return [(on ? 'KAPALI' : 'AÇIK') + ' (ATS durum makinesi)', 'Motorlu kesici, 4 kutup (nötr anahtarlamalı)', 'Diğer kesiciyle mekanik + elektriksel kilitli: ikisi asla birlikte kapanmaz.', b[0] === 'QG' ? 'Jeneratör: ' + (L.ats.genRunning ? 'çalışıyor' : 'duruyor') : 'Şebeke: ' + (L.mains ? 'var' : 'yok'), 'Kesiciler ATS durum makinesiyle sürülür; elle kumanda yerine şebekeyi kesip/geri vererek deneyin.'];
      }, mainsActions);
      k.explodable(dev, [0, 0, 0.45]);
      sc.brk[b[0]] = { handle: handle, flag: flag, lamp: lamp };
    });
    // mekanik kilit: iki kesici arasında kayan çubuk ve durdurma pimleri
    const bar = k.box(0.56, 0.035, 0.035, M.steel, 0, 0.8, 0.34, g);
    [-0.36, 0.36].forEach(x => k.box(0.03, 0.08, 0.04, M.brass, x, 0.84, 0.33, g));
    k.box(0.06, 0.06, 0.05, M.darkSteel, 0, 0.8, 0.33, g);
    k.pickable(bar, 'Mekanik kilit', a => ['Kapalı olan kesici çubuğu öteki kesicinin kapama mekanizmasına iter.', 'Durum: ' + (a.live.ats.QM ? 'QG kilitli' : a.live.ats.QG ? 'QM kilitli' : 'ikisi de açık (ölü zaman)')]);
    sc.bar = bar;
    sc.atsLabel = k.label('ATS panosu', g, [0, 2.4, 0]);
  }
  function drawATS(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    if (!L) return;
    gx.fillStyle = '#22d3ee'; gx.font = 'bold 22px monospace'; gx.fillText('ATS', 14, 30);
    gx.fillStyle = L.mains ? '#4ade80' : '#ef4444'; gx.fillText(L.mains ? 'ŞEB OK' : 'ŞEB YOK', 80, 30);
    gx.fillStyle = L.ats.genRunning ? '#fbbf24' : '#64748b'; gx.fillText(L.ats.genRunning ? 'JEN ÇALIŞ' : 'JEN DUR', 220, 30);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 24px Arial'; gx.fillText(ATS_NAME[L.ats.state].toLocaleUpperCase('tr-TR').slice(0, 26), 14, 90);
    gx.fillStyle = '#94a3b8'; gx.font = '20px monospace'; gx.fillText('QM ' + (L.ats.QM ? 'I' : 'O') + '   QG ' + (L.ats.QG ? 'I' : 'O') + '   t=' + fmt(L.ats.timer, 1) + ' s', 14, 150);
  }

  /* dizel jeneratör seti: şase, kabin (panjurlu), egzoz, kontrol paneli */
  const GEN_X0 = -5.2, GEN_DX = 4.9;
  function buildGenset(k, sc, app, gxp, idx, nGen) {
    const T = k.T, M = k.mats;
    const g = k.group(null, gxp, 0, -6.2);
    const set = { idx: idx, puffs: [] };
    const nm = nGen > 1 ? 'G' + (idx + 1) + ' · ' : '';
    // şase ve kaide yakıt tankı
    k.box(4.2, 0.4, 1.3, M.darkSteel, 0, 0.2, 0, g);
    [-0.66, 0.66].forEach(z => k.box(4.3, 0.16, 0.1, M.darkSteel, 0, 0.48, z, g));
    // motor bloğu, alternatör, radyatör (kabin içinde)
    const engMat = new T.MeshStandardMaterial({ color: 0x38506b, metalness: 0.5, roughness: 0.5 });
    k.box(1.6, 0.85, 0.75, engMat, -0.35, 1.0, 0, g);
    k.box(1.3, 0.2, 0.5, M.steel, -0.35, 1.5, 0, g);
    const alt = k.cyl(0.42, 0.42, 1.0, M.plasticDark, 0.95, 1.0, 0, g, 28); alt.rotation.z = Math.PI / 2;
    k.box(0.4, 0.35, 0.35, M.plasticDark, 1.0, 1.55, 0.25, g); // alternatör klemens kutusu
    k.box(0.12, 1.25, 1.05, M.darkSteel, -1.65, 1.15, 0, g);
    const fan = k.group(g, -1.55, 1.15, 0);
    for (let j = 0; j < 5; j++) { const b = k.box(0.03, 0.42, 0.1, M.darkSteel, 0, 0.2, 0, fan); b.position.set(0, Math.cos(j * 1.2566) * 0.2, Math.sin(j * 1.2566) * 0.2); b.rotation.x = j * 1.2566; }
    sc.fans.push({ obj: fan, axis: 'x', key: 'gen' });
    const engine = k.group(g, 0, 0, 0); void engine;
    // kabin (ses yalıtımlı) — kabuk; patlatınca yukarı kalkar
    const canMat = new T.MeshStandardMaterial({ color: 0x5f6f58, metalness: 0.35, roughness: 0.55 });
    const can = k.group(g, 0, 0, 0);
    const W = 4.4, Hh = 1.75, D = 1.5, y0 = 0.56;
    k.box(W, 0.05, D, canMat, 0, y0 + Hh, 0, can);
    k.box(W, Hh, 0.04, canMat, 0, y0 + Hh / 2, D / 2, can);
    k.box(W, Hh, 0.04, canMat, 0, y0 + Hh / 2, -D / 2, can);
    k.box(0.04, Hh, D, canMat, -W / 2, y0 + Hh / 2, 0, can);
    k.box(0.04, Hh, D, canMat, W / 2, y0 + Hh / 2, 0, can);
    // kapı çizgileri ve menteşeler
    for (let i = 0; i < 4; i++) k.box(0.02, Hh - 0.15, 0.012, M.darkSteel, -1.65 + i * 1.1, y0 + Hh / 2, D / 2 + 0.025, can);
    // panjurlar (InstancedMesh): yan hava girişleri ve radyatör çıkışı
    const louv = new T.InstancedMesh(new T.BoxGeometry(0.85, 0.035, 0.05), M.darkSteel, 36);
    const d = new T.Object3D(); let n = 0;
    [-1, 1].forEach(side => { for (let i = 0; i < 12; i++) { d.position.set(1.35, y0 + 0.3 + i * 0.1, side * (D / 2 + 0.03)); d.rotation.set(side * 0.6, 0, 0); d.updateMatrix(); louv.setMatrixAt(n++, d.matrix); } });
    for (let i = 0; i < 12; i++) { d.position.set(-W / 2 - 0.03, y0 + 0.3 + i * 0.1, 0); d.rotation.set(0, Math.PI / 2, 0.6); d.scale.set(1.25, 1, 1); d.updateMatrix(); louv.setMatrixAt(n++, d.matrix); }
    louv.castShadow = true; can.add(louv);
    // susturucu ve egzoz bacası (çatıda)
    const muf = k.cyl(0.2, 0.2, 1.3, M.galv, 0.2, y0 + Hh + 0.3, -0.25, can, 20); muf.rotation.z = Math.PI / 2;
    [-0.3, 0.6].forEach(x => k.box(0.08, 0.25, 0.08, M.galv, x, y0 + Hh + 0.13, -0.25, can));
    const stack = k.cyl(0.09, 0.09, 1.0, M.galv, 0.95, y0 + Hh + 0.75, -0.25, can, 16);
    const cap = k.cyl(0.14, 0.1, 0.04, M.darkSteel, 0.95, y0 + Hh + 1.28, -0.25, can, 16); cap.rotation.z = 0.45;
    void stack; set.stackTop = new T.Vector3(gxp + 0.95, y0 + Hh + 1.32, -6.2 - 0.25);
    k.shell(can);
    k.explodable(can, [0, 1.6, 0]);
    // kontrol paneli (ön kapakta)
    const cp = k.group(g, 1.75, y0 + 1.05, D / 2 + 0.03);
    k.rbox(0.5, 0.42, 0.1, 0.015, M.plasticDark, 0, 0, 0.04, cp);
    const scr = k.screen(0.3, 0.17, 256, (gx, w, h) => drawGen(gx, w, h, app), cp, { emissive: 0.9 });
    scr.position.set(0, 0.06, 0.092); set.screen = scr;
    set.led = k.sphere(0.018, M.ledOff, -0.17, -0.14, 0.09, cp);
    const estop = k.cyl(0.035, 0.035, 0.03, M.plasticRed, 0.17, -0.14, 0.1, cp, 16); estop.rotation.x = Math.PI / 2;
    k.pickable(cp, nm + 'Jeneratör kontrol paneli', a => { const L = a.live, r = a.validResult.values; return ['Durum: ' + (L.ats.genRunning ? (L.ats.state === 'GEN_START' ? 'yol alıyor' : 'çalışıyor 1500 d/dk · 50 Hz') : 'hazırda bekliyor'), 'Set yükü: ' + fmt(r.genLoadKVA / r.gp.n, 0, 'kVA') + ' (%' + fmt(r.gp.perSetPct, 0) + ')', 'Tüketim ≈ ' + fmt(r.gp.fuelPerSet, 1, 'l/sa') + ' (set) · toplam depo ' + fmt(L.fuelL, 0, 'l')]; }, mainsActions);
    k.pickable(alt, nm + 'Alternatör', a => ['Senkron alternatör, ' + a.state.genKVA + ' kVA (prime)', 'Yüklenme %' + fmt(a.validResult.values.gp.perSetPct, 0), 'Adım yük kabulü: Jeneratör grubundaki plan (ISO 8528-5, temsili sınır)']);
    k.pickable(can, nm + 'Dizel jeneratör seti', a => { const r = a.validResult.values; return [a.state.genKVA + ' kVA · kabinli, kaide yakıt tanklı (' + a.state.tank + ' l)', 'Yakıt süresi (tam depo): ' + fmt(r.fuelHours, 1, 'sa'), 'Özgül tüketim ' + fmt(a.state.fuel, 2) + ' l/kWh (yükten bağımsız kabul)', a.state.nGen > 1 ? a.state.nGen + ' set senkron barada eşit yük paylaşır.' : 'Tek set: yedek yok.']; }, mainsActions);
    // egzoz dumanı (temsili, yalnız çalışırken)
    const pm = new T.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 6; i++) { const p = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), pm.clone()); p.visible = false; p.userData.ph = i / 6; k.viewer.root.add(p); set.puffs.push(p); }
    set.group = can;
    if (!idx) sc.genLabel = k.label('Dizel jeneratör', can, [0, 2.7, 0]);
    sc.gens.push(set);
  }
  /* paralel setler için senkronizasyon panosu (ortak bara, senkron kontrol) */
  function buildSync(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -2.0, 0, -4.6);
    k.box(0.9, 0.08, 0.45, M.plasticDark, 0, 0.04, 0, g);
    k.rbox(0.9, 1.9, 0.42, 0.02, M.panelRAL7035, 0, 1.03, 0, g);
    const scr = k.screen(0.42, 0.24, 256, (gx, w, h) => {
      const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h); if (!L) return;
      const n = app.state.nGen || 1, on = L.ats.genRunning && L.ats.state !== 'GEN_START';
      gx.fillStyle = '#22d3ee'; gx.font = 'bold 22px monospace'; gx.fillText('SENKRON', 10, 28);
      for (let i = 0; i < n; i++) { gx.fillStyle = on ? '#4ade80' : L.ats.genRunning ? '#fbbf24' : '#475569'; gx.fillRect(12 + i * 58, 52, 46, 36); gx.fillStyle = '#04121f'; gx.font = 'bold 20px monospace'; gx.fillText('G' + (i + 1), 22 + i * 58, 78); }
      gx.fillStyle = '#e2e8f0'; gx.font = '18px monospace'; gx.fillText(on ? 'BARA 400 V 50 Hz' : L.ats.genRunning ? 'SENKRONLANIYOR' : 'BEKLEMEDE', 10, 122);
    }, g, { emissive: 0.9 });
    scr.position.set(0, 1.55, 0.215); sc.syncScreen = scr;
    for (let i = 0; i < 4; i++) k.cyl(0.035, 0.035, 0.03, i % 2 ? M.plasticRed : M.plasticGreen, -0.3 + i * 0.2, 1.1, 0.22, g, 14).rotation.x = Math.PI / 2;
    k.pickable(g, 'Senkronizasyon panosu (paralel jeneratörler)', a => {
      const n = a.state.nGen, ok = X.canCloseGen(true, { dU: 2, df: 0.1, dphi: 5 }), no = X.canCloseGen(true, { dU: 3, df: 0.4, dphi: 25 });
      return [n + ' set ortak bara · yük paylaşımı eşit (kW/kVAr)', 'G1 ölü baraya: ' + X.canCloseGen(false, {}).msg, 'Örnek G2 (ΔU %2, Δf 0,1 Hz, Δφ 5°): ' + ok.msg, 'Örnek G2 (ΔU %3, Δf 0,4 Hz, Δφ 25°): ' + no.msg, 'Sınırlar temsilidir; ayar senkronlama rölesi ve üretici talimatına göre yapılır.'];
    }, mainsActions);
    k.label('Senkron pano', g, [0, 2.2, 0], 'vs-label--sm');
  }
  function drawGen(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#071a10'; gx.fillRect(0, 0, w, h);
    if (!L) return;
    const run = L.ats.genRunning, ready = run && L.ats.state !== 'GEN_START';
    gx.fillStyle = '#4ade80'; gx.font = 'bold 22px monospace'; gx.fillText(run ? (ready ? 'ÇALIŞIYOR' : 'YOL ALIYOR') : 'OTOMATİK', 12, 32);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 26px monospace';
    gx.fillText((ready ? '50.0' : run ? '--.-' : ' 0.0') + ' Hz', 12, 76);
    gx.fillText((ready ? '400' : '  0') + ' V', 12, 112);
    gx.fillStyle = '#fbbf24'; gx.fillText((L.ats.QG ? fmt(app.validResult.values.genPct, 0) : '0') + ' %', 150, 112);
  }

  /* online UPS kabini */
  function buildUPS(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -0.2, 0, -2.2);
    k.box(1.0, 0.1, 0.85, M.plasticDark, 0, 0.05, 0, g);
    k.box(1.0, 2.0, 0.8, M.panelDark, 0, 1.1, -0.02, g);
    const modular = app.state.upsArch === 'modular';
    if (modular) {
      // modüler UPS: önden sökülebilir güç modülleri (çekmece), her biri durum LED’li ve tıklanabilir
      sc.mods = [];
      const n = app.state.upsModules, hM = Math.min(0.24, 1.5 / n);
      for (let i = 0; i < n; i++) {
        const y = 0.32 + hM / 2 + i * (hM + 0.02);
        const m = k.group(g, 0, y, 0.06);
        k.rbox(0.86, hM, 0.66, 0.012, M.plasticGrey, 0, 0, 0, m);
        k.box(0.84, hM - 0.03, 0.02, M.plasticDark, 0, 0, 0.335, m);
        for (let f = 0; f < 6; f++) k.box(0.05, hM * 0.55, 0.012, M.darkSteel, -0.33 + f * 0.07, 0, 0.35, m); // fan ızgarası
        k.box(0.16, 0.025, 0.03, M.alu, 0.28, 0, 0.36, m); // çekme kolu
        const led = k.sphere(0.016, M.ledGreen, 0.1, 0, 0.35, m);
        sc.mods.push({ led: led });
        const ix = i;
        k.pickable(m, 'Güç modülü ' + (i + 1) + ' / ' + n, a => {
          const st = a.state, r = a.validResult.values, failed = ix >= st.upsModules - Math.min(st.failedMods || 0, st.upsModules - 1);
          return [st.modKVA + ' kVA · doğrultucu + inverter + şarj', 'Durum: ' + (failed ? 'ARIZALI (devre dışı)' : 'çalışıyor, modül başına %' + fmt(r.mod.perModPct, 0)), 'N = ' + r.mod.N + ' · ' + st.redundancy + ' hedefi ' + (r.mod.configOK ? 'sağlanıyor' : 'sağlanmıyor'), 'Modüller yükü eşit paylaşır; arızalı modül sıcak değiştirilebilir (hot-swap).'];
        }, a => {
          const st = a.state, failed = ix >= st.upsModules - Math.min(st.failedMods || 0, st.upsModules - 1);
          return [failed ? { label: 'Modülü onar (değiştir)', variant: 'primary', onClick: x => { x.state.failedMods = Math.max(0, (x.state.failedMods || 0) - 1); x.live.events.push(fmtT(x.live.t) + ' · Güç modülü değiştirildi.'); x.renderControls(); x.invalidate(); } }
            : st.failedMods >= st.upsModules - 1 ? null : { label: 'Modül arızası oluştur', variant: 'danger', onClick: x => { x.state.failedMods = (x.state.failedMods || 0) + 1; x.live.events.push(fmtT(x.live.t) + ' · Güç modülü arızalandı.'); x.running = true; x.paused = false; x.renderControls(); x.invalidate(); } }].filter(Boolean);
        });
      }
    } else {
      // iç modüller (kabuk saydamlaşınca görünür)
      for (let i = 0; i < 4; i++) k.rbox(0.8, 0.28, 0.6, 0.015, M.plasticGrey, 0, 0.45 + i * 0.34, 0, g);
    }
    for (let i = 0; i < 6; i++) k.cyl(0.04, 0.04, 0.16, M.alu, -0.3 + i * 0.12, 1.85, 0.1, g, 12);
    // ön kapak (tek blokta kabuk; modülerde modüller önden görünür) ve üst gösterge bandı
    if (!modular) {
      const door = k.box(0.98, 1.65, 0.03, M.panelDark, 0, 0.93, 0.395, g); k.shell(door);
      for (let i = 0; i < 8; i++) k.box(0.6, 0.012, 0.01, M.darkSteel, 0, 0.3 + i * 0.05, 0.415, g);
    }
    k.box(0.98, 0.33, 0.03, M.plasticDark, 0, 1.93, 0.395, g);
    const scr = k.screen(0.34, 0.2, 384, (gx, w, h) => drawUPS(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(-0.15, 1.93, 0.412); sc.upsScreen = scr;
    sc.upsLeds = ['Şebeke', 'Akü', 'Arıza'].map((n, i) => k.sphere(0.018, M.ledOff, 0.2 + i * 0.09, 1.93, 0.412, g));
    k.pickable(g, modular ? 'Modüler online UPS' : 'Online UPS (çift dönüşüm)', a => { const r = a.validResult.values, L = a.live; return [(r.mod ? r.mod.active + ' / ' + a.state.upsModules + ' modül × ' + a.state.modKVA : a.state.upsKVA) + ' kVA · çıkış PF ' + fmt(a.state.upsPF, 2) + ' · η ' + fmt(a.state.etaInv, 1) + ' %', 'Yüklenme %' + fmt(r.upsLoad, 0) + ' (IEC 62040-3)', 'Mod: ' + supplyText(L), 'Çıkış yolu: ' + X.modeName(L.byp) + (a.state.bypSync ? '' : ' · bypass senkron dışı'), 'Doğrultucu → DC bara → inverter; statik anahtar senkronken bypass’a kesintisiz geçer.']; }, bypActions);
    // bakım bypass panosu (harici): Q2 UPS çıkış ayırıcısı, Q3 bakım bypass anahtarı, mimik ekran
    const mb = k.group(null, -1.05, 0, -2.3);
    k.box(0.56, 0.08, 0.4, M.plasticDark, 0, 0.04, 0, mb);
    k.rbox(0.56, 1.5, 0.36, 0.02, M.panelRAL7035, 0, 0.83, 0, mb);
    const mim = k.screen(0.36, 0.22, 256, (gx, w, h) => drawMimic(gx, w, h, app), mb, { emissive: 0.9 });
    mim.position.set(0, 1.32, 0.185); sc.mimic = mim;
    sc.mbp = {};
    [['Q2', 0.92], ['Q3', 0.55]].forEach(q => {
      k.cyl(0.07, 0.07, 0.03, M.plasticYellow, 0, q[1], 0.19, mb, 24).rotation.x = Math.PI / 2;
      const hnd = k.group(mb, 0, q[1], 0.215);
      k.box(0.03, 0.12, 0.03, M.plasticRed, 0, 0.0, 0, hnd);
      const pl = k.screen(0.16, 0.04, 160, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 22px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(q[0] === 'Q2' ? 'Q2 UPS ÇIKIŞ' : 'Q3 BAKIM BYP', w / 2, h / 2); }, mb);
      pl.position.set(0, q[1] + 0.11, 0.186);
      sc.mbp[q[0]] = hnd;
    });
    k.pickable(mb, 'Bakım bypass panosu (Q2 / Q3)', a => { const b = a.live.byp; return ['Q2 UPS çıkışı: ' + (b.Q2 ? 'kapalı' : 'açık') + ' · Q3 bakım bypass: ' + (b.Q3 ? 'kapalı' : 'açık'), 'Q3 yalnız yük statik bypass üzerindeyken kapanır (inverterle paralel olmaz); Q2 yalnız Q3 kapalıyken açılır.', 'Bakımda UPS tamamen ayrılır; yük ATS barasından korumasız beslenir.']; }, bypActions);
    sc.mbpLabel = k.label('Bakım bypass', mb, [0, 0.35, 0.25], 'vs-label--sm');
    sc.upsLabel = k.label('Online UPS', g, [0, 2.35, 0]);
  }
  function mainsActions(app) {
    return [{ label: app.live.mains ? 'Şebekeyi kes' : 'Şebekeyi geri ver', variant: app.live.mains ? 'danger' : 'primary', onClick: a => cut(a, a.live.mains) }];
  }
  /** Bakım bypass panosu mimik ekranı: kaynak → SS / Q2 / Q3 → yük. */
  function drawMimic(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    if (!L || !L.byp) return;
    const b = L.byp, p = paths(L), on = '#4ade80', off = '#475569';
    gx.lineWidth = 6; gx.font = 'bold 18px monospace'; gx.fillStyle = '#22d3ee'; gx.fillText('BYPASS', 10, 22);
    const ln = (x1, y1, x2, y2, c) => { gx.strokeStyle = c; gx.beginPath(); gx.moveTo(x1, y1); gx.lineTo(x2, y2); gx.stroke(); };
    ln(20, 60, 236, 60, p.bus ? '#fcd34d' : off);                       // ATS barası
    ln(60, 60, 60, 100, p.path === 'inv' ? on : off); gx.fillStyle = '#e2e8f0'; gx.fillText('UPS', 40, 120);
    ln(128, 60, 128, 100, b.SS === 'byp' && b.Q2 ? on : off); gx.fillText('SS', 116, 120);
    ln(200, 60, 200, 100, b.Q3 ? on : off); gx.fillText('Q3', 188, 120);
    gx.fillStyle = p.crit ? on : '#ef4444'; gx.fillText(p.crit ? 'YÜK BESLENİYOR' : 'YÜK KESİK', 10, 150);
  }
  function drawUPS(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h);
    if (!L || !app.validResult) return;
    const p = paths(L), r = app.validResult.values;
    gx.fillStyle = !p.crit ? '#ef4444' : p.onBat || !p.invMode ? '#fbbf24' : '#4ade80'; gx.font = 'bold 24px monospace';
    gx.fillText(!p.crit ? 'ÇIKIŞ YOK' : !p.invMode ? (p.path === 'maint' ? 'BAKIM BYPASS' : 'STATİK BYPASS') : p.onBat ? 'AKÜ MODU' : 'NORMAL', 14, 34);
    gx.fillStyle = '#e2e8f0'; gx.font = 'bold 22px monospace';
    gx.fillText('YÜK %' + fmt(r.upsLoad, 0), 14, 76);
    gx.fillText('KALAN ' + (p.onBat ? VS.fmtDuration(L.soc * r.runtime) : '—'), 14, 110);
    // SOC çubuğu
    gx.strokeStyle = '#94a3b8'; gx.lineWidth = 3; gx.strokeRect(14, 140, w - 90, 40);
    gx.fillStyle = 'hsl(' + Math.round(L.soc * 120) + ',80%,50%)'; gx.fillRect(18, 144, (w - 98) * L.soc, 32);
    gx.fillStyle = '#e2e8f0'; gx.fillText(fmt(L.soc * 100, 0) + '%', w - 70, 170);
  }

  /* akü rafları: bloklar InstancedMesh, ön etiket şeridi SOC oranında dolar ve renklenir */
  function buildBattery(k, sc, s, app) {
    const T = k.T, M = k.mats;
    const total = s.nBlocks * s.strings, shown = Math.min(total, MAX_SHOWN);
    const perShelf = 8, perRack = 48, racks = Math.max(1, Math.ceil(shown / perRack));
    const x0 = 1.2, rw = 1.55, z0 = -2.2;
    const frame = k.group(null, 0, 0, 0);
    for (let r = 0; r < racks; r++) {
      const cx = x0 + rw / 2 + r * (rw + 0.08);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(p => k.box(0.04, 1.95, 0.04, M.galv, cx + p[0] * (rw / 2 - 0.02), 0.975, z0 + p[1] * 0.27, frame));
      for (let i = 0; i < 6; i++) k.box(rw, 0.025, 0.56, M.galv, cx, 0.12 + i * 0.31, z0, frame);
    }
    const body = new T.InstancedMesh(new T.BoxGeometry(0.33, 0.21, 0.17), new T.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }), shown);
    const strip = new T.InstancedMesh(new T.BoxGeometry(0.28, 0.035, 0.006), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.35 }), shown);
    const term = new T.InstancedMesh(new T.CylinderGeometry(0.018, 0.018, 0.03, 8), M.brass, shown * 2);
    const d = new T.Object3D(), base = [];
    for (let i = 0; i < shown; i++) {
      const r = Math.floor(i / perRack), j = i % perRack, shelf = Math.floor(j / perShelf), q = j % perShelf;
      const col = q % 4, row = Math.floor(q / 4);
      const x = x0 + 0.06 + 0.2 + col * 0.36 + r * (rw + 0.08), y = 0.12 + shelf * 0.31 + 0.12, z = z0 + (row ? 0.12 : -0.12);
      d.position.set(x, y, z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); body.setMatrixAt(i, d.matrix);
      base.push([x, y, z]);
      [-0.1, 0.1].forEach((dx, t) => { d.position.set(x + dx, y + 0.12, z); d.updateMatrix(); term.setMatrixAt(i * 2 + t, d.matrix); });
    }
    [body, strip, term].forEach(m => { m.castShadow = true; m.receiveShadow = true; k.viewer.root.add(m); });
    sc.bat = { strip: strip, base: base, shown: shown };
    k.pickable(frame, 'Akü grubu (VRLA)', a => { const r = a.validResult.values, st = a.state; return [st.nBlocks + ' × ' + st.Vblock + ' V seri · ' + st.strings + ' paralel grup · ' + st.Ah + ' Ah', 'Toplam ' + fmt(r.Ebat, 1, 'kWh') + ' · DC ' + fmt(r.Vbat, 0, 'V'), 'Yedekleme ≈ ' + VS.fmtDuration(r.runtime) + ' (DoD %' + st.dod + ', k_T ' + st.kTemp + ', k_yaş ' + st.kAge + ')', total > shown ? 'Sahnede ' + shown + ' / ' + total + ' blok gösteriliyor.' : 'Akü odası havalandırması: TS EN IEC 62485-2']; });
    k.pickable(body, 'Akü bloğu', a => ['Blok ' + a.state.Vblock + ' V · ' + a.state.Ah + ' Ah', 'SOC %' + fmt(a.live.soc * 100, 0)]);
    sc.batLabel = k.label('Akü · ' + total + ' blok', frame, [x0 + rw / 2, 2.15, z0]);
    if (total > shown) k.label('+' + (total - shown) + ' blok gösterilmiyor', frame, [x0 + rw / 2, 0.1, z0 + 0.5], 'vs-label--sm');
  }
  function paintBattery(k, sc, soc) {
    const b = sc.bat; if (!b) return;
    const d = new k.T.Object3D();
    const s = Math.max(0.03, soc);
    b.base.forEach((p, i) => { d.position.set(p[0] - 0.14 * (1 - s), p[1] + 0.05, p[2] + 0.088 * (p[2] > -2.2 ? 1 : 1)); d.scale.set(s, 1, 1); d.updateMatrix(); b.strip.setMatrixAt(i, d.matrix); });
    b.strip.instanceMatrix.needsUpdate = true;
    b.strip.material.color.setHSL(soc * 0.33, 0.85, 0.5); b.strip.material.emissive.setHSL(soc * 0.33, 0.85, 0.4);
  }

  /* kritik yükler: sunucu kabinleri (UPS çıkışı) */
  function buildServers(k, sc, app) {
    const T = k.T, M = k.mats;
    const n = 5, x0 = 0.2, z = 1.7;
    const g = k.group(null, 0, 0, 0);
    const perf = (gx, w, h) => { gx.fillStyle = '#15191e'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#2b323b'; for (let y = 6; y < h; y += 10) for (let x = 6 + (y / 10 % 2) * 5; x < w; x += 10) { gx.beginPath(); gx.arc(x, y, 3, 0, Math.PI * 2); gx.fill(); } gx.fillStyle = '#3a424c'; gx.fillRect(w - 14, h / 2 - 30, 6, 60); };
    const units = new T.InstancedMesh(new T.BoxGeometry(0.48, 0.085, 0.8), M.darkSteel, n * 14);
    const ledA = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.012, 0.01), M.ledGreen, n * 14);
    const ledB = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.012, 0.01), M.ledBlue, n * 14);
    const d = new T.Object3D(); let u = 0;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * 0.62;
      k.box(0.6, 2.0, 1.0, M.plasticDark, cx, 1.0, z, g);
      const door = k.screen(0.56, 1.9, 128, perf, g); door.position.set(cx, 1.0, z + 0.505); k.shell(door);
      for (let j = 0; j < 14; j++) {
        const y = 0.25 + j * 0.115;
        d.position.set(cx, y, z + 0.08); d.updateMatrix(); units.setMatrixAt(u, d.matrix);
        d.position.set(cx - 0.2, y, z + 0.515); d.updateMatrix(); ledA.setMatrixAt(u, d.matrix);
        d.position.set(cx - 0.17 + (j % 3) * 0.02, y, z + 0.515); d.updateMatrix(); ledB.setMatrixAt(u, d.matrix);
        u++;
      }
    }
    [units, ledA, ledB].forEach(m => { m.castShadow = m === units; k.viewer.root.add(m); });
    sc.srv = { ledA: ledA, ledB: ledB };
    k.pickable(g, 'Kritik yükler · sunucu kabinleri', a => { const r = a.validResult.values; return [fmt(a.state.Pcrit, 0, 'kW') + ' · cosφ ' + fmt(a.state.pfCrit, 2) + ' → ' + fmt(r.Scrit, 1, 'kVA'), 'Besleme: ' + supplyText(a.live), 'UPS çıkışından beslenir; kesinti anında aküden kesintisiz devam eder.']; });
    sc.srvLabel = k.label('Kritik yükler · sunucular', g, [x0 + 1.24, 2.35, z]);
  }

  /* diğer yükler: klima santrali + tali dağıtım panosu (ATS çıkışından, UPS’siz) */
  function buildOther(k, sc, app) {
    const M = k.mats;
    const g = k.group(null, -4.6, 0, 2.1);
    k.box(2.4, 0.12, 1.2, M.darkSteel, 0, 0.06, 0, g);
    k.box(2.4, 1.3, 1.2, M.galv, 0, 0.77, 0, g);
    for (let i = 0; i < 5; i++) k.box(0.012, 1.2, 0.01, M.steel, -1 + i * 0.5, 0.77, 0.605, g);
    [-0.6, 0.6].forEach(x => {
      k.cyl(0.42, 0.42, 0.1, M.darkSteel, x, 1.47, 0, g, 28);
      const fan = k.group(g, x, 1.53, 0);
      for (let j = 0; j < 4; j++) { const b = k.box(0.36, 0.01, 0.1, M.plasticGrey, 0, 0, 0, fan); b.position.set(Math.cos(j * Math.PI / 2) * 0.18, 0, Math.sin(j * Math.PI / 2) * 0.18); b.rotation.y = -j * Math.PI / 2; b.rotation.x = 0.35; }
      k.cyl(0.07, 0.07, 0.05, M.plasticDark, 0, 0, 0, fan, 12);
      sc.fans.push({ obj: fan, axis: 'y', key: 'other' });
    });
    const pnl = k.group(g, 1.75, 0, 0.1);
    k.rbox(0.6, 1.4, 0.3, 0.02, M.panelRAL7035, 0, 0.8, 0, pnl);
    sc.otherLed = k.sphere(0.02, M.ledOff, 0.15, 1.35, 0.16, pnl);
    k.explodable(pnl, [0.6, 0, 0.3]);
    k.pickable(g, 'Diğer yükler (HVAC, aydınlatma)', a => [fmt(a.state.Pother, 0, 'kW') + ' · cosφ ' + fmt(a.state.pfOther, 2), 'ATS çıkışından beslenir: kesintide jeneratör devreye girene kadar enerjisizdir.', 'Besleme: ' + (paths(a.live).bus ? (a.live.ats.QG ? 'jeneratör' : 'şebeke') : 'YOK')]);
    sc.otherLabel = k.label('Diğer yükler', g, [0, 1.9, 0]);
  }

  /* durum → sahne: kesiciler, akışlar, LED’ler, ekranlar (yalnız değişince) */
  function applyState(k, app) {
    const sc = app.scene3, L = app.live, M = k.mats; if (!sc || !L || !app.validResult) return;
    const p = paths(L), a = L.ats, r = app.validResult.values;
    const sig = [a.state, a.QM, a.QG, L.mains, L.dropped, JSON.stringify(L.byp), L.interrupts, app.state.bypSync, Math.round(L.soc * 100), Math.round(L.fuelL), Math.round(a.timer * 2), app.state.accel, r.upsLoad, app.state.failedMods].join('|');
    if (sig === sc.sig) return;
    sc.sig = sig;
    ['QM', 'QG'].forEach(n => {
      const b = sc.brk[n], on = a[n];
      b.handle.position.y = on ? 0.06 : -0.02; b.handle.rotation.x = on ? 0 : 0.4;
      b.flag.material = on ? M.plasticRed : M.plasticGreen;
      b.lamp.material = on ? (n === 'QM' ? M.ledGreen : M.ledAmber) : M.ledOff;
    });
    sc.bar.position.x = a.QM ? 0.08 : a.QG ? -0.08 : 0;
    const F = sc.flows, sp = x => Math.min(1.2, 0.25 + x / 120);
    F.mains.speed = p.viaMains ? sp(r.genLoadKVA / 2) : 0;
    F.gen.speed = p.viaGen ? sp(r.genLoadKVA / 2) : 0;
    F.atsUps.speed = p.bus ? sp(r.upsLoad) : 0;
    F.other.speed = p.bus && app.state.Pother > 0 ? 0.5 : 0;
    F.bat.speed = p.onBat ? sp(r.upsLoad) : p.bus && L.soc < 0.999 ? 0.15 : 0; F.bat.dir = p.onBat ? 1 : -1;
    F.crit.speed = p.crit ? sp(r.upsLoad) : 0;
    sc.upsLeds[0].material = p.bus ? M.ledGreen : M.ledOff;
    sc.upsLeds[1].material = p.onBat ? M.ledAmber : M.ledOff;
    sc.upsLeds[2].material = !p.crit ? M.ledRed : !p.invMode ? M.ledAmber : M.ledOff;
    if (sc.mbp) { sc.mbp.Q2.rotation.z = L.byp.Q2 ? 0 : -Math.PI / 2; sc.mbp.Q3.rotation.z = L.byp.Q3 ? 0 : -Math.PI / 2; sc.mimic.redraw();
      sc.mbpLabel.set('Bakım bypass · ' + (L.byp.Q3 ? 'Q3 kapalı' : 'Q3 açık')); sc.mbpLabel.level(L.byp.Q3 ? 'warn' : ''); }
    sc.gens.forEach(gs => { gs.led.material = a.genRunning ? (a.state === 'GEN_START' ? M.ledAmber : M.ledGreen) : M.ledOff; gs.screen.redraw(); });
    if (sc.syncScreen) sc.syncScreen.redraw();
    if (F.genBus) F.genBus.speed = F.gen.speed;
    if (sc.mods) sc.mods.forEach((m, i) => { const bad = i >= app.state.upsModules - Math.min(app.state.failedMods || 0, app.state.upsModules - 1); m.led.material = bad ? M.ledRed : p.invMode && p.crit ? M.ledGreen : M.ledAmber; });
    sc.otherLed.material = p.bus ? M.ledGreen : M.ledOff;
    sc.srv.ledA.material = p.crit ? M.ledGreen : M.ledOff; sc.srv.ledB.material = p.crit ? M.ledBlue : M.ledOff;
    paintBattery(k, sc, L.soc);
    [sc.atsScreen, sc.upsScreen, sc.meter].forEach(x => x && x.redraw());
    sc.trafoLabel.set('Şebeke · ' + (L.mains ? 'var' : 'YOK')); sc.trafoLabel.level(L.mains ? 'ok' : 'bad');
    sc.atsLabel.set('ATS · ' + ATS_NAME[a.state]); sc.atsLabel.level(a.state === 'MAINS' ? 'ok' : 'warn');
    sc.genLabel.set((app.state.nGen > 1 ? app.state.nGen + ' × jeneratör · ' : 'Jeneratör · ') + (a.genRunning ? (a.QG ? 'yükte %' + fmt(r.genPct, 0) : a.state === 'GEN_START' ? 'yol alıyor' : 'yüksüz') : 'beklemede')); sc.genLabel.level(a.QG ? (r.genPct > 100 ? 'bad' : 'ok') : a.genRunning ? 'warn' : '');
    sc.upsLabel.set('UPS · %' + fmt(r.upsLoad, 0) + (!p.crit ? ' · ÇIKIŞ YOK' : !p.invMode ? (p.path === 'maint' ? ' · BAKIM BYPASS' : ' · STATİK BYPASS') : p.onBat ? ' · AKÜ' : '')); sc.upsLabel.level(!p.crit || !p.invMode ? 'warn' : L.dropped ? 'bad' : p.onBat ? 'warn' : r.upsLoad > 100 ? 'bad' : 'ok');
    sc.batLabel.set('Akü · SOC %' + fmt(L.soc * 100, 0)); sc.batLabel.level(L.soc < 0.2 ? 'bad' : p.onBat ? 'warn' : 'ok');
    sc.srvLabel.set('Kritik yükler · ' + (p.crit ? 'besleniyor' : 'KESİK')); sc.srvLabel.level(p.crit ? 'ok' : 'bad');
    sc.otherLabel.set('Diğer yükler · ' + (p.bus ? 'besleniyor' : 'enerjisiz')); sc.otherLabel.level(p.bus ? 'ok' : 'warn');
  }
  function update(k, res, s, live, app) { if (app.scene3) app.scene3.sig = ''; applyState(k, app); }
  function animate(k, dt, res, s, L, app) {
    const sc = app.scene3; if (!sc || !L) return;
    applyState(k, app);
    const p = paths(L), run = L.ats.genRunning;
    sc.fans.forEach(f => { const on = f.key === 'gen' ? run : p.bus; f.v = (f.v || 0) + ((on ? 14 : 0) - (f.v || 0)) * Math.min(1, dt * 1.5); if (!k.reducedMotion) f.obj.rotation[f.axis] += f.v * dt; });
    // jeneratör titreşimi ve egzoz dumanı (temsili)
    sc.gens.forEach(gs => {
      gs.group.position.y = run && !k.reducedMotion ? Math.sin(app.simTime * 90 + gs.idx) * 0.003 : 0;
      gs.puffs.forEach(m => {
        m.visible = run && !k.reducedMotion;
        if (!m.visible) return;
        m.userData.ph = (m.userData.ph + dt * 0.45) % 1;
        const t = m.userData.ph;
        m.position.set(gs.stackTop.x + t * 0.5, gs.stackTop.y + t * 1.6, gs.stackTop.z);
        m.scale.setScalar(0.6 + t * 2.4); m.material.opacity = (L.ats.state === 'GEN_START' ? 0.45 : 0.22) * (1 - t);
      });
    });
    // sunucu LED’leri: yanıp sönme
    if (p.crit && !k.reducedMotion) sc.srv.ledB.visible = Math.floor(app.simTime * 6) % 3 !== 0; else sc.srv.ledB.visible = true;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması
   * İki yerleşim: geniş ekranda yatay (800 birim), dar ekranda dikey (400 birim). Tüm koordinatlar sanal birimdir ve
   * W’ye göre tek ölçekle büyür; yazılar ölçekle birlikte küçülür ama 9 px altına inmez, sığmayan metin kısaltılır.
   * view2dHeight ile tuval yüksekliği yerleşime göre uzar (dar ekranda dikey kaydırma). */
  function layout2d(W) {
    const narrow = W < 640, VW = narrow ? 400 : 800;
    // geniş ekranda sağdaki görünüm düğmeleri sütunu, dar ekranda üstteki iki sıra düğme boş bırakılır
    const s = narrow ? Math.min(1.25, (W - 16) / VW) : Math.min(1.35, (W - 84) / VW);
    return { narrow: narrow, VW: VW, VH: narrow ? 640 : 530, s: s, top: narrow ? 118 : 52, ox: narrow ? Math.max(8, (W - VW * s) / 2) : 14 };
  }
  function view2dHeight(W) { const l = layout2d(W); return l.top + l.VH * l.s + 12; }

  function view2d(g, W, H, res, s, L) {
    const l = layout2d(W), k = l.s, v = res.values, p = paths(L), a = L.ats, b = L.byp, n = s.nGen || 1;
    const col = { line: '#5b6b82', live: '#fcd34d', gen: '#fb923c', bat: '#22d3ee', out: '#4ade80', text: '#e6eef8', dim: '#7f94b0', bad: '#ef4444', bg: '#0b1a30' };
    const X = x => l.ox + x * k, Y = y => l.top + y * k;
    const font = (px, bold) => (bold ? 'bold ' : '') + Math.max(9, Math.round(px * k * 10) / 10) + 'px Inter, sans-serif';
    const ln = (pts, c, w, dash) => { g.save(); g.strokeStyle = c; g.lineWidth = w || 2.5; if (dash) g.setLineDash(dash); g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.stroke(); g.restore(); };
    const fit = (t, maxV) => { t = String(t); if (!maxV || g.measureText(t).width <= maxV * k) return t; while (t.length > 2 && g.measureText(t + '…').width > maxV * k) t = t.slice(0, -1); return t + '…'; };
    /** Metin: maxV sanal genişliğe sığdırılır; halo=true ise arkası zemin rengiyle doldurulur (çizgi üstünde okunur). */
    const txt = (t, x, y, c, al, px, bold, maxV, halo) => {
      g.font = font(px || 12, bold); g.textAlign = al || 'center'; g.textBaseline = 'alphabetic';
      const u = fit(t, maxV);
      if (halo) { const w = g.measureText(u).width, x0 = al === 'right' ? X(x) - w : al === 'left' ? X(x) : X(x) - w / 2; g.fillStyle = col.bg; g.fillRect(x0 - 3, Y(y) - Math.max(9, 12 * k), w + 6, Math.max(9, 12 * k) + 5); }
      g.fillStyle = c || col.text; g.fillText(u, X(x), Y(y));
    };
    const rect = (x, y, w, h, c) => { g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(X(x), Y(y), w * k, h * k); };
    /** Dikey kesici sembolü (y merkez); etiket solda veya sağda. */
    const sw = (x, y, closed, c, name, left) => {
      ln([[x, y - 22], [x, y - 10]], c); ln([[x, y + 10], [x, y + 22]], c);
      g.save(); g.strokeStyle = closed ? c : col.dim; g.lineWidth = 3; g.beginPath(); g.moveTo(X(x), Y(y + 10)); g.lineTo(X(x + (closed ? 0 : 14)), Y(y - 10)); g.stroke(); g.restore();
      g.fillStyle = closed ? c : col.dim; g.fillRect(X(x) - 3, Y(y - 10) - 3, 6, 6);
      if (name) txt(name + (closed ? ' · kapalı' : ' · açık'), left ? x - 12 : x + 20, y + 4, closed ? col.text : col.dim, left ? 'right' : 'left', 11, false, 90);
    };
    const battery = (x, y, c) => { g.strokeStyle = c; g.lineWidth = 2.5; for (let i = 0; i < 3; i++) { ln([[x - 18, y + i * 9], [x + 18, y + i * 9]], c); ln([[x - 9, y + 4 + i * 9], [x + 9, y + 4 + i * 9]], c); } };
    // durum renkleri (yalnız durum makinelerinden)
    const mainsC = L.mains ? col.live : col.line, genC = p.genV ? col.gen : col.line;
    const qmC = a.QM && L.mains ? col.live : col.line, qgC = a.QG && p.genV ? col.gen : col.line;
    const busC = p.viaGen ? col.gen : p.viaMains ? col.live : col.line, busOn = p.bus ? busC : col.line;
    const dcC = p.onBat ? col.bat : p.bus ? busC : col.line;
    const outC = p.crit ? (p.path === 'inv' ? col.out : busC) : col.bad;
    const ssOn = b.SS === 'byp' && b.Q2, ssC = ssOn && p.bus ? busC : col.line, q3C = b.Q3 && p.bus ? busC : col.line;
    const genState = a.genRunning ? (a.state === 'GEN_START' ? 'yol alıyor' : 'çalışıyor') : 'duruyor';
    const upsName = (v.mod ? 'Modüler UPS ' + v.mod.active + '/' + s.upsModules + ' × ' + s.modKVA + ' kVA' : 'Online UPS ' + s.upsKVA + ' kVA') + ' · %' + fmt(v.upsLoad, 0);
    const atsTxt = 'ATS: ' + ATS_NAME[a.state] + (atsSub(a, s, L) ? ' · ' + atsSub(a, s, L) : '');
    const batTxt = 'Akü ' + fmt(v.Vbat, 0, 'V') + ' · ' + fmt(v.Ebat, 1, 'kWh');
    const socTxt = 'SOC %' + fmt(L.soc * 100, 0) + (p.onBat ? ' · kalan ' + VS.fmtDuration(L.soc * v.runtime) : '');
    /** Jeneratör sembolleri: n set yan yana, ortak senkron baraya bağlanır, oradan QG’ye iner. */
    const gens = (cx, cy, dx, r, mergeY, qTop) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * dx;
        g.strokeStyle = genC; g.lineWidth = 2.5; g.beginPath(); g.arc(X(x), Y(cy), r * k, 0, Math.PI * 2); g.stroke();
        txt(n > 1 ? 'G' + (i + 1) : 'G', x, cy + 4, genC, 'center', n > 1 ? 10 : 13, true);
        ln([[x, cy + r], [x, mergeY]], genC);
      }
      if (n > 1) { ln([[cx - (n - 1) / 2 * dx, mergeY], [cx + (n - 1) / 2 * dx, mergeY]], genC, 4); }
      ln([[cx, mergeY], [cx, qTop]], genC);
    };
    const events = (x, y, maxV, rows) => {
      txt('Son olaylar', x, y, col.dim, 'left', 11, true);
      L.events.slice(-rows).reverse().forEach((e, i) => txt(e, x, y + 17 * (i + 1), i ? col.dim : col.text, 'left', 11, false, maxV));
    };

    if (!l.narrow) {
      /* ---- geniş yerleşim (yatay) */
      g.strokeStyle = mainsC; g.lineWidth = 2.5; g.beginPath(); g.arc(X(150), Y(30), 14 * k, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(X(150), Y(50), 14 * k, 0, Math.PI * 2); g.stroke();
      txt('Şebeke ' + (L.mains ? '(var)' : '(YOK)'), 150, 6, L.mains ? col.text : col.bad, 'center', 12, true, 200);
      ln([[150, 64], [150, 108]], mainsC);
      gens(430, 36, 46, n > 1 ? 15 : 20, 82, 108);
      txt((n > 1 ? n + ' × ' + s.genKVA + ' kVA senkron bara' : 'Jeneratör ' + s.genKVA + ' kVA') + ' · ' + genState, 430, 6, a.genRunning ? col.text : col.dim, 'center', 12, true, 300);
      sw(150, 130, a.QM, qmC, 'QM', true); sw(430, 130, a.QG, qgC, 'QG');
      ln([[175, 130], [405, 130]], '#94a3b8', 1.5, [5, 5]); txt('mekanik + elektriksel kilit', 290, 122, col.dim, 'center', 11, false, 220);
      ln([[150, 152], [150, 180]], qmC); ln([[430, 152], [430, 180]], qgC);
      ln([[60, 180], [560, 180]], busOn, 6);
      txt(atsTxt, 128, 202, col.text, 'left', 12, false, 350, true);
      // diğer yükler
      ln([[110, 180], [110, 300]], busOn); rect(50, 300, 120, 36, busOn);
      txt('Diğer yükler', 110, 316, col.text, 'center', 12, false, 112); txt(fmt(s.Pother, 0, 'kW') + (p.bus ? '' : ' · enerjisiz'), 110, 331, p.bus ? col.dim : col.bad, 'center', 11, false, 112);
      // UPS
      ln([[500, 180], [500, 230]], busOn); rect(460, 230, 80, 50, busOn); txt('AC/DC', 500, 260, col.text, 'center', 12);
      ln([[540, 255], [600, 255]], dcC);
      rect(600, 230, 80, 50, p.crit && p.path === 'inv' ? col.out : col.line); txt('DC/AC', 640, 260, col.text, 'center', 12);
      txt(upsName, 570, 224, col.text, 'center', 12, true, 240, true);
      // akü (metin akünün solunda, sağa yaslı)
      ln([[570, 255], [570, 332]], dcC); battery(570, 336, dcC);
      txt(batTxt, 544, 350, col.text, 'right', 11, false, 200); txt(socTxt, 544, 366, p.onBat ? col.bat : col.dim, 'right', 11, false, 200);
      g.fillStyle = '#1e293b'; g.fillRect(X(424), Y(374), 120 * k, 8 * k); g.fillStyle = 'hsl(' + Math.round(L.soc * 120) + ',80%,50%)'; g.fillRect(X(424), Y(374), 120 * k * L.soc, 8 * k);
      // kritik yük
      ln([[680, 255], [740, 255], [740, 300]], outC); rect(700, 300, 80, 36, outC);
      txt('Kritik yük', 740, 316, col.text, 'center', 12, false, 76); txt(fmt(s.Pcrit, 0, 'kW') + (p.crit ? '' : ' · KESİK'), 740, 331, p.crit ? col.dim : col.bad, 'center', 11, false, 76);
      // statik bypass ve Q2
      ln([[555, 180], [555, 205], [692, 205]], ssC);
      if (ssOn) ln([[692, 205], [712, 205]], ssC); else ln([[692, 205], [708, 196]], col.dim);
      ln([[712, 205], [720, 205], [720, 255]], ssC);
      txt('SS statik bypass' + (s.bypSync ? '' : ' (senkron dışı)'), 625, 199, ssOn ? col.text : col.dim, 'center', 11, false, 130);
      txt(b.Q2 ? 'Q2' : 'Q2 açık', 692, 247, b.Q2 ? col.dim : col.bad, 'center', 11, false, 60, true);
      // bakım bypass Q3
      ln([[560, 180], [790, 180], [790, 230]], q3C, 2, b.Q3 ? null : [4, 4]);
      if (b.Q3) ln([[790, 230], [790, 250]], q3C); else ln([[790, 230], [780, 248]], col.dim);
      ln([[790, 250], [790, 318], [780, 318]], q3C, 2, b.Q3 ? null : [4, 4]);
      txt('Q3 bakım bypass · ' + (b.Q3 ? 'kapalı' : 'açık'), 786, 172, b.Q3 ? col.text : col.dim, 'right', 11, false, 210);
      events(50, 412, 740, 5);
      return;
    }
    /* ---- dar yerleşim (dikey): kaynaklar üstte, UPS zinciri ortada aşağı doğru, bypass yolları sağda */
    g.strokeStyle = mainsC; g.lineWidth = 2.5; g.beginPath(); g.arc(X(100), Y(34), 12 * k, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(X(100), Y(51), 12 * k, 0, Math.PI * 2); g.stroke();
    txt('Şebeke ' + (L.mains ? '(var)' : '(YOK)'), 100, 12, L.mains ? col.text : col.bad, 'center', 12, true, 180);
    ln([[100, 63], [100, 108]], mainsC);
    gens(300, 38, 34, n > 1 ? 12 : 16, 80, 108);
    txt((n > 1 ? n + ' × ' : 'Jen. ') + s.genKVA + ' kVA · ' + genState, 300, 12, a.genRunning ? col.text : col.dim, 'center', 12, true, 190);
    sw(100, 130, a.QM, qmC, 'QM', true); sw(300, 130, a.QG, qgC, 'QG');
    ln([[125, 130], [275, 130]], '#94a3b8', 1.5, [5, 5]); txt('kilit', 200, 123, col.dim, 'center', 11);
    ln([[100, 152], [100, 185]], qmC); ln([[300, 152], [300, 185]], qgC);
    ln([[20, 185], [380, 185]], busOn, 6);
    // dikey hatlar (yazılar hale ile üstte okunur)
    ln([[50, 185], [50, 262]], busOn);
    ln([[220, 185], [220, 252]], busOn);
    ln([[322, 185], [322, 380]], ssC);
    ln([[372, 185], [372, 440]], q3C, 2, b.Q3 ? null : [4, 4]);
    txt(atsTxt, 20, 208, col.text, 'left', 12, false, 360, true);
    txt(upsName, 20, 232, col.text, 'left', 12, true, 360, true);
    rect(12, 262, 82, 38, busOn); txt('Diğer yükler', 53, 278, col.text, 'center', 11, false, 78); txt(fmt(s.Pother, 0, 'kW') + (p.bus ? '' : ' · yok'), 53, 293, p.bus ? col.dim : col.bad, 'center', 10, false, 78);
    rect(180, 252, 80, 36, busOn); txt('AC/DC', 220, 275, col.text, 'center', 12);
    ln([[220, 288], [220, 332]], dcC);
    ln([[220, 310], [120, 310], [120, 318]], dcC); battery(120, 322, dcC);
    txt(batTxt, 16, 362, col.text, 'left', 11, false, 160); txt(socTxt, 16, 378, p.onBat ? col.bat : col.dim, 'left', 11, false, 160);
    g.fillStyle = '#1e293b'; g.fillRect(X(16), Y(386), 140 * k, 8 * k); g.fillStyle = 'hsl(' + Math.round(L.soc * 120) + ',80%,50%)'; g.fillRect(X(16), Y(386), 140 * k * L.soc, 8 * k);
    rect(180, 332, 80, 36, p.crit && p.path === 'inv' ? col.out : col.line); txt('DC/AC', 220, 355, col.text, 'center', 12);
    // inverter çıkışı → Q2 → kritik yük
    const invOut = p.path === 'inv' && p.crit ? col.out : col.line;
    ln([[220, 368], [220, 398]], invOut);
    if (b.Q2) ln([[220, 398], [220, 416]], invOut); else ln([[220, 398], [232, 414]], col.dim);
    txt(b.Q2 ? 'Q2' : 'Q2 açık', 212, 412, b.Q2 ? col.dim : col.bad, 'right', 11, false, 70);
    ln([[220, 416], [220, 452]], outC);
    // statik bypass: bara → SS → Q2 sonrası birleşme
    if (ssOn) ln([[322, 380], [322, 400]], ssC); else ln([[322, 380], [334, 398]], col.dim);
    ln([[322, 400], [322, 428], [220, 428]], ssC);
    txt('SS', 314, 394, ssOn ? col.text : col.dim, 'right', 11, true);
    // bakım bypass Q3
    if (b.Q3) ln([[372, 440], [372, 460]], q3C); else ln([[372, 440], [384, 458]], col.dim);
    ln([[372, 460], [372, 470], [260, 470]], q3C, 2, b.Q3 ? null : [4, 4]);
    txt('Q3 · ' + (b.Q3 ? 'kapalı' : 'açık'), 364, 456, b.Q3 ? col.text : col.dim, 'right', 11, false, 80);
    rect(180, 452, 80, 38, outC); txt('Kritik yük', 220, 468, col.text, 'center', 11, false, 76); txt(fmt(s.Pcrit, 0, 'kW') + (p.crit ? '' : ' · KESİK'), 220, 483, p.crit ? col.dim : col.bad, 'center', 10, false, 76);
    events(16, 520, 370, 5);
  }

  VS.register({
    id: 'ups', title: '3D UPS ve Jeneratör Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Simülasyon çalışıyor: test planına göre şebeke kesilecek; ATS durumlarını izleyin.',
    start: app => { app.live = initLive(app.state); app._startedOnce = true; app.renderControls(); app.invalidate(); },
    scenarios: [
      { id: 'normal', name: 'Normal kesinti · jeneratör devralır', desc: '5. saniyede şebeke kesilir: UPS aküden besler, ATS 3 s onay + 10 s yol alma + 1 s ölü zamanla jeneratöre aktarır; 2 dk sonra şebeke döner.', state: defaults(), start: true },
      { id: 'kisa-aku', name: 'Küçük akü · geç yol alan jeneratör → yük düşer', desc: '7 Ah bloklarla ≈ 3,5 dk yedekleme; jeneratör 4 dk’da hazır olur. Akü biter ve kritik yük kesilir.', state: Object.assign(defaults(), { nBlocks: 32, Ah: 7, tGenReady: 240, outDur: 600, accel: 10 }), start: true },
      { id: 'asiri', name: 'Aşırı yüklü jeneratör', desc: '100 kVA jeneratöre UPS girişi + 90 kW diğer yük: yüklenme %100’ü aşar, ön kontrol uygunsuzluk verir.', state: Object.assign(defaults(), { genKVA: 100, Pother: 90 }), start: true },
      { id: 'dalga', name: 'Kısa süreli şebeke kesintisi (2 s)', desc: 'Şebeke onay süresi dolmadan geri gelir: jeneratör çalıştırılmaz, UPS aküsü kısa süre devreye girer.', state: Object.assign(defaults(), { outDur: 2, tConfirm: 5 }), start: true },
      { id: 'bypass', name: 'Statik bypass’ta unutulan UPS · kesinti', desc: 'UPS bakım sonrası statik bypass’ta kalmış: 10. saniyedeki 20 s kesintide akü köprüsü yoktur, kritik yük düşer. İnverter’e dönerek tekrar deneyin.', state: Object.assign(defaults(), { startBypass: true, cutAt: 10, outDur: 20, accel: 1 }), start: true },
      { id: 'moduler', name: 'Modüler UPS · modül arızası (N+1)', desc: '3 × 20 kVA modüler UPS, 32 kW kritik yük: bir modül arızalıyken kalan iki modül yükü %89 ile taşır; ikinci arızada UPS statik bypass’a geçer. 3D’de modüllere tıklayın.', state: Object.assign(defaults(), { upsArch: 'modular', upsModules: 3, modKVA: 20, failedMods: 1 }), start: true },
      { id: 'paralel', name: 'Paralel jeneratörler · 2 × 150 kVA', desc: 'İki set senkron barada yükü paylaşır; bir set devre dışı kalırsa diğeri yükü taşıyabilir mi (N+1)? Senkron panosuna tıklayın.', state: Object.assign(defaults(), { nGen: 2, genKVA: 150, Pother: 90 }), start: true },
      { id: 'uzun', name: 'Uzun kesinti · yakıt ve akü şarjı', desc: '2 saatlik kesinti, ×120 hızlandırılmış: jeneratör yakıt tüketir; şebeke dönünce akü (temsili) şarj olur.', state: Object.assign(defaults(), { outDur: 7200, accel: 120, tank: 200 }), start: true }
    ],
    tasks: [
      { id: 'ride20', title: '20 s kesintiyi yük düşmeden atlat', goal: 'Bakımdan sonra UPS statik bypass’ta unutulmuş. 30. saniyede 20 s şebeke kesintisi olacak: kesinti bitene kadar kritik yük hiç kesilmesin.', hint: 'UPS bypass grubunda ya da 3D’de UPS kabinine tıklayıp “İnverter’e dön” deyin; inverter yolunda akü kesintiyi köprüler.',
        state: Object.assign(defaults(), { startBypass: true, cutAt: 30, outDur: 20, accel: 1 }), start: true,
        check: (r, s, L) => !!L.planBack && L.interrupts === 0 && L.byp.SS === 'inv' },
      { id: 'mbp', title: 'Bakım bypass’ına kesintisiz geç', goal: 'UPS’i bakım için ayırın: yük bakım bypass (Q3) üzerinden beslensin, Q2 açık olsun ve kritik yük bir an bile kesilmesin.', hint: 'Sıra: statik bypass’a aktar → Q3 kapat → Q2 aç. Kilitleme yanlış sırayı reddeder; 3D’de bakım bypass panosuna tıklayabilirsiniz.',
        state: Object.assign(defaults(), { plan: false }),
        check: (r, s, L) => L.byp.Q3 && !L.byp.Q2 && L.interrupts === 0 },
      { id: 'bat15', title: 'Aküyü 15 dakikaya boyutlandır', goal: '60 kW kritik yük ve 3 yaşındaki akülerle yedekleme süresi en az 15 dk olsun (yükü azaltmadan, akü yaşını ve 25 °C oda sıcaklığını değiştirmeden).', hint: 'Blok kapasitesini (Ah) ya da paralel grup sayısını artırın; Akü grubundaki “15 dk için gereken” notuna bakın.',
        state: Object.assign(defaults(), { Pcrit: 60, upsKVA: 100, Ah: 26, batAge: 3 }),
        check: (r, s) => s.Pcrit >= 60 && s.batAge >= 3 && s.battT <= 25 && r.values.runtime >= 15 },
      { id: 'gen80', title: 'Jeneratörü %80 yüklenmeye göre seç', goal: 'Kritik yük (32 kW) ve 60 kW diğer yükle jeneratör yüklenmesi %80’i aşmasın.', hint: 'Jeneratör gücünü bir üst kademeye çıkarın; yükleri azaltmak çözüm sayılmaz.',
        state: Object.assign(defaults(), { genKVA: 100 }),
        check: (r, s) => s.Pother >= 60 && s.Pcrit >= 32 && r.values.genPct <= 80 },
      { id: 'step', title: 'Adım yük kabulünü sağla', goal: '200 kVA jeneratör ve 120 kW diğer yükte her yük adımı performans sınıfının (temsili) adım sınırının altında kalsın; jeneratörü büyütmeyin.', hint: 'Yük devreye alma planını 3 adıma çevirin ve adım grafiğini izleyin.',
        state: Object.assign(defaults(), { Pother: 120, stepPlan: 'all' }),
        check: (r, s) => s.genKVA <= 200 && s.Pother >= 120 && r.values.steps.ok },
      { id: 'n1', title: 'Modül arızasında yük inverterde kalsın (N+1)', goal: '2 × 20 kVA modüler UPS 32 kW kritik yükü taşıyor ama yedeği yok. Bir güç modülü arızalıyken bile yük inverter (akü korumalı) yolunda kalsın ve hiç kesilmesin.', hint: 'Modül sayısını N+1’e çıkarın, sonra “Arızalı modül” ile ya da 3D’de modüle tıklayarak bir arıza oluşturun. UPS bypass’a geçtiyse “İnverter’e dön”.',
        state: Object.assign(defaults(), { upsArch: 'modular', upsModules: 2, modKVA: 20, redundancy: 'N+1', plan: false }),
        check: (r, s, L) => s.upsArch === 'modular' && s.Pcrit >= 32 && (s.failedMods || 0) >= 1 && !!r.values.mod && r.values.mod.carries && L.byp.SS === 'inv' && !L.byp.Q3 && L.interrupts === 0 },
      { id: 'gen2', title: 'Jeneratörleri N+1 paralel kur', goal: '200 kVA’lık setlerle (set gücünü değiştirmeden) 150 kW diğer yük + kritik yük beslensin: bir set devre dışı kalınca da yük taşınsın ve set yüklenmesi %80’i aşmasın.', hint: '“Paralel jeneratör seti” sayısını artırın; Jeneratör grubundaki N ve N+1 notunu izleyin.',
        state: Object.assign(defaults(), { Pother: 150 }),
        check: (r, s) => s.genKVA <= 200 && s.Pother >= 150 && r.values.gp.n1 && r.values.genPct <= 80 }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, L) => !paths(L).crit ? { level: 'bad', text: 'Kritik yük kesildi' } : !paths(L).invMode ? { level: 'warn', text: X.modeName(L.byp) + ' · korumasız' } : paths(L).onBat ? { level: 'warn', text: 'UPS akü modunda' } : L.ats.QG ? { level: 'info', text: 'Jeneratörden besleniyor' } : null,
    reportInputs: (s, app) => [{ group: 'Simülasyon', label: 'Hesaplanan jeneratör devreye girme süresi', value: fmt(s.tConfirm + s.tGenReady + s.tDead, 1, 's') }, { group: 'Simülasyon', label: 'ATS son durumu', value: ATS_NAME[app.live.ats.state] }, { group: 'Simülasyon', label: 'Akü SOC (simülasyon sonu)', value: '%' + fmt(app.live.soc * 100, 0) }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-9.6, 6.4] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
