/* VoltSim · 3D Topraklama ve Elektrik Güvenliği Simülasyonu
 * Hesap: VoltSimEngine.topraklama (Dwight çubuk/şerit, BS 7430 çubuk dizisi, IEEE 80 ağ direnci, Em/Es,
 * izin verilen dokunma/adım gerilimi, TT/TN/IT koşulları).
 * Sahne: kesitli toprak bloğu, elektrotlar, trafo köşkü ve eşpotansiyel bağlantılar; yüzey potansiyeli
 * motorun R ve GPR değerine normalize edilmiş yaklaşık bir çizgi-kaynak modeliyle renklendirilir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const G = E.topraklama;
  const ROD_TOP = 0.5; // çubuk başı gömme derinliği (m), görsel ve potansiyel modeli için

  function defaults() {
    return {
      rho: 150, rhoS: 3000, hs: 0.1,
      electrode: 'rod', L: 3, d: 0.02, n: 3, s: 6, Lstrip: 40, h: 0.8, w: 0.03, meshA: 400, meshD: 5,
      system: 'TT', IdN_mA: 300, UL: 50, IF: 150, tf: 0.5
    };
  }
  const SYS = { TT: 'TT', TN: 'TN', IT: 'IT' };
  const EL_NAME = { rod: 'Düşey çubuk', strip: 'Yatay şerit', mesh: 'Topraklama ağı' };

  /* ---------------------------------------------------------------- yaklaşık yüzey potansiyeli
   * Her iletken, boyunca düzgün akım dağılımlı çizgi kaynak kabul edilir. Homojen yarı uzayda yüzeydeki P noktasının
   * potansiyeli (görüntü kaynağı dahil): V = ρ·I_c/(2π·L_c) · ∫ dl/D. Toplam, motorun GPR = IF·R değerine bölünerek
   * 0…1 aralığına normalize edilir (ρ sadeleşir; R motordan gelir). Sayısal kabul kontrolleri motorundur. */
  function conductors(s, v) {
    const out = [];
    if (s.electrode === 'rod') {
      const n = Math.round(s.n);
      for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * s.s; out.push({ a: [x, -ROD_TOP, 0], b: [x, -ROD_TOP - s.L, 0], k: 1 / (n * s.L) }); }
    } else if (s.electrode === 'strip') {
      out.push({ a: [-s.Lstrip / 2, -s.h, 0], b: [s.Lstrip / 2, -s.h, 0], k: 1 / s.Lstrip });
    } else {
      const side = Math.sqrt(s.meshA), nm = v.nMesh, LT = v.LT, sp = side / (nm - 1);
      for (let j = 0; j < nm; j++) {
        const c = -side / 2 + j * sp;
        out.push({ a: [-side / 2, -s.h, c], b: [side / 2, -s.h, c], k: 1 / LT });
        out.push({ a: [c, -s.h, -side / 2], b: [c, -s.h, side / 2], k: 1 / LT });
      }
    }
    return out;
  }
  /** ∫ dl/|P − X(l)| bir doğru parçası boyunca (asinh biçimi). */
  function segInt(c, x, z) {
    const ax = c.a[0], ay = c.a[1], az = c.a[2];
    let ux = c.b[0] - ax, uy = c.b[1] - ay, uz = c.b[2] - az;
    const Ls = Math.hypot(ux, uy, uz); ux /= Ls; uy /= Ls; uz /= Ls;
    const px = x - ax, py = -ay, pz = z - az;
    const t0 = px * ux + py * uy + pz * uz;
    const p = Math.max(Math.sqrt(Math.max(px * px + py * py + pz * pz - t0 * t0, 0)), 0.01);
    return Math.asinh((Ls - t0) / p) - Math.asinh(-t0 / p);
  }
  /** Yüzeyde (x, z) noktasındaki potansiyel / GPR (0…1). */
  function makePot(s, v) {
    const cs = conductors(s, v);
    const R = v.R, rho = s.rho;
    const f = (x, z) => { let sum = 0; for (let i = 0; i < cs.length; i++) sum += cs[i].k * segInt(cs[i], x, z); return Math.min(1, rho / (2 * Math.PI * R) * sum); };
    f.cs = cs; return f;
  }

  /* ---------------------------------------------------------------- geometri yerleşimi */
  function extent(s, v) {
    if (s.electrode === 'rod') return (Math.round(s.n) - 1) * s.s / 2 + 1;
    if (s.electrode === 'strip') return s.Lstrip / 2;
    return Math.sqrt(s.meshA) / 2 + (v ? 0 : 0);
  }
  function siteOf(s) {
    const ext = extent(s);
    const Gh = E.clamp(ext + 5.5, 8.5, 40);
    const kx = -Math.max(2.4, Math.min(ext * 0.45, 8)), kz = -Math.max(2.5, Math.min(ext * 0.35, 6));
    // insanlar: dokunma (köşk kapısına), adım (elektrot yanında, ayaklar 1 m arayla, iletkene dik)
    const touch = { x: kx + 0.55, z: kz + 1.2 + 1.0 };
    let step;
    if (s.electrode === 'rod') { const n = Math.round(s.n); let xr = Infinity; for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * s.s; if (x > -1e-9 && x < xr) xr = x; } step = { x: xr, z1: -0.5, z2: -1.5 }; }
    else if (s.electrode === 'strip') step = { x: Math.min(s.Lstrip * 0.25, 8), z1: -0.5, z2: -1.5 };
    else { const side = Math.sqrt(s.meshA); step = { x: Math.min(side * 0.12, 4), z1: -(side / 2 - 0.5), z2: -(side / 2 + 0.5) }; }
    return { ext: ext, Gh: Gh, kx: kx, kz: kz, aebX: kx + 1.25, aebZ: kz + 1.23, touch: touch, step: step, depth: s.electrode === 'rod' ? Math.max(ROD_TOP + s.L + 1.2, 3.2) : 3.2 };
  }
  /** Görsel modelden dokunma ve adım gerilimi (V): yalnız çubuk/şerit için gösterilir, "≈" ile. */
  function modelVoltages(s, v) {
    const f = makePot(s, v), st = siteOf(s);
    const vt = f(st.touch.x, st.touch.z);
    const vs1 = f(st.step.x, st.step.z1), vs2 = f(st.step.x, st.step.z2);
    return { touch: v.GPR * (1 - vt), step: v.GPR * Math.abs(vs1 - vs2), f: f, site: st };
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = s.electrode === 'mesh' ? G.compute(s).values : null;
    const groups = [];
    void app;
    groups.push({ title: 'Toprak', items: [
      { type: 'range', key: 'rho', label: 'Toprak özdirenci ρ', min: 10, max: 3000, step: 10, unit: 'Ω·m', help: 'Islak killi toprak 20–100, kumlu 200–1000, kayalık > 1000 Ω·m. Wenner yöntemiyle ölçülmelidir.' },
      { type: 'range', key: 'hs', label: 'Yüzey tabakası kalınlığı (çakıl/asfalt)', min: 0, max: 0.3, step: 0.01, unit: 'm', digits: 2 },
      s.hs > 0 ? { type: 'select', key: 'rhoS', label: 'Yüzey tabakası özdirenci ρs', options: [[1000, '1000 Ω·m · nemli çakıl'], [3000, '3000 Ω·m · kuru kırma taş'], [5000, '5000 Ω·m · asfalt'], [10000, '10 000 Ω·m · kuru asfalt']] } : null
    ] });
    groups.push({ title: 'Elektrot', items: [
      { type: 'seg', key: 'electrode', label: 'Elektrot tipi', options: [['rod', 'Çubuk'], ['strip', 'Şerit'], ['mesh', 'Ağ']] },
      s.electrode === 'rod' ? { type: 'range', key: 'n', label: 'Çubuk sayısı (sıra halinde)', min: 1, max: 10, step: 1 } : null,
      s.electrode === 'rod' ? { type: 'range', key: 'L', label: 'Çubuk boyu L', min: 1, max: 12, step: 0.5, unit: 'm', digits: 1 } : null,
      s.electrode === 'rod' && s.n > 1 ? { type: 'range', key: 's', label: 'Çubuk aralığı s', min: 1, max: 20, step: 0.5, unit: 'm', digits: 1, help: 'Karşılıklı etkiyi azaltmak için s ≥ L (tercihen 2L) önerilir.' } : null,
      s.electrode === 'rod' ? { type: 'select', key: 'd', label: 'Çubuk çapı', options: [[0.014, '14 mm'], [0.016, '16 mm'], [0.02, '20 mm'], [0.025, '25 mm']] } : null,
      s.electrode === 'strip' ? { type: 'range', key: 'Lstrip', label: 'Şerit boyu', min: 5, max: 200, step: 1, unit: 'm' } : null,
      s.electrode === 'strip' ? { type: 'select', key: 'w', label: 'Şerit genişliği', options: [[0.02, '20 mm'], [0.025, '25 mm'], [0.03, '30 mm'], [0.04, '40 mm']] } : null,
      s.electrode === 'mesh' ? { type: 'range', key: 'meshA', label: 'Ağ alanı A', min: 25, max: 2500, step: 25, unit: 'm²' } : null,
      s.electrode === 'mesh' ? { type: 'range', key: 'meshD', label: 'Göz aralığı D', min: 1, max: 20, step: 0.5, unit: 'm', digits: 1 } : null,
      s.electrode !== 'rod' ? { type: 'range', key: 'h', label: 'Gömme derinliği h', min: 0.3, max: 1.5, step: 0.05, unit: 'm', digits: 2 } : null,
      r && s.electrode === 'mesh' ? { type: 'note', html: 'Ağ: <b>' + r.nMesh + ' × ' + r.nMesh + '</b> iletken · toplam iletken boyu L<sub>T</sub> <b>' + fmt(r.LT, 0, 'm') + '</b>' } : null
    ] });
    groups.push({ title: 'Sistem tipi ve koruma', items: [
      { type: 'seg', key: 'system', label: 'AG sistem tipi', options: [['TT', 'TT'], ['TN', 'TN'], ['IT', 'IT']] },
      s.system !== 'TN' ? { type: 'select', key: 'IdN_mA', label: s.system === 'TT' ? 'Kaçak akım koruma IΔn' : 'İlk arıza akımı Id', options: [[30, '30 mA'], [100, '100 mA'], [300, '300 mA'], [500, '500 mA'], [1000, '1 A'], [3000, '3 A']] } : null,
      { type: 'select', key: 'UL', label: 'Sınır dokunma gerilimi UL', options: [[50, '50 V (normal ortam)'], [25, '25 V (ıslak / tarım)']] },
      { type: 'note', html: s.system === 'TT' ? 'TT: kabul ölçütü <b>RA·IΔn ≤ UL</b>. Ohm sınırı koruma cihazına bağlıdır: ' + [30, 300, 1000].map(i => i + ' mA → ' + fmt(s.UL / (i / 1000), 0) + ' Ω').join(', ') + '.'
        : s.system === 'TN' ? 'TN: arıza akımı PE üzerinden kaynağa döner; kabul ölçütü <b>Zs·Ia ≤ U0</b> (çevrim empedansı). Elektrot direnci tek başına ölçüt değildir.'
          : 'IT: ilk arızada <b>RA·Id ≤ UL</b>; ikinci arızada TN/TT koşulları geçerlidir. Yalıtım izleme cihazı zorunludur.' }
    ] });
    groups.push({ title: 'Arıza (OG tarafı / GPR)', items: [
      { type: 'range', key: 'IF', label: 'Toprağa akan arıza akımı IF', min: 0, max: 3000, step: 10, unit: 'A', help: 'Elektrottan toprağa geçen kısım (OG nötr topraklama yöntemine ve dönüş yollarına bağlıdır).' },
      { type: 'range', key: 'tf', label: 'Arıza temizleme süresi tf', min: 0.05, max: 3, step: 0.05, unit: 's', digits: 2 },
      { type: 'note', text: 'Simülasyonu başlat: tf süreli arıza akımı darbesi uygulanır (yavaşlatılmış). Yüzey rengi yaklaşık potansiyel dağılımıdır; sayısal kabul kontrolleri hesap motorundandır.' }
    ] });
    return groups;
  }

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
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);
  const fmtV = V => (Math.abs(V) >= 1e4 ? fmt(V / 1e3, 1, 'kV') : fmt(V, 0, 'V'));
  function readouts(res, s, live) {
    const v = res.values;
    const sysC = chk(res, s.system === 'TT' ? 'tt' : s.system === 'TN' ? 'tn' : 'it');
    const out = [
      { label: 'Topraklama direnci R', value: fmt(v.R, v.R < 10 ? 2 : 1, 'Ω'), sub: EL_NAME[s.electrode] + (s.electrode === 'rod' ? ' · ' + Math.round(s.n) + ' × ' + fmt(s.L, 1) + ' m' : s.electrode === 'strip' ? ' · ' + fmt(s.Lstrip, 0) + ' m' : ' · ' + fmt(s.meshA, 0) + ' m²') + ' · ρ ' + fmt(s.rho, 0) + ' Ω·m' },
      { label: 'RA sınırı (UL/IΔn)', value: fmt(v.RAmax, 0, 'Ω'), sub: s.system === 'TN' ? 'TN’de ölçüt değil' : 'UL ' + s.UL + ' V · ' + (s.system === 'TT' ? 'IΔn ' : 'Id ') + s.IdN_mA + ' mA', level: s.system === 'TN' ? undefined : (v.R <= v.RAmax ? 'ok' : 'bad') },
      { label: 'Sistem tipi koşulu · ' + s.system, value: sysC ? (sysC.status === 'ok' ? 'Sağlanıyor' : sysC.status === 'fail' ? 'Sağlanmıyor' : sysC.status === 'warn' ? 'Uyarı' : 'Çevrim empedansına bağlı') : '—', level: lvOf(sysC), wide: true, sub: sysC ? sysC.detail : '' },
      { label: 'Toprak potansiyel yükselmesi GPR', value: fmtV(v.GPR), sub: 'IF ' + fmt(s.IF, 0) + ' A × R' },
      { label: 'İzin verilen dokunma', value: fmtV(v.Etouch), sub: 'IEEE 80 · 50 kg · tf ' + fmt(s.tf, 2) + ' s' + (s.hs > 0 ? ' · Cs ' + fmt(v.Cs, 2) : '') },
      { label: 'İzin verilen adım', value: fmtV(v.Estep), sub: s.hs > 0 ? 'yüzey ρs ' + fmt(s.rhoS, 0) + ' Ω·m · ' + fmt(s.hs * 100, 0) + ' cm' : 'yüzey tabakası yok' }
    ];
    if (s.electrode === 'mesh' && v.Em !== null) {
      out.push({ label: 'Ağ dokunma gerilimi Em', value: fmtV(v.Em), level: v.Em <= v.Etouch ? 'ok' : 'bad', sub: 'IEEE 80 (hesap motoru)' });
      out.push({ label: 'Ağ adım gerilimi Es', value: fmtV(v.Es), level: v.Es <= v.Estep ? 'ok' : 'bad', sub: 'IEEE 80 (hesap motoru)' });
    } else if (s.IF > 0) {
      const m = modelVoltages(s, v);
      out.push({ label: 'Dokunma ≈ (görsel model)', value: fmtV(m.touch), level: m.touch <= v.Etouch ? 'ok' : 'warn', sub: 'yaklaşık; motor GPR ≤ E_dokunma ile karşılaştırır' });
      out.push({ label: 'Adım ≈ (görsel model)', value: fmtV(m.step), level: m.step <= v.Estep ? 'ok' : 'warn', sub: 'insan konumunda, 1 m adım' });
    }
    const f = live.fault;
    if (f) out.push({ label: 'Arıza darbesi', wide: true, value: !f.done ? 't = ' + fmt(Math.min(f.t / f.dur * s.tf, s.tf), 2) + ' / ' + fmt(s.tf, 2) + ' s · akım akıyor' : 'Temizlendi', level: !f.done ? 'warn' : undefined, sub: live.events.length ? live.events[live.events.length - 1] : '' });
    return out;
  }

  function charts(res, s, live) {
    const v = res.values, m = modelVoltages(s, v), f = m.f, ch = [];
    const unitV = v.GPR > 0, k = unitV ? v.GPR : 100;
    // profil: elektrotun ortasından dik doğrultuda (çubuk/şerit) veya ağ merkezinden dışa
    const side = Math.sqrt(s.meshA);
    const xr = s.electrode === 'rod' ? m.site.step.x : 0;
    const len = s.electrode === 'mesh' ? side / 2 + 15 : 18;
    const P = [], Ut = [], Us = [];
    for (let d = 0; d <= len + 1e-9; d += len / 120) {
      const p = s.electrode === 'mesh' ? f(d, 0) : f(xr, -d);
      const p1 = s.electrode === 'mesh' ? f(d + 1, 0) : f(xr, -d - 1);
      P.push([d, p * k]); Ut.push([d, (1 - p) * k]); Us.push([d, Math.abs(p - p1) * k]);
    }
    let iMax = 0; Us.forEach((p, i) => { if (p[1] > Us[iMax][1]) iMax = i; });
    ch.push({ id: 'prof', title: 'Yüzey potansiyeli ve dokunma gerilimi profili (yaklaşık)', height: 170,
      series: [{ name: 'Yüzey potansiyeli V(x)', color: 'cyan', area: true, data: P }, { name: 'Dokunma ≈ GPR − V(x)', color: 'amber', data: Ut }],
      hLines: unitV ? [{ y: v.Etouch, label: 'E_dokunma izin ' + fmtV(v.Etouch), color: '#ef4444' }] : [],
      x: { label: s.electrode === 'mesh' ? 'ağ merkezinden m' : 'elektrottan dik uzaklık m', min: 0, max: len }, y: { label: unitV ? 'V' : '% GPR', min: 0 },
      alt: 'GPR ' + fmtV(v.GPR) + '. Elektrot üzerinde potansiyel en yüksek, uzaklaştıkça 1/r biçiminde azalır; dokunma gerilimi uzaklıkla artar. İzin verilen dokunma ' + fmtV(v.Etouch) + '. Normalize çizgi-kaynak modeli; sayısal kontroller motordan.' });
    ch.push({ id: 'step', title: 'Adım gerilimi profili (1 m, yaklaşık)', height: 140,
      series: [{ name: 'Adım ≈ V(x) − V(x + 1 m)', color: 'violet', area: true, data: Us }],
      hLines: unitV ? [{ y: v.Estep, label: 'E_adım izin ' + fmtV(v.Estep), color: '#ef4444' }] : [],
      markers: [{ x: Us[iMax][0], label: 'maks. ≈ ' + (unitV ? fmtV(Us[iMax][1]) : '%' + fmt(Us[iMax][1], 1)), color: '#fcd34d' }],
      x: { label: 'm', min: 0, max: len }, y: { label: unitV ? 'V' : '% GPR', min: 0 },
      alt: 'En büyük adım gerilimi elektrot kenarında ≈ ' + (unitV ? fmtV(Us[iMax][1]) : '%' + fmt(Us[iMax][1], 1) + ' GPR') + '; izin verilen ' + fmtV(v.Estep) + '.' });
    // R – tasarım parametresi (motor yardımcılarıyla)
    let rs, xl, title, cur;
    if (s.electrode === 'rod') { rs = []; for (let n = 1; n <= 10; n++) rs.push([n, G.rodsInLine(s.rho, s.L, s.d, n, s.s)]); xl = 'çubuk sayısı'; title = 'Topraklama direnci – çubuk sayısı (s = ' + fmt(s.s, 1) + ' m)'; cur = Math.round(s.n); }
    else if (s.electrode === 'strip') { rs = []; for (let L = 5; L <= 200; L += 5) rs.push([L, G.strip(s.rho, L, s.h, s.w / 4)]); xl = 'şerit boyu m'; title = 'Topraklama direnci – şerit boyu'; cur = s.Lstrip; }
    else { rs = []; const A = s.meshA, sd = Math.sqrt(A); for (let D = 1; D <= 20; D += 0.5) { const nm = Math.max(2, Math.round(sd / D) + 1); rs.push([D, G.mesh(s.rho, 2 * nm * sd, A, s.h)]); } xl = 'göz aralığı D m'; title = 'Ağ direnci – göz aralığı (A = ' + fmt(s.meshA, 0) + ' m²)'; cur = s.meshD; }
    ch.push({ id: 'rn', title: title, height: 150,
      series: [{ name: 'R (Ω)', color: 'green', data: rs }],
      hLines: s.system !== 'TN' ? [{ y: v.RAmax, label: 'RA sınırı ' + fmt(v.RAmax, 0) + ' Ω', color: '#ef4444' }] : [],
      markers: [{ x: cur, y: v.R, label: fmt(v.R, 1) + ' Ω', color: '#fcd34d' }],
      x: { label: xl }, y: { label: 'Ω', min: 0, max: Math.max.apply(null, rs.map(p => p[1])) * 1.1 },
      alt: rs.filter((p, i) => i % Math.ceil(rs.length / 8) === 0).map(p => fmt(p[0], 1) + ': ' + fmt(p[1], 1) + ' Ω').join(', ') + '. Seçili tasarım ' + fmt(v.R, 1) + ' Ω.' });
    // izin verilen gerilimler – arıza süresi (motor bağıntısı, tf taranarak)
    const et = [], es = [];
    for (let t = 0.1; t <= 3.0001; t += 0.1) { const r = G.compute(Object.assign({}, s, { tf: t })).values; et.push([t, r.Etouch]); es.push([t, r.Estep]); }
    const actual = s.electrode === 'mesh' ? v.Em : (s.IF > 0 ? m.touch : null);
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
    return s.electrode + '|' + (s.electrode === 'rod' ? [Math.round(s.n), s.L, s.s, s.d].join(',') : s.electrode === 'strip' ? [s.Lstrip, s.w, s.h].join(',') : [s.meshA, s.meshD, s.h].join(',')) + '|' + (s.hs > 0);
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
    // senaryo yüklemede sahne, yeniden hesaptan önce kurulur: geometri her zaman güncel girdilerden hesaplanır
    const val = G.compute(s).values;
    const st = siteOf(s), Gh = st.Gh, D = st.depth;
    const sc = { flows: [], bodyFlows: [] };
    app.scene3 = sc;
    // ---- toprak bloğu: L biçimli kesit (ön-sağ çeyrek açık), üç katman
    const tex = soilTexture(T);
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
    const pot = makePot(s, val);
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
    k.pickable(surf, 'Yüzey potansiyeli (yaklaşık)', () => ['Renk: V/GPR (mavi düşük → kırmızı GPR).', 'Çizgi-kaynak modeli, motorun R ve GPR değerine normalize edilmiştir; kabul kontrolleri motordandır.', 'GPR = ' + fmtV(app.validResult ? app.validResult.values.GPR : 0)]);

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
      k.pickable(el, 'Topraklama çubukları', () => { const r = app.validResult && app.validResult.values; return r ? [n + ' × ' + fmt(s.L, 1) + ' m · Ø ' + fmt(s.d * 1000, 0) + ' mm · aralık ' + fmt(s.s, 1) + ' m', 'R1 = ' + fmt(G.rod(s.rho, s.L, s.d), 1) + ' Ω (tek çubuk, Dwight) → R = ' + fmt(r.R, 2) + ' Ω (BS 7430 sıra katsayısı)', 'Çubukları birleştiren şeridin katkısı hesaba katılmamıştır (güvenli taraf).'] : []; });
      sc.feed = [list.reduce((a, x) => (Math.abs(x - st.aebX) < Math.abs(a - st.aebX) ? x : a), list[0]), -ROD_TOP + 0.04, 0];
      list.forEach(x => {
        sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, -ROD_TOP, 0.02), new T.Vector3(x, -ROD_TOP - s.L, 0.02)), 10, 0xfb923c, 0.03));
        [[1, 0], [-1, 0], [0, -1], [0.7, -0.7]].forEach(dd => { const y = -ROD_TOP - s.L * 0.55; sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, y, 0), new T.Vector3(x + dd[0] * 1.6, y - 0.6, dd[1] * 1.6)), 6, 0xf97316, 0.025)); });
      });
    } else if (s.electrode === 'strip') {
      k.box(s.Lstrip, 0.012, Math.max(s.w, 0.03) * 1.4, gv, 0, -s.h, 0, el);
      k.pickable(el, 'Yatay topraklama şeridi', () => { const r = app.validResult && app.validResult.values; return r ? ['Galvaniz şerit ' + fmt(s.Lstrip, 0) + ' m × ' + fmt(s.w * 1000, 0) + ' mm, derinlik ' + fmt(s.h, 2) + ' m', 'R = ' + fmt(r.R, 2) + ' Ω (Dwight, eşdeğer yarıçap a = w/4)'] : []; });
      sc.feed = [E.clamp(st.aebX, -s.Lstrip / 2, s.Lstrip / 2), -s.h, 0];
      for (let x = -s.Lstrip / 2 + 1; x < s.Lstrip / 2; x += Math.max(2, s.Lstrip / 10)) [[0, 1], [0, -1]].forEach(dd => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(x, -s.h, 0), new T.Vector3(x, -s.h - 0.8, dd[1] * 1.4)), 5, 0xf97316, 0.025)));
      sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(-s.Lstrip / 2, -s.h + 0.02, 0.03), new T.Vector3(s.Lstrip / 2, -s.h + 0.02, 0.03)), 30, 0xfb923c, 0.03));
    } else {
      const side = Math.sqrt(s.meshA), nm = val.nMesh, sp = side / (nm - 1);
      const geoX = new T.BoxGeometry(side, 0.016, 0.016), geoZ = new T.BoxGeometry(0.016, 0.016, side);
      const ix = new T.InstancedMesh(geoX, cu, nm), iz = new T.InstancedMesh(geoZ, cu, nm), dm = new T.Object3D();
      for (let j = 0; j < nm; j++) { const c = -side / 2 + j * sp; dm.position.set(0, -s.h, c); dm.updateMatrix(); ix.setMatrixAt(j, dm.matrix); dm.position.set(c, -s.h, 0); dm.updateMatrix(); iz.setMatrixAt(j, dm.matrix); }
      ix.castShadow = iz.castShadow = true; el.add(ix); el.add(iz);
      k.pickable(el, 'Topraklama ağı', () => { const r = app.validResult && app.validResult.values; return r ? [nm + ' × ' + nm + ' bakır iletken · D ≈ ' + fmt(sp, 2) + ' m · h = ' + fmt(s.h, 2) + ' m', 'L_T = ' + fmt(r.LT, 0) + ' m · R = ' + fmt(r.R, 2) + ' Ω (IEEE 80 Sverak)', 'Em = ' + fmtV(r.Em) + ' · Es = ' + fmtV(r.Es)] : []; });
      sc.feed = [E.clamp(st.aebX, -side / 2, side / 2), -s.h, E.clamp(Math.round((st.aebZ + side / 2) / sp) * sp - side / 2, -side / 2, side / 2)];
      for (let j = 0; j < nm; j += Math.max(1, Math.floor(nm / 5))) { const c = -side / 2 + j * sp; sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(-side / 2, -s.h + 0.02, c), new T.Vector3(side / 2, -s.h + 0.02, c)), 16, 0xfb923c, 0.035)); }
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(q => sc.flows.push(k.flow(new T.LineCurve3(new T.Vector3(q[0] * side / 2, -s.h, q[1] * side / 2), new T.Vector3(q[0] * (side / 2 + 2), -s.h - 1, q[1] * (side / 2 + 2))), 6, 0xf97316, 0.03)));
    }
    sc.elLabel = k.label('R', null, s.electrode === 'mesh' ? [Math.sqrt(s.meshA) / 4, 0.3, Math.sqrt(s.meshA) / 4] : [s.electrode === 'rod' ? (Math.round(s.n) > 1 ? ((Math.round(s.n) - 1) / 2) * s.s : 0) : s.Lstrip / 4, -0.2, 0.1]);

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
    k.pickable(kio, 'Trafo köşkü (prefabrik beton)', () => ['Metal kapılar, trafo tankı ve AG pano gövdesi ana eşpotansiyel baraya bağlıdır.', 'Arızada bu gövdeler GPR potansiyeline yükselir: dokunma gerilimi = GPR − ayak potansiyeli.', s.system + ' sistemi · ' + (s.system === 'TT' ? 'RCD ' + s.IdN_mA + ' mA' : s.system === 'TN' ? 'PE ile kaynağa dönüş' : 'yalıtım izleme')]);
    k.label('Trafo köşkü', kio, [0, kh + 0.5, 0]);
    // ana eşpotansiyel bara (AEB) — köşk ön duvarında, sağ altta
    const aebX = st.aebX, aebY = 0.55, aebZ = st.aebZ;
    const aeb = k.group(null, aebX, aebY, aebZ);
    k.box(0.5, 0.18, 0.02, M.plasticDark, 0, 0, 0, aeb);
    k.box(0.42, 0.04, 0.015, M.copper, 0, 0, 0.018, aeb);
    for (let j = 0; j < 6; j++) k.cyl(0.008, 0.008, 0.02, M.brass, -0.18 + j * 0.072, 0, 0.03, aeb, 8).rotation.x = Math.PI / 2;
    k.pickable(aeb, 'Ana eşpotansiyel bara (AEB)', () => ['Topraklama iletkeni, PE iletkenleri ve yabancı iletken kısımlar (metal boru, çelik konstrüksiyon) burada birleşir.', 'Eşpotansiyel bağlantı, bina içindeki dokunma gerilimini sınırlar; bina dışında yüzey potansiyeli belirleyicidir.', 'TS HD 60364-5-54 · Topraklamalar Yönetmeliği']);
    k.label('Ana eşpotansiyel bara', aeb, [0, 0.15, 0], 'vs-label--sm');
    // metal su borusu (yabancı iletken kısım): topraktan çıkıp duvara girer
    const pipeX = st.kx + 1.42;
    k.tube([[pipeX, -0.9, aebZ + 0.35], [pipeX, 0.2, aebZ + 0.35], [pipeX, 1.0, aebZ + 0.32], [pipeX, 1.05, aebZ - 0.05]], 0.03, M.galv, v.root);
    const pec = M.PE;
    const pe = (pts, r) => k.tube(pts, r || 0.008, pec, v.root);
    pe([[aebX + 0.15, aebY + 0.02, aebZ + 0.03], [aebX + 0.2, aebY + 0.2, aebZ + 0.15], [pipeX, 0.95, aebZ + 0.3]]);                 // boru
    pe([[aebX - 0.15, aebY + 0.02, aebZ + 0.03], [aebX - 0.32, aebY + 0.3, aebZ + 0.04], [st.kx + 0.18, 0.9, aebZ - 0.03]]);         // kapı çerçevesi
    pe([[aebX - 0.05, aebY + 0.02, aebZ + 0.02], [aebX - 0.3, aebY + 0.1, aebZ - 0.2], [st.kx + 0.6, 0.6, st.kz - 0.4]]);             // AG pano (iç)
    pe([[aebX - 0.1, aebY + 0.02, aebZ + 0.02], [aebX - 1.2, aebY + 0.2, aebZ - 0.3], [st.kx - 0.4, 0.7, st.kz - 0.1]]);              // trafo tankı (iç)
    // topraklama iletkeni: AEB → toprak → elektrot
    const fd = sc.feed;
    const earthPts = [[aebX + 0.05, aebY - 0.08, aebZ + 0.03], [aebX + 0.05, -0.3, aebZ + 0.1], [aebX + 0.05, fd[1] + 0.05, aebZ + 0.2], [(aebX + fd[0]) / 2, fd[1] + 0.04, (aebZ + fd[2]) / 2 + 0.3], [fd[0], fd[1] + 0.04, fd[2] + 0.04]];
    const earth = k.tube(earthPts, 0.012, M.galv, v.root);
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
    sc.stepLbl = k.label('Adım', pS.g, [0, 1.95, 0]);
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
    const r = app.validResult && app.validResult.values, s = app.state; if (!r) return [];
    const m = modelVoltages(s, r);
    return ['El: köşk kapısı (AEB’ye bağlı, potansiyel = GPR) · ayaklar yapıdan 1 m uzakta', s.electrode === 'mesh' ? 'Ağ dokunma gerilimi Em = ' + fmtV(r.Em) + ' (IEEE 80, motor)' : 'Dokunma ≈ GPR − V(ayak) = ' + fmtV(m.touch) + ' (yaklaşık görsel model)', 'İzin verilen: ' + fmtV(r.Etouch) + ' (IEEE 80, tf = ' + fmt(s.tf, 2) + ' s)', 'Önlem: yüzeye yüksek özdirençli çakıl/asfalt, potansiyel düzenleyici halka, ağ sıklaştırma'];
  }
  function stepInfo(app) {
    const r = app.validResult && app.validResult.values, s = app.state; if (!r) return [];
    const m = modelVoltages(s, r);
    return [s.electrode === 'mesh' ? 'Ağ adım gerilimi Es = ' + fmtV(r.Es) + ' (IEEE 80, motor)' : 'Adım ≈ |V(ayak1) − V(ayak2)| = ' + fmtV(m.step) + ' (yaklaşık görsel model)', 'İzin verilen: ' + fmtV(r.Estep) + ' (IEEE 80)', 'Potansiyel gradyanı en çok elektrot kenarında yüksektir.'];
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
    const sc = app.scene3; if (!sc) return;
    const v = res.values;
    sc.pot = makePot(s, v);
    const m = modelVoltages(s, v);
    sc.elLabel.set('R = ' + fmt(v.R, v.R < 10 ? 2 : 1, 'Ω') + ' · GPR ' + fmtV(v.GPR));
    sc.elLabel.level(s.system === 'TN' ? '' : v.R <= v.RAmax ? 'ok' : 'bad');
    const ut = s.electrode === 'mesh' ? v.Em : m.touch, us = s.electrode === 'mesh' ? v.Es : m.step, ap = s.electrode === 'mesh' ? '' : '≈ ';
    sc.touchLbl.set('Dokunma ' + ap + fmtV(ut) + ' (izin ' + fmtV(v.Etouch) + ')');
    sc.touchLbl.level(s.IF <= 0 ? '' : ut <= v.Etouch ? 'ok' : 'bad');
    sc.stepLbl.set('Adım ' + ap + fmtV(us) + ' (izin ' + fmtV(v.Estep) + ')');
    sc.stepLbl.level(s.IF <= 0 ? '' : us <= v.Estep ? 'ok' : 'bad');
    sc.overT = ut > v.Etouch; sc.overS = us > v.Estep;
    sc.amt = -1; // yeniden boya
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const f = live.fault, active = f && !f.done && res.values.GPR > 0;
    // hedef yoğunluk: arızada 1, aksi halde soluk desen
    const tgt = active ? 1 : 0.4;
    sc.cur = sc.cur === undefined ? tgt : sc.cur + (tgt - sc.cur) * Math.min(1, dt * (k.reducedMotion ? 100 : 5));
    if (sc.amt < 0 || Math.abs(sc.cur - sc.amt) > 0.02) paint(k, sc, sc.cur);
    sc.flows.forEach(fl => { fl.speed = active ? 0.55 : 0; });
    sc.bodyFlows.forEach((fl, i) => { fl.speed = active && (i === 0 ? sc.overT : sc.overS) ? 0.8 : 0; });
  }

  /* ---------------------------------------------------------------- 2D kesit şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values, m = modelVoltages(s, v), st = m.site;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', soil: '#4a3424', cu: '#c77b4a' };
    const gy = H * 0.5, half = Math.max(st.ext + 5, 10);
    const sx = (W - 150) / (2 * half), X = x => (W - 70) / 2 + x * sx;
    const dScale = Math.min(sx, (H - gy - 40) / (st.depth + 0.3)), Yd = d => gy + d * dScale;
    // toprak kesiti
    g.fillStyle = col.soil; g.fillRect(40, gy, W - 110, H - gy - 30);
    g.fillStyle = '#5b3f2b'; g.fillRect(40, gy, W - 110, 0.35 * dScale);
    g.strokeStyle = col.line; g.lineWidth = 2; g.beginPath(); g.moveTo(30, gy); g.lineTo(W - 70, gy); g.stroke();
    g.font = '11px Inter, sans-serif'; g.fillStyle = col.dim; g.textAlign = 'left'; g.fillText('ρ = ' + fmt(s.rho, 0) + ' Ω·m', 46, gy + 0.35 * dScale + 16);
    // elektrot kesiti (x ekseni boyunca)
    g.strokeStyle = col.cu; g.fillStyle = col.cu; g.lineWidth = 3;
    if (s.electrode === 'rod') { const n = Math.round(s.n); for (let i = 0; i < n; i++) { const x = X((i - (n - 1) / 2) * s.s); g.beginPath(); g.moveTo(x, Yd(ROD_TOP)); g.lineTo(x, Yd(ROD_TOP + s.L)); g.stroke(); } if (n > 1) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-(n - 1) / 2 * s.s), Yd(ROD_TOP)); g.lineTo(X((n - 1) / 2 * s.s), Yd(ROD_TOP)); g.stroke(); } }
    else if (s.electrode === 'strip') { g.beginPath(); g.moveTo(X(-s.Lstrip / 2), Yd(s.h)); g.lineTo(X(s.Lstrip / 2), Yd(s.h)); g.stroke(); }
    else { const side = Math.sqrt(s.meshA), nm = v.nMesh; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(-side / 2), Yd(s.h)); g.lineTo(X(side / 2), Yd(s.h)); g.stroke(); for (let j = 0; j < nm; j++) { g.beginPath(); g.arc(X(-side / 2 + j * side / (nm - 1)), Yd(s.h), 2.5, 0, Math.PI * 2); g.fill(); } }
    // köşk ve AEB
    const kx0 = X(st.kx - 1.6), kx1 = X(st.kx + 1.6), kTop = gy - Math.max(56, 2.6 * Math.min(sx, 40));
    g.strokeStyle = col.line; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.strokeRect(kx0, kTop, kx1 - kx0, gy - kTop); g.setLineDash([]);
    g.fillStyle = col.text; g.textAlign = 'center'; g.textAlign = 'left'; g.fillText('Köşk (arkada)', kx0 + 4, kTop + 14); g.textAlign = 'center';
    g.strokeStyle = '#7fb800'; g.beginPath(); g.moveTo(X(st.kx + 1.25), gy - 8); g.lineTo(X(st.kx + 1.25), Yd(0.5)); g.lineTo(X(st.feedX !== undefined ? st.feedX : 0), Yd(0.5)); g.stroke();
    g.fillStyle = '#7fb800'; g.textAlign = 'left'; g.fillText('AEB → topraklama iletkeni', X(st.kx + 1.3), gy - 12);
    // yüzey potansiyeli eğrisi (x ekseni, z = adım konumu yakını)
    const top = 74, ph = gy - top - 60;
    g.strokeStyle = '#22b8cf'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 200; i++) { const x = -half + i * 2 * half / 200, p = m.f(x, -0.5); const yy = gy - 10 - p * ph; if (i) g.lineTo(X(x), yy); else g.moveTo(X(x), yy); }
    g.stroke();
    g.fillStyle = '#22b8cf'; g.textAlign = 'right'; g.fillText('V(x) / GPR · yaklaşık (z = −0,5 m)', W - 76, top - 10);
    g.strokeStyle = 'rgba(239,68,68,.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(40, gy - 10 - ph); g.lineTo(W - 70, gy - 10 - ph); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fca5a5'; g.textAlign = 'left'; g.fillText('GPR = ' + fmtV(v.GPR), 44, gy - 14 - ph);
    // insanlar (çubuk adam)
    const man = (x, lbl, val, ok, dy) => { const px = X(x); g.strokeStyle = ok ? col.ok : col.bad; g.lineWidth = 2; g.beginPath(); g.arc(px, gy - 34, 4, 0, Math.PI * 2); g.moveTo(px, gy - 30); g.lineTo(px, gy - 14); g.moveTo(px - 6, gy); g.lineTo(px, gy - 14); g.lineTo(px + 6, gy); g.moveTo(px - 7, gy - 24); g.lineTo(px + 7, gy - 24); g.stroke(); g.fillStyle = ok ? col.ok : col.bad; g.textAlign = 'center'; g.fillText(lbl + ' ' + val, px, gy - 70 - (dy || 0)); };
    const ut = s.electrode === 'mesh' ? v.Em : m.touch, us = s.electrode === 'mesh' ? v.Es : m.step;
    if (s.IF > 0) { man(st.touch.x, 'Dokunma', fmtV(ut), ut <= v.Etouch); man(st.step.x, 'Adım', fmtV(us), us <= v.Estep, Math.abs(X(st.step.x) - X(st.touch.x)) < 150 ? 16 : 0); }
    // özet
    g.textAlign = 'left'; g.font = '12px Inter, sans-serif';
    const sys = chk(res, s.system === 'TT' ? 'tt' : s.system === 'TN' ? 'tn' : 'it');
    const lines = [
      [EL_NAME[s.electrode] + ' · R = ' + fmt(v.R, 2) + ' Ω · GPR = ' + fmtV(v.GPR), col.text],
      [s.system + ': ' + (sys ? sys.detail : ''), sys && sys.status === 'fail' ? col.bad : col.dim],
      ['İzin: dokunma ' + fmtV(v.Etouch) + ' · adım ' + fmtV(v.Estep) + ' (IEEE 80, tf ' + fmt(s.tf, 2) + ' s)', col.dim]
    ];
    lines.forEach((l, i) => { g.fillStyle = l[1] === col.dim ? '#c8b8a6' : l[1]; wrapText(g, l[0], W - 190, 56, H - 92 + i * 17); });
  }
  function wrapText(g, text, maxW, x, y) { if (g.measureText(text).width <= maxW) { g.fillText(text, x, y); return; } let t = text; while (t.length > 10 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); g.fillText(t + '…', x, y); }

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
      { id: 'ag', name: 'TN · trafo merkezi topraklama ağı', desc: '20 × 20 m ağ, 5 m göz, 3000 Ω·m kırma taş: IEEE 80 Em/Es izin verilen değerlerle karşılaştırılır.', state: sc({ electrode: 'mesh', system: 'TN', meshA: 400, meshD: 5, h: 0.6, IF: 1000, tf: 0.5, rho: 100 }), start: true },
      { id: 'tt-kaya', name: 'TT · kayalık zemin, tek çubuk', desc: 'ρ = 1000 Ω·m, tek 1,5 m çubuk: 300 mA RCD ile RA·IΔn ≤ 50 V sağlanmaz; 30 mA RCD ile sağlanır. Kabul ölçütü cihaza bağlıdır.', state: sc({ rho: 1000, n: 1, L: 1.5, IF: 0, hs: 0, IdN_mA: 300 }) },
      { id: 'ag-seyrek', name: 'Seyrek ağ · çakılsız yüzey', desc: 'Aynı ağ 10 m gözle ve yüzey tabakası olmadan: Em ve adım gerilimi sınırı aşar.', state: sc({ electrode: 'mesh', system: 'TN', meshA: 400, meshD: 10, h: 0.6, IF: 1000, tf: 0.5, rho: 100, hs: 0 }) },
      { id: 'serit', name: 'Temel/şerit topraklama · IT sistem', desc: '40 m yatay şerit, ρ = 200 Ω·m; IT sisteminde ilk arıza koşulu RA·Id ≤ UL ile değerlendirilir.', state: sc({ electrode: 'strip', system: 'IT', Lstrip: 40, rho: 200, IdN_mA: 1000, IF: 50, tf: 1 }) },
      { id: 'kisa-tf', name: 'Hızlı koruma · tf = 0,1 s', desc: 'Arıza süresi kısalınca izin verilen dokunma/adım gerilimi 1/√t ile artar.', state: sc({ tf: 0.1, n: 6, s: 4 }) }
    ],
    controls: controls,
    compute: s => G.compute(s),
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (live.fault && !live.fault.done && res.values.GPR > 0 ? { level: 'bad', text: 'Arıza akımı akıyor' } : null),
    reportInputs: () => [],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-15, 15] },
    view2d: view2d
  });
})();
