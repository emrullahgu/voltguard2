/* VoltSim · 3D Elektrikli Araç Şarj İstasyonu Simülasyonu
 * Hesap: VoltSimEngine.sarj (SOC → enerji, AC'de OBC faz/akım sınırı, DC'de tipik CC–CV kabul eğrisi, verim,
 * eşzamanlı noktalar için eşit "su doldurma" yük paylaşımı).
 * Sahne: motorun dakikalık zaman serisini (values.sim) hızlandırılmış oynatır. SOC çubuğu, batarya modülleri,
 * cihaz ekranları, sayaç ve kablo üzerindeki enerji akışı yalnız bu seriden okunur; animasyondan sonuç türetilmez. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const SJ = E.sarj, PROF = SJ.PROFILES;
  const MAX_DRAWN = 4;         // sahnede çizilen en çok park yeri (fazlası etikette belirtilir)
  const BAY = 3.2;             // park yeri aralığı (m)
  const ISLAND_X = 1.75;       // şarj adasının park yeri eksenine uzaklığı (m)

  function defaults() {
    return {
      profile: 'AC11', stationP: 120, capacity: 60, soc0: 20, soc1: 80, obcPhases: 3, obcI: 16, dcMax: 150,
      effAC: 90, effDC: 94, curve: 'typical', nPoints: 1, siteKW: 50, publicService: false, speed: 'auto'
    };
  }
  const prof = s => PROF[s.profile] || PROF.AC11;
  const nDrawn = s => Math.max(1, Math.min(MAX_DRAWN, Math.round(s.nPoints) || 1));

  /* ---------------------------------------------------------------- oynatma (motor zaman serisi) */
  /** Simüle dakika / gerçek saniye. Otomatik: tüm şarj ~40 s'de oynatılır. */
  function rate(s, v) { return s.speed === 'auto' ? Math.max(0.5, v.minutes / 40) : Number(s.speed) || 1; }
  /** values.sim dakikalık adımlıdır: SOC adımlar arasında doğrusal, güç adım boyunca sabittir. */
  function sample(v, tMin) {
    const sim = v.sim;
    if (!sim || sim.length < 2) return { soc: sim && sim[0] ? sim[0].soc : 0, Pgrid: 0, Pbatt: 0, done: true };
    if (tMin >= v.minutes - 1e-9) return { soc: sim[sim.length - 1].soc, Pgrid: 0, Pbatt: 0, done: true };
    let i = Math.max(0, Math.min(sim.length - 2, Math.floor(tMin)));
    while (i > 0 && sim[i].t > tMin) i--;
    while (i < sim.length - 2 && sim[i + 1].t <= tMin) i++;
    const a = sim[i], b = sim[i + 1], f = b.t > a.t ? (tMin - a.t) / (b.t - a.t) : 0;
    return { soc: a.soc + (b.soc - a.soc) * f, Pgrid: a.Pgrid, Pbatt: a.Pbatt, done: false };
  }
  /** Bir noktanın t anına kadar şebekeden çektiği enerji (kWh): motor serisinin adım integrali. Sonda = Egrid. */
  function energyAt(v, tMin) {
    const sim = v.sim; let e = 0;
    for (let i = 0; i < sim.length - 1 && sim[i].t < tMin; i++) e += sim[i].Pgrid * (Math.min(tMin, sim[i + 1].t) - sim[i].t) / 60;
    return e;
  }
  const simSig = v => v.minutes.toFixed(4) + '|' + v.sim.length + '|' + v.startGrid.toFixed(4) + '|' + v.sim[0].soc;
  function clock(min) {
    const m = Math.max(0, Math.round(min));
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function now(app) {
    const r = app.validResult; if (!r) return null;
    const v = r.values, smp = sample(v, app.live.t);
    return { v: v, soc: smp.soc, P: smp.Pgrid, Pb: smp.Pbatt, done: app.live.done || smp.done, t: app.live.t, E: energyAt(v, app.live.t) };
  }

  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const v = res.values, L = app.live, s = app.state;
    const sig = simSig(v);
    if (sig !== L.sig) { L.sig = sig; L.t = 0; L.done = false; }   // girdi değişti: oynatma başa döner
    if (L.done) return false;
    L.t += dt * rate(s, v);
    if (L.t >= v.minutes) {
      L.t = v.minutes; L.done = true;
      VS.toast('Hedef SOC %' + s.soc1 + ' — şarj tamamlandı (' + VS.fmtDuration(v.minutes) + ').', 'ok');
    }
    return true;
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s) {
    const p = prof(s), isDC = p.kind === 'DC';
    return [
      { title: 'Araç ve batarya', items: [
        { type: 'range', key: 'capacity', label: 'Batarya kapasitesi (kullanılabilir)', min: 10, max: 250, step: 1, unit: 'kWh' },
        { type: 'range', key: 'soc0', label: 'Başlangıç SOC', min: 0, max: 99, step: 1, fmt: v => '%' + v },
        { type: 'range', key: 'soc1', label: 'Hedef SOC', min: 1, max: 100, step: 1, fmt: v => '%' + v },
        { type: 'seg', key: 'obcPhases', label: 'Araç dahili şarj cihazı (OBC)', options: [[1, '1 faz'], [3, '3 faz']], help: 'AC şarjda gücü çoğu zaman araç içindeki OBC sınırlar; 1 fazlı OBC 3 fazlı istasyonda tek faz kullanır.' },
        { type: 'range', key: 'obcI', label: 'OBC faz akımı', min: 6, max: 63, step: 1, unit: 'A' },
        { type: 'range', key: 'dcMax', label: 'Aracın maks. DC kabul gücü', min: 10, max: 400, step: 5, unit: 'kW' }
      ] },
      { title: 'Şarj cihazı', items: [
        { type: 'select', key: 'profile', label: 'Şarj profili', options: Object.keys(PROF).map(k => [k, PROF[k].name]), rebuild: true,
          onChange: (v, a) => { if (PROF[v] && PROF[v].kind === 'DC') a.state.stationP = PROF[v].P; a.renderControls(); a.invalidate(); } },
        isDC ? { type: 'range', key: 'stationP', label: 'İstasyon DC çıkış gücü', min: 10, max: 400, step: 10, unit: 'kW', help: 'Profil seçimi varsayılan değeri yükler; cihaz etiket gücü burada düzenlenebilir.' } : null,
        { type: 'seg', key: 'curve', label: 'Şarj eğrisi', options: [['typical', 'Tipik eğri (CC–CV)'], ['constant', 'Sabit güç']] },
        s.curve === 'constant' ? { type: 'note', level: 'warn', text: 'Sabit güç varsayıldı: SOC arttıkça aracın kabul gücündeki düşüş hesaba katılmaz; gerçek süre daha uzun olabilir.' } : null,
        isDC ? { type: 'range', key: 'effDC', label: 'DC şarj verimi (şebeke → batarya)', min: 60, max: 100, step: 1, fmt: v => '%' + v }
          : { type: 'range', key: 'effAC', label: 'AC şarj verimi (şebeke → batarya)', min: 60, max: 100, step: 1, fmt: v => '%' + v }
      ] },
      { title: 'Tesis ve yük paylaşımı', items: [
        { type: 'range', key: 'nPoints', label: 'Eşzamanlı şarj eden araç', min: 1, max: 20, step: 1, rebuild: false, help: 'Tüm noktalar aynı profil ve SOC ile kabul edilir. Sahnede en çok ' + MAX_DRAWN + ' park yeri çizilir.' },
        { type: 'range', key: 'siteKW', label: 'Tesisin kullanılabilir gücü', min: 5, max: 1000, step: 5, unit: 'kW', help: 'Dinamik yük yönetimi: toplam talep bu değeri aşarsa güç noktalar arasında eşit paylaştırılır.' },
        { type: 'toggle', key: 'publicService', label: 'Herkese açık ücretli şarj hizmeti', rebuild: true },
        { type: 'note', text: s.publicService ? 'Ticari (herkese açık, ücretli) şarj hizmeti senaryosu. Lisans ve şarj ağı koşulları analiz panelindeki “Mevzuat kapsamı” kontrolünde gösterilir.' : 'Özel kullanım senaryosu (konut/işyeri, ücretsiz ve ticari olmayan). Ticari hizmet koşulları bu senaryoya uygulanmaz; ayrıntı “Mevzuat kapsamı” kontrolündedir.' }
      ] },
      { title: 'Oynatma', items: [
        { type: 'seg', key: 'speed', label: 'Hızlandırma', options: [['auto', 'Otomatik'], ['1', '1 dk/s'], ['5', '5 dk/s'], ['15', '15 dk/s']] },
        { type: 'note', text: 'Simülasyonu başlat: motorun dakikalık şarj serisi hızlandırılmış oynatılır ve hedef SOC’de durur. Otomatik hızda tüm şarj yaklaşık 40 saniyede izlenir.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, isAC = v.kind === 'AC', smp = sample(v, live.t);
    const lim = res.checks.find(c => c.id === 'limit');
    const lossPct = v.Egrid > 0 ? v.lossKWh / v.Egrid * 100 : 0;
    const out = [
      { label: 'İdeal enerji (bataryaya)', value: fmt(v.ideal, 1, 'kWh'), sub: fmt(s.capacity, 0) + ' kWh × (%' + s.soc1 + ' − %' + s.soc0 + ')' },
      { label: 'Şebekeden çekilen enerji', value: fmt(v.Egrid, 1, 'kWh'), sub: 'Kayıp ' + fmt(v.lossKWh, 1, 'kWh') + ' (%' + fmt(lossPct, 1) + ')' },
      { label: 'Şarj süresi', value: VS.fmtDuration(v.minutes), sub: s.curve === 'constant' ? 'Sabit güç varsayımıyla' : 'Tipik şarj eğrisiyle', level: s.curve === 'constant' ? 'warn' : undefined },
      { label: 'Başlangıç gücü (şebeke)', value: fmt(v.startGrid, 1, 'kW'), sub: 'Sınırlayan: ' + (lim ? lim.detail : '—') },
      isAC
        ? { label: 'AC faz akımı', value: fmt(v.phaseCurrent, 1, 'A'), sub: v.ac.phases + ' faz × 230 V · OBC ' + s.obcPhases + 'F / ' + s.obcI + ' A' }
        : { label: 'Bataryaya DC güç (başlangıç)', value: fmt(v.sim[0] ? v.sim[0].Pbatt : 0, 1, 'kW'), sub: 'İstasyon ' + fmt(s.stationP, 0) + ' kW · araç maks. ' + fmt(s.dcMax, 0) + ' kW' },
      { label: 'Nokta başına tesis payı', value: fmt(v.perPoint, 1, 'kW'), sub: s.nPoints + ' nokta · tesis ' + fmt(s.siteKW, 0, 'kW') },
      { label: 'Toplam tesis talebi', value: fmt(v.totalDemand, 1, 'kW'), level: v.totalDemand > s.siteKW ? 'warn' : 'ok', sub: v.totalDemand > s.siteKW ? 'Tesis gücü aşılıyor: yük paylaşımı devrede' : 'Tesis gücü yeterli' },
      { label: 'Anlık güç (nokta / tesis)', value: fmt(smp.Pgrid, 1) + ' / ' + fmt(smp.Pgrid * s.nPoints, 1) + ' kW', sub: 'Bataryaya ' + fmt(smp.Pbatt, 1, 'kW') },
      { label: 'Simülasyon saati · SOC', value: clock(live.t) + ' / ' + clock(v.minutes) + ' · %' + fmt(smp.soc, 1), wide: true, level: live.done ? 'ok' : undefined,
        sub: live.done ? 'Hedef SOC’ye ulaşıldı · şebekeden ' + fmt(v.Egrid, 1, 'kWh') : 'Hız: 1 s = ' + fmt(rate(s, v), 1) + ' dk · çekilen ' + fmt(energyAt(v, live.t), 1, 'kWh') }
    ];
    return out;
  }

  function charts(res, s, live) {
    const v = res.values, sim = v.sim, smp = sample(v, live.t);
    const pg = sim.map(p => [p.t, p.Pgrid]), pb = sim.map(p => [p.t, p.Pbatt]), sc = sim.map(p => [p.t, p.soc]);
    const peak = Math.max.apply(null, pg.map(p => p[1]).concat([1]));
    const mk = { x: live.t, color: '#fcd34d', label: clock(live.t) };
    return [{
      id: 'power', title: 'Şarj gücü – zaman' + (s.curve === 'constant' ? ' (sabit güç varsayımı)' : ''), height: 160,
      series: [
        { name: 'Şebeke tarafı (kW)', color: 'amber', area: true, data: pg },
        { name: 'Bataryaya giren (kW)', color: 'cyan', data: pb }
      ],
      hLines: v.perPoint < peak * 1.6 ? [{ y: v.perPoint, label: 'Nokta payı ' + fmt(v.perPoint, 1) + ' kW', color: '#ef4444' }] : [],
      markers: [Object.assign({ y: smp.Pgrid }, mk)],
      x: { label: 'dk', min: 0, max: Math.max(1, v.minutes) }, y: { label: 'kW' },
      alt: 'Başlangıçta ' + fmt(v.startGrid, 1) + ' kW şebeke gücü; şarj ' + VS.fmtDuration(v.minutes) + ' sürer, toplam ' + fmt(v.Egrid, 1) + ' kWh çekilir.' + (s.curve === 'typical' && v.kind === 'DC' ? ' Yüksek SOC’de araç kabul gücü düşer.' : '')
    }, {
      id: 'soc', title: 'Batarya SOC – zaman', height: 150,
      series: [{ name: 'SOC (%)', color: 'green', area: true, data: sc }],
      hLines: [{ y: s.soc1, label: 'Hedef %' + s.soc1, color: '#10b981' }],
      markers: [Object.assign({ y: smp.soc }, mk)],
      x: { label: 'dk', min: 0, max: Math.max(1, v.minutes) }, y: { label: '%', min: 0, max: 100 },
      alt: 'SOC %' + s.soc0 + '’den %' + s.soc1 + '’e ' + VS.fmtDuration(v.minutes) + ' içinde yükselir; şu an %' + fmt(smp.soc, 1) + '.'
    }];
  }

  /* ---------------------------------------------------------------- 3D: paylaşımlı geometriler */
  let G = null;
  function geos(T) {
    if (G) return G;
    G = {};
    // gövde yan profili (x: boy, burun +x; y: yükseklik), çamurluk kavisleri profile işlenmiştir
    const s = new T.Shape();
    s.moveTo(-2.1, 0.3);
    s.lineTo(-1.75, 0.3); s.absarc(-1.35, 0.3, 0.4, Math.PI, 0, true);
    s.lineTo(0.95, 0.3); s.absarc(1.35, 0.3, 0.4, Math.PI, 0, true);
    s.lineTo(2.06, 0.32); s.quadraticCurveTo(2.2, 0.4, 2.18, 0.62); s.lineTo(2.12, 0.8);
    s.quadraticCurveTo(2.02, 0.92, 1.7, 0.95); s.lineTo(0.92, 1.02); s.lineTo(-1.9, 1.05);
    s.quadraticCurveTo(-2.12, 1.03, -2.15, 0.86); s.lineTo(-2.16, 0.45); s.quadraticCurveTo(-2.16, 0.31, -2.1, 0.3);
    G.body = extrude(T, s, 1.8, 0.06);
    // cam kabin (daha dar)
    const g = new T.Shape();
    g.moveTo(0.95, 1.0); g.lineTo(0.05, 1.5); g.quadraticCurveTo(-0.1, 1.56, -0.32, 1.56); g.lineTo(-1.5, 1.555);
    g.quadraticCurveTo(-1.76, 1.54, -1.86, 1.4); g.lineTo(-2.0, 1.02); g.lineTo(0.95, 1.0);
    G.cabin = extrude(T, g, 1.52, 0.05);
    G.tire = new T.CylinderGeometry(0.34, 0.34, 0.22, 36); G.tire.rotateX(Math.PI / 2);
    G.rim = new T.CylinderGeometry(0.235, 0.235, 0.226, 28); G.rim.rotateX(Math.PI / 2);
    G.rimIn = new T.CylinderGeometry(0.205, 0.205, 0.23, 24); G.rimIn.rotateX(Math.PI / 2);
    G.spoke = new T.BoxGeometry(0.045, 0.19, 0.02);
    G.cap = new T.CylinderGeometry(0.045, 0.045, 0.24, 16); G.cap.rotateX(Math.PI / 2);
    G.module = new T.BoxGeometry(0.27, 0.09, 0.64);
    G.fin = new T.BoxGeometry(0.02, 0.9, 0.22);
    return G;
  }
  function extrude(T, shape, width, bevel) {
    const geo = new T.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 14 });
    geo.translate(0, 0, -(width - 2 * bevel) / 2);
    geo.computeVertexNormals();
    return geo;
  }
  const MAT = {};
  function mats(k) {
    const T = k.T;
    if (MAT.T === T) return MAT;
    MAT.T = T;
    const paint = c => { const m = new T.MeshPhysicalMaterial({ color: c, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }); m.envMapIntensity = 1.2; return m; };
    MAT.paints = [paint(0x1f5a8c), paint(0x9b1c1c), paint(0x3c4046), paint(0xd9dee4)];
    MAT.darkGlass = new T.MeshPhysicalMaterial({ color: 0x18222e, metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }); MAT.darkGlass.envMapIntensity = 1.5;
    MAT.head = new T.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xdbeafe, emissiveIntensity: 0.9, roughness: 0.2 });
    MAT.tail = new T.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xb91c1c, emissiveIntensity: 0.7, roughness: 0.3 });
    MAT.evGreen = new T.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.9 });
    MAT.line = new T.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.7 });
    MAT.grass = new T.MeshStandardMaterial({ color: 0x4a6332, roughness: 1 });
    MAT.hedge = new T.MeshStandardMaterial({ color: 0x35582c, roughness: 1 });
    MAT.barBg = new T.MeshBasicMaterial({ color: 0x0b1626, transparent: true, opacity: 0.85 });
    MAT.barFill = new T.MeshBasicMaterial({ color: 0x22c55e });
    MAT.cable = new T.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.55 });
    MAT.cableOrange = new T.MeshStandardMaterial({ color: 0xe0661a, roughness: 0.55 });
    return MAT;
  }
  function mesh(k, geo, mat, x, y, z, parent) {
    const m = new k.T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }

  /* ---------------------------------------------------------------- 3D: araç */
  // Araç yerel ekseni: +x burun, +z sağ yan. Grup -90° döndürülür: burun dünya +z (kamera), sol yan dünya +x (şarj adası).
  const INLET = [1.42, 0.86, -0.905];   // sol ön çamurlukta Type 2 / CCS2 soketi
  const WHEELS = [[1.35, 0.34, 0.79], [1.35, 0.34, -0.79], [-1.35, 0.34, 0.79], [-1.35, 0.34, -0.79]];
  function buildCar(k, x, paint, main, wheelList, scene) {
    const T = k.T, M = k.mats, g = geos(T), X = mats(k);
    const car = k.group(null, x, 0, 0); car.rotation.y = -Math.PI / 2;
    const body = mesh(k, g.body, paint, 0, 0, 0, car);
    const cabin = k.group(car, 0, 0, 0);
    mesh(k, g.cabin, X.darkGlass, 0, 0, 0, cabin);
    k.rbox(1.42, 0.045, 1.44, 0.03, paint, -0.86, 1.57, 0, cabin);                 // tavan
    k.box(1.3, 0.035, 0.035, M.alu, -0.86, 1.61, 0.64, cabin); k.box(1.3, 0.035, 0.035, M.alu, -0.86, 1.61, -0.64, cabin); // tavan rayları
    k.box(0.1, 0.5, 1.535, M.plasticDark, -0.62, 1.27, 0, cabin);                  // B direği
    k.box(0.12, 0.42, 1.53, paint, -1.82, 1.22, 0, cabin).rotation.z = -0.55;      // C direği
    k.shell(body); k.shell(cabin);
    k.explodable(cabin, [0, 0.9, 0]);
    // tampon, ışıklar, alt kaplama
    k.box(1.9, 0.09, 1.84, M.plasticDark, 0, 0.35, 0, car);                         // marşpiyel
    k.box(3.5, 0.08, 1.5, M.plasticDark, 0, 0.26, 0, car);                          // alt koruma
    k.box(0.05, 0.15, 1.0, M.plasticDark, 2.16, 0.5, 0, car);                       // ızgara/hava girişi
    [0.62, -0.62].forEach(z => { const h = k.box(0.05, 0.055, 0.42, X.head, 2.11, 0.76, z, car); h.rotation.y = z > 0 ? -0.35 : 0.35; });
    k.box(0.04, 0.06, 1.55, X.tail, -2.16, 0.92, 0, car);
    [1, -1].forEach(sd => {
      k.rbox(0.13, 0.1, 0.2, 0.025, paint, 0.72, 1.1, sd * 0.99, car);              // ayna
      [0.25, -0.95].forEach(hx => k.box(0.16, 0.025, 0.02, M.alu, hx, 0.98, sd * 0.905, car)); // kapı kolu
    });
    // şarj soketi ve açık kapağı
    const inl = k.group(car, INLET[0], INLET[1], INLET[2]);
    const sock = k.cyl(0.075, 0.075, 0.025, M.plasticDark, 0, 0, 0, inl, 20); sock.rotation.x = Math.PI / 2;
    const flap = k.rbox(0.17, 0.15, 0.012, 0.02, paint, 0.1, 0, -0.04, inl); flap.rotation.y = 1.1;
    k.pickable(inl, 'Araç şarj soketi (CCS2 / Type 2)', () => ['Üst bölüm: Type 2 AC (L1–L3, N, PE, CP, PP)', 'Alt iki pim: CCS2 DC artı/eksi', 'Sinyalleşme: IEC 61851-1 kontrol pilotu (PWM)']);
    // batarya modülleri (zemin altında; “Şeffaf kapak” ile görünür)
    let modules = null;
    if (main) {
      k.box(2.5, 0.14, 1.46, M.darkSteel, -0.05, 0.42, 0, car);
      modules = new T.InstancedMesh(g.module, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 }), 16);
      const d = new T.Object3D();
      for (let i = 0; i < 16; i++) { d.position.set(-1.15 + (i % 8) * 0.3, 0.5, i < 8 ? 0.35 : -0.35); d.updateMatrix(); modules.setMatrixAt(i, d.matrix); modules.setColorAt(i, new T.Color(0x334155)); }
      modules.castShadow = false; car.add(modules);
      k.pickable(modules, 'Çekiş bataryası', () => { const n = scene.now(); return n ? ['Kullanılabilir kapasite: ' + fmt(scene.s.capacity, 0, 'kWh'), 'Anlık SOC: %' + fmt(n.soc, 1), '16 modül; dolu modüller yeşil (SOC oranında)', 'Ön ısıtma/soğutma tüketimi modelde yok'] : []; });
    }
    car.updateMatrixWorld(true);
    WHEELS.forEach(w => wheelList.push({ m: car.matrixWorld.clone(), p: w }));
    const inletW = new T.Vector3().fromArray(INLET).applyMatrix4(car.matrixWorld);
    return { car: car, body: body, modules: modules, inlet: inletW };
  }
  function buildWheels(k, list) {
    const T = k.T, M = k.mats, g = geos(T), n = list.length;
    const tire = new T.InstancedMesh(g.tire, M.rubber, n), rim = new T.InstancedMesh(g.rim, M.alu, n), rimIn = new T.InstancedMesh(g.rimIn, M.darkSteel, n);
    const cap = new T.InstancedMesh(g.cap, M.alu, n), spokes = new T.InstancedMesh(g.spoke, M.alu, n * 10);
    const m = new T.Matrix4(), l = new T.Matrix4(), r = new T.Matrix4();
    list.forEach((w, i) => {
      l.makeTranslation(w.p[0], w.p[1], w.p[2]); m.multiplyMatrices(w.m, l);
      tire.setMatrixAt(i, m); rim.setMatrixAt(i, m); rimIn.setMatrixAt(i, m); cap.setMatrixAt(i, m);
      for (let j = 0; j < 10; j++) {
        const side = j < 5 ? 1 : -1;
        l.makeTranslation(w.p[0], w.p[1], w.p[2] + side * 0.106); r.makeRotationZ(j * Math.PI * 2 / 5 + 0.3); l.multiply(r);
        r.makeTranslation(0, 0.11, 0); l.multiply(r);
        m.multiplyMatrices(w.m, l); spokes.setMatrixAt(i * 10 + j, m);
      }
    });
    [tire, rim, rimIn, cap, spokes].forEach(im => { im.castShadow = true; im.receiveShadow = true; k.viewer.root.add(im); });
  }

  /* ---------------------------------------------------------------- 3D: şarj cihazları */
  function connector(k, parent, dc) {
    // tabanca: kabza + Type 2 başlık (+ CCS2'de alt DC pim bloğu); yerel -x yönü sokete bakar
    const M = k.mats, c = k.group(parent, 0, 0, 0);
    k.rbox(0.16, 0.07, 0.07, 0.02, M.plasticDark, 0.1, 0.03, 0, c);
    const head = k.cyl(0.036, 0.036, 0.08, M.plasticDark, -0.02, 0, 0, c, 20); head.rotation.z = Math.PI / 2;
    if (dc) k.rbox(0.08, 0.05, 0.07, 0.015, M.plasticDark, -0.02, -0.055, 0, c);
    k.box(0.01, 0.035, 0.05, dc ? M.plasticBlue : M.plasticGrey, 0.06, 0.07, 0, c);
    return c;
  }
  function buildAC(k, x, z, scene, i) {
    const M = k.mats, g = k.group(null, x, 0, z);
    k.box(0.32, 0.03, 0.24, M.galv, 0, 0.165, 0, g);
    k.rbox(0.16, 1.02, 0.12, 0.02, M.panelDark, 0, 0.69, 0, g);
    const unit = k.group(g, 0, 1.36, 0.01);
    k.rbox(0.32, 0.44, 0.15, 0.05, M.plasticWhite, 0, 0, 0, unit);
    k.rbox(0.25, 0.32, 0.02, 0.03, M.plasticDark, 0, 0.02, 0.07, unit);
    const led = k.box(0.18, 0.014, 0.01, M.ledBlue, 0, -0.16, 0.078, unit);
    const scr = k.screen(0.13, 0.08, 208, (gx, w, h) => drawAC(gx, w, h, scene, i), unit, { emissive: 0.9 });
    scr.position.set(0, 0.06, 0.082);
    k.rbox(0.07, 0.11, 0.08, 0.012, M.plasticDark, -0.2, -0.06, 0.0, unit);       // tabanca yuvası
    g.updateMatrixWorld(true);
    k.pickable(g, i ? 'AC şarj noktası ' + (i + 1) : 'AC şarj ünitesi (wallbox, ayaklı)', () => info(scene, 'AC'));
    return { g: g, led: led, scr: scr, plugW: g.localToWorld(new k.T.Vector3(-0.07, 1.22, 0.06)), holsterW: g.localToWorld(new k.T.Vector3(-0.2, 1.3, 0.06)) };
  }
  function buildDC(k, x, z, scene, i) {
    const M = k.mats, T = k.T, g = k.group(null, x, 0, z);
    k.box(0.9, 0.08, 0.68, M.concrete, 0, 0.19, 0, g);
    const low = k.rbox(0.72, 0.95, 0.52, 0.04, M.panelDark, 0, 0.7, 0, g);
    const up = k.rbox(0.72, 0.84, 0.52, 0.04, M.plasticWhite, 0, 1.58, 0, g);
    k.rbox(0.8, 0.06, 0.6, 0.02, M.panelDark, 0, 2.03, 0, g);
    k.shell(low); k.shell(up);
    k.box(0.4, 0.5, 0.012, M.plasticDark, 0, 1.6, 0.262, g);
    const scr = k.screen(0.34, 0.44, 256, (gx, w, h) => drawDC(gx, w, h, scene, i), g, { emissive: 0.9 });
    scr.position.set(0, 1.6, 0.27);
    const led = k.box(0.018, 0.62, 0.012, M.ledBlue, -0.3, 1.58, 0.265, g);
    const es = k.cyl(0.035, 0.035, 0.04, M.plasticRed, 0.27, 1.22, 0.275, g, 18); es.rotation.x = Math.PI / 2;
    k.box(0.1, 0.1, 0.01, M.plasticYellow, 0.27, 1.22, 0.262, g);
    // havalandırma ızgarası (yan yüz)
    for (let r = 0; r < 7; r++) k.box(0.012, 0.012, 0.36, M.darkSteel, 0.362, 0.45 + r * 0.05, 0, g);
    // ön servis kapağı ve güç modülleri (patlatılmış görünümde öne açılır)
    const door = k.rbox(0.64, 0.82, 0.02, 0.01, M.panelDark, 0, 0.7, 0.265, g); k.shell(door); k.explodable(door, [0, 0, 0.7]);
    for (let r = 0; r < 4; r++) { k.box(0.5, 0.13, 0.36, M.alu, 0, 0.36 + r * 0.17, 0, g); k.box(0.46, 0.08, 0.005, M.plasticDark, 0, 0.36 + r * 0.17, 0.182, g); }
    k.box(0.08, 0.6, 0.1, M.copper, -0.3, 0.7, -0.15, g);
    k.rbox(0.06, 0.12, 0.09, 0.012, M.plasticDark, -0.38, 1.22, 0.1, g);           // tabanca yuvası (araç tarafı)
    g.updateMatrixWorld(true);
    k.pickable(g, i ? 'DC şarj noktası ' + (i + 1) : 'DC hızlı şarj cihazı', () => info(scene, 'DC'));
    void T;
    return { g: g, led: led, scr: scr, plugW: g.localToWorld(new k.T.Vector3(-0.37, 1.0, 0.05)), holsterW: g.localToWorld(new k.T.Vector3(-0.45, 1.2, 0.1)) };
  }
  /** Bağlı kablo: cihazdan zemine sarkar, araç soketine girer. Kablo üzerinde enerji akışı. */
  function plugCable(k, from, inlet, dc, scene) {
    const T = k.T, X = mats(k);
    const end = inlet.clone().add(new T.Vector3(0.1, 0, 0));
    const pts = [from, new T.Vector3(from.x - 0.12, 0.35, from.z + 0.25), new T.Vector3((from.x + end.x) / 2 - 0.05, 0.13, (from.z + end.z) / 2),
      new T.Vector3(end.x + 0.25, 0.25, end.z - 0.2), new T.Vector3(end.x + 0.22, end.y - 0.04, end.z), new T.Vector3(end.x + 0.1, end.y, end.z)];
    const cab = k.tube(pts, dc ? 0.024 : 0.016, dc ? X.cable : X.cableOrange, k.viewer.root, 90);
    const con = connector(k, k.viewer.root, dc); con.position.copy(end);
    const fl = k.flow(cab.userData.curve, dc ? 22 : 16, dc ? 0x38bdf8 : 0xfcd34d, dc ? 0.03 : 0.024);
    k.pickable(cab, dc ? 'DC şarj kablosu (CCS2, sıvı soğutmasız)' : 'AC şarj kablosu (Type 2, mod 3)', () => {
      const n = scene.now(); if (!n) return [];
      return [dc ? 'Mod 4: DC dönüştürücü istasyonda; kablo DC akım taşır' : 'Mod 3: AC akım; dönüştürücü araçtaki OBC’dir', 'Anlık güç: ' + fmt(n.P, 1, 'kW') + ' (şebeke tarafı)', 'Akış hızı güçle orantılı gösterilir'];
    });
    return fl;
  }
  /** Boştaki kablo: yuvasına asılı tabanca. */
  function idleCable(k, from, holster, dc) {
    const T = k.T, X = mats(k);
    const pts = [from, new T.Vector3(from.x - 0.15, 0.45, from.z + 0.1), new T.Vector3(holster.x - 0.22, 0.3, holster.z + 0.15), new T.Vector3(holster.x - 0.1, holster.y - 0.2, holster.z), holster];
    k.tube(pts, dc ? 0.024 : 0.016, dc ? X.cable : X.cableOrange, k.viewer.root, 60);
    const con = connector(k, k.viewer.root, dc); con.position.copy(holster); con.rotation.z = Math.PI / 2;
  }

  /* ---------------------------------------------------------------- 3D: sahne kurulumu */
  function rebuildOn(s) { return prof(s).kind + '|' + nDrawn(s); }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, X = mats(k);
    const kind = prof(s).kind, nd = nDrawn(s);
    const sc = { s: s, cars: [], units: [], flows: [], now: () => now(app), app: app, lastScr: -1, lastMods: -1 };
    app.scene3 = sc;
    v.scene.fog = new T.Fog(0x9fb9d4, 38, 110);
    // zemin: çim, asfalt otopark, park çizgileri
    k.ground(240, X.grass, -0.02);
    const xL = -BAY * (nd - 1) - 3.2, xR = 6.5, wA = xR - xL;
    const asphalt = mesh(k, new T.PlaneGeometry(wA, 15), M.asphalt, (xL + xR) / 2, 0, -1.2, v.root);
    asphalt.rotation.x = -Math.PI / 2; asphalt.castShadow = false; asphalt.userData.noClip = true;
    k.box(wA, 0.12, 0.18, M.concrete, (xL + xR) / 2, 0.06, -8.7);
    for (let i = 0; i < nd; i++) {
      const bx = -BAY * i;
      k.box(2.5, 0.006, 5.2, X.evGreen, bx, 0.004, 0).castShadow = false;
      k.box(0.1, 0.008, 5.2, X.line, bx - 1.35, 0.005, 0).castShadow = false;
      const pict = k.screen(1.2, 1.2, 256, drawBayIcon, v.root); pict.rotation.x = -Math.PI / 2; pict.position.set(bx, 0.009, 1.7);
      // şarj adası: bordür, çarpma koruma direkleri
      const ix = bx + ISLAND_X;
      k.rbox(1.0, 0.16, 5.0, 0.05, M.concrete, ix, 0.08, -0.4);
      [-2.7, 1.9].forEach(zz => { k.cyl(0.07, 0.07, 0.9, M.plasticYellow, ix, 0.6, zz, null, 16); k.cyl(0.072, 0.072, 0.12, M.plasticDark, ix, 0.75, zz, null, 16); });
    }
    // çit/çalı sırası ve aydınlatma direği
    k.box(wA + 4, 1.1, 0.8, X.hedge, (xL + xR) / 2, 0.55, -9.4);
    k.cyl(0.06, 0.09, 6, M.galv, xR - 0.8, 3, -7.6, null, 12); k.box(0.7, 0.08, 0.22, M.darkSteel, xR - 1.1, 6, -7.6);

    // araçlar ve şarj noktaları
    const wheels = [];
    for (let i = 0; i < nd; i++) {
      const bx = -BAY * i, ix = bx + ISLAND_X;
      const car = buildCar(k, bx, X.paints[i % X.paints.length], i === 0, wheels, sc);
      if (i === 0) k.pickable(car.body, 'Elektrikli araç (kompakt SUV)', () => info(sc, 'car'));
      sc.cars.push(car);
      let ac = null, dc = null;
      if (i === 0 || kind === 'AC') ac = buildAC(k, ix, i === 0 ? -2.0 : -0.8, sc, i);
      if (i === 0 || kind === 'DC') dc = buildDC(k, ix, i === 0 ? -0.55 : -0.55, sc, i);
      const act = kind === 'AC' ? ac : dc, idle = kind === 'AC' ? dc : ac;
      sc.units.push({ act: act, idle: idle });
      sc.flows.push(plugCable(k, act.plugW, car.inlet, kind === 'DC', sc));
      if (idle) idleCable(k, idle.plugW, idle.holsterW, kind !== 'DC');
      // SOC çubuğu (araç üstünde)
      const bar = k.group(null, bx, 2.05, 0);
      const bg = new T.Mesh(new T.BoxGeometry(0.06, 0.13, 1.7), X.barBg); bar.add(bg);
      const fill = new T.Mesh(new T.BoxGeometry(0.07, 0.1, 1.64), X.barFill); bar.add(fill);
      fill.userData.noClip = true; bg.userData.noClip = true;
      car.bar = { g: bar, fill: fill };
      car.label = k.label(i === 0 ? 'SOC' : 'Nokta ' + (i + 1), bar, [0, 0.12, 0], i ? 'vs-label--sm' : undefined);
      if (i === 0) sc.unitLabel = k.label('Şarj', act.g, [0, kind === 'DC' ? 2.15 : 1.7, 0]);
    }
    buildWheels(k, wheels);
    if (s.nPoints > nd) sc.more = k.label('+' + (s.nPoints - nd) + ' nokta daha (çizilmedi)', null, [-BAY * (nd - 1) - 1.6, 2.6, -2.5], 'vs-label--sm');

    // dağıtım panosu (MID sayaçlı) ve şebeke bağlantısı (trafo)
    const px = 3.5, pz = -4.0;
    const pano = k.group(null, px, 0, pz);
    k.box(1.1, 0.2, 0.5, M.concrete, 0, 0.1, 0, pano);
    const cab = k.rbox(0.95, 1.55, 0.38, 0.03, M.panelRAL7035, 0, 0.98, 0, pano); k.shell(cab);
    k.rbox(1.05, 0.05, 0.48, 0.02, M.panelRAL7035, 0, 1.78, 0, pano);
    k.box(0.36, 0.3, 0.01, M.plasticDark, -0.2, 1.3, 0.195, pano);
    const meter = k.screen(0.3, 0.22, 256, (gx, w, h) => drawMeter(gx, w, h, sc), pano, { emissive: 0.9 }); meter.position.set(-0.2, 1.3, 0.202);
    for (let j = 0; j < 6; j++) k.rbox(0.035, 0.09, 0.07, 0.006, M.plasticWhite, 0.06 + j * 0.04, 0.9, 0.05, pano);  // MCB/RCD dizisi
    k.box(0.32, 0.03, 0.01, M.galv, 0.16, 0.9, 0.012, pano);
    k.pickable(pano, 'Şarj dağıtım panosu + MID enerji sayacı', () => info(sc, 'pano'));
    sc.meter = meter;
    sc.panoLabel = k.label('Dağıtım panosu', pano, [0, 2.05, 0]);

    const tx = -1.6, tz = -6.6;
    const tr = k.group(null, tx, 0, tz);
    k.box(3.0, 0.15, 2.0, M.concreteDark, 0, 0.075, 0, tr);
    k.box(1.7, 1.25, 0.95, M.trafoPaint, 0, 0.8, 0, tr);
    k.box(1.8, 0.06, 1.05, M.trafoPaint, 0, 1.45, 0, tr);
    const fins = new T.InstancedMesh(geos(T).fin, M.trafoPaint, 28), d = new T.Object3D();
    for (let j = 0; j < 28; j++) { const side = j < 14 ? 1 : -1; d.position.set(-0.72 + (j % 14) * 0.11, 0.78, side * 0.58); d.updateMatrix(); fins.setMatrixAt(j, d.matrix); }
    fins.castShadow = true; fins.receiveShadow = true; tr.add(fins);
    for (let j = 0; j < 3; j++) { k.cyl(0.05, 0.07, 0.38, M.porcelainGrey, -0.45 + j * 0.45, 1.67, -0.2, tr, 14); }
    for (let j = 0; j < 4; j++) { k.cyl(0.035, 0.045, 0.2, M.porcelainGrey, -0.45 + j * 0.3, 1.57, 0.28, tr, 12); }
    const cons = k.cyl(0.16, 0.16, 0.9, M.trafoPaint, 0, 1.75, 0.38, tr, 20); cons.rotation.z = Math.PI / 2;
    const plate = k.screen(0.36, 0.18, 192, drawDanger, tr); plate.position.set(0.35, 0.95, 0.477);
    k.pickable(tr, 'Dağıtım trafosu · şebeke bağlantısı', () => info(sc, 'trafo'));
    sc.trLabel = k.label('Şebeke bağlantısı (OG/AG trafo)', tr, [0, 2.3, 0], 'vs-label--sm');

    // kablo güzergâhı: trafo → pano → şarj adaları (yer altı; üstte koruma kanalı gösterilir)
    const route = [[tx + 0.9, 0.06, tz + 0.6], [0.5, 0.06, -6.3], [px - 0.3, 0.06, pz - 0.6], [px, 0.06, pz + 0.3],
      [px - 0.6, 0.06, pz + 1.6], [ISLAND_X + 0.3, 0.06, -3.0], [ISLAND_X, 0.18, -2.6], [ISLAND_X - BAY * (nd - 1), 0.18, -2.6]];
    const trench = k.tube(route, 0.045, M.concreteDark, k.viewer.root, 160); trench.castShadow = false;
    sc.gridFlow = k.flow(trench.userData.curve, 46, 0xfcd34d, 0.05);
    k.pickable(trench, 'Besleme kablosu güzergâhı', () => ['Trafo AG çıkışı → dağıtım panosu → şarj noktaları', 'Her şarj noktası ayrı devreden beslenir (TS HD 60364-7-722)', 'Kesit, gerilim düşümü ve koruma ayrıca hesaplanmalıdır']);

    // kamera ve gölge
    app.def.scene.bounds = [xL - 0.5, xR];
    const cx = -BAY * (nd - 1) / 2;
    const key = 'v' + nd;
    if (app._viewKey !== key) {
      app._viewKey = key;
      v.setView({ target: [cx + 0.9, 0.7, -1.9], r: 13.2 + (nd - 1) * 2.6, theta: 0.68, phi: 1.12, limits: { rMin: 2, rMax: 45, phiMin: 0.2, phiMax: 1.5 } });
    }
    v.setShadowBox(9 + nd * 1.6, 60);
    v.sun.position.set(cx + 9, 15, 8); v.sun.target.position.set(cx, 0, -1.5);
  }

  function info(sc, what) {
    const app = sc.app, r = app.validResult, s = app.state; if (!r) return [];
    const v = r.values, n = now(app), p = prof(s);
    if (what === 'car') return ['Kullanılabilir batarya: ' + fmt(s.capacity, 0, 'kWh'), 'SOC: %' + fmt(n.soc, 1) + ' (hedef %' + s.soc1 + ')', 'OBC: ' + s.obcPhases + ' faz × ' + s.obcI + ' A · DC kabul: ' + fmt(s.dcMax, 0, 'kW'), 'Soket: CCS2 (Type 2 + DC pimleri)'];
    if (what === 'AC' || what === 'DC') {
      const on = p.kind === what;
      return [what === 'AC' ? 'AC şarj ünitesi · Type 2 · mod 3 (IEC 61851-1)' : 'DC şarj cihazı · CCS2 · mod 4 (IEC 61851-23)',
        on ? 'Bağlı · ' + p.name + (what === 'DC' ? ' · çıkış ' + fmt(s.stationP, 0, 'kW') : '') : 'Boşta (kablo yuvasında)',
        on ? 'Anlık şebeke gücü: ' + fmt(n.P, 1, 'kW') + ' · bataryaya ' + fmt(n.Pb, 1, 'kW') : 'Profil seçimiyle bu cihaz bağlanır',
        r.checks.find(c => c.id === 'rcd').detail];
    }
    if (what === 'pano') return ['Sayaç (tüm noktalar): ' + fmt(n.E * s.nPoints, 2, 'kWh'), 'Anlık tesis gücü: ' + fmt(n.P * s.nPoints, 1, 'kW') + ' / ' + fmt(s.siteKW, 0, 'kW'), 'Dinamik yük yönetimi: nokta payı ' + fmt(v.perPoint, 1, 'kW'), 'Ticari hizmette ölçü MID onaylı sayaçla yapılır'];
    if (what === 'trafo') return ['Şarj altyapısı dağıtım şebekesine bu noktadan bağlanır', 'Tesis kullanılabilir gücü: ' + fmt(s.siteKW, 0, 'kW'), 'Toplam talep (paylaşımsız): ' + fmt(v.totalDemand, 1, 'kW'), 'Bağlantı gücü dağıtım şirketinin bağlantı görüşüyle belirlenir'];
    return [];
  }

  /* ---------------------------------------------------------------- ekranlar (canvas) */
  function drawBayIcon(g, w, h) {
    g.clearRect(0, 0, w, h); g.fillStyle = '#2f7d4f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f1f1ee'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f1f1ee'; g.beginPath(); g.moveTo(w * 0.56, h * 0.18); g.lineTo(w * 0.36, h * 0.54); g.lineTo(w * 0.5, h * 0.54); g.lineTo(w * 0.44, h * 0.82); g.lineTo(w * 0.66, h * 0.44); g.lineTo(w * 0.52, h * 0.44); g.closePath(); g.fill();
  }
  function drawDanger(g, w, h) {
    g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('DİKKAT', w / 2, 34); g.font = 'bold 16px Arial'; g.fillText('YÜKSEK GERİLİM', w / 2, 62); g.fillText('ÖLÜM TEHLİKESİ', w / 2, 84);
  }
  function drawDC(g, w, h, sc, i) {
    const n = sc.now(), s = sc.app.state, on = prof(s).kind === 'DC';
    g.fillStyle = '#06111f'; g.fillRect(0, 0, w, h);
    g.fillStyle = on ? '#0ea5e9' : '#334155'; g.fillRect(0, 0, w, 38);
    g.fillStyle = '#04121f'; g.font = 'bold 18px Arial'; g.textAlign = 'left'; g.fillText('DC · CCS2 · ' + (i + 1), 12, 26);
    if (!on || !n) { g.fillStyle = '#94a3b8'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText('HAZIR', w / 2, h / 2); g.font = '16px Arial'; g.fillText('Kabloyu araca takın', w / 2, h / 2 + 30); return; }
    g.textAlign = 'center'; g.fillStyle = '#e2e8f0'; g.font = 'bold 54px Arial'; g.fillText(fmt(n.P, 1), w / 2, 102);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 18px Arial'; g.fillText('kW (şebeke)', w / 2, 126);
    socRing(g, w / 2, 196, 46, n.soc, s.soc1);
    g.fillStyle = '#94a3b8'; g.font = '15px Arial'; g.textAlign = 'left';
    g.fillText('Süre', 16, 276); g.fillText('Enerji', 16, 300);
    g.textAlign = 'right'; g.fillStyle = '#fcd34d'; g.font = 'bold 15px Arial';
    g.fillText(n.done ? 'TAMAMLANDI' : clock(n.v.minutes - n.t) + ' kaldı', w - 16, 276); g.fillText(fmt(n.E, 1) + ' kWh', w - 16, 300);
  }
  function drawAC(g, w, h, sc, i) {
    const n = sc.now(), s = sc.app.state, on = prof(s).kind === 'AC';
    g.fillStyle = '#06111f'; g.fillRect(0, 0, w, h); g.textAlign = 'center';
    if (!on || !n) { g.fillStyle = '#94a3b8'; g.font = 'bold 24px Arial'; g.fillText('HAZIR', w / 2, h / 2 + 8); return; }
    g.fillStyle = '#fcd34d'; g.font = 'bold 40px Arial'; g.fillText(fmt(n.P, 1) + ' kW', w / 2, 52);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 22px Arial'; g.fillText((n.done ? 'BİTTİ · ' : '') + 'SOC %' + fmt(n.soc, 0), w / 2, 96);
    g.fillStyle = '#64748b'; g.font = '16px Arial'; g.fillText('AC · Type 2 · ' + (i + 1), w / 2, 122);
  }
  function drawMeter(g, w, h, sc) {
    const n = sc.now(), s = sc.app.state;
    g.fillStyle = '#c8d3b4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f2a14'; g.font = 'bold 15px monospace'; g.textAlign = 'left'; g.fillText('MID · 3F · kWh', 12, 22);
    if (!n) return;
    g.font = 'bold 40px monospace'; g.textAlign = 'right'; g.fillText((n.E * s.nPoints).toFixed(2).padStart(8, '0'), w - 12, 86);
    g.font = 'bold 22px monospace'; g.fillText('P ' + fmt(n.P * s.nPoints, 1) + ' kW', w - 12, 128);
    g.font = '14px monospace'; g.textAlign = 'left'; g.fillText('Tesis ' + fmt(s.siteKW, 0) + ' kW', 12, 176);
  }
  function socRing(g, x, y, r, soc, target) {
    g.lineWidth = 12; g.strokeStyle = '#1e293b'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = soc >= target - 0.05 ? '#22c55e' : '#38bdf8'; g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * soc / 100); g.stroke();
    g.fillStyle = '#e2e8f0'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText('%' + fmt(soc, 0), x, y + 9);
  }

  /* ---------------------------------------------------------------- sahne güncelleme */
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    sc.lastScr = -1; sc.lastMods = -1;   // ekranlar bir sonraki karede yeniden çizilir
    animate(k, 0, res, s, live, app);
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, smp = sample(v, live.t), done = live.done || smp.done, P = done ? 0 : smp.Pgrid;
    const kind = prof(s).kind, T = k.T, M = k.mats;
    // kablo akışı: hız şebeke gücüyle orantılı
    sc.flows.forEach(f => { f.speed = P > 0 ? 0.04 + 0.7 * Math.min(1, P / 150) : 0; });
    sc.gridFlow.speed = P > 0 ? 0.02 + 0.25 * Math.min(1, P * s.nPoints / Math.max(s.siteKW, 1)) : 0;
    // SOC çubukları ve etiketler
    const f = Math.max(0.001, smp.soc / 100), col = smp.soc >= s.soc1 - 0.05 ? 0x22c55e : smp.soc < 20 ? 0xf59e0b : 0x38bdf8;
    sc.cars.forEach((c, i) => {
      c.bar.fill.scale.z = f; c.bar.fill.position.z = 0.82 * (1 - f);   // burun (+z) tarafı sabit, dolum arkaya doğru
      if (i === 0) {
        c.bar.fill.material.color.setHex(col); c.bar.fill.material.color.convertSRGBToLinear();
        c.label.set('SOC %' + fmt(smp.soc, 1) + ' · ' + (done ? 'şarj tamamlandı' : fmt(P, 1, 'kW')));
        c.label.level(done ? 'ok' : v.startGrid + 1e-6 < v.startDemand ? 'warn' : '');
      } else { c.label.set('Nokta ' + (i + 1) + ' · ' + fmt(P, 1, 'kW')); c.label.level(done ? 'ok' : ''); }
    });
    // batarya modülleri
    const car0 = sc.cars[0];
    if (car0 && car0.modules) {
      const filled = Math.round(smp.soc / 100 * 16 * 4) / 4;
      if (filled !== sc.lastMods) {
        sc.lastMods = filled;
        const c = new T.Color();
        for (let i = 0; i < 16; i++) {
          const fr = Math.max(0, Math.min(1, filled - i));
          c.setHex(fr >= 1 ? 0x22c55e : fr > 0 ? 0xf59e0b : 0x334155).convertSRGBToLinear();
          car0.modules.setColorAt(i, c);
        }
        car0.modules.instanceColor.needsUpdate = true;
      }
    }
    // cihaz durumu
    sc.units.forEach(u => {
      if (u.act) u.act.led.material = done ? M.ledGreen : P > 0 ? M.ledBlue : M.ledAmber;
      if (u.idle) u.idle.led.material = M.ledGreen;
    });
    if (sc.unitLabel) sc.unitLabel.set((kind === 'DC' ? 'DC ' + fmt(s.stationP, 0) + ' kW' : prof(s).name.replace(/ \(.*\)/, '')) + ' · ' + (done ? 'tamamlandı' : fmt(P, 1, 'kW')));
    sc.panoLabel.set('Pano · sayaç ' + fmt(P * s.nPoints, 1) + ' / ' + fmt(s.siteKW, 0) + ' kW');
    sc.panoLabel.level(v.totalDemand > s.siteKW ? 'warn' : '');
    // ekranlar ~6 Hz
    const tag = Math.floor(live.t * 6 / Math.max(rate(s, v), 0.1)) + (done ? 1e6 : 0);
    if (tag !== sc.lastScr) {
      sc.lastScr = tag;
      sc.units.forEach(u => { if (u.act) u.act.scr.redraw(); if (u.idle) u.idle.scr.redraw(); });
      sc.meter.redraw();
    }
    void dt;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values, smp = sample(v, live.t), done = live.done || smp.done, P = done ? 0 : smp.Pgrid;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', text: '#e6eef8', dim: '#7f94b0', amber: '#fcd34d', cyan: '#38bdf8' };
    const isDC = v.kind === 'DC', nd = Math.min(s.nPoints, 6);
    g.lineWidth = 2; g.font = '12px Inter, sans-serif'; g.textAlign = 'center';
    const cx = Math.max(70, Math.min(150, W * 0.18)), top = 78;
    // şebeke + trafo
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx - 14, top - 14); g.lineTo(cx + 14, top - 14); g.stroke();
    g.beginPath(); g.moveTo(cx, top - 14); g.lineTo(cx, top); g.stroke();
    g.beginPath(); g.arc(cx, top + 12, 12, 0, Math.PI * 2); g.arc(cx, top + 30, 12, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col.dim; g.textAlign = 'left'; g.fillText('Şebeke · OG/AG trafo', cx + 22, top + 24);
    // pano + sayaç
    const py = top + 62;
    g.beginPath(); g.moveTo(cx, top + 42); g.lineTo(cx, py); g.stroke();
    g.strokeRect(cx - 22, py, 44, 26); g.fillStyle = col.text; g.textAlign = 'center'; g.fillText('kWh', cx, py + 17);
    g.fillStyle = col.dim; g.textAlign = 'left';
    g.fillText('MID sayaç · ' + fmt(energyAt(v, live.t) * s.nPoints, 1) + ' kWh · ' + fmt(P * s.nPoints, 1) + ' / ' + fmt(s.siteKW, 0) + ' kW', cx + 30, py + 17);
    // bara
    const by = py + 58, x0 = 30, x1 = W - 30;
    g.beginPath(); g.moveTo(cx, py + 26); g.lineTo(cx, by); g.stroke();
    g.lineWidth = 5; g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(x0, by); g.lineTo(x1, by); g.stroke(); g.lineWidth = 2;
    g.fillStyle = v.totalDemand > s.siteKW ? col.warn : col.dim; g.textAlign = 'left';
    g.fillText('Dinamik yük yönetimi: talep ' + fmt(v.totalDemand, 1) + ' kW → nokta payı ' + fmt(v.perPoint, 1) + ' kW', cx + 12, by - 10);
    const slot = (x1 - x0) / nd;
    for (let i = 0; i < nd; i++) {
      const x = x0 + slot * (i + 0.5);
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 24); g.stroke();
      // MCB + RCD
      g.beginPath(); g.moveTo(x, by + 24); g.lineTo(x + 8, by + 40); g.stroke(); g.beginPath(); g.moveTo(x, by + 42); g.lineTo(x, by + 56); g.stroke();
      g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; g.textAlign = 'left'; g.fillText(isDC ? 'MCCB' : 'MCB+RCD', x + 10, by + 38);
      // şarj cihazı
      g.strokeStyle = P > 0 ? col.cyan : col.line; g.strokeRect(x - 20, by + 56, 40, 30);
      g.fillStyle = col.text; g.font = 'bold 12px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(isDC ? 'AC/DC' : 'AC', x, by + 75);
      g.strokeStyle = P > 0 ? col.amber : col.line; g.setLineDash(P > 0 ? [5, 4] : []); g.lineDashOffset = -(live.t * 3 % 9);
      g.beginPath(); g.moveTo(x, by + 86); g.lineTo(x, by + 116); g.stroke(); g.setLineDash([]);
      // araç + batarya
      g.strokeStyle = col.line; g.strokeRect(x - 24, by + 116, 48, 24);
      g.fillStyle = smp.soc >= s.soc1 - 0.05 ? col.ok : col.cyan; g.fillRect(x - 22, by + 118, 44 * smp.soc / 100, 20);
      g.fillStyle = col.text; g.font = '11px Inter, sans-serif'; g.fillText('%' + fmt(smp.soc, 0), x, by + 133);
      g.fillStyle = col.dim; g.fillText(fmt(P, 1) + ' kW', x, by + 156);
    }
    if (s.nPoints > nd) { g.fillStyle = col.dim; g.textAlign = 'right'; g.fillText('+' + (s.nPoints - nd) + ' nokta', x1, by + 175); }
    // özet
    g.textAlign = 'left'; g.fillStyle = col.text; g.font = 'bold 13px Inter, sans-serif';
    const yy = Math.min(H - 52, by + 200);
    g.fillText((isDC ? 'DC ' + fmt(s.stationP, 0) + ' kW (mod 4)' : prof(s).name + ' (mod 3)') + ' · ' + clock(live.t) + ' / ' + clock(v.minutes) + (done ? ' · tamamlandı' : ''), x0, yy);
    g.fillStyle = col.dim; g.font = '12px Inter, sans-serif';
    g.fillText('İdeal ' + fmt(v.ideal, 1) + ' kWh · şebekeden ' + fmt(v.Egrid, 1) + ' kWh · kayıp ' + fmt(v.lossKWh, 1) + ' kWh' + (s.curve === 'constant' ? ' · sabit güç varsayımı' : ''), x0, yy + 20);
  }

  /* ---------------------------------------------------------------- senaryolar */
  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'sarj', title: '3D Elektrikli Araç Şarj İstasyonu Simülasyonu',
    defaults: defaults,
    initLive: () => ({ t: 0, done: false, sig: '' }),
    autoRun: true,
    startText: 'Şarj başladı: motorun dakikalık serisi hızlandırılmış oynatılıyor.',
    start: app => { app.live.t = 0; app.live.done = false; app._startedOnce = true; },
    scenarios: [
      { id: 'ac11', name: 'İşyeri AC 11 kW · 60 kWh %20→%80', desc: 'Doğrulama örneği: 60 kWh × %60 = 36 kWh ideal enerji; 3 fazlı OBC ile 11 kW.', state: sc({}), start: true },
      { id: 'obc1f', name: 'AC 22 kW istasyon · 1 fazlı OBC’li araç', desc: 'İstasyon 22 kW verebilse de araçtaki 1 fazlı 32 A OBC gücü 7,4 kW’a sınırlar.', state: sc({ profile: 'AC22', obcPhases: 1, obcI: 32, capacity: 50, soc0: 15, soc1: 90 }), start: true },
      { id: 'dc120', name: 'Otoyol DC 120 kW · ticari hizmet', desc: '77 kWh batarya %10→%80; SOC %50’den sonra aracın kabul gücü düşer (tipik eğri).', state: sc({ profile: 'DC120', stationP: 120, capacity: 77, soc0: 10, soc1: 80, dcMax: 135, siteKW: 400, publicService: true }), start: true },
      { id: 'dc180car', name: 'DC 180 kW cihaz · 100 kW kabul eden araç', desc: 'Cihaz gücü yüksek olsa da sınırlayan aracın DC kabul gücüdür.', state: sc({ profile: 'DC180', stationP: 180, capacity: 82, soc0: 20, soc1: 80, dcMax: 100, siteKW: 400, publicService: true }), start: true },
      { id: 'share', name: 'Site otoparkı · 6 araç, 80 kW tesis gücü', desc: '6 × 22 kW talep 80 kW’ı aşar; dinamik yük yönetimi her noktaya 13,3 kW ayırır.', state: sc({ profile: 'AC22', obcPhases: 3, obcI: 32, nPoints: 6, siteKW: 80, capacity: 64, soc0: 30, soc1: 90 }), start: true },
      { id: 'const', name: 'DC 60 kW · sabit güç varsayımıyla karşılaştırma', desc: 'Sabit güç varsayımı süreyi kısa gösterir; tipik eğriye geçerek farkı görün.', state: sc({ profile: 'DC60', stationP: 60, curve: 'constant', capacity: 60, soc0: 20, soc1: 95, dcMax: 100, siteKW: 100 }), start: true }
    ],
    controls: controls,
    compute: s => SJ.compute(s),
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => live.done ? { level: 'ok', text: 'Şarj tamamlandı · %' + s.soc1 } : null,
    reportInputs: (s, app) => { const r = app.validResult; return r ? [{ group: 'Oynatma', label: 'Simülasyon zamanı', value: clock(app.live.t) + ' / ' + clock(r.values.minutes) }] : []; },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-6, 6], background: 0x9fb9d4 },
    view2d: view2d
  });
})();
