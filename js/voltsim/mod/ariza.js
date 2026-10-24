/* VoltSim · 3D Elektrik Arıza Tespit Laboratuvarı
 * Hesap: VoltSimEngine.ext.ariza (js/voltsim/calc/ariza.js): küçük AG tesisinin fazör düğüm çözücüsü, tohumlu arıza
 * senaryoları, sanal ölçü aletleri, koruma tepkileri, EN 50110 kural takibi ve puanlama. Sahne yalnız modelin durumunu
 * gösterir: kesici konumları, prob noktaları, ölçü aleti ekranı. Ölçüm değerleri her seferinde devre modelinden hesaplanır. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt, esc = VS.esc;
  const X = E.ext.ariza;
  const INST = X.INSTRUMENTS;
  const DEV = { q0: 'Q0 ana şalter', f1: 'F1 B10', rcd: 'RCD 30 mA', f2: 'F2 B16', f3: 'F3 sigortalı ayırıcı', f4: 'F4 C20' };

  function defaults() {
    return { mode: 'beginner', seed: 11, fault: '', inst: 'volt', pa: 'SoL', pb: 'SoN', target: '', ansType: '', ansLoc: '', sess: null, sessKey: '', speed: 1 };
  }
  const keyOf = s => s.mode + '|' + Math.round(s.seed) + '|' + (s.fault || '');
  const scOf = s => X.scenario(s.seed, s.mode, s.fault);
  function sessOf(s, sc) { return s.sess && s.sessKey === keyOf(s) && s.sess.sw ? s.sess : X.newSession(sc || scOf(s)); }
  function setSess(app, sess, msg, level) {
    app.state.sess = sess; app.state.sessKey = keyOf(app.state);
    if (msg) VS.toast(msg, level || 'info');
    app.renderControls(true); app.invalidate();
  }
  function initLive() { return { acc: {} }; }

  /* ---------------------------------------------------------------- işlemler */
  function op(app, dev, value) {
    const s = app.state, sc = scOf(s), r = X.operate(sc, sessOf(s, sc), dev, value);
    app.live.acc = {};
    if (r.sess === sessOf(s, sc) && r.msg) { VS.toast(r.msg, 'bad'); return; }
    setSess(app, r.sess, r.msg, r.trips && r.trips.length ? 'bad' : 'info');
  }
  function doMeasure(app, q) {
    const s = app.state, sc = scOf(s), sess = sessOf(s, sc);
    if (sess.done) { VS.toast('Teşhis gönderildi; yeni senaryo başlatın ya da Sıfırla.', 'bad'); return; }
    const r = X.record(sc, sess, q || { inst: s.inst, a: s.pa, b: s.pb, target: s.target });
    if (!r.m.ok) { VS.toast(r.m.text, 'bad'); return; }
    setSess(app, r.sess, (INST[r.e.inst].name + ': ' + r.m.text) + (r.m.violation ? ' · GÜVENLİK İHLALİ' : r.e.rules.length ? ' · eksik kural: ' + r.e.rules.join(', ') : ''), r.m.violation ? 'bad' : r.e.rules.length ? 'bad' : 'ok');
  }
  function submit(app) {
    const s = app.state, sc = scOf(s), sess = sessOf(s, sc);
    if (!s.ansType || !s.ansLoc) { VS.toast('Arıza tipini ve yerini seçin.', 'bad'); return; }
    if (sess.done) return;
    const n = JSON.parse(JSON.stringify(sess));
    n.done = Object.assign({ type: s.ansType, loc: s.ansLoc }, X.score(sc, sess, { type: s.ansType, loc: s.ansLoc }, s.mode));
    setSess(app, n, (n.done.typeOk ? 'Doğru teşhis! ' : 'Teşhis yanlış. ') + 'Puan ' + n.done.total + ' / 100', n.done.typeOk ? 'ok' : 'bad');
  }
  function newScenario(app) { app.state.seed = 1 + Math.floor(Math.random() * 998); app.state.fault = ''; app.state.ansType = ''; app.state.ansLoc = ''; app.state.sess = null; app.renderControls(true); app.invalidate(); }

  /* ---------------------------------------------------------------- hesap */
  function compute(s) {
    const v = new E.Validator();
    const seed = Math.round(v.num(s.seed, 'Senaryo tohumu', { min: 1, max: 999 }));
    if (!X.POOLS[s.mode]) v.errors.push('Geçersiz mod.');
    if (v.errors.length) return { ok: false, errors: v.errors, checks: [], values: {} };
    const sc = X.scenario(seed, s.mode, s.fault), sess = sessOf(s, sc), ac = X.solveAC(sc, sess.sw);
    const last = sess.log[sess.log.length - 1] || null;
    const dcTests = sess.log.filter(e => INST[e.inst].dc && !e.violation).length;
    const violations = sess.log.filter(e => e.violation).length, missing = sess.log.filter(e => e.rules && e.rules.length).length;
    const values = { seed: seed, key: keyOf(s), mode: s.mode, system: sc.system, symptom: sc.fault.symptom[s.mode === 'beginner' ? 0 : 1], sw: sess.sw, locks: sess.locks,
      motor: ac.motor, pulled: ac.pulled, n: sess.log.length, last: last, log: sess.log, violations: violations, missing: missing, dcTests: dcTests, done: sess.done || null, sc: sc };
    const checks = [];
    checks.push({ id: 'safety', label: 'Enerjisiz çalışma (EN 50110 beş kural)', status: violations ? 'fail' : missing ? 'warn' : dcTests ? 'ok' : 'info',
      detail: violations ? violations + ' kez gerilimli noktada direnç/yalıtım ölçümü denendi. Gerçekte cihaz hasarı ve elektrik çarpması riski: önce ayır, kilitle, gerilim yokluğunu doğrula.' : missing ? missing + ' DC ölçüm, kilit/etiket ya da gerilim yokluğu doğrulaması yapılmadan alındı.' : dcTests ? 'Direnç/yalıtım ölçümleri ayrılmış, kilitlenmiş ve gerilimsizliği doğrulanmış devrede yapıldı.' : 'Henüz DC ölçüm yok. Direnç ve yalıtım ölçümünden önce: ayır → kilitle/etiketle → gerilim yokluğunu doğrula.', ref: 'EN 50110-1' });
    checks.push({ id: 'meters', label: 'Ölçü aletleri', status: 'info', detail: 'Aletler IEC 61010 CAT III/IV ve IEC 61557 uyumlu kabul edildi. Yalıtım testi 500 V DC (500 V’a kadar devreler, sınır ≥ 1 MΩ); döngü ölçer RCD açmayan modda.', ref: 'HD 60364-6 / IEC 61557' });
    if (sess.done) checks.push({ id: 'diag', label: 'Teşhis', status: sess.done.typeOk ? (sess.done.locOk ? 'ok' : 'warn') : 'fail', detail: (sess.done.typeOk ? 'Doğru: ' : 'Doğru cevap: ') + sc.fault.name + ' · yer: ' + X.LOCS[sc.fault.loc] + '. ' + sc.fault.explain });
    checks.push({ id: 'auth', label: 'Gerçek tesiste arıza arama', status: 'info', detail: 'Gerçek arıza tespiti yalnız yetkili ve eğitimli personelce, iş güvenliği önlemleri ve enerjisiz çalışma prosedürleriyle yapılır. Bu laboratuvar eğitim modelidir.', ref: 'İş Ekipmanları Yönetmeliği' });
    return { ok: true, errors: [], values: values, checks: checks,
      assumptions: [
        'Devre modeli: 400/230 V, 50 Hz; 400 kVA trafo (uk ≈ %4), servis kablosu, ADP ve dört çıkış (aydınlatma L1, priz L2 + RCD, motor 5,5 kW, ısıtıcı 3 × 3 kW). Kablo direnci R = L/(56·S), reaktans 0,08 mΩ/m.',
        'Ölçümler fazör düğüm gerilimi çözümünden: her düğümden uzak toprağa 1 GΩ sağlam yalıtım; çözülen akım ve gerilimler ölçü aletinin yükü ihmal edilerek okunur.',
        'Motor: çalışırken anma empedansı (cosφ 0,83), kilitli rotorda Ist = 7·In (cosφ 0,4); duran motor sargıları DC’de 1,3 Ω. Kontaktör %85·Us altında çekmez; bobin DC direnci 600 Ω (tipik, üreticiye bağlı).',
        'RCD %70·IΔn kaçakta açar (IΔn/2–IΔn bandında temsili). MCB aşırı yük açması zaman ölçeğinde hızlandırılmıştır. Termik röle sınıf 10 eğrisinin üst sınırından ölçeklenir.',
        'Sıcaklıklar kararlı durum yaklaşımıdır: bağlantı ΔT = 8 K/W·I²·Rc, kablo ΔT = 40 K·(I/Iz)².',
        'Toprak direnci ölçeri elektrodun kendi direncini (3 kazık) okur; topraklama iletkeninin sürekliliği ayrıca ölçülmelidir.',
        'Senaryo tohumla üretilir: aynı tohum ve mod aynı arızayı ve parametreleri verir.'
      ],
      formulas: ['Y·V = J (düğüm gerilimi, Norton kaynakları)', 'V_n = Σ(Y_i·E_i) / (ΣY_i + Y_toprak) (açık nötr)', 'I_LR ≈ (√3/2)·I_st (tek fazda kilitli rotor)', 'Z_s = Z_t·(U₀ − U₁)/U₁ (döngü ölçer, test yükü)', 'I_kaçak = |I_L + I_N| (pens L+N)', 'P_temas = I²·R_c']
    };
  }

  /* ---------------------------------------------------------------- kontroller */
  const ptOpts = () => X.POINTS.map(p => [p.id, p.name]);
  function controls(s, app) {
    const r = app.validResult && app.validResult.values, sess = r ? sessOf(s) : null, sw = sess ? sess.sw : X.initialSwitches(scOf(s)), locks = sess ? sess.locks : {};
    const inst = INST[s.inst] || INST.volt;
    const tg = s.inst === 'clamp' ? X.CLAMPS : s.inst === 'rot' ? X.ROTS : s.inst === 'loop' ? X.LOOPS : s.inst === 'thermal' ? X.THERMAL : null;
    const dev = (k, label) => {
      const on = k === 'rcd' ? sw.rcd : sw[k], lk = { q0: 'q0', f1: 'f1', rcd: 'f2', f2: 'f2', f3: 'f3', f4: 'f4' }[k];
      return [{ label: label + (on ? ' · AÇ' : ' · KAPAT'), variant: on ? 'warn' : 'primary', onClick: a => op(a, k, !on) },
        !on && lk && !(k === 'rcd' && locks.f2) ? { label: locks[lk] ? label + ' · kilidi kaldır' : label + ' · kilitle/etiketle', variant: locks[lk] ? undefined : 'danger', onClick: a => op(a, k, locks[lk] ? 'unlock' : 'lock') } : null].filter(Boolean);
    };
    const pool = X.POOLS[s.mode] || X.POOLS.beginner;
    return [
      { title: 'Senaryo', items: [
        { type: 'range', key: 'seed', label: 'Senaryo tohumu (tekrarlanabilir)', min: 1, max: 999, step: 1, rebuild: true },
        { type: 'seg', key: 'mode', label: 'Zorluk', options: Object.keys(X.MODES).map(k => [k, X.MODES[k]]) },
        { type: 'buttons', items: [{ label: 'Yeni rastgele senaryo', variant: 'primary', onClick: newScenario }] },
        { type: 'note', level: 'warn', html: '<b>Güvenlik:</b> Gerçek tesiste arıza arama yalnız yetkili personelce, ayırma–kilitleme–gerilim yokluğu doğrulama adımlarıyla yapılır. Bkz. <a style="color:#fcd34d;text-decoration:underline" href="/bilgi/enerjisiz-calisma-is-guvenligi.html">Enerjisiz çalışma ve iş güvenliği</a>.' }
      ] },
      { title: 'Ölçü aleti', items: [
        { type: 'select', key: 'inst', label: 'Alet', options: Object.keys(INST).map(k => [k, INST[k].name]), rebuild: true },
        inst.two ? { type: 'select', key: 'pa', label: 'Kırmızı prob (A)', options: ptOpts() } : null,
        inst.two ? { type: 'select', key: 'pb', label: 'Siyah prob (B)', options: ptOpts() } : null,
        tg ? { type: 'select', key: 'target', label: s.inst === 'clamp' ? 'Pensle sarılacak iletken' : s.inst === 'thermal' ? 'Bakılacak ekipman' : 'Ölçüm noktası', options: [['', 'Seçin…']].concat(tg.map(x => [x.id, x.name])) } : null,
        { type: 'buttons', items: [{ label: 'Ölç', variant: 'primary', onClick: a => doMeasure(a) }] },
        { type: 'note', text: s.inst === 'insul' || s.inst === 'ohm' ? 'DC ölçüm: yalnız ayrılmış, kilitlenmiş ve gerilimsizliği doğrulanmış devrede. Gerilimli noktada alet ölçmez ve güvenlik ihlali sayılır. Yükler bağlıysa (cihaz takılı, nötr köprüsü bağlı) okunan değer yük üzerinden düşer.' : s.inst === 'volt' ? 'Gerilim yokluğunu doğrulamak için ayrılmış devrede L–N, L–PE ve N–PE ölçün. 3D sahnede bir noktaya tıklayıp prob bağlayabilirsiniz.' : s.inst === 'clamp' ? '“L + N birlikte” seçeneği iki iletkeni aynı anda sarar: sonuç kaçak (fark) akımıdır.' : s.inst === 'earth' ? 'Toprak elektrodunun direnci (3 kazık yöntemi); hedef seçmeye gerek yok.' : 'Hedefi seçip Ölç’e basın ya da 3D’de ekipmana tıklayın.' },
        r && r.last ? { type: 'note', html: '<b>Son ölçüm:</b> ' + esc(INST[r.last.inst].name) + ' · ' + esc(pointLabel(r.last)) + ' → <b>' + esc(r.last.text) + '</b>' } : null
      ] },
      { title: 'Anahtarlama ve emniyet', items: [
        { type: 'buttons', items: dev('q0', 'Q0') },
        { type: 'buttons', items: dev('f1', 'F1').concat(dev('rcd', 'RCD'), dev('f2', 'F2')) },
        { type: 'buttons', items: dev('f3', 'F3').concat(dev('f4', 'F4')) },
        { type: 'buttons', items: [
          { label: sw.k1 ? 'Motor STOP' : 'Motor START', variant: sw.k1 ? 'warn' : 'primary', onClick: a => op(a, 'k1', !sw.k1) },
          sw.ol ? null : { label: 'Termik röleyi resetle', onClick: a => op(a, 'ol', true) }
        ].filter(Boolean) },
        { type: 'buttons', items: [
          { label: sw.plug ? 'Cihaz fişini çek' : 'Cihaz fişini tak', onClick: a => op(a, 'plug', !sw.plug) },
          { label: sw.n2 ? 'F2 nötrünü ayır' : 'F2 nötrünü bağla', onClick: a => op(a, 'n2', !sw.n2) },
          { label: sw.n4 ? 'F4 nötrünü ayır' : 'F4 nötrünü bağla', onClick: a => op(a, 'n4', !sw.n4) }
        ] },
        { type: 'note', html: devSummary(sw, locks, r) }
      ] },
      { title: 'Teşhis', items: [
        { type: 'select', key: 'ansType', label: 'Arıza tipi', options: [['', 'Seçin…']].concat((s.mode === 'beginner' ? pool : Object.keys(X.FAULTS)).map(k => [k, X.FAULTS[k].name])) },
        { type: 'select', key: 'ansLoc', label: 'Arıza yeri', options: [['', 'Seçin…']].concat(Object.keys(X.LOCS).map(k => [k, X.LOCS[k]])) },
        r && r.done ? null : { type: 'buttons', items: [{ label: 'Teşhisi gönder', variant: 'primary', onClick: submit }] },
        r && r.done ? { type: 'note', level: r.done.typeOk ? undefined : 'warn', html: '<b>Puan ' + r.done.total + ' / 100</b> · tip ' + (r.done.typeOk ? '✓' : '✕') + ' · yer ' + (r.done.locOk ? '✓' : '✕') + ' · verim ' + r.done.eff + ' · güvenlik ' + r.done.safety + '<br><b>Doğru cevap:</b> ' + esc(r.sc.fault.name) + ' (' + esc(X.LOCS[r.sc.fault.loc]) + ')<br>' + esc(r.sc.fault.explain) +
          '<br><b>Doğru ölçüm yolu (en az ' + r.sc.fault.optimal + ' ölçüm):</b><ol style="margin:4px 0 0;padding-left:18px">' + r.sc.fault.path.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' } : null,
        r && r.done ? { type: 'buttons', items: [{ label: 'Yeni senaryo', variant: 'primary', onClick: newScenario }] } : null,
        s.mode === 'beginner' && r && !r.done ? { type: 'note', text: 'İpucu: ' + r.sc.fault.hint } : null
      ] },
      r && r.log.length ? { title: 'Ölçüm günlüğü (' + r.log.length + ')', collapsed: true, summary: 'Son ölçümler', items: [
        { type: 'note', html: '<ol style="margin:0;padding-left:18px">' + r.log.slice(-14).map(e => '<li>' + esc(INST[e.inst].name.split(' · ').pop()) + ' · ' + esc(pointLabel(e)) + ': <b>' + esc(e.text) + '</b>' + (e.violation ? ' <b style="color:#fca5a5">İHLAL</b>' : e.rules && e.rules.length ? ' <i>(eksik: ' + esc(e.rules.join(', ')) + ')</i>' : '') + '</li>').join('') + '</ol>' }
      ] } : null
    ];
  }
  function pointLabel(e) {
    if (e.a) return (X.PT[e.a] ? X.PT[e.a].name : e.a) + ' ↔ ' + (X.PT[e.b] ? X.PT[e.b].name : e.b);
    const all = X.CLAMPS.concat(X.ROTS, X.LOOPS, X.THERMAL); const t = all.find(x => x.id === e.target);
    return t ? t.name : e.target === 'EL' ? 'Toprak elektrodu' : '';
  }
  function devSummary(sw, locks, r) {
    const st = (on, k) => (on ? 'kapalı' : 'açık') + (locks[k] ? ' 🔒' : '');
    return 'Q0 ' + st(sw.q0, 'q0') + ' · F1 ' + st(sw.f1, 'f1') + ' · RCD ' + st(sw.rcd, 'f2') + ' · F2 ' + st(sw.f2, 'f2') + ' · F3 ' + st(sw.f3, 'f3') + ' · F4 ' + st(sw.f4, 'f4') +
      '<br>Motor: ' + (r ? { run: 'çalışıyor', reverse: 'çalışıyor', locked: 'uğulduyor, dönmüyor', stop: 'duruyor' }[r.motor] : '—') + ' · termik ' + (sw.ol ? 'normal' : 'AÇMIŞ') + ' · cihaz ' + (sw.plug ? 'takılı' : 'fiş çekili');
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s) {
    const v = res.values, d = v.done;
    return [
      { label: 'Belirti', value: v.symptom, wide: true, level: 'info', sub: 'Tesis ' + v.system + ' · ' + X.MODES[v.mode] + ' modu · tohum ' + v.seed },
      { label: 'Seçili alet', value: (INST[s.inst] || INST.volt).name },
      { label: 'Ölçüm sayısı', value: String(v.n), sub: v.dcTests + ' DC ölçüm' },
      { label: 'Güvenlik', value: v.violations ? v.violations + ' ihlal' : v.missing ? v.missing + ' eksik kural' : 'Uygun', level: v.violations ? 'bad' : v.missing ? 'warn' : 'ok', sub: 'ayır · kilitle · doğrula' },
      { label: 'Motor', value: { run: 'Çalışıyor', reverse: 'Çalışıyor', locked: 'Uğulduyor (kilitli)', stop: 'Duruyor' }[v.motor], level: v.motor === 'locked' ? 'bad' : undefined, sub: v.sw.ol ? 'termik normal' : 'termik açmış' },
      { label: 'Son ölçüm', value: v.last ? v.last.text : '—', sub: v.last ? pointLabel(v.last) : 'Alet seçip ölçün ya da 3D’de noktaya tıklayın', wide: true, level: v.last && v.last.violation ? 'bad' : undefined },
      d ? { label: 'Teşhis puanı', value: d.total + ' / 100', level: d.total >= 80 ? 'ok' : d.typeOk ? 'warn' : 'bad', sub: (d.typeOk ? 'doğru tip' : 'yanlış tip') + ' · ' + (d.locOk ? 'doğru yer' : 'yanlış yer') + ' · ' + d.n + ' ölçüm (en az ' + d.optimal + ')', wide: true } : null
    ].filter(Boolean);
  }
  function charts(res) {
    const v = res.values, out = [];
    const volts = v.log.filter(e => e.inst === 'volt' && e.value !== null).slice(-12);
    if (volts.length) out.push({ id: 'volts', title: 'Gerilim ölçümleri (son 12, V)', height: 140, series: [{ name: 'V', type: 'bar', color: 'amber', data: volts.map((e, i) => [i + 1, e.value]) }],
      hLines: [{ y: 230, label: '230 V', color: '#22b8cf' }, { y: 50, label: '50 V', color: '#ef4444' }], x: { min: 0.4, max: volts.length + 0.6, ticks: volts.map((e, i) => i + 1), fmt: x => '#' + (volts[x - 1] ? volts[x - 1].n : x) }, y: { min: 0, label: 'V' },
      alt: volts.map(e => '#' + e.n + ' ' + e.text).join('; ') });
    const th = v.log.filter(e => e.inst === 'thermal' && e.value !== null).slice(-8);
    if (th.length) out.push({ id: 'thermal', title: 'Termal kamera (°C)', height: 130, series: [{ name: '°C', type: 'bar', color: 'red', data: th.map((e, i) => [i + 1, e.value]) }], hLines: [{ y: 70, label: '70 °C', color: '#f59e0b' }],
      x: { min: 0.4, max: th.length + 0.6, ticks: th.map((e, i) => i + 1), fmt: x => '#' + (th[x - 1] ? th[x - 1].n : x) }, y: { min: 0, label: '°C' }, alt: th.map(e => '#' + e.n + ' ' + e.text).join('; ') });
    if (v.done) out.push({ id: 'score', title: 'Puan dağılımı', height: 130, series: [{ name: 'Puan', type: 'bar', color: 'green', data: [[1, v.done.typeOk ? 60 : 0], [2, v.done.locOk ? 15 : 0], [3, v.done.eff], [4, v.done.safety]] }],
      x: { min: 0.4, max: 4.6, ticks: [1, 2, 3, 4], fmt: x => ['', 'Tip /60', 'Yer /15', 'Verim /15', 'Güvenlik /10'][x] || '' }, y: { label: 'puan' }, alt: 'Toplam ' + v.done.total + ' / 100.' });
    return out;
  }

  /* ---------------------------------------------------------------- zaman: termik açmalar */
  function tick(app, dt) {
    const s = app.state, r = app.validResult; if (!r || !r.ok) return false;
    const sc = scOf(s), sess = sessOf(s, sc);
    const st = X.thermalStep(sc, sess, app.live.acc, dt * (s.speed || 1), 1);
    app.live.acc = st.acc;
    if (st.trip) {
      const n = JSON.parse(JSON.stringify(sess));
      if (st.trip.dev === 'f2') n.sw.f2 = false; else { n.sw.ol = false; n.sw.k1 = false; }
      app.live.acc = {};
      setSess(app, n, st.trip.why, 'bad');
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  // Ölçüm noktalarının dünya konumları (oda: arka duvar z = −3, sağ duvar x = 5)
  const PB = [-2.8, 0, -2.78]; // pano gövdesi merkezi tabanı
  const POS = {};
  (function () {
    const px = (x, y) => [PB[0] + x, PB[1] + y, PB[2] + 0.28];
    ['M1', 'M2', 'M3', 'MN'].forEach((k, i) => { POS[k] = px(-0.62 + i * 0.12, 1.98); });
    ['B1', 'B2', 'B3', 'BN'].forEach((k, i) => { POS[k] = px(-0.62 + i * 0.12, 1.52); });
    POS.PE = px(0.5, 0.42);
    POS.F1o = px(-0.6, 1.08); POS.R2L = px(-0.4, 1.08); POS.R2N = px(-0.32, 1.08); POS.F2o = px(-0.18, 1.08);
    ['F3o1', 'F3o2', 'F3o3'].forEach((k, i) => { POS[k] = px(0.02 + i * 0.1, 1.08); });
    ['K1o1', 'K1o2', 'K1o3'].forEach((k, i) => { POS[k] = px(-0.55 + i * 0.09, 0.6); });
    POS.A1 = px(-0.6, 0.86); POS.A2 = px(-0.38, 0.86);
    ['F4o1', 'F4o2', 'F4o3'].forEach((k, i) => { POS[k] = px(0.38 + i * 0.1, 1.08); });
    POS.LmpL = [-0.2, 2.42, -2.9]; POS.LmpN = [0, 2.42, -2.9]; POS.LmpPE = [0.2, 2.42, -2.9];
    POS.SoL = [0.86, 0.45, -2.92]; POS.SoN = [1.04, 0.45, -2.92]; POS.SoPE = [0.95, 0.56, -2.92];
    POS.ApL = [1.2, 0.25, -2.3]; POS.ApN = [1.34, 0.25, -2.3]; POS.ApPE = [1.27, 0.36, -2.3];
    POS.MU = [2.75, 0.98, 0.25]; POS.MV = [2.9, 0.98, 0.25]; POS.MW = [3.05, 0.98, 0.25]; POS.MPEc = [3.25, 0.9, 0.25];
    [1, 2, 3].forEach(i => { POS['H' + i + 't'] = [4.92, 0.95, -1.35 + i * 0.16]; POS['H' + i] = [4.92, 1.15, -1.35 + i * 0.16]; });
    POS.HN = [4.92, 1.15, -0.65]; POS.HPE = [4.92, 0.95, -0.65];
    POS.EL = [-4.2, 0.12, 1.6]; POS.RE = [-4.4, 0.35, 3.2];
  })();
  const CLAMP_POS = { c1L: [-3.25, 0.15, -2.6], c2L: [-2.95, 0.15, -2.6], c2N: [-2.85, 0.15, -2.6], c2LN: [-2.9, 0.15, -2.45], c2PE: [-2.75, 0.15, -2.6], c3L1: [-2.55, 0.15, -2.6], c3L2: [-2.45, 0.15, -2.6], c3L3: [-2.35, 0.15, -2.6],
    c4L1: [-2.15, 0.15, -2.6], c4L2: [-2.05, 0.15, -2.6], c4L3: [-1.95, 0.15, -2.6], c4N: [-1.85, 0.15, -2.6], q0N: [-3.4, 2.35, -2.75], earthC: [-3.9, 0.12, -1.2] };

  function rebuildOn() { return 'ariza1'; }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const sc3 = { pts: {}, devs: {}, sig: '' }; app.scene3 = sc3;
    k.ground(40, M.concrete, 0);
    const room = k.staticGroup(null, 0, 0, 0);
    k.box(10.4, 3.2, 0.12, M.wallPanel, 0, 1.6, -3.06, room);
    k.box(0.12, 3.2, 6.2, M.wallPanel, 5.06, 1.6, -0.05, room);
    k.box(10.4, 0.04, 6.2, M.concreteDark, 0, 0.02, -0.05, room);
    k.box(8.6, 0.06, 0.25, M.galv, -0.3, 2.8, -2.85, room); // kablo tavası
    buildPanel(k, sc3, app);
    buildLoads(k, sc3, app);
    buildEarth(k, sc3, app);
    buildCart(k, sc3, app);
    // prob/ölçüm noktaları
    const ptMat = k.mat(0x94a3b8, { metalness: 0.6, roughness: 0.35 });
    X.POINTS.forEach(p => {
      const pos = POS[p.id]; if (!pos) return;
      const m = k.sphere(0.035, ptMat, pos[0], pos[1], pos[2]); m.castShadow = false;
      sc3.pts[p.id] = m;
      k.pickable(m, p.name, a => pointInfo(a, p), a => pointActions(a, p));
    });
    // pens noktaları (iletken halkaları)
    const ring = k.mat(0xfacc15, { roughness: 0.4 });
    X.CLAMPS.forEach(c => {
      const pos = CLAMP_POS[c.id]; if (!pos) return;
      const m = new T.Mesh(new T.TorusGeometry(0.045, 0.012, 8, 20), ring); m.position.set(pos[0], pos[1], pos[2]); m.rotation.x = Math.PI / 2; v.root.add(m);
      k.pickable(m, 'Pens: ' + c.name, () => ['Pens ampermetre bu iletken(ler)i sarar.', c.leak ? 'L ve N birlikte sarılınca yük akımları birbirini götürür: sonuç kaçak akımdır.' : 'Tek iletken: yük akımı.'],
        () => [{ label: 'Pensle ölç', variant: 'primary', onClick: a => { a.state.inst = 'clamp'; a.state.target = c.id; doMeasure(a, { inst: 'clamp', target: c.id }); } }]);
    });
    // prob işaretleri ve uçları
    sc3.probeA = k.sphere(0.06, k.mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.6 }), 0, -5, 0); sc3.probeB = k.sphere(0.06, k.mat(0x111827, { emissive: 0x334155, emissiveIntensity: 0.6 }), 0, -5, 0);
    sc3.probeA.castShadow = sc3.probeB.castShadow = false;
    const lineGeo = () => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); return g; };
    sc3.leadA = new T.Line(lineGeo(), new T.LineBasicMaterial({ color: 0xef4444 })); sc3.leadB = new T.Line(lineGeo(), new T.LineBasicMaterial({ color: 0x94a3b8 }));
    v.root.add(sc3.leadA); v.root.add(sc3.leadB);
    sc3.lblA = k.label('A', sc3.probeA, [0, 0.12, 0], 'vs-label--sm'); sc3.lblB = k.label('B', sc3.probeB, [0, 0.12, 0], 'vs-label--sm');
    app.def.scene.bounds = [-5, 5.2];
    v.setView({ target: [0, 1.1, -0.9], r: 9.5, theta: 0.1, phi: 1.12, limits: { rMin: 1.2, rMax: 22 } });
    v.setShadowBox(7, 40);
    v.sun.position.set(3, 9, 6);
    apply3d(k, app, true);
  }
  function pointInfo(a, p) {
    const r = a.validResult && a.validResult.values; const lines = [p.name, 'Devre: ' + ({ supply: 'şebeke tarafı (Q0 öncesi, daima gerilimli)', bus: 'ADP baraları', earth: 'topraklama', app: 'prizdeki cihaz' }[p.circ] || p.circ)];
    lines.push('Seçili alet: ' + (INST[a.state.inst] || INST.volt).name);
    if (r && r.last) lines.push('Son ölçüm: ' + r.last.text);
    return lines;
  }
  function pointActions(a, p) {
    const s = a.state, inst = INST[s.inst] || INST.volt, acts = [];
    if (inst.two) {
      acts.push({ label: 'Kırmızı prob (A) buraya', variant: 'primary', onClick: x => { x.state.pa = p.id; if (x.state.pb && x.state.pb !== p.id) doMeasure(x, { inst: x.state.inst, a: p.id, b: x.state.pb }); else { x.renderControls(true); x.invalidate(); } } });
      acts.push({ label: 'Siyah prob (B) buraya', onClick: x => { x.state.pb = p.id; if (x.state.pa && x.state.pa !== p.id) doMeasure(x, { inst: x.state.inst, a: x.state.pa, b: p.id }); else { x.renderControls(true); x.invalidate(); } } });
    }
    if (s.inst === 'rot') X.ROTS.filter(r => r.nodes.indexOf(p.node) >= 0).forEach(r => acts.push({ label: 'Faz sırası: ' + r.name, variant: 'primary', onClick: x => { x.state.target = r.id; doMeasure(x, { inst: 'rot', target: r.id }); } }));
    if (s.inst === 'loop') X.LOOPS.filter(l => l.L === p.node || l.R === p.node).forEach(l => acts.push({ label: 'Döngü: ' + l.name, variant: 'primary', onClick: x => { x.state.target = l.id; doMeasure(x, { inst: 'loop', target: l.id }); } }));
    if (s.inst === 'earth' && p.id === 'EL') acts.push({ label: 'Elektrot direncini ölç', variant: 'primary', onClick: x => doMeasure(x, { inst: 'earth', target: 'EL' }) });
    if (!acts.length) acts.push({ label: 'Alet: AC gerilim (multimetre)', onClick: x => { x.state.inst = 'volt'; x.renderControls(true); x.invalidate(); } });
    return acts;
  }
  const thermalAct = id => ({ label: 'Termal kamerayla bak', onClick: a => { a.state.inst = 'thermal'; a.state.target = id; doMeasure(a, { inst: 'thermal', target: id }); } });

  /* ADP: kesiciler, kontaktör, baralar */
  function buildPanel(k, sc3, app) {
    const M = k.mats;
    const g = k.group(null, PB[0], PB[1], PB[2]);
    k.box(1.6, 2.3, 0.4, M.panelRAL7035, 0, 1.15, -0.02, g);
    const door = k.group(g, -0.8, 0, 0.2); k.box(1.6, 2.3, 0.03, M.panelRAL7035, 0.8, 1.15, 0, door); door.rotation.y = -1.9;
    k.box(1.44, 2.1, 0.02, M.plate, 0, 1.15, 0.16, g);
    [1.98, 1.52, 1.18, 0.74].forEach(y => k.box(1.36, 0.035, 0.03, M.alu, 0, y + 0.12, 0.2, g)); // DIN rayları
    // bara (L1 L2 L3 N) ve PE barası
    ['L1', 'L2', 'L3', 'N'].forEach((n, i) => k.box(0.03, 0.42, 0.02, i === 3 ? M.N : M.copper, -0.62 + i * 0.12, 1.75, 0.27, g));
    k.box(0.6, 0.04, 0.03, M.PE, 0.35, 0.42 - PB[1], 0.27, g);
    const dev = (key, x, y, w, poles, title, actFn) => {
      const d = k.group(g, x, y, 0.22);
      k.rbox(w, 0.24, 0.12, 0.01, M.plasticWhite, 0, 0, 0, d);
      const h = k.box(Math.min(0.05 * poles, w - 0.02), 0.05, 0.04, key === 'f3' ? M.plasticRed : M.plasticBlue, 0, 0.03, 0.07, d);
      const flag = k.box(0.03, 0.02, 0.01, M.plasticGreen, w / 2 - 0.03, 0.08, 0.062, d);
      sc3.devs[key] = { h: h, flag: flag };
      k.pickable(d, title, a => devInfo(a, key, title), a => actFn(a));
      return d;
    };
    const sw = a => sessOf(a.state).sw, lk = a => sessOf(a.state).locks;
    const swActs = (key, lockKey) => a => { const on = sw(a)[key]; return [{ label: on ? 'Aç (ayır)' : 'Kapat', variant: on ? 'warn' : 'primary', onClick: x => op(x, key, !on) }, !on ? { label: lk(a)[lockKey] ? 'Kilidi kaldır' : 'Kilitle ve etiketle', variant: lk(a)[lockKey] ? undefined : 'danger', onClick: x => op(x, key, lk(a)[lockKey] ? 'unlock' : 'lock') } : null, thermalAct('tMdb')].filter(Boolean); };
    dev('q0', -0.42, 1.98, 0.36, 4, 'Q0 ana şalter (4 kutup)', swActs('q0', 'q0'));
    dev('f1', -0.6, 1.18, 0.08, 1, 'F1 aydınlatma B10', swActs('f1', 'f1'));
    dev('rcd', -0.36, 1.18, 0.16, 2, 'RCD 30 mA (F2 priz)', a => swActs('rcd', 'f2')(a).concat([{ label: 'Test butonu', onClick: x => VS.toast(sw(x).rcd ? 'Test butonu: RCD mekanik olarak açtı (kurup tekrar kapatın).' : 'RCD zaten açık.', 'info') }]));
    dev('f2', -0.18, 1.18, 0.08, 1, 'F2 priz B16', swActs('f2', 'f2'));
    dev('f3', 0.12, 1.18, 0.3, 3, 'F3 sigortalı yük ayırıcı 3 × 16 A gG', swActs('f3', 'f3'));
    dev('f4', 0.48, 1.18, 0.26, 3, 'F4 ısıtıcı C20 (3 kutup)', swActs('f4', 'f4'));
    // kontaktör + termik röle
    const kg = k.group(g, -0.46, 0.74, 0.22);
    k.rbox(0.26, 0.3, 0.14, 0.01, M.plasticGrey, 0, 0, 0, kg);
    sc3.k1led = k.box(0.08, 0.03, 0.01, M.ledOff, 0, 0.08, 0.075, kg); sc3.k1led.userData.noMerge = true;
    k.rbox(0.26, 0.12, 0.12, 0.01, M.plasticDark, 0, -0.22, 0, kg);
    sc3.olFlag = k.box(0.05, 0.03, 0.01, M.plasticGreen, 0.08, -0.2, 0.065, kg); sc3.olFlag.userData.noMerge = true;
    k.pickable(kg, 'K1 kontaktör + termik röle', a => { const r = a.validResult && a.validResult.values; return ['Bobin 230 V AC (A1–A2), kumanda L1–N; çekme ≥ %85·Us', 'Durum: ' + (r && r.pulled ? 'ÇEKİLİ' : 'bırakmış') + ' · termik ' + (sw(a).ol ? 'normal' : 'AÇMIŞ'), 'Start/stop komutu: ' + (sw(a).k1 ? 'verildi' : 'yok')]; },
      a => [{ label: sw(a).k1 ? 'STOP' : 'START', variant: sw(a).k1 ? 'warn' : 'primary', onClick: x => op(x, 'k1', !sw(x).k1) }, sw(a).ol ? null : { label: 'Termik reset', onClick: x => op(x, 'ol', true) }, thermalAct('tK1')].filter(Boolean));
    // N köprüleri
    const nb = k.group(g, 0.35, 0.86, 0.24);
    k.box(0.5, 0.05, 0.04, M.N, 0, 0, 0, nb);
    k.pickable(nb, 'N barası ve devre nötr köprüleri', a => ['F1, F2, F4 nötrleri ayrı klemenslerle N barasına bağlıdır.', 'Yalıtım ölçümünde (N–PE) devre nötrü baradan ayrılmalıdır.', 'F2: ' + (sw(a).n2 ? 'bağlı' : 'AYRIK') + ' · F4: ' + (sw(a).n4 ? 'bağlı' : 'AYRIK')],
      a => [{ label: sw(a).n2 ? 'F2 nötrünü ayır' : 'F2 nötrünü bağla', onClick: x => op(x, 'n2', !sw(x).n2) }, { label: sw(a).n4 ? 'F4 nötrünü ayır' : 'F4 nötrünü bağla', onClick: x => op(x, 'n4', !sw(x).n4) }]);
    k.label('ADP', g, [0, 2.6, 0]);
    // çıkış kabloları
    const cab = (pts) => k.tube(pts, 0.018, M.cableBlack, null);
    cab([[PB[0] - 0.5, 0.25, PB[2] + 0.1], [PB[0] - 0.5, 2.75, PB[2] + 0.1], [-0.1, 2.78, -2.85], [-0.1, 2.5, -2.92]]);
    cab([[PB[0] - 0.2, 0.25, PB[2] + 0.1], [PB[0] - 0.2, 0.08, -2.75], [0.95, 0.08, -2.88], [0.95, 0.35, -2.92]]);
    cab([[PB[0] + 0.2, 0.08, -2.7], [1.5, 0.06, -1.2], [2.9, 0.06, 0.1], [2.9, 0.8, 0.22]]);
    cab([[PB[0] + 0.5, 0.25, PB[2] + 0.1], [PB[0] + 0.5, 2.7, PB[2] + 0.1], [4.8, 2.75, -2.85], [4.9, 2.7, -1], [4.92, 1.0, -1]]);
    cab([[PB[0] - 0.7, 2.4, PB[2]], [PB[0] - 0.7, 3.2, PB[2]]]);
  }
  function devInfo(a, key, title) {
    const sess = sessOf(a.state), sw = sess.sw, lk = { q0: 'q0', f1: 'f1', rcd: 'f2', f2: 'f2', f3: 'f3', f4: 'f4' }[key];
    return [title, 'Konum: ' + (sw[key] ? 'KAPALI (devrede)' : 'AÇIK (ayrılmış)') + (sess.locks[lk] ? ' · kilitli/etiketli' : ''), key === 'q0' ? 'Q0 öncesi (ADP girişi) her zaman gerilimlidir.' : key === 'f1' || key === 'f2' ? 'Tek kutuplu MCB: nötrü ayırmaz.' : key === 'f3' ? 'Sigorta ayırıcı açılınca sigortalar devreden çıkar.' : key === 'rcd' ? 'RCD faz ve nötrü birlikte ayırır.' : 'Nötr anahtarlanmaz.'];
  }

  /* yükler: lamba, priz + cihaz, motor + pompa, ısıtıcı */
  function buildLoads(k, sc3, app) {
    const M = k.mats, T = k.T;
    const sw = a => sessOf(a.state).sw;
    // lamba armatürü
    const lg = k.group(null, 0, 2.55, -2.86);
    k.box(1.3, 0.12, 0.2, M.plasticWhite, 0, 0, 0.05, lg);
    sc3.lampTube = k.box(1.2, 0.04, 0.05, k.mat(0xfff7d6, { emissive: 0xfff3c4, emissiveIntensity: 0 }), 0, -0.07, 0.08, lg); sc3.lampTube.userData.noMerge = true;
    k.box(0.5, 0.1, 0.08, M.plasticGrey, 0, -0.13, -0.02, lg);
    k.pickable(lg, 'Aydınlatma armatürü (F1, L1)', a => ['Yük ' + fmt(scOf(a.state).p.lampW, 0, 'W') + ' · F1 B10, 1,5 mm², 25 m'], () => [thermalAct('tLmp')]);
    // priz ve cihaz
    const so = k.group(null, 0.95, 0.5, -2.98);
    k.rbox(0.36, 0.3, 0.05, 0.03, M.plasticWhite, 0, 0, 0, so);
    k.pickable(so, 'Priz (F2: RCD 30 mA + B16)', a => ['2,5 mm², 30 m · TN-C-S’de PE ADP’de N’den ayrılır', 'Cihaz: ' + (sw(a).plug ? 'takılı' : 'fiş çekili')], a => [{ label: sw(a).plug ? 'Fişi çek' : 'Fişi tak', onClick: x => op(x, 'plug', !sw(x).plug) }, thermalAct('tSo')]);
    const ap = k.group(null, 1.3, 0, -2.0);
    k.rbox(0.7, 0.55, 0.5, 0.04, k.mat(0x2563eb, { metalness: 0.3, roughness: 0.5 }), 0, 0.3, 0, ap);
    k.cyl(0.18, 0.18, 0.04, M.darkSteel, 0, 0.3, 0.26, ap, 20).rotation.x = Math.PI / 2;
    sc3.plugCable = k.tube([[1.27, 0.3, -2.3], [1.1, 0.08, -2.6], [0.95, 0.4, -2.92]], 0.012, M.cableBlack, null);
    k.pickable(ap, 'Prizdeki cihaz', a => { const sc = scOf(a.state); return [sc.p.appName + ' · ' + fmt(sc.p.appW, 0, 'W') + (sc.type === 'overload' ? ' + çoklu prizde ikinci ısıtıcı ' + fmt(sc.p.extraW, 0, 'W') : ''), 'Metal gövde, PE’ye bağlı (sınıf I)']; },
      a => [{ label: sw(a).plug ? 'Fişi çek' : 'Fişi tak', onClick: x => op(x, 'plug', !sw(x).plug) }, thermalAct('tApp')]);
    // motor + pompa
    const mg = k.group(null, 2.9, 0, 0.0);
    k.box(1.6, 0.12, 0.5, M.darkSteel, 0.2, 0.06, 0, mg);
    const body = k.cyl(0.3, 0.3, 0.7, k.mat(0x1e5aa8, { metalness: 0.4, roughness: 0.45 }), 0, 0.5, 0, mg, 24); body.rotation.z = Math.PI / 2;
    for (let i = 0; i < 8; i++) { const f = k.box(0.62, 0.02, 0.62, k.mat(0x1e5aa8, { metalness: 0.4, roughness: 0.45 }), 0, 0.5, 0, mg); f.rotation.x = i * Math.PI / 8; f.scale.set(1, 1, 1); }
    k.box(0.4, 0.16, 0.22, M.plasticDark, 0.05, 0.86, 0.14, mg); // klemens kutusu
    sc3.shaft = k.group(mg, 0.55, 0.5, 0); const sh = k.cyl(0.04, 0.04, 0.3, M.steel, 0, 0, 0, sc3.shaft, 12); sh.rotation.z = Math.PI / 2; k.box(0.05, 0.18, 0.03, M.steel, 0.12, 0, 0, sc3.shaft);
    k.cyl(0.25, 0.25, 0.3, M.galv, 0.95, 0.42, 0, mg, 20);
    sc3.motorArrow = k.label('↻', mg, [0.6, 1.0, 0], 'vs-label--sm');
    k.pickable(mg, 'Asenkron motor 5,5 kW (F3 → K1)', a => { const r = a.validResult && a.validResult.values; return ['In ≈ ' + fmt(X.MOTOR.In, 1, 'A') + ' · Ist ≈ 7·In · 4 × 2,5 mm², 20 m', 'Durum: ' + (r ? { run: 'çalışıyor', reverse: 'çalışıyor (yönü gözlemleyin: ok)', locked: 'uğulduyor, dönmüyor', stop: 'duruyor' }[r.motor] : '')]; }, () => [thermalAct('tMot')]);
    // ısıtıcı
    const hg = k.group(null, 4.8, 1.8, -1.0);
    k.rbox(0.3, 0.8, 1.0, 0.04, M.plasticGrey, 0, 0, 0, hg);
    for (let i = 0; i < 7; i++) k.box(0.02, 0.6, 0.03, M.darkSteel, -0.16, 0, -0.42 + i * 0.14, hg);
    sc3.heatGlow = k.box(0.02, 0.5, 0.8, k.mat(0x7c2d12, { emissive: 0xf97316, emissiveIntensity: 0 }), -0.17, 0, 0, hg); sc3.heatGlow.userData.noMerge = true;
    k.box(0.12, 0.4, 0.8, M.plasticDark, 0.08, -0.75, 0.0, hg); // klemens kutusu
    k.pickable(hg, 'Isıtıcı 3 × 3 kW (F4, yıldız + N)', a => ['C20, 5 × 2,5 mm², 15 m · eleman başına 17,6 Ω', 'Termostat: ' + (scOf(a.state).p.heat ? 'ısıtıyor' : 'kapalı (oda sıcak)')], () => [thermalAct('tHbox')]);
  }
  function buildEarth(k, sc3) {
    const M = k.mats;
    const g = k.group(null, -4.2, 0, 1.6);
    k.cyl(0.25, 0.25, 0.06, M.concreteDark, 0, 0.03, 0, g, 20);
    k.cyl(0.015, 0.015, 0.5, M.copper, 0, -0.1, 0, g, 8);
    k.tube([[-4.2, 0.1, 1.6], [-4.2, 0.05, -1.5], [-3.6, 0.05, -2.7], [PB[0] + 0.5, 0.42, -2.55]], 0.012, M.PE, null);
    const pr = k.group(null, -4.4, 0, 3.2);
    k.cyl(0.01, 0.01, 0.45, M.steel, 0, 0.2, 0, pr, 6);
    k.label('Uzak toprak sondası', pr, [0, 0.7, 0], 'vs-label--sm');
    k.label('Toprak elektrodu', g, [0, 0.5, 0], 'vs-label--sm');
  }
  function buildCart(k, sc3, app) {
    const M = k.mats;
    const g = k.group(null, -0.6, 0, 1.4);
    k.box(0.9, 0.05, 0.5, M.steel, 0, 0.8, 0, g);
    [-0.4, 0.4].forEach(x => [-0.2, 0.2].forEach(z => k.cyl(0.015, 0.015, 0.8, M.steel, x, 0.4, z, g, 8)));
    k.rbox(0.36, 0.2, 0.08, 0.02, M.plasticYellow, 0, 0.93, 0, g);
    const scr = k.screen(0.6, 0.32, 384, (gx, w, h) => drawMeter(gx, w, h, app), g, { emissive: 0.9 });
    scr.position.set(0, 1.22, 0.05); scr.rotation.x = -0.25; sc3.screen = scr;
    sc3.cartTop = [-0.6, 0.98, 1.4];
    k.pickable(scr, 'Ölçü aleti', a => ['Seçili: ' + (INST[a.state.inst] || INST.volt).name, 'Son ölçüm: ' + ((a.validResult && a.validResult.values.last) ? a.validResult.values.last.text : '—')], a => Object.keys(INST).filter(i => i !== a.state.inst).slice(0, 4).map(i => ({ label: INST[i].name, onClick: x => { x.state.inst = i; x.renderControls(true); x.invalidate(); } })));
  }
  function drawMeter(gx, w, h, app) {
    gx.fillStyle = '#0b1220'; gx.fillRect(0, 0, w, h);
    const r = app.validResult && app.validResult.values;
    gx.fillStyle = '#facc15'; gx.font = 'bold 20px monospace'; gx.fillText(((INST[app.state.inst] || INST.volt).name).toLocaleUpperCase('tr-TR').slice(0, 30), 12, 30);
    const last = r && r.last;
    gx.fillStyle = last && last.violation ? '#f87171' : '#e2e8f0'; gx.font = 'bold 30px monospace';
    const t = last ? last.text : '---';
    gx.fillText(t.length > 22 ? t.slice(0, 22) + '…' : t, 12, 90);
    gx.font = '18px monospace'; gx.fillStyle = '#94a3b8'; gx.fillText(last ? '#' + last.n + ' ' + pointLabel(last).slice(0, 30) : 'ölçüm yok', 12, 150);
  }
  /* durum → sahne */
  function apply3d(k, app, force) {
    const sc3 = app.scene3, r = app.validResult && app.validResult.values; if (!sc3 || !r) return false;
    const s = app.state, sig = [r.key, JSON.stringify(r.sw), JSON.stringify(r.locks), r.n, s.pa, s.pb, s.inst, r.motor].join('|');
    if (!force && sig === sc3.sig) return false;
    sc3.sig = sig;
    const M = k.mats, sw = r.sw;
    Object.keys(sc3.devs).forEach(key => { const d = sc3.devs[key], on = sw[key]; d.h.position.y = on ? 0.06 : 0; d.flag.material = on ? M.plasticRed : M.plasticGreen; });
    sc3.k1led.material = r.pulled ? M.ledGreen : M.ledOff;
    sc3.olFlag.material = sw.ol ? M.plasticGreen : M.plasticRed;
    sc3.plugCable.visible = !!sw.plug;
    const ac = X.solveAC(r.sc, sw), uL = E.C.abs(E.C.sub(ac.sol.V('LmpL'), ac.sol.V('LmpN')));
    sc3.lampTube.material.emissiveIntensity = Math.min(3, 1.6 * Math.pow(uL / 230, 2));
    sc3.heatGlow.material.emissiveIntensity = r.sc.p.heat && sw.f4 ? 1.2 : 0;
    sc3.motorArrow.set(r.motor === 'run' ? '↻ çalışıyor' : r.motor === 'reverse' ? '↺ çalışıyor' : r.motor === 'locked' ? '⚠ uğulduyor' : 'duruyor');
    sc3.motorArrow.level(r.motor === 'locked' ? 'bad' : r.motor === 'stop' ? '' : 'ok');
    const inst = INST[s.inst] || INST.volt;
    const place = (m, line, id) => {
      const p = inst.two && POS[id] ? POS[id] : null;
      m.visible = !!p; line.visible = !!p;
      if (!p) return;
      m.position.set(p[0], p[1], p[2] + 0.04);
      const a = line.geometry.attributes.position; const c = sc3.cartTop;
      a.setXYZ(0, c[0], c[1], c[2]); a.setXYZ(1, (c[0] + p[0]) / 2, Math.min(c[1], p[1]) - 0.3, (c[2] + p[2]) / 2); a.setXYZ(2, p[0], p[1], p[2] + 0.04); a.needsUpdate = true; line.geometry.computeBoundingSphere();
    };
    place(sc3.probeA, sc3.leadA, s.pa); place(sc3.probeB, sc3.leadB, s.pb);
    Object.keys(sc3.pts).forEach(id => sc3.pts[id].scale.setScalar(id === s.pa || id === s.pb ? 1.5 : 1));
    sc3.screen.redraw(sig);
    k.invalidate(true);
    return true;
  }
  function update(k, res, s, live, app) { if (app.scene3) app.scene3.sig = ''; apply3d(k, app); }
  function animate(k, dt, res, s, L, app) {
    const sc3 = app.scene3; if (!sc3) return false;
    let moving = apply3d(k, app);
    const m = res.values.motor;
    if ((m === 'run' || m === 'reverse') && !k.reducedMotion && dt > 0) { sc3.shaft.rotation.x += (m === 'run' ? 1 : -1) * dt * 8; moving = true; }
    if (m === 'locked' && !k.reducedMotion && dt > 0) { sc3.shaft.rotation.x = Math.sin(performance.now() / 20) * 0.02; moving = true; }
    return moving;
  }

  /* ---------------------------------------------------------------- 2D bağlantı şeması */
  const COLS = [
    { t: 'Şebeke / ADP', ids: ['M1', 'M2', 'M3', 'MN', 'B1', 'B2', 'B3', 'BN', 'PE', 'EL', 'RE'], dev: 'q0' },
    { t: 'F1 Aydınlatma', ids: ['F1o', 'LmpL', 'LmpN', 'LmpPE'], dev: 'f1' },
    { t: 'F2 Priz', ids: ['R2L', 'R2N', 'F2o', 'SoL', 'SoN', 'SoPE', 'ApL', 'ApN', 'ApPE'], dev: 'f2' },
    { t: 'F3 Motor', ids: ['F3o1', 'F3o2', 'F3o3', 'A1', 'A2', 'K1o1', 'K1o2', 'K1o3', 'MU', 'MV', 'MW', 'MPEc'], dev: 'f3' },
    { t: 'F4 Isıtıcı', ids: ['F4o1', 'F4o2', 'F4o3', 'H1t', 'H2t', 'H3t', 'H1', 'H2', 'H3', 'HN', 'HPE'], dev: 'f4' }
  ];
  function layout2d(W) { const narrow = W < 640; return { narrow: narrow, cols: narrow ? 2 : 5, top: narrow ? 118 : 56, x0: 12, w: narrow ? W - 24 : W - 96 }; }
  function view2dHeight(W) { const l = layout2d(W), rows = l.narrow ? 3 : 1, tall = l.narrow ? 12 : 12; return l.top + 70 + rows * (tall * 24 + 50) + 20; }
  function view2d(g, W, H, res, s) {
    const l = layout2d(W), v = res.values, sw = v.sw;
    const col = { text: '#e6eef8', dim: '#8ea3bf', on: '#22c55e', off: '#ef4444', a: '#ef4444', b: '#cbd5e1' };
    g.textBaseline = 'middle';
    g.font = 'bold 13px Inter, sans-serif'; g.fillStyle = col.text; g.textAlign = 'left';
    g.fillText(VS.fitText(g, 'Ölçü aleti: ' + (INST[s.inst] || INST.volt).name, l.w), l.x0, l.top);
    g.font = '12px Inter, sans-serif'; g.fillStyle = v.last && v.last.violation ? col.off : '#facc15';
    g.fillText(VS.fitText(g, v.last ? 'Son: ' + v.last.text + ' · ' + pointLabel(v.last) : 'Henüz ölçüm yok · bir noktayı A/B prob olarak seçin', l.w), l.x0, l.top + 20);
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif';
    g.fillText(VS.fitText(g, 'Kırmızı çerçeve: prob A · beyaz: prob B · kesici kutusu yeşil: kapalı, kırmızı: açık · 🔒 kilitli', l.w), l.x0, l.top + 40);
    const cw = l.w / l.cols;
    COLS.forEach((c, ci) => {
      const cx = l.x0 + (ci % l.cols) * cw, row = Math.floor(ci / l.cols), cy = l.top + 64 + row * (12 * 24 + 50);
      const on = c.dev === 'f2' ? sw.rcd && sw.f2 : sw[c.dev], lk = v.locks[c.dev === 'q0' ? 'q0' : c.dev];
      g.fillStyle = on ? '#14532d' : '#4c0519'; g.fillRect(cx + 4, cy, cw - 8, 26);
      g.strokeStyle = on ? col.on : col.off; g.lineWidth = 2; g.strokeRect(cx + 4, cy, cw - 8, 26);
      g.fillStyle = col.text; g.font = 'bold 12px Inter, sans-serif'; g.fillText(VS.fitText(g, c.t + ' · ' + (on ? 'kapalı' : 'AÇIK') + (lk ? ' 🔒' : ''), cw - 18), cx + 10, cy + 13);
      c.ids.forEach((id, i) => {
        const p = X.PT[id], y = cy + 34 + i * 24, sel = id === s.pa ? 'a' : id === s.pb ? 'b' : '';
        g.fillStyle = '#10223d'; g.fillRect(cx + 8, y, cw - 16, 20);
        if (sel) { g.strokeStyle = sel === 'a' ? col.a : col.b; g.lineWidth = 2; g.strokeRect(cx + 8, y, cw - 16, 20); }
        g.fillStyle = sel ? col.text : col.dim; g.font = '11px Inter, sans-serif'; g.fillText(VS.fitText(g, (sel ? (sel === 'a' ? 'A · ' : 'B · ') : '') + p.name, cw - 26), cx + 14, y + 10);
      });
    });
  }

  /* ---------------------------------------------------------------- kayıt */
  const S = o => Object.assign(defaults(), o);
  const done = r => r.values.done;
  VS.register({
    id: 'ariza', title: '3D Elektrik Arıza Tespit Laboratuvarı',
    defaults: defaults, initLive: initLive, autoRun: true,
    startText: 'Laboratuvar çalışıyor: termik ve aşırı yük açmaları zamanla değerlendirilir.',
    start: app => { app.live.acc = {}; },
    scenarios: [
      { id: 'rcd', name: 'Priz devresinde RCD sürekli açıyor (başlangıç)', desc: 'Başlangıç modu, tohum 11: belirtiyi okuyun, devreyi güvenle ayırıp yalıtım ölçerle arayın.', state: S({ mode: 'beginner', seed: 11, fault: 'insul' }) },
      { id: 'motor', name: 'Motor çalışmıyor, kontaktör çekmiyor', desc: 'Start verip bobin gerilimini ölçün; sonra ayırıp bobin direncine bakın.', state: S({ mode: 'beginner', seed: 21, fault: 'coil' }) },
      { id: 'ters', name: 'Bakım sonrası ters dönen konveyör', desc: 'Faz sırası test cihazıyla yönün değiştiği noktayı bulun.', state: S({ mode: 'beginner', seed: 31, fault: 'phaseSeq', inst: 'rot' }) },
      { id: 'koku', name: 'Isıtıcıdan yanık kokusu (orta)', desc: 'Termal kamera ve gerilim düşümüyle sıcak noktayı bulun.', state: S({ mode: 'intermediate', seed: 41, fault: 'looseConn', inst: 'thermal' }) },
      { id: 'rast-orta', name: 'Rastgele arıza · orta seviye', desc: 'Tohum 77, orta mod: arıza tipi gizli.', state: S({ mode: 'intermediate', seed: 77 }) },
      { id: 'rast-ileri', name: 'Rastgele arıza · ileri seviye', desc: 'Tohum 123, ileri mod: TN-C-S ya da TT, ipucu yok, güvenlik ihlali daha ağır cezalı.', state: S({ mode: 'advanced', seed: 123 }) }
    ],
    tasks: [
      { id: 'first', title: 'İlk arızanı doğru teşhis et', goal: 'Priz devresinde RCD sürekli açıyor. Ölçümlerle nedenini ve yerini bulup teşhisi gönderin.', hint: 'Önce F2’yi ayırıp kilitleyin ve prizde gerilim yokluğunu doğrulayın; yalıtım ölçerle L–PE’yi ölçün, sonra cihaz fişini çekip tekrar ölçün.',
        state: S({ mode: 'beginner', seed: 11, fault: 'insul' }), check: r => !!done(r) && done(r).typeOk },
      { id: 'safe', title: 'Beş kuralla güvenli ölç', goal: 'Kontaktörü çekmeyen motorun arızasını, hiçbir güvenlik ihlali ve eksik kural olmadan, en az bir DC ölçümle teşhis edin.', hint: 'Start verip A1–A2 gerilimini ölçün; sonra F3’ü açın, kilitleyin, A1–A2 gerilim yokluğunu doğrulayın ve direnci ölçün.',
        state: S({ mode: 'beginner', seed: 21, fault: 'coil' }), check: r => !!done(r) && done(r).typeOk && r.values.violations === 0 && r.values.missing === 0 && r.values.dcTests >= 1 },
      { id: 'rot', title: 'Ters dönen motoru 3 ölçümde çöz', goal: 'Ters dönen motorda arıza tipini ve yerini en çok 3 ölçümle doğru bulun.', hint: 'Faz sırası test cihazını F3 çıkışında ve motor klemensinde kullanın.',
        state: S({ mode: 'beginner', seed: 31, fault: 'phaseSeq' }), check: r => !!done(r) && done(r).typeOk && done(r).locOk && done(r).n <= 3 },
      { id: 'openN', title: 'Kopuk nötrü teşhis et', goal: 'Tek fazlı cihazlar ve motor kumandası anormal. İleri modda arızayı doğru teşhis edin.', hint: 'L–N gerilimlerini farklı fazlarda karşılaştırın ve N barası ile uzak toprak arasındaki gerilimi ölçün; toprak iletkeninde pensle akım arayın.',
        state: S({ mode: 'advanced', seed: 51, fault: 'openN' }), check: r => !!done(r) && done(r).typeOk },
      { id: 'tt', title: 'TT gövde hatasında 80 puan al', goal: 'Gövdeye dokunanın çarpıldığı TT tesiste arızayı güvenli biçimde bulun ve en az 80 puan alın.', hint: 'Gövde ile uzak toprak sondası arasında gerilim ölçün; PE barası ile toprak elektrodu arasındaki sürekliliği ölçmeden önce Q0’ı açıp kilitleyin ve doğrulayın.',
        state: S({ mode: 'advanced', seed: 61, fault: 'ttEarth' }), check: r => !!done(r) && done(r).total >= 80 }
    ],
    controls: controls, compute: compute, readouts: readouts, charts: charts, tick: tick,
    badge: res => { const v = res.values; return v.done ? { level: v.done.typeOk ? 'ok' : 'bad', text: 'Puan ' + v.done.total + ' / 100' } : v.violations ? { level: 'bad', text: 'Güvenlik ihlali' } : { level: 'info', text: 'Arıza aranıyor · ' + v.n + ' ölçüm' }; },
    reportInputs: (s, app) => { const v = app.validResult.values; return [{ group: 'Oturum', label: 'Belirti', value: v.symptom }].concat(v.log.map(e => ({ group: 'Ölçüm günlüğü', label: '#' + e.n + ' ' + INST[e.inst].name, value: pointLabel(e) + ' → ' + e.text + (e.violation ? ' (İHLAL)' : '') }))); },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-5, 5.2] },
    view2d: view2d, view2dHeight: view2dHeight
  });
})();
