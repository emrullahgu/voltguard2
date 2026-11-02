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
| `api/lib/magaza/katalog/` | Herkese açık ürün kataloğu v2, parçalı (git'te; tedarikçi bilgisi YOK; yalnızca `tools/magaza/katalog-derle.cjs` yazar) |
| `api/lib/magaza/firma.json` | Satıcı kimliği, banka bilgisi, belge sürümü (git'te) |
| `magaza/index.php` | `/magaza/`, `/magaza/kategori/<id>/[?marka=&sirala=&sayfa=]`, `/magaza/urun/<slug>/`, `/magaza/ara/?q=`, `/magaza/sitemap.xml` (dizin) ve `/magaza/sitemap-<n>.xml` |
| `magaza/index.html` | `tools/shell.py` ile senkron şablon (`<!--vgm:meta-->`, `<!--vgm:main-->`); PHP yoksa statik yedek |
| `magaza/sepet.html`, `odeme.html`, `siparis-takip.html` | İstemci tarafı sepet, ödeme ve sipariş takibi (noindex) |
| `magaza/{on-bilgilendirme-formu,mesafeli-satis-sozlesmesi,iade-ve-cayma,kvkk-aydinlatma,odeme-ve-teslimat}.html` | Hukuki sayfalar; `magaza/index.php` (`vgmr_render_legal_html`) `<!--vgm:satici-dl-->`, `<!--vgm:belge-meta-->`, `<!--vgm:adres-->` işaretlerini `firma.json`'dan doldurur (boş alanın satırı basılmaz); dosyadaki metin PHP'siz yedek |
| `magaza/odeme-ve-teslimat.html`, `iade-ve-cayma.html`, `mesafeli-satis-sozlesmesi.html`, `on-bilgilendirme-formu.html`, `kvkk-aydinlatma.html` | Hukuki sayfalar (taslak; hukuki inceleme gerekir) |
| `css/magaza.css`, `js/magaza.js` | Mağaza stili (yalnızca `--th-*` tokenları) ve davranışı (`window.VGMagaza`) |
| `hesap/magaza-panel.html`, `js/hesap-magaza-panel.js` | Personel paneli (üye oturumu + sunucuda atanmış mağaza yetkisi) |
| `tools/magaza-admin.php` | CLI: yetki ver/al, kaynak içe aktar (parçalar), sipariş listele, durum, kontrol, `gorsel-yukle` |
| `tools/magaza/katalog-derle.cjs`, `katalog-dogrula.cjs`, `katalog-ortak.cjs` | Katalog yazıcısı, doğrulayıcı ve ortak çekirdek (node, bağımlılık yok) |
| `tools/magaza/` (diğer) | Görsel hazırlama, yerel kaynak okuyucu, örnek özel yapılandırma (`kaynaklar.ornek.json`) |
| `public/magaza/` | İlk 55 ürünün görselleri (git'te; içerik özetli adlar, 800/400 px; 1 yıl immutable önbellek) |
| `<docroot>/magaza-gorsel/` | Büyük kataloğun ürün görselleri: **medya deposu, git ve deploy dışı** (aşağıda "Medya deposu") |

## Veri

### Herkese açık katalog v2 — `api/lib/magaza/katalog/` (50.000 ürüne kadar)

Katalog tek dosya değil, parçalı bir dizindir; hiçbir herkese açık istek tüm parçaları yüklemez (ürün sayfası iki küçük
dosya, kategori sayfası kendi liste dosyaları, arama `arama.json`). Dizindeki her dosyayı **yalnızca yazıcı**
(`tools/magaza/katalog-derle.cjs`) üretir; elle düzenlenmez. Testler `VG_MAGAZA_CATALOG=<dizin>` ile sentetik dizin kullanır.

| Dosya | İçerik |
| --- | --- |
| `kategoriler.json` | `{"version":2,"generatedAt":ISO,"categories":[{id,name,title,intro,order,parent,filters?,count}]}` — iki düzey (`parent`: `null` ya da üst kategori kimliği); `count` alt kategoriler dahil ürün sayısı; `filters` isteğe bağlı süzgeç tanımı (aşağıda) |
| `liste/<kategori>.json` | `{"version":2,"category":id,"items":[kart...]}` — yalnızca doğrudan bu kategorideki ürünler; sıra: marka, sonra ad. Kart = `{id,slug,name,brand,mpn,thumb,listUsd,listCheckedAt,shipping,unit,vat,maxQty,minQty?,step?,packQty?,sortTry,attr?}` (isteğe bağlı alanlar yalnızca varsa yazılır) |
| `urun/<parça>.json` | `{"version":2,"products":{"vgm-…":ürün}}`; parça = `sprintf('%04d', intdiv(<kimliğin sayısı>, 100))` (100 kimlik bir parça) |
| `slug/<md5(slug) ilk 2 hane>.json` | `{slug: id}` |
| `arama.json` | `{"version":2,"items":[[id, katlanmışMetin, kategori, anahtarlar, adUzunluğu]]}` — küçük harf, Türkçe harfler katlanmış; yalnızca arama sayfası okur. Metin sırayla: ad, marka, model biçimleri (olduğu gibi; `5SV5344-6` → `5sv53446` tire/nokta/boşluk soyulmuş; `p3 10 0 sh` boşluklu), GTIN, kategori yolu (üst + alt kategori adı), seri/spec değerleri (Kutup sayısı, Anma akımı, Açma eğrisi, Kesme kapasitesi, Kesit, Faz, güç, Kablo tipi, Tip, Model/Ürün/Sipariş kodu…; ondalık virgül noktalı kopyasıyla), `attr`'den sentetik tokenler (`1p`, `3p+n`/`3pn`, `16a`, `c16`, `6ka`, `3x2.5` ve `3x2,5`, `trifaze`/`3 faz`/`uc fazli`, `10kw`) ve eş anlamlı grupları (otomatik sigorta/otomat/sigorta/mcb; kaçak akım/rccb/fi; parafudr/spd; kompakt şalter/mccb; inverter/evirici; akü/batarya; şarj cihazı/wallbox; güneş paneli/solar panel/fotovoltaik; kontaktör; termik röle; kondansatör — grup terimlerinden biri sözcük sınırında geçiyorsa gruptaki diğerleri eklenir). Zaten sözcük sınırında geçen parça yeniden yazılmaz. `anahtarlar`: tam eşleşme anahtarları (model biçimleri + GTIN, boşlukla ayrılmış). `adUzunluğu`: metnin ad kısmının uzunluğu (`substr($row[1], 0, $row[4])` = katlanmış ad; puanlama için). Eski 3 sütunlu satırı okuyan kod (`$row[1]`, `$row[2]`) değişmeden çalışır |
| `manifest.json` | `{"version":2,"products":N,"generatedAt":ISO}` |

Kategori kuralları: üst kategori `parent: null`, alt kategori bir üst kategorinin kimliği (üçüncü düzey yok). Ürün her
zaman bir **yaprakta** durur (alt kategorisi olmayan kategori). Üst kategori sayfası kendi listesiyle alt kategorilerin
listelerini birleştirir.

Kategori `filters` (isteğe bağlı; kategori sayfası teknik süzgeçleri, ux-backlog P1-06): `[{key, label, type, unit?}]`,
`key` kart `attr` anahtarlarından biri (`poles`, `amps`, `curve`, `ka`, `section`, `phase`, `kw`; tekrar yok), `label`
2–40 karakter (görünen ad), `type` `enum` (değer çipleri) ya da `number` (sayısal aralık), `unit` 1–10 karakter (örn. `A`,
`kW`, `mm²`). Örnek: `"filters":[{"key":"poles","label":"Kutup","type":"enum"},{"key":"amps","label":"Anma akımı","type":"number","unit":"A"}]`.
Tanım yoksa kategoride süzgeç gösterilmez; kartlar yine de `attr` taşır.

Kart `attr` (yazıcı `specs`'ten belirlenimli türetir, `tools/magaza/katalog-ortak.cjs extractAttr`; yalnızca çözülen
anahtarlar yazılır, hiçbiri çözülmezse `attr` yok): `poles` `"1P"|"1P+N"|"2P"|"3P"|"3P+N"|"4P"` (Kutup sayısı/yapısı,
Yapı), `amps` sayı A (Anma akımı, Anma akımı (In), Nominal/Maksimum akım; `Ah` sayılmaz), `curve` `"B"|"C"|"D"|"K"|"Z"`
(Açma eğrisi, Koruma karakteristiği), `ka` sayı kA (Kesme kapasitesi…), `section` `"3x2.5"` (Kesit, Damar sayısı ve
kesit, Kablo kesiti; tek damar `"1x4"`; aralık `4-6 mm²` çözülmez), `phase` `1|3` (Faz, Faz sayısı/yapısı, Besleme),
`kw` sayı kW (Anma gücü, Nominal AC (çıkış) gücü, Güç; yalnızca kW değerleri). İlk eşleşen spec kazanır; ad kullanılmaz.

Kart `sortTry`: fiyat sıralama anahtarı. **Yer tutucu:** şimdilik `listUsd` ile aynı (KDV hariç USD); sunucu
(`vgmr_sort_cards`) bunu güncel kurla çarparak TL sıraya çevirir. Canlı fiyat/marj/KDV yansıtıldığında yalnızca yazıcının
bu alanı üretme kuralı değişir, kart biçimi ve okuyucu değişmez (ux-backlog P1-15). Kategoride fiyat sıralaması kartta görünen TL ile
yapılır ve kategori başına `onbellek/sirala/` altında önbelleklenir (her istek tüm fiyat parçalarını okumaz).

Ürün kaydı (v1 alanlarının aynısı):

```json
{
  "id": "vgm-100000",
  "slug": "ornek-marka-ornek-model-580w-gunes-paneli",
  "name": "Örnek Marka ÖM-580 580 W Güneş Paneli",
  "brand": "Örnek Marka", "mpn": "OM-580", "gtin": null,
  "category": "monokristal-paneller",
  "summary": "30–160 karakter, özgün.",
  "description": ["1–5 özgün paragraf, her biri 60–900 karakter."],
  "specs": [["Anma gücü", "580 W"], ["Hücre tipi", "N-tipi TOPCon"]],
  "images": [{"src": "/magaza-gorsel/3f/ornek-marka-om-580.1a2b3c4d.webp",
              "thumb": "/magaza-gorsel/3f/ornek-marka-om-580.1a2b3c4d-t.webp",
              "w": 1000, "h": 1000, "alt": "Örnek Marka ÖM-580 güneş paneli önden görünüm"}],
  "documents": [{"title": "Üretici veri sayfası (PDF)", "url": "https://uretici.example/om-580.pdf"}],
  "unit": "adet", "vat": 20, "shipping": "kargo", "maxQty": 50,
  "minQty": 1, "step": 1, "packQty": 12,
  "listUsd": 112.40, "listCheckedAt": "2026-10-27T11:00:00Z",
  "related": ["vgm-100001"]
}
```

- `minQty`, `step`, `packQty` (isteğe bağlı, tam sayı; ux-backlog P1-09): en az sipariş adedi (1–`maxQty`), adet artışı
  (1–`maxQty`; `minQty` bunun katı olmalı) ve paket/koli adedi (1–9999; bilgi amaçlı, örn. "x 100 m" rulo). Metre ile satılan
  kabloda örn. `"unit":"metre","minQty":100,"step":100,"packQty":100`. Yoksa sunucu varsayılanı 1/1/yok. Kartlara aynen
  aktarılır; sepet girişi `min`/`step` ve sunucu `vgm_cart_items` doğrulaması bunları okur.

- `id`: `/^vgm-[0-9]{4,6}$/`, kalıcı; silinen ürünün kimliği yeniden kullanılmaz. İlk 55 ürünün 4 haneli kimlikleri
  korunur; **yeni ürünler 6 hanelidir ve 100000'den başlar** (sayısal değerler çakışmaz, parçalar `1000.json`'dan başlar).
- `slug`: `[a-z0-9-]{3,90}`, benzersiz. `specs`: 2–30 çift. `related` boşsa yazıcı aynı kategoriden en çok 4 komşuyla doldurur.
- `description`, `summary`, kategori `intro`: **özgün** metin (tedarikçi metni kopyalanmaz). Teknik veriler (`specs`)
  üretici belgesinden alınır. `documents[].url` yalnızca üreticinin resmî alan adı olabilir.
- Görseller: ya `/public/magaza/<ad>.<8 hane>.webp` + `-400.webp` (git'teki ilk ürünler, 800/400 px) ya da medya deposunda
  `/magaza-gorsel/<2 hane>/<slug>.<8 hane>.webp` + `-t.webp` küçük resim; `w`/`h` 240–1200 (kare olması gerekmez).
- `shipping`: `kargo` (sepete eklenir) veya `nakliye` (ağır/hacimli; çevrim içi sipariş yerine "Nakliye dahil teklif iste").
- `listUsd` (KDV hariç) ve `listCheckedAt`: katalog hazırlanırken doğrulanmış fiyat. Yalnızca sunucu fiyat durumu
  yoksa gösterilir; sipariş için tek başına yeterli değildir (48 saat kuralı geçerlidir). Fiyat sıralaması kartın
  `sortTry` anahtarıyla yapılır (şimdilik `listUsd` ile aynı; yukarıya bakın).

PHP (`api/lib/magaza.php`): `vgm_catalog_dir()`, `vgm_categories()` (sıralı; her kayıtta `children` ve `count`),
`vgm_category($id)`, `vgm_list($kategori)` (üst kategoride alt kategoriler birleşik; kartlarda yaprak `category`),
`vgm_product($id)` (tek parça okur; parça önbelleği), `vgm_product_by_slug($slug)` (bir slug + bir ürün parçası),
`vgm_search($q, $limit)` (`{items, total}`), `vgm_manifest()`, `vgm_product_ids()` / `vgm_all_cards()` (üreteç; tüm liste
dosyaları — **yalnızca cron, yönetim aracı ve site haritası** kullanır).

### Katalog yazıcısı — `tools/magaza/katalog-derle.cjs`

```
node tools/magaza/katalog-derle.cjs [--dizin api/lib/magaza/katalog]
     [--kategoriler kategoriler.json]   tam kategori listesi (eskisinin yerine geçer)
     [--ekle urunler.jsonl]             her satır bir ürün; aynı id varsa değiştirilir
     [--sil vgm-100001,vgm-100002]      ürünleri kaldırır
     [--deneme]                         doğrula, ne değişeceğini yaz, dosyalara dokunma
node tools/magaza/katalog-dogrula.cjs [dizin]   doğrular (hata varsa çıkış 1)
```

Yazıcı mevcut dizini okur, girdileri uygular, tüm modeli doğrular (hata varsa hiçbir şey yazmaz), **tüm dizin
dosyalarını belirlenimli** yazar (sabit anahtar sırası, satır sonu `\n`; değişmeyen dosyaya dokunmaz), artık kullanılmayan
parça/liste/slug dosyalarını siler, sayıları yeniden hesaplar, boş `related` alanlarını doldurur, kartlara `attr` ve
`sortTry` yazar ve arama dizinini (model biçimleri, kategori yolu, spec değerleri, sentetik tokenler, eş anlamlılar)
üretir. Doğrulayıcı aynı kuralları (kategori `filters`, ürün `minQty`/`step`/`packQty` dahil) uygular ve dizin
dosyalarının yazıcının üreteceğiyle birebir aynı olduğunu denetler. `/magaza-gorsel/` görselleri
`VG_MAGAZA_MEDIA` klasörü varsa orada (dosya var mı, WebP mi, boyut tutuyor mu) denetlenir; yoksa yalnızca adres kalıbı
denetlenir ve denetlenemeyen görsel sayısı yazılır.

### Medya deposu — `<docroot>/magaza-gorsel/` (git ve deploy dışı)

Büyük kataloğun ürün fotoğrafları git'e girmez. Adres `/magaza-gorsel/<2 hane>/<slug>.<8 hane özet>.webp` (ve `-t.webp`
küçük resim); sunucuda `/home/voltgua2/public_html/magaza-gorsel/`. Kurallar:

- `.cpanel.yml` yalnızca adı yazılı klasörleri kopyalar/siler; `magaza-gorsel/` için **hiçbir satır eklenmez** (deploy
  görselleri silerdi; dosyada uyarı yorumu var).
- `.htaccess`: yalnızca kalıba uyan `*.webp` sunulur (1 yıl `immutable`; dosya değişirse adı/özeti değişir), klasör
  adresleri ve diğer her şey 403; listeleme kapalı (`Options -Indexes`).
- `netlify.toml`: `/magaza-gorsel/*` üretim sitesine 301. Yerel önizleme (`tools/preview.cjs`, `tools/preview-router.php`)
  `/magaza-gorsel/`'i `VG_MAGAZA_MEDIA` klasöründen sunar (varsayılan `%LOCALAPPDATA%/VoltGuard/magaza-gorsel`, Windows
  dışında `~/.voltguard/magaza-gorsel`).

Yükleme (görseller `<2 hane>/<ad>.<özet>(-t).webp` düzeninde bir klasör ya da zip olarak hazırlandıktan sonra):

1. **CLI (SSH, tercih edilen):** zip'i sunucuya yükleyin (cPanel Dosya Yöneticisi → Upload, ör. `~/magaza-gorsel-paket.zip`)
   ve depo kopyasından çalıştırın (`tools/` deploy edilmez):
   `php tools/magaza-admin.php gorsel-yukle ~/magaza-gorsel-paket.zip --hedef /home/voltgua2/public_html/magaza-gorsel [--deneme]`.
   Yalnızca kalıba uyan ve RIFF/WEBP başlığı taşıyan dosyalar kopyalanır; aynı adlı **farklı** dosyanın üzerine asla
   yazılmaz (çakışma bildirilir, çıkış 1); sonuçta kopyalanan / zaten var / çakışan / geçersiz ad / WebP değil sayıları
   yazılır. Dosyalar 0644, klasörler 0755. Zip eklentisi olmayan PHP'de paketi açıp klasör olarak verin.
2. **Yalnızca cPanel Dosya Yöneticisi:** önce yerelde aynı komutu `--deneme` ve yerel bir `.../magaza-gorsel` hedefiyle
   çalıştırın; **çıkış 0 ve "geçersiz ad 0, WebP değil 0, çakışan 0" görmeden zip'i sunucuda açmayın** (Dosya Yöneticisi
   zip'teki her dosyayı, ör. bir alt klasördeki `.htaccess` ya da `.php` dosyasını da açar; alt klasördeki `.htaccess`
   kök kuralları devre dışı bırakabilir). Geçersiz adlı dosya varsa komut çıkış 1 verir: o dosyaları paketten çıkarıp
   yeniden paketleyin ve denetimi tekrarlayın. Sonra zip'i `public_html/magaza-gorsel/` içine yükleyip "Extract" ile açın (zip kökünde doğrudan
   `<2 hane>/` klasörleri olmalı), sonra zip dosyasını silin. Var olan dosyanın üzerine yazılmasına izin vermeyin.

### Satıcı kimliği — `api/lib/magaza/firma.json`

`unvan`, `kisaAd`, `adres`, `il`, `telefon`, `eposta`, `mersis`, `vkn`, `vergiDairesi`, `ticaretSicil`, `kep`,
`etbis` (kayıt bilgisi), `banka: {ad, hesapSahibi, iban, paraBirimi}`, `belgeSurumu` (ör. `"2026-10-27"`).
Zorunlu alanlardan biri `null` ise **mağaza siparişe kapalıdır** (`vgm_shop_open()`); sayfalar fiyatı gösterir ama
sepete ekleme yerine "Siparişe yakında açılacak" ve teklif bağlantısı çıkar.

### Özel veri — `vg_data_dir()/magaza/` (0700/0600, tek kilit `store.lock`, atomik yazma; git'e girmez)

Özel veri de parçalıdır (parça = ürün kataloğuyla aynı `vgm_shard_of(id)`); herkese açık istekler yalnızca ilgili ürünün
parçasını okur.

| Dosya | İçerik |
| --- | --- |
| `kaynaklar.json` | Ayarlar (kaynaklar hariç): `version, open, margin, shipping, paymentHours, fxBuffer, blockedSuppliers, suppliers` |
| `kaynak/<parça>.json` | `{id: [kaynak...]}` — yalnızca `import` yazar; yeni parçalar **kilit dışında** geçici klasöre yazılır, `store.lock` altında yalnızca klasör yer değiştirir, ayarlar ve sıra yazılır (sayfalar/sepet/cron import boyunca beklemez) |
| `fiyat/<parça>.json` | `{id: fiyat kaydı}` |
| `fiyat-sira.json` | Zamanlayıcı sırası: `{version: 1, format: 2, items: {id: [checkedAt, lastAttemptAt, durum, sunucu, ardışıkHata]}}` (kaynağı olan ürünler; sunucu = en öncelikli kaynağın alan adı; eski `format`suz sıra cron'un ilk çalışmasında yeniden kurulur) |
| `fiyat-durum.json` | `{version, lastRunAt, lastRunSummary, rate: {at, ok, error}, problems: {id: durum}}` (durum: held, error, unavailable) — panel tüm parçaları taramadan sorunlu ürünleri listeler |
| `onbellek/sirala/<kategori>.json` | Fiyat sıralaması önbelleği (`vgmr_sort_tl_map`): `{key, tl: {id: görünen KDV dahil TL \| null}}`; anahtar kartlar, kur, ayarlar, açık/kapalı, dokunulan `fiyat/` parçalarının değişim zamanı+boyutu ve 15 dakikalık dilim. Silinebilir; bozuksa yok sayılır ve yeniden hesaplanır |
| `kur.json` | `{usdTry, eurTry, date: "YYYY-MM-DD", fetchedAt, source: "TCMB today.xml ForexSelling"}` |
| `siparisler.json`, `istekler/`, `panel.json`, `gorsel-kaynaklari.json` | Siparişler, tekrar koruması, panel yetkilileri, görsel kaynak kayıtları |

`fiyat-sira.json` yoksa (ilk kurulum, elle düzenleme) panel/cron onu parçalardan yeniden kurar. Eski tek dosyalı veri
(`kaynaklar.json` içinde `sources`, `fiyatlar.json`) ilk kullanımda kendiliğinden parçalara taşınır.

İçe aktarma biçimi (tek dosya; `tools/magaza-admin.php import` 50.000 ürün / 150.000 kaynak, ~30 MB'a kadar kabul eder ve
parçalar; `export-config` aynı biçimi geri verir; örnek: `tools/magaza/kaynaklar.ornek.json`):

```json
{"version": 1, "open": false,
 "margin": {"default": 0.15, "byCategory": {}, "byProduct": {}},
 "shipping": {"feeTry": 0, "freeOverTry": 0},
 "paymentHours": 24, "fxBuffer": 0,
 "blockedSuppliers": ["sikayeti-cok.example"],
 "suppliers": {"tedarikci.example": {"spacing": 2}},
 "sources": {"vgm-100000": [{"url": "https://tedarikci.example/urun", "supplier": "tedarikci.example",
                             "vatIncluded": true, "currency": "TRY", "priority": 1, "discount": 0}]}}
```

- `open` sahibin bilinçli kararıdır (hukuki inceleme + ETBİS kaydı sonrası). `blockedSuppliers` içindeki alan adı hiçbir
  kaynakta kullanılamaz. `discount` (0–0,5) tedarikçiyle anlaşılan bayi indirimidir: maliyet = sitedeki fiyat × (1 − discount).
- `suppliers.<alan>.spacing`: o sunucuya iki istek arasındaki en az süre (sn, 0–300; robots.txt `Crawl-delay`).
  Belirtilmeyen sunucuda 1 sn. `margin.byCategory` alt kategori, yoksa üst kategori için geçerlidir.
- Fiyat kaydı: `status` (`ok`|`held`|`error`|`unavailable`), `costTry` (tedarikçinin KDV dahil TL fiyatı, normalize),
  `costUsd` (KDV hariç, kontrol anındaki kurla), `rateAtCheck`, `checkedAt`, `lastAttemptAt`, `source` (kaynak sırası),
  `method`, `available`, `note`, `held` (`{costTry, prevCostTry, at}`), `history` (son 20 kayıt).

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
Ayrıştırıcı (`vgm_parse_offer`) yanlış fiyat yerine belirli bir hata kodu verir (yanlış fiyat = maliyetin altında satış);
bu kodlarla biten kontrolde son kabul edilmiş fiyat 48 saat dolmadan da satılmaz (`reason: error`):
`no_price` (ürünün kendi teklifi/ana fiyat öğesi/gizli fiyat alanı 0 ya da boş — ilgili ürün kartlarının fiyatına
düşülmez; platform yedekleri yalnız ana fiyat öğesini okur, üstü çizili/liste fiyat sınıflarını hiç okumaz; ürün kartı,
ilgili/benzer/önerilen ürünler, vitrin/kaydırıcı, mega menü, mini sepet ve header/nav/footer/aside içindeki fiyatlar
`vgm_card_ranges` ile atlanır),
`ambiguous_price` (çelişen fiyatlar; iki Product JSON-LD çelişirse platformun varyant verisi, sayfadaki diğer kanıt ya da
sayfa adresiyle eşleşen tek aday seçilir, yoksa belirsiz), `min_quantity` (`minQty`: "N adet ve katlarıyla", en az N
adet, adet girdisinin min/step/value ya da data-market-price > 1), `price_options` (fiyatı değiştiren seçenek: varyant
verisinde farklı fiyatlar / sayfa fiyatı hiçbir varyantla tutmuyor, ya da metre-adet-paket-güç seçimi; yalnız renk seçimi
sayılmaz), `vat_mismatch` (sayfanın gösterdiği KDV durumu — `vatIncluded`: "+ KDV"/"KDV hariç" etiketi, `kdvDahil`
benzeri platform bayrağı — kaynak kaydındaki `vatIncluded` ile çelişiyor; aynı ürünün net ve KDV dahil iki fiyatı
görünüyorsa KDV dahil olan alınır). Marka `"false"` boş sayılır; yer tutucu görseller (`urun-gorseli-hazirlaniyor`,
`nopic`, `no-image`…) görsel değildir. Getirme/ayrıştırma sınırı 8 MiB (mega menülü sayfalar 2–3 MiB olabilir).
Getirme kimliği dürüsttür: `VoltGuardFiyat/1.0 (+https://voltguard.com.tr/magaza/)`; tarayıcı taklidi yapılmaz.
Aynı sunucuya istekler arasında en az `suppliers.<alan>.spacing` (varsayılan 1 sn) beklenir. Engelleyen tedarikçinin ürünleri panelde "elle doğrula" ile
(fiyat + not + kontrol eden kişi) güncellenebilir.

## Uç noktalar — `api/magaza.php?action=…`

Zarf: `{"api":"vg-auth/1","ok":true|false,"service":"vg-magaza/1",...}`. Hata: `{"ok":false,"error":kod,"message":…}`.

Herkese açık:
- `fiyatlar` (GET `?ids=vgm-0101,vgm-100002`, 1–100 kimlik; kimliksiz istek 422 `invalid_ids`):
  `{rate:{date}, open, items:{id:{tryNet,tryGross,checkedAt,orderable,reason}}}` (müşteriye USD tutar dönmez; USD yalnızca
  panel yanıtlarında). Hiçbir herkese açık işlem tüm ürünleri dolaşmaz.
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

- `/magaza/` vitrin: arama kutusu, üst kategoriler (ürün sayısı ve alt kategori bağlantılarıyla), her üst kategoriden
  öne çıkan bir ürün (en küçük yaprak listesinden), güven şeridi (havale/EFT, günlük güncel fiyat, faturalı satış, mühendis
  desteği). Ürünü olmayan kategori gösterilmez.
- `/magaza/kategori/<id>/`: özgün giriş metni, alt kategori çipleri ("Tümü" + alt kategoriler, sayılarıyla), sayfa başına
  48 ürün (`?sayfa=N`), marka süzgeci (`?marka=<marka-slug>`, markalar sayılarıyla), sıralama
  (`?sirala=onerilen|fiyat-artan|fiyat-azalan|ad`; fiyat sıralaması `listUsd` ile). Parametre sırası sabit (marka, sirala,
  sayfa), varsayılanlar adrese yazılmaz. Süzülmüş/sıralanmış görünümler `noindex, follow` ve kanonik adresleri süzülmemiş
  1. sayfa; süzülmemiş sayfalar kendi adresine kanonik, `rel=prev/next` bağlantılı. Aralık dışı sayfa, bilinmeyen marka
  ya da geçersiz parametre 404. Fiyatlar yalnızca sayfadaki 48 ürün için hesaplanır (`vgm_price`, ürünün fiyat parçası).
- `/magaza/ara/?q=`: `noindex, follow`; tüm sözcükler (Türkçe harfler katlanmış) ad/marka/model/GTIN'de geçmeli; en çok 96
  sonuç. Arama kutusu mağaza çubuğunda da var. Her arama tüm `arama.json`'ı taradığı için IP başına dakikada en çok 30
  arama (`vg_rl_hit('vgm_search')`); aşılınca 429 + `Retry-After` (noindex). Eşleşen kartlar her kategori liste dosyası
  önbelleğe alınmadan tek tek okunarak toplanır (bellek: arama dizini ya da en büyük tek liste).
- `/magaza/urun/<slug>/`: görseller, marka/model/GTIN, fiyat kutusu (yalnızca TL, KDV dahil; fiyat kontrol zamanı ve
  "Fiyatlar her gün TCMB döviz kuruyla güncellenir" notu; USD gösterilmez), sepete ekle, teknik özellikler, özgün
  açıklama, üretici belgeleri, teslimat ve iade özeti, "Mühendisimize sorun" bağlantısı, ilgili ürünler (`related`, eksikse
  aynı kategoriden). Yol: Mağaza › üst kategori › alt kategori › ürün. JSON-LD `Product` + `Offer` (TRY, render anındaki
  fiyat) + `BreadcrumbList`.
- Sepet/ödeme/takip sayfaları `noindex`. Ürün görsel kutusu koyu temada açık zemin (`.th-paper`).
- `/magaza/sitemap.xml` site haritası **dizini**; `/magaza/sitemap-<n>.xml` parçaları en çok 10.000 adres (vitrin,
  ürünü olan kategoriler, ürünler). `robots.txt` dizini bildirir. PHP yoksa `magaza/index.html` statik yedek olarak açılır.

## Ölçek (50.000 ürün)

`tools/tests/magaza-olcek.test.cjs` 50.000 ürünlük sentetik kataloğu geçici klasöre üretir ve ürün sayfası, 6.000 ürünlük
kategorinin ilk/son sayfası, üst kategori, arama, vitrin, sepet fiyatlaması ve `fiyatlar` için 0,5 sn sınırını denetler;
istek sırasında ilgisiz tüm ürün/slug parçaları bozuk olduğu hâlde sayfalar çalışmalıdır (tüm parçalar yüklenmez).
Ayrıca 50.000 ürün / 150.000 kaynaklı tek dosyalı yapılandırmanın içe aktarılmasını (parçalama, artık parçanın silinmesi,
hata durumunda eski parçaların korunması) denetler.

## Kurulum (sunucu)

1. `firma.json` eksiklerini doldurun (MERSİS, VKN, vergi dairesi, tam adres, ETBİS) ve hukuki metinleri avukata
   kontrol ettirin.
2. Özel kaynak dosyasını yükleyin: `VG_DATA_DIR=/home/voltgua2/vg-data php tools/magaza-admin.php import kaynaklar.json`
   (tek dosya; kaynaklar `kaynak/<parça>.json`'a parçalanır, zamanlayıcı sırası yeniden kurulur).
3. Cron (cPanel → Cron Jobs; depo kurmaz) — **her 10 dakikada bir**:
   `*/10 * * * * VG_DATA_DIR=/home/voltgua2/vg-data /usr/local/bin/php /home/voltgua2/public_html/api/lib/magaza-cron.php >/dev/null 2>&1`
4. Ürün görsellerini medya deposuna yükleyin ("Medya deposu").
5. Panel yetkisi: `php tools/magaza-admin.php grant <uye-eposta>`; `/hesap/magaza-panel.html`.
6. Her şey hazırsa `kaynaklar.json` içinde `"open": true` yapıp yeniden içe aktarın.

## Zamanlanmış fiyat kontrolü (`api/lib/magaza-cron.php`)

Her 10 dakikada bir çalışır; süre bütçesi varsayılan **540 sn** (`--sure 10–3600`; 10 dakikalık aralığın 9 dakikası).
`cron.lock` beklemeden alınır: önceki çalışma sürüyorsa yenisi hemen çıkar (çalışmalar üst üste binmez); kilit dosyası
açılamıyorsa (izin/yol sorunu) bu "başka çalışma" sayılmaz, hata yazılır ve çıkış 1 olur. Sıra (`vgm_due_order`,
`fiyat-sira.json`): önce hiç denenmemiş, sonra doğrulanmış fiyatı olanlar en eski doğrulamadan başlayarak (48 saat sınırına
en yakın önce), en sonda hiç doğrulanamamış ürünler. Başarılı kontrolden **20 saat** (`--yas 1–47`) sonra yeniden;
başarısız deneme geri çekilir: n. ardışık hatadan sonra `min(2 saat × 2^(n−1), 20 saat)`. Böylece kalıcı hatalı ürünler
sunucunun kapasitesini tüketmez. Kapasite: **farklı sunuculara eş zamanlı** getirme (`curl_multi`, aynı anda en çok
`VGM_FETCH_PARALLEL` = 6 istek; `memory_limit`'e göre azalır — her uçuştaki istek en çok 8 MiB gövde tutar); her sunucuda
aynı anda tek istek, kendi `spacing` aralığı, SSRF denetimi, boyut/süre sınırı ve IP sabitleme sırayla getirmedeki gibidir.
Aynı sunucuya istekler bir çalışma içinde aynı bağlantıyı kullanır (keep-alive, sunucu başına curl tutamacı) ve ad çözümü
5 dakika saklanır. Sayfa başına ~1 sn'de tek sunucuyla saatte ~3.200 getirme; 6 sunucu hazırsa bir 540 sn'lik çalışmada
birkaç katı (50.000 ürün için 20 saatlik hedefe ~2.500/saat gerekir). Sunucular serpiştirilir: pencere (en çok
6.000 ürün) **sunucu başına** kuyruklanır — her sunucudan en çok `ceil(bütçe / spacing) + 20` ürün alınır, böylece sıra
başını tek tedarikçi doldursa da diğer sunucular aynı çalışmada işlenir; boş yuvaya bekleme süresi dolmuş sunucuların en
öncelikli ürünü alınır; hiçbiri hazır değilse en erken hazır olan beklenir. Son tarihte durur (uçuştaki istekler bırakılır);
ilerleme her 20 sonuçta (ya da 15 sn'de) bir parça parça yazılır, kalanlar sonraki çalışmaya kalır. Katalogdan kaldırılmış ürün getirilmez ve sıradan silinir. Kur yenileme mantığı aynıdır (6 saatten eskiyse TCMB).
Her zamanlanmış çalışma `fiyat-durum.json`'a kalp atışı (`lastRunAt`, `lastRunSummary`: `checked, ok, held, error,
unavailable, skipped, left, due, rateUpdated, seconds, fetches, budget`) yazar. `cpuUserSeconds` ve `cpuSystemSeconds`,
yenileme çağrısının başı ve sonu arasındaki PHP sürecinin kendi kullanıcı/sistem CPU süreleridir; ağda bekleme süresi
değildir. `peakMemoryBytes` PHP sürecinin o ana kadarki en yüksek ayrılmış belleğidir; yalnız bu çağrının artışı değildir.
Ölçüm kullanılamıyorsa bu alanlar JSON'da ve cron çıktısında `null` olur. Bu metrikler tek başına hosting CPU sınır
olayının nedenini kanıtlamaz; zamanları ve diğer sunucu günlükleriyle birlikte değerlendirilir.
Sağlık (`vgm_refresh_status`, `--status`):
son çalışma 30 dakika içinde, son 48 saatte doğrulanmış fiyat oranı (`freshShare`) ve kapasite tahmini (`capacity`:
`fetchesPerHour` = son çalışmanın getirme hızı × saatte 6 × bütçe, `cycleHours` = ürün sayısı / bu hız; en az 20 getirmeli
çalışmada). Tahmini tur 48 saati aşarsa `healthy` false olur (panelde "sağlıklı değil").

Sepet adımındaki canlı yeniden kontrol değişmedi: 6 saatten eski fiyatlar, toplam 8 sn, en çok 6 getirme.

## Teyitli sipariş talebi (sahibin kararı, 2026-11-02)

"Kendimizi garantiye almak için … parayı öder ben ürünü bulamam, bir zorunluluğum olmasın." Doğrudan sipariş + IBAN
akışı (48 saat doğrulanmış satırlar) kaldırıldı; yerine:

1. **Talep** (`siparis`, yalnızca `open: true` iken; hız sınırı, Turnstile `vgm_turnstile_config`, `requestId` tekrar
   koruması aynı): sepetin TAMAMI `[{id, qty}]` olarak gelir, fiyatı sunucu gösterim kuralıyla (`vgm_price_display`)
   bilgi amaçlı hesaplar (fiyatı gösterilmeyen satır `null` = "fiyat teyitte bildirilir"). Durum `teyit_bekliyor`,
   `payBy: null`, `respondBy` = 1 iş günü (`VGM_CONFIRM_BUSINESS_DAYS`). Yanıtta, e-postada ve belgelerde IBAN/ödeme
   talebi YOK; "teyit gelmeden ödeme yapmayın". Belgeler talep aşaması metniyle (`stage: talep`) üretilir.
2. **Teyit** (`panel_order_confirm`, yalnızca personel): `lines [{id, qty, unitTryGross}]` (talepteki ürünler; eksik
   satır = çıkarıldı), `shippingTry`, `publicNote?`, `note?`. Tutarlar sabitlenir, `odeme_bekleniyor`, `payBy` =
   teyit + `paymentHours`, kesin tutarlı form + sözleşme (`stage: teyit`, IBAN'lı) üretilir ve e-postayla gider;
   talep aşaması kaydı `request {items, totals, docs, respondBy}` içinde saklanır. Teyit e-postası satıcının bağlayıcı
   teklifidir (talepten farklar e-postada ve geçmişte, `vgm_confirm_changes`); sözleşme müşteri kesin tutarı süresinde
   ödeyince kurulur. E-posta gönderilemezse teyit kaydedilmez (503 `mail_failed`, talep `teyit_bekliyor` kalır).
3. **Ret** (`panel_order_reject`): `reason` stok_yok | fiyat_degisti | diger (+`publicNote`), durum `iptal`
   (bedelsiz), müşteriye e-posta. `vgm_order_update` `teyit_bekliyor`dan hiçbir duruma geçirmez (`confirm_required`).

Panel: talep ayrıntısında satır bazında adet/birim fiyat düzenleme, çıkarma, kargo, notlar ve tedarikçinin son
fiyat kontrolü (`confirmAid`, yalnızca personel; "Şimdi kontrol et" = `panel_check_now`).

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
 member? {id: 'u…', linkedAt, via: checkout|claim},   ← site üye hesabı bağlantısı (yalnızca sunucu yazar)
 memberUnlinkedAt?,                                     ← üye hesabını sildiyse (sipariş yasal süre boyunca kalır)
 private {sources {id: [{supplier, url, costTry, checkedAt}]}}}   ← ASLA herkese açık yanıtta yok
```

`vgm_order_public()` müşteriye gösterilebilecek alanları döndürür (iç not, `private`, maliyet yok);
`vgm_order_customer_view()` buna ödeme bilgisini ekler (sipariş takibi ve Hesabım › Siparişlerim aynı görünümü kullanır).

## Üye hesabı ve Siparişlerim (`api/lib/magaza-uye.php`)

Mağazanın ayrı hesap sistemi yoktur; sitenin üye hesabı (`api/auth.php`, `VGSESS` oturumu) kullanılır.

- **Ödeme sayfası:** `hesap_profil` (GET) üyeyi ve onayla kaydedilmiş son fatura/teslimat bilgisini döndürür; çerez yoksa
  oturum açmadan `{user: null}`. Form boş alanlara doldurulur; üye değilse "Üye girişi yap / Üye ol" (`?next=/magaza/odeme.html`,
  sepet localStorage'da korunur), misafir sipariş açık kalır.
- **Siparişi bağlama:** `siparis` yalnızca `VGSESS` çerezi + oturumun `X-VG-CSRF` jetonu geldiğinde oturumu okur
  (`vgm_checkout_member`) ve `order.member` yazar. İstemcinin gönderdiği hiçbir üye alanı kullanılmaz; üye kimliği tekrar
  korumasının parmak izine girmez. Yanıttaki `account {linked, saved}` gerçek kaydı söyler: `X-VG-CSRF` gönderildiği hâlde oturum doğrulanamadıysa
  (süre doldu, başka sekmede çıkış/giriş) `{linked:false, saved:false}` döner ve uyarı gösterilir; istemci de üye olarak
  gönderdiği siparişte `account` yoksa aynı uyarıyı gösterir. "Bilgilerimi kaydet" kutusu hiçbir zaman önceden işaretlenmez;
  kayıt varsa etiket "bu siparişteki bilgilerle güncelle" der. Kayıtlı bilgide T.C. kimlik no saklanmaz (`hesap_profil` de döndürmez).
- **Eski misafir siparişleri:** üye kaydı e-postayı doğrulamadığı için yalnızca e-posta eşleşmesiyle bağlama YAPILMAZ.
  `hesap_dogrula_gonder` hesabın e-postasına 6 haneli kod (15 dk, 5 deneme, HMAC özetiyle saklanır) gönderir; sınırlar e-posta adresine bağlıdır ve hesap silinip aynı
  adresle yeniden kayıt olunsa da sürer: adres başına saatte 3 / günde 6 kod, günde 10 hatalı deneme (aşılınca 429), ayrıca uid
  başına saatte 3 ve IP başına saatte 10 kod; `hesap_dogrula`
  adresi doğrular ve aynı e-postalı, hiçbir üyeye bağlı olmayan siparişleri `via: claim` ile bağlar. Doğrulanmış üyede
  `hesap_siparisler` sonradan verilen misafir siparişlerini de kendiliğinden ekler (önce paylaşımlı kilitle aday aranır; yazma
  kilidi yalnızca bağlanacak sipariş varsa alınır). E-posta değişirse doğrulama geçersizdir.
- **Okuma:** `hesap_siparisler` (liste, en çok 200), `hesap_siparis?ref=` (ayrıntı: ürünler, toplamlar, ödeme/IBAN, kargo,
  geçmiş, adresler, onaylanan Ön Bilgilendirme Formu ve sözleşme metni; TCKN son 2 hane). Başka üyenin ya da bağsız sipariş
  404 döner (varlığı belli edilmez). `hesap_sahiplen`, `hesap_adres_sil` (POST). Tüm üye uçları oturum + Origin + CSRF ister.
- **Veri:** `uyeler.json {version:1, members: {uid: {verified {email, at}, verify {hash, exp, tries}, saved {customer, billing,
  shippingAddress, savedAt}}}}`. Hesap silinince (`vg_h_delete_account`) bağlantılar ve üye kaydı silinir, siparişler kalır;
  hesap silmenin sonraki adımı başarısız olursa `vgm_member_restore` bağlantıları ve kaydı geri yazar (bellekteki geri alma kaydıyla);
  hesap dışa aktarma `shop` altında bağlı sipariş özetlerini ve kayıtlı bilgileri içerir.
- **Panel:** `panel_order` yanıtında `memberInfo {id, name, email, via, linkedAt, exists}`, `panel_orders` satırında `member`.

## Modül sözleşmeleri

`api/lib/magaza.php` (çekirdek; hazır): depolama `vgm_dir/vgm_locked/vgm_read/vgm_write/vgm_read_map/vgm_write_map`,
katalog `vgm_catalog_dir/vgm_categories/vgm_category/vgm_list/vgm_product/vgm_product_by_slug/vgm_search/vgm_manifest/
vgm_product_ids`, özel parçalar `vgm_shard_of/vgm_sources_raw/vgm_sources_many/vgm_price_items/vgm_prices_put/
vgm_queue_read/vgm_queue_rebuild/vgm_status_read/vgm_config_store/vgm_config_export`, satıcı `vgm_firma/vgm_firma_missing/vgm_iban_valid`, yapılandırma
`vgm_config/vgm_config_clean/vgm_margin/vgm_shop_open/vgm_sources/vgm_host`, durum `vgm_prices_state/vgm_rate_state/
vgm_rate_ok`, fiyat `vgm_price/vgm_reason_text/vgm_apply_check/vgm_decide_held/vgm_round2`, sepet `vgm_cart_items/
vgm_quote/vgm_token_encode/vgm_token_decode`, sipariş `vgm_reference/vgm_reference_valid/vgm_order_once/
vgm_orders_read/vgm_orders_write/vgm_transition_ok/vgm_order_public`, panel `vgm_panel_state/vgm_is_panel`,
biçim `vgm_fmt_try/vgm_fmt_usd/vgm_local`. Testler `VG_MAGAZA_CATALOG` (dizin) ve `VG_MAGAZA_FIRMA` ile
`tools/tests/fixtures/magaza/` altındaki sentetik katalog dizini (`katalog/`) ve satıcıyı kullanır.

`api/lib/magaza-kaynak.php`: `vgm_fetch(url, allowHosts, &why, &status): string`, `vgm_parse_offer(html, url): array`
(`ok, price, currency, available, name, brand, gtin, mpn, sku, image, method, candidates, error, vatIncluded, minQty`),
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
- `panel_prices` (`?q=`) → `{rate, lastRunAt, lastRunSummary, items:[{id, name, category, status, costTry, usdNet, tryGross,
  checkedAt, lastAttemptAt, orderable, reason, held, note, sources:[{supplier, url}], match}], problems, counts, products, query}`
  — tüm ürünler değil: `fiyat-durum.json` sorun listesi (en çok 300) + `q` ile aranan ürünler (kimlik ya da ad/marka/model,
  en çok 50; `match: true`). `counts` (`ok, held, error, unavailable, stale, noSource`) `fiyat-sira.json` ve `manifest.json`'dan.
- `panel_price_decide` (POST `{id, decision: approve|reject|manual, costTry?, available?, note}`) → `{item}`
- `panel_check_now` (POST `{id}` ya da `{batch: true}`) → `{item, summary}` — tek ürün ya da zamanı gelen en çok 5 ürün,
  istek süresi içinde (cron çalışıyorsa `{batch}` 409 `cron_running`); hız sınırlı
- `panel_status` → `{open, configOpen, firmaMissing, rate:{usdTry,date,fetchedAt,ok}, cron:{lastRunAt, healthy, summary, freshShare},
  counts, orders:{awaitingPayment, overdue}, products}` — `healthy`: son zamanlanmış çalışma 30 dakika içinde; `freshShare`:
  kaynağı olan ürünlerden son 48 saatte doğrulanmış olanların oranı
- `panel_export` (POST `{from?, to?}`) → CSV (muhasebe/e-Arşiv için)

## Testler

`tools/tests/magaza-*.test.cjs` (gerçek PHP, geçici veri klasörü, e-posta `outbox/`; `VG_PHP=<php.exe>`): fiyat motoru,
48 saat kuralı, `held` akışı, jeton kurcalama/süre, sipariş tekrar koruması, kapalı mağaza, durum sorgusu, sızıntı denetimi
(herkese açık yanıt ve sayfalarda tedarikçi alan adı/maliyet yok; katalog parçaları dahil), ayrıştırıcı örnek sayfaları,
sayfa üretimi (sayfalama, marka süzgeci, sıralama, arama, site haritası parçaları), katalog yazıcısı/doğrulayıcısı
(belirlenimlilik, artık dosya silme, v2 kuralları, medya yolları), zamanlayıcı (sıra, sunucu aralığı, son tarih, kilit),
parçalı içe aktarma, `gorsel-yukle` ve 50.000 ürünlük performans testi (`magaza-olcek.test.cjs`).
