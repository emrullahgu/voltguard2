# VoltGuard birinci taraf ölçüm (`api/metrics.php`)

Çerezsiz, anonim, yalnızca günlük toplam tutan ziyaret, kullanım ve teklif akışı ölçümü. Üçüncü taraf izleyici yoktur
(Google Analytics, Tag Manager, Meta pikseli, Clarity, Hotjar, Matomo, Plausible vb. sitede yüklü değildir; 2026-10-24'te
depoda tarandı). Yeni bir izleme aracı eklenmeden önce bu belge ve `js/vg-metrics.js` güncellenmelidir: aynı olay iki
sistemde sayılırsa raporlar birbirini tutmaz.

**Tek kaynak kuralı:** her olay tek yerde üretilir. Kabul edilen talep (`quote_submit_success`) yalnızca sunucuda,
`contact.php` talebi kabul edip teslim ettiğinde sayılır; tarayıcı bu olayı gönderemez (sunucu reddeder) ve eski istemcinin
`quote_submit` bildirimi yalnızca "eski olay" sayacına yazılır.

## Ölçülen akış

İçeriğe erişim → araç/simülasyon kullanımı → sonuç inceleme → teklif başlangıcı → backend tarafından kabul edilen talep.

Adımlar ayrı ayrı sayılan günlük toplamlardır. Çerezsiz ölçümde aynı kişinin adımları birbirine bağlanmaz; adımlar arası
oranlar kaba geçiş göstergesidir, kişi bazlı dönüşüm oranı değildir.

## Olay sözlüğü (sürüm 2)

Tüm olaylar sayfa yolu (`p`, yalnızca sitede var olan sayfalar) taşır. Alan değerleri izin listesindeki kısaltmalardır;
serbest metin taşıyabilecek alan yoktur. "Bir kez" = sayfa görüntülemesi başına bir kez (yeniden tıklama oranları şişirmez).

| Olay | Ne zaman tetiklenir | Alanlar | Kaynak |
| --- | --- | --- | --- |
| `pageview` | Sayfa gerçekten açıldığında (prerender açılınca; bfcache dönüşü yeni görüntüleme) | kaynak kategorisi, arama motoru, cihaz sınıfı | `js/vg-metrics.js` |
| `simulation_open` | VoltSim modülü kurulduğunda (bir kez) | `sim` | `js/voltsim/core.js` |
| `simulation_run` | "Başlat" ya da bir görev başlatıldığında (bir kez) | `sim` | core.js |
| `simulation_result` | Ziyaretçi açılıştaki durumu değiştirdikten sonra hatasız hesap sonucu çıktığında ya da geçerli sonuçla benzetim çalıştırıldığında (bir kez) | `sim` | core.js |
| `simulation_error` | WebGL açılamadığında, 3D sahne kurulamadığında, hesap motoru istisna fırlattığında, çalışma sırasında hata, PDF üretilemediğinde, proje dosyası okunamadığında (tür başına bir kez). Girdi doğrulama uyarıları hata değildir | `sim`, `kind`: webgl / sahne / hesap / calisma / rapor / dosya | core.js |
| `task_complete` | Rehberli görev tamamlandığında | `sim` | core.js |
| `scenario_save` | Proje dosyası indirildiğinde (VoltSim) ya da hesap aracı sonucu kaydedildiğinde | `sim` veya `tool`, `kind`: dosya / hesap / tarayici | core.js, `js/voltguard-tools.js` |
| `report_download` | PDF/CSV gerçekten üretildikten SONRA ya da yazdır açıldığında | `sim` veya `tool`, `fmt`: pdf / csv / yazdir | core.js, voltguard-tools.js |
| `tool_use` | Hesap aracında ilk gerçek (isTrusted) girdi (bir kez) | `tool` | vg-metrics.js |
| `tool_result` | `tool_use` sonrası sonuç kutusunun metni değişip dolu kaldığında (bir kez) | `tool` | vg-metrics.js |
| `service_cta_click` | Ana sayfa iletişim formuna (`/#iletisim`, `/?hizmet=…#iletisim`) ya da fabrika teklif sihirbazına (`#teklif`) götüren bağlantı tıklandığında, ya da `data-vg-cta` | `to`: iletisim / teklif | vg-metrics.js |
| `quote_start` | Formda ilk gerçek giriş (input/change, isTrusted). Odaklanma tek başına sayılmaz | `form`: iletisim / teklif, cihaz, `src` (önceki site içi sayfa yolu), `tas`: sonuc / yok | vg-metrics.js `vgTrack.form` |
| `quote_step` | Teklif sihirbazında "İleri" doğrulamayı geçip n. adıma geçildiğinde | `form`, `step` (2–9) | `js/factory.js` |
| `quote_validation_error` | Gönderim / ileri denemesinde istemci doğrulamasına takılan her alan (alan başına bir kez) | `form`, `field` (alan kimliği; değer asla), cihaz | `js/main.js`, factory.js |
| `quote_abandon` | Başlamış ve kabul edilmemiş form sayfadan ayrılırken (pagehide). Tarayıcı kapanırken gönderilemeyebilir: alt sınırdır | `form`, `last` (son alan kimliği ya da `adim-n`), cihaz | vg-metrics.js |
| `quote_submit_fail` | Gönderim sunucuya ulaşmadığında: bağlantı, zaman aşımı, okunamayan yanıt | `form`, `reason`: ag / zaman-asimi / gecersiz-yanit | main.js, factory.js |
| `quote_submit_success` | **Yalnızca sunucu**: `contact.php` talebi doğruladı ve teslim etti (yanıt gönderildikten sonra sayılır). Aynı `requestId` ile tekrar sayılmaz | form türü, hizmet alanı kategorisi (5 sabit değer), özet eklendi mi, `vg_ctx_*` bağlamı | `contact.php` → `vg_metrics_contact_outcome` |
| `quote_server_reject` | **Yalnızca sunucu**: ziyaretçinin düzeltebileceği bir nedenle ret (geçersiz alan, doğrulama, hız sınırı, e-posta servisi). Yöntem/köken gibi bozuk istekler sayılmaz | form türü, hata kodu | contact.php |
| `contact_click` | `tel:`, WhatsApp ya da `mailto:` bağlantısına tıklama (kanal başına bir kez) | `ch`: tel / whatsapp / eposta | vg-metrics.js |
| `newsletter_subscribe` | VoltHaber aboneliği sunucu tarafından onay e-postası gönderildikten sonra | — | `js/volthaber.js` |

`contact_click` yalnızca **iletişim niyetidir**: gerçekleşmiş görüşme, nitelikli müşteri ya da satış olarak sayılmaz ve hiçbir
başarı ölçütüne katılmaz.

Sürüm 1 adları (önbellekteki eski istemciler) çevrilir: `sim_start` → `simulation_run`, `sim_complete` → `task_complete`,
`tool_quote` → `service_cta_click`, `tel_click` / `whatsapp_click` → `contact_click`; `quote_submit` sayılmaz.

### `contact.php` bağlamı (isteğe bağlı, istemci ölçümü açıksa)

`vg_ctx_src` (önceki site içi sayfa yolu; sitede yoksa "(bilinmiyor)"), `vg_ctx_dev` (cihaz sınıfı), `vg_ctx_tas`
(`sonuc`: araç/VoltSim özeti eklendi), `vg_ctx_t` (`1`: test). DNT/GPC açıksa istemci bunları göndermez; kabul edilen talep
yine sayılır ama kaynak ve cihaz "bilinmiyor" görünür. Bu alanlar e-postaya yazılmaz.

## Canlı ve test verisi

Test verisi `metrics/test-days/` altına yazılır ve hiçbir canlı rapora karışmaz:

- istemci: `?vg_test=1` (o sekmede kalır, `?vg_test=0` kapatır) ya da yerel adres (localhost, 127.0.0.1, *.localhost, *.test);
  otomasyon (`navigator.webdriver`) yalnızca test modunda ölçülür;
- sunucu: `VG_METRICS_LIVE_HOSTS` (varsayılan `voltguard.com.tr,www.voltguard.com.tr`) dışındaki her adres, `VG_MAIL_OUTBOX=1`
  önizlemeleri ve `vg_ctx_t=1` talepleri.

Panelde "Canlı veri / Test verisi" düğmesiyle seçilir; test görünümünde uyarı bandı vardır.

## Ne toplanır, ne toplanmaz

| Toplanır (günlük sayaç) | Toplanmaz |
| --- | --- |
| Sayfa yolu (yalnızca sitede var olan sayfalar), site bölümü | IP adresi (yalnızca bellekte, günlük tuzla HMAC'lenip hız sınırı için kullanılır) |
| Kaynak kategorisi ve arama motoru adı | Tam referrer adresi, arama sorgusu, URL sorgu parametreleri |
| Cihaz sınıfı: mobil / tablet / masaüstü | User-Agent, ekran çözünürlüğü, dil, parmak izi |
| Yukarıdaki olayların sayıları ve izinli alanları | Çerez, kalıcı cihaz kimliği, oturum, kullanıcı kimliği |
| Form alanı **kimliği** (ör. `telefon`) ve sunucu hata kodu | Ad, telefon, e-posta, mesaj, serbest metin, dosya, tesis bilgisi, hesaplama girdileri ve sonuç değerleri |
| Bot ve hız sınırına takılan istek sayısı (tek toplam) | Talep numarası (`requestId`), simülasyon özeti içeriği |

Tarayıcıda Do Not Track veya Global Privacy Control açıksa istemci hiç istek göndermez; sunucu da `DNT: 1` / `Sec-GPC: 1`
başlıklı ölçüm isteklerini saymaz. Bot User-Agent'ları yalnızca tek bir toplamda sayılır.

## Gizlilik, izin ve saklama değerlendirmesi

Değerlendirme tarihi 2026-10-24; hukuki görüş değildir, yayından önce KVKK danışmanı / veri sorumlusu temsilcisiyle
doğrulanmalıdır ("Güncel mevzuat doğrulaması gereklidir").

- **Çerez / cihaza erişim:** Kişisel Verileri Koruma Kurumu "Çerez Uygulamaları Hakkında Rehber" (2022, Temmuz 2025
  güncellemesi) analitik çerezleri açık rıza gerektiren grupta sayar. Bu ölçüm çerez ya da kalıcı tanımlayıcı yazmaz ve okumaz;
  `sessionStorage` yalnızca ekibin bilerek açtığı `?vg_test=1` bayrağı ve formun kendi işlevleri (ör. hizmet ön seçimi) için
  kullanılır. Bu nedenle çerez rızası bandı gerektirmediği değerlendirilmiştir; ölçüme bir tanımlayıcı eklenirse bu
  değerlendirme geçersiz olur ve önce rıza mekanizması kurulmalıdır.
- **Kişisel veri:** Günlük toplamlar kişiyle ilişkilendirilemez (anonim veri, KVKK kapsamı dışında kabul edilir). IP adresi
  istek sırasında bellekte, günlük tuzla özetlenir ve hız sınırı için en fazla bir gün saklanır; bu, kötüye kullanımı önleme
  amaçlı meşru menfaate dayalı kısa süreli işlemedir ve aydınlatma metninde (`gizlilik.html`) açıklanmıştır.
- **Aydınlatma:** `gizlilik.html` "Site ölçümü (çerezsiz)" paragrafı bu sürüme göre güncellendi (alan kimliği, sunucu tarafı
  kabul sayımı, DNT durumunda ne sayıldığı).
- **Saklama:** canlı günlük toplamlar 400 gün (yıllık karşılaştırma için), test verisi 30 gün, hız sınırı özetleri 1 gün.
  Doğrulanmış iş sonuçları (aylık toplamlar) silinene kadar tutulur; kişisel veri içermez.

## Dosyalar (özel veri dizini, `vg-data/metrics/`)

```
metrics/
  days/YYYY-MM-DD.json       canlı günlük toplamlar (şema v2; v1 dosyaları okunurken çevrilir; 400 gün)
  test-days/YYYY-MM-DD.json  test günlük toplamları (30 gün)
  rl/YYYY-MM-DD.json         günün hız sınırı sayaçları (tuzlu özet anahtar → sayı); önceki günler silinir
  admins.json                büyüme paneli yetkili üye kimlikleri
  outcomes.json              doğrulanmış iş sonuçları ve değişiklik kaydı (CLI ile)
  popular.json               "Popüler araçlar" önbelleği (1 saat, yalnızca canlı veri)
  store.lock, gc.last
```

Günlük tuz `HMAC(secret.key, "vg-metrics-daily-salt|tarih")` ile bellekte türetilir ve diske yazılmaz. Özetlenmiş anahtarlar
en geç ertesi gün silindiği için geriye dönük eşleme verisi kalmaz. Sınır: tuz `secret.key` dosyasından yeniden
türetilebildiği için o günün özet dosyasına ve `secret.key` dosyasına birlikte erişen biri IPv4 adres uzayını deneyerek o günün
adreslerini bulabilir; bu nedenle veri dizininin erişimi sınırlı tutulmalıdır. Özetler anonim değil, kısa ömürlü takma adlardır.
Anahtar IPv4 adresi ya da IPv6 /48 bloğudur.

## Uç noktalar

| İşlem | Yöntem | Not |
| --- | --- | --- |
| `collect` | POST `text/plain` veya `application/json`, ≤ 4 KB, ≤ 20 olay, `{v:1|2, t?:1, ev:[…]}` | Aynı köken (Origin/Referer, Sec-Fetch-Site); IP özeti başına 10 dk'da 120, günde 1500 olay |
| `popular` | GET | Son 30 gün canlı veri, toplam ≥ 20 kullanım ve araç başına ≥ 3 ise liste; aksi hâlde boş |
| `dashboard` | GET `?days=7|30|90|365&mode=live|test` | VGSESS oturumu + `X-VG-CSRF` + aynı köken + `admins.json`; dakikada 60 istek |

## Yönetim ekranı (`/hesap/buyume-paneli.html`)

Ölçüm dönemi ve veri kapsamı (veri olan/olmayan gün, huni olaylarının başladığı gün, bot ve hız sınırı, eski olaylar),
akış adımları, backend tarafından kabul edilen talepler (form, hizmet alanı, özet, cihaz), teklif akışına geçiş sağlayan
sayfalar, formda hata / terk edilen adımlar / sunucu redleri, en çok kullanılan araç ve simülasyonlar, simülasyon çalıştırma
hataları, iletişim niyeti, doğrulanmış iş sonuçları, hipotezler. Veri yoksa "Veri henüz mevcut değil"; paydası 30'dan küçük
oranlar "düşük örneklem" olarak işaretlenir. Google Search Console bağlı değildir ve tahmin edilmez.

## Nitelikli teklif ve kazanılan iş

Bu sayılar sitenin ölçümünden çıkarılamaz ve tahmin edilmez. Çalışan uygulamasındaki teklif arşivinde web talebiyle eşleşen
"nitelikli / kazanıldı" durumu bulunmadığından (2026-10-24) otomatik aktarım yoktur. İş takip sisteminden alınan ya da yetkili
kişinin doğruladığı aylık toplamlar elle girilir ve panelde ayrı gösterilir:

```sh
php tools/metrics-admin.php outcome set 2026-10 --source is-takip|yetkili --by "Satış sorumlusu" --qualified 3 --won 1
php tools/metrics-admin.php outcome list
php tools/metrics-admin.php outcome remove 2026-10
```

## İyileştirme hipotezleri ve önceden tanımlı başarı ölçütleri

Kurallar (sonuç görülmeden önce sabitlenir, sonradan değiştirilmez):

- Değişiklik yayına alındığı gün kaydedilir: `php tools/metrics-admin.php change add 2026-11-15 "H2: hizmet sayfası teklif çağrısı"`.
  Panel değişiklikten önceki 28 gün ile sonraki 28 günü karşılaştırır. Aynı dönemde iki değişiklik yapılırsa etkiler ayrışmaz.
- Birincil ölçüt iki oran z-testi ile değerlendirilir: α = 0,05 (çift yönlü), güç %80. Gereken payda tabandan hesaplanır;
  iki dönemde de gereken paydaya ulaşılmazsa "Yetersiz örneklem — karar verilmez". Sonuç önce/sonra karşılaştırmasıdır,
  nedensellik kanıtı ya da trafik/satış artışı garantisi değildir; mevsimsellik ve trafik karışımı ayrıca incelenir.
- Telefon/WhatsApp tıklaması hiçbir hipotezde başarı sayılmaz.

| | Değişiklik | Birincil ölçüt (başarı: tabana göre göreli artış) | İkincil | Koruma ölçütü |
| --- | --- | --- | --- | --- |
| H1 | VoltSim sonucundan, ziyaretçi onayıyla teklif sihirbazına özet aktarımı | Özet eklenmiş kabul edilen talep / `simulation_result` — en az %50 | Özet eklenmiş `quote_start` / `simulation_result` | Teklif sihirbazı sunucu reddi oranı artmamalı; doğrulanmış kayıt varsa nitelikli oran düşmemeli |
| H2 | Hizmet sayfasında daha anlaşılır teklif çağrısı | `service_cta_click` / hizmet sayfası görüntüleme — en az %30 | Hizmet sayfası kaynaklı kabul edilen talep / hizmet sayfası görüntüleme | Organik pay dönemler arasında 10 puandan fazla değiştiyse yorumlanmaz |
| H3 | Mobil formdaki gereksiz alanların azaltılması | Mobil kabul edilen talep / mobil `quote_start` — en az %30 | Mobil alan hatası ve terk / mobil başlangıç | Masaüstü tamamlama oranı ve sunucu reddi kötüleşmemeli; nitelikli oran (varsa) düşmemeli |

Önce en az 28 günlük taban toplanmalıdır; değişiklikler bu tabandan önce yayına alınırsa karşılaştırılacak dönem kalmaz.

## Test

- `node tools/tests/metrics-api.test.cjs` (VG_PHP ile): olay sözlüğü, eski adlar, canlı/test ayrımı, sunucu tarafı kabul ve
  tekrar koruması, kişisel verinin hiçbir ölçüm dosyasına girmemesi, panel yetkisi, doğrulanmış sonuç ve değişiklik kaydı.
- `node tools/tests/metrics-funnel-browser.cjs [--shots <klasör>]`: gerçek Chrome ile hizmet sayfası → teklif çağrısı →
  form hatası → backend kabulü, VoltSim, hesap aracı, mobil sihirbaz terki, telefon tıklaması; verinin yalnızca test kovasına
  yazıldığı ve panelin test modunda 1280/390 px'de taşmadan açıldığı.
- `node tools/tests/growth-browser.cjs`: araç sayfaları ve panel girişi.
