/* VoltSim · ariza ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.ariza, Node'da require() ile kullanılır; testleri tools/tests/voltsim-ariza.test.cjs.
 * İçerik: küçük bir AG tesisinin (TN-C-S ya da TT; aydınlatma, priz, motor, ısıtıcı devreleri) karmaşık düğüm gerilimi
 * çözücüsü (fazörler, Norton kaynakları), tohumlu (tekrarlanabilir) arıza senaryoları, sanal ölçü aletleri (multimetre,
 * pens ampermetre, 500 V DC yalıtım ölçer, döngü empedansı, faz sırası, toprak direnci, termal kamera), koruma cihazı
 * tepkileri (RCD, MCB, termik röle, kontaktör çekme gerilimi), enerjisiz çalışma kuralı takibi ve teşhis puanlaması.
 * Bütün ölçüm sonuçları aynı devre modelinden hesaplanır; sabit “cevap” değeri yoktur. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.ariza = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const C = E.C, DEG = Math.PI / 180, U0 = 230, KAPPA = 56, XC = 0.08e-3;
  const LEAK = 1e-9; // her düğümden uzak toprağa 1 GΩ (sağlam yalıtım, sayısal kararlılık)

  /* ---------------------------------------------------------------- karmaşık düğüm çözücü */
  function Net() { this.idx = Object.create(null); this.names = []; this.br = []; this.inj = []; }
  Net.prototype.node = function (name) {
    if (name === 'RE') return -1; // uzak toprak (referans, 0 V)
    if (!(name in this.idx)) { this.idx[name] = this.names.length; this.names.push(name); }
    return this.idx[name];
  };
  /** İki düğüm arasında empedans z = {re, im} (Ω). tag: akımı okunacak dal adı (a → b yönü pozitif). */
  Net.prototype.add = function (a, b, z, tag) { this.br.push({ a: this.node(a), b: this.node(b), y: C.div(C.of(1), z), tag: tag || null }); };
  /** Gerilim kaynağı E (b'ye göre a), iç empedans z: Norton eşdeğeri. */
  Net.prototype.src = function (a, b, Ev, z) { const ia = this.node(a), ib = this.node(b); this.add(a, b, z); this.inj.push({ n: ia, I: C.div(Ev, z) }, { n: ib, I: C.scale(C.div(Ev, z), -1) }); };
  /** Düğüm gerilimleri: Y·V = J (kısmi pivotlu Gauss eleme). extra: [{n, I}] ek akım enjeksiyonu (ölçüm için). */
  Net.prototype.solve = function (extra) {
    const n = this.names.length, Ar = new Float64Array(n * n), Ai = new Float64Array(n * n), br = new Float64Array(n), bi = new Float64Array(n);
    for (let i = 0; i < n; i++) Ar[i * n + i] = LEAK;
    this.br.forEach(b => {
      const yr = b.y.re, yi = b.y.im;
      if (b.a >= 0) { Ar[b.a * n + b.a] += yr; Ai[b.a * n + b.a] += yi; }
      if (b.b >= 0) { Ar[b.b * n + b.b] += yr; Ai[b.b * n + b.b] += yi; }
      if (b.a >= 0 && b.b >= 0) { Ar[b.a * n + b.b] -= yr; Ai[b.a * n + b.b] -= yi; Ar[b.b * n + b.a] -= yr; Ai[b.b * n + b.a] -= yi; }
    });
    this.inj.concat(extra || []).forEach(j => { if (j.n >= 0) { br[j.n] += j.I.re; bi[j.n] += j.I.im; } });
    for (let k = 0; k < n; k++) {
      let p = k, pm = -1;
      for (let i = k; i < n; i++) { const m = Ar[i * n + k] * Ar[i * n + k] + Ai[i * n + k] * Ai[i * n + k]; if (m > pm) { pm = m; p = i; } }
      if (p !== k) {
        for (let j = 0; j < n; j++) { let t = Ar[k * n + j]; Ar[k * n + j] = Ar[p * n + j]; Ar[p * n + j] = t; t = Ai[k * n + j]; Ai[k * n + j] = Ai[p * n + j]; Ai[p * n + j] = t; }
        let t = br[k]; br[k] = br[p]; br[p] = t; t = bi[k]; bi[k] = bi[p]; bi[p] = t;
      }
      const dr = Ar[k * n + k], di = Ai[k * n + k], dd = dr * dr + di * di;
      for (let i = k + 1; i < n; i++) {
        const xr = Ar[i * n + k], xi = Ai[i * n + k]; if (xr === 0 && xi === 0) continue;
        const fr = (xr * dr + xi * di) / dd, fi = (xi * dr - xr * di) / dd;
        for (let j = k; j < n; j++) { const ar = Ar[k * n + j], ai = Ai[k * n + j]; Ar[i * n + j] -= fr * ar - fi * ai; Ai[i * n + j] -= fr * ai + fi * ar; }
        br[i] -= fr * br[k] - fi * bi[k]; bi[i] -= fr * bi[k] + fi * br[k];
      }
    }
    const Vr = new Float64Array(n), Vi = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sr = br[i], si = bi[i];
      for (let j = i + 1; j < n; j++) { const ar = Ar[i * n + j], ai = Ai[i * n + j]; sr -= ar * Vr[j] - ai * Vi[j]; si -= ar * Vi[j] + ai * Vr[j]; }
      const dr = Ar[i * n + i], di = Ai[i * n + i], dd = dr * dr + di * di;
      Vr[i] = (sr * dr + si * di) / dd; Vi[i] = (si * dr - sr * di) / dd;
    }
    const self = this;
    const V = name => { const i = name === 'RE' ? -1 : self.idx[name]; return i === undefined ? null : i < 0 ? C.of(0) : C.of(Vr[i], Vi[i]); };
    const I = tag => { let s = C.of(0), found = false; self.br.forEach(b => { if (b.tag !== tag) return; found = true; const va = b.a < 0 ? C.of(0) : C.of(Vr[b.a], Vi[b.a]), vb = b.b < 0 ? C.of(0) : C.of(Vr[b.b], Vi[b.b]); s = C.add(s, C.mul(C.sub(va, vb), b.y)); }); return found ? s : C.of(0); };
    return { V: V, I: I, has: name => name === 'RE' || name in self.idx };
  };

  /* ---------------------------------------------------------------- tohumlu rastgele sayı (mulberry32) */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ---------------------------------------------------------------- tesis ve arızalar */
  const MOTOR = { P: 5500, eta: 0.87, cos: 0.83, IstIn: 7, cosLR: 0.4, Rdc: 1.3 };
  MOTOR.In = MOTOR.P / (Math.sqrt(3) * 400 * MOTOR.eta * MOTOR.cos);
  const COIL = { Rdc: 600, Zac: { re: 1763, im: 5607 }, pick: 0.85 }; // 230 V AC bobin: tutma ≈ 9 VA; DC direnci tipik (üreticiye bağlı)
  const LOCS = { main: 'Ana besleme / ADP', F1: 'F1 aydınlatma devresi', F2: 'F2 priz devresi', F3: 'F3 motor devresi', F4: 'F4 ısıtıcı devresi', earth: 'Koruma topraklaması' };
  const FAULTS = {
    insul: { name: 'Yalıtım hatası (faz–gövde kaçağı) ve RCD açması', loc: 'F2', optimal: 3,
      symptom: ['Priz devresindeki 30 mA kaçak akım rölesi (RCD) kurulunca hemen açıyor.', 'Priz devresi RCD’si sürekli açıyor.'],
      hint: 'RCD’yi açık bırakıp devreyi kilitleyin, gerilim yokluğunu doğrulayın; 500 V DC yalıtım ölçeriyle önce prizde, sonra fişi çekilmiş cihazda L–PE ölçün.',
      path: ['RCD’yi kurmayı deneyin: hemen açıyorsa kaçak akım vardır (aşırı akım değil).', 'F2 devresini ayırın (RCD/MCB açık), kilitleyin ve prizde L–N, L–PE, N–PE gerilim yokluğunu doğrulayın.', 'Yalıtım ölçerle (500 V DC) prizde L–PE ölçün; düşük değer devrede ya da takılı cihazda kaçak olduğunu gösterir.', 'Cihazın fişini çekip prizde tekrar ölçün (yüksek → kablo sağlam) ve cihazın fiş uçlarında L–PE ölçün (düşük → cihaz arızalı).'],
      explain: 'Cihazın içinde faz iletkeni ile metal gövde (PE) arasında yalıtım bozulmuş; kaçak akım U/Rf ≈ 30 mA’nın üstünde olduğundan RCD doğru şekilde açıyor. Arızalı cihaz servis dışı bırakılmalıdır.' },
    overload: { name: 'Aşırı yük (devre kapasitesi aşıldı)', loc: 'F2', optimal: 2,
      symptom: ['Priz devresinin B16 sigortası çalışırken birkaç dakika sonra açıyor; RCD açmıyor. Prize çoklu priz ile ikinci bir ısıtıcı takılmış.', 'Priz sigortası çalışma sırasında aralıklı açıyor.'],
      hint: 'Sigortayı kurun ve pens ampermetreyle F2 faz akımını ölçün; sigorta anma akımıyla (16 A) karşılaştırın. Kablo sıcaklığına termal kamerayla bakın.',
      path: ['Sigortayı kurup devreyi çalıştırın; pens ampermetreyle F2 faz akımını ölçün (> 16 A).', 'Termal kamerayla F2 kablosunun ısındığını görün; yalıtım ve RCD normal (açan RCD değil MCB).', 'Yükleri devrelere dağıtın ya da ayrı devre çekin; sigortayı büyütmek çözüm değildir (kablo korunmaz).'],
      explain: 'Toplam yük akımı 1,13–1,45·In bölgesinde: MCB termik eğrisine göre dakikalar içinde açar. Kablo ve sigorta doğru çalışıyor; sorun yük dağılımı.' },
    coil: { name: 'Kontaktör bobini arızalı (kopuk bobin)', loc: 'F3', optimal: 3,
      symptom: ['Motor start butonuna basılınca çalışmıyor; kontaktör çekmiyor, ses yok. Sigortalar ve termik normal görünüyor.', 'Motor çalışmıyor, kontaktör çekmiyor.'],
      hint: 'Start’a basılıyken bobin uçlarında (A1–A2) gerilim ölçün. Gerilim varsa devreyi ayırıp bobinin direncini ölçün.',
      path: ['Start komutunu verin ve bobin uçlarında A1–A2 gerilimini ölçün: ≈ 230 V var (kumanda devresi sağlam).', 'F3’ü ayırıp kilitleyin, gerilim yokluğunu doğrulayın.', 'Multimetre ile A1–A2 direnci: OL (açık devre) → bobin kopuk. Sağlam bobin yüzlerce Ω gösterir.'],
      explain: 'Bobinde gerilim olduğu hâlde kontaktör çekmiyorsa arıza bobinin kendisindedir; kopuk sargı sonsuz direnç gösterir. Kontaktör ya da bobin değiştirilmelidir.' },
    phaseSeq: { name: 'Yanlış faz sırası (motor ters dönüyor)', loc: 'F3', optimal: 2,
      symptom: ['Bakım sonrası konveyör motoru ters yönde dönüyor; akım ve sıcaklık normal.', 'Bakımdan sonra motor ters dönüyor.'],
      hint: 'Faz sırası test cihazını önce ADP barasına, sonra motor klemensine bağlayın; yönün değiştiği yeri bulun.',
      path: ['Faz sırası ölçerle ADP barasında ölçün: saat yönü (L1–L2–L3).', 'F3 çıkışında ve motor klemensinde ölçün: ters yön → iki faz F3 çıkışı ile kontaktör arasında yer değiştirmiş.', 'Devreyi ayırıp kilitleyin, iki fazın yerini değiştirin; dönüş yönünü yeniden doğrulayın.'],
      explain: 'Üç fazlı asenkron motorun dönüş yönü faz sırasına bağlıdır; iki fazın yer değiştirmesi dönen alanı ters çevirir. Akım ve gerilimler normal olduğundan yalnız faz sırası ölçümü yeri gösterir.' },
    phaseLoss: { name: 'Faz kaybı (motor sigortası atmış, tek fazda kalma)', loc: 'F3', optimal: 3,
      symptom: ['Motor start’ta uğulduyor ama dönmüyor; birkaç saniye sonra termik atıyor.', 'Motor dönmüyor, termik atıyor.'],
      hint: 'Termiği resetleyip start verin ve pensle üç faz akımına bakın. Sonra devreyi ayırıp sigortaların sürekliliğini ölçün. Açık fazda “hayalet” gerilime dikkat.',
      path: ['Termiği resetleyip start verin: pensle L1, L2 akımı yüksek (kilitli rotor), bir fazda akım yok.', 'Sigorta çıkışında açık fazda N’ye göre ≈ 115 V görülebilir: motor sargısı üzerinden gelen geri besleme, sağlam faz sanılmamalı.', 'Sigorta girişi baraya bağlı olduğundan ana şalter Q0’ı açıp kilitleyin (sigorta ayırıcı kapalı kalsın), gerilim yokluğunu doğrulayın; sigortaların giriş–çıkış sürekliliğini ölçün: atmış sigorta OL.'],
      explain: 'Tek faz kalan duran motor dönen alan oluşturamaz; kalan iki fazdan ≈ (√3/2)·Ist akım çeker ve termik röle açar. Atmış sigortanın nedeni (kısa devre, gevşek bağlantı) ayrıca araştırılmalıdır.' },
    looseConn: { name: 'Gevşek bağlantı (klemens sıcak noktası)', loc: 'F4', optimal: 2,
      symptom: ['Isıtıcı klemens kutusundan yanık kokusu geliyor; sigorta açmıyor.', 'Isıtıcı tarafında yanık kokusu var.'],
      hint: 'Termal kamerayla ısıtıcı klemens kutusuna bakın; sonra çalışırken sıcak klemensin iki yanı arasındaki gerilim düşümünü ölçün.',
      path: ['Termal kamerayla ısıtıcı klemens kutusu: bir klemenste sıcak nokta.', 'Çalışırken o klemensin kablo tarafı ile ısıtıcı tarafı arasında gerilim düşümü ölçün (birkaç volt: anormal temas direnci).', 'Devreyi ayırıp kilitleyin; klemensi temizleyip doğru torkla sıkın, hasarlı yüksüğü değiştirin.'],
      explain: 'Gevşek temasta R_c büyür, P = I²·R_c ısısı küçük bir noktada toplanır. Akım normal olduğundan koruma açmaz; yalnız termal kamera ve gerilim düşümü ölçümü yakalar.' },
    npe: { name: 'Nötr–PE teması (RCD sonrası N ile PE birleşmiş)', loc: 'F2', optimal: 3,
      symptom: ['Priz devresi RCD’si cihaz çalıştırılınca açıyor; cihaz fişi çekiliyken açmıyor. Başka prizde cihaz sağlam çalışıyor.', 'Priz devresi RCD’si yük altında açıyor.'],
      hint: 'Kaçak yalnız yük akımıyla oluşuyor. Devreyi ayırıp nötr köprüsünü kaldırın ve yalıtım ölçerle N–PE ölçün.',
      path: ['Cihaz başka devrede sağlam: arıza devrede. Yüksüzken RCD açmıyor, yük altında açıyor → dönüş akımının bir kısmı PE’den dönüyor.', 'F2’yi ayırıp kilitleyin, gerilim yokluğunu doğrulayın, devrenin nötrünü N barasından ayırın.', 'Yalıtım ölçerle prizde N–PE: çok düşük (Ω mertebesi) → N ile PE birleşik; buatları kontrol edin.'],
      explain: 'RCD sonrasında N ile PE temas edince yük akımının bir kısmı PE iletkeninden döner; RCD bunu kaçak akım olarak görür. Yüksüzken akım olmadığından açmaz.' },
    openN: { name: 'Kopuk nötr (PEN iletkeni kopuk, gerilim kayması)', loc: 'main', optimal: 3,
      symptom: ['Lambalar loş yanıyor, prizdeki cihaz anormal çalışıyor; motor kontaktörü bırakıp duruyor. Hiçbir sigorta açmamış.', 'Tek fazlı cihazlar ve motor kumandası anormal davranıyor.'],
      hint: 'Prizde ve lambada L–N gerilimlerini ve faz arası gerilimi karşılaştırın; ADP’de N ile uzak toprak arasında gerilim var mı?',
      path: ['L–L gerilimleri normal (≈ 400 V) ama L–N gerilimleri dengesiz (biri ≈ 230 V’un çok altında, diğeri üstünde).', 'ADP N barası ile uzak toprak arasında belirgin gerilim → nötr noktası kaymış.', 'Topraklama iletkeninde pensle akım: dönüş akımı toprak üzerinden akıyor → şebeke tarafında PEN kopuk. Dağıtım şirketine bildirin; tek fazlı yükleri ayırın.'],
      explain: 'PEN kopunca tek fazlı yükler iki faz arasında seri kalır; nötr noktası yüklerin admitansına göre kayar (Millman). Az yüklü fazdaki cihazlar aşırı gerilim görür; yerel topraklama üzerinden akım akar ve gövdeler gerilim kazanabilir.' },
    ttEarth: { name: 'TT: koruma topraklaması kopuk ve gövde kaçağı', loc: 'earth', optimal: 3,
      symptom: ['Isıtıcıya dokunan personel çarpıldığını söylüyor; hiçbir koruma (RCD dahil) açmamış. Tesis TT sistemli.', 'Gövdeye dokununca çarpılma bildirildi; koruma açmadı.'],
      hint: 'Isıtıcı gövdesi ile uzak toprak sondası arasında gerilim ölçün. Döngü empedansı (L–PE) ve PE barası ile toprak elektrodu arasındaki sürekliliğe bakın.',
      path: ['Gövde – uzak toprak sondası arası gerilim ≈ faz gerilimi: gövde gerilimli (tehlike!). Alanı kapatın.', 'Döngü empedansı ölçer L–PE’de ölçemez (devre yok) ve PE–N arasında anormal gerilim görür.', 'Q0’ı açıp kilitleyin, gerilim yokluğunu doğrulayın; PE barası ile toprak elektrodu arasında süreklilik: sağlamda ≈ 0,01 Ω, burada OL ya da yalnız arızalı cihaz ve şebeke üzerinden yüzlerce Ω → topraklama iletkeni kopuk. Elektrodun kendisi (3 kazık) normal olabilir.'],
      explain: 'TT sistemde gövde kaçağı ancak toprak üzerinden dönebilirse RCD’yi açtırır. Topraklama iletkeni kopunca devre kapanmaz, akım akmaz ve RCD açmaz; bütün PE’ye bağlı gövdeler faz gerilimine çıkar.' }
  };
  const POOLS = { beginner: ['insul', 'overload', 'coil', 'phaseSeq'], intermediate: ['insul', 'overload', 'coil', 'phaseSeq', 'phaseLoss', 'looseConn', 'npe'], advanced: Object.keys(FAULTS) };
  const MODES = { beginner: 'Başlangıç', intermediate: 'Orta', advanced: 'İleri' };
  const APPLIANCES = ['taşlama makinesi', 'kompresör', 'fan ısıtıcı', 'su ısıtıcı', 'matkap tezgâhı'];

  /** Tohum + mod (+ zorunlu arıza tipi) → senaryo parametreleri. Aynı girdi her zaman aynı senaryoyu üretir. */
  function scenario(seed, mode, forced) {
    mode = POOLS[mode] ? mode : 'beginner';
    const r = rng((Math.round(seed) * 7919 + Object.keys(POOLS).indexOf(mode) * 104729 + 17) >>> 0);
    const pool = POOLS[mode];
    const type = FAULTS[forced] ? forced : pool[Math.floor(r() * pool.length)];
    const pick = (a, b, step) => a + Math.round(r() * (b - a) / step) * step;
    const p = {
      lampW: pick(800, 1500, 50), appW: pick(600, 1800, 50), appName: APPLIANCES[Math.floor(r() * APPLIANCES.length)],
      RA: type === 'openN' ? pick(25, 60, 1) : pick(6, 20, 1), RB: 2, heat: type !== 'openN',
      Rf: pick(2500, 7000, 100), Rc: pick(0.06, 0.12, 0.01), extraW: pick(2600, 3000, 100), Rnp: pick(0.03, 0.3, 0.01),
      phase: 1 + Math.floor(r() * 3), lossPhase: 2 + Math.floor(r() * 2), swap: [[1, 2], [2, 3], [1, 3]][Math.floor(r() * 3)], RfTT: pick(300, 2000, 50), RAtt: pick(25, 60, 1)
    };
    if (type === 'openN') p.appW = pick(300, 700, 50);
    if (type === 'overload') p.appW = pick(1800, 2000, 50);
    return { seed: Math.round(seed), mode: mode, type: type, fault: FAULTS[type], system: type === 'ttEarth' ? 'TT' : 'TN-C-S', p: p };
  }
  function initialSwitches(sc) {
    const sw = { q0: true, f1: true, rcd: true, f2: true, f3: true, k1: true, ol: true, f4: true, plug: true, n1: true, n2: true, n4: true, earthLink: true };
    if (sc.type === 'overload') sw.f2 = false;                  // belirti: MCB çalışma sırasında açmış
    if (sc.type === 'phaseLoss') { sw.k1 = false; sw.ol = false; } // belirti: termik atmış, mühür düşmüş
    if (sc.type === 'coil') sw.k1 = false;                      // belirti: start verilince çekmiyor
    return settle(sc, sw).sw;
  }

  /* ---------------------------------------------------------------- devre modeli */
  const zc = { re: 2e-4, im: 0 };                                   // kapalı kontak / bara bağlantısı
  const zCab = (L, S, ac) => ({ re: L / (KAPPA * S), im: ac ? XC * L : 0 });
  const zRes = P => ({ re: U0 * U0 / P, im: 0 });
  function motorZ(state) {
    if (state === 'locked') { const m = U0 / (MOTOR.IstIn * MOTOR.In); return { re: m * MOTOR.cosLR, im: m * Math.sqrt(1 - MOTOR.cosLR * MOTOR.cosLR) }; }
    const m = U0 / MOTOR.In; return { re: m * MOTOR.cos, im: m * Math.sqrt(1 - MOTOR.cos * MOTOR.cos) };
  }
  /** Ağ kurulumu. kind: 'ac' (kaynaklı fazör) | 'dc' (kaynaksız direnç ağı; yalıtım/süreklilik ölçümleri için).
   * k1closed: kontaktör ana kontakları kapalı mı; motor: 'run' | 'locked'. */
  function network(sc, sw, kind, k1closed, motorState) {
    const N = new Net(), ac = kind === 'ac', p = sc.p, tt = sc.system === 'TT', f = sc.type;
    const z = (r, x) => ({ re: r, im: ac ? (x || 0) : 0 });
    const zT = z(0.0045, 0.0154), zSvc = z(0.02, 0.006);
    for (let i = 1; i <= 3; i++) { if (ac) N.src('T' + i, 'S', C.polar(U0, -(i - 1) * 120 * DEG), zT); else N.add('T' + i, 'S', zT); }
    N.add('S', 'RE', z(p.RB));
    for (let i = 1; i <= 3; i++) N.add('T' + i, 'M' + i, zSvc);
    if (f !== 'openN') N.add('S', 'MN', zSvc, 'svcN');                // PEN (TN-C-S) ya da N (TT) servis iletkeni
    if (!tt) N.add('MN', 'PE', zc, 'bond');                          // TN-C-S ayırma noktası: PEN → N + PE
    if (sw.earthLink && f !== 'ttEarth') N.add('PE', 'EL', z(0.01), 'earthC'); // topraklama iletkeni (ölçüm köprüsü)
    N.add('EL', 'RE', z(tt ? p.RAtt : p.RA));                        // toprak elektrodu
    if (sw.q0) { for (let i = 1; i <= 3; i++) N.add('M' + i, 'B' + i, zc, 'q0L' + i); N.add('MN', 'BN', zc, 'q0N'); }
    // F1 aydınlatma (L1, B10, 1,5 mm², 25 m)
    if (sw.f1) N.add('B1', 'F1o', zc);
    N.add('F1o', 'LmpL', zCab(25, 1.5, ac), 'c1L'); if (sw.n1) N.add('BN', 'F1n', zc); N.add('F1n', 'LmpN', zCab(25, 1.5, ac), 'c1N'); N.add('PE', 'LmpPE', zCab(25, 1.5, ac), 'c1PE');
    N.add('LmpL', 'LmpN', zRes(p.lampW));
    // F2 priz (L2, RCD 30 mA + B16, 2,5 mm², 30 m)
    if (sw.rcd) { N.add('B2', 'R2L', zc, 'rcdL'); N.add('BN', 'R2N', zc, 'rcdN'); }
    if (sw.f2) N.add('R2L', 'F2o', zc);
    N.add('F2o', 'SoL', zCab(30, 2.5, ac), 'c2L'); if (sw.n2) N.add('R2N', 'F2n', zc); N.add('F2n', 'SoN', zCab(30, 2.5, ac), 'c2N'); N.add('PE', 'SoPE', zCab(30, 2.5, ac), 'c2PE');
    if (sw.plug) { N.add('SoL', 'ApL', zc); N.add('SoN', 'ApN', zc); N.add('SoPE', 'ApPE', zc); }
    N.add('ApL', 'ApN', zRes(p.appW));
    if (f === 'overload') N.add('ApL', 'ApN', zRes(p.extraW));         // çoklu prizdeki ikinci ısıtıcı
    if (f === 'insul') N.add('ApL', 'ApPE', z(p.Rf));
    if (f === 'npe') N.add('SoN', 'SoPE', z(p.Rnp));
    // F3 motor (sigortalı yük ayırıcı 3 × 16 A gG → K1 → termik → 4 × 2,5 mm², 20 m)
    if (sw.f3) for (let i = 1; i <= 3; i++) if (!(f === 'phaseLoss' && i === p.lossPhase)) N.add('B' + i, 'F3o' + i, zc, 'f3L' + i);
    const perm = [1, 2, 3];
    if (f === 'phaseSeq') { perm[p.swap[0] - 1] = p.swap[1]; perm[p.swap[1] - 1] = p.swap[0]; }
    if (k1closed) for (let j = 1; j <= 3; j++) N.add('F3o' + perm[j - 1], 'K1o' + j, zc);
    for (let j = 1; j <= 3; j++) N.add('K1o' + j, 'M' + 'UVW'[j - 1], zCab(20, 2.5, ac), 'c3L' + j);
    N.add('PE', 'MPEc', zCab(20, 2.5, ac), 'c3PE');
    const zm = ac ? motorZ(motorState) : { re: MOTOR.Rdc, im: 0 };
    for (let j = 0; j < 3; j++) N.add('M' + 'UVW'[j], 'Mst', zm);
    if (sw.k1 && sw.ol) N.add('F3o1', 'A1', zc, 'ctl');              // kumanda: L1 → stop/start/termik 95-96 → A1
    N.add('A2', 'BN', zc);
    if (f !== 'coil') N.add('A1', 'A2', ac ? COIL.Zac : { re: COIL.Rdc, im: 0 }, 'coil');
    // F4 ısıtıcı (3 × 3 kW yıldız + N, C20, 5 × 2,5 mm², 15 m)
    if (sw.f4) for (let i = 1; i <= 3; i++) N.add('B' + i, 'F4o' + i, zc);
    for (let i = 1; i <= 3; i++) { N.add('F4o' + i, 'H' + i + 't', zCab(15, 2.5, ac), 'c4L' + i); N.add('H' + i + 't', 'H' + i, z(f === 'looseConn' && i === p.phase ? p.Rc : 5e-4)); }
    if (sw.n4) N.add('BN', 'F4n', zc); N.add('F4n', 'HN', zCab(15, 2.5, ac), 'c4N'); N.add('PE', 'HPE', zCab(15, 2.5, ac), 'c4PE');
    if (p.heat) for (let i = 1; i <= 3; i++) N.add('H' + i, 'HN', zRes(3000));
    if (f === 'ttEarth') N.add('H' + p.phase, 'HPE', z(p.RfTT));
    POINTS.forEach(x => N.node(x.node));                             // bağlantısız uçlar da düğüm olarak var (≈ 0 V, yüzer)
    return N;
  }
  /** AC çözüm: kontaktör bobin gerilimi ≥ %85·Us ise ana kontaklar kapanır; motor üç fazı alamıyorsa kilitli rotordur. */
  function solveAC(sc, sw) {
    let net = network(sc, sw, 'ac', false, 'run'), sol = net.solve();
    const vCoil = C.abs(C.sub(sol.V('A1'), sol.V('A2')));
    const pulled = sc.type !== 'coil' && sw.k1 && sw.ol && vCoil >= COIL.pick * U0;
    let motor = 'stop';
    if (pulled) {
      motor = sc.type === 'phaseLoss' ? 'locked' : sc.type === 'phaseSeq' ? 'reverse' : 'run';
      net = network(sc, sw, 'ac', true, motor === 'locked' ? 'locked' : 'run'); sol = net.solve();
    }
    return { sol: sol, net: net, vCoil: vCoil, pulled: pulled, motor: motor };
  }
  const mag = (sol, tag) => C.abs(sol.I(tag));
  /** Koruma tepkileri (anlık): RCD %70·IΔn’de, MCB manyetik eşiğin üstünde anında açar. Termik (MCB 1,13–1,45·In, termik röle)
   * tepkileri zamana bağlıdır ve thermalState() ile ayrıca değerlendirilir. Dönen sw açmaları uygulanmış durumdur. */
  function settle(sc, sw0) {
    let sw = Object.assign({}, sw0), ac = solveAC(sc, sw), trips = [];
    for (let k = 0; k < 4; k++) {
      const res = sw.rcd ? C.abs(C.add(ac.sol.I('rcdL'), ac.sol.I('rcdN'))) : 0;
      if (sw.rcd && res >= 0.7 * 0.03) { sw.rcd = false; trips.push({ dev: 'rcd', why: 'Kaçak akım ' + Math.round(res * 1000) + ' mA ≥ 21 mA (≈ %70·IΔn)' }); ac = solveAC(sc, sw); continue; }
      break;
    }
    return { sw: sw, ac: ac, trips: trips };
  }

  /* ---------------------------------------------------------------- ölçüm noktaları */
  const P = (id, name, node, circ) => ({ id: id, name: name, node: node, circ: circ });
  const POINTS = [
    P('M1', 'ADP giriş L1 (Q0 öncesi)', 'M1', 'supply'), P('M2', 'ADP giriş L2', 'M2', 'supply'), P('M3', 'ADP giriş L3', 'M3', 'supply'), P('MN', 'ADP giriş N/PEN', 'MN', 'supply'),
    P('B1', 'Bara L1', 'B1', 'bus'), P('B2', 'Bara L2', 'B2', 'bus'), P('B3', 'Bara L3', 'B3', 'bus'), P('BN', 'N barası', 'BN', 'bus'), P('PE', 'PE barası (ana topraklama)', 'PE', 'bus'),
    P('EL', 'Toprak elektrodu (bağlantı ucu)', 'EL', 'earth'), P('RE', 'Uzak toprak sondası', 'RE', 'earth'),
    P('F1o', 'F1 çıkış (L)', 'F1o', 'F1'), P('LmpL', 'Lamba L', 'LmpL', 'F1'), P('LmpN', 'Lamba N', 'LmpN', 'F1'), P('LmpPE', 'Lamba gövdesi (PE)', 'LmpPE', 'F1'),
    P('R2L', 'RCD çıkış L', 'R2L', 'F2'), P('R2N', 'RCD çıkış N', 'R2N', 'F2'), P('F2o', 'F2 MCB çıkış', 'F2o', 'F2'),
    P('SoL', 'Priz L', 'SoL', 'F2'), P('SoN', 'Priz N', 'SoN', 'F2'), P('SoPE', 'Priz PE', 'SoPE', 'F2'),
    P('ApL', 'Cihaz fişi L', 'ApL', 'app'), P('ApN', 'Cihaz fişi N', 'ApN', 'app'), P('ApPE', 'Cihaz fişi PE / gövde', 'ApPE', 'app'),
    P('F3o1', 'F3 sigorta çıkış L1', 'F3o1', 'F3'), P('F3o2', 'F3 sigorta çıkış L2', 'F3o2', 'F3'), P('F3o3', 'F3 sigorta çıkış L3', 'F3o3', 'F3'),
    P('K1o1', 'K1 çıkış 2/T1', 'K1o1', 'F3'), P('K1o2', 'K1 çıkış 4/T2', 'K1o2', 'F3'), P('K1o3', 'K1 çıkış 6/T3', 'K1o3', 'F3'),
    P('A1', 'K1 bobin A1', 'A1', 'F3'), P('A2', 'K1 bobin A2', 'A2', 'F3'),
    P('MU', 'Motor U', 'MU', 'F3'), P('MV', 'Motor V', 'MV', 'F3'), P('MW', 'Motor W', 'MW', 'F3'), P('MPEc', 'Motor gövdesi (PE)', 'MPEc', 'F3'),
    P('F4o1', 'F4 çıkış L1', 'F4o1', 'F4'), P('F4o2', 'F4 çıkış L2', 'F4o2', 'F4'), P('F4o3', 'F4 çıkış L3', 'F4o3', 'F4'),
    P('H1t', 'Isıtıcı klemens L1 (kablo)', 'H1t', 'F4'), P('H2t', 'Isıtıcı klemens L2 (kablo)', 'H2t', 'F4'), P('H3t', 'Isıtıcı klemens L3 (kablo)', 'H3t', 'F4'),
    P('H1', 'Isıtıcı L1 (eleman)', 'H1', 'F4'), P('H2', 'Isıtıcı L2 (eleman)', 'H2', 'F4'), P('H3', 'Isıtıcı L3 (eleman)', 'H3', 'F4'), P('HN', 'Isıtıcı N', 'HN', 'F4'), P('HPE', 'Isıtıcı gövdesi (PE)', 'HPE', 'F4')
  ];
  const PT = {}; POINTS.forEach(x => { PT[x.id] = x; });
  const CLAMPS = [
    { id: 'c1L', name: 'F1 faz iletkeni', tags: ['c1L'], circ: 'F1' }, { id: 'c2L', name: 'F2 faz iletkeni', tags: ['c2L'], circ: 'F2' }, { id: 'c2N', name: 'F2 nötr iletkeni', tags: ['c2N'], circ: 'F2' },
    { id: 'c2LN', name: 'F2 L + N birlikte (kaçak akım)', tags: ['c2L', 'c2N'], circ: 'F2', leak: true }, { id: 'c2PE', name: 'F2 PE iletkeni', tags: ['c2PE'], circ: 'F2' },
    { id: 'c3L1', name: 'Motor kablosu L1', tags: ['c3L1'], circ: 'F3' }, { id: 'c3L2', name: 'Motor kablosu L2', tags: ['c3L2'], circ: 'F3' }, { id: 'c3L3', name: 'Motor kablosu L3', tags: ['c3L3'], circ: 'F3' },
    { id: 'c4L1', name: 'Isıtıcı kablosu L1', tags: ['c4L1'], circ: 'F4' }, { id: 'c4L2', name: 'Isıtıcı kablosu L2', tags: ['c4L2'], circ: 'F4' }, { id: 'c4L3', name: 'Isıtıcı kablosu L3', tags: ['c4L3'], circ: 'F4' }, { id: 'c4N', name: 'Isıtıcı nötrü', tags: ['c4N'], circ: 'F4' },
    { id: 'q0N', name: 'ADP giriş nötrü', tags: ['q0N'], circ: 'bus' }, { id: 'earthC', name: 'Topraklama iletkeni (PE barası → elektrot)', tags: ['earthC'], circ: 'earth' }
  ];
  const ROTS = [
    { id: 'rM', name: 'ADP girişi (M1–M2–M3)', nodes: ['M1', 'M2', 'M3'], circ: 'supply' }, { id: 'rB', name: 'Bara (B1–B2–B3)', nodes: ['B1', 'B2', 'B3'], circ: 'bus' },
    { id: 'rF3', name: 'F3 sigorta çıkışı', nodes: ['F3o1', 'F3o2', 'F3o3'], circ: 'F3' }, { id: 'rK1', name: 'K1 çıkışı (2/T1–4/T2–6/T3)', nodes: ['K1o1', 'K1o2', 'K1o3'], circ: 'F3' },
    { id: 'rMot', name: 'Motor klemensi (U–V–W)', nodes: ['MU', 'MV', 'MW'], circ: 'F3' }, { id: 'rF4', name: 'F4 çıkışı', nodes: ['F4o1', 'F4o2', 'F4o3'], circ: 'F4' }
  ];
  const LOOPS = [
    { id: 'lB', name: 'Bara L1–PE', L: 'B1', R: 'PE', circ: 'bus' }, { id: 'lBN', name: 'Bara L1–N', L: 'B1', R: 'BN', circ: 'bus' },
    { id: 'lLmp', name: 'Lamba L–PE', L: 'LmpL', R: 'LmpPE', circ: 'F1' }, { id: 'lSo', name: 'Priz L–PE', L: 'SoL', R: 'SoPE', circ: 'F2' }, { id: 'lSoN', name: 'Priz L–N', L: 'SoL', R: 'SoN', circ: 'F2' },
    { id: 'lMot', name: 'Motor U–PE', L: 'MU', R: 'MPEc', circ: 'F3' }, { id: 'lH', name: 'Isıtıcı L1–PE', L: 'H1', R: 'HPE', circ: 'F4' }
  ];
  const THERMAL = [
    { id: 'tMdb', name: 'ADP baraları ve kesiciler' }, { id: 'tF2c', name: 'F2 priz kablosu' }, { id: 'tSo', name: 'Priz ve fiş' }, { id: 'tApp', name: 'Prizdeki cihaz' },
    { id: 'tK1', name: 'K1 kontaktör ve termik' }, { id: 'tMot', name: 'Motor gövdesi' }, { id: 'tHbox', name: 'Isıtıcı klemens kutusu' }, { id: 'tLmp', name: 'Lamba armatürü' }
  ];
  const INSTRUMENTS = {
    volt: { name: 'Multimetre · AC gerilim', two: true }, ohm: { name: 'Multimetre · süreklilik / Ω', two: true, dc: true }, insul: { name: 'Yalıtım ölçer · 500 V DC', two: true, dc: true },
    clamp: { name: 'Pens ampermetre' }, loop: { name: 'Döngü empedansı ölçer' }, rot: { name: 'Faz sırası test cihazı' }, earth: { name: 'Toprak direnci ölçer (3 kazık)' }, thermal: { name: 'Termal kamera' }
  };

  /* ---------------------------------------------------------------- yalıtım / ayırma durumu */
  /** Devrenin ayırma cihazı açık mı (EN 50110 kural 1)? supply: hiçbir zaman (şebeke tarafı). app: fiş çekiliyse. */
  function isolated(circ, sw) {
    if (circ === 'app') return !sw.plug;
    if (circ === 'earth') return !sw.earthLink;
    if (circ === 'supply') return false;
    if (!sw.q0 && circ !== 'supply') return true;
    return circ === 'F1' ? !sw.f1 : circ === 'F2' ? (!sw.rcd || !sw.f2) : circ === 'F3' ? !sw.f3 : circ === 'F4' ? !sw.f4 : false;
  }
  function lockedFor(circ, locks, sw) {
    if (circ === 'app') return !sw.plug;
    if (!sw.q0 && locks.q0) return true;
    if (circ === 'F1') return !sw.f1 && !!locks.f1;
    if (circ === 'F2') return (!sw.rcd || !sw.f2) && !!locks.f2;
    if (circ === 'F3') return !sw.f3 && !!locks.f3;
    if (circ === 'F4') return !sw.f4 && !!locks.f4;
    return false;
  }

  /* ---------------------------------------------------------------- ölçüm */
  const fmtN = (v, d) => { const s = (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ','); return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  function fmtR(R) {
    if (!isFinite(R) || R > 2e8) return 'OL';
    if (R >= 1e6) return fmtN(R / 1e6, R >= 1e8 ? 0 : 2) + ' MΩ';
    if (R >= 1e3) return fmtN(R / 1e3, 2) + ' kΩ';
    return fmtN(R, R < 10 ? 2 : 1) + ' Ω';
  }
  /** Direnç ağında a–b arası eşdeğer direnç: 1 A enjeksiyon, V_a − V_b. */
  function resistance(sc, sw, a, b) {
    const N = network(sc, sw, 'dc', false, 'run');
    N.node(a); N.node(b);
    const ia = a === 'RE' ? -1 : N.idx[a], ib = b === 'RE' ? -1 : N.idx[b];
    const sol = N.solve([{ n: ia, I: C.of(1) }, { n: ib, I: C.of(-1) }]);
    return Math.abs(sol.V(a).re - sol.V(b).re);
  }
  /** Bir ölçüm yapar. q = { inst, a, b, target }. Dönen: { ok, value, unit, text, live, violation, circ } */
  function measure(sc, sw, q) {
    const ac = solveAC(sc, sw), V = n => (n ? ac.sol.V(n) || C.of(0) : C.of(0));
    const vAbs = n => C.abs(V(n));
    const inst = q.inst;
    if (INSTRUMENTS[inst] && INSTRUMENTS[inst].two) {
      const A = PT[q.a], B = PT[q.b];
      if (!A || !B) return { ok: false, text: 'İki ölçüm noktası seçin (kırmızı ve siyah prob).' };
      const u = C.abs(C.sub(V(A.node), V(B.node)));
      const feeder = c => /^F[1-4]$|^app$/.test(c);
      const circ = feeder(A.circ) ? A.circ : feeder(B.circ) ? B.circ : A.circ === 'bus' || B.circ === 'bus' ? 'bus' : A.circ;
      if (inst === 'volt') return { ok: true, value: u, unit: 'V', text: fmtN(u, 1) + ' V AC', circ: circ, a: A.id, b: B.id, dead: u < 50 && vAbs(A.node) < 50 && vAbs(B.node) < 50 };
      // DC ölçümler: gerilimli noktaya bağlanırsa alet ölçmez ve kural ihlalidir
      const live = u > 25 || vAbs(A.node) > 50 || vAbs(B.node) > 50;
      if (live) return { ok: true, live: true, violation: true, value: NaN, unit: '', text: 'GERİLİM VAR (' + fmtN(Math.max(u, vAbs(A.node), vAbs(B.node)), 0) + ' V): ' + (inst === 'insul' ? 'yalıtım testi' : 'direnç ölçümü') + ' engellendi', circ: circ, a: A.id, b: B.id };
      const R = resistance(sc, sw, A.node, B.node);
      if (inst === 'ohm') return { ok: true, value: R, unit: 'Ω', text: R > 4e7 ? 'OL (açık devre)' : fmtR(R), circ: circ, a: A.id, b: B.id };
      const Rm = R / 1e6;
      return { ok: true, value: R, unit: 'MΩ', text: R >= 999e6 ? '> 999 MΩ' : fmtR(R) + (Rm < 1 ? ' (sınır 1 MΩ: UYGUN DEĞİL)' : ''), circ: circ, a: A.id, b: B.id, insulFail: Rm < 1 };
    }
    if (inst === 'clamp') {
      const c = CLAMPS.find(x => x.id === q.target); if (!c) return { ok: false, text: 'Pensle ölçülecek iletkeni seçin.' };
      const I = c.leak ? C.abs(C.add(ac.sol.I('c2L'), C.scale(ac.sol.I('c2N'), 1))) : c.tags.reduce((s, t) => s + mag(ac.sol, t), 0);
      // c2N dalı F2n → SoN yönünde tanımlı; L ve N akımlarının fazör toplamı kaçak (fark) akımıdır
      return { ok: true, value: I, unit: 'A', text: I < 1 ? fmtN(I * 1000, 1) + ' mA' : fmtN(I, 2) + ' A', circ: c.circ, target: c.id };
    }
    if (inst === 'rot') {
      const r = ROTS.find(x => x.id === q.target); if (!r) return { ok: false, text: 'Faz sırası noktasını seçin.' };
      const v = r.nodes.map(V), m = v.map(C.abs);
      // nötr referansı: üç faz geriliminin ortalaması (yıldız noktası) — faz–faz gerilimleri yeterliyse yön belirlenir
      const uLL = [C.abs(C.sub(v[0], v[1])), C.abs(C.sub(v[1], v[2])), C.abs(C.sub(v[2], v[0]))];
      if (Math.min.apply(null, uLL) < 300 || Math.min.apply(null, m) < 100) return { ok: true, value: NaN, unit: '', text: 'Faz eksik / gerilim yok (L1–L2 ' + fmtN(uLL[0], 0) + ' V, L2–L3 ' + fmtN(uLL[1], 0) + ' V, L3–L1 ' + fmtN(uLL[2], 0) + ' V)', circ: r.circ, target: r.id, seq: 0 };
      const a1 = Math.atan2(v[0].im, v[0].re), a2 = Math.atan2(v[1].im, v[1].re);
      const d = ((a2 - a1) / DEG + 540) % 360 - 180; // −120 → saat yönü
      const cw = d < 0;
      return { ok: true, value: cw ? 1 : -1, unit: '', text: cw ? 'Saat yönü (L1–L2–L3) · doğru sıra' : 'Saat yönünün tersi · TERS sıra', circ: r.circ, target: r.id, seq: cw ? 1 : -1 };
    }
    if (inst === 'loop') {
      const l = LOOPS.find(x => x.id === q.target); if (!l) return { ok: false, text: 'Döngü ölçüm noktasını seçin.' };
      const U = C.sub(V(l.L), V(l.R)), u = C.abs(U), uLPE = vAbs(l.L);
      if (u < 50 && uLPE < 50) return { ok: true, value: NaN, unit: 'Ω', text: 'Gerilim yok (devre açık)', circ: l.circ, target: l.id };
      if (u > 253) return { ok: true, value: NaN, unit: 'Ω', text: 'Ölçülemiyor: ' + l.name + ' gerilimi ' + fmtN(u, 0) + ' V (beklenen ≈ 230 V)', circ: l.circ, target: l.id, odd: true };
      // test yükü yöntemi: Z = Zt·(U0 − U1)/U1 (RCD açmayan test modu kabul edildi)
      const N = (ac.pulled ? network(sc, sw, 'ac', true, ac.motor === 'locked' ? 'locked' : 'run') : network(sc, sw, 'ac', false, 'run'));
      N.add(l.L, l.R, { re: 10, im: 0 });
      const s1 = N.solve(), U1 = C.sub(s1.V(l.L), s1.V(l.R));
      if (C.abs(U1) < 1e-6) return { ok: true, value: NaN, unit: 'Ω', text: 'Ölçülemedi', circ: l.circ, target: l.id };
      const Z = C.abs(C.mul({ re: 10, im: 0 }, C.div(C.sub(U, U1), U1)));
      if (Z > 1999) return { ok: true, value: Infinity, unit: 'Ω', text: 'Döngü yok / > 1999 Ω (dönüş yolu yok)', circ: l.circ, target: l.id };
      return { ok: true, value: Z, unit: 'Ω', text: 'Zs = ' + fmtN(Z, Z < 10 ? 2 : 1) + ' Ω · Ik ≈ ' + fmtN(U0 / Z, U0 / Z < 10 ? 2 : 0) + ' A', circ: l.circ, target: l.id };
    }
    if (inst === 'earth') {
      // 3 kazık yöntemi elektrodun kendi direncini ölçer (ölçüm köprüsünün açık olması gerekmez kabulü)
      const RA = sc.system === 'TT' ? sc.p.RAtt : sc.p.RA;
      return { ok: true, value: RA, unit: 'Ω', text: 'R_A = ' + fmtN(RA, 1) + ' Ω (elektrot)', circ: 'earth', target: 'EL' };
    }
    if (inst === 'thermal') {
      const t = THERMAL.find(x => x.id === q.target); if (!t) return { ok: false, text: 'Termal kamerayla bakılacak ekipmanı seçin.' };
      const T = temperature(sc, sw, ac, t.id);
      return { ok: true, value: T.max, unit: '°C', text: T.text, circ: T.circ, target: t.id };
    }
    return { ok: false, text: 'Ölçü aleti seçin.' };
  }

  /** Kararlı durum sıcaklıkları (ortam 25 °C). Bağlantı: ΔT = 8 K/W · I²·Rc; kablo: ΔT = 40 K·(I/Iz)² (PVC, Iz’de 70 °C);
   * motor: ΔT = 50 K·(I/In)², kilitli rotorda hızla yükselir; ısıtıcı gövdesi çalışırken ≈ 60 °C. Temsilîdir. */
  function temperature(sc, sw, ac, id) {
    const s = ac.sol, T0 = 25, i2 = t => Math.pow(mag(s, t), 2);
    const conn = (I2, Rc) => T0 + 8 * I2 * Rc;
    const fmtT = x => fmtN(x, 0) + ' °C';
    if (id === 'tMdb') { const I = Math.max(mag(s, 'q0L1'), mag(s, 'q0L2'), mag(s, 'q0L3')); const t = T0 + 6 + 10 * Math.pow(I / 100, 2); return { max: t, text: 'En sıcak nokta ' + fmtT(t) + ' (normal dağılım)', circ: 'bus' }; }
    if (id === 'tF2c') { const t = T0 + 40 * i2('c2L') / (24 * 24); return { max: t, text: 'Kablo yüzeyi ' + fmtT(t) + (t > 50 ? ' · belirgin ısınma (akım yüksek)' : ''), circ: 'F2' }; }
    if (id === 'tSo') { const t = conn(i2('c2L'), 0.003) + 2; return { max: t, text: 'Priz kontakları ' + fmtT(t), circ: 'F2' }; }
    if (id === 'tApp') { const on = sw.plug && sw.rcd && sw.f2; const t = on ? T0 + 18 + (sc.type === 'overload' ? 12 : 0) : T0; return { max: t, text: on ? 'Cihaz gövdesi ' + fmtT(t) + ' (çalışıyor)' : 'Cihaz soğuk (' + fmtT(t) + ', enerjisiz)', circ: 'app' }; }
    if (id === 'tK1') { const t = T0 + (ac.pulled ? 12 : 0) + (ac.motor === 'locked' ? 25 : 0); return { max: t, text: (ac.pulled ? 'Kontaktör çekili · ' : 'Kontaktör bırakmış · ') + fmtT(t) + (ac.motor === 'locked' ? ' · termik ısınıyor' : ''), circ: 'F3' }; }
    if (id === 'tMot') {
      if (ac.motor === 'locked') return { max: 95, text: 'Sargılar hızla ısınıyor: ≈ 95 °C ve yükseliyor (kilitli rotor)', circ: 'F3' };
      const I = mag(s, 'c3L1'), t = T0 + (ac.pulled ? 8 + 35 * Math.pow(I / MOTOR.In, 2) : 0);
      return { max: t, text: 'Motor gövdesi ' + fmtT(t) + (ac.pulled ? ' (çalışıyor)' : ' (duruyor)'), circ: 'F3' };
    }
    if (id === 'tHbox') {
      const pts = [1, 2, 3].map(i => conn(i2('c4L' + i), sc.type === 'looseConn' && i === sc.p.phase ? sc.p.Rc : 5e-4) + (sc.p.heat && sw.f4 ? 15 : 0));
      const k = pts.indexOf(Math.max.apply(null, pts));
      const hot = pts[k] > 80;
      return { max: pts[k], text: hot ? 'SICAK NOKTA: L' + (k + 1) + ' klemensi ' + fmtT(pts[k]) + ' (diğerleri ' + fmtT(Math.min.apply(null, pts)) + ')' : 'Klemensler ' + pts.map(fmtT).join(' / '), circ: 'F4', hotPhase: hot ? k + 1 : 0 };
    }
    if (id === 'tLmp') { const on = C.abs(C.sub(s.V('LmpL'), s.V('LmpN'))); const t = T0 + 30 * Math.pow(on / U0, 2); return { max: t, text: 'Armatür ' + fmtT(t) + (on > 260 ? ' · aşırı gerilim nedeniyle çok sıcak' : on < 180 && on > 20 ? ' · düşük gerilim' : ''), circ: 'F1' }; }
    return { max: T0, text: '—', circ: '' };
  }

  /* ---------------------------------------------------------------- oturum, kurallar, puan */
  /** Oturum günlüğüne bir ölçüm ekler; EN 50110 kurallarını (ayır, kilitle, gerilim yokluğunu doğrula) değerlendirir.
   * sess = { sw, locks, log[], verify{} , seq }. Yeni oturum nesnesi döner (girdiyi değiştirmez). */
  function record(sc, sess, q) {
    const s = clone(sess), m = measure(sc, s.sw, q);
    if (!m.ok) return { sess: sess, m: m };
    s.seq++;
    const e = { n: s.seq, inst: q.inst, a: q.a || '', b: q.b || '', target: q.target || '', text: m.text, value: isFinite(m.value) ? m.value : null, unit: m.unit || '', circ: m.circ || '', violation: !!m.violation, rules: [] };
    if (q.inst === 'volt' && m.dead && m.circ && isolated(m.circ, s.sw)) s.verify[m.circ] = s.seq;
    if (INSTRUMENTS[q.inst].dc && !m.live) {
      const circs = [PT[q.a].circ, PT[q.b].circ].filter(c => c === 'F1' || c === 'F2' || c === 'F3' || c === 'F4' || c === 'bus');
      circs.forEach(c => {
        if (!lockedFor(c, s.locks, s.sw)) e.rules.push('kilit');
        if (!(s.verify[c] && s.verify[c] > (s.lockSeq[c] || 0))) e.rules.push('doğrulama');
      });
      e.rules = e.rules.filter((x, i, a) => a.indexOf(x) === i);
    }
    s.log.push(e);
    return { sess: s, m: m, e: e };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newSession(sc) { return { sw: initialSwitches(sc), locks: {}, lockSeq: {}, log: [], verify: {}, seq: 0 }; }
  /** Anahtarlama işlemi: dev ∈ q0,f1,rcd,f2,f3,f4,k1 (start/stop komutu), ol (termik reset), plug, n1,n2,n4, earthLink; lock: kilit/etiket.
   * Kilitli cihaz kapatılamaz. Kapatmadan sonra anlık korumalar (RCD) settle() ile uygulanır. Dönen: { sess, msg, trips } */
  function operate(sc, sess, dev, value) {
    const s = clone(sess);
    const lockKey = { q0: 'q0', f1: 'f1', rcd: 'f2', f2: 'f2', f3: 'f3', f4: 'f4' }[dev];
    if (value === 'lock' || value === 'unlock') {
      if (!lockKey) return { sess: sess, msg: 'Bu cihaz kilitlenemez.' };
      if (value === 'lock') {
        const open = dev === 'rcd' || dev === 'f2' ? (!s.sw.rcd || !s.sw.f2) : !s.sw[dev];
        if (!open) return { sess: sess, msg: 'Kilitlemeden önce cihazı açın (ayırın).' };
        s.seq++; s.locks[lockKey] = true; s.lockSeq[lockKey === 'q0' ? 'bus' : lockKey.toUpperCase()] = s.seq;
        if (lockKey === 'q0') ['F1', 'F2', 'F3', 'F4'].forEach(c => { s.lockSeq[c] = Math.max(s.lockSeq[c] || 0, s.seq); });
        return { sess: s, msg: 'Kilit ve etiket takıldı (kural 2).' };
      }
      s.locks[lockKey] = false; return { sess: s, msg: 'Kilit kaldırıldı.' };
    }
    if (value && lockKey && s.locks[lockKey]) return { sess: sess, msg: 'Cihaz kilitli: önce kilidi kaldırın.' };
    if (dev === 'k1' && value && !s.sw.ol) return { sess: sess, msg: 'Termik röle açık: önce resetleyin.' };
    s.sw[dev] = !!value;
    const st = settle(sc, s.sw);
    s.sw = st.sw;
    let msg = '';
    if (st.trips.length) msg = st.trips.map(t => ({ rcd: 'RCD', f2: 'F2 MCB' }[t.dev] || t.dev) + ' hemen açtı: ' + t.why).join(' · ');
    return { sess: s, msg: msg, trips: st.trips };
  }
  /** Zamana bağlı korumalar: dt saniye sonra MCB termik ya da termik röle açar mı? acc: birikmiş süreler. */
  function thermalStep(sc, sess, acc, dt, timeScale) {
    const ac = solveAC(sc, sess.sw); const out = { acc: Object.assign({ f2: 0, ol: 0 }, acc), trip: null };
    const I2 = mag(ac.sol, 'c2L');
    if (sess.sw.f2 && sess.sw.rcd && I2 > 1.13 * 16) { out.acc.f2 += dt * (timeScale || 1); if (out.acc.f2 >= 40) out.trip = { dev: 'f2', why: 'F2 MCB aşırı yükte açtı (' + fmtN(I2, 1) + ' A > 1,13·16 A; gerçekte dakikalar, burada hızlandırıldı)' }; } else out.acc.f2 = 0;
    if (ac.motor === 'locked') { out.acc.ol += dt; const r = mag(ac.sol, 'c3L1') / MOTOR.In; const t = Math.min(30, E.motor.TRIP_CLASS['10'][1] * Math.pow(7.2 / Math.max(r, 1.2), 2)); if (out.acc.ol >= t) out.trip = { dev: 'ol', why: 'Termik röle açtı (' + fmtN(r, 1) + '·In, sınıf 10 ≈ ' + fmtN(t, 0) + ' s)' }; } else out.acc.ol = 0;
    return out;
  }
  /** Teşhis puanı (100): arıza tipi 60, yer 15, ölçüm verimi 15, güvenlik 10 (ihlal başına −10/−15, eksik kural −4). */
  function score(sc, sess, ans, mode) {
    const f = sc.fault, typeOk = ans.type === sc.type, locOk = ans.loc === f.loc;
    const n = sess.log.length, opt = f.optimal;
    const eff = n === 0 ? 0 : n <= opt + 3 ? 15 : n <= opt + 8 ? 8 : 0;
    const violations = sess.log.filter(e => e.violation).length, missing = sess.log.filter(e => e.rules && e.rules.length).length;
    const safety = Math.max(-40, 10 - violations * (mode === 'advanced' ? 15 : 10) - missing * 4);
    const total = Math.max(0, Math.min(100, (typeOk ? 60 : 0) + (locOk ? 15 : 0) + (typeOk ? eff : 0) + safety));
    return { typeOk: typeOk, locOk: locOk, n: n, optimal: opt, eff: typeOk ? eff : 0, safety: safety, violations: violations, missing: missing, total: total };
  }

  return { Net: Net, rng: rng, MOTOR: MOTOR, COIL: COIL, FAULTS: FAULTS, POOLS: POOLS, MODES: MODES, LOCS: LOCS, scenario: scenario, initialSwitches: initialSwitches,
    network: network, solveAC: solveAC, settle: settle, POINTS: POINTS, PT: PT, CLAMPS: CLAMPS, ROTS: ROTS, LOOPS: LOOPS, THERMAL: THERMAL, INSTRUMENTS: INSTRUMENTS,
    isolated: isolated, lockedFor: lockedFor, resistance: resistance, measure: measure, temperature: temperature, record: record, newSession: newSession,
    operate: operate, thermalStep: thermalStep, score: score, fmtR: fmtR };
});
