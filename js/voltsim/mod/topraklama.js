/* VoltSim · 3D Topraklama ve Elektrik Güvenliği Simülasyonu
 * Hesap: VoltSimEngine.topraklama (Dwight çubuk/şerit, BS 7430 çubuk dizisi, IEEE 80 ağ direnci, Em/Es,
 * izin verilen dokunma/adım gerilimi, TT/TN/IT koşulları) + VoltSimEngine.ext.topraklama (yaklaşık yüzey potansiyeli,
 * halka/temel elektrot, Wenner ve potansiyel düşümü ölçümleri, malzeme kesiti, OG/AG topraklama birleştirme).
 * Sahne: kesitli toprak bloğu, elektrotlar, trafo köşkü, eşpotansiyel bağlantılar ve ölçü aletleri; ekipmana tıklayarak
 * çubuk eklenir/çıkarılır, çakıl serilir, bağlantılar yapılır, ölçüm probları taşınır. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const G = E.topraklama, TC = E.ext.topraklama;
  const ROD_TOP = TC.ROD_TOP;
  const KW = 3.2, KD = 2.4; // köşk taban ölçüleri (m)

  function defaults() {
    return {
      rho: 150, season: 1, rhoS: 3000, hs: 0.1,
      electrode: 'rod', L: 3, d: 0.02, n: 3, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5, ringOff: 1,
      material: 'cuSteel', section: 90,
      system: 'TT', IdN_mA: 300, UL: 50, IF: 150, tf: 0.5, mvlv: 'common',
      bondPipe: true, bondSteel: true, bondTray: true,
      soilRho1: 150, soilRho2: 150, soilH: 2, wennerA: 3, fopD: 40, fopX: 50
    };
  }
  const EL_NAME = { rod: 'Düşey çubuk', strip: 'Yatay şerit', mesh: 'Topraklama ağı', ring: 'Halka elektrot', found: 'Temel topraklaması' };
  const SEASON = [[1, 'Ölçüm koşulu (nemli toprak) ×1'], [1.3, 'Kuru yaz ×1,3'], [1.6, 'Çok kuru / donlu ×1,6']];
  const WENNER_A = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

  /* ---------------------------------------------------------------- yerleşim */
  function ringGeom(s, st) {
    const off = s.electrode === 'found' ? 0 : s.ringOff;
    return { cx: st.kx, cz: st.kz, a: KW + 2 * off, b: KD + 2 * off };
  }
  function extent(s) {
    if (s.electrode === 'rod') return (Math.round(s.n) - 1) * s.s / 2 + 1;
    if (s.electrode === 'strip') return s.Lstrip / 2;
    if (s.electrode === 'mesh') return Math.sqrt(s.meshA) / 2;
    return 2.6 + (KW / 2 + (s.electrode === 'found' ? 0 : s.ringOff));
  }
  function siteOf(s) {
    const ext = extent(s), ringy = s.electrode === 'ring' || s.electrode === 'found';
    const Gh = E.clamp(ext + 5.5, 8.5, 40);
    const kx = ringy ? -2.6 : -Math.max(2.4, Math.min(ext * 0.45, 8)), kz = ringy ? -2.6 : -Math.max(2.5, Math.min(ext * 0.35, 6));
    const st = { ext: ext, Gh: Gh, kx: kx, kz: kz, aebX: kx + 1.25, aebZ: kz + KD / 2 + 0.03, touch: { x: kx + 0.55, z: kz + KD / 2 + 1.0 } };
    if (s.electrode === 'rod') { const n = Math.round(s.n); let xr = Infinity; for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * s.s; if (x > -1e-9 && x < xr) xr = x; } st.step = { x: xr, z1: -0.5, z2: -1.5 }; }
    else if (s.electrode === 'strip') st.step = { x: Math.min(s.Lstrip * 0.25, 8), z1: -0.5, z2: -1.5 };
    else if (s.electrode === 'mesh') { const side = Math.sqrt(s.meshA); st.step = { x: Math.min(side * 0.12, 4), z1: -(side / 2 - 0.5), z2: -(side / 2 + 0.5) }; }
    else { const rg = ringGeom(s, st); st.ring = rg; st.step = { x: kx - 1.0, z1: kz + rg.b / 2 - 0.5, z2: kz + rg.b / 2 + 0.5 }; }
    // ölçüm doğrultusu: elektrot merkezinden −z (halka/temelde +x)
    st.probe = ringy ? { x: kx, z: kz, dx: 1, dz: 0 } : { x: 0, z: 0, dx: 0.35, dz: -0.9368 };
    st.depth = s.electrode === 'rod' ? Math.max(ROD_TOP + s.L + 1.2, 3.2) : 3.2;
    return st;
  }

  /* ---------------------------------------------------------------- hesap
   * Tasarım özdirenci ρ × mevsim katsayısı motora verilir. Halka/temel elektrotta R, Dwight halka bağıntısıyla
   * (ext.topraklama.ring) bulunur ve motor kontrolleri bu R ile yeniden değerlendirilir. */
  function compute(s) {
    const rhoEff = s.rho * (s.season || 1);
    const st = siteOf(s), ringy = s.electrode === 'ring' || s.electrode === 'found';
    const eng = Object.assign({}, s, { rho: rhoEff });
    let res;
    if (ringy) {
      const rg = st.ring;
      res = G.compute(Object.assign({}, eng, { electrode: 'strip', Lstrip: 2 * (rg.a + rg.b) }));
      if (res.ok) res = TC.withR(res, TC.ring(rhoEff, TC.ringD(rg.a, rg.b), s.w / 2, s.h), eng);
    } else res = G.compute(eng);
    if (!res.ok) return res;
    const v = res.values;
    const pot = TC.surfacePotential(TC.conductors(Object.assign({}, s, { ring: st.ring }), v), rhoEff, v.R);
    const vt = pot(st.touch.x, st.touch.z);
    const s1 = pot(st.step.x, st.step.z1), s2 = pot(st.step.x, st.step.z2);
    const along = d => pot(st.probe.x + st.probe.dx * d, st.probe.z + st.probe.dz * d);
    const rhoA = TC.wennerApparent(s.soilRho1, s.soilRho2, s.soilH, s.wennerA);
    const Rw = TC.wennerR(rhoA, s.wennerA);
    const fx = s.fopX / 100 * s.fopD, Rm = TC.fallOfPotential(v.R, rhoEff, s.fopD, fx, along);
    const mat = TC.materialCheck(s.material, s.electrode === 'rod' ? 'rod' : 'strip', s.electrode === 'rod' ? s.d * 1000 : s.section);
    const unb = [s.bondPipe ? null : 'metal su borusu', s.bondSteel ? null : 'çelik konstrüksiyon', s.bondTray ? null : 'kablo tavası'].filter(Boolean);
    const mv = TC.mvlvCheck(s.mvlv, v.GPR, v.Etouch, s.tf);
    res.x = { rhoEff: rhoEff, pot: pot, along: along, site: st, touch: v.GPR * (1 - vt), step: v.GPR * Math.abs(s1 - s2),
      wenner: { a: s.wennerA, rhoA: rhoA, R: Rw, rho: TC.wennerRho(s.wennerA, Rw) }, fop: { D: s.fopD, x: fx, R: Rm, err: (Rm - v.R) / v.R }, mat: mat, unbonded: unb, mv: mv };
    const ck = (id, label, status, detail, ref) => res.checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    if ((s.season || 1) > 1) ck('season', 'Mevsim katsayısı', 'info', 'Tasarım özdirenci ' + fmt(s.rho, 0) + ' × ' + fmt(s.season, 1) + ' = ' + fmt(rhoEff, 0) + ' Ω·m (kuru dönem için tasarım payı; yerel ölçüm geçmişiyle doğrulanmalı).');
    if (ringy) ck('ring', EL_NAME[s.electrode], 'info', 'Dwight halka bağıntısı, eşit çevreli daire (D = ' + fmt(TC.ringD(st.ring.a, st.ring.b), 2) + ' m)' + (s.electrode === 'found' ? '; temel betonunun özdirenci ihmal edildi (yaklaşık).' : '.'));
    ck('mat', 'Elektrot malzemesi ve kesiti', mat.ok ? 'ok' : 'fail', mat.label + ': ' + fmt(s.electrode === 'rod' ? s.d * 1000 : s.section, 0) + ' ' + mat.unit + ' (asgari ' + mat.min + ' ' + mat.unit + '; ' + mat.note + '). Özet değerdir; güncel tabloyla doğrulayın.', 'TS HD 60364-5-54 Tablo 54.1');
    ck('bond', 'Koruyucu eşpotansiyel bağlantı', unb.length ? 'fail' : 'ok', unb.length ? 'Bağlanmamış: ' + unb.join(', ') + '. Arızada bu parçalar uzak toprak potansiyelinde kalır; köşk gövdesiyle aralarında ≈ GPR = ' + fmt(v.GPR, 0) + ' V dokunma gerilimi oluşabilir.' : 'Metal boru, çelik konstrüksiyon ve kablo tavası AEB’ye bağlı.', 'TS HD 60364-4-41 411.3.1.2');
    if (s.IF > 0) ck('mvlv', 'OG/AG topraklama birleştirme · ' + (s.mvlv === 'common' ? 'ortak' : 'ayrı'), mv.ok ? 'ok' : 'fail', mv.text + ': GPR = ' + fmt(v.GPR, 0) + ' V, sınır ' + fmt(mv.limit, 0) + ' V. Basitleştirilmiş ölçüt; ayrı topraklamada elektrotlar arası mesafe ve aktarılan potansiyel ayrıca incelenir.', 'TS HD 60364-4-442 · Topraklamalar Yönetmeliği');
    return res;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);
  const fmtV = V => (Math.abs(V) >= 1e4 ? fmt(V / 1e3, 1, 'kV') : fmt(V, 0, 'V'));
  const touchOf = (s, r) => (s.electrode === 'mesh' ? r.values.Em : r.x.touch);
  const stepOf = (s, r) => (s.electrode === 'mesh' ? r.values.Es : r.x.step);

  /* ---------------------------------------------------------------- 3D eylemleri */
  function electrodeActions(app) {
    const s = app.state, A = [];
    if (s.electrode === 'rod') {
      A.push({ label: '+ Çubuk ekle', variant: 'primary', onClick: a => { a.state.n = Math.min(10, Math.round(a.state.n) + 1); } });
      if (s.n > 1) A.push({ label: '− Çubuk çıkar', onClick: a => { a.state.n = Math.max(1, Math.round(a.state.n) - 1); } });
      A.push({ label: 'Çubukları uzat (+1,5 m)', onClick: a => { a.state.L = Math.min(12, a.state.L + 1.5); } });
    } else if (s.electrode === 'strip') {
      A.push({ label: 'Şeridi uzat (+10 m)', variant: 'primary', onClick: a => { a.state.Lstrip = Math.min(200, a.state.Lstrip + 10); } });
      A.push({ label: 'Şeridi kısalt (−10 m)', onClick: a => { a.state.Lstrip = Math.max(5, a.state.Lstrip - 10); } });
    } else if (s.electrode === 'mesh') {
      A.push({ label: 'Gözü sıklaştır (D −1 m)', variant: 'primary', onClick: a => { a.state.meshD = Math.max(1, a.state.meshD - 1); } });
      A.push({ label: 'Gözü seyrelt (D +1 m)', onClick: a => { a.state.meshD = Math.min(20, a.state.meshD + 1); } });
    } else if (s.electrode === 'ring') {
      A.push({ label: 'Halkayı genişlet (+0,5 m)', variant: 'primary', onClick: a => { a.state.ringOff = Math.min(6, a.state.ringOff + 0.5); } });
      A.push({ label: 'Halkayı daralt (−0,5 m)', onClick: a => { a.state.ringOff = Math.max(0.5, a.state.ringOff - 0.5); } });
    } else A.push({ label: 'Halka elektroda geç', onClick: a => { a.state.electrode = 'ring'; } });
    return A;
  }
  const gravelAct = s => (s.hs > 0 ? { label: 'Çakılı kaldır', onClick: a => { a.state.hs = 0; } } : { label: 'Yüzeye 10 cm kırma taş ser (3000 Ω·m)', variant: 'primary', onClick: a => { a.state.hs = 0.1; a.state.rhoS = 3000; } });

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = app.validResult && app.validResult.x ? app.validResult : null;
    const groups = [];
    groups.push({ title: 'Toprak', items: [
      { type: 'range', key: 'rho', label: 'Tasarım özdirenci ρ', min: 10, max: 3000, step: 10, unit: 'Ω·m', help: 'Islak killi toprak 20–100, kumlu 200–1000, kayalık > 1000 Ω·m. Wenner ölçümünden girin (Ölçümler).' },
      { type: 'select', key: 'season', label: 'Mevsim katsayısı (tasarım)', options: SEASON },
      { type: 'range', key: 'hs', label: 'Yüzey tabakası kalınlığı (çakıl/asfalt)', min: 0, max: 0.3, step: 0.01, unit: 'm', digits: 2 },
      s.hs > 0 ? { type: 'select', key: 'rhoS', label: 'Yüzey tabakası özdirenci ρs', options: [[1000, '1000 Ω·m · nemli çakıl'], [3000, '3000 Ω·m · kuru kırma taş'], [5000, '5000 Ω·m · asfalt'], [10000, '10 000 Ω·m · kuru asfalt']] } : null
    ] });
    groups.push({ title: 'Elektrot', items: [
      { type: 'select', key: 'electrode', label: 'Elektrot tipi', options: Object.keys(EL_NAME).map(k => [k, EL_NAME[k]]), rebuild: true },
      s.electrode === 'rod' ? { type: 'range', key: 'n', label: 'Çubuk sayısı (sıra halinde)', min: 1, max: 10, step: 1 } : null,
      s.electrode === 'rod' ? { type: 'range', key: 'L', label: 'Çubuk boyu L', min: 1, max: 12, step: 0.5, unit: 'm', digits: 1 } : null,
      s.electrode === 'rod' && s.n > 1 ? { type: 'range', key: 's', label: 'Çubuk aralığı s', min: 1, max: 20, step: 0.5, unit: 'm', digits: 1, help: 'Karşılıklı etkiyi azaltmak için s ≥ L (tercihen 2L).' } : null,
      s.electrode === 'rod' ? { type: 'select', key: 'd', label: 'Çubuk çapı', options: [[0.014, '14 mm'], [0.016, '16 mm'], [0.02, '20 mm'], [0.025, '25 mm']] } : null,
      s.electrode === 'strip' ? { type: 'range', key: 'Lstrip', label: 'Şerit boyu', min: 5, max: 200, step: 1, unit: 'm' } : null,
      s.electrode === 'ring' ? { type: 'range', key: 'ringOff', label: 'Halkanın köşk duvarına uzaklığı', min: 0.5, max: 6, step: 0.5, unit: 'm', digits: 1, help: 'Potansiyel düzenleyici halka: köşk önündeki yüzey potansiyelini yükseltir, dokunma gerilimini azaltır.' } : null,
      s.electrode === 'mesh' ? { type: 'range', key: 'meshA', label: 'Ağ alanı A', min: 25, max: 2500, step: 25, unit: 'm²' } : null,
      s.electrode === 'mesh' ? { type: 'range', key: 'meshD', label: 'Göz aralığı D', min: 1, max: 20, step: 0.5, unit: 'm', digits: 1 } : null,
      s.electrode !== 'rod' ? { type: 'range', key: 'h', label: 'Gömme derinliği h', min: 0.3, max: 1.5, step: 0.05, unit: 'm', digits: 2 } : null,
      s.electrode !== 'rod' && s.electrode !== 'mesh' ? { type: 'select', key: 'w', label: 'Şerit genişliği', options: [[0.02, '20 mm'], [0.025, '25 mm'], [0.03, '30 mm'], [0.04, '40 mm']] } : null,
      { type: 'select', key: 'material', label: 'Malzeme', options: Object.keys(TC.MATERIALS).map(k => [k, TC.MATERIALS[k].label]) },
      s.electrode !== 'rod' ? { type: 'select', key: 'section', label: 'İletken kesiti', options: [25, 35, 50, 70, 90, 100, 120].map(v => [v, v + ' mm²']) } : null,
      r && s.electrode === 'mesh' ? { type: 'note', html: 'Ağ: <b>' + r.values.nMesh + ' × ' + r.values.nMesh + '</b> iletken · L<sub>T</sub> <b>' + fmt(r.values.LT, 0, 'm') + '</b>' } : null
    ] });
    groups.push({ title: 'Sistem tipi ve koruma', items: [
      { type: 'seg', key: 'system', label: 'AG sistem tipi', options: [['TT', 'TT'], ['TN', 'TN'], ['IT', 'IT']] },
      s.system !== 'TN' ? { type: 'select', key: 'IdN_mA', label: s.system === 'TT' ? 'Kaçak akım koruma IΔn' : 'İlk arıza akımı Id', options: [[30, '30 mA'], [100, '100 mA'], [300, '300 mA'], [500, '500 mA'], [1000, '1 A'], [3000, '3 A']] } : null,
      { type: 'select', key: 'UL', label: 'Sınır dokunma gerilimi UL', options: [[50, '50 V (normal ortam)'], [25, '25 V (ıslak / tarım)']] },
      { type: 'note', html: s.system === 'TT' ? 'TT: kabul ölçütü <b>RA·IΔn ≤ UL</b>. Ohm sınırı koruma cihazına bağlıdır: ' + [30, 300, 1000].map(i => i + ' mA → ' + fmt(s.UL / (i / 1000), 0) + ' Ω').join(', ') + '.'
        : s.system === 'TN' ? 'TN: arıza akımı PE üzerinden kaynağa döner; kabul ölçütü <b>Zs·Ia ≤ U0</b> (çevrim empedansı, Pano modülü). Elektrot direnci tek başına ölçüt değildir.'
          : 'IT: ilk arızada <b>RA·Id ≤ UL</b>; ikinci arızada TN/TT koşulları geçerlidir. Yalıtım izleme cihazı zorunludur.' },
      { type: 'seg', key: 'mvlv', label: 'OG ve AG topraklaması', options: [['common', 'Ortak'], ['separate', 'Ayrı']] }
    ] });
    groups.push({ title: 'Eşpotansiyel bağlantılar', items: [
      { type: 'toggle', key: 'bondPipe', label: 'Metal su borusu AEB’ye bağlı' },
      { type: 'toggle', key: 'bondSteel', label: 'Çelik konstrüksiyon AEB’ye bağlı' },
      { type: 'toggle', key: 'bondTray', label: 'Kablo tavası AEB’ye bağlı' }
    ] });
    groups.push({ title: 'Arıza (OG tarafı / GPR)', items: [
      { type: 'range', key: 'IF', label: 'Toprağa akan arıza akımı IF', min: 0, max: 3000, step: 10, unit: 'A', help: 'Elektrottan toprağa geçen kısım (OG nötr topraklama yöntemine ve dönüş yollarına bağlıdır).' },
      { type: 'range', key: 'tf', label: 'Arıza temizleme süresi tf', min: 0.05, max: 3, step: 0.05, unit: 's', digits: 2 },
      { type: 'note', text: 'Simülasyonu başlat: tf süreli arıza akımı darbesi uygulanır (yavaşlatılmış). Yüzey rengi yaklaşık potansiyel dağılımıdır; sayısal kabul kontrolleri hesap motorundandır.' }
    ] });
    groups.push({ title: 'Ölçümler', items: [
      { type: 'select', key: 'wennerA', label: 'Wenner elektrot aralığı a', options: WENNER_A.map(a => [a, fmt(a, a % 1 ? 1 : 0) + ' m']) },
      r ? { type: 'note', html: 'Wenner: R = <b>' + fmt(r.x.wenner.R, 2) + ' Ω</b> → ρ = 2πaR = <b>' + fmt(r.x.wenner.rho, 0) + ' Ω·m</b> (a ≈ çubuk boyu/elektrot derinliği için tasarıma alın)' } : null,
      { type: 'buttons', items: [{ label: 'Ölçülen ρ’yu tasarıma aktar', variant: 'primary', onClick: a => transferRho(a) }] },
      { type: 'range', key: 'fopD', label: 'Potansiyel düşümü · akım probu uzaklığı D', min: 10, max: 150, step: 5, unit: 'm' },
      { type: 'range', key: 'fopX', label: 'Gerilim probu konumu (D’nin yüzdesi)', min: 5, max: 95, step: 0.1, unit: '%', digits: 1 },
      r ? { type: 'note', html: 'Ölçülen R(%' + fmt(s.fopX, 1) + ') = <b>' + fmt(r.x.fop.R, 2) + ' Ω</b> · hesap R = ' + fmt(r.values.R, 2) + ' Ω · fark %' + fmt(r.x.fop.err * 100, 1) } : null,
      { type: 'note', text: 'Pens (clamp-on) döngü ölçer çok noktalı topraklamada tek elektrotu ayırmadan ölçer; dönüş yolu olmayan tek elektrotlu TT tesiste kullanılamaz (bilgi).' }
    ] });
    return groups;
  }
  function transferRho(a) { const x = a.validResult && a.validResult.x; if (x) { a.state.rho = Math.max(10, Math.min(3000, Math.round(x.wenner.rho))); a.live.events.push('Wenner ölçümü (a = ' + fmt(a.state.wennerA, 1) + ' m) tasarıma aktarıldı: ρ = ' + a.state.rho + ' Ω·m'); if (a.renderControls) { a.renderControls(); a.invalidate(); } } }

  /* ---------------------------------------------------------------- zaman davranışı: arıza darbesi */
  function start(app) {
    const s = app.state;
    app.live.fault = { t: 0, dur: E.clamp(s.tf * 4, 1.6, 8), done: false };
    app.live.events.push(s.IF > 0 ? 'IF = ' + fmt(s.IF, 0) + ' A arıza akımı uygulandı (tf = ' + fmt(s.tf, 2) + ' s).' : 'IF = 0 A: toprak potansiyel yükselmesi oluşmaz; arıza akımı girin.');
  }
  function tick(app, dt) {
    const f = app.live.fault; if (!f || f.done) return false;
    f.t += dt;
    if (f.t >= f.dur) { f.done = true; app.live.events.push('Arıza ' + fmt(app.state.tf, 2) + ' s sonra koruma tarafından temizlendi.'); }
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  const sysId = s => (s.system === 'TT' ? 'tt' : s.system === 'TN' ? 'tn' : 'it');
  const ACCEPT = {
    TT: 'TT: tüketici gövdeleri kendi elektroduna (RA) bağlı; arıza akımı topraktan döner ve küçüktür → RCD şart. Kabul: RA·IΔn ≤ UL (RA ölçülür).',
    TN: 'TN: gövdeler PE ile trafo nötrüne bağlı; arıza akımı metalik yoldan döner ve büyüktür → aşırı akım koruması açar. Kabul: Zs·Ia ≤ U0; RA tek başına ölçüt değil, ancak RB düşük tutulur.',
    IT: 'IT: nötr yalıtık/empedanslı; ilk arızada akım çok küçük, gerilim RA·Id ≤ UL ile sınırlanır; yalıtım izleme ilk arızayı bildirir, ikinci arızada TN/TT kuralları uygulanır.'
  };
  function readouts(res, s, live) {
    const v = res.values, x = res.x;
    const sysC = chk(res, sysId(s));
    const geo = s.electrode === 'rod' ? Math.round(s.n) + ' × ' + fmt(s.L, 1) + ' m' : s.electrode === 'strip' ? fmt(s.Lstrip, 0) + ' m' : s.electrode === 'mesh' ? fmt(s.meshA, 0) + ' m²' : fmt(x.site.ring.a, 1) + ' × ' + fmt(x.site.ring.b, 1) + ' m';
    const out = [
      { label: 'Topraklama direnci R', value: fmt(v.R, v.R < 10 ? 2 : 1, 'Ω'), sub: EL_NAME[s.electrode] + ' · ' + geo + ' · ρ ' + fmt(x.rhoEff, 0) + ' Ω·m' + ((s.season || 1) > 1 ? ' (mevsim ×' + fmt(s.season, 1) + ')' : '') },
      { label: 'RA sınırı (UL/IΔn)', value: fmt(v.RAmax, 0, 'Ω'), sub: s.system === 'TN' ? 'TN’de ölçüt değil' : 'UL ' + s.UL + ' V · ' + (s.system === 'TT' ? 'IΔn ' : 'Id ') + s.IdN_mA + ' mA', level: s.system === 'TN' ? undefined : (v.R <= v.RAmax ? 'ok' : 'bad') },
      { label: 'Kabul · ' + s.system, value: sysC ? (sysC.status === 'ok' ? 'Sağlanıyor' : sysC.status === 'fail' ? 'Sağlanmıyor' : sysC.status === 'warn' ? 'Uyarı' : 'Çevrim empedansına bağlı') : '—', level: lvOf(sysC), wide: true, sub: ACCEPT[s.system] + ' ' + (sysC ? sysC.detail : '') },
      { label: 'Toprak potansiyel yükselmesi GPR', value: fmtV(v.GPR), sub: 'IF ' + fmt(s.IF, 0) + ' A × R' },
      { label: 'OG/AG topraklama', value: s.IF > 0 ? (x.mv.ok ? 'Uygun' : 'Uygun değil') : '—', level: s.IF > 0 ? (x.mv.ok ? 'ok' : 'bad') : undefined, sub: (s.mvlv === 'common' ? 'ortak · sınır E_dokunma ' : 'ayrı · sınır ') + fmtV(x.mv.limit) },
      { label: 'İzin verilen dokunma', value: fmtV(v.Etouch), sub: 'IEEE 80 · 50 kg · tf ' + fmt(s.tf, 2) + ' s' + (s.hs > 0 ? ' · Cs ' + fmt(v.Cs, 2) : '') },
      { label: 'İzin verilen adım', value: fmtV(v.Estep), sub: s.hs > 0 ? 'yüzey ρs ' + fmt(s.rhoS, 0) + ' Ω·m · ' + fmt(s.hs * 100, 0) + ' cm' : 'yüzey tabakası yok' }
    ];
    if (s.electrode === 'mesh' && v.Em !== null) {
      out.push({ label: 'Ağ dokunma gerilimi Em', value: fmtV(v.Em), level: v.Em <= v.Etouch ? 'ok' : 'bad', sub: 'IEEE 80 (hesap motoru)' });
      out.push({ label: 'Ağ adım gerilimi Es', value: fmtV(v.Es), level: v.Es <= v.Estep ? 'ok' : 'bad', sub: 'IEEE 80 (hesap motoru)' });
    } else if (s.IF > 0) {
      out.push({ label: 'Dokunma ≈ (görsel model)', value: fmtV(x.touch), level: x.touch <= v.Etouch ? 'ok' : 'warn', sub: 'yaklaşık; motor GPR ≤ E_dokunma ile karşılaştırır' });
      out.push({ label: 'Adım ≈ (görsel model)', value: fmtV(x.step), level: x.step <= v.Estep ? 'ok' : 'warn', sub: 'insan konumunda, 1 m adım' });
    }
    out.push({ label: 'Wenner ölçümü (a = ' + fmt(s.wennerA, s.wennerA % 1 ? 1 : 0) + ' m)', value: fmt(x.wenner.rho, 0, 'Ω·m'), sub: 'R = ' + fmt(x.wenner.R, 2) + ' Ω → ρ = 2πaR' });
    out.push({ label: 'Potansiyel düşümü R(%' + fmt(s.fopX, 1) + ')', value: fmt(x.fop.R, 2, 'Ω'), level: Math.abs(x.fop.err) <= 0.03 ? 'ok' : 'warn', sub: 'D = ' + fmt(s.fopD, 0) + ' m · hesaba göre %' + fmt(x.fop.err * 100, 1) });
    out.push({ label: 'Malzeme / eşpotansiyel', value: (x.mat.ok ? 'Kesit uygun' : 'Kesit yetersiz') + ' · ' + (x.unbonded.length ? x.unbonded.length + ' bağlantı eksik' : 'bağlantılar tam'), level: x.mat.ok && !x.unbonded.length ? 'ok' : 'bad', wide: true, sub: x.mat.label + ' (asgari ' + x.mat.min + ' ' + x.mat.unit + ')' + (x.unbonded.length ? ' · eksik: ' + x.unbonded.join(', ') : '') });
    const f = live.fault;
    if (f) out.push({ label: 'Arıza darbesi', wide: true, value: !f.done ? 't = ' + fmt(Math.min(f.t / f.dur * s.tf, s.tf), 2) + ' / ' + fmt(s.tf, 2) + ' s · akım akıyor' : 'Temizlendi', level: !f.done ? 'warn' : undefined, sub: live.events.length ? live.events[live.events.length - 1] : '' });
    else if (live.events.length) out.push({ label: 'Son işlem', wide: true, value: live.events[live.events.length - 1] });
    return out;
  }

  function charts(res, s) {
    const v = res.values, x = res.x, f = x.pot, ch = [];
    const unitV = v.GPR > 0, k = unitV ? v.GPR : 100;
    // profil: ölçüm doğrultusunda elektrot merkezinden dışa
    const len = Math.max(18, x.site.ext + 12);
    const P = [], Ut = [], Us = [];
    for (let d = 0; d <= len + 1e-9; d += len / 120) {
      const p = x.along(d), p1 = x.along(d + 1);
      P.push([d, p * k]); Ut.push([d, (1 - p) * k]); Us.push([d, Math.abs(p - p1) * k]);
    }
    let iMax = 0; Us.forEach((p, i) => { if (p[1] > Us[iMax][1]) iMax = i; });
    ch.push({ id: 'prof', title: 'Yüzey potansiyeli ve dokunma gerilimi profili (yaklaşık)', height: 170,
      series: [{ name: 'Yüzey potansiyeli V(x)', color: 'cyan', area: true, data: P }, { name: 'Dokunma ≈ GPR − V(x)', color: 'amber', data: Ut }],
      hLines: unitV ? [{ y: v.Etouch, label: 'E_dokunma izin ' + fmtV(v.Etouch), color: '#ef4444' }] : [],
      x: { label: 'elektrot merkezinden m', min: 0, max: len }, y: { label: unitV ? 'V' : '% GPR', min: 0 },
      alt: 'GPR ' + fmtV(v.GPR) + '. Elektrot üzerinde potansiyel en yüksek, uzaklaştıkça azalır; dokunma gerilimi uzaklıkla artar. İzin verilen dokunma ' + fmtV(v.Etouch) + '. Normalize çizgi-kaynak modeli; sayısal kontroller motordan.' });
    ch.push({ id: 'step', title: 'Adım gerilimi profili (1 m, yaklaşık)', height: 140,
      series: [{ name: 'Adım ≈ V(x) − V(x + 1 m)', color: 'violet', area: true, data: Us }],
      hLines: unitV ? [{ y: v.Estep, label: 'E_adım izin ' + fmtV(v.Estep), color: '#ef4444' }] : [],
      markers: [{ x: Us[iMax][0], label: 'maks. ≈ ' + (unitV ? fmtV(Us[iMax][1]) : '%' + fmt(Us[iMax][1], 1)), color: '#fcd34d' }],
      x: { label: 'm', min: 0, max: len }, y: { label: unitV ? 'V' : '% GPR', min: 0 },
      alt: 'En büyük adım gerilimi ≈ ' + (unitV ? fmtV(Us[iMax][1]) : '%' + fmt(Us[iMax][1], 1) + ' GPR') + '; izin verilen ' + fmtV(v.Estep) + '.' });
    // R – tasarım parametresi (motor ve ek hesap yardımcılarıyla)
    const rho = x.rhoEff;
    let rs = [], xl, title, cur;
    if (s.electrode === 'rod') { for (let n = 1; n <= 10; n++) rs.push([n, G.rodsInLine(rho, s.L, s.d, n, s.s)]); xl = 'çubuk sayısı'; title = 'Topraklama direnci – çubuk sayısı (s = ' + fmt(s.s, 1) + ' m)'; cur = Math.round(s.n); }
    else if (s.electrode === 'strip') { for (let L = 5; L <= 200; L += 5) rs.push([L, G.strip(rho, L, s.h, s.w / 4)]); xl = 'şerit boyu m'; title = 'Topraklama direnci – şerit boyu'; cur = s.Lstrip; }
    else if (s.electrode === 'mesh') { const A = s.meshA, sd = Math.sqrt(A); for (let D = 1; D <= 20; D += 0.5) { const nm = Math.max(2, Math.round(sd / D) + 1); rs.push([D, G.mesh(rho, 2 * nm * sd, A, s.h)]); } xl = 'göz aralığı D m'; title = 'Ağ direnci – göz aralığı (A = ' + fmt(s.meshA, 0) + ' m²)'; cur = s.meshD; }
    else { for (let o = 0; o <= 6.0001; o += 0.5) rs.push([o, TC.ring(rho, TC.ringD(KW + 2 * o, KD + 2 * o), s.w / 2, s.h)]); xl = 'duvara uzaklık m'; title = 'Halka direnci – köşk duvarına uzaklık (0 = temel)'; cur = s.electrode === 'found' ? 0 : s.ringOff; }
    ch.push({ id: 'rn', title: title, height: 150,
      series: [{ name: 'R (Ω)', color: 'green', data: rs }],
      hLines: s.system !== 'TN' ? [{ y: v.RAmax, label: 'RA sınırı ' + fmt(v.RAmax, 0) + ' Ω', color: '#ef4444' }] : [],
      markers: [{ x: cur, y: v.R, label: fmt(v.R, 1) + ' Ω', color: '#fcd34d' }],
      x: { label: xl }, y: { label: 'Ω', min: 0, max: Math.max.apply(null, rs.map(p => p[1])) * 1.1 },
      alt: rs.filter((p, i) => i % Math.ceil(rs.length / 8) === 0).map(p => fmt(p[0], 1) + ': ' + fmt(p[1], 1) + ' Ω').join(', ') + '. Seçili tasarım ' + fmt(v.R, 1) + ' Ω.' });
    // Wenner: görünür özdirenç – elektrot aralığı (log2 eksen)
    const wa = WENNER_A.map(a => [Math.log2(a), TC.wennerApparent(s.soilRho1, s.soilRho2, s.soilH, a)]);
    ch.push({ id: 'wenner', title: 'Wenner ölçümü · görünür özdirenç ρa – elektrot aralığı a', height: 150,
      series: [{ name: 'ρa = 2πaR (Ω·m)', color: 'brown', data: wa }],
      hLines: [{ y: s.rho, label: 'tasarım ρ ' + fmt(s.rho, 0), color: '#22b8cf' }],
      markers: [{ x: Math.log2(s.wennerA), y: x.wenner.rho, label: 'a = ' + fmt(s.wennerA, 1) + ' m', color: '#fcd34d' }],
      x: { label: 'a (m)', min: -1, max: 5, ticks: [-1, 0, 1, 2, 3, 4, 5], fmt: t => fmt(Math.pow(2, t), t < 0 ? 1 : 0) }, y: { label: 'Ω·m', min: 0 },
      alt: WENNER_A.map(a => 'a ' + fmt(a, 1) + ' m: ' + fmt(TC.wennerApparent(s.soilRho1, s.soilRho2, s.soilH, a), 0)).join(', ') + ' Ω·m. Aralık büyüdükçe ölçüm daha derin tabakaları yansıtır.' });
    // potansiyel düşümü eğrisi
    const fc = [];
    for (let p = 5; p <= 95.001; p += 2.5) fc.push([p, TC.fallOfPotential(v.R, rho, s.fopD, p / 100 * s.fopD, x.along)]);
    const fmax = Math.min(Math.max.apply(null, fc.map(q => q[1])), v.R * 3);
    ch.push({ id: 'fop', title: 'Potansiyel düşümü yöntemi · R ölçümü – gerilim probu konumu', height: 150,
      series: [{ name: 'Ölçülen R (Ω)', color: 'cyan', data: fc.map(q => [q[0], Math.min(q[1], fmax)]) }],
      hLines: [{ y: v.R, label: 'hesap R ' + fmt(v.R, 2) + ' Ω', color: '#10b981' }],
      markers: [{ x: 61.8, label: '%61,8', color: '#94a3b8' }, { x: s.fopX, y: x.fop.R, label: 'P %' + fmt(s.fopX, 1), color: '#fcd34d' }],
      x: { label: '% D', min: 0, max: 100 }, y: { label: 'Ω', min: 0, max: fmax * 1.08 },
      alt: 'D = ' + fmt(s.fopD, 0) + ' m. Eğrinin düz bölgesi (plato) elektrot ve akım probu etki alanlarının ayrık olduğunu gösterir; %61,8 noktası yarım küre elektrot için tam değeri verir. Seçili konumda ölçülen ' + fmt(x.fop.R, 2) + ' Ω.' });
    // izin verilen gerilimler – arıza süresi (motor bağıntısı, tf taranarak)
    const et = [], es = [];
    for (let t = 0.1; t <= 3.0001; t += 0.1) { const r = G.compute(Object.assign({}, s, { rho: rho, tf: t, electrode: s.electrode === 'ring' || s.electrode === 'found' ? 'strip' : s.electrode })).values; et.push([t, r.Etouch]); es.push([t, r.Estep]); }
    const actual = s.IF > 0 ? touchOf(s, res) : null;
    ch.push({ id: 'perm', title: 'İzin verilen dokunma / adım gerilimi – arıza süresi (IEEE 80)', height: 150,
      series: [{ name: 'E_dokunma', color: 'amber', data: et }, { name: 'E_adım', color: 'blue', data: es }],
      hLines: actual ? [{ y: actual, label: (s.electrode === 'mesh' ? 'Em ' : 'dokunma ≈ ') + fmtV(actual), color: '#ef4444' }] : [],
      markers: [{ x: s.tf, label: 'tf ' + fmt(s.tf, 2) + ' s', color: '#fcd34d' }],
      x: { label: 's', min: 0, max: 3 }, y: { label: 'V', min: 0 },
      alt: 'Arıza süresi kısaldıkça izin verilen gerilim 1/√t ile artar. tf = ' + fmt(s.tf, 2) + ' s için dokunma ' + fmtV(v.Etouch) + ', adım ' + fmtV(v.Estep) + '.' });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) {
    const g = s.electrode === 'rod' ? [Math.round(s.n), s.L, s.s, s.d] : s.electrode === 'strip' ? [s.Lstrip, s.w, s.h] : s.electrode === 'mesh' ? [s.meshA, s.meshD, s.h] : [s.ringOff, s.w, s.h];
    return [s.electrode, g.join(','), s.hs > 0, s.bondPipe, s.bondSteel, s.bondTray].join('|');
  }
  let noiseTex = null;
  function soilTexture(T) {
    if (noiseTex) return noiseTex;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d'); const img = g.createImageData(256, 256);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 256 * 256; i++) { const n = 0.72 + rnd() * 0.28 - (rnd() < 0.04 ? 0.25 : 0); const c = Math.round(255 * n); img.data[i * 4] = c; img.data[i * 4 + 1] = c; img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    // birkaç çakıl taşı
    for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.15 + rnd() * 0.2) + ')'; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, Math.PI * 2); g.fill(); }
    noiseTex = new T.CanvasTexture(cv); noiseTex.wrapS = noiseTex.wrapT = T.RepeatWrapping; noiseTex.repeat.set(3, 3); noiseTex.encoding = T.sRGBEncoding;
    return noiseTex;
  }

  /** Stilize insan figürü (ölçü: 1,75 m). pose: 'touch' (sağ kol öne uzanmış) veya 'step' (ayaklar 1 m arayla). */
  function human(k, parent, pose, mats) {
    const g = k.group(parent);
    const legL = 0.88, hip = pose === 'step' ? Math.sqrt(legL * legL - 0.25) : legL;
    const legAng = pose === 'step' ? Math.asin(0.5 / legL) : 0;
    const legs = [];
    [-1, 1].forEach(sgn => {
      const pv = k.group(g, pose === 'step' ? 0 : sgn * 0.1, hip, 0);
      pv.rotation.x = pose === 'step' ? sgn * legAng : 0;
      if (pose === 'step') pv.position.x = sgn * 0.06;
      k.cyl(0.068, 0.058, legL - 0.06, mats.trousers, 0, -(legL - 0.06) / 2, 0, pv, 12);
      k.box(0.1, 0.06, 0.24, mats.boot, 0, -legL + 0.03, 0.05, pv);
      legs.push(pv);
    });
    const torso = k.rbox(0.38, 0.56, 0.22, 0.06, mats.vest, 0, hip + 0.3, 0, g);
    k.box(0.385, 0.04, 0.225, mats.stripe, 0, hip + 0.22, 0, g);
    k.cyl(0.05, 0.05, 0.08, mats.skin, 0, hip + 0.62, 0, g, 10);
    k.sphere(0.105, mats.skin, 0, hip + 0.75, 0, g);
    const helmet = k.sphere(0.12, mats.helmet, 0, hip + 0.79, 0, g); helmet.scale.set(1, 0.72, 1.08);
    const arms = [];
    [-1, 1].forEach(sgn => {
      const sh = k.group(g, sgn * 0.235, hip + 0.53, 0);
      if (pose === 'touch' && sgn === 1) { sh.rotation.x = -1.42; sh.rotation.z = 0.08; }
      else sh.rotation.z = sgn * 0.08;
      k.cyl(0.048, 0.042, 0.6, mats.vest, 0, -0.3, 0, sh, 10);
      k.sphere(0.045, mats.skin, 0, -0.63, 0, sh);
      arms.push(sh);
    });
    void torso;
    return { g: g, hip: hip, legs: legs, arms: arms };
  }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    // geometri her zaman güncel girdilerden hesaplanır (ext.topraklama potansiyel modeli dahil)
    const R0 = compute(s);
    const val = R0.values, X0 = R0.x || { pot: () => 0 };
    const st = siteOf(s), Gh = st.Gh, D = st.depth;
    const sc = { flows: [], bodyFlows: [] };
    app.scene3 = sc;
    // ---- toprak bloğu: L biçimli kesit (ön-sağ çeyrek açık), üç katman
    const tex = k.keep(soilTexture(T));   // modül önbelleği: yeniden kurulumda dispose edilmez
    const layers = [
      { y0: 0, y1: -0.35, mat: k.mat(0x5b4331, { roughness: 1, map: tex }), name: 'Bitkisel toprak' },
      { y0: -0.35, y1: -1.7, mat: k.mat(0x8c5d38, { roughness: 1, map: tex }), name: 'Killi alt toprak' },
      { y0: -1.7, y1: -D, mat: k.mat(0x7f776b, { roughness: 1, map: tex }), name: 'Ayrışmış kaya / çakıllı zemin' }
    ];
    const soil = k.group(null);
    const quads = [[-1, -1], [1, -1], [-1, 1]];
    layers.forEach(l => {
      const hgt = l.y0 - l.y1;
      quads.forEach(q => { const b = k.box(Gh, hgt, Gh, l.mat, q[0] * Gh / 2, (l.y0 + l.y1) / 2 - 0.003, q[1] * Gh / 2, soil); b.castShadow = false; });
    });
    // çentik tabanı
    const fl = k.box(Gh, 0.06, Gh, layers[2].mat, Gh / 2, -D - 0.03, Gh / 2, soil); fl.castShadow = false;
    k.shell(soil);
    // notch kenarlarında katman çizgileri
    k.label('Bitkisel toprak · killi alt toprak · kaya', null, [Gh * 0.55, -0.9, 0.05], 'vs-label--sm');
    // ---- yüzey ısı haritası (çentik dışı ızgara, köşe renkleri)
    const N = 110, step = 2 * Gh / N;
    const pos = [], col = [], idx = [], vn = [];
    const pot = X0.pot;
    sc.pot = pot;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -Gh + i * step, z = -Gh + j * step;
      pos.push(x, 0.004, z); col.push(1, 1, 1); vn.push(pot(x, z));
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -Gh + (i + 0.5) * step, z = -Gh + (j + 0.5) * step;
      if (x > 0 && z > 0) continue; // kesit çentiği
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const surf = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    surf.receiveShadow = true; v.root.add(surf);
    sc.surf = surf; sc.vn = vn; sc.amt = -1;
    sc.base = new T.Color(s.hs > 0 ? 0x6a655b : 0x4c5a33).convertSRGBToLinear();
    k.pickable(surf, () => (app.state.hs > 0 ? 'Yüzey · kırma taş tabakası' : 'Yüzey · bitkisel toprak'), () => ['Renk: yaklaşık V/GPR (mavi düşük → kırmızı GPR); çizgi-kaynak modeli, motorun R ve GPR değerine normalize.', app.state.hs > 0 ? 'Yüzey tabakası ' + fmt(app.state.hs * 100, 0) + ' cm, ρs = ' + fmt(app.state.rhoS, 0) + ' Ω·m: ayak direncini artırır, izin verilen dokunma/adım gerilimini yükseltir (Cs).' : 'Yüzey tabakası yok: ayak direnci toprak özdirencine bağlı.', 'GPR = ' + fmtV(app.validResult ? app.validResult.values.GPR : 0)], a => [gravelAct(a.state)]);

    // ---- elektrotlar
    const el = k.group(null);
    const cu = M.copper, gv = M.galv;
    if (s.electrode === 'rod') {
      const n = Math.round(s.n), rr = Math.max(s.d / 2, 0.008) * 1.6;
      const rodGeo = new T.CylinderGeometry(rr, rr, s.L, 14), list = [];
      for (let i = 0; i < n; i++) list.push((i - (n - 1) / 2) * s.s);
      const im = new T.InstancedMesh(rodGeo, cu, n), dm = new T.Object3D();
      list.forEach((x, i) => { dm.position.set(x, -ROD_TOP - s.L / 2, 0); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
      im.castShadow = true; el.add(im);
      list.forEach(x => { k.box(0.06, 0.05, 0.06, M.brass, x, -ROD_TOP + 0.02, 0, el); k.cyl(rr, 0.001, 0.08, M.steel, x, -ROD_TOP - s.L - 0.04, 0, el, 10); });
      if (n > 1) k.box((n - 1) * s.s, 0.012, 0.04, gv, 0, -ROD_TOP + 0.03, 0, el);
      k.pickable(el, 'Topraklama çubukları', () => { const r = app.validResult && app.validResult.values; return r ? [n + ' × ' + fmt(s.L, 1) + ' m · Ø ' + fmt(s.d * 1000, 0) + ' mm · aralık ' + fmt(s.s, 1) + ' m', 'R1 = ' + fmt(G.rod(s.rho * (s.season || 1), s.L, s.d), 1) + ' Ω (tek çubuk, Dwight) → R = ' + fmt(r.R, 2) + ' Ω (BS 7430 sıra katsayısı)', 'Çubukları birleştiren şeridin katkısı hesaba katılmamıştır (güvenli taraf).'] : []; }, electrodeActions);
      sc.feed = [list.reduce((a, x) => (Math.abs(x - st.aebX) < Math.abs(a - st.aebX) ? x : a), list[0]), -ROD_TOP + 0.04, 0];
      list.forEach(x => {
        sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, -ROD_TOP, 0.02), new T.Vector3(x, -ROD_TOP - s.L, 0.02)), 10, 0xfb923c, 0.03));
        [[1, 0], [-1, 0], [0, -1], [0.7, -0.7]].forEach(dd => { const y = -ROD_TOP - s.L * 0.55; sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, y, 0), new T.Vector3(x + dd[0] * 1.6, y - 0.6, dd[1] * 1.6)), 6, 0xf97316, 0.025)); });
      });
    } else if (s.electrode === 'strip') {
      k.box(s.Lstrip, 0.012, Math.max(s.w, 0.03) * 1.4, gv, 0, -s.h, 0, el);
      k.pickable(el, 'Yatay topraklama şeridi', () => { const r = app.validResult && app.validResult.values; return r ? ['Galvaniz şerit ' + fmt(s.Lstrip, 0) + ' m × ' + fmt(s.w * 1000, 0) + ' mm, derinlik ' + fmt(s.h, 2) + ' m', 'R = ' + fmt(r.R, 2) + ' Ω (Dwight, eşdeğer yarıçap a = w/4)'] : []; }, electrodeActions);
      sc.feed = [E.clamp(st.aebX, -s.Lstrip / 2, s.Lstrip / 2), -s.h, 0];
      for (let x = -s.Lstrip / 2 + 1; x < s.Lstrip / 2; x += Math.max(2, s.Lstrip / 10)) [[0, 1], [0, -1]].forEach(dd => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, -s.h, 0), new T.Vector3(x, -s.h - 0.8, dd[1] * 1.4)), 5, 0xf97316, 0.025)));
      sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(-s.Lstrip / 2, -s.h + 0.02, 0.03), new T.Vector3(s.Lstrip / 2, -s.h + 0.02, 0.03)), 30, 0xfb923c, 0.03));
    } else if (s.electrode === 'mesh') {
      const side = Math.sqrt(s.meshA), nm = val.nMesh, sp = side / (nm - 1);
      const geoX = new T.BoxGeometry(side, 0.016, 0.016), geoZ = new T.BoxGeometry(0.016, 0.016, side);
      const ix = new T.InstancedMesh(geoX, cu, nm), iz = new T.InstancedMesh(geoZ, cu, nm), dm = new T.Object3D();
      for (let j = 0; j < nm; j++) { const c = -side / 2 + j * sp; dm.position.set(0, -s.h, c); dm.updateMatrix(); ix.setMatrixAt(j, dm.matrix); dm.position.set(c, -s.h, 0); dm.updateMatrix(); iz.setMatrixAt(j, dm.matrix); }
      ix.castShadow = iz.castShadow = true; el.add(ix); el.add(iz);
      k.pickable(el, 'Topraklama ağı', () => { const r = app.validResult && app.validResult.values; return r ? [nm + ' × ' + nm + ' bakır iletken · D ≈ ' + fmt(sp, 2) + ' m · h = ' + fmt(s.h, 2) + ' m', 'L_T = ' + fmt(r.LT, 0) + ' m · R = ' + fmt(r.R, 2) + ' Ω (IEEE 80 Sverak)', 'Em = ' + fmtV(r.Em) + ' · Es = ' + fmtV(r.Es)] : []; }, electrodeActions);
      sc.feed = [E.clamp(st.aebX, -side / 2, side / 2), -s.h, E.clamp(Math.round((st.aebZ + side / 2) / sp) * sp - side / 2, -side / 2, side / 2)];
      for (let j = 0; j < nm; j += Math.max(1, Math.floor(nm / 5))) { const c = -side / 2 + j * sp; sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(-side / 2, -s.h + 0.02, c), new T.Vector3(side / 2, -s.h + 0.02, c)), 16, 0xfb923c, 0.035)); }
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(q => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(q[0] * side / 2, -s.h, q[1] * side / 2), new T.Vector3(q[0] * (side / 2 + 2), -s.h - 1, q[1] * (side / 2 + 2))), 6, 0xf97316, 0.03)));
    } else {
      // halka / temel: köşk çevresinde dikdörtgen iletken (temelde beton içinde, köşk tabanı hizasında)
      const rg = st.ring, y = -s.h, mat = s.material === 'cu' ? cu : gv, t = Math.max(s.w, 0.03) * 1.4;
      [[rg.a, t, 0, -rg.b / 2], [rg.a, t, 0, rg.b / 2], [t, rg.b, -rg.a / 2, 0], [t, rg.b, rg.a / 2, 0]].forEach(q => k.box(q[0], 0.012, q[1], mat, rg.cx + q[2], y, rg.cz + q[3], el));
      k.pickable(el, () => EL_NAME[app.state.electrode], () => { const r = app.validResult; return r ? [fmt(rg.a, 1) + ' × ' + fmt(rg.b, 1) + ' m çevre, derinlik ' + fmt(s.h, 2) + ' m · ' + TC.MATERIALS[s.material].label, 'R = ' + fmt(r.values.R, 2) + ' Ω (Dwight halka, eşit çevreli daire)', s.electrode === 'found' ? 'Temel topraklaması: temel betonu içinde, donatıya her 2 m’de bağlanır; ölçüm klemensi ile dışarı alınır.' : 'Potansiyel düzenleyici halka: köşk çevresinde dokunma gerilimini azaltır.'] : []; }, electrodeActions);
      sc.feed = [rg.cx + rg.a / 2 - 0.4, y, rg.cz + rg.b / 2];
      [[rg.a, 0, -rg.b / 2], [rg.a, 0, rg.b / 2]].forEach(q => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(rg.cx - rg.a / 2, y + 0.02, rg.cz + q[2]), new T.Vector3(rg.cx + rg.a / 2, y + 0.02, rg.cz + q[2])), 14, 0xfb923c, 0.03)));
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(q => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(rg.cx + q[0] * rg.a / 2, y, rg.cz + q[1] * rg.b / 2), new T.Vector3(rg.cx + q[0] * (rg.a / 2 + 1.6), y - 0.8, rg.cz + q[1] * (rg.b / 2 + 1.6))), 6, 0xf97316, 0.03)));
    }
    sc.elLabel = k.label('R', null, s.electrode === 'mesh' ? [Math.sqrt(s.meshA) / 4, 0.3, Math.sqrt(s.meshA) / 4] : st.ring ? [st.ring.cx + st.ring.a / 2, 0.3, st.ring.cz + st.ring.b / 2] : [s.electrode === 'rod' ? (Math.round(s.n) > 1 ? ((Math.round(s.n) - 1) / 2) * s.s : 0) : s.Lstrip / 4, -0.2, 0.1]);

    // ---- trafo köşkü (prefabrik beton), AEB ve PE bağlantıları
    const kw = 3.2, kh = 2.6, kd = 2.4;
    const kio = k.group(null, st.kx, 0, st.kz);
    k.box(kw + 0.2, 0.15, kd + 0.2, M.concreteDark, 0, 0.075, 0, kio);
    const walls = k.group(kio);
    k.box(kw, kh, 0.12, M.concrete, 0, 0.15 + kh / 2, -kd / 2 + 0.06, walls);
    k.box(0.12, kh, kd, M.concrete, -kw / 2 + 0.06, 0.15 + kh / 2, 0, walls);
    k.box(0.12, kh, kd, M.concrete, kw / 2 - 0.06, 0.15 + kh / 2, 0, walls);
    k.box(kw, 0.5, 0.12, M.concrete, 0, 0.15 + kh - 0.25, kd / 2 - 0.06, walls);
    k.box(0.5, kh - 0.5, 0.12, M.concrete, 0, 0.15 + (kh - 0.5) / 2, kd / 2 - 0.06, walls);
    k.box(kw + 0.3, 0.12, kd + 0.3, M.concreteDark, 0, 0.15 + kh + 0.06, 0, walls);
    k.shell(walls);
    // metal kapılar (trafo: panjurlu, AG pano)
    const doorMat = k.mat(0x6d7782, { metalness: 0.6, roughness: 0.45 });
    const dT = k.group(kio, -0.73, 0.15 + (kh - 0.5) / 2, kd / 2 - 0.02);
    k.box(1.2, kh - 0.55, 0.04, doorMat, 0, 0, 0, dT);
    for (let r = 0; r < 12; r++) k.box(1.0, 0.03, 0.03, M.darkSteel, 0, -0.75 + r * 0.06, 0.03, dT);
    const dL = k.group(kio, 0.73, 0.15 + (kh - 0.5) / 2, kd / 2 - 0.02);
    k.box(1.2, kh - 0.55, 0.04, doorMat, 0, 0, 0, dL);
    k.box(0.04, 0.16, 0.05, M.plasticDark, -0.5, 0, 0.04, dL);
    const sign = k.screen(0.34, 0.3, 256, (gx, w, h) => {
      gx.fillStyle = '#f5f5f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#f2c200'; gx.beginPath(); gx.moveTo(w / 2, 12); gx.lineTo(w - 30, h * 0.62); gx.lineTo(30, h * 0.62); gx.closePath(); gx.fill(); gx.strokeStyle = '#111'; gx.lineWidth = 7; gx.stroke();
      gx.fillStyle = '#111'; gx.font = 'bold 64px Arial'; gx.textAlign = 'center'; gx.fillText('⚡', w / 2, h * 0.56); gx.font = 'bold 26px Arial'; gx.fillText('DİKKAT', w / 2, h * 0.76); gx.font = 'bold 20px Arial'; gx.fillText('YÜKSEK GERİLİM', w / 2, h * 0.9);
    }, dT);
    sign.position.set(0, 0.45, 0.05);
    // iç: trafo ve AG pano (şeffaf görünümde)
    const trIn = k.group(kio, -0.7, 0.15, -0.2);
    k.box(1.0, 1.1, 0.7, M.trafoPaint, 0, 0.6, 0, trIn);
    for (let j = 0; j < 3; j++) k.cyl(0.03, 0.04, 0.3, M.porcelainGrey, -0.3 + j * 0.3, 1.3, -0.15, trIn, 10);
    const lvp = k.group(kio, 0.8, 0.15, -0.6);
    k.box(1.0, 1.9, 0.5, M.panelRAL7035, 0, 0.95, 0, lvp);
    const spd = k.box(0.12, 0.1, 0.08, M.plasticGrey, 0.25, 1.6, 0.29, lvp);
    k.pickable(spd, 'Aşırı gerilim koruma (SPD) · AG pano', () => ['Tip 1+2 SPD, PE barasına mümkün olan en kısa yoldan bağlanır (bağlantı iletkeni toplamı ≤ 0,5 m önerilir).', 'SPD topraklama iletkeni ana topraklama barasına (AEB) bağlanır; düşük empedanslı topraklama gerekir.', 'TS HD 60364-5-534 · TS EN 62305-4']);
    k.pickable(kio, 'Trafo köşkü (prefabrik beton)', () => ['Metal kapılar, trafo tankı ve AG pano gövdesi ana eşpotansiyel baraya bağlıdır.', 'Arızada bu gövdeler GPR potansiyeline yükselir: dokunma gerilimi = GPR − ayak potansiyeli.', s.system + ' sistemi · ' + (s.system === 'TT' ? 'RCD ' + s.IdN_mA + ' mA' : s.system === 'TN' ? 'PE ile kaynağa dönüş' : 'yalıtım izleme')]);
    k.label('Trafo köşkü', kio, [0, kh + 0.5, 0]);
    // ana eşpotansiyel bara (AEB) — köşk ön duvarında, sağ altta
    const aebX = st.aebX, aebY = 0.55, aebZ = st.aebZ;
    const aeb = k.group(null, aebX, aebY, aebZ);
    k.box(0.5, 0.18, 0.02, M.plasticDark, 0, 0, 0, aeb);
    k.box(0.42, 0.04, 0.015, M.copper, 0, 0, 0.018, aeb);
    for (let j = 0; j < 6; j++) k.cyl(0.008, 0.008, 0.02, M.brass, -0.18 + j * 0.072, 0, 0.03, aeb, 8).rotation.x = Math.PI / 2;
    const bondAct = (key, name) => a => ({ label: (a.state[key] ? name + ' bağlantısını kaldır' : name + ' AEB’ye bağla'), variant: a.state[key] ? 'warn' : 'primary', onClick: x => { x.state[key] = !x.state[key]; x.live.events.push(name + (x.state[key] ? ' AEB’ye bağlandı.' : ' bağlantısı kaldırıldı.')); } });
    k.pickable(aeb, 'Ana eşpotansiyel bara (AEB)', () => ['Topraklama iletkeni, PE iletkenleri ve yabancı iletken kısımlar (metal boru, çelik konstrüksiyon, kablo tavası) burada birleşir.', 'Eşpotansiyel bağlantı bina içindeki dokunma gerilimini sınırlar; bina dışında yüzey potansiyeli belirleyicidir.', 'TS HD 60364-5-54 · Topraklamalar Yönetmeliği'],
      a => [bondAct('bondPipe', 'Su borusu')(a), bondAct('bondSteel', 'Çelik konstrüksiyon')(a), bondAct('bondTray', 'Kablo tavası')(a)]);
    k.label('Ana eşpotansiyel bara', aeb, [0, 0.15, 0], 'vs-label--sm');
    // metal su borusu (yabancı iletken kısım): topraktan çıkıp duvara girer
    const pipeX = st.kx + 1.42;
    const pipe = k.tube([[pipeX, -0.9, aebZ + 0.35], [pipeX, 0.2, aebZ + 0.35], [pipeX, 1.0, aebZ + 0.32], [pipeX, 1.05, aebZ - 0.05]], 0.03, M.galv, v.root);
    k.pickable(pipe, 'Metal su borusu (yabancı iletken kısım)', () => [app.state.bondPipe ? 'AEB’ye bağlı: arızada köşk gövdesiyle aynı potansiyele yükselir.' : 'BAĞLI DEĞİL: boru uzak toprak potansiyelinde kalır → köşk gövdesi ile boru arasında ≈ GPR dokunma gerilimi.'], a => [bondAct('bondPipe', 'Su borusu')(a)]);
    // çelik konstrüksiyon (sundurma kolonu) ve kablo tavası
    const colX = st.kx + KW / 2 + 0.55, colZ = st.kz + 0.2;
    const colG = k.group(null, colX, 0, colZ);
    k.box(0.16, 2.8, 0.012, M.darkSteel, 0, 1.4, 0.07, colG); k.box(0.16, 2.8, 0.012, M.darkSteel, 0, 1.4, -0.07, colG); k.box(0.012, 2.8, 0.14, M.darkSteel, 0, 1.4, 0, colG);
    k.box(0.35, 0.02, 0.35, M.galv, 0, 0.01, 0, colG);
    k.pickable(colG, 'Çelik konstrüksiyon', () => [app.state.bondSteel ? 'AEB’ye bağlı (yeşil-sarı iletken).' : 'BAĞLI DEĞİL: kolon ayrı potansiyelde kalır.'], a => [bondAct('bondSteel', 'Çelik konstrüksiyon')(a)]);
    const tray = k.group(null, st.kx + KW / 2 + 0.08, 2.2, st.kz);
    k.box(0.02, 0.06, KD, M.galv, 0.14, 0, 0, tray); k.box(0.3, 0.01, KD, M.galv, 0, -0.03, 0, tray);
    k.pickable(tray, 'Kablo tavası', () => [app.state.bondTray ? 'AEB’ye bağlı; tava boyunca elektriksel süreklilik sağlanmalı.' : 'BAĞLI DEĞİL.'], a => [bondAct('bondTray', 'Kablo tavası')(a)]);
    const pec = M.PE;
    const pe = (pts, r) => k.tube(pts, r || 0.008, pec, v.root);
    if (s.bondPipe) pe([[aebX + 0.15, aebY + 0.02, aebZ + 0.03], [aebX + 0.2, aebY + 0.2, aebZ + 0.15], [pipeX, 0.95, aebZ + 0.3]]); // boru
    if (s.bondSteel) pe([[aebX + 0.2, aebY + 0.02, aebZ + 0.03], [colX - 0.2, 0.3, aebZ + 0.1], [colX, 0.4, colZ + 0.08]]);       // çelik kolon
    if (s.bondTray) pe([[aebX + 0.22, aebY + 0.05, aebZ + 0.03], [st.kx + KW / 2 + 0.05, 1.4, aebZ - 0.2], [st.kx + KW / 2 + 0.2, 2.15, st.kz + KD / 2 - 0.1]]); // tava
    pe([[aebX - 0.15, aebY + 0.02, aebZ + 0.03], [aebX - 0.32, aebY + 0.3, aebZ + 0.04], [st.kx + 0.18, 0.9, aebZ - 0.03]]);         // kapı çerçevesi
    pe([[aebX - 0.05, aebY + 0.02, aebZ + 0.02], [aebX - 0.3, aebY + 0.1, aebZ - 0.2], [st.kx + 0.6, 0.6, st.kz - 0.4]]);             // AG pano (iç)
    pe([[aebX - 0.1, aebY + 0.02, aebZ + 0.02], [aebX - 1.2, aebY + 0.2, aebZ - 0.3], [st.kx - 0.4, 0.7, st.kz - 0.1]]);              // trafo tankı (iç)
    // topraklama iletkeni: AEB → toprak → elektrot
    const fd = sc.feed;
    const earthPts = [[aebX + 0.05, aebY - 0.08, aebZ + 0.03], [aebX + 0.05, -0.3, aebZ + 0.1], [aebX + 0.05, fd[1] + 0.05, aebZ + 0.2], [(aebX + fd[0]) / 2, fd[1] + 0.04, (aebZ + fd[2]) / 2 + 0.3], [fd[0], fd[1] + 0.04, fd[2] + 0.04]];
    const earth = k.tube(earthPts, 0.012, M.galv, v.root);
    // ölçüm klemensi (test link) ve pens ölçer
    const tl = k.group(null, aebX + 0.05, 0.28, aebZ + 0.07);
    k.box(0.09, 0.07, 0.04, M.plasticDark, 0, 0, 0, tl); k.box(0.05, 0.02, 0.045, M.brass, 0, 0, 0.005, tl);
    k.pickable(tl, 'Ölçüm klemensi (test link)', () => ['Topraklama iletkenini AEB’den ayırır: elektrot direnci tesisten bağımsız ölçülür.', 'Klemens açıkken tesis topraksızdır — ölçüm enerjisiz durumda ve kısa sürede yapılır, sonra yeniden sıkılır.']);
    const clamp = new T.Mesh(new T.TorusGeometry(0.05, 0.016, 8, 20), M.plasticYellow); clamp.position.set(aebX + 0.05, 0.08, aebZ + 0.1); clamp.rotation.x = Math.PI / 2; v.root.add(clamp);
    k.pickable(clamp, 'Pens (clamp-on) topraklama ölçer', () => ['Akım enjekte edip döngü direncini ölçer; klemens açmadan ve prob çakmadan çalışır.', 'Yalnız çok noktalı (paralel dönüş yolu olan) topraklamada anlamlıdır; tek elektrotlu TT tesiste kullanılamaz, ölçülen değer döngü direncidir.']);
    // ölçü aletleri: Wenner dört uç ve potansiyel düşümü probları (konumlar update içinde)
    const pinMat = { red: M.plasticRed, blk: M.plasticDark };
    const pin = c => { const g = k.group(null); k.cyl(0.012, 0.012, 0.55, M.steel, 0, 0.12, 0, g, 8); k.sphere(0.035, pinMat[c], 0, 0.4, 0, g); return g; };
    const tester = lbl => { const g = k.group(null); k.rbox(0.24, 0.1, 0.18, 0.02, M.plasticYellow, 0, 0.05, 0, g); const d = k.screen(0.12, 0.05, 128, (gx, w, h) => { gx.fillStyle = '#0b2a1a'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#4ade80'; gx.font = 'bold 30px monospace'; gx.fillText(lbl, 8, 40); }, g, { emissive: 0.8 }); d.rotation.x = -Math.PI / 2; d.position.set(0, 0.102, 0); return g; };
    sc.wen = { pins: ['red', 'blk', 'blk', 'red'].map(pin), box: tester('Ω·m'), z: -Gh + 1.2, x0: -Gh * 0.1 };
    const wenActs = () => [
      { label: 'a ×2 (daha derin)', onClick: a => { const i = WENNER_A.indexOf(a.state.wennerA); a.state.wennerA = WENNER_A[Math.min(WENNER_A.length - 1, (i < 0 ? 4 : i) + 2)]; } },
      { label: 'a ÷2', onClick: a => { const i = WENNER_A.indexOf(a.state.wennerA); a.state.wennerA = WENNER_A[Math.max(0, (i < 0 ? 4 : i) - 2)]; } },
      { label: 'Ölçülen ρ’yu tasarıma aktar', variant: 'primary', onClick: a => transferRho(a) }];
    const wenInfo = () => { const r = app.validResult; return r && r.x ? ['Dört eşit aralıklı elektrot (a): dıştakiler akım, içtekiler gerilim. ρ = 2πaR.', 'a = ' + fmt(app.state.wennerA, 1) + ' m · R = ' + fmt(r.x.wenner.R, 3) + ' Ω → ρ = ' + fmt(r.x.wenner.rho, 0) + ' Ω·m', 'Aralık arttıkça ölçüm daha derin tabakaları yansıtır (yaklaşık a derinliğine kadar).'] : []; };
    sc.wen.pins.forEach(p => k.pickable(p, 'Wenner ölçümü · prob', wenInfo, wenActs)); k.pickable(sc.wen.box, 'Wenner ölçümü · toprak özdirenci ölçer', wenInfo, wenActs);
    sc.wen.lbl = k.label('Wenner', sc.wen.box, [0, 0.4, 0], 'vs-label--sm');
    sc.fop = { P: pin('blk'), C: pin('red'), box: tester('Ω') };
    const fopActs = () => [
      { label: 'P → %61,8', variant: 'primary', onClick: a => { a.state.fopX = 61.8; } },
      { label: 'P −5 %', onClick: a => { a.state.fopX = Math.max(5, Math.round((a.state.fopX - 5) * 10) / 10); } },
      { label: 'P +5 %', onClick: a => { a.state.fopX = Math.min(95, Math.round((a.state.fopX + 5) * 10) / 10); } },
      { label: 'C probu +10 m', onClick: a => { a.state.fopD = Math.min(150, a.state.fopD + 10); } }];
    const fopInfo = () => { const r = app.validResult; return r && r.x ? ['Akım probu C elektrottan D = ' + fmt(app.state.fopD, 0) + ' m; gerilim probu P %' + fmt(app.state.fopX, 1) + ' (' + fmt(r.x.fop.x, 1) + ' m).', 'Ölçülen R = ' + fmt(r.x.fop.R, 2) + ' Ω · hesap R = ' + fmt(r.values.R, 2) + ' Ω (%' + fmt(r.x.fop.err * 100, 1) + ')', '%61,8 kuralı D elektrot boyutunun yeterince üstündeyse doğru sonuç verir; eğrinin düz bölgesi kontrol edilir.', 'Ölçümden önce ölçüm klemensi açılır.'] : []; };
    [sc.fop.P, sc.fop.C, sc.fop.box].forEach(p => k.pickable(p, 'Potansiyel düşümü (fall-of-potential) ölçümü', fopInfo, fopActs));
    sc.fop.lblC = k.label('C', sc.fop.C, [0, 0.6, 0], 'vs-label--sm'); sc.fop.lblP = k.label('P', sc.fop.P, [0, 0.6, 0], 'vs-label--sm');
    sc.Gh = Gh; sc.st = st;
    // arıza akımı yolu: trafo tankı → PE → AEB → topraklama iletkeni
    sc.flows.push(k.flow(new T.CatmullRomCurve3([new T.Vector3(st.kx - 0.4, 0.7, st.kz - 0.1), new T.Vector3(aebX - 1.2, aebY + 0.2, aebZ - 0.3), new T.Vector3(aebX - 0.1, aebY + 0.02, aebZ + 0.04)]), 10, 0xfbbf24, 0.03));
    sc.flows.push(k.flow(earth.userData.curve, 22, 0xfbbf24, 0.03));
    // ---- insan figürleri
    const hm = { skin: k.mat(0xc9a184, { roughness: 0.7 }), vest: k.mat(0xff7a1a, { roughness: 0.65 }), stripe: k.mat(0xe5e7eb, { roughness: 0.3, metalness: 0.2 }), trousers: k.mat(0x2b3a55, { roughness: 0.8 }), boot: M.rubber, helmet: M.plasticWhite };
    const pT = human(k, null, 'touch', hm);
    pT.g.position.set(st.touch.x, 0, st.touch.z - 0.36); pT.g.rotation.y = Math.PI;
    k.pickable(pT.g, 'Dokunma gerilimi (el: köşk kapısı, ayaklar: 1 m)', () => touchInfo(app));
    sc.touchLbl = k.label('Dokunma', pT.g, [0, 2.05, 0]);
    const pS = human(k, null, 'step', hm);
    pS.g.position.set(st.step.x, 0, (st.step.z1 + st.step.z2) / 2);
    k.pickable(pS.g, 'Adım gerilimi (ayaklar 1 m arayla)', () => stepInfo(app));
    sc.stepLbl = k.label('Adım', pS.g, [0, 2.4, 0]);
    // vücut akımı (el → ayaklar, ayak → ayak)
    sc.bodyFlows.push(k.flow(new T.CatmullRomCurve3([new T.Vector3(st.touch.x, 1.28, st.kz + kd / 2 + 0.05), new T.Vector3(st.touch.x + 0.2, 1.3, st.touch.z - 0.6), new T.Vector3(st.touch.x + 0.1, 0.9, st.touch.z - 0.2), new T.Vector3(st.touch.x + 0.1, 0.05, st.touch.z - 0.15)]), 10, 0xef4444, 0.022));
    const hipY = pS.hip;
    sc.bodyFlows.push(k.flow(new T.CatmullRomCurve3([new T.Vector3(st.step.x + 0.06, 0.05, st.step.z2), new T.Vector3(st.step.x + 0.06, hipY - 0.05, (st.step.z1 + st.step.z2) / 2), new T.Vector3(st.step.x - 0.06, 0.05, st.step.z1)]), 10, 0xef4444, 0.022));
    // ayak izi işaretleri (1 m)
    [st.step.z1, st.step.z2].forEach(z => { const m = k.cyl(0.13, 0.13, 0.01, M.plasticYellow, st.step.x, 0.008, z, null, 18); m.castShadow = false; });

    // ---- görünüm
    app.def.scene.bounds = [-Gh, Gh];
    const span = Math.min(Gh, st.ext + 4);
    v.setView({ target: [span * 0.04, -0.5, -span * 0.12], r: span * 1.3 + 2.5, theta: 0.6, phi: 1.07, limits: { rMin: 2, rMax: Gh * 4, phiMax: 1.45 } });
    v.setShadowBox(Math.max(8, span * 1.1), 80);
    v.sun.position.set(6, 14, 9);
    void el;
  }

  function touchInfo(app) {
    const r = app.validResult, s = app.state; if (!r || !r.x) return [];
    return ['El: köşk kapısı (AEB’ye bağlı, potansiyel = GPR) · ayaklar yapıdan 1 m uzakta', s.electrode === 'mesh' ? 'Ağ dokunma gerilimi Em = ' + fmtV(r.values.Em) + ' (IEEE 80, motor)' : 'Dokunma ≈ GPR − V(ayak) = ' + fmtV(r.x.touch) + ' (yaklaşık görsel model)', 'İzin verilen: ' + fmtV(r.values.Etouch) + ' (IEEE 80, tf = ' + fmt(s.tf, 2) + ' s)', 'Önlem: yüzeye yüksek özdirençli çakıl/asfalt, potansiyel düzenleyici halka, ağ sıklaştırma'];
  }
  function stepInfo(app) {
    const r = app.validResult, s = app.state; if (!r || !r.x) return [];
    return [s.electrode === 'mesh' ? 'Ağ adım gerilimi Es = ' + fmtV(r.values.Es) + ' (IEEE 80, motor)' : 'Adım ≈ |V(ayak1) − V(ayak2)| = ' + fmtV(r.x.step) + ' (yaklaşık görsel model)', 'İzin verilen: ' + fmtV(r.values.Estep) + ' (IEEE 80)', 'Potansiyel gradyanı en çok elektrot kenarında yüksektir.'];
  }

  /* sahne güncelleme */
  const tmpC = { h: null };
  function paint(k, sc, amt) {
    const T = k.T; if (!tmpC.h) tmpC.h = new T.Color();
    const col = sc.surf.geometry.attributes.color, a = col.array, vn = sc.vn, b = sc.base, h = tmpC.h;
    for (let i = 0; i < vn.length; i++) {
      k.heat(vn[i], h); h.convertSRGBToLinear();
      const w = amt * (0.35 + 0.65 * Math.min(1, vn[i] * 2.5));
      a[i * 3] = b.r + (h.r - b.r) * w; a[i * 3 + 1] = b.g + (h.g - b.g) * w; a[i * 3 + 2] = b.b + (h.b - b.b) * w;
    }
    col.needsUpdate = true; sc.amt = amt;
  }
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc || !res.x) return;
    const v = res.values, x = res.x, st = sc.st, Gh = sc.Gh;
    sc.elLabel.set('R = ' + fmt(v.R, v.R < 10 ? 2 : 1, 'Ω') + ' · GPR ' + fmtV(v.GPR));
    sc.elLabel.level(s.system === 'TN' ? '' : v.R <= v.RAmax ? 'ok' : 'bad');
    const ut = touchOf(s, res), us = stepOf(s, res), ap = s.electrode === 'mesh' ? '' : '≈ ';
    sc.touchLbl.set('Dokunma ' + ap + fmtV(ut) + ' (izin ' + fmtV(v.Etouch) + ')');
    sc.touchLbl.level(s.IF <= 0 ? '' : ut <= v.Etouch ? 'ok' : 'bad');
    sc.stepLbl.set('Adım ' + ap + fmtV(us) + ' (izin ' + fmtV(v.Estep) + ')');
    sc.stepLbl.level(s.IF <= 0 ? '' : us <= v.Estep ? 'ok' : 'bad');
    sc.overT = ut > v.Etouch; sc.overS = us > v.Estep;
    // Wenner probları: görsel aralık sahneye sığacak biçimde sınırlanır
    const aV = Math.min(s.wennerA, Gh * 0.55 / 1.5);
    sc.wen.pins.forEach((p, i) => p.position.set(sc.wen.x0 + (i - 1.5) * aV, 0, sc.wen.z));
    sc.wen.box.position.set(sc.wen.x0, 0, sc.wen.z + 0.7);
    sc.wen.lbl.set('Wenner a ' + fmt(s.wennerA, s.wennerA % 1 ? 1 : 0) + ' m · ρ ' + fmt(x.wenner.rho, 0) + ' Ω·m');
    // potansiyel düşümü probları ölçüm doğrultusunda
    const pr = st.probe, lim = Gh * 0.92;
    const at = d => { const t = Math.min(d, lim); return [pr.x + pr.dx * t, pr.z + pr.dz * t]; };
    const pP = at(x.fop.x), pC = at(s.fopD);
    sc.fop.P.position.set(pP[0], 0, pP[1]); sc.fop.C.position.set(pC[0], 0, pC[1]);
    sc.fop.box.position.set(pr.x + pr.dx * 1.2 + 0.5, 0, pr.z + pr.dz * 1.2);
    sc.fop.lblP.set('P %' + fmt(s.fopX, 1) + ' · ' + fmt(x.fop.R, 2) + ' Ω');
    sc.fop.lblP.level(Math.abs(x.fop.err) <= 0.03 ? 'ok' : 'warn');
    sc.fop.lblC.set('C ' + fmt(s.fopD, 0) + ' m' + (s.fopD > lim ? ' (ölçekli)' : ''));
    sc.amt = -1;
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    const f = live.fault, active = f && !f.done && res.values.GPR > 0;
    const tgt = active ? 1 : 0.4;
    sc.cur = sc.cur === undefined ? tgt : sc.cur + (tgt - sc.cur) * Math.min(1, dt * (k.reducedMotion ? 100 : 5));
    if (Math.abs(tgt - sc.cur) < 0.005) sc.cur = tgt;
    let moving = false;
    if (sc.amt < 0 || Math.abs(sc.cur - sc.amt) > 0.02 || (sc.cur === tgt && sc.amt !== tgt)) { paint(k, sc, sc.cur); moving = true; }
    sc.flows.forEach(fl => { fl.speed = active ? 0.55 : 0; });
    sc.bodyFlows.forEach((fl, i) => { fl.speed = active && (i === 0 ? sc.overT : sc.overS) ? 0.8 : 0; });
    return moving;
  }

  /* ---------------------------------------------------------------- 2D kesit şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values, x = res.x; if (!x) return;
    const st = x.site;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', soil: '#4a3424', cu: '#c77b4a' };
    const R = W - 76, gy = Math.max(240, H * 0.48), half = Math.max(st.ext + 5, 10);
    const sx = (R - 60) / (2 * half), X = xx => 40 + (xx + half) * sx;
    const dScale = Math.min(sx * 1.5, (H - gy - 120) / (st.depth + 0.3)), Yd = d => gy + d * dScale;
    g.fillStyle = col.soil; g.fillRect(40, gy, R - 40, H - gy - 20);
    g.fillStyle = '#5b3f2b'; g.fillRect(40, gy, R - 40, 0.35 * dScale);
    if (s.hs > 0) { g.fillStyle = '#8f897d'; g.fillRect(40, gy - Math.max(2, s.hs * dScale), R - 40, Math.max(2, s.hs * dScale)); }
    g.strokeStyle = col.line; g.lineWidth = 2; g.beginPath(); g.moveTo(30, gy); g.lineTo(R, gy); g.stroke();
    g.font = '11px Inter, sans-serif'; g.fillStyle = '#c8b8a6'; g.textAlign = 'left'; g.fillText('ρ = ' + fmt(x.rhoEff, 0) + ' Ω·m' + (s.hs > 0 ? ' · yüzey ' + fmt(s.hs * 100, 0) + ' cm, ρs ' + fmt(s.rhoS, 0) : ''), 46, gy + 0.35 * dScale + 16);
    // elektrot kesiti (x ekseni boyunca)
    g.strokeStyle = col.cu; g.fillStyle = col.cu; g.lineWidth = 3;
    if (s.electrode === 'rod') { const n = Math.round(s.n); for (let i = 0; i < n; i++) { const xx = X((i - (n - 1) / 2) * s.s); g.beginPath(); g.moveTo(xx, Yd(ROD_TOP)); g.lineTo(xx, Yd(ROD_TOP + s.L)); g.stroke(); } if (n > 1) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-(n - 1) / 2 * s.s), Yd(ROD_TOP)); g.lineTo(X((n - 1) / 2 * s.s), Yd(ROD_TOP)); g.stroke(); } }
    else if (s.electrode === 'strip') { g.beginPath(); g.moveTo(X(-s.Lstrip / 2), Yd(s.h)); g.lineTo(X(s.Lstrip / 2), Yd(s.h)); g.stroke(); }
    else if (s.electrode === 'mesh') { const side = Math.sqrt(s.meshA), nm = v.nMesh; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-side / 2), Yd(s.h)); g.lineTo(X(side / 2), Yd(s.h)); g.stroke(); for (let j = 0; j < nm; j++) { g.beginPath(); g.arc(X(-side / 2 + j * side / (nm - 1)), Yd(s.h), 2.5, 0, Math.PI * 2); g.fill(); } }
    else { const rg = st.ring; [rg.cx - rg.a / 2, rg.cx + rg.a / 2].forEach(xx => { g.beginPath(); g.arc(X(xx), Yd(s.h), 4, 0, Math.PI * 2); g.fill(); }); }
    // köşk ve AEB
    const kx0 = X(st.kx - KW / 2), kx1 = X(st.kx + KW / 2), kTop = gy - Math.max(56, 2.6 * Math.min(sx, 40));
    g.strokeStyle = col.line; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.strokeRect(kx0, kTop, kx1 - kx0, gy - kTop); g.setLineDash([]);
    g.fillStyle = col.text; g.textAlign = 'left'; g.fillText('Köşk (arkada)', kx0 + 4, kTop + 14);
    g.strokeStyle = '#7fb800'; g.beginPath(); g.moveTo(X(st.aebX), gy - 8); g.lineTo(X(st.aebX), Yd(0.5)); g.stroke();
    g.fillStyle = '#7fb800'; g.fillText('AEB · ölçüm klemensi', X(st.aebX) + 4, gy + 0.35 * dScale + 32);
    // yüzey potansiyeli (kesit doğrultusunda)
    const top = 70, ph = gy - top - 90;
    g.strokeStyle = '#22b8cf'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 200; i++) { const xx = -half + i * 2 * half / 200, p = x.pot(xx, st.ring ? st.kz + st.ring.b / 2 + 0.5 : -0.5); const yy = gy - 10 - p * ph; if (i) g.lineTo(X(xx), yy); else g.moveTo(X(xx), yy); }
    g.stroke();
    g.fillStyle = '#22b8cf'; g.textAlign = 'right'; g.fillText('V(x) / GPR · yaklaşık', R, top - 18);
    g.strokeStyle = 'rgba(239,68,68,.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(40, gy - 10 - ph); g.lineTo(R, gy - 10 - ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fca5a5'; g.textAlign = 'left'; g.fillText('GPR = ' + fmtV(v.GPR), 44, gy - 14 - ph);
    const man = (xx, lbl, val, ok, dy) => { const px = X(xx); g.strokeStyle = ok ? col.ok : col.bad; g.lineWidth = 2; g.beginPath(); g.arc(px, gy - 34, 4, 0, Math.PI * 2); g.moveTo(px, gy - 30); g.lineTo(px, gy - 14); g.moveTo(px - 6, gy); g.lineTo(px, gy - 14); g.lineTo(px + 6, gy); g.moveTo(px - 7, gy - 24); g.lineTo(px + 7, gy - 24); g.stroke(); g.fillStyle = ok ? col.ok : col.bad; g.textAlign = 'center'; g.fillText(lbl + ' ' + val, px, gy - 64 - (dy || 0)); };
    const ut = touchOf(s, res), us = stepOf(s, res);
    if (s.IF > 0) { man(st.touch.x, 'Dokunma', fmtV(ut), ut <= v.Etouch); man(st.step.x, 'Adım', fmtV(us), us <= v.Estep, Math.abs(X(st.step.x) - X(st.touch.x)) < 150 ? 16 : 0); }
    // özet (toprak bölgesinin altında, sığmazsa kısaltılır)
    g.font = '12px Inter, sans-serif'; g.textAlign = 'left';
    const sys = chk(res, sysId(s));
    const lines = [
      [EL_NAME[s.electrode] + ' · R = ' + fmt(v.R, 2) + ' Ω · GPR = ' + fmtV(v.GPR) + ' · ' + x.mat.label, col.text],
      [s.system + ': ' + (sys ? sys.detail : ''), sys && sys.status === 'fail' ? col.bad : '#c8b8a6'],
      ['İzin: dokunma ' + fmtV(v.Etouch) + ' · adım ' + fmtV(v.Estep) + ' · OG/AG ' + (s.mvlv === 'common' ? 'ortak' : 'ayrı') + (s.IF > 0 ? (x.mv.ok ? ' uygun' : ' uygun değil') : ''), '#c8b8a6'],
      ['Wenner ρ ' + fmt(x.wenner.rho, 0) + ' Ω·m (a ' + fmt(s.wennerA, 1) + ' m) · Potansiyel düşümü R ' + fmt(x.fop.R, 2) + ' Ω (%' + fmt(s.fopX, 1) + ', D ' + fmt(s.fopD, 0) + ' m)', '#c8b8a6']
    ];
    lines.forEach((l, i) => { g.fillStyle = l[1]; wrapText(g, l[0], R - 70, 56, H - 100 + i * 18); });
  }
  function wrapText(g, text, maxW, x, y) { if (g.measureText(text).width <= maxW) { g.fillText(text, x, y); return; } let t = text; while (t.length > 10 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); g.fillText(t + '…', x, y); }

  /* ---------------------------------------------------------------- görevler */
  const tasks = [
    { id: 'tt300', title: 'TT · 300 mA RCD için RA', goal: 'Kayalık zeminde tek çubukla RA·IΔn ≤ 50 V sağlanmıyor. RCD’yi değiştirmeden elektrotla koşulu sağlayın.', hint: '3D’de çubuğa tıklayıp “+ Çubuk ekle” ve “Çubukları uzat” deneyin; RA sınırı 50 V / 0,3 A = 167 Ω.',
      state: { rho: 400, soilRho1: 400, soilRho2: 400, n: 1, L: 1.5, IF: 0, hs: 0 },
      check: (r, s) => s.system === 'TT' && s.IdN_mA >= 300 && s.rho >= 0.9 * s.soilRho1 && chk(r, 'tt').status === 'ok' },
    { id: 'mesh', title: 'Ağda dokunma ve adım gerilimi', goal: 'Seyrek ağda (10 m göz, çakılsız) Em ve Es izin verilen değerleri aşıyor. İkisini de sınır içine alın.', hint: 'Yüzeye tıklayıp kırma taş serin (Cs ile izin verilen değer artar) ve ağa tıklayıp gözü sıklaştırın (Em azalır); ikisi birlikte gerekebilir.',
      state: { electrode: 'mesh', system: 'TN', meshA: 400, meshD: 10, h: 0.6, IF: 1000, tf: 0.5, rho: 100, soilRho1: 100, soilRho2: 100, hs: 0 },
      check: r => r.values.Em !== null && r.values.Em <= r.values.Etouch && r.values.Es <= r.values.Estep },
    { id: 'wenner', title: 'Wenner ile özdirenç ölçün', goal: 'Sahada iki tabakalı toprak var; tasarım ρ tahmini yanlış. a ≈ çubuk boyu (3 m) aralıkla ölçüp ρ’yu tasarıma aktarın (±%10).', hint: 'Wenner ölçü aletine veya problara tıklayın, a’yı 3 m yapın ve “Ölçülen ρ’yu tasarıma aktar”.',
      state: { soilRho1: 80, soilRho2: 400, soilH: 2, rho: 300, wennerA: 1 },
      check: (r, s) => { const ra = TC.wennerApparent(s.soilRho1, s.soilRho2, s.soilH, s.L); return Math.abs(s.rho - ra) / ra <= 0.1; } },
    { id: 'fop', title: 'Potansiyel düşümü: doğru prob konumu', goal: 'Ölçülen direnç hesaptan çok farklı. Prob konumlarını düzelterek ölçümü hesap değerine %2 içinde yaklaştırın.', hint: 'Akım probunu elektrot boyutunun en az ~5 katı uzağa alın ve gerilim probunu %61,8’e koyun (proba tıklayın).',
      state: { fopD: 15, fopX: 40 },
      check: r => Math.abs(r.x.fop.err) <= 0.02 },
    { id: 'bond', title: 'Eşpotansiyel bağlantıları tamamlayın', goal: 'Su borusu ve kablo tavası AEB’ye bağlı değil. Bağlantıları yapın.', hint: 'Ana eşpotansiyel baraya (köşk önünde, bakır bara) tıklayın.',
      state: { bondPipe: false, bondTray: false },
      check: r => r.x.unbonded.length === 0 },
    { id: 'mvlv', title: 'OG/AG topraklama birleştirme', goal: '150 A OG arızasında GPR yüksek; ortak topraklama uygun değil. OG/AG birleştirme koşulunu sağlayın.', hint: 'Ya ayrı topraklamaya geçip GPR’yi ≤ 1200 V’a (R ≤ 8 Ω) indirin ya da ağ topraklamayla GPR’yi izin verilen dokunma geriliminin altına çekin.',
      state: { mvlv: 'common', IF: 150 },
      check: r => r.x.mv.ok && r.values.GPR > 0 }
  ];

  /* ---------------------------------------------------------------- kayıt */
  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'topraklama', title: '3D Topraklama ve Elektrik Güvenliği Simülasyonu',
    defaults: defaults,
    initLive: () => ({ fault: null, events: [] }),
    autoRun: false,
    startText: 'Arıza akımı darbesi uygulandı: yüzey potansiyeli, dokunma ve adım gerilimleri gösteriliyor.',
    start: start,
    scenarios: [
      { id: 'tt-cubuk', name: 'TT · 3 çubuk, köşk önünde arıza', desc: 'ρ = 150 Ω·m, 3 × 3 m çubuk; TT koşulu sağlanır ama 150 A OG arızasında GPR, izin verilen dokunma geriliminin çok üstüne çıkar.', state: defaults(), start: true },
      { id: 'ag', name: 'TN · trafo merkezi topraklama ağı', desc: '20 × 20 m ağ, 5 m göz, 3000 Ω·m kırma taş: IEEE 80 Em/Es izin verilen değerlerle karşılaştırılır.', state: sc({ electrode: 'mesh', system: 'TN', meshA: 400, meshD: 5, h: 0.6, IF: 1000, tf: 0.5, rho: 100, soilRho1: 100, soilRho2: 100, material: 'cu', section: 50 }), start: true },
      { id: 'tt-kaya', name: 'TT · kayalık zemin, tek çubuk', desc: 'ρ = 1000 Ω·m, tek 1,5 m çubuk: 300 mA RCD ile RA·IΔn ≤ 50 V sağlanmaz; 30 mA RCD ile sağlanır. Kabul ölçütü cihaza bağlıdır.', state: sc({ rho: 1000, soilRho1: 1000, soilRho2: 1000, n: 1, L: 1.5, IF: 0, hs: 0, IdN_mA: 300 }) },
      { id: 'halka', name: 'Potansiyel düzenleyici halka', desc: 'Köşk çevresinde 1 m uzakta halka elektrot: köşk önündeki dokunma gerilimi çubuk dizisine göre azalır.', state: sc({ electrode: 'ring', ringOff: 1, h: 0.6, material: 'galv', section: 90, system: 'TN' }) },
      { id: 'temel', name: 'Temel topraklaması · kuru yaz', desc: 'Temel içinde şerit; mevsim katsayısı ×1,3 ile kuru dönem direnci.', state: sc({ electrode: 'found', season: 1.3, h: 0.5, IF: 0, system: 'TT', IdN_mA: 30 }) },
      { id: 'iki-tabaka', name: 'İki tabakalı toprak · Wenner', desc: 'Üstte 2 m killi (80 Ω·m), altında kayalık (400 Ω·m): Wenner aralığı büyüdükçe görünür özdirenç artar.', state: sc({ soilRho1: 80, soilRho2: 400, soilH: 2, rho: 80, wennerA: 1, L: 6, n: 2 }) },
      { id: 'serit', name: 'Yatay şerit · IT sistem', desc: '40 m galvaniz şerit, ρ = 200 Ω·m; IT sisteminde ilk arıza koşulu RA·Id ≤ UL ile değerlendirilir.', state: sc({ electrode: 'strip', system: 'IT', Lstrip: 40, rho: 200, soilRho1: 200, soilRho2: 200, IdN_mA: 1000, IF: 50, tf: 1, material: 'galv', section: 90 }) },
      { id: 'bag', name: 'Eksik eşpotansiyel bağlantı', desc: 'Su borusu AEB’ye bağlı değil: arızada boru ile köşk gövdesi arasında ≈ GPR.', state: sc({ bondPipe: false }) }
    ],
    tasks: tasks,
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (live.fault && !live.fault.done && res.values.GPR > 0 ? { level: 'bad', text: 'Arıza akımı akıyor' } : null),
    reportInputs: s => [{ group: 'Saha toprağı (ölçüm simülasyonu)', label: 'Tabakalar', value: fmt(s.soilRho1, 0) + ' / ' + fmt(s.soilRho2, 0) + ' Ω·m · üst tabaka ' + fmt(s.soilH, 1) + ' m' }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-15, 15] },
    view2d: view2d
  });
})();
