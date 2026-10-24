/* VoltSim · 3D RES / Rüzgâr Enerjisi Simülasyonu
 * Hesap: VoltSimEngine.res (ön plandaki türbin: P = ½·ρ·A·Cp·v³·η, Betz, profil, yoğunluk, cut-in/cut-out, kontroller) +
 * VoltSimEngine.ext.res (calc/res.js): üretici föyünden Cp, park yerleşimi, Jensen/Park izi, OG toplama kablosu ve trafo
 * kayıpları, şebeke işletmecisi güç sınırı, cut-out histerezisi, sentetik rüzgâr serisi, yaw kaybı, iklim duruşları,
 * yön ortalamalı varsayımsal AEP.
 * Sahne: tüm türbinler (InstancedMesh) park modelindeki kendi hızlarıyla döner; ön plandaki türbin ayrıntılıdır ve
 * 3D'de işletilebilir (servis freni, yaw). Kanat açısı görseli temsilidir. Gösterilen sayılar motor/calc sonucudur. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const R = E.res, X = E.ext.res;
  const YAW_RATE = 1;          // °/s görsel (gerçekte ~0,3–0,5 °/s; izlenebilirlik için hızlandırılmış)
  const TILT = 5 * Math.PI / 180;
  const TS_DT = 5;             // sentetik seri adımı (s)
  const REGION = { idle: 'Devreye girme altı', partial: 'Kısmi yük (maks. Cp takibi)', rated: 'Nominal güç (pitch ile sınırlı)', stop: 'Korumalı duruş (cut-out)', service: 'Servis freni (elle durduruldu)', climate: 'İklim duruşu', hyst: 'Cut-out sonrası bekleme (histerezis)' };
  /** Üretici föyü kütüphanesi: jenerik türbinler (marka yok). Tüm alanlar kullanıcı tarafından düzenlenebilir. */
  const TYPE_LIB = {
    t025: { name: 'Küçük 250 kW · 30 m', Prated: 250, D: 30, hub: 40, cutIn: 3, vRated: 11, cutOut: 25, rpmMin: 20, rpmMax: 45, etaMech: 0.95, etaGen: 0.94, trafoKVA: 315 },
    t20: { name: 'Tip 2,0 MW · 90 m', Prated: 2000, D: 90, hub: 80, cutIn: 3.5, vRated: 12, cutOut: 25, rpmMin: 9, rpmMax: 16.5, etaMech: 0.96, etaGen: 0.95, trafoKVA: 2250 },
    t36: { name: 'Tip 3,6 MW · 120 m', Prated: 3600, D: 120, hub: 100, cutIn: 3, vRated: 11.5, cutOut: 25, rpmMin: 5, rpmMax: 14, etaMech: 0.96, etaGen: 0.95, trafoKVA: 4000 },
    t45: { name: 'Tip 4,5 MW · 150 m', Prated: 4500, D: 150, hub: 120, cutIn: 3, vRated: 10.5, cutOut: 25, rpmMin: 4.5, rpmMax: 11.5, etaMech: 0.96, etaGen: 0.95, trafoKVA: 5000 },
    t60: { name: 'Tip 6,0 MW · 170 m', Prated: 6000, D: 170, hub: 135, cutIn: 3, vRated: 10.5, cutOut: 25, rpmMin: 4, rpmMax: 10, etaMech: 0.965, etaGen: 0.955, trafoKVA: 6600 }
  };
  const lib = id => JSON.parse(JSON.stringify(TYPE_LIB[id]));
  const MV_AMP = { 95: 255, 120: 290, 150: 325, 185: 365, 240: 420, 300: 470, 400: 530, 500: 600, 630: 680 };   // Al XLPE, toprakta, tipik (A)

  function defaults() {
    return {
      v10: 7, href: 10, alpha: 0.14, windDir: 190, T: 15, alt: 300, rhoMode: 'auto', rho: 1.225,
      types: [lib('t36')],
      strings: [{ name: 'Dizi A', type: 0, n: 6 }, { name: 'Dizi B', type: 0, n: 6 }],
      selType: 0, selString: 0,
      rowDir: 280, spacing: 5, rowGap: 8, wakeOn: true, wakeK: 0.075,
      mvKV: 34.5, pf: 0.95, cableS: 240, homeKm: 3, ssMVA: 50, curtail: 0,
      vMeanRef: 5.4, k: 2, avail: 97, tsr: 8,
      service: false, yawMode: 'auto', yawManual: 190, Tmin: -20, icing: false,
      restartV: 22, restartDelay: 120, ts: false, tsMean: 12, tsTI: 14, seed: 7
    };
  }
  const compass = d => ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  const typeOf = (s, i) => s.types[i] || s.types[0];
  const fgType = s => typeOf(s, s.strings[0] ? s.strings[0].type : 0);
  const total = s => s.strings.reduce((a, x) => a + (Math.round(x.n) || 0), 0);
  const ratedTotal = s => s.strings.reduce((a, x) => a + (Math.round(x.n) || 0) * typeOf(s, x.type).Prated, 0);

  /* ---------------------------------------------------------------- hesap */
  function validate(s) {
    const err = [];
    if (!s.types.length) err.push('En az bir türbin tipi gerekli.');
    if (!s.strings.length) err.push('En az bir dizi gerekli.');
    s.types.forEach((t, i) => {
      const nm = (t.name || 'Tip ' + (i + 1)) + ': ';
      if (!(t.D >= 5 && t.Prated >= 10 && t.hub >= 10)) err.push(nm + 'rotor çapı, güç ve göbek yüksekliği pozitif olmalı.');
      if (t.hub < t.D / 2 + 5) err.push(nm + 'göbek yüksekliği rotor yarıçapından en az 5 m büyük olmalı.');
      if (!(t.vRated > t.cutIn)) err.push(nm + 'nominal hız devreye girme hızından büyük olmalı.');
      if (!(t.cutOut > t.vRated)) err.push(nm + 'cut-out nominal hızdan büyük olmalı.');
      if (!(t.rpmMax > t.rpmMin && t.rpmMin >= 0)) err.push(nm + 'devir aralığı geçersiz.');
      const cp = X.cpFromDatasheet(t);
      if (cp > R.BETZ) err.push(nm + 'föy değerleri Cp = ' + fmt(cp, 3) + ' gerektiriyor; Betz sınırı (0,593) aşılamaz. Nominal hızı artırın veya gücü düşürün.');
    });
    s.strings.forEach((x, i) => {
      if (!s.types[x.type]) err.push((x.name || 'Dizi ' + (i + 1)) + ': türbin tipi bulunamadı.');
      if (!(Math.round(x.n) >= 1)) err.push((x.name || 'Dizi ' + (i + 1)) + ': en az 1 türbin.');
    });
    return err;
  }
  function v10Now(s, live) { return s.ts && live && isFinite(live.v10g) ? live.v10g : s.v10; }
  function farmInput(s, rho) {
    return { types: s.types, strings: s.strings.map(x => ({ type: x.type, n: Math.round(x.n) })), rowDir: s.rowDir, spacing: s.spacing, rowGap: s.rowGap, rho: rho, wakeOn: s.wakeOn, k: s.wakeK,
      U_kV: s.mvKV, pf: s.pf, S: s.cableS, homeKm: s.homeKm, trafo: { p0: 0.1, pk: 1.0 }, ss: { Sn_kVA: s.ssMVA * 1000, p0: 0.05, pk: 0.5 }, curtail_kW: s.curtail * 1000 };
  }
  const memo = {};
  function cached(name, key, fn) { if (memo[name] && memo[name].key === key) return memo[name].val; const val = fn(); memo[name] = { key: key, val: val }; return val; }

  function compute(s, app) {
    const live = (app && app.live) || {};
    const errs = validate(s);
    if (errs.length) return { ok: false, errors: errs, warnings: [], checks: [], values: {} };
    const ty = fgType(s), cp = X.cpFromDatasheet(ty), n = total(s);
    const meanOf = i => X.atHeight(s.vMeanRef, s.href, typeOf(s, i).hub, s.alpha);
    const rho = s.rhoMode === 'manual' ? s.rho : R.airDensity(s.T, s.alt);
    const fin = farmInput(s, rho);
    const aep = cached('aep', JSON.stringify([fin, s.vMeanRef, s.href, s.alpha, s.k, s.avail]), () => X.farmAEP(Object.assign({}, fin, { meanOf: meanOf, kW: s.k, avail: s.avail / 100 })));
    const r = R.compute({ v10: v10Now(s, live), href: s.href, alpha: s.alpha, T: s.T, alt: s.alt, rhoMode: s.rhoMode, rho: s.rho, D: ty.D, hub: ty.hub, Prated: ty.Prated, cp: cp,
      etaMech: ty.etaMech, etaGen: ty.etaGen, cutIn: ty.cutIn, cutOut: ty.cutOut, rpmMax: ty.rpmMax, tsr: s.tsr, n: n, vMean: Math.min(15, Math.max(2, meanOf(s.strings[0].type))), k: s.k, avail: s.avail, wake: Math.min(40, aep.wakeLoss * 100) });
    if (!r.ok) return r;
    const v = r.values;
    const climate = X.climateStop(s.T, s.Tmin, s.icing);
    const yawErr = s.yawMode === 'manual' ? X.angleDiff(s.yawManual, s.windDir) : 0, yawF = X.yawFactor(yawErr, 2);
    const hyst = !!(live.cut && live.cut.stopped);
    const farm = X.farmState(Object.assign({}, fin, { dirDeg: s.windDir, vHubOf: i => X.atHeight(v10Now(s, live), s.href, typeOf(s, i).hub, s.alpha),
      stopped: i => climate.stop || hyst || (i === 0 && s.service), yawF: i => (i === 0 ? yawF : 1) }));
    const ts = s.ts ? cached('ts', JSON.stringify([s.seed, s.tsMean, s.tsTI, ty, rho, s.restartV, s.restartDelay, yawF, climate.stop, s.service]), () => {
      const series = X.windSeries({ seed: s.seed, mean: s.tsMean, ti: s.tsTI / 100, minutes: 60, dt: TS_DT });
      const out = X.simulateSeries({ v: series, dt: TS_DT, t: X.turbine(ty, rho), cutOut: ty.cutOut, restart: s.restartV, delay: s.restartDelay, factor: climate.stop || s.service ? 0 : yawF });
      out.v = series; return out;
    }) : null;
    // ön plandaki türbinin işletme durumu (motor değerleri + işletme koşulları)
    const fg = farm.turbines[0];
    const region = fg.region === 'service' ? (s.service ? 'service' : climate.stop ? 'climate' : 'hyst') : v.region;
    const running = fg.P > 0 || (region === 'idle' && v.rpm > 0);
    const rpm = running && v.rpm > 0 ? Math.min(ty.rpmMax, Math.max(ty.rpmMin, v.rpm)) : 0;
    const Pplanned = ratedTotal(s);
    Object.assign(v, { Peng: v.P, P: fg.P, region: region, rpm: rpm, tip: rpm * 2 * Math.PI / 60 * ty.D / 2, cp: cp, yawErr: yawErr, yawF: yawF, climate: climate, farm: farm, aepF: aep, ts: ts, n: n, Pplanned: Pplanned,
      cf: aep.net / (Pplanned * 8760) });
    // ek kontroller
    const ck = r.checks.filter(c => c.id !== 'region');
    ck.push({ id: 'region', label: 'Çalışma bölgesi (ön türbin)', status: region === 'stop' || region === 'climate' ? 'warn' : 'info', detail: REGION[region] + (region === 'rated' ? ' · gereken Cp ' + fmt(v.cpReq, 3) : ''), ref: null });
    ck.push({ id: 'types', label: 'Föyden türetilen Cp', status: 'info', detail: s.types.map(t => t.name + ': Cp ' + fmt(X.cpFromDatasheet(t), 3)).join(' · '), ref: 'P_n = ½·ρ0·A·Cp·v_n³·η' });
    farm.strings.forEach((st, i) => {
      const Iz = MV_AMP[s.cableS] || 0;
      if (st.I > Iz) ck.push({ id: 'cable' + i, label: (s.strings[i].name || 'Dizi ' + (i + 1)) + ' · OG kablo akımı', status: 'fail', detail: fmt(st.I, 0) + ' A > ' + Iz + ' A (' + s.cableS + ' mm² Al, tipik toprak altı değeri). Kesiti büyütün veya diziyi bölün.', ref: 'Üretici kataloğu / IEC 60502-2' });
    });
    const Imax = Math.max.apply(null, farm.strings.map(x => x.I));
    ck.push({ id: 'mv', label: 'OG toplama kablosu', status: Imax <= (MV_AMP[s.cableS] || 0) ? 'ok' : 'fail', detail: 'En yüklü dizi ' + fmt(Imax, 0) + ' A / taşıma ' + (MV_AMP[s.cableS] || '—') + ' A · kayıp ' + fmt(farm.lossCable, 1) + ' kW', ref: 'Al XLPE, tipik değer — katalogdan doğrulayın' });
    ck.push({ id: 'ss', label: 'Trafo merkezi yüklenmesi', status: farm.ssLoading <= 1 ? 'ok' : 'warn', detail: '%' + fmt(farm.ssLoading * 100, 0) + ' (' + s.ssMVA + ' MVA) · kurulu ' + fmt(Pplanned / 1000, 1) + ' MW', ref: null });
    if (s.curtail > 0) ck.push({ id: 'curtail', label: 'Şebeke işletmecisi güç sınırı', status: 'info', detail: 'Bağlantı noktası sınırı ' + s.curtail + ' MW · kısılan ' + fmt(farm.curtailed / 1000, 2) + ' MW', ref: null });
    if (climate.stop) ck.push({ id: 'climate', label: 'İklim koruması (örnek ayar)', status: 'warn', detail: climate.reason + ': park durduruldu.', ref: null });
    if (Math.abs(yawErr) > 5) ck.push({ id: 'yaw', label: 'Sapma (yaw) hatası', status: 'warn', detail: fmt(Math.abs(yawErr), 0) + '° · güç çarpanı ≈ cos²γ = ' + fmt(yawF, 3) + ' (yaklaşım)', ref: null });
    ck.push({ id: 'hyst', label: 'Cut-out sonrası yeniden devreye girme', status: 'info', detail: 'Örnek ayar: v < ' + s.restartV + ' m/s en az ' + s.restartDelay + ' s sürünce yeniden devreye girer (üretici ayarı esastır).', ref: null });
    r.checks = ck;
    r.assumptions = r.assumptions.concat([
      'Park: Jensen/Park iz modeli (k = ' + s.wakeK + '), kısmi örtüşme ve Katic kare toplamı; Ct, 1B momentum kuramıyla Cp’den türetilir. Arazi ve yükseklik farkı dahil değil.',
      'Yıllık iz kaybı tekdüze rüzgâr gülü (' + aep.nDir + ' yön) varsayımıyla; gerçek değer yön dağılımına bağlıdır.',
      'Türbin trafosu P0 %0,1 · Pk %1, trafo merkezi P0 %0,05 · Pk %0,5 (tipik oranlar); OG kablo Al, κ = 35, zincir dizi.',
      'Ön türbin dışındaki türbinler aynı serbest rüzgârı ve kendi göbek yüksekliklerini görür; histerezis ve iklim duruşu tüm parka uygulanır.',
      'Yaw kaybı P·cos²γ yaklaşımıdır (ölçümler p ≈ 1,5–2; teorik 3).',
      'Sentetik rüzgâr serisi ölçüm değildir; tohumla tekrarlanabilir temsili türbülanstır.'
    ]);
    r.formulas = r.formulas.concat(['Cp = P_n/(½·ρ0·A·v_n³·η)', 'Ct = 4a(1−a), Cp = 4a(1−a)²', 'δ = (1−√(1−Ct))/(1+2k·x/D)²', 'P_kayıp = 3·I²·R', 'v_n = v·(ρ/ρ0)^(1/3) (IEC 61400-12-1)']);
    return r;
  }

  /* ---------------------------------------------------------------- zaman adımı */
  function tick(app, dt) {
    const s = app.state, L = app.live, r = app.validResult; if (!r || !r.values.farm) return false;
    const ty = fgType(s);
    if (s.ts && r.values.ts) {
      if (L.tsDone) return false;
      L.tsT += dt * 60;                                       // 1 gerçek s = 1 simüle dk
      const ser = r.values.ts, i = Math.min(ser.v.length - 1, Math.floor(L.tsT / TS_DT));
      const vH = ser.v[i], v10 = vH / Math.pow(ty.hub / s.href, s.alpha);
      const stopped = !!ser.stopped[i];
      if (L.tsT >= 3600) { L.tsDone = true; VS.toast('Sentetik saat tamamlandı: ' + fmt(ser.energy / 1000, 2) + ' MWh, ' + ser.stops + ' durma.', 'ok'); }
      L.acc += dt;
      if (L.acc >= 0.2 || (L.cut && L.cut.stopped) !== stopped) { L.acc = 0; L.v10g = v10; L.cut = { stopped: stopped, below: 0 }; app.invalidate(); }
      return true;
    }
    if (isFinite(L.v10g)) { L.v10g = NaN; app.invalidate(); }
    // elle ayarlanan rüzgârda histerezis (bekleme süresi 10× hızlandırılmış)
    const prev = L.cut.stopped;
    L.cut = X.cutOutStep(L.cut, r.values.vHub, { cutOut: ty.cutOut, restart: s.restartV, delay: s.restartDelay }, dt * 10);
    if (L.cut.stopped !== prev) { app.invalidate(); if (L.cut.stopped) VS.toast('Cut-out: park durdu. Yeniden devreye girme için v < ' + s.restartV + ' m/s, ' + s.restartDelay + ' s.', 'warn'); return true; }
    return false;
  }

  /* ---------------------------------------------------------------- kontroller */
  function typeRows(box, a) {
    const s = a.state, list = VS.el('div', { class: 'vs-cl' });
    s.types.forEach((t, i) => {
      const used = s.strings.filter(x => x.type === i).reduce((q, x) => q + x.n, 0);
      const row = VS.el('div', { class: 'vs-cl__row' + (i === s.selType ? ' is-sel' : ''), 'data-level': X.cpFromDatasheet(t) > R.BETZ ? 'bad' : 'ok' });
      const b = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === s.selType ? 'true' : 'false' }, [VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: t.name }), VS.el('small', { text: fmt(t.Prated, 0) + ' kW · D ' + t.D + ' m · h ' + t.hub + ' m · ' + used + ' adet' })]);
      b.onclick = () => { s.selType = i; a.renderControls(); a.invalidate(); };
      row.appendChild(b); list.appendChild(row);
    });
    box.appendChild(list);
    const sel = VS.el('select', { class: 'vs-select', 'aria-label': 'Kütüphaneden tip' }, Object.keys(TYPE_LIB).map(k => VS.el('option', { value: k, text: TYPE_LIB[k].name })));
    box.appendChild(sel);
    const btns = VS.el('div', { class: 'vs-btns' });
    btns.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Föy ekle', onclick: () => { s.types.push(lib(sel.value)); s.selType = s.types.length - 1; a.renderControls(); a.invalidate(); } }));
    btns.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: 'Seçiliyi kopyala', onclick: () => { const c = JSON.parse(JSON.stringify(s.types[s.selType])); c.name += ' (kopya)'; s.types.push(c); s.selType = s.types.length - 1; a.renderControls(); a.invalidate(); } }));
    btns.appendChild(VS.el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Seçiliyi sil', onclick: () => {
      if (s.types.length <= 1) { VS.toast('En az bir tip kalmalı.'); return; }
      if (s.strings.some(x => x.type === s.selType)) { VS.toast('Bu tip bir dizide kullanılıyor; önce diziyi başka tipe atayın.', 'bad'); return; }
      s.types.splice(s.selType, 1); s.strings.forEach(x => { if (x.type > s.selType) x.type--; }); s.selType = Math.max(0, s.selType - 1); a.renderControls(); a.invalidate();
    } }));
    box.appendChild(btns);
  }
  function stringRows(box, a) {
    const s = a.state, r = a.validResult && a.validResult.values.farm, list = VS.el('div', { class: 'vs-cl' });
    s.strings.forEach((x, i) => {
      const st = r && r.strings[i];
      const row = VS.el('div', { class: 'vs-cl__row' + (i === s.selString ? ' is-sel' : ''), 'data-level': st && st.I > (MV_AMP[s.cableS] || 0) ? 'bad' : 'ok' });
      const b = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === s.selString ? 'true' : 'false' }, [VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: x.name + ' · ' + x.n + ' × ' + (typeOf(s, x.type).name) }), VS.el('small', { text: st ? fmt(st.P / 1000, 2) + ' MW · ' + fmt(st.I, 0) + ' A · kayıp ' + fmt(st.cableLoss + st.trafoLoss, 0) + ' kW' : '' })]);
      b.onclick = () => { s.selString = i; a.renderControls(); a.invalidate(); };
      const minus = VS.el('button', { type: 'button', class: 'vs-cl__run', 'aria-label': x.name + ' türbin çıkar', text: '−' });
      minus.onclick = () => { if (x.n > 1) x.n--; a.renderControls(); a.invalidate(); };
      const plus = VS.el('button', { type: 'button', class: 'vs-cl__run', 'aria-label': x.name + ' türbin ekle', text: '+' });
      plus.onclick = () => { x.n++; a.renderControls(); a.invalidate(); };
      row.appendChild(b); row.appendChild(minus); row.appendChild(plus); list.appendChild(row);
    });
    box.appendChild(list);
    const btns = VS.el('div', { class: 'vs-btns' });
    btns.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Dizi ekle', onclick: () => { const L = String.fromCharCode(65 + (s.strings.length % 26)) + (s.strings.length >= 26 ? Math.floor(s.strings.length / 26) : ''); s.strings.push({ name: 'Dizi ' + L, type: s.selType, n: 6 }); s.selString = s.strings.length - 1; a.renderControls(); a.invalidate(); } }));
    btns.appendChild(VS.el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Seçili diziyi sil', onclick: () => { if (s.strings.length <= 1) return; s.strings.splice(s.selString, 1); s.selString = Math.max(0, s.selString - 1); a.renderControls(); a.invalidate(); } }));
    box.appendChild(btns);
  }
  function controls(s) {
    const auto = s.rhoMode !== 'manual', ti = s.selType, si = s.selString, t = s.types[ti], st = s.strings[si];
    const T = 'types.' + ti + '.', S = 'strings.' + si + '.';
    return [
      { title: 'Rüzgâr ve hava', items: [
        { type: 'range', key: 'v10', label: 'Rüzgâr hızı (ölçüm yüksekliğinde)', min: 0, max: 35, step: 0.1, unit: 'm/s', digits: 1 },
        { type: 'range', key: 'href', label: 'Ölçüm yüksekliği h_ref', min: 2, max: 120, step: 1, unit: 'm' },
        { type: 'range', key: 'alpha', label: 'Rüzgâr kesme üssü α', min: 0.05, max: 0.5, step: 0.01, digits: 2, help: 'Açık deniz ~0,10 · düz arazi ~0,14 · engebeli/ormanlık ~0,25+.' },
        { type: 'range', key: 'windDir', label: 'Rüzgâr yönü (geldiği yön)', min: 0, max: 359, step: 1, fmt: v => v + '° (' + compass(v) + ')', help: 'Park içi iz dağılımını değiştirir; diziler bu yönle hizalanınca iz kaybı artar.' },
        { type: 'seg', key: 'rhoMode', label: 'Hava yoğunluğu', options: [['auto', 'Sıcaklık + rakım'], ['manual', 'Elle gir']] },
        { type: 'range', key: 'T', label: 'Hava sıcaklığı', min: -40, max: 50, step: 1, unit: '°C' },
        auto ? { type: 'range', key: 'alt', label: 'Saha rakımı', min: 0, max: 3000, step: 10, unit: 'm' } : { type: 'range', key: 'rho', label: 'Hava yoğunluğu ρ', min: 0.8, max: 1.4, step: 0.005, digits: 3, unit: 'kg/m³' }
      ] },
      { title: 'Zaman serisi (sentetik) ve yeniden devreye girme', items: [
        { type: 'toggle', key: 'ts', label: 'Sentetik 1 saatlik türbülanslı rüzgâr', rebuild: true },
        s.ts ? { type: 'range', key: 'tsMean', label: 'Göbek ortalama hızı', min: 3, max: 30, step: 0.5, unit: 'm/s', digits: 1 } : null,
        s.ts ? { type: 'range', key: 'tsTI', label: 'Türbülans şiddeti TI', min: 4, max: 30, step: 1, fmt: v => '%' + v } : null,
        s.ts ? { type: 'number', key: 'seed', label: 'Tohum (aynı tohum = aynı seri)', min: 1, max: 99999, step: 1 } : null,
        { type: 'range', key: 'restartV', label: 'Yeniden devreye girme hızı (örnek ayar)', min: 15, max: 30, step: 0.5, unit: 'm/s', digits: 1 },
        { type: 'range', key: 'restartDelay', label: 'Bekleme süresi', min: 0, max: 900, step: 10, unit: 's' },
        { type: 'note', text: 'Seri ölçüm değildir (tohumlu temsili türbülans). Cut-out sonrası histerezis bir örnek ayardır; gerçek değerler üreticinin kontrol sistemine bağlıdır. Seri kapalıyken elle hızda bekleme süresi 10× hızlandırılır.' }
      ] },
      { title: 'Türbin tipleri (üretici föyü)', items: [
        { type: 'custom', render: typeRows },
        t ? { type: 'text', key: T + 'name', label: 'Tip adı', parse: v => { v = v.trim(); if (!v) throw new Error('Ad boş olamaz.'); return v.slice(0, 48); }, rebuild: true } : null,
        t ? { type: 'number', key: T + 'Prated', label: 'Nominal güç', min: 10, max: 20000, step: 10, unit: 'kW' } : null,
        t ? { type: 'number', key: T + 'D', label: 'Rotor çapı', min: 5, max: 260, step: 1, unit: 'm' } : null,
        t ? { type: 'number', key: T + 'hub', label: 'Göbek yüksekliği', min: 10, max: 200, step: 1, unit: 'm' } : null,
        t ? { type: 'number', key: T + 'cutIn', label: 'Devreye girme (cut-in)', min: 1, max: 8, step: 0.5, unit: 'm/s', digits: 1 } : null,
        t ? { type: 'number', key: T + 'vRated', label: 'Nominal hız (föy)', min: 6, max: 20, step: 0.1, unit: 'm/s', digits: 1 } : null,
        t ? { type: 'number', key: T + 'cutOut', label: 'Devreden çıkma (cut-out)', min: 15, max: 40, step: 0.5, unit: 'm/s', digits: 1 } : null,
        t ? { type: 'number', key: T + 'rpmMin', label: 'Rotor devri min.', min: 0, max: 60, step: 0.5, unit: 'rpm', digits: 1 } : null,
        t ? { type: 'number', key: T + 'rpmMax', label: 'Rotor devri maks.', min: 1, max: 60, step: 0.5, unit: 'rpm', digits: 1 } : null,
        t ? { type: 'number', key: T + 'etaMech', label: 'Mekanik verim', min: 0.8, max: 1, step: 0.005, digits: 3 } : null,
        t ? { type: 'number', key: T + 'etaGen', label: 'Jeneratör + çevirici verimi', min: 0.8, max: 1, step: 0.005, digits: 3 } : null,
        t ? { type: 'number', key: T + 'trafoKVA', label: 'Türbin trafosu (0,69/' + fmt(s.mvKV, 1) + ' kV)', min: 50, max: 25000, step: 50, unit: 'kVA' } : null,
        t ? { type: 'note', text: 'Föyden türetilen Cp = ' + fmt(X.cpFromDatasheet(t), 3) + ' (nominal hızda nominal güç, ρ0 = 1,225). Betz sınırı 16/27 ≈ 0,593: ideal rotor, rotor alanından geçen kinetik gücün (½·ρ·A·v³) en çok %59,3’ünü alabilir.' } : null
      ] },
      { title: 'Diziler ve OG toplama', items: [
        { type: 'custom', render: stringRows },
        st ? { type: 'text', key: S + 'name', label: 'Dizi adı', parse: v => { v = v.trim(); if (!v) throw new Error('Ad boş olamaz.'); return v.slice(0, 32); }, rebuild: true } : null,
        st ? { type: 'select', key: S + 'type', label: 'Türbin tipi', options: s.types.map((x, i) => [i, x.name]), rebuild: true } : null,
        st ? { type: 'number', key: S + 'n', label: 'Türbin sayısı', min: 1, max: 500, step: 1 } : null,
        { type: 'select', key: 'mvKV', label: 'OG toplama gerilimi', options: [[20, '20 kV'], [33, '33 kV'], [34.5, '34,5 kV'], [36, '36 kV']] },
        { type: 'select', key: 'cableS', label: 'Dizi kablo kesiti (Al XLPE)', options: Object.keys(MV_AMP).map(k => [Number(k), k + ' mm² (≈ ' + MV_AMP[k] + ' A)']) },
        { type: 'range', key: 'homeKm', label: 'Dizi → trafo merkezi kablo uzunluğu', min: 0.1, max: 30, step: 0.1, unit: 'km', digits: 1 },
        { type: 'range', key: 'pf', label: 'Güç faktörü', min: 0.85, max: 1, step: 0.01, digits: 2 },
        { type: 'number', key: 'ssMVA', label: 'Trafo merkezi gücü (OG/YG)', min: 1, max: 2000, step: 1, unit: 'MVA' },
        { type: 'number', key: 'curtail', label: 'Şebeke işletmecisi güç sınırı (0 = yok)', min: 0, max: 5000, step: 0.5, unit: 'MW', digits: 1 }
      ] },
      { title: 'Yerleşim ve iz (Jensen)', items: [
        { type: 'range', key: 'rowDir', label: 'Dizi ekseni yönü', min: 0, max: 359, step: 1, fmt: v => v + '°' },
        { type: 'range', key: 'spacing', label: 'Dizi içi aralık', min: 2, max: 15, step: 0.5, fmt: v => fmt(v, 1) + ' D' },
        { type: 'range', key: 'rowGap', label: 'Diziler arası aralık', min: 2, max: 20, step: 0.5, fmt: v => fmt(v, 1) + ' D' },
        { type: 'toggle', key: 'wakeOn', label: 'İz etkisini hesapla' },
        { type: 'range', key: 'wakeK', label: 'İz genişleme katsayısı k', min: 0.03, max: 0.12, step: 0.005, digits: 3, help: 'Karada tipik 0,075; açık denizde 0,04–0,05.' }
      ] },
      { title: 'İşletme (ön plandaki türbin)', items: [
        { type: 'toggle', key: 'service', label: 'Servis freni (türbini durdur)' },
        { type: 'seg', key: 'yawMode', label: 'Yaw', options: [['auto', 'Otomatik (rüzgârı izler)'], ['manual', 'Elle']] },
        s.yawMode === 'manual' ? { type: 'range', key: 'yawManual', label: 'Nacelle yönü', min: 0, max: 359, step: 1, fmt: v => v + '° (' + compass(v) + ')' } : null,
        { type: 'range', key: 'Tmin', label: 'Düşük sıcaklık duruş sınırı (örnek)', min: -40, max: 0, step: 1, unit: '°C' },
        { type: 'toggle', key: 'icing', label: 'Buzlanma algılama: −5…+2 °C’de durdur (örnek)' },
        { type: 'range', key: 'tsr', label: 'Uç hız oranı λ', min: 3, max: 12, step: 0.1, digits: 1 }
      ] },
      { title: 'Yıllık üretim (varsayımsal)', items: [
        { type: 'range', key: 'vMeanRef', label: 'Ölçüm yüksekliğinde yıllık ortalama hız', min: 2, max: 12, step: 0.1, unit: 'm/s', digits: 1, help: 'Her tipin göbek yüksekliğine üstel profille taşınır.' },
        { type: 'range', key: 'k', label: 'Weibull şekil parametresi k', min: 1.2, max: 4, step: 0.1, digits: 1 },
        { type: 'range', key: 'avail', label: 'Kullanılabilirlik', min: 50, max: 100, step: 0.5, fmt: v => '%' + fmt(v, 1) },
        { type: 'note', level: 'warn', text: 'Yıllık üretim ölçüm verisi olmadan Weibull dağılımı ve tekdüze rüzgâr gülüyle hesaplanan bir senaryodur; yatırım kararı için en az 1 yıllık ölçüm ve uzun dönem düzeltmesi gerekir.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  const MW = kW => fmt(kW / 1000, kW >= 1e4 ? 1 : 2, 'MW');
  function readouts(res, s, live) {
    const v = res.values, f = v.farm, ty = fgType(s), lv = v.region === 'stop' || v.region === 'climate' ? 'bad' : v.region === 'idle' || v.region === 'service' || v.region === 'hyst' ? 'warn' : 'ok';
    const out = [
      { label: 'Göbek rüzgârı (ön türbin)', value: fmt(v.vHub, 2, 'm/s'), sub: 'v10 ' + fmt(v10Now(s, live), 1) + ' m/s → ' + ty.hub + ' m · ' + s.windDir + '° (' + compass(s.windDir) + ')' },
      { label: 'Hava yoğunluğu ρ', value: fmt(v.rho, 3, 'kg/m³'), sub: s.rhoMode === 'manual' ? 'Elle' : s.T + ' °C · ' + s.alt + ' m' },
      { label: 'Ön türbin gücü', value: VS.fmtPower(v.P * 1000), level: lv, sub: REGION[v.region] },
      { label: v.region === 'rated' ? 'Gereken Cp' : 'Cp (föyden)', value: fmt(v.region === 'rated' ? v.cpReq : v.cp, 3), sub: 'Betz sınırı 0,593' + (Math.abs(v.yawErr) > 1 ? ' · yaw ×' + fmt(v.yawF, 3) : '') },
      { label: 'Rotor devri', value: fmt(v.rpm, 1, 'rpm'), sub: 'Uç hızı ' + fmt(v.tip, 1) + ' m/s · aralık ' + fmt(ty.rpmMin, 1) + '–' + fmt(ty.rpmMax, 1) },
      { label: 'Nominal hız (ρ sahada)', value: fmt(v.vRated, 1, 'm/s'), sub: 'Föy ' + fmt(ty.vRated, 1) + ' m/s @ 1,225 · v_n = v·(ρ/ρ0)^⅓' },
      { label: 'Park türbin gücü', value: MW(f.Pturb), sub: v.n + ' türbin · anlık iz kaybı %' + fmt(f.wakeLoss * 100, 1) },
      { label: 'Elektrik kayıpları', value: fmt(f.lossTrafo + f.lossCable + f.lossSS, 0, 'kW'), sub: 'Trafo ' + fmt(f.lossTrafo, 0) + ' · kablo ' + fmt(f.lossCable, 0) + ' · TM ' + fmt(f.lossSS, 0) + ' kW' },
      { label: 'Bağlantı noktası (POI)', value: MW(f.poi), level: f.curtailed > 1 ? 'warn' : undefined, sub: s.curtail > 0 ? 'Sınır ' + fmt(s.curtail, 1) + ' MW · kısılan ' + MW(f.curtailed) : 'Sınır yok · TM yüklenmesi %' + fmt(f.ssLoading * 100, 0) },
      { label: 'Yıllık net üretim', value: VS.fmtEnergy(v.aepF.net), sub: 'Varsayımsal · iz %' + fmt(v.aepF.wakeLoss * 100, 1) + ' · elektrik %' + fmt(v.aepF.elecLoss * 100, 1) },
      { label: 'Kapasite faktörü', value: '%' + fmt(v.cf * 100, 1), sub: 'Kurulu ' + MW(v.Pplanned) + ' · varsayımsal' }
    ];
    if (v.ts) out.push({ label: 'Sentetik 1 saat (ön türbin)', value: fmt(v.ts.energy / 1000, 2, 'MWh') + ' · ' + v.ts.stops + ' durma', wide: true, level: v.ts.stops > 2 ? 'warn' : 'ok', sub: 'Duruş ' + fmt(v.ts.downMin, 1) + ' dk · ortalama ' + VS.fmtPower(v.ts.meanP * 1000) + ' · oynatma ' + fmt(Math.min(60, live.tsT / 60), 1) + ' / 60 dk' });
    return out;
  }
  function weibullBins(s, v) {
    const ty = fgType(s), mean = X.atHeight(s.vMeanRef, s.href, ty.hub, s.alpha), c = X.weibullC(mean, s.k), t = X.turbine(ty, v.rho);
    const bins = []; let sum = 0;
    for (let b = 0; b < 30; b++) { const vc = b + 0.5, fr = X.weibullPdf(vc, c, s.k), e = R.power(vc, t).P * fr; bins.push([vc, fr * 100, e]); sum += e; }
    return { bins: bins, sum: sum, mean: mean, c: c };
  }
  function charts(res, s, live) {
    const v = res.values, ty = fgType(s), f = v.farm, u = ty.Prated >= 1000 ? 1000 : 1, U = u === 1000 ? 'MW' : 'kW';
    const t0 = X.turbine(ty, X.RHO0), t1 = X.turbine(ty, 1.0);
    const ref = [], low = [];
    for (let x = 0; x <= 30; x += 0.5) { ref.push([x, R.power(x, t0).P / u]); low.push([x, R.power(x, t1).P / u]); }
    const out = [{
      id: 'pcurve', title: 'Güç eğrisi · yoğunluk karşılaştırması (IEC 61400-12-1)', height: 170,
      series: [{ name: 'Saha ρ = ' + fmt(v.rho, 3), color: 'amber', area: true, data: v.curve.map(p => [p.v, p.P / u]) }, { name: 'ρ0 = 1,225', color: 'cyan', data: ref }, { name: 'ρ = 1,000', color: 'violet', dash: [4, 3], data: low }],
      markers: [{ x: Math.min(v.vHub, 30), y: v.P / u, color: '#fcd34d', label: fmt(v.vHub, 1) + ' m/s' }],
      x: { label: 'm/s (göbek)', min: 0, max: 30 }, y: { label: U, min: 0, max: ty.Prated / u * 1.15 },
      alt: 'Düşük yoğunlukta aynı hızda güç azalır; nominal hız ' + fmt(v.vRated, 1) + ' m/s (föy ' + ty.vRated + ' m/s @ 1,225).'
    }];
    const w = weibullBins(s, v);
    out.push({ id: 'weibull', title: 'Rüzgâr dağılımı ve enerji katkısı · ' + ty.hub + ' m (varsayımsal)', height: 150,
      series: [{ name: 'Zaman payı (%)', type: 'bar', color: 'cyan', width: 0.4, offset: -0.5, data: w.bins.map(b => [b[0], b[1]]) }, { name: 'Enerji payı (%)', type: 'bar', color: 'green', width: 0.4, offset: 0.5, data: w.bins.map(b => [b[0], w.sum > 0 ? b[2] / w.sum * 100 : 0]) }],
      markers: [{ x: w.mean, color: '#fcd34d', label: 'ort. ' + fmt(w.mean, 1) }], x: { label: 'm/s', min: 0, max: 25 }, y: { label: '%' },
      alt: 'Weibull k = ' + s.k + ', c = ' + fmt(w.c, 2) + ' m/s; enerjinin çoğu ortalamanın üstündeki hızlardan gelir.' });
    out.push({ id: 'strings', title: 'Dizi güçleri: izli / izsiz (anlık)', height: 150,
      series: [{ name: 'İzsiz (MW)', type: 'bar', color: 'grey', width: 0.4, offset: -0.5, data: f.strings.map((x, i) => [i + 1, f.turbines.filter(t => t.s === i).reduce((a, t) => a + t.Pfree, 0) / 1000]) },
        { name: 'İzli (MW)', type: 'bar', color: 'amber', width: 0.4, offset: 0.5, data: f.strings.map((x, i) => [i + 1, x.P / 1000]) }],
      x: { min: 0.4, max: f.strings.length + 0.6, ticks: f.strings.map((x, i) => i + 1), fmt: x => String(x) }, y: { label: 'MW', min: 0 },
      alt: s.strings.map((x, i) => x.name + ': ' + fmt(f.strings[i].P / 1000, 2) + ' MW').join(', ') });
    const si = Math.min(s.selString, s.strings.length - 1), row = f.turbines.filter(t => t.s === si);
    out.push({ id: 'row', title: (s.strings[si] ? s.strings[si].name : '') + ' · türbin başına güç (Jensen izi)', height: 140,
      series: [{ name: 'P (' + U + ')', type: 'bar', color: 'amber', data: row.map((t, j) => [j + 1, t.P / u]) }, { name: 'Hız (m/s)', color: 'cyan', data: row.map((t, j) => [j + 1, t.v]) }],
      x: { min: 0.4, max: row.length + 0.6, ticks: row.length <= 24 ? row.map((t, j) => j + 1) : undefined, fmt: x => String(Math.round(x)) }, y: { label: U + ' · m/s', min: 0 },
      alt: 'Rüzgâr dizi ekseniyle hizalandığında arkadaki türbinler yavaşlar.' });
    if (v.ts) out.push({ id: 'ts', title: 'Sentetik 1 saat · göbek hızı ve güç (ön türbin)', height: 150,
      series: [{ name: 'v (m/s)', color: 'cyan', data: v.ts.v.map((x, i) => [i * TS_DT / 60, x]).filter((p, i) => i % 3 === 0) }, { name: 'P (' + U + ')', color: 'amber', area: true, data: v.ts.P.map((x, i) => [i * TS_DT / 60, x / u]).filter((p, i) => i % 3 === 0) }],
      hLines: [{ y: ty.cutOut, label: 'cut-out', color: '#ef4444' }, { y: s.restartV, label: 'yeniden', color: '#f59e0b' }],
      markers: [{ x: Math.min(60, live.tsT / 60), color: '#fcd34d' }], x: { label: 'dk', min: 0, max: 60 }, y: { label: 'm/s · ' + U, min: 0 },
      alt: 'Sentetik seri: ' + v.ts.stops + ' durma, ' + fmt(v.ts.energy / 1000, 2) + ' MWh.' });
    return out;
  }

  /* ---------------------------------------------------------------- 3D: geometri */
  let G = null, KIT = null;
  // modül önbelleğindeki geometriler sahne yeniden kurulurken dispose edilmez (kit.keep); her kurulumda yeniden yüklenmez
  function keepGeos(o) { if (!KIT || !o) return; if (o.isBufferGeometry) KIT.keep(o); else Object.keys(o).forEach(n => { if (o[n] && o[n].isBufferGeometry) KIT.keep(o[n]); }); }
  function keepAll() { if (!G) return; keepGeos(G); Object.keys(G.blades).forEach(n => keepGeos(G.blades[n])); Object.keys(G.types).forEach(n => keepGeos(G.types[n])); }
  function hAt(x, z) {
    const r = Math.hypot(x, z), f = r < 230 ? 0 : r > 520 ? 1 : (r - 230) / 290;
    const h = 16 * Math.sin(x / 260 + 0.6) * Math.cos(z / 330) + 11 * Math.sin((x + z) / 190) + 30 * Math.exp(-((x + 900) ** 2 + (z + 1300) ** 2) / 5e5) + 22 * Math.exp(-((x - 1100) ** 2 + (z + 700) ** 2) / 3e5);
    return (h + 12) * f * f * (3 - 2 * f);
  }
  function geos(T) {
    if (G) return G;
    G = { blades: {}, types: {} };
    const S = 16000, N = 220, geo = new T.PlaneGeometry(S, S, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, cols = [], c = new T.Color(), a = new T.Color(0x56723a), b = new T.Color(0x7f8d4a), d = new T.Color(0x3f5a2e);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = hAt(x, z);
      pos.setY(i, y);
      const n = 0.5 + 0.5 * Math.sin(x / 90 + Math.cos(z / 70) * 2) * Math.cos(z / 130);
      c.copy(a).lerp(b, n * 0.6).lerp(d, Math.max(0, Math.sin(x / 400 - z / 300)) * 0.35); c.convertSRGBToLinear();
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    G.terrain = geo; G.streak = new T.BoxGeometry(1, 1, 1); G.box = new T.BoxGeometry(1, 1, 1);
    return G;
  }
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  /** Kanat: kök bölgede daireden aerofoil kesite geçen, sivrilen ve burulan gövde (NACA 00xx kalınlık dağılımı). */
  function bladeGeo(T, r0, Rt) {
    const key = r0.toFixed(2) + '|' + Rt.toFixed(2);
    if (G.blades[key]) return G.blades[key];
    const NS = 28, NP = 26, pos = [], idx = [];
    for (let i = 0; i < NS; i++) {
      const s = Math.pow(i / (NS - 1), 0.85), r = r0 + (Rt - r0) * s;
      const c = Rt * (s < 0.22 ? 0.045 + (0.075 - 0.045) * Math.sin(s / 0.22 * Math.PI / 2) : 0.075 - (0.075 - 0.016) * Math.pow((s - 0.22) / 0.78, 0.9));
      const tc = s < 0.22 ? 1 - 0.6 * s / 0.22 : 0.4 - 0.25 * Math.min(1, (s - 0.22) / 0.6);
      const circ = s < 0.16 ? 1 - smooth(s / 0.16) : 0;
      const tw = (14 * Math.pow(Math.max(0, 1 - s), 1.6)) * Math.PI / 180, ct = Math.cos(tw), st = Math.sin(tw);
      for (let j = 0; j < NP; j++) {
        const th = j / NP * Math.PI * 2, xc = 0.5 * (1 + Math.cos(th));
        const yt = 5 * Math.min(tc, 0.42) * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
        const camber = 0.035 * 4 * xc * (1 - xc) * (1 - s);
        let Xc = (xc - 0.32) * c, Y = (Math.sign(Math.sin(th)) * yt + camber) * c;
        Xc = Xc * (1 - circ) + 0.5 * Math.cos(th) * c * circ; Y = Y * (1 - circ) + 0.5 * Math.sin(th) * c * circ;
        pos.push(Y * ct - Xc * st, r, Y * st + Xc * ct);     // kord → z, kalınlık → x; burulma y etrafında
      }
    }
    for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NP; j++) { const a = i * NP + j, b = i * NP + (j + 1) % NP; idx.push(a, a + NP, b, b, a + NP, b + NP); }
    const tip = pos.length / 3; pos.push(0, Rt + 0.15, 0);
    for (let j = 0; j < NP; j++) idx.push((NS - 1) * NP + j, tip, (NS - 1) * NP + (j + 1) % NP);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    G.blades[key] = geo; keepGeos(geo); return geo;
  }
  function spinnerGeo(T, r) {
    const pts = [new T.Vector2(0.001, -0.9 * r), new T.Vector2(r * 0.98, -0.9 * r)];
    for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; pts.push(new T.Vector2(Math.max(0.001, r * Math.cos(a)), 1.25 * r * Math.sin(a))); }
    const geo = new T.LatheGeometry(pts, 32); geo.rotateZ(-Math.PI / 2); geo.computeVertexNormals();
    return geo;
  }
  function dims(t) {
    const D = t.D, hub = Math.max(t.hub, D / 2 + 5);
    const L = 0.11 * D + 1.5, Wn = 0.035 * D + 1, Hn = 0.033 * D + 0.9, hubR = 0.016 * D + 0.1, rb = 0.4 + 0.012 * hub + 0.006 * D;
    return { D: D, Rt: D / 2, hub: hub, L: L, Wn: Wn, Hn: Hn, hubR: hubR, rb: rb, rt: rb * 0.6, Ht: hub - 0.55 * Hn, rotorX: 0.38 * L + 0.8 * hubR + 0.3, sF: D / 120 };
  }
  /** Bir türbin tipinin paylaşımlı geometrileri (InstancedMesh için). */
  function typeGeos(k, t) {
    const T = k.T, d = dims(t), key = d.D + '|' + d.hub;
    if (G.types[key]) return G.types[key];
    const r = Math.min(d.Hn, d.Wn);
    const tg = { d: d, tower: new T.CylinderGeometry(d.rt, d.rb, d.Ht, 40, 4), top: k.rboxGeo(d.L, d.Hn * 0.56, d.Wn, r * 0.22), low: k.rboxGeo(d.L, d.Hn * 0.46, d.Wn, r * 0.16), spin: spinnerGeo(T, d.hubR), blade: bladeGeo(T, d.hubR * 0.8, d.Rt) };
    G.types[key] = tg; keepGeos(tg); return tg;
  }
  const toWorld = p => [p.x, hAt(p.x, -p.y), -p.y];
  /** Görsel rotor devri (sayı olarak gösterilmez): λ·v/R, föy devir aralığında; durmuşsa 0. */
  function visRpm(t, s, tur) { if (tur.P <= 0 && tur.region !== 'idle') return 0; if (tur.v < t.cutIn * 0.6) return 0; return Math.min(t.rpmMax, Math.max(t.rpmMin, s.tsr * tur.v / (t.D / 2) * 60 / (2 * Math.PI))); }
  function visPitch(t, tur) { if (tur.region === 'stop' || tur.region === 'service') return 88; if (tur.region === 'rated') return 2 + 22 * Math.max(0, Math.min(1, (tur.v - t.vRated) / Math.max(1, t.cutOut - t.vRated))); return 0; }

  /* ---------------------------------------------------------------- 3D: sahne kurulumu */
  function rebuildOn(s) { return JSON.stringify([s.types.map(t => [t.D, t.hub]), s.strings.map(x => [x.type, Math.round(x.n), x.name]), s.rowDir, s.spacing, s.rowGap]); }
  function build(k, s, app) {
    KIT = k;
    const T = k.T, M = k.mats, v = k.viewer, g = geos(T); keepAll();
    if (validate(s).length) { app.scene3 = null; v.scene.fog = null; k.ground(400, M.grass, 0); return; }
    const t0 = fgType(s), d = dims(t0);
    const lay = X.layoutFarm(s.strings.map(x => ({ type: x.type, n: Math.round(x.n) })), s.types, s);
    let ext = 300; lay.forEach(p => { ext = Math.max(ext, Math.hypot(p.x, p.y) + 300); });
    const sc = { d: d, app: app, lay: lay, ang: lay.map((p, i) => i * 0.9), rpm: lay.map(() => 0), pitch: lay.map(() => 0) };
    app.scene3 = sc;
    v.camera.near = 0.5; v.camera.far = Math.max(9000, ext * 3); v.camera.updateProjectionMatrix();
    v.scene.fog = new T.Fog(0xb3c8de, 900, Math.max(5200, ext * 1.6));
    v.sun.shadow.bias = -0.0006; v.sun.shadow.normalBias = 0.3;
    const towerMat = new T.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.42, metalness: 0.1 });
    const white = M.bladeWhite;
    const gearMat = new T.MeshStandardMaterial({ color: 0x6f7f8c, roughness: 0.45, metalness: 0.5 });
    const genMat = new T.MeshStandardMaterial({ color: 0x2c4a6e, roughness: 0.45, metalness: 0.4 });
    const ter = new T.Mesh(g.terrain, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    ter.receiveShadow = true; ter.userData.noClip = true; v.root.add(ter);
    const pad = new T.Mesh(new T.CircleGeometry(24, 40), M.gravel); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.06; pad.receiveShadow = true; pad.userData.noClip = true; v.root.add(pad);
    const SSX = -70, SSZ = 40;
    const rg = new T.PlaneGeometry(6, Math.hypot(SSX, SSZ) - 20); rg.rotateX(-Math.PI / 2);
    const road = new T.Mesh(rg, M.gravel); road.rotation.y = Math.atan2(SSX, SSZ); road.position.set(SSX / 2, 0.05, SSZ / 2); road.receiveShadow = true; road.userData.noClip = true; v.root.add(road);

    // ---- ön plandaki türbin (ayrıntılı)
    const fgActs = a => turbineActions(a);
    const base = k.group(null, 0, 0, 0);
    k.cyl(d.rb + 3.2, d.rb + 3.8, 1.2, M.concrete, 0, 0.3, 0, base, 40);
    const tower = new T.Mesh(new T.CylinderGeometry(d.rt, d.rb, d.Ht, 56, 6), towerMat);
    tower.position.y = d.Ht / 2 + 0.9; tower.castShadow = tower.receiveShadow = true; base.add(tower);
    [0.36, 0.68].forEach(f => { const rr = d.rb + (d.rt - d.rb) * f; const fl = new T.Mesh(new T.TorusGeometry(rr + 0.02, 0.07 * d.sF + 0.03, 8, 48), M.galv); fl.rotation.x = Math.PI / 2; fl.position.y = 0.9 + d.Ht * f; base.add(fl); });
    const door = k.group(base, Math.sin(0.7) * (d.rb - 0.05), 0, Math.cos(0.7) * (d.rb - 0.05)); door.rotation.y = 0.7;
    k.rbox(1.0, 2.2, 0.12, 0.08, M.plasticGrey, 0, 3.0, 0.05, door);
    k.box(2.2, 0.12, 1.6, M.galv, 0, 1.85, 0.85, door);
    for (let j = 0; j < 4; j++) k.box(1.0, 0.06, 0.32, M.galv, 0, 0.35 + j * 0.38, 1.85 + (3 - j) * 0.3, door);
    k.box(0.05, 1.1, 1.6, M.galv, 1.08, 2.45, 0.85, door); k.box(0.05, 1.1, 1.6, M.galv, -1.08, 2.45, 0.85, door);
    k.pickable(tower, () => (s.strings[0] ? s.strings[0].name : '') + ' · 1. türbin (' + t0.name + ')', () => turbineInfo(app), fgActs);
    const kx = d.rb + 9, kz = -4;
    const kiosk = k.rbox(3.2, 2.6, 2.4, 0.1, M.panelRAL7035, kx, 1.4, kz);
    k.box(3.4, 0.14, 2.6, M.panelRAL7035, kx, 2.78, kz); k.box(4, 0.3, 3, M.concrete, kx, 0.15, kz);
    k.pickable(kiosk, 'Türbin trafosu 0,69/' + fmt(s.mvKV, 1) + ' kV', () => { const r = app.validResult; const tr = r && r.values.farm; return ['Anma gücü: ' + t0.trafoKVA + ' kVA (föy)', 'Kayıplar: P0 %0,1 + Pk %1·(S/Sn)² (tipik oran)', tr ? 'Parkta toplam trafo kaybı: ' + fmt(tr.lossTrafo, 0) + ' kW' : '', 'Kiosk tipi kule dibinde; bazı modellerde nacelle içindedir']; });
    const yaw = k.group(null, 0, d.hub + 0.9, 0);
    sc.yaw = yaw;
    const coverLow = k.rbox(d.L, d.Hn * 0.46, d.Wn, Math.min(d.Hn, d.Wn) * 0.16, white, -0.12 * d.L, -d.Hn * 0.27, 0, yaw);
    const coverTop = k.rbox(d.L, d.Hn * 0.56, d.Wn, Math.min(d.Hn, d.Wn) * 0.22, white, -0.12 * d.L, d.Hn * 0.24, 0, yaw);
    k.shell(coverLow); k.shell(coverTop); k.explodable(coverTop, [0, d.Hn * 1.4, 0]);
    k.pickable(coverTop, 'Nacelle (makine dairesi)', () => turbineInfo(app), fgActs);
    const cooler = k.box(d.Wn * 0.7, d.Hn * 0.28, d.L * 0.16, M.plasticGrey, -0.55 * d.L, d.Hn * 0.62, 0, yaw); cooler.rotation.y = Math.PI / 2; k.shell(cooler); k.explodable(cooler, [0, d.Hn * 1.4, 0]);
    k.cyl(0.04 * d.sF + 0.02, 0.04 * d.sF + 0.02, d.Hn * 0.5, M.galv, -0.42 * d.L, d.Hn * 0.78, d.Wn * 0.25, yaw, 8);
    sc.vane = k.group(yaw, -0.42 * d.L, d.Hn * 1.03, d.Wn * 0.25);
    k.box(0.9 * d.sF, 0.25 * d.sF, 0.03, M.plasticDark, -0.35 * d.sF, 0, 0, sc.vane);
    sc.beacon = k.sphere(0.22 * d.sF + 0.08, M.ledRed, -0.42 * d.L, d.Hn * 0.78, -d.Wn * 0.25, yaw);
    const sF = d.sF;
    k.box(d.L * 0.85, 0.4 * sF, d.Wn * 0.62, M.darkSteel, -0.1 * d.L, -d.Hn * 0.4, 0, yaw);
    const bearing = k.box(1.6 * sF, 1.7 * sF, 1.9 * sF, gearMat, 0.27 * d.L, -d.Hn * 0.1, 0, yaw);
    k.pickable(bearing, 'Ana yatak', () => ['Rotor yükünü şasiye aktaran ana yatak', 'Rotor eğimi ~5° (kanat–kule açıklığı için)']);
    const gb = k.cyl(1.25 * sF, 1.05 * sF, 2.4 * sF, gearMat, 0.04 * d.L, -d.Hn * 0.06, 0, yaw, 32); gb.rotation.z = Math.PI / 2;
    k.box(0.5 * sF, 0.6 * sF, 3.4 * sF, gearMat, 0.04 * d.L, -d.Hn * 0.2, 0, yaw);
    k.pickable(gb, 'Dişli kutusu (planet + helisel)', () => { const r = app.validResult; return ['Rotor devrini jeneratör devrine yükseltir (temsili)', 'Mekanik verim η_mek = ' + fmt(t0.etaMech, 3), r ? 'Rotor devri: ' + fmt(r.values.rpm, 1) + ' rpm' : '']; });
    k.explodable(gb, [0, 0, d.Wn * 0.9]);
    const disc = k.cyl(0.8 * sF, 0.8 * sF, 0.12 * sF, M.steel, -0.08 * d.L, -d.Hn * 0.06, 0, yaw, 32); disc.rotation.z = Math.PI / 2;
    const caliper = k.box(0.3 * sF, 0.5 * sF, 0.35 * sF, M.plasticRed, -0.08 * d.L, -d.Hn * 0.06 + 0.75 * sF, 0, yaw);
    k.pickable(disc, 'Mekanik fren (yüksek devirli taraf)', () => ['Servis/acil durdurmada aerodinamik frene (kanat feather) ek olarak devreye girer', s.service ? 'Durum: servis freni UYGULANDI' : 'Durum: serbest'], fgActs);
    void caliper;
    const cpl = k.cyl(0.22 * sF, 0.22 * sF, 0.1 * d.L, M.steel, -0.15 * d.L, -d.Hn * 0.06, 0, yaw, 16); cpl.rotation.z = Math.PI / 2;
    const gen = k.cyl(1.05 * sF, 1.05 * sF, 2.8 * sF, genMat, -0.3 * d.L, -d.Hn * 0.06, 0, yaw, 32); gen.rotation.z = Math.PI / 2;
    for (let j = 0; j < 5; j++) { const rr = k.cyl(1.12 * sF, 1.12 * sF, 0.08 * sF, genMat, -0.3 * d.L - 1.1 * sF + j * 0.55 * sF, -d.Hn * 0.06, 0, yaw, 32); rr.rotation.z = Math.PI / 2; }
    k.pickable(gen, 'Jeneratör (temsili)', () => { const r = app.validResult; return ['Jeneratör + çevirici verimi η = ' + fmt(t0.etaGen, 3), r ? 'Elektrik gücü: ' + VS.fmtPower(r.values.P * 1000) : '', 'Çıkış ≈ 0,69 kV; türbin trafosuyla OG’ye yükseltilir']; });
    k.explodable(gen, [0, 0, -d.Wn * 0.9]);
    for (let j = 0; j < 3; j++) k.box(0.9 * sF, 1.9 * sF, 0.7 * sF, M.panelRAL7035, -0.52 * d.L, -d.Hn * 0.12, (j - 1) * 0.8 * sF, yaw);
    const yring = new T.Mesh(new T.TorusGeometry(d.rt * 0.95, 0.15 * sF + 0.05, 8, 40), M.steel); yring.rotation.x = Math.PI / 2; yring.position.set(0, -d.Hn * 0.5, 0); yaw.add(yring);
    k.pickable(yring, 'Yaw sistemi (dişli çember + motorlar)', () => ['Mod: ' + (s.yawMode === 'manual' ? 'elle ' + s.yawManual + '°' : 'otomatik (rüzgâr gülüne göre)'), 'Görsel yaw hızı ' + YAW_RATE + '°/s (gerçekte ~0,3–0,5°/s)'], fgActs);
    const tilt = k.group(yaw, d.rotorX, 0, 0); tilt.rotation.z = TILT;
    const rotor = k.group(tilt, 0, 0, 0); sc.rotor = rotor;
    const shaft = k.cyl(0.42 * sF, 0.5 * sF, d.rotorX - 0.1 * d.L, M.steel, -(d.rotorX - 0.1 * d.L) / 2 - 0.4, 0, 0, rotor, 20); shaft.rotation.z = Math.PI / 2;
    k.pickable(shaft, 'Ana mil', () => ['Düşük devirli ana mil; rotor torkunu dişli kutusuna iletir']);
    const sp = spinnerGeo(T, d.hubR);
    const spinner = new T.Mesh(sp, white); spinner.castShadow = true; rotor.add(spinner); k.shell(spinner);
    k.sphere(d.hubR * 0.75, M.galv, 0, 0, 0, rotor);
    k.pickable(spinner, 'Göbek ve burun konisi', () => ['Üç kanat pitch yataklarıyla göbeğe bağlıdır', 'Gösterilen kanat açısı temsilidir'], fgActs);
    const bg = bladeGeo(T, d.hubR * 0.8, d.Rt);
    sc.blades = [];
    for (let j = 0; j < 3; j++) {
      const holder = k.group(rotor, 0, 0, 0); holder.rotation.x = j * Math.PI * 2 / 3;
      const bl = new T.Mesh(bg, white); bl.castShadow = true; bl.receiveShadow = true; holder.add(bl);
      k.cyl(d.hubR * 0.42, d.hubR * 0.42, 0.5, M.galv, 0, d.hubR * 0.85, 0, holder, 20);
      sc.blades.push(bl);
      if (j === 0) k.pickable(bl, 'Kanat (aerofoil kesitli, burulmalı)', () => { const r = app.validResult; return ['Uzunluk ≈ ' + fmt(d.Rt - d.hubR * 0.8, 1) + ' m', r ? 'Uç hızı: ' + fmt(r.values.tip, 1) + ' m/s' : '', 'Kanat açısı (temsili): ' + fmt(app.live.pitch, 0) + '°']; }, fgActs);
    }
    sc.nacLabel = k.label('Türbin', yaw, [-0.1 * d.L, d.Hn * 0.9 + 2, 0]);
    sc.pitchLabel = k.label('Kanat açısı', tilt, [d.hubR * 1.6, -d.hubR * 1.6, 0], 'vs-label--sm');

    // ---- diğer türbinler: tip başına InstancedMesh
    sc.sets = [];
    s.types.forEach((ty, ti) => {
      const list = lay.map((p, i) => ({ p: p, i: i })).filter(o => o.i > 0 && o.p.type === ti);
      if (!list.length) return;
      const tg = typeGeos(k, ty), n = list.length, dm = new T.Object3D();
      const tw = new T.InstancedMesh(tg.tower, towerMat, n);
      list.forEach((o, q) => { const w = toWorld(o.p); o.w = w; dm.position.set(w[0], w[1] + tg.d.Ht / 2 + 0.9, w[2]); dm.updateMatrix(); tw.setMatrixAt(q, dm.matrix); });
      const set = { ti: ti, tg: tg, list: list, nacTop: new T.InstancedMesh(tg.top, white, n), nacLow: new T.InstancedMesh(tg.low, white, n), spin: new T.InstancedMesh(tg.spin, white, n), blade: new T.InstancedMesh(tg.blade, white, n * 3) };
      [tw, set.nacTop, set.nacLow, set.spin, set.blade].forEach(im => { im.castShadow = true; im.receiveShadow = true; v.root.add(im); });
      [set.nacTop, set.nacLow, set.spin, set.blade].forEach(im => im.instanceMatrix.setUsage(T.DynamicDrawUsage));
      const c0 = new T.Object3D(), c1 = new T.Object3D(), c2 = new T.Object3D(), c3 = new T.Object3D(), c4 = new T.Object3D(), cn = new T.Object3D();
      c0.add(c1); c1.add(c2); c2.add(c3); c3.add(c4); c0.add(cn); c1.position.set(tg.d.rotorX, 0, 0); c1.rotation.z = TILT;
      set.chain = [c0, c1, c2, c3, c4, cn];
      k.pickable(tw, () => ty.name + ' · ' + n + ' türbin', () => typeInfo(app, ti), a => [{ label: 'Bu tipi düzenle', onClick: x => { x.state.selType = ti; } }]);
      sc.sets.push(set);
    });
    // ---- OG toplama kabloları (dizi başına) ve dizi etiketleri
    sc.cables = []; sc.strLabels = [];
    s.strings.forEach((x, si) => {
      // kablo güzergâhı zemini izler (yer altı; üstte koruma bandı gösterilir): uzak uçtan TM'ye
      const nodes = lay.filter(p => p.s === si).map(p => toWorld(p)).reverse().concat([[SSX + 6, 0, SSZ]]);
      const pts = [];
      for (let q = 0; q < nodes.length - 1; q++) {
        const A = nodes[q], B = nodes[q + 1], L = Math.hypot(B[0] - A[0], B[2] - A[2]), m = Math.max(1, Math.ceil(L / 60));
        for (let u = 0; u < m; u++) { const x = A[0] + (B[0] - A[0]) * u / m, z = A[2] + (B[2] - A[2]) * u / m; pts.push([x, hAt(x, z) + 0.7, z]); }
      }
      pts.push([SSX + 6, 0.7, SSZ]);
      const tube = k.tube(pts, 0.7, M.concreteDark, null, Math.min(1200, pts.length * 4));
      tube.castShadow = false;
      const fl = k.flow(tube.userData.curve, Math.min(120, 10 + pts.length * 4), 0xfcd34d, 2.2);
      k.pickable(tube, () => x.name + ' · OG toplama kablosu', () => stringInfo(app, si), a => stringActions(a, si));
      sc.cables.push({ si: si, flow: fl });
      const far = toWorld(lay.filter(p => p.s === si).slice(-1)[0]), ty = typeOf(s, x.type);
      sc.strLabels.push(k.label(x.name, null, [far[0], far[1] + ty.hub + ty.D / 2 + 12, far[2]], 'vs-label--sm'));
    });
    // ---- ölçüm direği (h_ref)
    const mx = 60, mz = 26, mh = Math.max(2, s.href);
    k.cyl(0.12, 0.16, mh, M.galv, mx, mh / 2, mz, null, 10);
    [0, 2.1, 4.2].forEach(a => k.tube([[mx, mh * 0.8, mz], [mx + Math.cos(a) * mh * 0.5, 0.1, mz + Math.sin(a) * mh * 0.5]], 0.025, M.steel));
    k.box(1.6, 0.06, 0.06, M.galv, mx + 0.8, mh - 0.2, mz);
    sc.cups = k.group(null, mx + 1.6, mh + 0.15, mz);
    for (let j = 0; j < 3; j++) { const a = j * Math.PI * 2 / 3; k.box(0.32, 0.025, 0.025, M.plasticDark, Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16, sc.cups).rotation.y = -a; k.sphere(0.06, M.plasticDark, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, sc.cups); }
    sc.mastVane = k.group(null, mx, mh + 0.25, mz);
    k.box(0.9, 0.2, 0.025, M.plasticRed, -0.35, 0, 0, sc.mastVane);
    k.pickable(sc.cups, 'Ölçüm direği (anemometre + rüzgâr gülü)', () => { const r = app.validResult; return ['h_ref = ' + s.href + ' m · v_ref = ' + fmt(v10Now(s, app.live), 1) + ' m/s', r ? 'Ön türbin göbeğinde: ' + fmt(r.values.vHub, 2) + ' m/s (α = ' + s.alpha + ')' : '', 'Yatırım için en az 1 yıl ölçüm gerekir']; });
    sc.mastLabel = k.label('Ölçüm direği', null, [mx, mh + 3, mz], 'vs-label--sm');
    // ---- rüzgâr yön oku ve çizgileri
    sc.arrow = k.group(null, 0, d.hub + d.Rt + 16 * d.sF + 6, 0);
    const arrowMat = new T.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.6, roughness: 0.4, transparent: true, opacity: 0.85 });
    const shaftA = k.cyl(0.9 * d.sF + 0.3, 0.9 * d.sF + 0.3, 26 * d.sF + 8, arrowMat, 0, 0, 0, sc.arrow, 16); shaftA.rotation.z = Math.PI / 2;
    const head = k.cyl(0, 2.6 * d.sF + 0.8, 8 * d.sF + 3, arrowMat, -(13 * d.sF + 4) - (4 * d.sF + 1.5), 0, 0, sc.arrow, 20); head.rotation.z = Math.PI / 2;
    sc.windLabel = k.label('Rüzgâr', sc.arrow, [0, 3 * d.sF + 2, 0]);
    const NSTR = k.quality === 'low' ? 50 : 90;
    sc.streaks = new T.InstancedMesh(g.streak, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }), NSTR);
    sc.streaks.castShadow = false; sc.streaks.userData.noClip = true; v.root.add(sc.streaks);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    sc.str = []; sc.span = Math.max(220, d.D * 2.2);
    for (let i = 0; i < NSTR; i++) sc.str.push({ u: (rnd() - 0.5) * 2 * sc.span, w: (rnd() - 0.5) * 1.6 * sc.span, y: 12 + rnd() * (d.hub + d.Rt + 10), len: 6 + rnd() * 10 });
    // ---- trafo merkezi ve YG çıkışı
    const yard = k.group(null, SSX, 0, SSZ);
    k.box(46, 0.3, 32, M.gravel, 0, 0.15, 0, yard);
    for (let j = 0; j < 24; j++) { const p = j / 24 * 156; let x, z; if (p < 46) { x = -23 + p; z = -16; } else if (p < 78) { x = 23; z = -16 + p - 46; } else if (p < 124) { x = 23 - (p - 78); z = 16; } else { x = -23; z = 16 - (p - 124); } k.box(0.12, 2.4, 0.12, M.galv, x, 1.5, z, yard); }
    [-16, 16].forEach(z => k.box(46, 2.2, 0.04, M.galv, 0, 1.4, z, yard)); [-23, 23].forEach(x => k.box(0.04, 2.2, 32, M.galv, x, 1.4, 0, yard));
    const ptr = k.group(yard, 4, 0.3, 2);
    k.box(7, 4.2, 3.6, M.trafoPaint, 0, 2.4, 0, ptr);
    const fins = new T.InstancedMesh(g.box, M.trafoPaint, 20), dmf = new T.Object3D();
    for (let j = 0; j < 20; j++) { dmf.position.set(-3 + (j % 10) * 0.66, 2.2, j < 10 ? 2.3 : -2.3); dmf.scale.set(0.08, 3.2, 1.0); dmf.updateMatrix(); fins.setMatrixAt(j, dmf.matrix); }
    fins.castShadow = true; ptr.add(fins);
    for (let j = 0; j < 3; j++) { k.cyl(0.18, 0.26, 2.2, M.porcelainGrey, -2 + j * 2, 5.6, -0.8, ptr, 12); k.cyl(0.14, 0.2, 1.4, M.porcelainGrey, -2 + j * 2, 5.2, 1.0, ptr, 12); }
    const cons = k.cyl(0.6, 0.6, 3.6, M.trafoPaint, 0, 5.4, 1.6, ptr, 20); cons.rotation.z = Math.PI / 2;
    [-9, -3].forEach(gx => { k.box(0.5, 11, 0.5, M.galv, gx, 5.8, -6, yard); k.box(0.5, 11, 0.5, M.galv, gx, 5.8, 6, yard); k.box(0.5, 0.6, 12.5, M.galv, gx, 11, 0, yard); });
    const bld = k.group(yard, -12, 0.3, 9);
    k.box(13, 4.2, 6.5, M.wallPanel, 0, 2.1, 0, bld); k.box(13.6, 0.3, 7.1, M.roofSheet, 0, 4.35, 0, bld); k.box(1.2, 2.3, 0.08, M.plasticGrey, 3, 1.15, 3.27, bld);
    k.pickable(ptr, 'Trafo merkezi ' + fmt(s.mvKV, 1) + ' kV / YG', () => ssInfo(app), a => ssActions(a));
    sc.ssLabel = k.label('Trafo merkezi', ptr, [0, 8, 0]);
    // YG hat (iki direk, batıya)
    const hv = [[SSX - 9, SSZ], [SSX - 120, SSZ + 10], [SSX - 240, SSZ + 20]];
    hv.slice(1).forEach(p => { k.box(1.2, 26, 1.2, M.galv, p[0], 13 + hAt(p[0], p[1]), p[1]); k.box(1, 0.8, 14, M.galv, p[0], 24 + hAt(p[0], p[1]), p[1]); });
    sc.hvFlow = null;
    [-5, 0, 5].forEach((o, j) => {
      const pts = hv.map((p, q) => [p[0], (q ? 23.5 + hAt(p[0], p[1]) : 11), p[1] + o]);
      const w = k.tube([pts[0], [(pts[0][0] + pts[1][0]) / 2, pts[1][1] - 6, pts[0][2]], pts[1], [(pts[1][0] + pts[2][0]) / 2, pts[1][1] - 5, pts[1][2]], pts[2]], 0.12, M.alu, null, 80);
      if (j === 1) { sc.hvFlow = k.flow(w.userData.curve, 24, 0xfcd34d, 0.6); k.pickable(w, 'YG enerji iletim hattı (bağlantı noktası)', () => ssInfo(app), a => ssActions(a)); }
    });

    // kamera, gölge, kesit
    app.def.scene.bounds = [-d.L - 10, d.L + 10];
    const key = Math.round(d.hub / 10) + '|' + Math.round(d.D / 15);
    if (app._viewKey !== key) {
      app._viewKey = key;
      const H = d.hub + d.Rt;
      v.setView({ target: [-14, H * 0.6, -20], r: H * 1.42 + 30, theta: 0.62, phi: 1.36, limits: { rMin: 8, rMax: Math.max(2500, ext * 2), phiMin: 0.15, phiMax: 1.54 } });
    }
    v.setShadowBox(Math.max(140, d.hub + d.Rt + 60), 1400);
    v.sun.position.set(260, 420, 200); v.sun.target.position.set(-20, 0, -20);
  }

  /* ---------------------------------------------------------------- 3D bilgi ve eylemler */
  function turbineInfo(app) {
    const r = app.validResult, s = app.state; if (!r || !r.values.farm) return [];
    const v = r.values, t = fgType(s);
    return [t.name + ' · ' + fmt(t.Prated, 0) + ' kW · D ' + t.D + ' m · h ' + t.hub + ' m', 'Durum: ' + REGION[v.region] + ' · ' + VS.fmtPower(v.P * 1000), 'Rotor ' + fmt(v.rpm, 1) + ' rpm · uç hızı ' + fmt(v.tip, 1) + ' m/s',
      'Yaw: ' + (s.yawMode === 'manual' ? 'elle ' + s.yawManual + '° · hata ' + fmt(Math.abs(v.yawErr), 0) + '° · güç ×' + fmt(v.yawF, 3) : 'otomatik'), '“Şeffaf kapak” ve patlatılmış görünüm iç donanımı gösterir'];
  }
  function turbineActions(app) {
    const s = app.state;
    const acts = [{ label: s.service ? 'Servis frenini bırak · yeniden başlat' : 'Servis freni · durdur', variant: s.service ? 'primary' : 'warn', onClick: a => { a.state.service = !a.state.service; VS.toast(a.state.service ? 'Türbin servis freniyle durduruldu.' : 'Türbin yeniden devreye alındı.'); } }];
    acts.push({ label: s.yawMode === 'manual' ? 'Yaw: otomatiğe al' : 'Yaw: elle', onClick: a => { a.state.yawMode = a.state.yawMode === 'manual' ? 'auto' : 'manual'; if (a.state.yawMode === 'manual') a.state.yawManual = Math.round(a.live.yaw); } });
    if (s.yawMode === 'manual') {
      acts.push({ label: 'Yaw −15°', onClick: a => { a.state.yawManual = (a.state.yawManual + 345) % 360; } });
      acts.push({ label: 'Yaw +15°', onClick: a => { a.state.yawManual = (a.state.yawManual + 15) % 360; } });
    }
    acts.push({ label: 'Tipi düzenle', onClick: a => { a.state.selType = a.state.strings[0] ? a.state.strings[0].type : 0; } });
    return acts;
  }
  function typeInfo(app, ti) {
    const r = app.validResult, s = app.state, t = s.types[ti]; if (!r || !t || !r.values.farm) return [];
    const tur = r.values.farm.turbines.filter(x => x.type === ti);
    return ['Föy: ' + fmt(t.Prated, 0) + ' kW · D ' + t.D + ' m · h ' + t.hub + ' m · v_n ' + t.vRated + ' m/s', 'Cut-in/out ' + t.cutIn + ' / ' + t.cutOut + ' m/s · ' + t.rpmMin + '–' + t.rpmMax + ' rpm', 'Türetilen Cp ' + fmt(X.cpFromDatasheet(t), 3),
      tur.length + ' türbin · toplam ' + MW(tur.reduce((a, x) => a + x.P, 0)) + ' · en yavaş ' + fmt(Math.min.apply(null, tur.map(x => x.v)), 1) + ' m/s'];
  }
  function stringInfo(app, si) {
    const r = app.validResult, s = app.state, x = s.strings[si]; if (!r || !x || !r.values.farm) return [];
    const st = r.values.farm.strings[si];
    return [x.n + ' × ' + typeOf(s, x.type).name, 'Güç ' + MW(st.P) + ' · akım ' + fmt(st.I, 0) + ' A @ ' + fmt(s.mvKV, 1) + ' kV', 'Kablo ' + s.cableS + ' mm² Al (≈ ' + MV_AMP[s.cableS] + ' A) · dönüş hattı ' + fmt(s.homeKm, 1) + ' km', 'Kayıp: kablo ' + fmt(st.cableLoss, 1) + ' kW · trafolar ' + fmt(st.trafoLoss, 1) + ' kW'];
  }
  function stringActions(app, si) {
    return [{ label: '+1 türbin', onClick: a => { a.state.strings[si].n++; } }, { label: '−1 türbin', onClick: a => { if (a.state.strings[si].n > 1) a.state.strings[si].n--; } }, { label: 'Diziyi düzenle', onClick: a => { a.state.selString = si; } }];
  }
  function ssInfo(app) {
    const r = app.validResult, s = app.state; if (!r || !r.values.farm) return [];
    const f = r.values.farm;
    return ['Trafo ' + s.ssMVA + ' MVA · yüklenme %' + fmt(f.ssLoading * 100, 0), 'Bağlantı noktası gücü: ' + MW(f.poi) + (s.curtail > 0 ? ' (sınır ' + s.curtail + ' MW, kısılan ' + MW(f.curtailed) + ')' : ''), 'TM kaybı ' + fmt(f.lossSS, 0) + ' kW', 'Bağlantı ve güç sınırı şebeke işletmecisi görüşüne bağlıdır'];
  }
  function ssActions(app) {
    const s = app.state, cap = Math.ceil(s.strings.reduce((a, x) => a + x.n * typeOf(s, x.type).Prated, 0) / 1000);
    return [{ label: 'Sınır −5 MW', onClick: a => { a.state.curtail = Math.max(0.5, (a.state.curtail > 0 ? a.state.curtail : cap) - 5); } }, { label: 'Sınır +5 MW', onClick: a => { a.state.curtail = a.state.curtail > 0 ? a.state.curtail + 5 : 0; } }, { label: 'Sınırı kaldır', onClick: a => { a.state.curtail = 0; } }];
  }

  /* ---------------------------------------------------------------- sahne güncelleme ve animasyon */
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc || !res.values.farm) return;
    const v = res.values, f = v.farm;
    sc.nacLabel.set(VS.fmtPower(v.P * 1000) + ' · ' + fmt(v.rpm, 1) + ' rpm · ' + REGION[v.region]);
    sc.nacLabel.level(v.region === 'stop' || v.region === 'climate' ? 'bad' : v.region === 'idle' || v.region === 'service' || v.region === 'hyst' ? 'warn' : 'ok');
    sc.windLabel.set('Rüzgâr ' + fmt(v.vHub, 1) + ' m/s · ' + s.windDir + '° (' + compass(s.windDir) + ')');
    sc.windLabel.level(v.vHub >= fgType(s).cutOut ? 'bad' : '');
    sc.ssLabel.set('TM · POI ' + MW(f.poi) + (f.curtailed > 1 ? ' (sınırlı)' : ''));
    sc.ssLabel.level(f.curtailed > 1 ? 'warn' : '');
    sc.mastLabel.set('Ölçüm ' + s.href + ' m · ' + fmt(v10Now(s, live), 1) + ' m/s');
    sc.strLabels.forEach((l, i) => { const st = f.strings[i]; if (st && s.strings[i]) { l.set(s.strings[i].name + ' · ' + MW(st.P)); l.level(st.I > (MV_AMP[s.cableS] || 0) ? 'bad' : ''); } });
    sc.cables.forEach(c => { const st = f.strings[c.si], x = s.strings[c.si]; c.flow.speed = st && st.P > 0 ? 0.01 + 0.08 * st.P / (x.n * typeOf(s, x.type).Prated) : 0; });
    if (sc.hvFlow) sc.hvFlow.speed = f.poi > 0 ? 0.02 + 0.2 * f.poi / Math.max(1, v.Pplanned) : 0;
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc || !res.values.farm) return false;
    const v = res.values, d = sc.d, f = v.farm, t0 = fgType(s), rm = k.reducedMotion;
    let moving = false;
    const tau = v.rpm > live.rpmVis ? 4 : 5;
    live.rpmVis += (v.rpm - live.rpmVis) * Math.min(1, dt / tau);
    if (live.rpmVis < 0.02 && v.rpm === 0) live.rpmVis = 0;
    live.rotAng -= live.rpmVis * Math.PI * 2 / 60 * (rm ? 0 : dt);
    if (sc.rotor.rotation.x !== live.rotAng) { sc.rotor.rotation.x = live.rotAng; moving = true; }
    const pt = visPitch(t0, Object.assign({}, f.turbines[0], { region: v.region === 'hyst' || v.region === 'climate' ? 'stop' : v.region })), dp = pt - live.pitch;
    if (Math.abs(dp) > 1e-6 && dt > 0) { live.pitch += Math.sign(dp) * Math.min(Math.abs(dp), 8 * dt); moving = true; }
    sc.blades.forEach(b => { b.rotation.y = live.pitch * Math.PI / 180; });
    sc.pitchLabel.set('Kanat açısı ~' + fmt(live.pitch, 0) + '° (temsili)' + (v.region === 'rated' ? ' · Cp gereken ' + fmt(v.cpReq, 3) : ''));
    const target = s.yawMode === 'manual' ? s.yawManual : s.windDir;
    const e = X.angleDiff(target, live.yaw);
    if (Math.abs(e) > 1e-6 && dt > 0) { live.yaw = (live.yaw + Math.sign(e) * Math.min(Math.abs(e), YAW_RATE * dt) + 360) % 360; moving = true; }
    const yawRad = Math.PI / 2 - live.yaw * Math.PI / 180, windRad = Math.PI / 2 - s.windDir * Math.PI / 180;
    sc.yaw.rotation.y = yawRad;
    sc.arrow.rotation.y = windRad; sc.mastVane.rotation.y = windRad;
    const cupW = v10Now(s, live) * 0.9 * dt;
    if (!rm && cupW) { sc.cups.rotation.y -= cupW; moving = true; }
    sc.vane.rotation.y = (s.windDir - live.yaw) * Math.PI / 180;
    live.blink += dt;
    const bm = rm || (live.blink % 1.5) < 0.75 ? k.mats.ledRed : k.mats.ledOff;
    if (sc.beacon.material !== bm) { sc.beacon.material = bm; moving = true; }
    if (Math.abs(e) > 3) sc.nacLabel.set(VS.fmtPower(v.P * 1000) + ' · yönleniyor (' + fmt(Math.abs(e), 0) + '°)');
    // rüzgâr çizgileri
    const fx = -Math.cos(windRad), fz = Math.sin(windRad), dm = sc._dm || (sc._dm = new k.T.Object3D());
    sc.streaks.visible = !rm && v.vHub > 0.3;
    if (sc.streaks.visible && dt > 0) {
      moving = true;
      sc.str.forEach((p, i) => {
        const sp = v.vHub * Math.pow(Math.max(p.y, 2) / d.hub, s.alpha);
        p.u += sp * dt * 1.5; if (p.u > sc.span) p.u -= 2 * sc.span;
        dm.position.set(fx * p.u - fz * p.w, p.y, fz * p.u + fx * p.w); dm.rotation.set(0, Math.atan2(-fz, fx), 0);
        dm.scale.set(p.len * (0.5 + Math.min(1.5, sp / 10)), 0.18, 0.18); dm.updateMatrix(); sc.streaks.setMatrixAt(i, dm.matrix);
      });
      sc.streaks.instanceMatrix.needsUpdate = true;
    }
    // diğer türbinler: park modelindeki kendi hızlarıyla; ≤30 Hz ve yalnız bir şey değişince (duran parkta tampon yüklenmez)
    const yawAll = Math.PI / 2 - (s.windDir) * Math.PI / 180;
    sc._bgT = (sc._bgT || 0) + dt;
    if (sc._bgT < 1 / 30 && sc._bgYaw === yawAll) return moving;
    const bdt = sc._bgT; sc._bgT = 0;
    sc.sets.forEach(set => {
      let chg = sc._bgYaw !== yawAll || !set._done;
      set.list.forEach(o => {
        const tur = f.turbines[o.i]; if (!tur) return;
        const ty = s.types[set.ti]; if (!ty) return;
        const want = visRpm(ty, s, tur), pw = visPitch(ty, tur);
        if (sc.rpm[o.i] > 1e-3 || Math.abs(want - sc.rpm[o.i]) > 1e-3 || Math.abs(pw - sc.pitch[o.i]) > 1e-3) chg = true;
      });
      if (!chg) return;
      set._done = true; moving = true;
      const c = set.chain, tg = set.tg, ty = s.types[set.ti]; if (!ty) return;
      set.list.forEach((o, q) => {
        const tur = f.turbines[o.i]; if (!tur) return;
        const want = visRpm(ty, s, tur);
        sc.rpm[o.i] += (want - sc.rpm[o.i]) * Math.min(1, bdt / 4);
        if (want === 0 && sc.rpm[o.i] < 0.02) sc.rpm[o.i] = 0;
        sc.ang[o.i] -= sc.rpm[o.i] * Math.PI * 2 / 60 * (rm ? 0 : bdt);
        const pw = visPitch(ty, tur), dpp = pw - sc.pitch[o.i];
        sc.pitch[o.i] += Math.sign(dpp) * Math.min(Math.abs(dpp), 8 * bdt);
        c[0].position.set(o.w[0], o.w[1] + tg.d.hub + 0.9, o.w[2]); c[0].rotation.set(0, yawAll, 0);
        c[2].rotation.set(sc.ang[o.i], 0, 0);
        c[5].position.set(-0.12 * tg.d.L, tg.d.Hn * 0.24, 0); c[0].updateMatrixWorld(true);
        set.nacTop.setMatrixAt(q, c[5].matrixWorld);
        c[5].position.set(-0.12 * tg.d.L, -tg.d.Hn * 0.27, 0); c[5].updateMatrixWorld(true);
        set.nacLow.setMatrixAt(q, c[5].matrixWorld);
        set.spin.setMatrixAt(q, c[2].matrixWorld);
        for (let j = 0; j < 3; j++) { c[3].rotation.set(j * Math.PI * 2 / 3, 0, 0); c[4].rotation.set(0, sc.pitch[o.i] * Math.PI / 180, 0); c[3].updateMatrixWorld(true); set.blade.setMatrixAt(q * 3 + j, c[4].matrixWorld); }
      });
      set.nacTop.instanceMatrix.needsUpdate = true; set.nacLow.instanceMatrix.needsUpdate = true; set.spin.instanceMatrix.needsUpdate = true; set.blade.instanceMatrix.needsUpdate = true;
    });
    sc._bgYaw = yawAll;
    return moving;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması (kaydırılabilir) */
  const HEAD = 150, ROW = 46;
  function clip(g, text, w) {
    if (g.measureText(text).width <= w) return text;
    let t = text; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
  }
  function view2dHeight(W, res, s) { return HEAD + s.strings.length * ROW + 120; }
  function view2d(g, W, H, res, s, live) {
    const v = res.values, f = v.farm; if (!f) return;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', amber: '#fcd34d', cyan: '#38bdf8' };
    g.lineWidth = 2; g.textBaseline = 'alphabetic';
    const x0 = 16, x1 = W - 66;
    // şebeke → YG → trafo merkezi → OG bara
    const bx = x0 + 34;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(bx - 14, 62); g.lineTo(bx + 14, 62); g.moveTo(bx, 62); g.lineTo(bx, 74); g.stroke();
    g.beginPath(); g.arc(bx, 86, 12, 0, Math.PI * 2); g.arc(bx, 104, 12, 0, Math.PI * 2); g.stroke();
    g.font = '12px Inter, sans-serif'; g.textAlign = 'left'; g.fillStyle = col.text;
    const tx = bx + 22, tw = x1 - tx;
    g.fillText(clip(g, 'Şebeke · POI ' + MW(f.poi) + (s.curtail > 0 ? ' (sınır ' + s.curtail + ' MW, kısılan ' + MW(f.curtailed) + ')' : ''), tw), tx, 70);
    g.fillStyle = col.dim; g.fillText(clip(g, 'Trafo merkezi ' + s.ssMVA + ' MVA · ' + fmt(s.mvKV, 1) + ' kV / YG · yüklenme %' + fmt(f.ssLoading * 100, 0) + ' · kayıp ' + fmt(f.lossSS, 0) + ' kW', tw), tx, 92);
    g.fillText(clip(g, 'Türbinler ' + MW(f.Pturb) + ' · iz kaybı %' + fmt(f.wakeLoss * 100, 1) + ' · trafo ' + fmt(f.lossTrafo, 0) + ' kW · kablo ' + fmt(f.lossCable, 0) + ' kW', tw), tx, 112);
    const busY = HEAD - 14;
    g.beginPath(); g.moveTo(bx, 116); g.lineTo(bx, busY); g.stroke();
    g.lineWidth = 5; g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(bx, busY); g.lineTo(bx, HEAD + s.strings.length * ROW - ROW / 2); g.stroke(); g.lineWidth = 2;
    // diziler: her biri kendi satırında; türbin simgeleri sığdığı kadar, fazlası "… ×n"
    const Iz = MV_AMP[s.cableS] || 0;
    s.strings.forEach((x, i) => {
      const y = HEAD + i * ROW, st = f.strings[i], ty = typeOf(s, x.type);
      const lv = st.I > Iz ? col.bad : st.P > 0 ? col.ok : col.dim;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + 18, y); g.stroke();
      g.strokeStyle = lv; g.beginPath(); g.moveTo(bx + 18, y); g.lineTo(bx + 30, y - 7); g.stroke();      // kesici
      g.strokeStyle = st.P > 0 ? col.amber : col.line; g.setLineDash(st.P > 0 ? [5, 4] : []); g.lineDashOffset = -((live.blink || 0) * 10 % 9);
      const ls = bx + 34, le = x1 - 6;
      g.beginPath(); g.moveTo(ls, y); g.lineTo(le, y); g.stroke(); g.setLineDash([]);
      const avail = le - ls - 20, per = 22, fit = Math.max(1, Math.floor(avail / per)), shown = Math.min(x.n, fit);
      const tur = f.turbines.filter(t => t.s === i);
      for (let j = 0; j < shown; j++) {
        const jj = shown < x.n && j === shown - 1 ? x.n - 1 : j, t = tur[jj];
        const cx = ls + 14 + j * Math.min(per, avail / Math.max(1, shown - 1 || 1));
        g.fillStyle = '#0b1a30'; g.beginPath(); g.arc(cx, y, 7, 0, Math.PI * 2); g.fill();
        g.strokeStyle = t && t.P > 0 ? col.ok : t && (t.region === 'stop' || t.region === 'service') ? col.bad : col.dim; g.beginPath(); g.arc(cx, y, 7, 0, Math.PI * 2); g.stroke();
        if (shown < x.n && j === shown - 2) { g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('…', cx + per / 2, y + 3); }
      }
      g.textAlign = 'left'; g.font = '11px Inter, sans-serif'; g.fillStyle = col.text;
      g.fillText(clip(g, x.name + ' · ' + x.n + ' × ' + ty.name, (le - ls) * 0.55), ls, y + 20);
      g.fillStyle = lv; g.textAlign = 'right';
      g.fillText(clip(g, MW(st.P) + ' · ' + fmt(st.I, 0) + ' A' + (st.I > Iz ? ' > ' + Iz + ' A' : ''), (le - ls) * 0.43), le, y + 20);
    });
    // özet
    const yy = HEAD + s.strings.length * ROW + 16;
    g.textAlign = 'left'; g.font = 'bold 12px Inter, sans-serif'; g.fillStyle = col.text;
    g.fillText(clip(g, 'Ön türbin: ' + REGION[v.region] + ' · ' + VS.fmtPower(v.P * 1000) + ' · v_hub ' + fmt(v.vHub, 1) + ' m/s', x1 - x0), x0, yy);
    g.font = '12px Inter, sans-serif'; g.fillStyle = col.dim;
    g.fillText(clip(g, 'Yıllık net ' + VS.fmtEnergy(v.aepF.net) + ' · KF %' + fmt(v.cf * 100, 1) + ' · iz %' + fmt(v.aepF.wakeLoss * 100, 1) + ' (varsayımsal)', x1 - x0), x0, yy + 20);
    g.fillText(clip(g, 'P = ½·ρ·A·Cp·v³·η · Betz Cp ≤ 16/27 · Jensen k = ' + s.wakeK, x1 - x0), x0, yy + 40);
  }

  /* ---------------------------------------------------------------- senaryolar ve görevler */
  const st = o => Object.assign(defaults(), o);
  const strong = { v10: 10 };
  VS.register({
    id: 'res', title: '3D RES / Rüzgâr Enerjisi Simülasyonu',
    defaults: defaults,
    initLive: s => ({ rpmVis: 0, rotAng: 0, pitch: 0, yaw: s.windDir, blink: 0, acc: 0, v10g: NaN, tsT: 0, tsDone: false, cut: { stopped: false, below: 0 } }),
    autoRun: true,
    startText: 'Simülasyon çalışıyor: rotorlar park modelindeki hızlarına yaklaşıyor.',
    start: app => { app.live.tsT = 0; app.live.tsDone = false; app.live.cut = { stopped: false, below: 0 }; app._startedOnce = true; },
    scenarios: [
      { id: 'partial', name: 'Kısmi yük · 12 × 3,6 MW, iki dizi', desc: 'Göbekte ~9,7 m/s; güç v³ ile artar. Dizi güçleri grafiğinde iz etkisini izleyin.', state: st({}) },
      { id: 'rated', name: 'Nominal bölge · güçlü rüzgâr', desc: 'Göbek hızı nominal hızın üstünde: güç sınırlanır, gereken Cp düşer.', state: st(strong) },
      { id: 'storm', name: 'Fırtına saati · cut-out ve histerezis', desc: 'Sentetik fırtına serisi: türbin cut-out’a girer, yeniden devreye girme eşiği altında bekler.', state: st({ ts: true, tsMean: 21, tsTI: 16, seed: 3 }), start: true },
      { id: 'wakeRow', name: 'Rüzgâr dizi boyunca · yoğun iz', desc: 'Rüzgâr dizi eksenine paralel (280°): arkadaki türbinler belirgin yavaşlar.', state: st({ windDir: 100, v10: 6.5 }) },
      { id: 'mixed', name: 'Karma park · 3 tip, 4 dizi', desc: 'Farklı föylere sahip türbinler; dizi başına kablo akımı ve kayıplar.', state: st({ types: [lib('t36'), lib('t45'), lib('t20')], strings: [{ name: 'Dizi A', type: 0, n: 6 }, { name: 'Dizi B', type: 1, n: 5 }, { name: 'Dizi C', type: 2, n: 8 }, { name: 'Dizi D', type: 1, n: 5 }], ssMVA: 100, cableS: 300 }) },
      { id: 'highland', name: 'Yüksek rakım · düşük hava yoğunluğu', desc: '1800 m ve 5 °C: ρ düşer; güç eğrisi sağa kayar (IEC 61400-12-1 düzeltmesi).', state: st({ alt: 1800, T: 5, v10: 7.5, alpha: 0.2 }) },
      { id: 'big', name: 'Büyük park · 60 × 6 MW, 6 dizi', desc: '360 MW kurulu güç, OG toplama ve trafo merkezi yüklenmesi.', state: st({ types: [lib('t60')], strings: [0, 1, 2, 3, 4, 5].map(i => ({ name: 'Dizi ' + String.fromCharCode(65 + i), type: 0, n: 10 })), cableS: 630, mvKV: 34.5, ssMVA: 400, homeKm: 8 }) },
      { id: 'small', name: 'Küçük türbinler · 4 × 250 kW', desc: 'Yüksek devirli küçük türbinler, kısa kule.', state: st({ types: [lib('t025')], strings: [{ name: 'Dizi A', type: 0, n: 4 }], ssMVA: 2, cableS: 95, homeKm: 0.5, mvKV: 20 }) }
    ],
    tasks: [
      { id: 'rated', title: 'Nominal rüzgâr hızını bul', goal: 'Rüzgârı artırarak ön türbinin nominal güce ilk ulaştığı noktayı yakalayın: bölge “nominal” olsun, göbek hızı nominal hızı en çok 0,6 m/s aşsın.', hint: 'Güç eğrisi grafiğindeki dirsek noktası; rüzgâr hızını 0,1 m/s adımlarla artırın.',
        state: st({ v10: 5 }), check: (r, s) => r.values.region === 'rated' && r.values.vHub <= r.values.vRated + 0.6 },
      { id: 'hub', title: 'Göbek yüksekliğiyle üretimi artır', goal: 'Göbek yüksekliği 80 m olan parkın yıllık net üretimini 135 GWh’nin üstüne çıkarın (göbek ≤ 140 m, türbin sayısı 12).', hint: 'Türbin tipleri → göbek yüksekliği. Rüzgâr profili (α) ile yükseklik arttıkça ortalama hız artar.',
        state: st({ types: [Object.assign(lib('t36'), { hub: 80 })] }), check: (r, s) => s.types.every(t => t.hub <= 140) && total(s) === 12 && r.values.aepF.net >= 135e6 },
      { id: 'storm', title: 'Fırtınada durma–kalkma çevrimini azalt', goal: 'Sentetik fırtına saatinde türbin 24,5 m/s eşikle sürekli durup kalkıyor. Durma sayısını 2’ye ya da altına indirin, saatlik üretim 2,5 MWh’nin altına düşmesin (cut-out 25 m/s, seri sabit).', hint: 'Yeniden devreye girme hızını düşürün ve bekleme süresi ekleyin: histerezis gereksiz çevrimi önler.',
        state: st({ ts: true, tsMean: 20, tsTI: 16, seed: 3, restartV: 24.5, restartDelay: 0 }), start: true, check: (r, s) => !!r.values.ts && s.ts && s.tsMean === 20 && s.seed === 3 && r.values.ts.stops <= 2 && r.values.ts.energy >= 2500 && fgType(s).cutOut === 25 },
      { id: 'wake', title: 'İz kayıplarını aralıkla azalt', goal: 'Sık yerleştirilmiş parkta yıllık iz kaybını %4’ün altına indirin (12 türbin kalsın, iz hesabı açık).', hint: 'Yerleşim → dizi içi aralığı ve diziler arası aralığı büyütün (ör. 7–9 D).',
        state: st({ spacing: 2.5, rowGap: 3 }), check: (r, s) => s.wakeOn && total(s) === 12 && r.values.aepF.wakeLoss < 0.04 },
      { id: 'yaw', title: 'Nacelle’i rüzgâra hizala', goal: 'Elle yaw modunda nacelle rüzgârdan 40° sapmış. Güç çarpanını 0,98’in üstüne çıkarın.', hint: '3D’de nacelle’e tıklayın: “Yaw +15°/−15°” ya da “Yaw: otomatiğe al”.',
        state: st({ yawMode: 'manual', yawManual: 150 }), check: (r) => r.values.yawF >= 0.98 && r.values.P > 0 },
      { id: 'service', title: 'Servis sonrası yeniden devreye al', goal: 'Bakım bitti; servis freni uygulanmış ön türbini yeniden üretime alın.', hint: '3D’de kuleye veya nacelle’e tıklayın → “Servis frenini bırak”.',
        state: st({ service: true }), check: (r, s) => !s.service && r.values.P > 0 },
      { id: 'curtail', title: 'Şebeke işletmecisi sınırına uy', goal: 'Güçlü rüzgârda bağlantı noktası 30 MW ile sınırlandırıldı. Türbinleri durdurmadan POI gücünü 30 MW’a indirin.', hint: 'Diziler ve OG toplama → şebeke işletmecisi güç sınırı 30 MW; ya da 3D’de trafo merkezine tıklayın.',
        state: st(strong), check: (r, s) => s.curtail > 0 && r.values.farm.poi <= 30000 + 1 && r.values.farm.poi >= 29000 && !s.service }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: res => (res.values.region === 'stop' || res.values.region === 'hyst' ? { level: 'bad', text: REGION[res.values.region] } : res.values.region === 'climate' ? { level: 'bad', text: 'İklim duruşu' } : null),
    reportInputs: s => s.types.map((t, i) => ({ group: 'Türbin föyleri', label: (i + 1) + '. ' + t.name, value: fmt(t.Prated, 0) + ' kW · D ' + t.D + ' m · h ' + t.hub + ' m · ' + t.cutIn + '/' + t.vRated + '/' + t.cutOut + ' m/s · ' + t.rpmMin + '–' + t.rpmMax + ' rpm · η ' + t.etaMech + '×' + t.etaGen + ' · trafo ' + t.trafoKVA + ' kVA' }))
      .concat(s.strings.map((x, i) => ({ group: 'Diziler', label: (i + 1) + '. ' + x.name, value: x.n + ' × ' + typeOf(s, x.type).name }))),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-30, 30], background: 0xb3c8de },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
