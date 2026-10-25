# Performans ölçümü (laboratuvar)

Bu klasördeki betikler **laboratuvar (sentetik)** ölçümüdür. Gerçek kullanıcı (saha / RUM) verisi değildir;
Core Web Vitals hedefleri (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) saha verisinin 75. yüzdeliğine göre
değerlendirilir. Laboratuvar sonucu yalnızca darboğaz bulmak ve önce/sonra karşılaştırmak içindir.

Gerekenler: Node 24, Google Chrome, Playwright (`VG_NODE_MODULES` ile yolu verilebilir).

## Sayfa yükleme ve etkileşim

```bash
node tools/perf/web-perf.cjs --profile=mobile --runs=5 --out=.qa/perf/mobile.json
node tools/perf/web-perf.cjs --profile=desktop --runs=5 --out=.qa/perf/desktop.json
```

Önce/sonra (bu klasördeki sonuçlar böyle üretildi; `base` = başlangıç commit'i, `after` = yalnız performans değişiklikleri):

```bash
git archive 33e37bd --prefix=base/ -o base.tar && tar -xf base.tar
P=home,hizmet,araclar,iletisim,teklif,voltsim,vs:trafo,vs:yangin-algilama
node tools/perf/web-perf.cjs --profile=mobile --runs=7 --root=base --compare=after --pages=$P --out=tools/perf/results/mobile.json
node tools/perf/web-perf.cjs --profile=desktop --runs=7 --root=base --compare=after --pages=$P --out=tools/perf/results/desktop.json
node tools/perf/report-table.cjs
```

- `--pages=home,hizmet,araclar,iletisim,teklif,voltsim,vs:trafo,vs:yangin-algilama` (varsayılan: ilk altısı).
  `vs:<slug>` herhangi bir VoltSim modülünü ölçer.
- `--root=<klasör>` başka bir kopyayı aynı yöntemle ölçer. Önceki sürüm için:
  `git archive <commit> --prefix=base/ -o base.tar && tar -xf base.tar`, sonra `--root=base`.
- `--compare=<klasör>` önce/sonra karşılaştırması: `--root` (önce) ve `--compare` (sonra) her tekrarda dönüşümlü (ABBA) ölçülür,
  böylece makinedeki diğer yük iki sürümü birlikte etkiler. Çıktı: `<out>-before.json`, `<out>-after.json`, `<out>-paired.json`
  (tekrar başına sonra − önce farkının medyanı) ve ölçüm sırasındaki makine CPU kullanımı. Tablo: `node tools/perf/report-table.cjs`.
  Değişmeyen sayfalar (ör. hizmet, araç listesi) gürültü kontrolüdür: onlardaki fark, ölçümün belirsizlik payını gösterir.
- `--gpu=swiftshader` yazılım WebGL'i seçer (GPU işi CPU'ya biner; 3D süreleri gerçekçi değildir). Varsayılan gerçek GPU'dur.

Profiller (Lighthouse sabitleriyle aynı):

| Profil  | Ağ | CPU | Ekran |
|---------|----|-----|-------|
| mobile  | Slow 4G: 562,5 ms RTT, ~1,44 Mbit/s indirme | 4× yavaşlatma | 412×823 @1,75x, dokunmatik |
| desktop | 40 ms RTT, 10 Mbit/s | 1× | 1350×940 @1x |

Her ölçüm yeni bir tarayıcı bağlamında, önbellek kapalı (soğuk yükleme) yapılır; tabloda medyan, LCP için en küçük–en büyük de verilir.
INP, Playwright'ın ürettiği gerçek tıklama/klavye olaylarının Event Timing süresidir (sayfa başına 2–5 etkileşim; en kötüsü).
CLS, yükleme + etkileşim/kaydırma süresince web-vitals oturum penceresi tanımıyla hesaplanır; `clsLoad` yalnız yüklemeyi gösterir.

Sınırlar: sunucu yerel Node (HTTP/1.1, TLS yok, Brotli q5); üretim LiteSpeed HTTP/2-3 + TLS'tir. Mutlak süreler üretimden farklıdır,
önce/sonra farkı aynı koşulda ölçülür. CPU yavaşlatma GPU'yu yavaşlatmaz.

## VoltSim bellek ve kararlılık

```bash
node tools/perf/voltsim-stress.cjs --heavy=trafo --cycles=30 --out=.qa/perf/stress-after.json
```

Aynı sekmede tüm simülasyonları iki tur açıp kapatır; ağır sahnede senaryo / görüntü kalitesi / 2D-3D / patlatma döngüsü yapar;
GC sonrası JS heap, canlı belge ve olay dinleyicisi sayısı, GPU geometri/doku/program sayısı ve bekleyen requestAnimationFrame
sayısını kaydeder; ekran dışı ve gizli sekmede saniyedeki render sayısını ve WebGL bağlam kaybında 2D'ye geçişi denetler.

Kare hızı, draw call ve sahne geçişi heap ölçümü için ayrıca: `node .qa/voltsim-perf.cjs [slug]`.
