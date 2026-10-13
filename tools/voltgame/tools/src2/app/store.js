// ============================================================================
// app/store.js — PX.store : kalıcı kayıt (§10)                       sahip: Çekirdek
// localStorage anahtarı 'paralaks2.kayit'; her okuma/yazma try/catch; ?nostorage ile devre dışı.
// Erişilemezse oyun bellekte çalışır ve 'toast' {msg: STR.kayitKapali} yayınlanır.
// Sürümlü JSON; v artarsa MIGRATE[v] sırayla uygulanır; tanınmayan anahtarlar korunur; bozuk kayıt
// atılır (yedeği 'paralaks2.kayit.bozuk' anahtarına yazılmaya çalışılır).
//   PX.store.init()                      PX.store.available -> bool     PX.store.data -> nesne
//   PX.store.get('ayar.ses')             PX.store.set('ayar.ses', 0.4)  PX.store.save()
//   PX.store.level(id) -> kayıt          PX.store.recordWin(id, tot{h,m,k,o}, str, extra?) -> {yeniEn:{h,m,k,o}}
//   PX.store.setSon(id, str|null)        PX.store.reset()
// ============================================================================
const KEY = 'paralaks2.kayit';
const VERSION = 1;
const RULES = PX.SIM && PX.SIM.RULES_VERSION || null;
const DEFAULTS = () => ({
  v: VERSION, kuralSurumu: RULES,
  ayar: { ses: 0.5, muzik: 0.3, hareketAzalt: false, isikAzalt: false, kalite: 'oto', etiketler: true, tekDokunusYuru: true, dil: 'tr' },
  seviye: {}, gunluk: {}, arac: [], bolge: {}, sir: {}, kozmetik: {}, istat: { gunSayisi: 0 }, arsiv: [], erisilen: [],
});
// v(n-1) -> v(n) göç işlevleri. Örnek: MIGRATE[1] = v0 (sürümsüz eski biçim) -> v1
const MIGRATE = {
  1: d => { const o = { ...DEFAULTS(), ...d }; o.ayar = { ...DEFAULTS().ayar, ...(d.ayar || d.settings || {}) }; o.v = 1; return o; },
};

let data = DEFAULTS(); let available = false; let disabledReason = '';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const metric = n => Number.isSafeInteger(n) && n >= 0;
const unsafe = k => k === '__proto__' || k === 'prototype' || k === 'constructor';
function cleanLevel(r) {
  r = obj(r) ? r : {};
  if (own(r, 'ipucsuz')) r.ipucsuz = r.ipucsuz === true;
  r.cozuldu = r.cozuldu === true; r.ipuclu = r.ipuclu === true && !r.ipucsuz;
  r.en = obj(r.en) ? r.en : {};
  for (const m of ['h', 'm', 'k', 'o']) if (own(r.en, m) && (!Array.isArray(r.en[m]) || !metric(r.en[m][0]) || typeof r.en[m][1] !== 'string')) delete r.en[m];
  r.gecmis = Array.isArray(r.gecmis) ? r.gecmis.filter(v => Array.isArray(v) && v.length === 4 && v.every(metric)).slice(-32) : [];
  r.muhur = Array.isArray(r.muhur) ? [...new Set(r.muhur.filter(k => typeof k === 'string'))] : [];
  r.son = typeof r.son === 'string' ? r.son : null;
  return r;
}
function normalize(d) {
  const def = DEFAULTS();
  for (const k in def) {
    const valid = Array.isArray(def[k]) ? Array.isArray(d[k]) : obj(def[k]) ? obj(d[k]) : typeof d[k] === typeof def[k];
    if (!valid) d[k] = def[k];
  }
  for (const k in def.ayar) {
    if (typeof d.ayar[k] !== typeof def.ayar[k]) d.ayar[k] = def.ayar[k];
  }
  for (const k of ['ses', 'muzik']) d.ayar[k] = Number.isFinite(d.ayar[k]) ? Math.max(0, Math.min(1, d.ayar[k])) : def.ayar[k];
  if (!['oto', 'dusuk', 'orta', 'yuksek'].includes(d.ayar.kalite)) d.ayar.kalite = def.ayar.kalite;
  for (const id of Object.keys(d.seviye)) { if (unsafe(id)) delete d.seviye[id]; else d.seviye[id] = cleanLevel(d.seviye[id]); }
  for (const k of Object.keys(d.gunluk)) {
    const r = d.gunluk[k];
    if (!obj(r)) { delete d.gunluk[k]; continue; }
    r.cozuldu = r.cozuldu === true;
    if (!Array.isArray(r.en) || r.en.length !== 4 || !r.en.every(metric)) r.en = null;
  }
  d.istat.gunSayisi = Object.keys(d.gunluk).filter(k => d.gunluk[k].cozuldu).length;
  return d;
}
// Şema sürümü (v) ile oyun kuralları ayrı ilerler. Kanıtlanamayan eski skorlar silinmez; etkin tablodan arşive alınır.
function repairRules(d, previous) {
  if (!RULES || !PX.SIM) return false;
  const levels = PX.LEVELS || [], pool = levels.concat(PX.DAILY || []);
  const oldSolved = id => !!(d.seviye[id] && d.seviye[id].cozuldu);
  const access = new Set(d.erisilen.filter(id => typeof id === 'string'));
  const chapters = new Map();
  for (const lv of levels) { if (!chapters.has(lv.bolum)) chapters.set(lv.bolum, []); chapters.get(lv.bolum).push(lv); }
  let prevOpen = true;
  for (const [, list] of [...chapters.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((lv, i) => {
      if (own(d.seviye, lv.id) || (prevOpen && (i === 0 || (oldSolved(list[0].id) && (i === 1 || oldSolved(list[1].id)))))) access.add(lv.id);
    });
    prevOpen = prevOpen && (list.some(lv => (lv.sinif === 'sinav' || lv.sinif === 'usta') && oldSolved(lv.id)) || list.every(lv => oldSolved(lv.id)));
  }
  const archived = { kuralSurumu: previous, seviye: {}, gunluk: {} };
  for (const id of Object.keys(d.seviye)) {
    const r = d.seviye[id], rv = own(r, 'kuralSurumu') ? r.kuralSurumu : previous;
    if (rv === RULES) { r.kuralSurumu = RULES; continue; }
    const next = cleanLevel({ ...r, en: { ...r.en }, gecmis: r.gecmis.slice(), muhur: r.muhur.slice() });
    const lv = pool.find(x => x.id === id); let L = null;
    if (lv && rv == null) try { L = PX.SIM.compile(lv.def); } catch (e) { /* eski/bilinmeyen devre */ }
    const replayed = new Map(), proofs = [];
    const replay = str => {
      if (!L || typeof str !== 'string' || str.length > 20000) return null;
      if (!replayed.has(str)) { let p = null; try { p = PX.SIM.replay(L, str); } catch (e) { /* geçersiz defter */ } replayed.set(str, p); }
      return replayed.get(str);
    };
    let incompatible = rv != null && rv !== RULES;
    let badScores = incompatible;
    for (const m of ['h', 'm', 'k', 'o']) {
      if (!own(next.en, m)) continue;
      const v = next.en[m], p = replay(v[1]);
      if (!p || !p.ok || !p.won || p.tot[m] !== v[0]) { delete next.en[m]; incompatible = true; badScores = true; }
      else proofs.push([p.tot.h, p.tot.m, p.tot.k, p.tot.o]);
    }
    const won = proofs.length > 0;
    if ((next.cozuldu || next.muhur.length || next.talep && next.talep.length) && !won) { incompatible = true; badScores = true; }
    next.cozuldu = won;
    const hist = next.gecmis.filter(v => proofs.some(p => p.every((n, i) => n === v[i])));
    if (hist.length !== next.gecmis.length) incompatible = true;
    next.gecmis = hist;
    if (next.son) { const p = replay(next.son); if (!p || !p.ok) { next.son = null; incompatible = true; } }
    if (incompatible) {
      archived.seviye[id] = r;
      if (badScores) { next.muhur = []; next.ipuclu = false; delete next.ipucsuz; delete next.talep; }
    }
    next.kuralSurumu = RULES; d.seviye[id] = next;
  }
  for (const date of Object.keys(d.gunluk)) {
    const r = d.gunluk[date], rv = own(r, 'kuralSurumu') ? r.kuralSurumu : previous;
    if (rv === RULES) r.kuralSurumu = RULES;
    else { archived.gunluk[date] = r; delete d.gunluk[date]; }
  }
  const changed = Object.keys(archived.seviye).length || Object.keys(archived.gunluk).length;
  if (changed) { d.arsiv.push(archived); d.erisilen = [...access]; }
  d.kuralSurumu = RULES;
  d.istat.gunSayisi = Object.keys(d.gunluk).filter(k => d.gunluk[k].cozuldu).length;
  return !!changed || previous !== RULES;
}

function storageOff() { try { return /(?:^|[?&])nostorage(?:[=&]|$)/.test(location.search); } catch (e) { return false; } }
function readRaw() { try { return window.localStorage.getItem(KEY); } catch (e) { return undefined; } }
function migrate(d) {
  let v = Number.isSafeInteger(d.v) && d.v >= 0 ? d.v : 0;
  while (v < VERSION) { const f = MIGRATE[v + 1]; if (!f) break; d = f(d); v = d.v = v + 1; }
  return d;
}
function init() {
  available = false; disabledReason = ''; data = DEFAULTS();
  if (storageOff()) { disabledReason = 'nostorage'; }
  else {
    try { const k = '__px_probe'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); available = true; }
    catch (e) { disabledReason = 'erişilemiyor'; }
  }
  if (available) {
    const raw = readRaw();
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('nesne değil');
        const previous = Number.isSafeInteger(d.kuralSurumu) ? d.kuralSurumu : null;
        data = normalize(migrate(d));
        if (repairRules(data, previous)) {
          try { const bk = KEY + '.kurallar.' + (previous === null ? 'belirsiz' : previous); if (window.localStorage.getItem(bk) === null) window.localStorage.setItem(bk, raw); } catch (e) { /* arşiv etkin kaydın içinde de korunur */ }
          save();
        }
      } catch (e) {
        console.warn('[PX.store] bozuk kayıt atıldı:', e.message);
        try { window.localStorage.setItem(KEY + '.bozuk', raw); } catch (x) { /* yoksay */ }
        data = DEFAULTS(); save();
      }
    }
  }
  if (!available && PX.bus) setTimeout(() => PX.bus.emit('toast', { msg: (PX.STR && PX.STR.kayitKapali) || 'Kayıt kapalı', kind: 'info' }), 0);
  return available;
}
function save() {
  if (RULES) {
    data.kuralSurumu = RULES;
    for (const date of Object.keys(data.gunluk)) if (obj(data.gunluk[date]) && data.gunluk[date].kuralSurumu === undefined) data.gunluk[date].kuralSurumu = RULES;
  }
  if (!available) return false;
  try { window.localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch (e) { available = false; disabledReason = 'yazılamadı'; if (PX.bus) PX.bus.emit('toast', { msg: (PX.STR && PX.STR.kayitKapali) || 'Kayıt kapalı', kind: 'info' }); return false; }
}
function get(path) { let v = data; for (const p of String(path).split('.')) { if (!p || unsafe(p) || v == null || !own(v, p)) return undefined; v = v[p]; } return v; }
function set(path, val) {
  const ps = String(path).split('.'); let o = data;
  if (ps.some(p => !p || unsafe(p))) return;
  for (let i = 0; i < ps.length - 1; i++) { if (!own(o, ps[i]) || o[ps[i]] == null || typeof o[ps[i]] !== 'object') o[ps[i]] = {}; o = o[ps[i]]; }
  o[ps[ps.length - 1]] = val; save();
}
function level(id) {
  if (unsafe(String(id))) throw new Error('Geçersiz seviye kimliği');
  let r = own(data.seviye, id) ? data.seviye[id] : null;
  if (!obj(r) || !obj(r.en) || !Array.isArray(r.gecmis) || !Array.isArray(r.muhur)) r = data.seviye[id] = cleanLevel(r);
  r.kuralSurumu = RULES;
  return r;
}
function recordWin(id, tot, str, extra) {
  // ipuçlu bayrağı koşuya aittir (§5.6): ipucusuz bir çözüm bayrağı kalıcı olarak kaldırır (ipucsuz); ipuçlu bir çözüm
  // bayrağı yalnız seviye hiç ipucusuz çözülmemişse koyar. extra.ipuclu verilmezse bayrağa dokunulmaz.
  const r = level(id); r.cozuldu = true;
  if (extra && extra.ipuclu === true) r.ipuclu = !r.ipucsuz; else if (extra && extra.ipuclu === false) { r.ipuclu = false; r.ipucsuz = true; }
  const yeniEn = {};
  for (const m of ['h', 'm', 'k', 'o']) { const cur = r.en[m]; if (!cur || tot[m] < cur[0]) { r.en[m] = [tot[m], str]; yeniEn[m] = tot[m]; } }
  r.gecmis.push([tot.h, tot.m, tot.k, tot.o]); while (r.gecmis.length > 32) r.gecmis.shift();
  r.son = null; save();
  return { yeniEn };
}
function setSon(id, str) { const r = level(id); r.son = str || null; save(); }
function reset() { data = DEFAULTS(); save(); }

PX.store = {
  init, save, get, set, level, recordWin, setSon, reset, KEY, VERSION, MIGRATE,
  get available() { return available; }, get disabledReason() { return disabledReason; }, get data() { return data; },
};
