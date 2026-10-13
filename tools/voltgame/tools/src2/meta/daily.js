// ============================================================================
// meta/daily.js — PX.daily : Günün Manevrası seçimi (§5.5, §24.1 R1: 30–60 seçilmiş bulmaca)  sahip: Kurallar
// Sunucusuz ve deterministik: herkes aynı gün aynı bulmacayı alır. Gün = Europe/Istanbul yerel tarihi
// (UTC+3, yaz saati yok). Gün indeksi = (tarih − 2027-01-01) gün; seçim = havuz[indeks mod havuz boyu].
// Havuz öğesinde `tarih:'YYYY-MM-DD'` varsa o gün için sabitlenir (kürasyon). Tam arşiv; seri yok, bildirim yok,
// kaybedilecek bir şey yok — tek sayaç "N gün oynandı" (çözülen farklı günler).
//   PX.daily.today(dateStr?) -> {date, level, index, day} | null      dateStr 'YYYY-MM-DD' (yoksa bugün, İstanbul)
//   PX.daily.at(dateStr) -> aynı (today ile eş)    PX.daily.dateOf(Date|ms) -> 'YYYY-MM-DD' (İstanbul)
//   PX.daily.archive(n=30, dateStr?) -> [{date, id, ad, cozuldu, en}] (bugünden geriye, bugün dahil)
//   PX.daily.played() -> N (gün oynandı)   PX.daily.record(date, tot) -> kayıt   PX.daily.pool -> PX.DAILY
//   PX.daily.EPOCH = '2027-01-01'
// Kazanma: bu modül 'level:loaded' + 'win' olaylarını dinler; günlük bulmaca çözülünce store.gunluk[tarih] =
// {cozuldu:true, en:[h,m,k,o]} (metrik başına en iyi) ve store.istat.gunSayisi güncellenir.
// ============================================================================
const EPOCH = '2027-01-01';
const DAY = 864e5, TR_OFFSET = 3 * 36e5;
const D = { byId: new Map(), current: null, inited: false };

function pool() { return Array.isArray(PX.DAILY) ? PX.DAILY : []; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function dateOf(t) {
  const ms = t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : Date.now());
  if (!isFinite(ms)) return null;
  const d = new Date(ms + TR_OFFSET);                        // İstanbul = UTC+3 (2016'dan beri sabit)
  if (!isFinite(d.getTime())) return null;
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
function dayNum(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '')); if (!m) return null;
  const d = new Date(0); d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
  const t = d.getTime();
  if (!isFinite(t)) return null;
  const back = new Date(t); if (back.getUTCFullYear() !== +m[1] || back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) return null;   // 2027-02-30 gibi
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(EPOCH);
  return Math.round((t - Date.UTC(+e[1], +e[2] - 1, +e[3])) / DAY);
}
// pick: yan etkisiz seçim (arşiv listesi bunu kullanır; oynanan bulmacanın tarihini EZMEZ)
function pick(dateStr) {
  const p = pool(); if (!p.length) return null;
  const date = typeof dateStr === 'string' && dateStr ? dateStr : dateOf(Date.now());
  const day = dayNum(date); if (day === null) return null;
  let level = null, index = -1;
  for (let i = 0; i < p.length; i++) if (p[i] && p[i].tarih === date) { level = p[i]; index = i; break; }
  if (!level) { index = ((day % p.length) + p.length) % p.length; level = p[index]; }
  if (!level) return null;
  return { date, level, index, day };
}
// at: seçim + bu kimliğin oynanacağı tarih (controller {daily:tarih} yüklemeden hemen önce çağırır)
function at(dateStr) { const x = pick(dateStr); if (x) D.byId.set(x.level.id, x.date); return x; }
function today(dateStr) { init(); return at(dateStr); }
function rec() { try { return PX.store && PX.store.data ? PX.store.data : null; } catch (e) { return null; } }
function played() {
  const d = rec(); if (!d || !d.gunluk) return 0;
  let n = 0; for (const k of Object.keys(d.gunluk)) if (dayNum(k) !== null && d.gunluk[k] && d.gunluk[k].cozuldu === true) n++;
  return n;
}
function record(date, tot) {
  const d = rec(); if (!d || dayNum(date) === null || !tot) return null;
  const v = [tot.h, tot.m, tot.k, tot.o];
  if (!v.every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  if (!d.gunluk || typeof d.gunluk !== 'object' || Array.isArray(d.gunluk)) d.gunluk = {};
  let r = d.gunluk[date];
  if (!r || typeof r !== 'object' || Array.isArray(r)) r = d.gunluk[date] = { cozuldu: false, en: null };
  r.cozuldu = true;
  if (!Array.isArray(r.en) || r.en.length !== 4 || !r.en.every(n => Number.isSafeInteger(n) && n >= 0)) r.en = v;
  else for (let i = 0; i < 4; i++) if (v[i] < r.en[i]) r.en[i] = v[i];
  if (!d.istat || typeof d.istat !== 'object' || Array.isArray(d.istat)) d.istat = {};
  d.istat.gunSayisi = played();
  try { if (PX.store.save) PX.store.save(); } catch (e) { /* kayıt kapalı */ }
  if (PX.bus) PX.bus.emit('daily:solved', { date, tot: { h: v[0], m: v[1], k: v[2], o: v[3] }, played: d.istat.gunSayisi });
  return r;
}
function archive(n, dateStr) {
  const out = []; const p = pool(); if (!p.length) return out;
  n = Math.max(1, Math.min(366, n | 0 || 30));
  const base = dayNum(typeof dateStr === 'string' && dateStr ? dateStr : dateOf(Date.now())); if (base === null) return out;
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(EPOCH); const t0 = Date.UTC(+e[1], +e[2] - 1, +e[3]);
  const d = rec(); const g = d && d.gunluk ? d.gunluk : {};
  for (let i = 0; i < n; i++) {
    const day = base - i; const date = new Date(t0 + day * DAY).toISOString().slice(0, 10);
    const x = pick(date); if (!x) continue;
    const r = g[date];
    out.push({ date, id: x.level.id, ad: x.level.ad || '', cozuldu: !!(r && r.cozuldu), en: r && Array.isArray(r.en) ? r.en.slice() : null });
  }
  return out;
}
function init() {
  if (D.inited || !PX.bus) return; D.inited = true;
  PX.bus.on('level:loaded', p => {
    const id = p && p.id; const lv = p && p.level;
    D.current = null;
    if (!id || !D.byId.has(id)) return;
    if (lv && pool().indexOf(lv) < 0) return;                  // aynı kimlikteki paylaşılmış/özel devre günlük oturum değildir
    if (PX.LEVELS && PX.LEVELS.some(x => x === lv)) return;     // kampanya seviyesi aynı kimlikle yüklendi
    D.current = { id, date: D.byId.get(id) };
  });
  PX.bus.on('win', p => { if (D.current && p && p.id === D.current.id && p.tot) record(D.current.date, p.tot); });
}
if (PX.bus) init();
PX.daily = { today, at, dateOf, archive, played, record, EPOCH, get pool() { return pool(); }, get current() { return D.current; } };
