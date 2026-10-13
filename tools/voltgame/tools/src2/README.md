# PARALAKS: TEK HAT — `tools/src2` (R1 modül kaynağı)

> Güncel yayın kural sürümü 4'tür: fiziksel yürüyüş, merdiven/iskele ve yalnız görsel kamera (§25).
> Aşağıdaki v3 izdüşüm/stub notları tarihsel entegrasyon kaydıdır. Aktif derleme/oynanış/test bilgisi kök
> `README.md` ve `manifest.json`'dadır. Terser araçları için `npm ci --prefix tools`; three.js yerel kopyadan
> HTML'e gömülür. Güncel JS bütçesi 500 KB, seviye verisi 200 KB'dir (§25.13).

Doğruluk kaynağı: `docs/PARALAKS2_SPEC.md` (§24 > §8–§18; §18 mimari, §12 akıcılık standardı, §20 testler).
Kural motoru: `tools/reference2/sim2.js` (kural sürümü 3, R1 için son). **sim2 anlamını hiçbir modül değiştirmez**;
kural hatası bulursanız `tools/src2/_requests/<ekip>.md` dosyanıza yazın ve etrafından dolaşın.

**R1 entegrasyonu tamam (2026-10-13):** bütün modüller tam uygulamadır; stub kopyaları ve build'in stub geri
dönüşü kaldırıldı. Ekip istekleri ve entegrasyon yanıtları: `_requests/*.md` + `_requests/integrate.md`.

## Derleme

```
node tools/build.js                          # YAYIN: verify2 + tüm modüller -> <kök>/index.html  (== --v2)
node tools/build.js --out dev/x.html         # başka çıktı
node tools/build.js --dev --out dev/x.html   # verify2 atlanır; boyut bütçesi yalnız uyarır
node tools/build.js --no-verify              # verify2 atlanır
node tools/build.js --no-min                 # yorum/boşluk ayıklama ve yerel ad kısaltma kapalı (hata ayıklama)
node tools/build.js --no-mangle              # yalnız ayıklama, yerel ad kısaltma yok
node tools/build.js --all-levels             # R1 dışı (bölüm 5) kanıt seviyeleri de gömülür
node tools/build.js --v1                     # eski v1 -> legacy/paralaks-v1.html
```
Küçültme (`tools/minjs.js` + `tools/mangle.js`, ayrıştırıcı `tools/vendor/acorn.js`, MIT): yalnız yorum/boşluk ve
YEREL bağ adları; özellik adları, `PX.*`, küreseller asla değişmez; satır sonları ASI için korunur; her modül yeniden
ayrıştırılarak doğrulanır, hata olursa özgün kaynak kullanılır (uyarı). Günlük havuz (`daily2.js`) kaynak seviyeyle
ortak def/sld/iş emri alanlarını gömmez (`defFark`), sayfada geri kurulur.
Build adımları (§18.5): verify2 → `manifest.json` sırasıyla birleştirme → three.js r128 (cdnjs) → bütçe
(JS ≤ 450 KB three.js hariç, seviye verisi ≤ 200 KB). Çıktıda `//#PX2-BUILD` işareti, `//#SIM2-BEGIN/END`,
`//#LEVELS-BEGIN/END`, `//#WORKER-BEGIN/END` bölgeleri vardır.

## Ad alanı kuralları (PX)

- Tek global: `window.PX` (+ yalnız test için `window.Game`). Her modül `PX.<ad> = …` atar.
- Build her JS modülünü `try { (function (PX) { 'use strict'; …dosya… })(window.PX); } catch (e) {…}` ile sarar:
  dosya düzeyindeki `const/function` adları **modüle özeldir**, çakışmaz. `import/export/require` yok.
- Modüller yüklenirken yalnız tanım yapar (DOM'a dokunmaz); işi `init()` içinde yapar. `main.js` init sırası:
  `store → scene(canvas) → camera → diorama → flow → volti → hud, sld, cards, screens, world, audio → gesture(canvas)
  → keyboard → game → debug`. Her init try/catch içindedir (bir ekibin hatası diğerlerini durdurmaz).
- Kare döngüsü (`main.js`): `TW.update → game.update → volti.update → camera.update → diorama.update → flow.update
  → fx.update → scene.render → onFrame kancaları`; `dt ≤ 0,1 s`. **Kare başına ayırma yok** (önceden ayrılmış
  geçiciler; kare başına `bus.emit` yok).
- Dünya koordinatı = hücre koordinatı: küp `(x,y,z)` merkezi dünya `(x,y,z)`, birim küp, karo üstü `y+0.5`.
  Görünüm v ⇔ kamera yönü `(sx,1,sz)` (`PX.SIM.VIEWS[v]`), azimut `45°+90°·v`, yükseklik `atan(1/√2)`.
  `d+` ⇒ v+1 ⇒ azimut +90°. Ekran kafesi: `A = sx·X − Y`, `B = sz·Z − Y`, kare `(floor A, floor B)`, üçgen
  `t = (fa ≤ fb) ? 1 : 0` (bkz. `camera.pick`).
- Metinler yalnız `PX.STR` / `PX.t()`'den (Türkçe, doğru karakterler). Ret metinleri `PX.SIM.ERR`'den.

## Modül haritası (R1) ve sahipler

| Dosya | Dışa aktarım | Ekip |
|---|---|---|
| `@sim2` (build) | `PX.SIM` = sim2.js dışa aktarımları (değiştirilmeden) | Kurallar |
| `@levels` (build) | `PX.LEVELS` (R1 bölüm 0–3, sıkıştırılmış), `PX.DAILY` | Kurallar / Integrate |
| `@worker` (build) | `PX.WORKER_SRC` (JSON dizgi: CommonJS kabuğu + `manifest.worker.lib` + `core/worker_src.js`) | Kurallar |
| `core/worker_src.js` | Worker gövdesi (`require('./sim2.js')`, `require('./solve2.js')`) | Kurallar |
| `core/solverClient.js` | `PX.solver` | Kurallar |
| `app/bus.js` | `PX.bus` | Çekirdek (Foundation/Integrate) |
| `app/store.js` | `PX.store` (§10) | Çekirdek |
| `app/strings.js` | `PX.STR`, `PX.t` | UI |
| `game/controller.js` | `PX.game` | Oyun (controller) |
| `game/hint.js` | `PX.hint` | Kurallar |
| `input/gesture.js` | `PX.gesture` | controller |
| `input/keyboard.js` | `PX.keyboard` | controller |
| `render/fx.js` | `PX.TW`, `PX.EASE`, `PX.fx` | Render |
| `render/scene.js` | `PX.scene`, `PX.render` (cephe) | Render |
| `render/camera.js` | `PX.camera` | Render |
| `render/diorama.js` | `PX.diorama` | Render |
| `render/flow.js` | `PX.flow` | Render |
| `render/kit/*.js` | `PX.KIT[tip]`, `PX.KIT.default` (glob, ada göre sıralı) | Sanat (kits) |
| `render/volti.js` | `PX.volti` | Animasyon (volti) |
| `audio/audio.js` | `PX.audio` | volti |
| `ui/hud.js`, `ui/sld.js`, `ui/cards.js`, `ui/screens.js` | `PX.hud`, `PX.sld`, `PX.cards`, `PX.screens` | UI |
| `meta/world.js` | `PX.world` (R1 düz seviye seçme) | UI |
| `meta/daily.js`, `meta/ghost.js` | `PX.daily`, `PX.ghost` | Kurallar |
| `debug/game_api.js` | `window.Game` (§18.4) | Test (Foundation/Integrate) |
| `main.js` | `PX.main` | Çekirdek |
| `shell/head.html` | CSS + DOM iskeleti | UI |

Paylaşılan dosyalar (`manifest.json`, `tools/build.js`, `tools/test/run.js`, `cdp.js`, `suites2.js`, `sim2.js`,
`levels2.js`) yalnız Foundation/Integrate tarafından düzenlenir. Bir dosyayı her zaman **tek, sözdizimi geçerli
kayıtla** yazın (diğer ekipler aynı anda derliyor). Arayüz değişikliği isteği → `_requests/<ekip>.md`.

## Arayüzler (§18.2 + stub'ların kesinleştirdiği ayrıntılar)

```js
PX.SIM.*                                  // sim2.js aynen (compile, initState, apply, candidates, won, key, stateE, encodeAct,
                                          // decodeAct, replay, describe, activePairs, walkTargets, passMap, approachTile, ERR, VIEWS, DIRS…)
PX.solver.load(levelId, def) -> Promise<{states, ms}|null>   PX.solver.dist(s) -> n | -1 | null
PX.solver.hint(s, tier) -> Promise<{tier, acts:[tok], why}>   PX.solver.abstractHint(s) -> {el, why}   PX.solver.ready
PX.game.init()  PX.game.load(id | {daily} | {def}) -> Promise<{id}>   PX.game.command(cmd) -> bool
  cmd: {t:'tap',U,V,tri,cell?} {t:'walk',dir} {t:'rot',d:±1} {t:'act',a|tok} {t:'izdusum'} {t:'undo'} {t:'redo'} {t:'reset'} {t:'hint',tier}
PX.game.state() -> {id, s, view, tot, won, presentation:{tot, s, won}, queue, busy, hist, redo}
PX.game.preview(a) -> {ok, err?, msg?, olu:[düğüm], kesintiDelta, yedekDelta}   PX.game.canCommit()  PX.game.setInstant(b)
PX.game.L  PX.game.level  PX.game.busy  PX.game.tokens()
PX.render.setLevel(L, s)  PX.render.sync(s, E?)  PX.render.animate(step) -> Promise<{cancelled}>  PX.render.instant
  step = {kind, cmd, a, tok, before, after, c:{h,m,k,o}, trips:[id], log, path:[cell]|null, chipAfter}
  kind = walk | rot | izdusum | op | earth | lock | unlock | fuse | press | work | wait   ('izdusum' §18.3 listesine ek)
PX.camera.snapTo(v,{vel}) -> Promise  .grab()  .drag(dxPx)  .release(vxPxPerMs) -> q  .pick(x,y) -> {kind:'tile'|'el'|'none', cell, el, U, V, tri}
PX.camera.worldToClient(x,y,z,out?) -> {x,y}  .syncView(v)  .busy()  .setLevel(L,s)  .setViewport(w,h)  .cam  .az  .v  .azOf(v)  .EL
PX.diorama.build(L,s)  .sync(s,E)  .drawnScale(cell)  .drawnTiles(v) (+ .stub bayrağı)  .elState(elIdx)  .highlight(cell)  .tileTop(cell)
PX.KIT[tip](el, biyom) -> {obj, setState({closed,locked,live,earthed,charge,blown,tripped}), anchor, hit}
PX.volti.followPath(cells[], {view}) -> Promise  .play(clip, opts) -> Promise  .cancel()  .place(cell, v)  .probe()
  probe() -> {x,y,z, footY, groundY, cell, arc, moving}   (önceden ayrılmış; grounding paketi okur — arc yalnız gerçek sıçrama yayında true)
PX.TW.add(tag, durSec, fn(k,raw), ease?, onDone?) -> Promise<{cancelled}>  PX.TW.cancel(tag)  PX.TW.cancelAll()  PX.TW.active(tag?)
PX.flow.build(L,s) .sync(s,E) .update(dt) .preview(pairs)      PX.fx.ripple(x,y)
PX.store.init() .available .data .get(p) .set(p,v) .level(id) .recordWin(id,tot,str) .setSon(id,str)
PX.hud/sld/cards/screens/world.init()  PX.screens.show(name) .play(id)  PX.cards.toast(msg,kind)  PX.world.render(box)
PX.daily.today(date?) -> {date, level}   PX.ghost.code(id,str,tot) .parse(code) .verify(code)   PX.audio.play(name) .resume()
PX.main.onFrame(fn) -> off   PX.main.frameStats(n?)
```

## Olaylar (`PX.bus.emit(type, payload)`, §18.3)

| Tür | Yük | Yayınlayan |
|---|---|---|
| `level:loaded` | `{id, L, s, view, level}` | controller |
| `cmd:accepted` | `{cmd, a, tok}` | controller |
| `cmd:rejected` | `{cmd, err, msg, a?, cells?, seam?}` (`err` sim2.ERR anahtarı; ek: `tampon`, `erisilemez`, `bos`, `kazanildi`) | controller |
| `anim:step` | `{kind, a, tok, before, after, c, trips, log, tot}` — `tot` = sunum toplamı (HUD bunu gösterir) | controller (adım animasyonu bitince) |
| `anim:done` | `{queueLen}` | controller |
| `elec:changed` | `{E, liveNodes:[ad], fedLoads:[id], couplers:[[a,b]], s}` | controller (sunum anında) |
| `lamp` | `{state:'ok'|'dead'|'busy', dist}` | controller |
| `win` | `{id, tot, opt, front, seals:[], ghost}` | controller (sunum kazanınca) |
| `undo` / `redo` / `reset` | `{s, tot?}` | controller |
| `ui:chip` | `{el:id|null, actions:[{a, tok, label, preview}]}` | controller |
| `ui:chipKey` | `{i}` (Boşluk/1–9) | keyboard |
| `ui:longpress` | `{cell, el}` | gesture |
| `solver:ready` | `{id, states, ms}` | solverClient |
| `hint` | `{tier, acts, why}` | hint |
| `toast` | `{msg, kind}` | store, herkes |
| `screen` | `{name}` | screens |
| `ready` | `{}` | main (Game.ready ile aynı an) |

Kural: **mantık komutla anında ilerler, sunum (HUD, lamba, tek hat, kazanma) yalnız `anim:step` ile**. Geri al /
baştan: `TW.cancelAll` + `volti.cancel` + `PX.render.sync(s)` (saf yeniden kurulum).

## Test API'si (`window.Game`, yalnız `?debug`, harness ya da `--dev`)

§18.4: `load(id)`, `cmd(cmd)`, `state()`, `visibleTiles()`, `screenOfTile(c)`, `ownerAt(x,y)`, `replay(str,{instant})`,
`drawnScale(cell)`, `frameStats(n?)`. Ek: `ready`, `levelId`, `levels()`, `level(id)`, `L()`, `probe()`, `idle()`,
`events(n)`, `decode(tok)`, `tileCell(i)`, `keyMap()`, `screenOfEl(id)`, `chips()`, `camera()`, `save()`,
`storeInfo()`, `parityInfo(v)`, `onFrame(fn)`, `build()`. Testlerin kullandığı DOM kimlikleri: `hud-top`,
`hud-controls`, `canvas#game-canvas`, `btn-undo/redo/rot-left/rot-right/hint/menu/izdusum/play/next/map`,
`[data-testid=chip][data-tok=<simge>]`, `lamp`, `sld-strip`, `toast`, `title-screen`, `level-select`,
`lvl-<id>`, `win-panel`. **Bu kimlikleri koruyun.**

## Test

```
node tools/test/run.js <suite>[,suite…|all] --file dev/v2-<ekip>.html [--levels=P1,M1] [--cpu=1,4] [--realtime]
  verify     node tools/reference2/verify2.js
  replay     her seviyenin altın dizgileri Game.replay ile kazanır, toplamlar damgayla aynı (+1 animasyonlu)
  parity     drawnTiles(v) == views[v].vis (stub: totoloji, render ekibi kimlik tamponu ekler) + seçim gidiş-dönüşü
  flow       §12.3 eşikleri CPU 1× ve 4×: dokun→hareket, döndür/geri al→hareket, 90° tamamlanma, 4 hızlı ok = 4 adım,
             meşgulken kaydırma dokunuş değil, FX ortasında geri al = mantık, dikiş sürekliliği, kare CPU, ayırma/kare,
             uzun görevler, Baştan, seviye geçişi, mesafe tablosu
  grounding Volti'nin ayağı HER karede altındaki karonun üstünde (bağımsız geometri denetimi; yay ve katı geçişi)
  leak       20 seviye yükle/boşalt: yığın ≤ 2 MB, geometri/doku sabit
  storage    ?nostorage, atan localStorage, bozuk kayıt, göç, kazanmanın kalıcılığı
  touchplay  P1 ve M1 yalnız dokunarak (karo dokunuşu, kaydırma, cihaz dokunuşu + çip, İzdüşümü uygula)
  smoke      375x667, 360x640, 667x375, 1280x800: yerleşim, ≥ 44 px hedefler, çakışma, konsol hatası, yasaklı ifadeler
```
Görüntüler: `tools/test/out/`. Stub sayfada bilinen kırmızılar (README sonu).

## Seviye hattı (bölüm tasarımcıları)

- Şablon: `tools/reference2/templates/ch<N>.js` → `module.exports = { sablonAdi: {…templates2.js biçimi…} }`.
  `gen2.js` bunları `templates2.js` ile birlikte yükler: `node tools/reference2/gen2.js <şablon> <tohum> <saniye> out.json`.
- Seviyeler: `tools/reference2/levels/ch<N>.js` → `const CH<N> = [ …levels2.js biçimi… ]; module.exports = CH<N>;`
  (ilk `const X = [` öncesindeki başlık/yardımcılar damgada korunur).
- `node tools/reference2/verify2.js --file tools/reference2/levels/ch<N>.js [--stamp] [--id A,B]`
- Varsayılan `node tools/reference2/verify2.js` = `levels2.js` + `levels/*.js` (aynı kimlik + aynı içerik bir kez
  doğrulanır; farklı içerik uyarı verir, build `levels/` sürümünü kullanır). Build yalnız R1 bölümlerini (0–3) gömer.
- Günlük havuz: `tools/reference2/daily2.json` ya da `daily/*.js|json` → `PX.DAILY`.

## Stub'ların bilinen sınırları (ekiplerin işi)

- `flow`: döndürme 90° ≈ 350 ms (yarı örtük Euler yayı; hedef 260–300 ms, analitik kritik sönümlü yay kullanın);
  kare başına ≈ 5–10 KB ayırma three.js r128 `render()` içinden (nesne başına; örnekleme profili: updateMatrixWorld/
  invert, renderBufferDirect, setupLightsView) — nesne sayısını azaltın (InstancedMesh/birleşik kit geometrisi,
  statik nesnelerde `matrixAutoUpdate=false`); Worker mesafe tablosu süresi headless'ta çok değişken (F2/T2 0,3–7 s,
  soğuk JIT) — tipli dizilerle keşif ve §12.8 açık adresli hash.
- `parity`: `drawnTiles` mantıktan türetiliyor (kimlik tamponu yok).
- Yok: iş emri kartı, Tek Hat SVG paneli, hayalet, lastik bant, kıstırma, karo sınırında yeniden planlama, yürüyüş
  rampası, gerçek klipler, kit modelleri, ses sentezi, kalite katmanları, doğuş/kutlama animasyonları.
