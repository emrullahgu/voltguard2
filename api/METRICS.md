# VoltGuard birinci taraf ölçüm (`api/metrics.php`)

Çerezsiz, anonim, yalnızca günlük toplam tutan ziyaret ve dönüşüm ölçümü. Üçüncü taraf izleyici yoktur.

## Ne toplanır, ne toplanmaz

| Toplanır (günlük sayaç) | Toplanmaz |
| --- | --- |
| Sayfa yolu (yalnızca sitede var olan sayfalar), site bölümü | IP adresi (yalnızca bellekte, günlük tuzla HMAC'lenip hız sınırı için kullanılır) |
| Kaynak kategorisi: arama / sosyal / doğrudan / diğer / site içi; arama motoru adı | Tam referrer adresi, arama sorgusu |
| Cihaz sınıfı: mobil / tablet / masaüstü | User-Agent, ekran çözünürlüğü, dil, parmak izi |
| Olay sayıları: `sim_start`, `sim_complete`, `tool_use`, `tool_quote`, `quote_submit` (+ hizmet, araçtan mı), `whatsapp_click`, `tel_click`, `newsletter_subscribe`, VoltHaber (/volthaber/) görüntüleme | Çerez, localStorage kimliği, oturum, kullanıcı kimliği |
| Bot ve hız sınırına takılan istek sayısı (tek toplam) | Form içerikleri, hesaplama girdileri |

Tarayıcıda Do Not Track veya Global Privacy Control açıksa istemci hiç istek göndermez; sunucu da `DNT: 1` / `Sec-GPC: 1`
başlıklı istekleri saymaz. Otomasyon (`navigator.webdriver`) ve bot User-Agent'ları sayılmaz.

## Dosyalar (özel veri dizini, `vg-data/metrics/`)

```
metrics/
  days/YYYY-MM-DD.json   günlük toplamlar (400 gün saklanır, sonra silinir)
  rl/YYYY-MM-DD.json     günün hız sınırı sayaçları (tuzlu özet anahtar → sayı); önceki günler silinir
  admins.json            büyüme paneli yetkili üye kimlikleri
  popular.json           "Popüler araçlar" önbelleği (1 saat)
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
| `collect` | POST `text/plain` veya `application/json`, ≤ 4 KB, ≤ 20 olay | Aynı köken (Origin/Referer, Sec-Fetch-Site); IP özeti başına 10 dk'da 120, günde 1500 olay |
| `popular` | GET | Son 30 gün, toplam ≥ 20 kullanım ve araç başına ≥ 3 ise liste; aksi hâlde boş. `Cache-Control: public, max-age=3600` |
| `dashboard` | GET `?days=7|30|90|365` | VGSESS oturumu + `X-VG-CSRF` + aynı köken + `admins.json`; dakikada 60 istek |

## Yönetici atama (sunucu terminali)

```sh
export VG_DATA_DIR=/home/voltgua2/vg-data
php tools/metrics-admin.php grant u0123456789abcdef01234567   # üye kimliği: hesap dışa aktarma JSON'undaki user.id
php tools/metrics-admin.php list
php tools/metrics-admin.php revoke u0123456789abcdef01234567
```

Panel: `/hesap/buyume-paneli.html` (noindex; giriş gerektirir). Google Search Console verisi panele bağlı değildir;
panel bu değerleri tahmin etmez ("Veri henüz mevcut değil").

## Test

`node tools/tests/metrics-api.test.cjs` (VG_PHP ile), tarayıcı: `node tools/tests/growth-browser.cjs`.
