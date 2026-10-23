// ============================================================================
// audio/audio.js — PX.audio : WebAudio sentez (§16), dosya yok                      sahip: Ses (volti)
// Zincir: kaynak → ses (voice) kazancı → kanal (sfx | ortam | ugultu) → DynamicsCompressor (−18 dB, 4:1)
//         → sınırlayıcı (−2 dB, 20:1, 1 ms) → ana kazanç → çıkış.
// AudioContext açılışta kurulur (otomatik oynatma politikası gereği askıda olabilir) ve YALNIZ jestte resume()
// edilir; resume çözülene kadar sfx kuyruklanır (ilk ses düşmez; 600 ms'den eski kuyruk atılır).
// Görünmezlik/bulanıklaşma: ana kazanç 30 ms'de 0'a, sonra suspend(); geri gelince resume + 60 ms açılış.
// Ses sınırı: aynı anda 12 kaynak, aynı türden 3; fazlası en eskiyi 20 ms'de söndürür.
// Ses yüksekliği normalizasyonu: her sesin en yüksek 50 ms RMS'i tür hedefine (dBFS) çekilir (±12 dB); kırpmalar
// geliştirmede OfflineAudioContext ile ölçülüp TRIM tablosuna gömülür (measure() yeniden ölçer). Gürültü tamponları
// rastgele ofsetle başlar.
//   PX.audio.init()  .resume()  .play(ad, {gain, delay, dur, rate})  .setVolume(0..1)  .setLevels({sfx, ortam})
//   .hum(level 0..1, trafo 0..1)  .stats() -> {state, voices, played, trims, queued, held, measured}  .names()
//   adlar: kesici_kapa kesici_ac ayirici yuk_ayirici kontaktor kilit dedektor toprak toprak_ac sigorta
//          sigorta_cek sigorta_tak buton ret adim merdiven iskele sayac kutlama koruma rot bekle is undo ui
//          ipucu spawn   (merdiven = çelik ızgara basamak, iskele = el merdiveni çubuğu; Volti'nin adım fazından)
// Olaylar: settings → ortam düzeyi (ayar.muzik), cmd:rejected → ret, cmd:accepted(rot) → rot, anim:step → sayac, win → kutlama, undo/reset → undo,
//          hint → ipucu, elec:changed → şebeke + trafo uğultusu, level:loaded → ortam (biyom) + spawn.
//          Cihaz sesleri Volti'nin klip vuruşlarından gelir (render/volti.js), adım sonundan değil.
// Kare döngüsünde iş yok (sürekli sesler ses iş parçacığında).
// ============================================================================
// Önceden ölçülmüş kazanç kırpmaları (doğrusal): her sesin en yüksek 50 ms RMS'i hedefe (TARGET) çekilir. Değerler
// measure() ile (OfflineAudioContext; R1 entegrasyonunda 6 × 3 koşu ortalamasıyla yeniden) üretildi ve buraya gömüldü: çalışma anında ölçüm YOK
// (27 çevrimdışı çizim ana iş parçacığında ~0,7 s tutuyordu; ilk dokunuştan sonra uzun görev üretiyordu).
// Birim testi A2, gömülü değerlerin güncel sentezle hâlâ hedefte (±2 dB, rastgele gürültü ofsetleri dahil) olduğunu doğrular.
const TRIM = {
  kesici_kapa: 0.663, kesici_ac: 0.884, ayirici: 0.517, yuk_ayirici: 0.868, kontaktor: 2.209, kilit: 1.286, dedektor: 0.861, toprak: 0.804,
  toprak_ac: 1.402, sigorta: 0.968, sigorta_cek: 1.109, sigorta_tak: 1.082, buton: 2.541, ret: 0.668, adim: 0.433, merdiven: 0.40, iskele: 0.6, sayac: 0.484,
  kutlama: 0.785, koruma: 0.654, rot: 1.451, bekle: 1.834, is: 1.460, undo: 0.569, ui: 0.733, ipucu: 0.716, spawn: 0.380,
};
const A = {
  ctx: null, master: null, comp: null, lim: null, ch: { sfx: null, ortam: null, ugultu: null },
  noise: null, brown: null, queue: [], voices: [], running: false, held: false, vol: 1, sfxVol: 0.5, ambVol: 0.3,
  trim: Object.assign({}, TRIM), resumeAt: 0, played: 0, dropped: 0, measured: false, measuring: false, hum: null, amb: null, humLevel: 0, trafoLevel: 0, biome: '', unlockBound: false,
};
const MAX_VOICES = 12, MAX_SAME = 3;
// tür hedefleri (en yüksek 50 ms RMS, dBFS) — sayaç/adım bilerek kısık; kutlama ana kazanç ≤ 0,5
const TARGET = {
  kesici_kapa: -16, kesici_ac: -16, ayirici: -17, yuk_ayirici: -16, kontaktor: -18, kilit: -20, dedektor: -21, toprak: -17, toprak_ac: -18,
  sigorta: -19, sigorta_cek: -21, sigorta_tak: -19, buton: -21, ret: -21, adim: -32, merdiven: -30, iskele: -31, sayac: -34, kutlama: -18, koruma: -19,
  rot: -26, bekle: -22, is: -21, undo: -24, ui: -27, ipucu: -23, spawn: -26,
};
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ kurulum
function ensure() {
  if (A.ctx) return A.ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try { A.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { A.ctx = new AC(); } catch (e2) { return null; } }
  const c = A.ctx;
  A.comp = c.createDynamicsCompressor(); A.comp.threshold.value = -18; A.comp.ratio.value = 4; A.comp.knee.value = 6; A.comp.attack.value = 0.004; A.comp.release.value = 0.18;
  A.lim = c.createDynamicsCompressor(); A.lim.threshold.value = -2; A.lim.ratio.value = 20; A.lim.knee.value = 0; A.lim.attack.value = 0.001; A.lim.release.value = 0.06;
  A.master = c.createGain(); A.master.gain.value = A.vol;
  A.comp.connect(A.lim); A.lim.connect(A.master); A.master.connect(c.destination);
  for (const k of ['sfx', 'ortam', 'ugultu']) { const g = c.createGain(); g.connect(A.comp); A.ch[k] = g; }
  A.ch.sfx.gain.value = A.sfxVol; A.ch.ortam.gain.value = A.ambVol; A.ch.ugultu.gain.value = A.ambVol;
  A.noise = makeNoise(c, 1.5, false); A.brown = makeNoise(c, 2.0, true);
  c.onstatechange = () => { A.running = c.state === 'running'; if (A.running) onRunning(); };
  A.running = c.state === 'running';
  return c;
}
function makeNoise(c, secs, brown) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}
function onRunning() {
  // kuyruk: resume İSTEĞİNDEN en çok 600 ms önce kuyruklananlar (açan jestin kendi sesleri; resume'un kendisi bazı
  // cihazlarda 0,3–2 s sürer, ilk ses yine de düşmez), en çok 4; daha eskiler atılır (geç gelen ses patlaması yok)
  const now = performance.now(), ref = A.resumeAt > 0 ? A.resumeAt : now; const q = A.queue.splice(0);
  let n = 0; for (const it of q) { if (ref - it.t < 600 && n < 4) { n++; if (!play(it.name, it.opts)) A.dropped++; } else A.dropped++; }
  A.resumeAt = 0;
  // ortam/uğultu yatakları açan jestin karelerine binmesin (ilk dokunuş → ilk hareket ≤ 34 ms): bir saniye sonra
  // başlatılır (düğüm kurulumu ana iş parçacığında; bazı tarayıcılarda ses aygıtının açılışıyla çakışıyor)
  if (!A.bedsT) A.bedsT = setTimeout(() => { A.bedsT = 0; if (A.running && !A.held) startBeds(); }, 1000);
}
function resume() {
  const c = ensure(); if (!c || A.held) return;
  if (c.state !== 'running') {
    if (!(A.resumeAt > 0)) A.resumeAt = performance.now(); const p = c.resume(); if (p && p.then) p.then(() => { A.running = c.state === 'running'; if (A.running) onRunning(); }).catch(() => {}); }
}

// ------------------------------------------------------------------ yapı taşları (c = bağlam, o = çıkış düğümü, t = başlangıç)
function envGain(c, o, t, att, peak, dec, hold) {
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, att));
  if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t + att + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + att + (hold || 0) + dec);
  g.connect(o); return g;
}
function tone(c, o, t, type, f0, f1, dur, vol, att) {
  const s = c.createOscillator(); s.type = type || 'sine';
  s.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) s.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = envGain(c, o, t, att || 0.004, vol, dur);
  s.connect(g); s.start(t); s.stop(t + (att || 0.004) + dur + 0.03);
  return t + dur + 0.05;
}
function noise(c, o, t, dur, ftype, f0, f1, q, vol, att, brown) {
  const b = brown ? A.brown : A.noise;
  const s = c.createBufferSource(); s.buffer = b;
  const f = c.createBiquadFilter(); f.type = ftype || 'bandpass'; f.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 1;
  const g = envGain(c, o, t, att || 0.002, vol, dur);
  s.connect(f); f.connect(g);
  const off = Math.random() * Math.max(0, b.duration - dur - 0.1);           // rastgele ofset: aynı ses iki kez aynı değil
  s.start(t, off); s.stop(t + (att || 0.002) + dur + 0.05);
  return t + dur + 0.06;
}
// metalik rezonans: kısa gürültü darbesi → dar bant süzgeç (yüksek Q) zinciri
function ring(c, o, t, f, q, dur, vol) {
  const s = c.createBufferSource(); s.buffer = A.noise;
  const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = f; f1.Q.value = q;
  const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = f * 1.0; f2.Q.value = q * 0.6;
  const gi = c.createGain(); gi.gain.setValueAtTime(1, t); gi.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  const g = envGain(c, o, t, 0.001, vol, dur);
  s.connect(gi); gi.connect(f1); f1.connect(f2); f2.connect(g);
  s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  return t + dur + 0.06;
}
function thump(c, o, t, f0, f1, dur, vol) { return tone(c, o, t, 'sine', f0, f1, dur, vol, 0.002); }

// ------------------------------------------------------------------ ses tasarımı (her biri bitiş zamanını döndürür)
const SND = {
  // kesici kapama: mekanik "tok" + yay; gürültü patlaması + 180 Hz düşen sinüs (120 ms) + metal
  kesici_kapa(c, o, t) {
    noise(c, o, t, 0.02, 'bandpass', 1400, 900, 1.6, 0.9);
    thump(c, o, t + 0.003, 180, 55, 0.12, 0.9);
    ring(c, o, t + 0.004, 3100, 28, 0.09, 0.5);
    tone(c, o, t + 0.01, 'triangle', 430, 390, 0.08, 0.08);
    return noise(c, o, t + 0.05, 0.05, 'highpass', 2600, 2600, 0.8, 0.12);
  },
  // kesici açma: daha keskin "çat" (80 ms)
  kesici_ac(c, o, t) {
    noise(c, o, t, 0.03, 'highpass', 2500, 1800, 0.9, 0.9);
    thump(c, o, t + 0.002, 240, 90, 0.08, 0.7);
    return ring(c, o, t + 0.002, 4200, 30, 0.08, 0.5);
  },
  // ayırıcı bıçağı: düşük gürültü (rumble) kabarması + 2 kHz metalik rezonans + sonda "ttunk"
  ayirici(c, o, t) {
    noise(c, o, t, 0.34, 'lowpass', 160, 260, 0.9, 0.55, 0.12, true);
    ring(c, o, t + 0.05, 2000, 14, 0.32, 0.25);
    noise(c, o, t + 0.04, 0.3, 'bandpass', 2000, 1700, 6, 0.12, 0.08);
    thump(c, o, t + 0.2, 110, 62, 0.16, 0.9);
    return ring(c, o, t + 0.2, 2400, 22, 0.14, 0.35);
  },
  // yük ayırıcısı: yaylı "klak"
  yuk_ayirici(c, o, t) {
    tone(c, o, t, 'triangle', 520, 300, 0.05, 0.12);
    noise(c, o, t + 0.035, 0.025, 'bandpass', 1800, 1200, 2, 0.9);
    thump(c, o, t + 0.036, 150, 70, 0.1, 0.8);
    return ring(c, o, t + 0.037, 2700, 24, 0.1, 0.45);
  },
  // kontaktör "klonk" + kısa çırpma
  kontaktor(c, o, t) {
    tone(c, o, t, 'square', 92, 70, 0.045, 0.25);
    noise(c, o, t, 0.02, 'lowpass', 900, 600, 0.8, 0.8);
    noise(c, o, t + 0.018, 0.008, 'bandpass', 2400, 2400, 3, 0.35);
    return noise(c, o, t + 0.032, 0.006, 'bandpass', 2600, 2600, 3, 0.2);
  },
  // asma kilit "klik"
  kilit(c, o, t) {
    noise(c, o, t, 0.008, 'highpass', 3200, 3200, 1, 0.8);
    ring(c, o, t, 5200, 30, 0.04, 0.3);
    return noise(c, o, t + 0.038, 0.01, 'highpass', 3600, 3600, 1, 0.9);
  },
  // gerilim dedektörü: 1,8 kHz bip × 2
  dedektor(c, o, t) {
    tone(c, o, t, 'triangle', 1800, 1800, 0.075, 0.6, 0.003);
    return tone(c, o, t + 0.13, 'triangle', 1800, 1800, 0.075, 0.6, 0.003);
  },
  // topraklama kelepçesi "klak"
  toprak(c, o, t) {
    noise(c, o, t, 0.022, 'bandpass', 1600, 1100, 3, 0.9);
    ring(c, o, t + 0.002, 2400, 20, 0.12, 0.45);
    return thump(c, o, t + 0.003, 140, 78, 0.1, 0.7);
  },
  toprak_ac(c, o, t) {
    noise(c, o, t, 0.018, 'bandpass', 1900, 1400, 3, 0.7);
    ring(c, o, t, 2900, 22, 0.08, 0.35);
    return thump(c, o, t + 0.002, 170, 100, 0.07, 0.45);
  },
  // sigorta eridi: kuru "pof" (süzülmüş gürültü, patlama değil)
  sigorta(c, o, t) {
    noise(c, o, t, 0.16, 'lowpass', 900, 280, 0.7, 0.8, 0.008);
    return thump(c, o, t, 90, 50, 0.12, 0.35);
  },
  sigorta_cek(c, o, t) { noise(c, o, t, 0.07, 'bandpass', 900, 1500, 1.4, 1, 0.01); thump(c, o, t + 0.06, 260, 160, 0.04, 0.5); return ring(c, o, t + 0.06, 3300, 25, 0.06, 0.6); },
  sigorta_tak(c, o, t) { thump(c, o, t, 300, 200, 0.05, 0.6); noise(c, o, t, 0.02, 'bandpass', 1200, 900, 2, 0.8); return ring(c, o, t + 0.002, 2900, 24, 0.07, 0.35); },
  buton(c, o, t) { noise(c, o, t, 0.012, 'bandpass', 2500, 2500, 2, 0.8); return tone(c, o, t, 'sine', 900, 700, 0.012, 0.3); },
  // ret: yumuşak iki ton aşağı
  ret(c, o, t) { tone(c, o, t, 'triangle', 520, 515, 0.09, 0.6, 0.008); return tone(c, o, t + 0.1, 'triangle', 392, 388, 0.12, 0.6, 0.008); },
  adim(c, o, t) { noise(c, o, t, 0.022, 'lowpass', rnd(420, 620), 300, 0.7, 0.8, 0.002); return thump(c, o, t, rnd(100, 130), 70, 0.025, 0.4); },
  // çelik ızgara basamak: kısa tok vuruş + ızgaranın metalik çınlaması (her adımda biraz farklı)
  merdiven(c, o, t) { thump(c, o, t, rnd(150, 180), 90, 0.03, 0.55); noise(c, o, t, 0.018, 'bandpass', rnd(1700, 2300), 1400, 3, 0.55, 0.001); return ring(c, o, t + 0.002, rnd(2100, 2600), 18, 0.07, 0.22); },
  // el merdiveni çubuğu: bot tabanı + boru çınlaması (daha ince, daha kısa)
  iskele(c, o, t) { thump(c, o, t, rnd(210, 240), 140, 0.02, 0.35); return ring(c, o, t + 0.001, rnd(3000, 3400), 22, 0.06, 0.28); },
  sayac(c, o, t) { return tone(c, o, t, 'sine', 2200, 2200, 0.009, 0.7, 0.001); },
  // kutlama arpejı (C-E-G-C) + yumuşak ped
  kutlama(c, o, t) {
    const f = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.1, 'triangle', f[i], f[i], 0.16, 0.45, 0.006);
    for (let i = 0; i < 3; i++) tone(c, o, t + 0.42, 'sine', f[i] / 2, f[i] / 2, 0.75, 0.16, 0.08);
    return t + 1.25;
  },
  // koruma açması: kesici açma + röle bayrağı tık + kısa iki tonlu alarm kornası (yumuşak)
  koruma(c, o, t) {
    SND.kesici_ac(c, o, t);
    noise(c, o, t + 0.09, 0.006, 'highpass', 4000, 4000, 1, 0.5);
    for (let i = 0; i < 2; i++) {
      const tt = t + 0.18 + i * 0.26;
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(660, tt); s.frequency.setValueAtTime(880, tt + 0.12);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.Q.value = 0.7;
      const g = envGain(c, o, tt, 0.015, 0.16, 0.2, 0.04); s.connect(lp); lp.connect(g); s.start(tt); s.stop(tt + 0.3);
    }
    return t + 0.75;
  },
  // döndürme: bant geçiren gürültü süpürmesi; süre kamera hareketine eşit (o.dur)
  rot(c, o, t, op) { const d = op && op.dur > 0 ? op.dur : 0.28; noise(c, o, t, d * 0.55, 'bandpass', 320, 1800, 1.2, 0.5, d * 0.25); return noise(c, o, t + d * 0.45, d * 0.55, 'bandpass', 1800, 600, 1.2, 0.35); },
  // deşarj bekle: azalarak cızırtı
  bekle(c, o, t) {
    let e = t; for (let i = 0; i < 8; i++) e = noise(c, o, t + i * 0.045 + Math.random() * 0.012, 0.022, 'bandpass', rnd(2600, 3600), 0, 1.6, 1 - i / 10);
    return e;
  },
  // iş: lokma anahtar cırcırı ×3
  is(c, o, t) {
    let e = t; for (let i = 0; i < 3; i++) { noise(c, o, t + i * 0.09, 0.01, 'highpass', 4200, 4200, 1, 0.7); e = tone(c, o, t + i * 0.09, 'square', 1100, 900, 0.01, 0.12); }
    return e;
  },
  undo(c, o, t) { return tone(c, o, t, 'sine', 760, 380, 0.08, 0.5); },
  ui(c, o, t) { return tone(c, o, t, 'sine', 620, 600, 0.02, 0.5); },
  ipucu(c, o, t) { tone(c, o, t, 'sine', 880, 880, 0.12, 0.35, 0.01); return tone(c, o, t + 0.09, 'sine', 1320, 1320, 0.16, 0.3, 0.01); },
  spawn(c, o, t) { tone(c, o, t, 'sine', 220, 660, 0.22, 0.35, 0.02); return noise(c, o, t + 0.05, 0.18, 'bandpass', 600, 2400, 2, 0.12, 0.05); },
};
const NAMES = Object.keys(SND);

// ------------------------------------------------------------------ çalma
function userSfx() {
  try { const v = PX.store && PX.store.data && PX.store.data.ayar ? PX.store.data.ayar.ses : undefined; if (typeof v === 'number') return Math.max(0, Math.min(1, v)); } catch (e) { /* kayıt yok */ }
  return A.sfxVol;
}
function play(name, opts) {
  const c = A.ctx; if (!c || !SND[name]) return false;
  if (A.held) return false;
  if (c.state !== 'running') { if (A.queue.length < 8) A.queue.push({ name, opts, t: performance.now() }); return false; }
  const sv = userSfx(); if (sv !== A.sfxVol) { A.sfxVol = sv; A.ch.sfx.gain.setTargetAtTime(sv, c.currentTime, 0.02); }
  if (sv <= 0.001) return false;
  const now = c.currentTime;
  // ses sınırı
  const V = A.voices; for (let i = V.length - 1; i >= 0; i--) if (V[i].end < now) V.splice(i, 1);
  let same = 0, oldestSame = -1; for (let i = 0; i < V.length; i++) if (V[i].name === name) { same++; if (oldestSame < 0) oldestSame = i; }
  if (same >= MAX_SAME) killVoice(oldestSame);
  else if (V.length >= MAX_VOICES) killVoice(0);
  const t = now + 0.005 + (opts && opts.delay > 0 ? opts.delay : 0);
  const vg = c.createGain();
  const trim = A.trim[name] !== undefined ? A.trim[name] : 1;
  vg.gain.value = trim * (opts && opts.gain > 0 ? opts.gain : 1);
  vg.connect(A.ch.sfx);
  let end;
  try { end = SND[name](c, vg, t, opts); } catch (e) { vg.disconnect(); return false; }
  V.push({ name, g: vg, end: (end || t + 0.3) + 0.05 });
  A.played++;
  return true;
}
function killVoice(i) {
  const v = A.voices[i]; if (!v) return; A.voices.splice(i, 1);
  const c = A.ctx, now = c.currentTime;
  try { v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(0, now + 0.02); } catch (e) { /* yok */ }
  setTimeout(() => { try { v.g.disconnect(); } catch (e) { /* yok */ } }, 60);
}

// ------------------------------------------------------------------ ses yüksekliği normalizasyonu (çevrimdışı ölçüm)
function measureOne(name) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return Promise.resolve(null);
  const sr = 22050, secs = 1.6;
  let oc; try { oc = new OAC(1, Math.floor(sr * secs), sr); } catch (e) { return Promise.resolve(null); }
  const o = oc.createGain(); o.connect(oc.destination);
  try { SND[name](oc, o, 0.01, {}); } catch (e) { return Promise.resolve(null); }
  return oc.startRendering().then(buf => {
    const d = buf.getChannelData(0), w = Math.floor(sr * 0.05); let best = 0, acc = 0;
    for (let i = 0; i < d.length; i++) { acc += d[i] * d[i]; if (i >= w) acc -= d[i - w] * d[i - w]; if (i >= w - 1) { const r = acc / w; if (r > best) best = r; } }
    let peak = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    return { rms: Math.sqrt(Math.max(best, 1e-12)), peak };
  }).catch(() => null);
}
function measureAll() {
  if (A.measuring || A.measured) return; A.measuring = true;
  const info = {}; let i = 0;
  const next = () => {
    if (i >= NAMES.length) { A.measured = true; A.measuring = false; A.measureInfo = info; return; }
    const n = NAMES[i++];
    // 3 koşu ortalaması (gömülü TRIM tablosu da böyle üretildi): gürültü tabanlı seslerin tek koşusu ±3 dB oynar
    Promise.all([measureOne(n), measureOne(n), measureOne(n)]).then(ms => {
      const ok = ms.filter(x => x && x.rms > 1e-6); if (!ok.length) return null;
      let db = 0, peak = 0; for (const x of ok) { db += 20 * Math.log10(x.rms); if (x.peak > peak) peak = x.peak; }
      return { rms: Math.pow(10, db / ok.length / 20), peak };
    }).then(m => {
      if (m && m.rms > 1e-6) {
        const tgt = Math.pow(10, (TARGET[n] !== undefined ? TARGET[n] : -22) / 20);
        let k = tgt / m.rms; k = Math.max(0.25, Math.min(4, k));                 // ±12 dB
        if (m.peak * k > 0.95) k = 0.95 / m.peak;                                // tepe koruması (sınırlayıcıdan önce)
        A.trim[n] = k; info[n] = { rmsDb: +(20 * Math.log10(m.rms)).toFixed(1), peak: +m.peak.toFixed(3), trimDb: +(20 * Math.log10(k)).toFixed(1) };
      }
      setTimeout(next, 16);                                                        // uzun görev yok: ses başına bir dilim
    });
  };
  next();
}

// ------------------------------------------------------------------ sürekli katmanlar: şebeke/trafo uğultusu, ortam
function startBeds() {
  const c = A.ctx; if (!c || A.hum) return;
  // 50 Hz şebeke: 100/200/300 Hz (manyetostriksiyon çift frekansta), hafif dalgalanma
  const humG = c.createGain(); humG.gain.value = 0; humG.connect(A.ch.ugultu);
  const parts = [[100, 1], [200, 0.5], [300, 0.28]];
  const oscs = parts.map(([f, a]) => { const s = c.createOscillator(); s.frequency.value = f * rnd(0.998, 1.002); const g = c.createGain(); g.gain.value = a * 0.25; s.connect(g); g.connect(humG); s.start(); return s; });
  const lfo = c.createOscillator(); lfo.frequency.value = 0.23; const lg = c.createGain(); lg.gain.value = 0.015; lfo.connect(lg); lg.connect(humG.gain); lfo.start();
  // trafo: zengin harmonikli 100 Hz (PeriodicWave), alçak geçiren + hafif vızıltı
  const trG = c.createGain(); trG.gain.value = 0; trG.connect(A.ch.ugultu);
  const real = new Float32Array([0, 1, 0.6, 0.38, 0.22, 0.12, 0.06]), imag = new Float32Array(real.length);
  const tr = c.createOscillator(); tr.setPeriodicWave(c.createPeriodicWave(real, imag)); tr.frequency.value = 100;
  const tlp = c.createBiquadFilter(); tlp.type = 'lowpass'; tlp.frequency.value = 520; tlp.Q.value = 0.8;
  const tg = c.createGain(); tg.gain.value = 0.22; tr.connect(tlp); tlp.connect(tg); tg.connect(trG); tr.start();
  const bz = c.createBufferSource(); bz.buffer = A.noise; bz.loop = true; const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 300; bf.Q.value = 6;
  const bg = c.createGain(); bg.gain.value = 0.03; bz.connect(bf); bf.connect(bg); bg.connect(trG); bz.start(0, Math.random());
  A.hum = { humG, trG, oscs, tr };
  // ortam: kahverengi gürültü, biyoma göre süzgeç; yavaş rüzgâr LFO'su
  const ab = c.createBufferSource(); ab.buffer = A.brown; ab.loop = true;
  const af = c.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 400; af.Q.value = 0.5;
  const ag = c.createGain(); ag.gain.value = 0; ab.connect(af); af.connect(ag); ag.connect(A.ch.ortam); ab.start(0, Math.random() * 1.5);
  const wl = c.createOscillator(); wl.frequency.value = 0.07; const wg = c.createGain(); wg.gain.value = 120; wl.connect(wg); wg.connect(af.frequency); wl.start();
  A.amb = { ag, af, wg };
  applyBeds();
}
const BIOME = { 'Depo': [260, 0.1, 30], 'Volt Mahallesi': [520, 0.14, 180], 'Trafo Merkezi': [300, 0.1, 60], 'Fabrika': [700, 0.12, 90] };
function applyBeds() {
  const c = A.ctx; if (!c || !A.hum) return; const t = c.currentTime;
  A.hum.humG.gain.setTargetAtTime(0.06 + 0.5 * A.humLevel, t, 0.25);
  A.hum.trG.gain.setTargetAtTime(0.9 * A.trafoLevel, t, 0.3);
  const b = BIOME[A.biome] || BIOME['Depo'];
  A.amb.af.frequency.setTargetAtTime(b[0], t, 0.5); A.amb.ag.gain.setTargetAtTime(b[1], t, 0.6); A.amb.wg.gain.setTargetAtTime(b[2], t, 0.5);
}
function hum(level, trafo) {
  A.humLevel = Math.max(0, Math.min(1, +level || 0)); A.trafoLevel = Math.max(0, Math.min(1, +trafo || 0)); applyBeds();
}
function elecLevels(p) {
  const L = PX.game && PX.game.L; if (!L || !p || !p.E) return;
  const nl = L.loads.length || 1, fed = p.fedLoads ? p.fedLoads.length : 0;
  let liveTr = 0, cur = 0, dsum = 0;
  for (let i = 0; i < L.edges.length; i++) { const e = L.edges[i]; if (e.t === 1 && (p.E.live[e.a] || p.E.live[e.b])) { liveTr++; cur += p.E.cur ? p.E.cur[i] || 0 : 0; } }
  for (let i = 0; i < L.loads.length; i++) dsum += L.loads[i].d || 1;
  const tr = liveTr ? 0.35 + 0.65 * Math.min(1, cur / Math.max(1, dsum)) : 0;
  hum(fed / nl, tr);
}

// ------------------------------------------------------------------ görünürlük: sönüm + askı
let holdTimer = 0;
function hold() {
  const c = A.ctx; if (!c || A.held) return; A.held = true;
  try { A.master.gain.cancelScheduledValues(c.currentTime); A.master.gain.setValueAtTime(A.master.gain.value, c.currentTime); A.master.gain.linearRampToValueAtTime(0, c.currentTime + 0.03); } catch (e) { /* yok */ }
  clearTimeout(holdTimer); holdTimer = setTimeout(() => {
    if (A.held && c.state === 'running') c.suspend().then(() => {
      // Focus, suspend tamamlanmadan gelmiş olabilir: gecikmiş askı isteği sesi kapalı bırakamaz.
      if (!A.held) wake(c);
    }).catch(() => {});
  }, 45);
}
function release() {
  const c = A.ctx; if (!c || !A.held) return; A.held = false; clearTimeout(holdTimer);
  wake(c);
}
function wake(c) {
  const up = () => { if (A.held) return; try { A.master.gain.cancelScheduledValues(c.currentTime); A.master.gain.setValueAtTime(0, c.currentTime); A.master.gain.linearRampToValueAtTime(A.vol, c.currentTime + 0.06); } catch (e) { /* yok */ } };
  if (c.state !== 'running') { const p = c.resume(); if (p && p.then) p.then(up).catch(() => {}); } else up();
}

// ------------------------------------------------------------------ init + olaylar
function init() {
  ensure();                 // bağlam açılışta (askıda) kurulur: ilk dokunuşta oluşturmak ana iş parçacığını ~250 ms bloklar
  if (!A.unlockBound) {
    A.unlockBound = true;
    const unlock = () => { if (A.ctx && A.ctx.state !== 'running' && !A.held) resume(); };
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { passive: true, capture: true });
  }
  if (A.ctx && A.ctx.state === 'running') onRunning();
  const bus = PX.bus; if (!bus) return;
  bus.on('cmd:rejected', p => { if (p && p.err !== 'bos' && p.err !== 'kazanildi') play(p.err === 'tampon' ? 'ui' : 'ret'); });
  bus.on('cmd:accepted', p => { if (p && p.cmd && p.cmd.t === 'rot') play('rot', { dur: 0.28 }); });
  bus.on('anim:step', p => { if (p && p.c && (p.c.h || p.c.m)) play('sayac'); });
  bus.on('win', () => play('kutlama'));
  bus.on('undo', () => play('undo'));
  bus.on('reset', () => play('undo', { gain: 0.8 }));
  bus.on('hint', () => play('ipucu'));
  bus.on('elec:changed', elecLevels);
  // ayarlar: ayar.ses = sfx (her çalmada okunur), ayar.muzik = ortam + uğultu kanalı
  const amb = () => { try { const a = PX.store && PX.store.data && PX.store.data.ayar; if (a && typeof a.muzik === 'number') PX.audio.setLevels({ ortam: a.muzik }); } catch (e) { /* kayıt yok */ } };
  amb(); bus.on('settings', amb);
  bus.on('level:loaded', p => { const lv = p && p.level; A.biome = lv && lv.biyom ? lv.biyom : ''; applyBeds(); play('spawn'); });
  let runtimeVisible = true;
  const syncVisibility = () => { if (document.hidden || !runtimeVisible) hold(); else release(); };
  bus.on('runtime:visibility', p => { runtimeVisible = !!(p && p.visible); syncVisibility(); });
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('pagehide', hold); window.addEventListener('pageshow', syncVisibility);
  window.addEventListener('blur', hold); window.addEventListener('focus', syncVisibility);
}
PX.audio = {
  init, resume, play, hum,
  setVolume(v) { A.vol = Math.max(0, Math.min(1, +v || 0)); if (A.master && !A.held) A.master.gain.setTargetAtTime(A.vol, A.ctx.currentTime, 0.02); },
  setLevels(o) {
    if (!o) return; const c = A.ctx;
    if (typeof o.sfx === 'number') { A.sfxVol = Math.max(0, Math.min(1, o.sfx)); if (c) A.ch.sfx.gain.setTargetAtTime(A.sfxVol, c.currentTime, 0.02); }
    if (typeof o.ortam === 'number') { A.ambVol = Math.max(0, Math.min(1, o.ortam)); if (c) { A.ch.ortam.gain.setTargetAtTime(A.ambVol, c.currentTime, 0.05); A.ch.ugultu.gain.setTargetAtTime(A.ambVol, c.currentTime, 0.05); } }
  },
  names() { return NAMES.slice(); },
  measure() { A.measured = false; A.measuring = false; measureAll(); },
  stats() {
    const c = A.ctx; const now = c ? c.currentTime : 0;
    return { state: c ? c.state : 'yok', voices: A.voices.filter(v => v.end >= now).length, played: A.played, dropped: A.dropped, queued: A.queue.length, held: A.held, measured: A.measured,
      trims: Object.assign({}, A.trim), baked: Object.assign({}, TRIM), info: A.measureInfo || null, hum: A.humLevel, trafo: A.trafoLevel, biome: A.biome, sfx: A.sfxVol };
  },
  get ctx() { return A.ctx; },
};
