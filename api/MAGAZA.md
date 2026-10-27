# VoltGuard Mağaza (e-ticaret) — tasarım ve işletim belgesi

`/magaza/` altında elektrik ve güneş enerjisi ürünleri satılır. Ödeme yalnızca **havale/EFT** ile alınır
(kredi kartı yok). Fiyatlar **USD olarak tutulur** (sahibin kararı, 27.10.2026: "dolar olarak tutalım, sayfada TL
gösterelim; TL'den zarar etmeyelim, fiyatlarımız günlük dolara göre güncellensin"): ürünün satış fiyatı ABD doları
(KDV hariç) olarak hesaplanır, müşteriye TCMB'nin son yayımladığı **USD döviz satış kuru** ile **Türk lirası, KDV
dahil** gösterilir; kur her gün güncellendikçe TL fiyatlar kendiliğinden güncellenir ve sipariş anında TL tutar
sabitlenir (6502 sayılı TKHK md. 54: fiyat TL ve tüm vergiler dahil gösterilir). Müşteriye USD tutar gösterilmez;
USD yalnızca fiyat motorunda, personel panelinde ve sipariş kaydında tutulur. Bu dosya web'den okunamaz
(`.htaccess` `*.md` engeller).

## Temel kurallar (sahibinin talepleri)

1. **Şikâyeti çok olan tedarikçi kullanılmaz.** Tedarikçi listesi Şikayetvar incelemesinden geçer; elenen site
   `kaynaklar.json`'a giremez (`tools/magaza-admin.php` içe aktarmada reddeder).
2. **Ürün görselinde ürünün kendi markası dışında hiçbir site/mağaza adı, filigran, URL veya telefon olamaz.**
   Görseller tercihen üreticinin resmî görselleridir; her görselin kaynağı özel `gorsel-kaynaklari.json`'da tutulur.
3. **Ödeme yalnızca havale/EFT:** Voltguard Elektrik Elektronik Ve Mekanik Müh.Ltd.Şti. — Enpara Bank A.Ş. —
   TR85 0015 7000 0000 0204 9277 72. Açıklamaya sipariş numarası yazılır.
4. **Fiyat her zaman güncel:** tedarikçi fiyatı en geç 48 saat önce doğrulanmamış ürün sepete eklenemez ve sipariş
   verilemez ("Fiyat teyidi bekleniyor — teklif isteyin"). Sepet adımında 6 saatten eski fiyatlar canlı olarak yeniden
   kontrol edilir. Kur 10 günden eskiyse sipariş alınmaz.
5. **Depo herkese açıktır (GitHub public).** Tedarikçi adresleri, alış fiyatları, kâr marjı ve siparişler ASLA git'e
   girmez; yalnızca sunucunun özel veri klasöründe (`vg_data_dir()/magaza/`) durur. Herkese açık API ve sayfalar da
   tedarikçi bilgisi döndürmez (testler bunu denetler).

## iyzico üye işyeri kriterleri (kredi kartı için hazırlık, 27.10.2026)

Sahibin hedefi: mağaza VoltGuard'ın "imza işi" ve pasif gelir kaynağı olacak; kart ödemesi iyzico ile açılacak.
iyzico'nun istediği site kriterleri ve karşılıkları:

| Kriter | Karşılık |
| --- | --- |
| Hakkımızda sayfası | `/hakkimizda.html` (mevcut) |
| SSL sertifikası | HTTPS zorunlu + HSTS (`.htaccess`) |
| Teslimat ve İade Şartları | `/magaza/odeme-ve-teslimat.html`, `/magaza/iade-ve-cayma.html` |
| Gizlilik Sözleşmesi | `/gizlilik.html` + `/magaza/kvkk-aydinlatma.html` |
| Mesafeli Satış Sözleşmesi | `/magaza/mesafeli-satis-sozlesmesi.html` (+ siparişe özel metin) |
| Visa / MasterCard ve "iyzico ile Öde" logoları | Ortak alt bilgide `public/magaza/odeme/logo_band_white.svg` (iyzico'nun resmî logo paketi) |

Kart ödemesi açılana kadar logoların yanında "Kredi kartı ile ödeme iyzico güvencesiyle yakında; şu an havale/EFT"
notu durur (müşteri yanıltılmaz). iyzico onayından sonra ödeme adımına "Kart ile öde" seçeneği eklenecek (ayrı iş).

## Dosyalar

| Dosya | İçerik |
| --- | --- |
| `api/magaza.php` | JSON API giriş noktası |
| `api/lib/magaza.php` | Depolama (kilit + atomik yazma), katalog, yapılandırma, fiyat motoru, kur, sipariş, yetki |
| `api/lib/magaza-api.php` | Yönlendirici; herkese açık ve panel işlemleri |
| `api/lib/magaza-kaynak.php` | SSRF korumalı getirme, teklif ayrıştırma (JSON-LD/microdata/OG/platform), TCMB kuru |
| `api/lib/magaza-render.php` | Sunucu tarafı sayfa üretimi (vitrin, kategori, ürün, sitemap) |
| `api/lib/magaza-belge.php` | Ön bilgilendirme formu, mesafeli satış sözleşmesi ve sipariş e-postaları (tek kaynak) |
| `api/lib/magaza-cron.php` | Zamanlanmış fiyat/kur kontrolü (yalnızca CLI; deploy edilir, web'e kapalı) |
| `api/lib/magaza/katalog.json` | Herkese açık ürün içeriği (git'te; tedarikçi bilgisi YOK) |
| `api/lib/magaza/firma.json` | Satıcı kimliği, banka bilgisi, belge sürümü (git'te) |
| `magaza/index.php` | `/magaza/`, `/magaza/kategori/<id>/`, `/magaza/urun/<slug>/`, `/magaza/sitemap.xml` |
| `magaza/index.html` | `tools/shell.py` ile senkron şablon (`<!--vgm:meta-->`, `<!--vgm:main-->`); PHP yoksa statik yedek |
| `magaza/sepet.html`, `odeme.html`, `siparis-takip.html` | İstemci tarafı sepet, ödeme ve sipariş takibi (noindex) |
| `magaza/odeme-ve-teslimat.html`, `iade-ve-cayma.html`, `mesafeli-satis-sozlesmesi.html`, `on-bilgilendirme-formu.html`, `kvkk-aydinlatma.html` | Hukuki sayfalar (taslak; hukuki inceleme gerekir) |
| `css/magaza.css`, `js/magaza.js` | Mağaza stili (yalnızca `--th-*` tokenları) ve davranışı (`window.VGMagaza`) |
| `hesap/magaza-panel.html`, `js/hesap-magaza-panel.js` | Personel paneli (üye oturumu + sunucuda atanmış mağaza yetkisi) |
| `tools/magaza-admin.php` | CLI: yetki ver/al, kaynak içe aktar, sipariş listele, durum |
| `tools/magaza/` | Katalog doğrulayıcı, görsel hazırlama, yerel kaynak okuyucu |
| `public/magaza/` | Ürün görselleri (içerik özetli dosya adları; 1 yıl immutable önbellek) |

## Veri

### Herkese açık katalog — `api/lib/magaza/katalog.json`

```json
{
  "version": 1,
  "categories": [
    {"id": "gunes-panelleri", "name": "Güneş Panelleri", "title": "Güneş Paneli Fiyatları",
     "intro": "Özgün kısa tanıtım (1–3 cümle).", "order": 10}
  ],
  "products": [
    {
      "id": "vgm-0001",
      "slug": "ornek-marka-ornek-model-580w-gunes-paneli",
      "name": "Örnek Marka ÖM-580 580 W Güneş Paneli",
      "brand": "Örnek Marka",
      "mpn": "OM-580",
      "gtin": null,
      "category": "gunes-panelleri",
      "summary": "En fazla 160 karakter, özgün.",
      "description": ["Özgün paragraf 1.", "Özgün paragraf 2."],
      "specs": [["Anma gücü", "580 W"], ["Hücre tipi", "N-tipi TOPCon"]],
      "images": [{"src": "/public/magaza/ornek-om-580.1a2b3c4d.webp", "thumb": "/public/magaza/ornek-om-580.1a2b3c4d-400.webp",
                  "w": 800, "h": 800, "alt": "Örnek Marka ÖM-580 güneş paneli önden görünüm"}],
      "documents": [{"title": "Üretici veri sayfası (PDF)", "url": "https://uretici.example/om-580.pdf"}],
      "unit": "adet",
      "vat": 20,
      "shipping": "kargo",
      "maxQty": 50,
      "listUsd": 112.40,
      "listCheckedAt": "2026-10-27T11:00:00Z",
      "related": ["vgm-0002"]
    }
  ]
}
```

- `id`: `vgm-NNNN`, kalıcı; silinen ürünün kimliği yeniden kullanılmaz. `slug`: `[a-z0-9-]{3,90}`, benzersiz.
- `description`, `summary`, kategori `intro`: **özgün** metin (tedarikçi metni kopyalanmaz). Teknik veriler (`specs`)
  üretici belgesinden alınır.
- `documents[].url` yalnızca üreticinin resmî alan adı olabilir.
- `shipping`: `kargo` (sepete eklenir) veya `nakliye` (ağır/hacimli; çevrim içi sipariş yerine "Nakliye dahil teklif iste").
- `listUsd` (KDV hariç) ve `listCheckedAt`: katalog hazırlanırken doğrulanmış fiyat. Yalnızca sunucu fiyat durumu
  yoksa gösterilir; sipariş için tek başına yeterli değildir (48 saat kuralı geçerlidir).

### Satıcı kimliği — `api/lib/magaza/firma.json`

`unvan`, `kisaAd`, `adres`, `il`, `telefon`, `eposta`, `mersis`, `vkn`, `vergiDairesi`, `ticaretSicil`, `kep`,
`etbis` (kayıt bilgisi), `banka: {ad, hesapSahibi, iban, paraBirimi}`, `belgeSurumu` (ör. `"2026-10-27"`).
Zorunlu alanlardan biri `null` ise **mağaza siparişe kapalıdır** (`vgm_shop_open()`); sayfalar fiyatı gösterir ama
sepete ekleme yerine "Siparişe yakında açılacak" ve teklif bağlantısı çıkar.

### Özel veri — `vg_data_dir()/magaza/` (0700/0600, tek kilit `store.lock`, atomik yazma)

- `kaynaklar.json` (yalnızca `tools/magaza-admin.php import` ile yazılır):
  ```json
  {"version": 1, "open": false,
   "margin": {"default": 0.15, "byCategory": {}, "byProduct": {}},
   "shipping": {"feeTry": 0, "freeOverTry": 0},
   "paymentHours": 24, "fxBuffer": 0,
   "sources": {"vgm-0001": [{"url": "https://tedarikci.example/urun", "supplier": "tedarikci.example",
                              "vatIncluded": true, "currency": "TRY", "priority": 1, "discount": 0}]},
   "blockedSuppliers": ["sikayeti-cok.example"]}
  ```
  `open` sahibin bilinçli kararıdır (hukuki inceleme + ETBİS kaydı sonrası). `blockedSuppliers` içindeki alan adı hiçbir
  kaynakta kullanılamaz. `discount` (0–0,5) tedarikçiyle anlaşılan bayi indirimidir: maliyet = sitedeki fiyat × (1 − discount).
- `fiyatlar.json` — ürün başına son kontrol: `status` (`ok`|`held`|`error`|`unavailable`), `costTry` (tedarikçinin KDV
  dahil TL fiyatı, normalize), `costUsd` (KDV hariç, kontrol anındaki kurla), `rateAtCheck`, `checkedAt`, `source`
  (kaynak sırası), `method`, `available`, `note`, `held` (`{costTry, prevCostTry, at}`), `history` (son 20 kayıt).
  Kök: `lastRunAt`, `lastRunSummary`.
- `kur.json` — `{usdTry, date: "YYYY-MM-DD", fetchedAt, source: "TCMB today.xml ForexSelling"}`.
- `siparisler.json` — tüm siparişler (aşağıda). `istekler/` — sipariş tekrar korumasının HMAC adlı kayıtları.
- `panel.json` — mağaza paneline yetkili üye kimlikleri.
- `gorsel-kaynaklari.json` — görsel başına kaynak adresi ve kontrol notu (git'e girmez).

## Fiyat motoru

Ürün `p`, durum `s = fiyatlar[p.id]`, kur `r`, marj `m` (ürün > kategori > varsayılan):

```
costUsdNet = s.costTry / (1 + p.vat/100) / s.rateAtCheck          (tedarikçi USD veriyorsa doğrudan USD)
usdNet     = round2(costUsdNet * (1 + m))                         ← satış fiyatı, KDV hariç, USD
tryNet     = round2(usdNet * r.usdTry * (1 + fxBuffer))
tryGross   = round2(tryNet * (1 + p.vat/100))                     ← gösterilen ve tahsil edilen fiyat
```

Sipariş verilebilirlik (`orderable`): mağaza açık **ve** `s.status === 'ok'` **ve** `s.available` **ve**
`now - s.checkedAt <= 48 saat` **ve** `now - r.fetchedAt <= 10 gün` **ve** `p.shipping === 'kargo'` **ve**
tedarikçi `blockedSuppliers` içinde değil. Aksi halde `reason`: `closed`, `stale`, `held`, `error`, `unavailable`,
`no_rate`, `no_source`, `freight`.

Fiyat kontrolü (cron ve canlı yeniden kontrol): kaynak `priority` sırasıyla denenir, ilk geçerli teklif alınır.
Önceki kabul edilmiş `costTry`'a göre **±%25'ten büyük değişim** `held` olur (yanlış ayrıştırma veya kampanya fiyatı
canlıya çıkmasın); personel panelden onaylar veya reddeder. Ayrıştırma birden fazla çelişen fiyat bulursa `error`.
Getirme kimliği dürüsttür: `VoltGuardFiyat/1.0 (+https://voltguard.com.tr/magaza/)`; tarayıcı taklidi yapılmaz.
Aynı sunucuya istekler arasında en az 2 sn beklenir. Engelleyen tedarikçinin ürünleri panelde "elle doğrula" ile
(fiyat + not + kontrol eden kişi) güncellenebilir.

## Uç noktalar — `api/magaza.php?action=…`

Zarf: `{"api":"vg-auth/1","ok":true|false,"service":"vg-magaza/1",...}`. Hata: `{"ok":false,"error":kod,"message":…}`.

Herkese açık:
- `fiyatlar` (GET): `{rate:{date}, open, items:{id:{tryNet,tryGross,checkedAt,orderable,reason}}}` (müşteriye USD tutar
  dönmez; USD yalnızca panel yanıtlarında).
- `sepet` (POST JSON `{items:[{id,qty}]}`): canlı yeniden kontrol (toplam 8 sn, en çok 6 getirme), satırlar,
  toplamlar (`tryNet, tryVat, shippingTry, tryGross, usdNet`), uyarılar ve 30 dk geçerli imzalı `quote` jetonu
  (HMAC: kalemler + birim fiyatlar + kur + bitiş). Sipariş verilemeyen satır jetona girmez.
- `onbilgi` (POST JSON `{quote, customer, billing, shippingAddress}`): o siparişe ait doldurulmuş ön bilgilendirme
  formu ve mesafeli satış sözleşmesi metni (ödeme sayfası bunu gösterir; e-postadaki metinle birebir aynıdır).
- `siparis` (POST JSON): `requestId` (tekrar koruması), `quote`, `customer {name,email,phone}`,
  `billing {type: bireysel|kurumsal, name, tckn?, company?, taxOffice?, vkn?, address, city, district}`,
  `shippingAddress {name, phone, address, city, district, postalCode?}`, `notes`, `consents {preInfo:true, contract:true}`,
  `website` (bal küpü, boş), `formTimestamp`, `turnstile` (yapılandırılmışsa). Jeton geçersiz/süresi dolmuşsa 409
  `quote_expired` (istemci yeniden fiyat alır). Başarılı yanıt: `reference` (`VGS-yymmdd-XXXXX`), `amountTry`,
  `payBy`, `bank {ad, hesapSahibi, iban}`, `message`. Müşteriye ve info@voltguard.com.tr'ye e-posta gider
  (personel e-postası tedarikçi bağlantılarını içerir; müşteri e-postası içermez).
- `durum` (POST JSON `{reference, email}`): durum, geçmiş (iç notlar hariç), kargo takip bilgisi. Eşleşmezse genel
  hata; IP başına hız sınırı.

Panel (oturum `VGSESS` + Origin + `X-VG-CSRF` + `panel.json` yetkisi): `panel_me`, `panel_orders`, `panel_order`,
`panel_order_update` (`status`, `note`, `tracking`, `notify`), `panel_prices`, `panel_price_decide`
(`id`, `decision: approve|reject|manual`, `costTry?`, `note`), `panel_status` (cron kalp atışı, kur, özet),
`panel_export` (CSV, muhasebe için).

Sipariş durumları: `odeme_bekleniyor` → `odeme_alindi` → `tedarikte` → `kargoda` (takip no) → `teslim_edildi`;
her aşamadan `iptal` (gerekçe zorunlu); `teslim_edildi` → `iade`. Geçersiz geçiş 409.

## Sayfalar

- `/magaza/` vitrin: kategori ızgarası, tüm ürünler (istemci tarafı arama/filtre/sıralama), güven şeridi
  (havale/EFT, günlük güncel fiyat, faturalı satış, mühendis desteği).
- `/magaza/kategori/<id>/`: özgün giriş metni + ürün ızgarası.
- `/magaza/urun/<slug>/`: görseller, marka/model/GTIN, fiyat kutusu (yalnızca TL, KDV dahil; fiyat kontrol zamanı ve
  "Fiyatlar her gün TCMB döviz kuruyla güncellenir" notu; USD gösterilmez), sepete ekle, teknik özellikler, özgün
  açıklama, üretici belgeleri, teslimat ve iade özeti, "Mühendisimize sorun" bağlantısı. JSON-LD `Product` + `Offer`
  (TRY, render anındaki fiyat) + `BreadcrumbList`.
- Sepet/ödeme/takip sayfaları `noindex`. Ürün görsel kutusu koyu temada açık zemin (`.th-paper`).
- `/magaza/sitemap.xml` PHP ile; `robots.txt` bu haritayı bildirir.

## Kurulum (sunucu)

1. `firma.json` eksiklerini doldurun (MERSİS, VKN, vergi dairesi, tam adres, ETBİS) ve hukuki metinleri avukata
   kontrol ettirin.
2. Özel kaynak dosyasını yükleyin: `VG_DATA_DIR=/home/voltgua2/vg-data php tools/magaza-admin.php import kaynaklar.json`.
3. Cron (cPanel → Cron Jobs; depo kurmaz):
   `0 */6 * * * VG_DATA_DIR=/home/voltgua2/vg-data /usr/local/bin/php /home/voltgua2/public_html/api/lib/magaza-cron.php >/dev/null 2>&1`
4. Panel yetkisi: `php tools/magaza-admin.php grant <uye-eposta>`; `/hesap/magaza-panel.html`.
5. Her şey hazırsa `kaynaklar.json` içinde `"open": true` yapıp yeniden içe aktarın.

## Sipariş kaydı (`siparisler.json` → `orders[ref]`)

```
{ref, createdAt, payBy, status,
 customer {name, email, phone},
 billing {type: bireysel|kurumsal, name, tckn, company, taxOffice, vkn, address, city, district},
 shippingAddress {name, phone, address, city, district, postalCode},
 notes,
 items [{id, name, brand, mpn, qty, unit, vat, unitUsdNet, unitTryNet, unitTryGross, lineTryNet, lineTryGross}],
 totals {tryNet, tryVat, shippingTry, tryGross, usdNet}, rate {usdTry, date},
 consents {preInfo: ts, contract: ts, docVersion, ipHash},
 docs {preInfo: metin, contract: metin},        ← müşterinin onayladığı metnin kendisi (kalıcı kayıt)
 history [{at, status, by, note (iç), publicNote}],
 tracking null | {company, code, url},
 private {sources {id: [{supplier, url, costTry, checkedAt}]}}}   ← ASLA herkese açık yanıtta yok
```

`vgm_order_public()` müşteriye gösterilebilecek alanları döndürür (iç not, `private`, maliyet yok).

## Modül sözleşmeleri

`api/lib/magaza.php` (çekirdek; hazır): depolama `vgm_dir/vgm_locked/vgm_read/vgm_write`, katalog `vgm_catalog/
vgm_product/vgm_product_by_slug/vgm_category`, satıcı `vgm_firma/vgm_firma_missing/vgm_iban_valid`, yapılandırma
`vgm_config/vgm_config_clean/vgm_margin/vgm_shop_open/vgm_sources/vgm_host`, durum `vgm_prices_state/vgm_rate_state/
vgm_rate_ok`, fiyat `vgm_price/vgm_reason_text/vgm_apply_check/vgm_decide_held/vgm_round2`, sepet `vgm_cart_items/
vgm_quote/vgm_token_encode/vgm_token_decode`, sipariş `vgm_reference/vgm_reference_valid/vgm_order_once/
vgm_orders_read/vgm_orders_write/vgm_transition_ok/vgm_order_public`, panel `vgm_panel_state/vgm_is_panel`,
biçim `vgm_fmt_try/vgm_fmt_usd/vgm_local`. Testler `VG_MAGAZA_CATALOG` ve `VG_MAGAZA_FIRMA` ile
`tools/tests/fixtures/magaza/` altındaki sentetik katalog ve satıcıyı kullanır.

`api/lib/magaza-kaynak.php`: `vgm_fetch(url, allowHosts, &why, &status): string`, `vgm_parse_offer(html, url): array`
(`ok, price, currency, available, name, brand, gtin, mpn, sku, image, method, candidates, error`),
`vgm_fetch_offer(src, product): array` (vgm_apply_check'e uygun teklif — `discount` kaynaktan aynen geçer — veya `{error, gone}`),
`vgm_fetch_rates(&why): ?array` (`usdTry, eurTry, date, fetchedAt, source`), `vgm_refresh(opts): array`
(cron ve canlı kontrol; ağ işlemi kilit DIŞINDA, her ürünün sonucu kısa yazma kilidiyle işlenir).
Test modu: `VG_MAGAZA_FIXTURE_DIR` verilirse ağ yerine `<dizin>/<sha1(url)>.html` okunur (`tcmb-today.xml` kur için).

`api/lib/magaza-siparis.php`: `vgm_order_create(input, now): array` (`{order, duplicate}`; doğrulama, jeton, tekrar
koruması, kayıt ve e-postalar), `vgm_order_get(ref): ?array` (tam kayıt), `vgm_order_update(ref, change, actor, now): array`
(`change = {status?, note?, publicNote?, tracking?: {company, code, url?}, notify: bool}`, `actor = {id, name}`; güncel
kaydı döndürür), `vgm_order_lookup(ref, email): ?array` (müşteri görünümü), `vgm_orders_list(filter): array`
(`filter = {status?, q?, page?}` → `{orders, total, page, pages, counts}`), `vgm_orders_csv(filter): string`.
Panel yetkisi çekirdekte: `vgm_panel_grant(userId, email, now)`, `vgm_panel_revoke(userId)`, `vgm_panel_list()`.
API ve `tools/magaza-admin.php` aynı fonksiyonları kullanır.

`api/lib/magaza-belge.php`: `vgm_doc_context(order, firma, config)`, `vgm_doc_preinfo(ctx)`, `vgm_doc_contract(ctx)`,
`vgm_mail_order_customer(order, ctx)`, `vgm_mail_order_staff(order)`, `vgm_mail_status(order, publicNote)`.

### Panel API yanıtları

- `panel_me` → `{user:{id,name}|null, panel:bool, csrf}`
- `panel_orders` (`?status=&q=&page=`) → `{orders:[{ref, createdAt, status, statusLabel, customerName, city, amountTry,
  itemCount, payBy, overdue}], total, page, pages, counts:{durum: adet}}`
- `panel_order` (`?ref=`) → `{order: tam kayıt (private dahil), allowed: [sonraki durumlar]}`
- `panel_order_update` (POST `{ref, status?, note?, publicNote?, tracking?:{company, code, url?}, notify:bool}`) → `{order}`
- `panel_prices` → `{rate, lastRunAt, lastRunSummary, items:[{id, name, category, status, costTry, usdNet, tryGross,
  checkedAt, lastAttemptAt, orderable, reason, held, note, sources:[{supplier, url}]}]}`
- `panel_price_decide` (POST `{id, decision: approve|reject|manual, costTry?, available?, note}`) → `{item}`
- `panel_check_now` (POST `{id}`) → `{item}` (tek ürün canlı kontrol; hız sınırlı)
- `panel_status` → `{open, firmaMissing, rate:{usdTry,date,fetchedAt,ok}, cron:{lastRunAt, healthy}, counts, orders:{awaitingPayment, overdue}}`
- `panel_export` (POST `{from?, to?}`) → CSV (muhasebe/e-Arşiv için)

## Testler

`tools/tests/magaza-*.test.cjs` (gerçek PHP, geçici veri klasörü, e-posta `outbox/`): fiyat motoru, 48 saat kuralı,
`held` akışı, jeton kurcalama/süre, sipariş tekrar koruması, kapalı mağaza, durum sorgusu, sızıntı denetimi
(herkese açık yanıt ve sayfalarda tedarikçi alan adı/maliyet yok), ayrıştırıcı örnek sayfaları, sayfa üretimi.
