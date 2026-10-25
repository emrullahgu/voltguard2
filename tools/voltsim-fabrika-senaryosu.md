# VoltSim · Fabrika Senaryosu

Sayfa: `/voltsim/fabrika-senaryosu/` · hesap: `js/voltsim/calc/fabrika.js` · arayüz/3D: `js/voltsim/mod/fabrika.js` · test: `tools/tests/voltsim-fabrika.test.cjs`

## Kapsam

Eğitim ve ön değerlendirme modeli. Gerçek zamanlı tesis bağlantısı yoktur; **canlı dijital ikiz değildir**. Değerler ölçüm değil, girdilerden hesaplanır. Bu ifade sayfanın kapsam notunda, varsayımlarda, PDF raporda ve 3D sahnedeki animasyon açıklamasında yer alır.

## İlk sürüm: trafo + ana dağıtım panosu + kompanzasyon

Mevcut modüllerin hesap motorları yeniden yazılmadı; tek senaryo verisiyle sırayla beslenir:

| Aşama | Motor | Girdi | Çıktı (sonraki aşamaya) |
|---|---|---|---|
| Yükler | güç üçgeni (`E.pano.circuitFlow` ile aynı) | yük grupları (açık/kapalı, P, cosφ, η, harmonik profili) | ΣP, ΣQ, harmonik akımlar |
| Kompanzasyon | `E.ext.komp.controller` + `E.komp.compute` | ΣP, ΣQ, kademeler, p, trafo Sr/uk | devredeki kademeler, Q_net, THDv, rezonans |
| ADP bara | `E.pano.compute` | yük çıkışları + kondansatör bankası çıkışı, ACB, bara, trafo–ADP kablosu | bara P/Q/S, I, Ik3, çıkış kontrolleri |
| Trafo | `E.trafo.compute` | bara P ve cosφ | K, kayıplar, sıcaklık, I1/I2, ε |
| Gün profili | aynı zincir 24 kez | vardiya profili | günlük reaktif oranlar (EPDK 5999-3 Md. 13), yıllık kayıp enerjisi |

Tutarlılık testle doğrulanır: bara Q = kompanzasyon Q_net, trafo S = bara S, bara P = yükler + kondansatör kayıpları.

Arayüz: 3D genel görünüm (seçilebilir ekipman, açılan pano kapakları, önden arkaya kesit, şeffaf kapak), açıklamalı 2D tek hat şeması (tıklanabilir), seçili ekipman kartı, hesap zinciri, sonuçlar, varsayımlar ve model sınırları, olay geçmişi, A/B karşılaştırma, rehberli (görevler) ve teknik (tüm girdiler, çıkış tablosu, harmonik spektrum) kullanım.

Kayıt: otomatik kayıt + adlı cihaz kayıtları (localStorage), sürümlü JSON (`voltsim-project`, şema 1, olay geçmişi ve A/B dahil), trafo/kompanzasyon/pano proje dosyalarından aktarım, paylaşım bağlantısı (tesis adı ve not varsayılan olarak eklenmez; olay geçmişi hiç eklenmez), cihazdaki verileri temizleme.

Çekirdeğe eklenen kancalar (`js/voltsim/core.js`, diğer modüller etkilenmez): `afterCompute`, `renderExtra`, `onSelect`, `mount`, `migrate`, `importForeign`, `projectExtras`/`loadExtras`. Eski kayıt göçü ve eksik alan bildirimi tüm modüllerde çalışır.

## Sonraki modüllerin entegrasyon değerlendirmesi

Ön koşul (her entegrasyondan önce): zincire **kaynak** kavramı eklenmeli (şebeke, GES, jeneratör, batarya) ve işaret kuralı (+ tüketim, − üretim) tanımlanmalı. Bu, senaryo şemasını 2'ye çıkarır; `MIGRATIONS[1]` şema 1 dosyalarına boş kaynak listesi ekler.

| Modül | Bağ | Yapılacak | Eğitsel değer | Çaba | Öneri |
|---|---|---|---|---|---|
| **Selektivite** | Bara Ik3 ve çıkış MCCB'leri zaten ortak durumda | ACB (üst) ↔ her MCCB (alt) için `E.ext.pano.selectivity` ve bant çakışması; 2D şemada işaret | Yüksek | Düşük | 1. sıra |
| **GES** | ADP barasına negatif yük (AC çıkış) | `E.ges.compute` saatlik üretimi gün döngüsüne; anlık durum için seçili saat; ihracat sınırı `E.ext.ges.exportLimit`; inverter kısa devre katkısı (≈ 1,1–1,5·In) Ik'ye | Çok yüksek: şebekeden çekilen P düşerken Q aynı kalır → cosφ ve EPDK oranı kötüleşir; ters güç akışı ve trafo yüklenmesi | Orta | 2. sıra |
| **Şarj istasyonu** | Yük grubu tipi `evse` + zaman profili | `E.sarj.compute` istasyon gücü; dinamik yük paylaşımı sınırı = trafo kapasitesi − diğer yükler (ortak durumdan) | Yüksek: trafo yedeğine göre şarj gücü | Düşük–orta | 3. sıra |
| **UPS & jeneratör** | Alternatif kaynak (pano motoru `source: 'gen'` destekliyor) | Şebeke kesintisi senaryosu: jeneratör kVA, kritik yük bayrağı (mevcut) ile yük atma, jeneratörde düşük Ik1 ile otomatik kesme kontrolü | Yüksek | Orta | 4. sıra |
| **Depolama & hibrit** | Kaynak/yük (şarj–deşarj) | `E.ext.depolama` dağıtım stratejisi gün döngüsüne; tepe tıraşlama trafo K'sine | Orta–yüksek | Orta–yüksek (zaman adımı ve SOC durumu) | GES'ten sonra |
| **Motor, pompa, konveyör** | Yük tipleri | Pompa VFD tasarrufu → yük P'si; motor yol alma gerilim çökmesi (bara Ik3 ile) ayrı “olay” olarak | Orta | Düşük (kalıcı durum) / orta (geçici olay) | İsteğe bağlı |
| **Enerji kalitesi** | Harmonik zaten ortak | Tek fazlı yükler ve dengesizlik (VUF), çökme olayları | Orta | Orta (yükleri faz bazına taşımak gerekir) | Sonra |
| **Topraklama, yıldırım, yangın, arıza tespit, RES** | Yük akışıyla zayıf bağ | Ayrı katman/sahne olarak bağlantı; ortak hesaba katılmamalı | Düşük (bu senaryo için) | — | Şimdilik bağlantı (link) yeterli |

Riskler: (1) Kaynak eklenince tek yönlü zincir yerine net güç dengesi gerekir; kompanzasyon rölesinin ölçüm noktası (akım trafosu konumu) GES ile kritik hale gelir — modelde açık seçim olmalı. (2) Gün döngüsü her hesapta 24 zincir çalıştırır (Node'da ısınmış motorla tam değerlendirme ≈ 5–6 ms); kaynaklarla 8760 saatlik yıl hesabı ayrı ve isteğe bağlı tutulmalı. (3) Her entegrasyonda “aynı girdiden tutarlı sonuç” testi (zincir eşitlikleri) genişletilmeli.
