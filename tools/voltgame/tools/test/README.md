# PARALAKS headless test düzeneği

Güncel oyun fiziksel kural sürümü 4'tür. Yayın `index.html`; geliştirme kopyaları tarihsel olabilir.
Yeniden derlemeden önce `npm ci --prefix tools` çalıştırın (Terser). Test düzeneği Node 24 ve Chrome ile çalışır.
Ek bakım regresyonları: `unit/build_regressions.js`, `unit/runtime_regressions.js`,
`unit/rules_regressions.js`, `unit/audio_lifecycle.js` ve `unit/offline_browser.js --file index.html`.
Shader türü/ilk yürüyüş hazırlığı: `unit/shader_variants.js --file index.html`.
Etiket ve malzeme regresyonları: `node tools/test/regress_render.js --only hudalloc,materials,labels`.

Bağımlılık yok: Node 24 (global `WebSocket` + `fetch`) ve Chrome DevTools Protocol. `npm install` gerekmez.
Chrome: `C:/Program Files/Google/Chrome/Application/chrome.exe` (yoksa Edge). Başka bir yol için `CHROME_PATH` ortam değişkeni.

Her çalıştırma kendi Chrome'unu `--headless=new`, rastgele port ve `os.tmpdir()` altında geçici profil ile açar
(WebGL için SwiftShader). Bitince (hata/zaman aşımında da) Chrome kapatılır, geçici klasör silinir. Birden çok
çalıştırma aynı anda koşabilir.

```
node tools/test/run.js <paket>[,paket…|all] [--file <yol>|--file=<yol>] [--v1|--v2] [--levels=P1,M1] [--cpu=1,4] [--realtime]
```
`--file` varsayılanı `index.html`. Mod, dosyadaki `//#PX2-BUILD` işaretinden otomatik seçilir (`--v1/--v2` zorlar).
Hata varsa çıkış kodu 1.

## v2 paketleri (PARALAKS: TEK HAT, `suites2.js`, spec §20.1)

Her v2 sayfası `?debug` ve harness init betiğiyle açılır (`window.__PX_TEST__`, girdi zaman damgaları
`__inp.{down,up,key}` (olay) ve `__inp.{downH,upH,keyH}` (ilk dinleyici anı), uzun görev gözlemcisi `__lt`).

| Paket | Ne yapar | Geçme koşulu |
|---|---|---|
| verify | `node tools/reference2/verify2.js` (`--vfile <p>` ile tek dosya) | ALL LEVELS VERIFIED |
| replay | her seviyenin `cozum`, `cozumManevra`, `cozumKesinti` dizgisi `Game.replay` (anında) + P1 animasyonlu; kural sürümü 3 simgesi (`d+ d- p`) yok | kazanır, toplam = damga |
| parity | **fiziksel dünya**: çizilen yürünebilir yüzeyler (`PX.diorama.walkableDrawn()`: karo, merdiven, iskele, kapı; çizilen nesnelerden) = sim2 `L.tiles` / `L.stairs` / `L.ladders` / `L.doors` (görünümden bağımsız); 4 görünümde (`Game.rotate`) üstü örtülmemiş her karo ve cihaz için seçim gidiş-dönüşü | eşit |
| flow | §12.3, telefon 375×667 DPR2 dokunma, CPU 1× ve 4× (`--cpu`): dokun→ilk hareket, döndür düğmesi→hareket, 90° tamamlanma, geri al→hareket, 4 hızlı ok = 4 adım, meşgulken kaydırma dokunuş değil, FX ortasında geri al (`Game.drawnScale`, cihaz durumu, sunum = mantık), merdiven/iskele sürekliliği (kat değiştiren yürüyüşte hiçbir karede ışınlanma: dünya adımı ≤ 9 karo/s × dt + 0,05, ayak yüksekliği kare başına ≤ 0,5), kare CPU, kare başına ayırma, kare aralığı, Baştan, seviye geçişi, mesafe tablosu, uzun görevler (adıma atfedilir) | tablo |
| grounding | her seviyede altın çözüm animasyonlu + yürürken geri al + döndürmeler + Baştan; HER karede ayak, sim2 geometrisinden bağımsız hesaplanan yürüme yüzeyiyle karşılaştırılır: karo üstü (fark 0), merdiven eğik düzlemi (basamak payı ±0,13), iskele sütunu (iki sahanlık arası); atlama yayı yok (yay bildiren kare de zemine oturmalı); gövde hiçbir karede katı hücre (blok, duvar, cihaz, merdivenin altı) içinde değil | 0 ihlal |
| reach | **asla takılmaz**: her seviyede başlangıçta VE altın çözümün her manevrasından sonra her cihaz/kapı/merdiven/iskele hücresine dokunuş ya yürür, ya çip/kart açar, ya da NEDENLE reddedilir (msg + adlandırılmış engeller + vurgu hücreleri); erişilemeyen cihaza gerçek dokunuşta neden kartı `[data-testid=reason]` görünür; cihaz kartındaki "Volti'yi gönder" (`[data-testid=btn-send]`) yürür ya da açıklar | 0 sessiz dokunuş |
| leak | 20 seviye yükle/boşalt | yığın ≤ 2 MB, geometri/doku sabit |
| storage | `?nostorage`, atan localStorage, bozuk kayıt (+ yedek), göç (v0→v1, bilinmeyen anahtar korunur), kazanma yeniden yüklemede kalıcı | hepsi |
| touchplay | P1, M1 (`--levels`) yalnız dokunarak: karo dokunuşu (merdiven/iskele üzerinden), cihaz dokunuşu + `[data-testid=chip][data-tok]`; hedef o görünümde seçilemiyorsa kamera kaydırmayla döndürülür (yalnız bakış, Hamle değişmez) | kazanma paneli, toplam = altın |
| smoke | 375×667, 360×640, 667×375, 1280×800 (sırayla): `hud-top`/`hud-controls` tuvalle çakışmıyor, düğmeler ≥ 44 px, ekranda, birbiriyle çakışmıyor, yatay kaydırma yok, konsol hatası yok, yasaklı v1 sloganları yok | hepsi |

Görüntüler: `tools/test/out/v2-*.png`.

## v1 paketleri (eski sayfa)

```
node tools/test/run.js smoke|verify|parity|leak|touchplay|storage|all|selftest --file legacy/paralaks-v1.html   # --levels=1,3,7
```
(R1 yayınından beri `index.html` v2'dir; v1 `legacy/paralaks-v1.html`'de korunur, `node tools/build.js --v1` yeniden üretir.)

`cdp.tap()`/`twoFingerTap()` dokunma olaylarını açık zaman damgalarıyla ve touchStart onayını beklemeden gönderir
(yoğun sayfada sayfanın basışı uzun basış sanması engellenir).
(v1: oyunun kendi `?verify/?parity/?leak` modları; touchplay `Game.solvePath()`; selftest `legacy/devre-v1.html`.)

## Kütüphane: `tools/test/cdp.js`

`launch`, `goto`, `evaluate`, `waitFor`, `frames`, `tap`, `drag`, `screenshot`, `setViewport`, `logs/errors()/exceptions()`,
`close` ve (v2 denetimi, §13 F20):
- `setCPUThrottle(rate)` — `Emulation.setCPUThrottlingRate`
- `addInitScript(src|fn)` / `removeInitScript(id)` — `Page.addScriptToEvaluateOnNewDocument`
- `gesture([{x,y,t}])`, `swipe(x1,y1,x2,y2,{durationMs,hz=60,ease})` — zaman damgalı, sürüklenmesiz saatle planlanmış,
  yanıt beklemeden (boru hatlı) dokunma hareketleri; `twoFingerTap(x,y)`
- `key(k)`, `keys([k…], gapMs)` — doğru `key/code/keyCode` ile
- `startFrameTrace(sampleExpr, {width})` / `stopFrameTrace()` — `Game.onFrame` (yoksa rAF) üzerinden kare başına örnek,
  önceden ayrılmış tipli diziler
- `heap()` (GC + `Runtime.getHeapUsage`), `metrics()` (`Performance.getMetrics`)
- Chrome `--enable-precise-memory-info` ile açılır (kare başına ayırma ölçümü).
