'use strict';
// ============================================================================
// PARALAKS: TEK HAT — UI / metin regresyon paketleri (tam oyun incelemesi, ui-strings + test-harness bulguları).
// suites2.js bunları 'ui' ve 'daily' adlarıyla kaydeder:  node tools/test/run.js ui | daily
//   ui     HUD dokunuşu fling sonrası yutulmuyor (CPU 1×/4×), bildirim "İzdüşümü uygula"nın üstüne binmiyor, çip
//          önizlemesi kesilmiyor, Tek Hat okunurluğu / dokunma alanları / yazı çakışması / sözcük bölme, şerit
//          etiketleri (ayırt edici, "…"lı, kompanzasyon etiketi tam), açılış yatayda kesilmiyor, solak düzeni,
//          seviye adı, güvenli alanlar, Seviye Seç açılışı, "Sonraki" (kilit + iş emri kartı), günlük çözüm başlığı,
//          ipuçlu bayrağı, talep değerleri, defter/çip Türkçesi
//   daily  37 Günün Manevrası altın dizgisinin (cozum, cozumManevra, cozumKesinti) sayfa içinde yeniden oynatılması
// Her denetim satırı: [PASS|FAIL] ad — ölçüm. Sayfalar ?debug (ya da harness bayrağı) ile açılır; profil her
// tarayıcıda yenidir (temiz kayıt).
// ============================================================================
const path = require('path');

module.exports = function regressUi(ctx) {
  const { GAME, OUT, cdp, makeResult, flush, withPage, fmtLogs, table } = ctx;
  const { sleep } = cdp;
  const PHONE = { width: 375, height: 667, mobile: true, touch: true, dpr: 2 };
  const P360 = { width: 360, height: 640, mobile: true, touch: true, dpr: 2 };
  const LAND = { width: 667, height: 375, mobile: true, touch: true, dpr: 2 };
  const DESK = { width: 1280, height: 800, mobile: false, touch: false, dpr: 1 };
  const READY = 'window.Game && window.Game.ready === true';
  const INIT = `(() => { window.__PX_TEST__ = true; })();`;

  async function open(page, params) {
    if (!page.__pxInit) { await page.addInitScript(INIT); page.__pxInit = true; }
    await page.goto(GAME, params === undefined ? { debug: true } : params);
    await page.waitFor(READY, 30000, 50);
  }
  const idle = (page, ms = 30000) => page.evaluate(`Game.idle(${ms})`, ms + 5000);
  async function load(page, id) { await page.evaluate(`Game.load(${JSON.stringify(id)})`); await idle(page); await page.frames(2); }
  const J = JSON.stringify;
  const check = (r, ok, name, detail) => { (ok ? r.info : r.fail)(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); return ok; };
  const rect = (page, sel) => page.evaluate(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height,r:b.right,b:b.bottom,cx:b.left+b.width/2,cy:b.top+b.height/2}})()`);
  const golden = (page, id) => page.evaluate(`(()=>{const l=PX.LEVELS.find(x=>x.id===${J(id)}); return l&&l.kanit?l.kanit.cozum:null})()`);
  async function solve(page, id) { await load(page, id); const g = await golden(page, id); const r = await page.evaluate(`Game.replay(${J(g)}, {instant:true})`, 120000); await idle(page); return r; }
  // sayfa içinde: komut sayacı (PX.game.command sarmalanır; HUD kapanışı çağrı anında PX.game.command'ı okur)
  const COUNT = `(()=>{ if (window.__cmdN) return; window.__cmdN={}; const o=PX.game.command; PX.game.command=function(c){ const t=c&&c.t; __cmdN[t]=(__cmdN[t]||0)+1; return o.apply(this, arguments); }; })()`;

  // ------------------------------------------------------------------ 1) fling sonrası HUD dokunuşu
  async function flingTaps(r) {
    await withPage(PHONE, async page => {
      await open(page, { debug: true, lvl: 'P2' }); await idle(page); await page.evaluate(COUNT);
      const g = await rect(page, 'canvas#game-canvas');
      const rows = [];
      for (const cpu of [1, 4]) {
        await page.setCPUThrottle(cpu);
        for (const kind of ['fast', 'vertical']) for (const gap of [50, 150]) {
          let drop = 0, dbl = 0; const N = 3;
          for (let i = 0; i < N; i++) {
            await load(page, 'P2'); await sleep(200);
            const b = await rect(page, '[data-testid=btn-undo]');
            await page.evaluate('__cmdN.undo=0');
            const cx = g.x + g.w / 2, cy = g.y + g.h * 0.3;
            if (kind === 'fast') await page.swipe(cx - 30, cy, cx + 30, cy, { durationMs: 100 });
            else await page.swipe(cx, cy + 60, cx, cy - 60, { durationMs: 150 });
            await sleep(gap); await page.tap(b.cx, b.cy, 50); await sleep(450);
            const n = await page.evaluate('__cmdN.undo|0'); if (n === 0) drop++; if (n > 1) dbl++;
          }
          rows.push({ cpu, kind, gap, dropped: drop + '/' + N, doubled: dbl });
          check(r, drop === 0 && dbl === 0, `fling→Geri Al cpu${cpu} ${kind} +${gap}ms`, `kayıp ${drop}/${N}, çift ${dbl}`);
        }
      }
      await page.setCPUThrottle(1);
      // klavye/programatik click yolu hâlâ tek komut
      await page.evaluate('__cmdN.undo=0; document.getElementById("btn-undo").click()');
      check(r, (await page.evaluate('__cmdN.undo|0')) === 1, 'programatik click = 1 komut');
      // düğme sayfa açınca hayalet tık sayfayı kapatmıyor (Defter)
      const d = await rect(page, '[data-testid=btn-defter]'); await page.tap(d.cx, d.cy, 50); await sleep(500);
      check(r, (await page.evaluate('PX.cards.top()')) === 1, 'Defter dokunuşu sayfayı açık bırakır (hayalet tık yok)');
      await page.evaluate('PX.cards.closeAll()');
      for (const l of table(rows, ['cpu', 'kind', 'gap', 'dropped', 'doubled'])) r.info(l);
    }, 300000, 'fling').catch(e => r.fail('fling harness: ' + e.message));
    await withPage(DESK, async page => {
      await open(page, { debug: true, lvl: 'P2' }); await idle(page); await page.evaluate(COUNT);
      const b = await rect(page, '[data-testid=btn-undo]'); await page.evaluate('__cmdN.undo=0');
      await page.tap(b.cx, b.cy, 40); await sleep(300);
      check(r, (await page.evaluate('__cmdN.undo|0')) === 1, 'fare tıklaması = 1 komut (pointerup + click tekilleştirilir)');
    }, 120000, 'mouse').catch(e => r.fail('mouse harness: ' + e.message));
  }

  // ------------------------------------------------------------------ 2) telefon düzeni (375×667)
  async function phone(r) {
    await withPage(PHONE, async page => {
      await open(page, { debug: true, lvl: 'P1' }); await idle(page);
      // kural sürümü 4: "İzdüşümü uygula" düğmesi yok; bildirim İŞ LİSTESİ düğmesinin üstüne binmez
      const noIzd = await page.evaluate('!document.getElementById("btn-izdusum")');
      check(r, noIzd, '"İzdüşümü uygula" düğmesi yok');
      await load(page, (await page.evaluate('PX.LEVELS.map(l=>l.id)')).indexOf('M1') >= 0 ? 'M1' : 'P1');
      const tvis = await page.evaluate('!document.getElementById("task").hidden');
      if (check(r, tvis, 'iş listesi görünür')) {
        await page.evaluate(`PX.cards.toast(PX.STR.ERR.yon_yok,'err',{why:'yon_yok'})`);
        await sleep(350);
        const b = await rect(page, '#task-btn'); const t = await rect(page, '#toast');
        const hits = await page.evaluate(`[[${b.cx},${b.cy}],[${b.x + b.w * 0.8},${b.cy}],[${b.x + 8},${b.y + 8}],[${b.r - 8},${b.b - 8}]].map(([x,y])=>{const e=document.elementFromPoint(x,y); return !!(e&&e.closest('#task-btn'))})`);
        check(r, hits.every(Boolean), 'iş listesi düğmesinin her noktası düğmeye gider (bildirim açıkken)', J(hits) + ' toast ' + J(t && [t.y | 0, t.b | 0]) + ' btn ' + J([b.y | 0, b.b | 0]));
        check(r, t && t.y >= b.b - 0.5, 'bildirim iş listesinin altında', `toast.top ${t && t.y.toFixed(1)} ≥ btn.bottom ${b.b.toFixed(1)}`);
        const e0 = await page.evaluate('document.getElementById("task-btn").getAttribute("aria-expanded")');
        await page.tap(b.cx, b.cy, 50); await sleep(300);
        const e1 = await page.evaluate('document.getElementById("task-btn").getAttribute("aria-expanded")');
        check(r, e0 !== e1 && (await page.evaluate('PX.cards.top()')) === 0, 'bildirim açıkken iş listesi dokunuşu listeyi açar/kapatır, Neden? açılmaz', e0 + ' -> ' + e1);
        await page.evaluate('PX.cards.closeAll(); PX.cards.hideToast()');
      }
      // çip önizlemesi kesilmez ("düşer:" listesi uzun olan bir kesici). Kural sürümü 4: cihaza dokunmak Volti'yi yaklaşma
      // karosuna yürütür; varınca çipler çıkar. En çok düşen yükü olan erişilebilir cihaz aranır (F7 öncelikli).
      const chipLv = (await page.evaluate("!!PX.LEVELS.find(l=>l.id==='F7')")) ? 'F7' : 'P1';
      await load(page, chipLv);
      const chipEl = await page.evaluate("(()=>{ const L=Game.L(), s=PX.game.state().s; let best=null, bn=-1; for (let e=0;e<L.els.length;e++){ const el=L.els[e]; if(el.t!=='kesici'||el.cell<0||PX.SIM.approachTile(L,s,e)<0) continue; const t=PX.SIM.approachTile(L,s,e); const s2=Object.assign({},s,{p:t}); const r=PX.SIM.apply(L,s2,{t:'op',e}); if(r.err) continue; const E0=PX.SIM.stateE(L,s2), E1=PX.SIM.stateE(L,r.s); let n=0; L.loads.forEach((l,i)=>{ if(((E0.loadMask>>i)&1)&&!((E1.loadMask>>i)&1)) n++; }); if(n>bn){bn=n;best=el.id;} } return best; })()");
      r.info('çip önizlemesi: ' + chipLv + ' ' + chipEl);
      await page.evaluate(`Game.cmd({t:'tap', cell: Game.L().els[Game.L().elIndex[${J(chipEl)}]].cell})`); await idle(page); await page.frames(2);
      try { await page.waitFor(`document.querySelectorAll('[data-testid=chip]').length>0`, 5000, 50); } catch (e) { /* aşağıda raporlanır */ }
      const chips = await page.evaluate(`[...document.querySelectorAll('[data-testid=chip] .c2')].map(c=>({t:c.textContent, sw:c.scrollWidth, cw:c.clientWidth, sh:c.scrollHeight, ch:c.clientHeight}))`);
      const dus = chips.filter(c => /düşer/.test(c.t));
      check(r, dus.length > 0, chipLv + ' ' + chipEl + ' çipinde "düşer:" önizlemesi var', J(chips.map(c => c.t)).slice(0, 160));
      check(r, chips.every(c => c.sw <= c.cw + 1 && c.sh <= c.ch + 1), 'çip önizlemesi kesilmeden sığar', J(chips.map(c => [c.sw, c.cw, c.sh, c.ch])));
      // çip etiketi: sabit topraklama ayırıcısı "Kapat (toprakla)" / "Aç (…)"; takım "Topraklama takımını tak"
      const lab = [];
      for (const id of ['M1', 'F7']) {
        await load(page, id);
        lab.push(...await page.evaluate(`(()=>{ const L=PX.game.L, out=[]; L.els.forEach((e,i)=>{ if(e.t==='toprak') out.push([${J(id)},e.id,PX.hud.chipLabel({label:'Topraklama takımını tak',a:{t:'op',e:i}}), PX.hud.chipLabel({label:e.id+' · Topraklama takımını sök',a:{t:'op',e:i}})]); }); return out; })()`));
      }
      check(r, lab.length > 0 && lab.every(x => !/takım/.test(x[2]) && !/takım/.test(x[3]) && /^(Kapat|Aç) /.test(x[2])), 'sabit topraklama ayırıcısı çipi "Kapat (toprakla)/Aç" der, takım ifadesi kullanmaz', J(lab.slice(0, 3)));
      // şerit: F4/F7 yük etiketleri ayırt edilir; kompanzasyon etiketi tam
      for (const id of ['F4', 'F7', 'F5']) {
        await load(page, id);
        const st = await page.evaluate(STRIP);
        const names = st.ld.map(x => x.t);
        check(r, new Set(names).size === names.length, `${id} şerit yük etiketleri ayırt edilir`, J(names));
        check(r, st.clip.length === 0, `${id} şerit etiketleri ya sığar ya "…" ile kısalır (kesik yok)`, J(st.clip));
        if (st.rk) check(r, st.rk.full, `${id} kompanzasyon etiketi tam görünür`, J(st.rk));
        check(r, st.keep.every(x => x.full), `${id} iş bölgesi durumu ve kompanzasyon etiketi kısaltılmaz`, J(st.keep));
      }
      const keepBad = [];
      for (const id of await page.evaluate('PX.LEVELS.map(l=>l.id)')) { await load(page, id); const st = await page.evaluate(STRIP); if (st.clip.length || !st.keep.every(x => x.full)) keepBad.push(id + ':' + J(st.clip.concat(st.keep.filter(x => !x.full))).slice(0, 90)); }
      check(r, !keepBad.length, '375×667 şerit (27 seviye): kesik yok, iş bölgesi durumu/kompanzasyon tam', keepBad.join(' | ') || 'yok');
      // Tek Hat okunurluğu (açık panel) + dokunma alanı çakışması
      await sldSweep(page, r, 'p375');
      // seviye adı tam (lamba "Geri Al?" açıkken, 360'ta aşağıda)
      await page.screenshot(path.join(OUT, 'v2-ui-375.png')).catch(() => {});
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 600000, 'phone').catch(e => r.fail('phone harness: ' + e.message));
  }
  // şerit ölçümü (sayfa içi)
  const STRIP = `(()=>{ const box=document.getElementById('sld-sum').getBoundingClientRect(); const out={ld:[],clip:[],rk:null,keep:[]};
    for (const e of document.querySelectorAll('#sld-sum .ld, #sld-sum .tag')) { const b=e.getBoundingClientRect(); const cs=getComputedStyle(e);
      const over=e.scrollWidth>e.clientWidth+1; const outside=b.right>box.right+0.5||b.left<box.left-0.5||b.bottom>box.bottom+0.5;
      if (e.classList.contains('ld')) out.ld.push({t:e.textContent.trim(), over});
      if (outside || (over && cs.textOverflow!=='ellipsis')) out.clip.push({t:e.textContent.trim().slice(0,30), outside, over, to:cs.textOverflow});
      if (e.classList.contains('rk')) out.rk={t:e.textContent, full:!over&&!outside};
      if (e.classList.contains('rk')||e.classList.contains('zs')) out.keep.push({t:e.textContent, full:!over&&!outside}); }
    return out; })()`;
  async function sldSweep(page, r, tag) {
    await page.evaluate('PX.sld.open(true)'); await page.frames(3);
    const rows = []; const ids = await page.evaluate('PX.LEVELS.map(l=>l.id)');
    for (const id of ids) {
      await load(page, id); await page.evaluate('PX.sld.open(true)'); await page.frames(2);
      const m = await page.evaluate(SLDM);
      rows.push({ id, k: m.k, minPx: m.minPx, minHit: m.minHit, overl: m.overl.length });
    }
    const coarse = await page.evaluate(`matchMedia('(pointer: coarse)').matches`);
    const minPx = Math.min(...rows.map(x => x.minPx));
    if (coarse) check(r, minPx >= 8, `${tag} Tek Hat en küçük yazı ≥ 8 CSS px (tüm seviyeler)`, 'min ' + minPx.toFixed(2) + ' px');
    const ov = rows.filter(x => x.overl);
    check(r, !ov.length, `${tag} Tek Hat dokunma alanları çakışmaz`, ov.map(x => x.id + ':' + x.overl).join(' ') || 'yok');
    // sığdır düğmesi: tamamını gösterir, geri alınır
    await load(page, 'F7'); await page.evaluate('PX.sld.open(true)'); await page.frames(2);
    const z = await page.evaluate(`(()=>{ const b=document.getElementById('sld-zoom'); if(!b||b.hidden) return {shown:false}; const k0=PX.sld.scale; b.click(); const k1=PX.sld.scale; const sc=document.getElementById('sld-scroll'); const svg=document.getElementById('sld-svg');
        const fits=svg.getBoundingClientRect().width<=sc.clientWidth+1 && svg.getBoundingClientRect().height<=sc.clientHeight+1; b.click(); return {shown:true,k0,k1,fits,k2:PX.sld.scale}; })()`);
    if (coarse) check(r, z.shown && z.k1 < z.k0 && z.fits && Math.abs(z.k2 - z.k0) < 1e-6, `${tag} "sığdır" düğmesi şemanın tamamını gösterir ve geri döner`, J(z));
    await page.evaluate('PX.sld.open(false)');
    return rows;
  }
  const SLDM = `(()=>{ const svg=document.getElementById('sld-svg'); let minPx=99; const ctm=svg.getScreenCTM(); const k=ctm?ctm.a:1;
    for (const t of svg.querySelectorAll('text')) { if(!t.textContent.trim()) continue; const fs=parseFloat(getComputedStyle(t).fontSize)*k; if (fs<minPx) minPx=fs; }
    const hits=[...svg.querySelectorAll('.el rect.hit')].map(h=>{const b=h.getBoundingClientRect(); return {id:h.parentNode.getAttribute('data-el'), x:b.left,y:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}});
    const overl=[]; for(let i=0;i<hits.length;i++) for(let j=i+1;j<hits.length;j++){ const a=hits[i],c=hits[j]; const w=Math.min(a.r,c.r)-Math.max(a.x,c.x), h=Math.min(a.b,c.b)-Math.max(a.y,c.y); if(w>0.5&&h>0.5) overl.push(a.id+'/'+c.id); }
    const minHit=hits.length?Math.min(...hits.map(h=>Math.min(h.w,h.h))):0;
    return {k:+k.toFixed(3), minPx:+minPx.toFixed(2), minHit:+minHit.toFixed(1), overl}; })()`;

  // ------------------------------------------------------------------ 3) masaüstü: SLD yazı çakışması, sözcük bölme, Türkçe
  async function desktop(r) {
    await withPage(DESK, async page => {
      await open(page, { debug: true, lvl: 'P1' }); await idle(page);
      // sözcük ortasından bölme yok (bütün seviye ve günlük kaynak/yük adları)
      const w = await page.evaluate(`(()=>{ const bad=[]; const names=new Set(); for (const lv of PX.LEVELS.concat(PX.DAILY||[])) for (const e of (lv.def&&lv.def.el)||[]) if (e.ad) names.add(e.ad);
          for (const n of names) { const words=n.split(/\\s+/); const ls=PX.sld.wrapWords(n,12,3);
            for (const l of ls) { const core=l.replace(/…$/,''); const lw=core.split(/\\s+/).filter(Boolean); const ell=/…$/.test(l);
              const ok=lw.every((x,i)=> words.includes(x) || (ell && i===lw.length-1 && words.some(wd=>wd.startsWith(x)))); if(!ok || l.length>12) bad.push([n,ls]); } } return {n:names.size, bad:bad.slice(0,8)}; })()`);
      check(r, w.bad.length === 0, `Tek Hat alt yazıları sözcük ortasından bölünmez (${w.n} ad)`, J(w.bad));
      const ex4 = await page.evaluate(`['Depo aydınlatması','Pompa istasyonu trafosu AG','Dizel jeneratör (senkron rölesi yok)'].map(s=>PX.sld.wrapWords(s,12,3))`);
      r.info('  örnek: ' + J(ex4));
      // yazı çakışması: farklı cihazların yazıları üst üste binmez (tüm seviyeler)
      const ids = await page.evaluate('PX.LEVELS.map(l=>l.id)'); const bad = [];
      await page.evaluate('PX.sld.open(true)');
      for (const id of ids) {
        await load(page, id); await page.frames(2);
        const o = await page.evaluate(TEXTOV);
        if (o.length) bad.push(id + ': ' + o.slice(0, 3).join(', '));
      }
      check(r, !bad.length, 'Tek Hat: farklı cihazların yazıları çakışmaz (1280×800, 27 seviye)', bad.join(' | ') || 'yok');
      // dokunma alanları masaüstünde de çakışmaz
      const ov = [];
      for (const id of ['F7', 'T2', 'T6', 'F3']) { await load(page, id); await page.frames(2); const m = await page.evaluate(SLDM); if (m.overl.length) ov.push(id + ':' + m.overl.join(',')); }
      check(r, !ov.length, 'masaüstü Tek Hat dokunma alanları çakışmaz', ov.join(' ') || 'yok');
      // Türkçe: defter ve ipucu satırları
      const tr = await page.evaluate(`[PX.trLine("İzdüşüm seçicileri görünüm 2'e çevrildi (önce-kapa-sonra-aç)"), PX.trLine("İzdüşüm seçimi görünüm 4'e alındı (bağlantı değişmedi)"),
          PX.trLine("Q81 (Bara topraklama ayırıcısı) topraklama ayırıcısı AÇILDI"), PX.trLine("Q01 (Ana kesici) AÇILDI")]`);
      check(r, /görünüm 2'ye çevrildi/.test(tr[0]) && /4'e alındı/.test(tr[1]) && tr[2] === 'Q81 (Bara topraklama ayırıcısı) AÇILDI' && tr[3] === 'Q01 (Ana kesici) AÇILDI', 'Türkçe ek ve tekrar düzeltmesi', J(tr));
      // gerçek defter: her seviyenin altın çözümü
      const dbad = [];
      for (const id of ids) {
        await solve(page, id);
        const lines = await page.evaluate(`(()=>{ PX.screens.defter(); const ls=[...document.querySelectorAll('.sheet .log li')].map(l=>l.textContent); PX.cards.closeAll(); return ls; })()`);
        for (const l of lines) if (/[0-9]'e (çevrildi|alındı)/.test(l) && /2'e|6'e|7'e|9'e|0'e/.test(l) || /topraklama ayırıcısı\) topraklama ayırıcısı/.test(l)) dbad.push(id + ': ' + l);
      }
      check(r, !dbad.length, 'Manevra Defteri satırları (27 altın çözüm) Türkçe ek/tekrar hatası içermez', dbad.slice(0, 4).join(' | ') || 'yok');
      await page.screenshot(path.join(OUT, 'v2-ui-1280.png')).catch(() => {});
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 900000, 'desktop').catch(e => r.fail('desktop harness: ' + e.message));
  }
  // farklı .el gruplarına (ya da düğüm etiketlerine) ait SVG yazılarının sınır kutusu çakışması (> 1 px her iki eksende)
  const TEXTOV = `(()=>{ const svg=document.getElementById('sld-svg'); const T=[...svg.querySelectorAll('text')].filter(t=>t.textContent.trim()&&getComputedStyle(t).display!=='none');
    const own=t=>{ const g=t.closest('.el'); return g?g.getAttribute('data-el'):'n:'+t.textContent; };
    const B=T.map(t=>{const b=t.getBoundingClientRect(); return {o:own(t), s:t.textContent, x:b.left,y:b.top,r:b.right,b:b.bottom}});
    const out=[]; for(let i=0;i<B.length;i++) for(let j=i+1;j<B.length;j++){ const a=B[i],c=B[j]; if(a.o===c.o) continue; const w=Math.min(a.r,c.r)-Math.max(a.x,c.x), h=Math.min(a.b,c.b)-Math.max(a.y,c.y); if(w>1&&h>1) out.push(a.s+'|'+c.s+' '+w.toFixed(1)+'x'+h.toFixed(1)); }
    return out; })()`;

  // ------------------------------------------------------------------ 4) yatay telefon + 360 + solak + güvenli alan
  async function landscape(r) {
    await withPage(LAND, async page => {
      await open(page, { debug: true }); await sleep(600);
      const t = await page.evaluate(`(()=>{ const s=document.getElementById('scr-title'); s.scrollTop=0; const b=document.querySelector('#scr-title .logo .brand').getBoundingClientRect(); const h=document.querySelector('#scr-title h1').getBoundingClientRect();
          s.scrollTop=1e5; const last=s.lastElementChild.getBoundingClientRect(); const res={brandTop:b.top, h1Top:h.top, lastBottom:last.bottom, ch:s.clientHeight}; s.scrollTop=0; return res; })()`);
      check(r, t.brandTop >= 0 && t.h1Top >= 0 && t.lastBottom <= t.ch + 1, 'açılış 667×375: logo üstte kesilmez, alt not kaydırılarak görünür', J(t));
      // Seviye Seç: temiz kayıtta Günün Manevrası kartı görünür, başlık opak
      await page.evaluate(`PX.screens.show('levels')`); await sleep(500);
      const lv = await page.evaluate(`(()=>{ const hd=document.querySelector('.lv-head').getBoundingClientRect(); const d=document.querySelector('.daily-card button'); const b=d?d.getBoundingClientRect():null; const cs=getComputedStyle(document.querySelector('.lv-head'));
          return {head:hd.bottom, btnTop:b&&b.top, scroll:document.getElementById('scr-levels').scrollTop, bg:cs.backgroundColor, img:cs.backgroundImage}; })()`);
      check(r, lv.btnTop !== null && lv.btnTop >= lv.head - 0.5 && lv.scroll === 0, 'Seviye Seç (temiz kayıt, yatay): "Günün Manevrası" Başla görünür', J(lv));
      check(r, /rgb\(\d+, \d+, \d+\)$/.test(lv.bg) && lv.img === 'none', 'Seviye Seç başlığı opak (altındaki yazı görünmez)', lv.bg + ' ' + lv.img);
      // seviye adı yatayda kesilmez; şerit etiketleri kesilmez; kompanzasyon etiketi tam
      const ids = await page.evaluate('PX.LEVELS.map(l=>l.id)'); const cut = []; const clip = [];
      for (const id of ids) {
        await load(page, id);
        const n = await page.evaluate(`(()=>{const e=document.getElementById('lvl-name'); return [e.scrollHeight,e.clientHeight,e.scrollWidth,e.clientWidth]})()`);
        if (n[0] > n[1] + 1 || n[2] > n[3] + 1) cut.push(id + ' ' + n.join('/'));
        const st = await page.evaluate(STRIP); if (st.clip.length || !st.keep.every(x => x.full)) clip.push(id + ':' + J(st.clip.concat(st.keep.filter(x => !x.full))).slice(0, 100));
      }
      check(r, !cut.length, 'seviye adı 667×375 kesilmez (27 seviye)', cut.join(' ') || 'yok');
      check(r, !clip.length, 'şerit etiketleri 667×375 sığar ya da "…" ile kısalır; kompanzasyon tam', clip.join(' | ') || 'yok');
      await sldSweep(page, r, 'l667');
      // güvenli alan: sol çentik 47 px, solak çipler çentiğin altında başlamaz
      await page.evaluate(`document.documentElement.style.setProperty('--sal','47px'); document.documentElement.style.setProperty('--sar','47px'); PX.store.set('ayar.solak', true); PX.bus.emit('settings',{ayar:PX.store.data.ayar})`);
      await load(page, 'P1'); await page.evaluate(`Game.cmd({t:'tap', cell: Game.L().els[Game.L().elIndex['Q01']].cell})`); await idle(page); await sleep(200);   // v4: Volti Q01'in yanına yürür
      const tile = await page.evaluate(`Game.decode('o:Q01')`); const q = await page.evaluate(`Game.screenOfEl('Q01')`); if (!(await page.evaluate('document.querySelectorAll("[data-testid=chip]").length'))) await page.tap(q.x, q.y, 40); await sleep(400);
      const ch = await page.evaluate(`(()=>{const c=document.getElementById('chips').getBoundingClientRect(); const b=document.querySelector('[data-testid=chip]'); return {left:c.left, chip:b?b.getBoundingClientRect().left:null}})()`);
      check(r, ch.left >= 47 + 8 - 0.5, 'çip kutusu sol güvenli alanı (47 px) korur', J(ch) + ' tile ' + J(tile && tile.el));
      await page.evaluate(`document.documentElement.style.removeProperty('--sal'); document.documentElement.style.removeProperty('--sar'); PX.store.set('ayar.solak', false); PX.bus.emit('settings',{ayar:PX.store.data.ayar})`);
      await page.screenshot(path.join(OUT, 'v2-ui-667.png')).catch(() => {});
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 900000, 'landscape').catch(e => r.fail('landscape harness: ' + e.message));
    await withPage(P360, async page => {
      await open(page, { debug: true, lvl: 'P1' }); await idle(page);
      // solak: yönlü çiftler ters dönmez
      await page.evaluate(`PX.store.set('ayar.solak', true); PX.bus.emit('settings',{ayar:PX.store.data.ayar})`); await page.frames(2);
      const x = await page.evaluate(`Object.fromEntries(['btn-undo','btn-redo','btn-rot-left','btn-rot-right','btn-menu'].map(i=>[i,document.getElementById(i).getBoundingClientRect().left]))`);
      check(r, x['btn-rot-left'] < x['btn-rot-right'] && x['btn-undo'] < x['btn-redo'], 'solak düzeni: Sola < Sağa, Geri Al < Yinele', J(x));
      check(r, x['btn-menu'] < x['btn-rot-left'], 'solak düzeni: Menü kümesi solda', J(x['btn-menu']));
      await page.evaluate(`PX.store.set('ayar.solak', false); PX.bus.emit('settings',{ayar:PX.store.data.ayar})`);
      // "Geri Al?" açıkken seviye adı kesilmez
      const ids = await page.evaluate('PX.LEVELS.map(l=>l.id)'); const cut = [];
      for (const id of ids) {
        await load(page, id);
        const n = await page.evaluate(`(()=>{document.getElementById('lamp-undo').hidden=false; const e=document.getElementById('lvl-name'); const v=[e.scrollHeight,e.clientHeight,e.scrollWidth,e.clientWidth]; document.getElementById('lamp-undo').hidden=true; return v})()`);
        if (n[0] > n[1] + 1 || n[2] > n[3] + 1) cut.push(id + ' ' + n.join('/'));
      }
      check(r, !cut.length, 'seviye adı 360×640 "Geri Al?" açıkken kesilmez', cut.join(' ') || 'yok');
      // dikeyde Tek Hat lejantı alt güvenli alanı ikinci kez eklemez
      await page.evaluate(`document.documentElement.style.setProperty('--sab','34px'); PX.sld.open(true)`); await page.frames(2);
      const pb = await page.evaluate(`[getComputedStyle(document.getElementById('sld-legend')).paddingBottom, getComputedStyle(document.getElementById('hud-controls')).paddingBottom]`);
      check(r, pb[0] === '4px' && pb[1] === '38px', 'dikey: alt güvenli alan yalnız kontrol çubuğunda (lejant 4 px)', J(pb));
      await page.evaluate(`document.documentElement.style.removeProperty('--sab'); PX.sld.open(false)`);
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 600000, 'p360').catch(e => r.fail('p360 harness: ' + e.message));
  }

  // ------------------------------------------------------------------ 5) akış / kayıt
  async function progress(r) {
    // (a) ?debug OLMADAN: P1, P2, P4 çözülür (P3 değil) -> P4 "Sonraki" kilitli M1'e gitmez
    await withPage(PHONE, async page => {
      await open(page, { lvl: 'P1' }); await idle(page);
      for (const id of ['P1', 'P2', 'P4']) { const x = await solve(page, id); if (!x.won) r.fail('çözülemedi ' + id); }
      await sleep(400);
      const w = await page.evaluate(`({m1:PX.world.unlocked('M1'), nx:PX.screens.nextPlayable('P4'), hidden:document.getElementById('btn-next').hidden, scr:PX.screens.current})`);
      const b = await rect(page, '[data-testid=btn-next]');
      if (b && b.w > 0) { await page.tap(b.cx, b.cy, 40); await sleep(500); await idle(page); }
      const after = await page.evaluate(`({id:PX.game.state().id, unlocked:PX.world.unlocked(PX.game.state().id)})`);
      check(r, !w.m1 && w.nx !== 'M1' && after.unlocked, 'kilitli bölüm "Sonraki" ile açılmaz (P4 → P3, M1 değil)', J({ w, after }));
      await page.evaluate('PX.cards.closeAll()');
      // (b) talep değerleri ilk çözümden önce gizli (P3 çözülmedi; P4 çözüldü)
      const tk = await page.evaluate(`(()=>{ const P3=PX.LEVELS.find(l=>l.id==='P3'), P4=PX.LEVELS.find(l=>l.id==='P4'); const a=PX.screens.workOrder(P3,{}); const t3=a?a.body.textContent:''; a&&a.close(); const b=PX.screens.workOrder(P4,{}); const t4=b?b.body.textContent:''; b&&b.close();
          return { p3: (t3.match(/en az [A-Za-zçğıöşüİ]+ = \\d+/g)||[]), p4: (t4.match(/en az [A-Za-zçğıöşüİ]+ = \\d+/g)||[]), p3talep: /Optimizasyon talepleri/.test(t3), p4talep: /Optimizasyon talepleri/.test(t4) }; })()`);
      check(r, tk.p3.length === 0, 'çözülmemiş seviyenin iş emri kartı doğrulanmış değeri ("en az … = N") göstermez', J(tk));
      if (tk.p4talep) check(r, tk.p4.length > 0, 'çözülmüş seviyede talep değerleri görünür', J(tk.p4));
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 300000, 'next-locked').catch(e => r.fail('next-locked harness: ' + e.message));
    // (c) "Sonraki" yeni kural / kural kartı olan iş emrinde kartı gösterir; ikinci kez göstermez
    await withPage(PHONE, async page => {
      await open(page, { debug: true, lvl: 'P4' }); await idle(page);
      const tryNext = async (from) => {
        await page.evaluate('PX.cards.closeAll()'); await solve(page, from); await page.waitFor(`PX.screens.current==='win'`, 8000, 50);
        const b = await rect(page, '[data-testid=btn-next]'); await page.tap(b.cx, b.cy, 40); await sleep(600);
        return page.evaluate(`({id:PX.game.state().id, sheets:PX.cards.top(), start:!!document.querySelector('[data-testid=btn-wo-start]'), txt:(document.querySelector('.sheet .sh-body')||{}).textContent||''})`);
      };
      const a = await tryNext('P4');
      check(r, a.id === 'M1' && a.sheets === 1 && a.start && /Bu iş emrinde yeni/.test(a.txt), '"Sonraki" → M1: iş emri kartı yeni kurallarla açılır', J({ id: a.id, sheets: a.sheets, start: a.start }));
      const ws = await rect(page, '[data-testid=btn-wo-start]'); if (ws) { await page.tap(ws.cx, ws.cy, 40); await sleep(400); }
      const k = await page.evaluate(`(Game.save().ui||{}).kural||[]`);
      check(r, k.indexOf('loto') >= 0 && k.indexOf('toprak') >= 0, 'kart kapanınca M1 kuralları görüldü sayılır', J(k));
      const b2 = await tryNext('P4');
      check(r, b2.id === 'M1' && b2.sheets === 0, 'ikinci kez "Sonraki" → M1: kart yok (yalnız şerit)', J({ id: b2.id, sheets: b2.sheets }));
      // (d) ipuçlu bayrağı koşuya aittir
      const ipu = async hinted => {
        await load(page, 'P1'); const g = await golden(page, 'P1'); const toks = g.split(' ');
        await page.evaluate(`Game.replay(${J(toks.slice(0, -1).join(' '))},{instant:true})`); await idle(page);
        if (hinted) await page.evaluate('PX.screens.noteHint()');
        await page.evaluate(`PX.game.command({t:'act', a:PX.SIM.decodeAct(PX.game.L, PX.game.state().s, ${J(toks[toks.length - 1])})})`); await idle(page); await sleep(300);
        return page.evaluate(`(Game.save().seviye.P1||{}).ipuclu`);
      };
      const f1 = await ipu(true), f2 = await ipu(false), f3 = await ipu(true);
      check(r, f1 === true && f2 === false && f3 === false, 'ipuçlu bayrağı: ipuçlu çözüm → var; sonra ipucusuz çözüm → kalkar; tekrar ipuçlu → kalkık kalır', J([f1, f2, f3]));
      await page.evaluate(`PX.screens.show('levels')`); await sleep(300);
      const lt = await page.evaluate(`document.querySelector('[data-testid=lvl-P1]').textContent`);
      check(r, !/ipuçlu/.test(lt), 'Seviye Seç: temiz çözülen P1 "ipuçlu" yazmaz', JSON.stringify(lt));
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 4).join(' | '));
    }, 300000, 'next-card').catch(e => r.fail('next-card harness: ' + e.message));
    // (e) yalnız Günün Manevrası çözülünce başlık "Başla" kalır
    await withPage(PHONE, async page => {
      await open(page, { debug: true }); await sleep(300);
      await page.evaluate('PX.screens.playDaily()'); await idle(page);
      const g = await page.evaluate(`PX.game.level && PX.game.level.kanit && PX.game.level.kanit.cozum`);
      const rp = await page.evaluate(`Game.replay(${J(g)},{instant:true})`); await idle(page); await sleep(300);
      await page.goto(GAME, { debug: true }); await page.waitFor(READY, 30000, 50); await sleep(300);
      const t = await page.evaluate(`({txt:document.getElementById('btn-play').textContent, keys:Object.keys(Game.save().seviye), gun:Object.keys(Game.save().gunluk||{})})`);
      check(r, rp.won && t.txt === 'Başla' && t.gun.length === 1, 'yalnız günlük çözülünce başlık düğmesi "Başla" kalır', J(t));
      await page.evaluate(`PX.screens.show('levels')`); await sleep(300);
      const sc = await page.evaluate(`document.getElementById('scr-levels').scrollTop`);
      check(r, sc === 0, 'kampanya çözülmemişken Seviye Seç en üstten açılır', 'scrollTop ' + sc);
    }, 180000, 'daily-title').catch(e => r.fail('daily-title harness: ' + e.message));
  }

  async function behavior(r) {
    await withPage(DESK, async page => {
      await open(page, { debug: true, lvl: 'P1' }); await idle(page);
      for (const [name, payload, expected] of [
        ['bekleyen', { why: 'Hesaplanıyor…', acts: [] }, false],
        ['ücretsiz', { a: 'o:Q01', free: true }, false],
        ['çıkmaz', { a: 'o:Q01', dead: true }, false],
        ['arka plan önerisi', { a: 'o:Q01', update: true }, true],
      ]) {
        await load(page, 'P1');
        const g = await golden(page, 'P1'), tokens = g.trim().split(/\s+/), last = tokens.pop();
        await page.evaluate(`Game.replay(${J(tokens.join(' '))}, {instant:true})`); await idle(page);
        await page.evaluate(`delete PX.store.data.seviye.P1; PX.bus.emit('hint', ${J(payload)}); PX.game.command({t:'act',a:PX.SIM.decodeAct(PX.game.L,PX.game.state().s,${J(last)})})`); await idle(page);
        const hinted = await page.evaluate('PX.store.level("P1").ipuclu');
        check(r, hinted === expected, name + ' ipucu koşu işareti', String(hinted));
      }
      await page.evaluate(`PX.store.set('ayar.ses',0.1); PX.store.set('ayar.hareketAzalt',true); PX.store.set('ayar.ipucuMetrik','k'); PX.bus.emit('settings',{ayar:PX.store.data.ayar}); PX.screens.settings()`);
      await page.frames(2);
      await page.evaluate(`(()=>{ const s=[...document.querySelectorAll('.sheet.on')].pop(); const b=[...s.querySelectorAll('button')]; b[b.length-1].focus(); })()`);
      await page.key('Tab');
      check(r, await page.evaluate(`(()=>{const s=[...document.querySelectorAll('.sheet.on')].pop();return s.contains(document.activeElement)})()`), 'Tab odağı açık kartın içinde kalır');
      await page.evaluate(`(()=>{ const s=[...document.querySelectorAll('.sheet.on')].pop(); [...s.querySelectorAll('button')].find(b=>b.textContent==='İlerlemeyi sil').click(); })()`); await page.frames(2);
      await page.evaluate(`(()=>{ const s=[...document.querySelectorAll('.sheet.on')].pop(); [...s.querySelectorAll('button')].find(b=>b.textContent==='Evet, sil').click(); })()`); await sleep(300); await page.frames(2);
      const reset = await page.evaluate(`(()=>{const s=[...document.querySelectorAll('.sheet.on')].pop(); return {count:PX.cards.top(),ses:s.querySelector('input[aria-label="Ses efektleri"]').value,rm:s.querySelector('[aria-label="Hareketi azalt"]').getAttribute('aria-checked'),metric:PX.hud.metric,h:document.querySelector('#hint-pop [data-m="h"]').getAttribute('aria-pressed')}})()`);
      check(r, reset.count === 1 && reset.ses === '0.5' && reset.rm === 'false' && reset.metric === 'h' && reset.h === 'true', 'ilerleme silindikten sonra ayar kartı ve ipucu ölçütü varsayılana döner', J(reset));
      await page.evaluate('PX.cards.closeAll()'); await sleep(250);
      const dailyCode = await page.evaluate(`(()=>{if(!PX.DAILY.length)PX.DAILY.push(Object.assign({},PX.LEVELS[0],{id:'G_UI'}));const d=PX.daily.today('2027-01-01'),l=d.level,r=PX.SIM.replay(PX.SIM.compile(l.def),l.kanit.cozum);return {id:l.id,code:PX.ghost.code(l.id,l.kanit.cozum,r.tot)}})()`);
      await page.evaluate(`PX.screens.codePaste(${J(dailyCode.code)})`); await page.frames(2);
      const openCode = await page.evaluate(`(()=>{const s=[...document.querySelectorAll('.sheet.on')].pop(),b=[...s.querySelectorAll('button')].find(b=>b.textContent==='Seviyeyi aç');if(b)b.click();return !!b})()`); await idle(page);
      const shared = await page.evaluate('({id:PX.game.state().id,current:PX.daily.current})');
      check(r, openCode && shared.id === dailyCode.id && shared.current === null, 'günlük meydan okuma kodu bulmacayı açar, tarihli oturum üretmez', J(shared));
      const ex = page.exceptions(); if (ex.length) r.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 300000, 'behavior').catch(e => r.fail('behavior harness: ' + e.message));
  }

  async function ui() {
    const res = makeResult('ui');
    const parts = [['fling', flingTaps], ['phone', phone], ['desktop', desktop], ['landscape', landscape], ['progress', progress], ['behavior', behavior]];
    const only = (ctx.opt('parts') || '').split(',').filter(Boolean);
    for (const [name, fn] of parts) {
      if (only.length && !only.includes(name)) continue;
      const r = makeResult('ui ' + name); const t0 = Date.now();
      try { await fn(r); } catch (e) { r.fail(name + ' crashed: ' + (e.stack || e.message)); }
      console.log(' [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + name + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); flush(r);
      if (!r.pass) { res.pass = false; res.failures.push(...r.failures.map(f => name + ': ' + f)); }
    }
    return res;
  }

  // ------------------------------------------------------------------ daily: 37 günlük altın dizgi (sayfa içi)
  async function daily() {
    const res = makeResult('daily');
    await withPage(DESK, async page => {
      await open(page, { debug: true, lvl: 'P1' }); await idle(page);
      const pool = await page.evaluate(`(PX.DAILY||[]).map(d=>({id:d.id, k:d.kanit?{opt:d.kanit.opt, cozum:d.kanit.cozum, cozumManevra:d.kanit.cozumManevra, cozumKesinti:d.kanit.cozumKesinti}:null}))`);
      const rows = [];
      if (!pool.length) res.fail('PX.DAILY boş');
      for (const d of pool) {
        if (!d.k) { res.fail(d.id + ': kanit yok'); continue; }
        await page.evaluate(`(()=>{ const d=PX.DAILY.find(x=>x.id===${J(d.id)}); return PX.game.load({def:d.def, id:d.id, kanit:d.kanit, ad:d.ad}); })()`); await idle(page);
        for (const [fld, m] of [['cozum', 'hamle'], ['cozumManevra', 'manevra'], ['cozumKesinti', 'kesinti']]) {
          const str = d.k[fld], exp = d.k.opt && d.k.opt[m];
          if (!str || !exp) { rows.push({ id: d.id, str: fld, pass: false, reason: 'golden/opt yok' }); res.fail(d.id + ' ' + fld + ': eksik'); continue; }
          const r = await page.evaluate(`Game.replay(${J(str)}, {instant:true})`, 120000);
          const t = r.tot; const ok = r.ok && r.won && t && t.h === exp[0] && t.m === exp[1] && t.k === exp[2] && t.o === exp[3];
          rows.push({ id: d.id, str: fld, pass: ok, tot: t ? [t.h, t.m, t.k, t.o].join(',') : '', exp: exp.join(','), reason: ok ? '' : (r.ok ? (r.won ? 'toplam farklı' : 'kazanmadı') : 'ret ' + r.at + ' ' + r.err) });
          if (!ok) res.fail(`${d.id} ${fld}: ${rows[rows.length - 1].reason}`);
        }
      }
      for (const l of table(rows, ['id', 'str', 'pass', 'tot', 'exp', 'reason'])) res.info(l);
      res.info(pool.length + ' günlük, ' + rows.filter(x => x.pass).length + '/' + rows.length + ' dizgi geçti');
      const ex = page.exceptions(); if (ex.length) res.fail(ex.length + ' exception(s): ' + fmtLogs(page, ex).slice(0, 5).join(' | '));
    }, 900000, 'daily').catch(e => res.fail('harness/page error: ' + e.message));
    flush(res); return res;
  }

  return { ui, daily };
};
