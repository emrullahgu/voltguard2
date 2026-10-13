'use strict';
// ============================================================================
// PARALAKS: TEK HAT — lint2.js (kural sürümü 4) : elektrik gerçekçilik, fiziksel dünya ve amaç kapıları
//  margin(L)    : K7 — erişilen her elektrik yapılandırmasında koruma cihazı akımı ile açma eşiği arasında
//                 >= 0,5 birim pay (TAM EŞİTLİK DAHİL bıçak sırtı yok); tamsayı olmayan akımda pay >= 1
//                 (oyuncu ampermetresiz yalnız tamsayı talepleri toplayarak karar verebilmeli)
//  realism(L)   : K9 — tüketici düğümü <= 34,5 kV; dizel/acil kaynak <= 6,3 kV; her kesici ve sigortada açma
//                 eşiği > 0; her kaynak -> arıza yolunda en az bir koruma cihazı; kontaktör bobini kumanda
//                 gerilim seviyesinde
//  voltage(L)   : K10 — gerilimli düğümler >= 0,9 pu
//  physical(L, Gr, golden, def) : FİZİKSEL KAPILAR (§25.6)
//      F1 yol    : her çalıştırılabilir cihazın ve iş noktasının fiziksel yolu var (merdiven/iskele dahil) — "Yol yok" asla
//      F2 erişim : her cihaz ve iş noktası en az bir erişilebilir durumda Volti'nin erişiminde
//      F3 karo   : yürünebilir görünen her karo bir erişilebilir durumda ziyaret ediliyor (ya da kalıcı yaklaşma bölgesi)
//      F4 merdiven/iskele : her biri bir altın çözümde kullanılıyor ya da kaldırılınca erişim daralıyor
//      F5 kapı   : kapı gerçekten bir bölmeyi kapatıyor ve bir erişilebilir durumda açılıyor
//      F6 tuzak  : aynı elektrik durumunda başka konumdan çözülebilirken yalnız Volti'nin konumu yüzünden çıkmaz yok
//  purpose(lv, L) : AMAÇ KAPISI (§25.7) — her cihazın işlev adı, kısa iş emri özeti, iş noktası adı, eski izdüşüm metni yok
// ============================================================================
const S = require('./sim2.js');

function margin(L) {
  let worst = Infinity, where = null;
  for (const E of L.ecache.values()) { if (E.fault) continue;
    L.edges.forEach((e, i) => {
      if (!((e.t === S.T.kesici || e.t === S.T.sigorta) && e.I > 0 && E.live[e.a])) return;
      const c = E.cur[i]; const d = Math.abs(c - e.I); const nonInt = Math.abs(c - Math.round(c)) > 1e-6;
      const need = nonInt ? 1 : 0.5; const sc = d / need;   // < 1 => ihlal
      if (sc < worst) { worst = sc; where = `${L.els[e.el].id} akım ${c.toFixed(3)} / eşik ${e.I}${nonInt ? ' (tamsayı değil)' : ''}`; }
    }); }
  return { ok: worst >= 1 - 1e-9, score: worst, where };   // 1e-9: kayan nokta (2,000000000001 akım)
}
function realism(L) {
  const bad = [];
  for (const l of L.loads) if (L.kv[l.node] > 34.5) bad.push(`tüketici ${L.els[l.el].id} ${L.kv[l.node]} kV düğümde`);
  for (const s of L.sources) { const el = L.els[s.el]; if ((s.acil || /dizel/i.test(el.ad || '')) && L.kv[s.node] > 6.3) bad.push(`acil/dizel kaynak ${el.id} ${L.kv[s.node]} kV`); }
  for (const e of L.edges) if ((e.t === S.T.kesici || e.t === S.T.sigorta) && !(e.I > 0)) bad.push(`${L.els[e.el].id} açma eşiği yok`);
  for (const c of L.contactors) if (L.kv[c.coil] > 0.4) bad.push(`${L.els[c.el].id} bobini ${L.kv[c.coil]} kV`);
  if (L.faults.length) {
    const n = L.nN; const adj = Array.from({ length: n }, () => []);
    for (const e of L.edges) { if ((e.t === S.T.kesici || e.t === S.T.sigorta) && e.I > 0) continue; adj[e.a].push(e.b); adj[e.b].push(e.a); }
    const seen = new Uint8Array(n); const st = L.sources.map(x => x.node); st.forEach(x => seen[x] = 1);
    while (st.length) { const x = st.pop(); for (const y of adj[x]) if (!seen[y]) { seen[y] = 1; st.push(y); } }
    for (const f of L.faults) if (seen[f.node]) bad.push(`arıza ${L.els[f.el].id}: korumasız kaynak yolu`);
  }
  return { ok: !bad.length, bad };
}
// K10 gerilim tutarlılığı: koruma açması/kilitleme arızası olmayan her erişilen yapılandırmada gerilimli düğümlerin
// DC eşdeğer gerilimi >= vmin pu (sabit akımlı yük modelinin fiziksel aralıkta kaldığının kanıtı; HUD yalnız akım gösterir)
function voltage(L, vmin) {
  vmin = vmin === undefined ? 0.9 : vmin; let worst = Infinity, where = null;
  for (const E of L.ecache.values()) { if (E.fault || E.over.length || E.faultLive) continue;
    for (let i = 0; i < L.nN; i++) if (E.live[i] && E.V[i] < worst) { worst = E.V[i]; where = L.nodeNames[i]; } }
  return { ok: worst >= vmin, worst, where };
}

// ---------------------------------------------------------------------------
// FİZİKSEL KAPILAR (kural sürümü 4)
// ---------------------------------------------------------------------------
const OPS = { kesici: 1, ayirici: 1, yuk_ayirici: 1, toprak: 1, sigorta: 1, buton: 1 };
const at3 = (L, c) => { const [x, y, z] = L.G.xyz(c); return `(x${x} y${y} z${z})`; };
// golden: altın çözüm dizgileri (merdiven kullanımı için); def: seviye tanımı (merdiven kaldırma denemesi için)
function physical(L, Gr, golden, def) {
  const V = require('./solve2.js');
  const bad = [], notes = []; const nT = L.tiles.length;
  const visited = new Uint8Array(nT); const cfg = new Map();
  for (let i = 0; i < Gr.n; i++) { const s = S.unkey(L, Gr.keys[i]); visited[L.tileIdx[s.p]] = 1; const ek = S.elecKey(L, s); if (!cfg.has(ek)) cfg.set(ek, s); }
  const opsEls = L.els.filter(e => e.cell >= 0 && (OPS[e.t] || (e.t === 'bara' && L.nSet)));
  for (const e of opsEls) {
    const ap = L.approach[e.i];
    if (!ap.length) { bad.push(`F1 ${e.id}: yaklaşma karosu yok (cihazın yanında aynı yükseklikte karo yok)`); continue; }
    if (!ap.some(c => L.phys[L.tileIdx[c]])) { bad.push(`F1 ${e.id}: Yol yok — yaklaşma karosuna merdiven/iskele gerekiyor`); continue; }
    if (!ap.some(c => visited[L.tileIdx[c]])) bad.push(`F2 ${e.id}: hiçbir erişilebilir durumda Volti yanına gidemiyor`);
  }
  for (const e of L.els) if (e.cell < 0 && (OPS[e.t] || e.t === 'kapi')) bad.push(`F1 ${e.id}: sahaya yerleşmemiş (haritada hücresi yok)`);
  if (L.work >= 0) { const ti = L.tileIdx[L.work]; if (!L.phys[ti]) bad.push('F1 iş noktası: Yol yok — merdiven/iskele gerekiyor'); else if (!visited[ti]) bad.push('F2 iş noktası hiçbir erişilebilir durumda ziyaret edilmiyor'); }
  // F3: karo
  let zoneOnly = 0;
  for (let ti = 0; ti < nT; ti++) { if (visited[ti]) continue; const c = L.tiles[ti];
    if (!L.phys[ti]) { bad.push(`F3 karo ${at3(L, c)} yürünebilir görünüyor ama hiçbir yoldan erişilemez (merdiven yok / kapalı bölme) — blok ekleyin, duvar (%) yapın ya da ulaştırın`); continue; }
    let ever = false; const doorOnly = L.hazards[ti].length === 0;
    for (const s of cfg.values()) { const pm = S.passMap(L, S.stateE(L, s), s.b, s.st, s.ch, s.lk); if (pm[ti]) { ever = true; break; } }
    if (ever) bad.push(`F3 karo ${at3(L, c)} hiçbir erişilebilir durumda ziyaret edilmiyor (çevresi hep kapalı)`);
    else if (doorOnly) bad.push(`F3 karo ${at3(L, c)}: kapısı hiç açılmıyor`);
    else zoneOnly++;
  }
  if (zoneOnly) notes.push(`${zoneOnly} karo kalıcı yaklaşma bölgesinde (hep gerilimli iletken yanında; taralı zemin)`);
  // F4: merdiven/iskele kullanımı (altın çözümlerin deterministik en kısa yolları)
  const used = new Set();
  for (const str of golden || []) { if (!str) continue; let s = S.initState(L);
    for (const t of str.split(/\s+/).filter(Boolean)) { const a = S.decodeAct(L, s, t); if (!a) break;
      if (a.t === 'git') { const p = S.walkPath(L, s, a.to); if (p) for (const st of p) if (st.k !== 'karo') used.add(st.c); }
      const r = S.apply(L, s, a); if (r.err) break; s = r.s; } }
  const R0 = new Set(); for (let ti = 0; ti < nT; ti++) if (L.phys[ti]) R0.add(L.tiles[ti]);
  const structs = L.stairs.map(x => ({ ad: 'merdiven', cells: [x.cell] })).concat(L.ladders.map(x => ({ ad: 'iskele', cells: x.cells })));
  let nUsed = 0;
  for (const st of structs) {
    if (st.cells.some(c => used.has(c))) { nUsed++; continue; }
    let L2; try { L2 = S.compile(def, Object.assign({}, L.opt, { drop: st.cells })); } catch (e) { notes.push(`${st.ad} ${at3(L, st.cells[0])}: kaldırılamıyor (${String(e.message).slice(0, 60)})`); continue; }
    const R2 = new Set(); for (let ti = 0; ti < L2.tiles.length; ti++) if (L2.phys[ti]) R2.add(L2.tiles[ti]);
    let lost = 0; for (const c of R0) if (!R2.has(c)) lost++;
    if (!lost) bad.push(`F4 ${st.ad} ${at3(L, st.cells[0])} gereksiz: hiçbir altın çözüm kullanmıyor ve kaldırılınca erişim değişmiyor — kaldırın`);
    else notes.push(`${st.ad} ${at3(L, st.cells[0])}: altın çözümde yok ama ${lost} karoya tek erişim`);
  }
  // F5: kapılar
  for (let di = 0; di < L.doors.length; di++) { const d = L.doors[di]; const id = L.els[d.el].id;
    if (!d.nInner) bad.push(`F5 kapı ${id} işlevsiz: etrafından dolaşılabiliyor (kapı bir bölmeyi kapatmalı)`);
    let open = false; for (const s of cfg.values()) if (S.doorOpen(L, s.b, s.lk, di)) { open = true; break; }
    if (!open) bad.push(`F5 kapı ${id} hiçbir erişilebilir durumda açılmıyor`); }
  // F6: fiziksel tuzak
  const tg = V.toGoal(Gr); const alive = new Set(); for (let i = 0; i < Gr.n; i++) if (tg.dist[i] >= 0) alive.add(S.elecKey(L, S.unkey(L, Gr.keys[i])));
  let traps = 0, ex = null;
  for (let i = 0; i < Gr.n; i++) if (tg.dist[i] < 0) { const s = S.unkey(L, Gr.keys[i]); if (alive.has(S.elecKey(L, s))) { traps++; if (!ex) ex = s; } }
  if (traps) bad.push(`F6 fiziksel tuzak: ${traps} durumda Volti'nin konumu seviyeyi çözümsüz yapıyor (örn. ${at3(L, ex.p)}); aynı elektrik durumunda başka konumdan çözülebilir`);
  return { ok: !bad.length, bad, notes, info: { karo: nT, ziyaret: visited.reduce((a, b) => a + b, 0), merdiven: L.stairs.length, iskele: L.ladders.length, kapi: L.doors.length, kullanilan: nUsed, cihaz: opsEls.length, bolgeKalici: zoneOnly } };
}

// ---------------------------------------------------------------------------
// AMAÇ KAPISI: oyuncu her an NE ve NEDEN yapacağını bilir (§25.7)
// ---------------------------------------------------------------------------
const OLD_WORDS = /izdüşüm|seçici kafa|seçici küme|seçicileri|dikiş|görünümde|görünümü|döndür|kamera/i;
function purpose(lv, L) {
  const bad = [];
  for (const e of lv.def.el || []) if (e.t !== 'kablo' && e.t !== 'yardimci' && !(e.ad && String(e.ad).trim())) bad.push(`A1 ${e.id}: gerçek işlev adı (ad) yok — oyuncu yalnız kod görür`);
  const ie = lv.isEmri;
  if (lv.bolum !== undefined && lv.bolum >= 0 && lv.bolum <= 3 && lv.r1 !== false) {
    if (!ie || !ie.ozet) bad.push('A2 isEmri.ozet yok: seviye kısa bir iş emri cümlesiyle açılmalı');
    else if (ie.ozet.length > 160) bad.push(`A2 isEmri.ozet ${ie.ozet.length} karakter (> 160): kısa ve düz mühendislik Türkçesi`);
  }
  if (L.work >= 0 && !((lv.def.is || {}).ad)) bad.push('A3 def.is.ad yok: iş noktası etiketi (ne yapılacak) yazılmalı');
  const texts = []; const push = (k, v) => { if (typeof v === 'string') texts.push([k, v]); };
  if (ie) for (const k of Object.keys(ie)) push('isEmri.' + k, ie[k]);
  push('telsiz', lv.telsiz); if (lv.kural) { push('kural.baslik', lv.kural.baslik); push('kural.metin', lv.kural.metin); }
  for (const t of lv.talep || []) { push('talep.ad', t.ad); push('talep.aciklama', t.aciklama); }
  for (const e of lv.def.el || []) push(e.id + '.ad', e.ad);
  push('ogretir', lv.ogretir);
  for (const [k, v] of texts) if (OLD_WORDS.test(v)) bad.push(`A4 ${k}: fiziksel dünyada anlamsız eski izdüşüm/kamera metni ("${v.match(OLD_WORDS)[0]}")`);
  return bad;
}
module.exports = { margin, realism, voltage, physical, purpose };
