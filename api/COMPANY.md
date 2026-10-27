# VoltGuard şirket uygulamaları

Özel giriş `/calisan/uygulama/`; mevcut `/calisan/` çalışan panelindeki **Çalışan uygulamalarını aç** bağlantısından ulaşılır. Başlangıç sayfası aranabilir uygulama kartlarıdır. Teklif, müşteri, iş emri, keşif-metraj, stok, araç, ofis, takvim, enerji ve bordro işlevleri tek çalışan portalında yer alır. Aktarılan kaynak proje ayrı bir uygulama veya menü olarak açılmaz. Ortak iş alanı/bölüm/rol kataloğu `tools/employee-modules.json`, kaynak işlev envanteri `tools/staff-app/FEATURES.md` dosyasındadır.

## Doğrudan çalışan modülleri ve Ubuntu bağlantısı

Varsayılan `/calisan/uygulama/?module=uygulamalar` görünümü 37 iş alanını arama, kategori ve kartlarla sunar. Katalogdaki 61 ekran girişi tüm 46 modül merkezini ve `Employees` personel listesini içerir. Müşteriler `?module=musteriler&bolum=liste`, iş emirleri `?module=is-emirleri&bolum=liste` üzerinden doğrudan açılır. Aynı iş alanındaki varyantlar ana portalın bölüm sekmelerindedir; ikinci bir **Keşfet**, alt gezinme menüsü veya kaynak proje başlatıcısı yoktur. Eski ve aktarılan kayıt türleri bu alt bölümlerde korunur; farklı veritabanlarındaki tablo, isim veya plaka benzerliği otomatik birleştirme nedeni değildir. Rol ve etkin servis izinleri hem kartları/sekme seçeneklerini hem doğrudan ekran girişini sınırlar. Giriş, MFA, rol ve hesap iptali mevcut çalışan sisteminden gelir; ikinci hesap oluşturulmaz.

`tools/staff-app/src/EmployeeModule.jsx`, modül kodunu mevcut DOM'daki açık ShadowRoot'a bağlar. Kaynak ekranlar React 19 köküyle kendi stil alanında, mevcut portal React 18 menüsü altında çalışır; iframe kullanılmaz ve kaynak kod tüm pencerenin `fetch` işlevini değiştirmez. Runtime `window.VoltGuardEmployeeModules.mount(host, {route,styles,onEvent,theme})` sözleşmesini sunar. Dönen controller ekran geçişi, geri gitme, devam eden yazmaları izleme ve güvenli unmount işlemlerini yönetir. Yazma sürerken portal menüsü ve çıkış bekletilir; yazma bittiğinde uyarı kaldırılır. Özgün `SahaTakip-main/` değiştirilmez ve yayımlanmaz; seçilmiş kaynaklar `tools/saha-app/` altında, ilk dosya özetleri `tools/saha-app/source-provenance.json` içindedir.

Asıl veri kaynağı mevcut **Ubuntu/PostgreSQL sunucusundaki SahaTakip veritabanıdır**. Tarayıcı yalnız aynı kökendeki `/api/company.php` ile konuşur; `app_saha_*` işlemleri özel SSH köprüsünden `tools/ubuntu-saha-source.py` kaynak bağlayıcısına gider. Bağlayıcı, `sb-sahatakip-db` konteynerindeki mevcut veritabanının izinli `public` iş tablolarını canlı okur ve günceller. Müşteri, iş emri, teklif ve teklif satırları kendi mevcut tablolarında kalır; yeni portal için bunların ayrı bir kopyası oluşturulmaz. Tarayıcıdan eski Supabase API'sine, Auth servisine veya doğrudan veritabanına bağlantı kurulmaz. Ubuntu bağlantısı kesildiğinde yerel veriye otomatik geçiş yapılmaz.

Kaynak tabloda bulunmayan modüller ile yeni çalışan kimliğinin eski zorunlu Auth/profil yabancı anahtarına yazılamadığı yeni kayıtlar, aynı SahaTakip veritabanındaki `voltguard_site.saha_records` özel uzantısında tutulur. Ortak modül kayıtları (`_cache`) ve yeni özel dosyalar (`_files`) da bu veritabanındadır; kişisel tercihler çalışan kimliğine bağlı özel `preferences` tablosundadır. İş modülü kayıtları ortak, bordro/puantaj kayıtları yetkiye bağlıdır. Bu kayıtlar, başka bir veritabanına veya tarayıcı depolamasına sessiz yedek olarak yazılmaz.

Çalışan kimlikleri mevcut davet, parola ve zorunlu MFA sistemi üzerinden doğrulanır ve sunucuda kararlı saha kimliklerine eşlenir. Eski `auth.users` ve `profiles` kayıtları kopyalanmaz; eski kimlik, rol veya oturum yeni giriş yetkisi vermez. Gerekli yeni kimlik bağlantıları `voltguard_site.saha_native_rows` yan kayıtlarında, gerçek kaynak alanın değerine bağlı olarak tutulur. Eski uygulama bu alanı değiştirirse eşleme geçersizleşir; isim/e-posta benzerliği bordro erişimi vermez. Değişiklikler gerçek kaynak satır ve yan kayıt özetleriyle karşılaştırılıp tek işlemde yazılır; başka kullanıcının veya eski uygulamanın güncellemesi sessizce ezilmez. Bordro/personel ve mesaj/konum kayıtlarında ek sunucu yetkileri uygulanır.

Doğrudan ekran işleyicisi mevcut native UUID/rol profil izdüşümünü kullanır; ana portalın ham çalışan kimliği bu profil yerine geçirilmez. `app_saha_*` işlem adları ve özel depo anahtarları kalıcı veri sözleşmesidir; kullanıcıya görünen menü adları için değiştirilmez. Personel ve hesap bağlantıları ekranı mevcut `EmployeeDetail` ücret, puantaj ve açık hesap bağlama işlemlerini açar.

Derlenmiş dosyalar `/calisan/uygulama/assets/saha/`, ekler `/api/saha-asset.php` üzerinden çalışan doğrulaması gerektirir. `GET /api/company.php?action=module_assets` yalnız tam çalışan/MFA oturumuna doğrulanmış JS/CSS listesini verir; dış kaynak, bozuk yol veya eksik dosya içeren manifest reddedilir. Ham `employee-modules-manifest.json` ve `saha-entry.html` web erişimine kapalıdır. Eski `/calisan/uygulama/saha.php` adresi artık HTML uygulama sunmaz; çalışan doğrulamasından sonra uygulama kartlarına 303 yönlendirmesi yapar. Hiçbir özel modül dosyası service worker önbelleğine alınmaz. Eski kayıtlardaki dosya bağlantıları özel varlık kapısından sunulur; görünmeyen kayıt veya bordro alanı dosya erişimi vermez. Harici AI, e-posta, SMS, ERP ve harita hizmetleri sunucuda ayrıca yapılandırılmadıkça işlem gerçekleştirmez; başarısızlık başarılı kayıt gibi sunulmaz.

Kurulumda ayrıca `npm ci --prefix tools/saha-app --ignore-scripts --no-fund` çalıştırılır. `node tools/build-company.cjs` portalı ve doğal modül runtime'ını birlikte derler, özel JS/CSS manifestini üretir. `calisan/uygulama/employee-modules-manifest.json`, `saha-entry.html` ve derlenmiş varlıklar elle düzenlenmez. `node tools/build-saha-schema.cjs`, `api/lib/sahatakip-schema.php` alan izinlerinden `tools/saha-source-schema.json` dosyasını üretir; bu dosya yalnızca şema bildirimidir ve iş verisi içermez. PHP API dosyaları, üretilmiş manifest/şema ve Ubuntu yardımcıları uyumlu sürümde birlikte dağıtılır. Mevcut iş verileri kaynak tablolardan doğrudan okunur; eski hesapların taşınması veya veri içe aktarımı giriş koşulu değildir.

## Çalıştırma ve derleme

`npm run setup:staff` kilitli React/Vite bağımlılıklarını kurar. `npm run build` ortak menüyü, açık erişimli araçları ve özel uygulamayı üretir. `npm run preview` PHP bulunan ortamda aynı köken üyelik/çalışan/şirket API'lerini sunar. İlgili kaynaklar `tools/staff-app/src/`, yayın çıktısı `calisan/uygulama/` altındadır; derlenmiş klasör elle düzenlenmez. Kaynak kökenleri ve ilk SHA-256 özetleri `tools/staff-app/provenance.json` içindedir. Orijinal klasör değiştirilmez.

Vite çıktısının `index.html` dosyası yayımlanmaz. PHP `index.php`, şirket hesabı+MFA doğrulanmadan HTML göndermez. JavaScript, stil, logo, rapor yazı tipleri ve lisans dosyaları da `api/company-asset.php` kapısından geçer. PHP yoksa özel uygulama açılmaz; Netlify özel klasörü 404 ile kapatır. Apache yönlendirme modülü bulunmazsa uygulamanın kendi erişim dosyası bütün klasörü kapatır. Yayın sırasında API ve çalışan dosyaları web kökü dışında hazırlanır; erişim kuralları özel dosyalardan önce etkinleşir. Bu alanın hiçbir HTML veya varlığı service worker önbelleğine alınmaz. Geçersiz/iptal edilmiş oturum her özel API ve varlık isteğinde tekrar kontrol edilir.

## Ubuntu iş verileri ve özel katalog

Şirket uygulaması mevcut Ubuntu’daki VoltGuard PostgreSQL veritabanını kullanır. PHP katmanı `api/lib/company-ubuntu.php` üzerinden doğrulanmış SSH ile `tools/ubuntu-company-bridge.py` yardımcısını çağırır. Tarayıcı yalnızca aynı kökendeki `/api/company.php` ile konuşur; SSH anahtarı, veritabanı kimliği veya Supabase yönetici anahtarı tarayıcıya gönderilmez. Mevcut iş tabloları kullanılır; eski kullanıcıların şifreleri, oturumları ve Supabase kimlik servisi yeni çalışan sistemine taşınmaz.

Bağlantı ayarı web kökü dışındaki `<VG_DATA_DIR>/company/ubuntu.json` dosyasıdır. `VG_DATA_DIR` site kökünün dışında kalmalı. Bu özel dosyanın alanları:

| Alan | Değer |
| --- | --- |
| `version` | `1` |
| `host` | Yayın sunucusunun SSH ayarında tanımlı hedef; bu geliştirme ortamında `sunucu` |
| `helper` | Ubuntu’daki yardımcının mutlak yolu; bu kurulumda `/home/emrullah/voltguard-site-bridge/company_store.py` |
| `sahaHelper` | İsteğe bağlı SahaTakip kaynak yardımcısı; bu kurulumda `/home/emrullah/voltguard-site-bridge/saha_store.py`. Belirtilmezse `helper` adı `company_store.py` olduğunda aynı dizindeki `saha_store.py` seçilir. |
| `site` | Bu kurulum için bir kez üretilip korunan, 32–64 karakter uzunluğunda küçük harfli onaltılık kimlik |
| `sshExecutable` | İsteğe bağlı SSH çalıştırıcısının tam yolu; varsayılan Windows OpenSSH veya `/usr/bin/ssh` |
| `timeout` | İsteğe bağlı 5–45 saniye; varsayılan 25 |

`site` değeri, yeni çalışan eşlemelerinin ve tercihlerinin kapsamını belirler; yedeklenmeli, rastgele yeniden oluşturulmamalıdır. SSH parola sormadan çalışır ve `StrictHostKeyChecking=yes` ile bilinen sunucu anahtarını doğrular. Ağ kesintisi, yanlış ayar, süresi aşılmış işlem veya geçersiz yanıt erişimi kapatır. Ubuntu ayarı varken yerel `state.json` dosyasına otomatik geçiş yapılmaz. Ayarı silmek bağlantıyı onarmak değildir; ayrı bir veri deposu seçer.

Ana şirket yardımcısının ayarı `/home/emrullah/voltguard-site-bridge/config.json` içindedir; `container`, `database`, `user`, `catalogSources` alanlarını kullanır. Mevcut hedef `sb-voltguard-db` konteynerindeki `postgres` veritabanıdır. Bu ayar, katalog yolları ve mevcut PHP `helper`/`site` değerleri SahaTakip eklenirken korunur. Ana yardımcı yalnızca kendi izinli şirket tablolarını işler.

SahaTakip kaynak yardımcısının ayrı ayarı `/home/emrullah/voltguard-site-bridge/saha-config.json` içindedir. `container`, `database`, `user` alanları mevcut SahaTakip veritabanını seçer; bu kurulumda hedef `sb-sahatakip-db` konteynerindeki `postgres` veritabanıdır. İki yardımcı aynı `vg-ubuntu-company/1` taşıma sözleşmesini kullanır; PHP yalnızca SahaTakip işlemlerini kaynak yardımcısına yönlendirir. Kaynak yardımcısı için ana `config.json` değiştirilmez.

İlk Ubuntu kaynak bağlantısı kurulumu şu dosyaları kapsar:

1. `tools/ubuntu-company-bridge.py` güncel sürümü mevcut özel dizinde `company_store.py` olarak yerleştirilir; mevcut `config.json` üzerine yazılmaz.
2. `tools/ubuntu-saha-source.py`, aynı dizine `saha_store.py`; üretilmiş `tools/saha-source-schema.json` ise `saha-source-schema.json` adıyla yerleştirilir. Kaynak yardımcı, yanındaki güncel `company_store.py` kodunu da kullanır.
3. Yeni özel `saha-config.json` SahaTakip hedefini seçer. PHP bağlantısında gerekirse yalnız `sahaHelper` eklenir; ana şirket bağlantısı ve `site` kimliği korunur.
4. Kaynak yardımcısının açık `--install` işlemi, standart girişte `{"op":"install"}` ile yalnız gerekli özel şemayı ve tabloları kurar. Günlük okuma/yazma istekleri kendiliğinden kurulum yapmaz. Kurulumdan sonra sağlık, yetkisiz erişim ve canlı kaynak okuma kontrolleri yapılır; gerçek iş tablosuna test kaydı yazılmaz.

Güncel izinli şema 72 koleksiyondur. Kaynakta bulunmayan `visits`, mevcut `voltguard_site.saha_records` özel uzantısında tutulur. Aktif ziyaret yeniden açılışta sunucudan gelir; ziyaret giriş/çıkışı ve `location_checkins` olayları sahiplik, sürüm ve tekrar gönderim denetimiyle tek işlemde yazılır. Ekipman, enerji ölçümü, satış ziyareti, form yanıtı ve araç servisleri reddedilen yazmayı önbellekte kaydedilmiş gibi sunmaz; okuma hatası boş liste sayılmaz. Eski formun sürümünü yazmadan önce sessizce yenileyerek başka çalışanın düzenlemesi ezilmez.

Bu mevcut kurulumun ziyaret güncellemesi için yeni SQL gerekmez. Yalnız `company_store.py` ve `saha-source-schema.json` doğrulanıp yedeklenerek atomik dosya değişimiyle yerleştirilir. `saha_store.py` özeti, `config.json`/`saha-config.json` baytları ve izinleri, eski Auth/profil içeriği ve `public`/Auth güvenlik tanımları korunur. İlk kurulum betiği veya `--install` yeniden çalıştırılmaz; gerçek müşteri, ziyaret ya da bordro üzerinde test yazımı yapılmaz.

Her veritabanındaki `voltguard_site` özel şeması o bağlantının çalışan eşlemelerini, tercihlerini, atomik işlem/tekrar gönderim kayıtlarını ve gerekli uzantıları saklar. SahaTakip tarafında `saha_native_rows` kaynak alanına bağlı kimlik/alan eşlemelerini, `saha_records` özel modül kayıtları ve dosyaları tutar. Bu özel şemalarda RLS açıktır ve `PUBLIC`, `anon`, `authenticated` erişimi kaldırılır. Mevcut `public` iş tablolarının RLS politikaları ve eski Auth/profil kayıtları değiştirilmez.

Yeni portalın erişim kararı PHP çalışan oturumu ve yardımcıdaki ek izin denetimlerinden gelir. Yardımcı Docker/PostgreSQL işletim yetkisi kullanır; genel Supabase oturumu bu bağlantının güvenlik sınırı değildir. Özel SSH anahtarının sahibini ve sunucuda çalıştırabileceği işlemleri sınırlandırın; üretimde bu bağlantıyı genel amaçlı işletmeci anahtarıyla paylaşmayın. Yardımcı ve özel ayar dosyaları webden açılan uygulamanın içine konmaz. Unix dosyalarını 0600, dizinleri 0700 ve Windows erişimini uygun kullanıcı ACL’leriyle koruyun.

Fatura ürünleri ve fiyat kaynakları Ubuntu’daki şu dosyalardan okunur; Git’e veya derlenmiş JavaScript’e içerikleri eklenmez:

| Katalog | Ubuntu dosyası |
| --- | --- |
| `historicalInvoice1` | `/home/emrullah/voltguard-portal/app/fatura/Fatura.json` |
| `historicalInvoice2` | `/home/emrullah/voltguard-portal/app/fatura/Fatura2.json` |
| `cablePrices` | `/home/emrullah/voltguard-portal/app/src/serer-kablo-fiyat.json` |
| `packages` | `/home/emrullah/voltguard-portal/app/src/hazir-paketler.json` |

Eski fatura satırları geçmiş fiyat olarak işaretlenir; teklif öncesi fiyat doğrulanabilir ve güncellenebilir. Kataloğa erişim de tamamlanmış çalışan oturumu gerektirir. Ubuntu yedeği her iki veritabanının mevcut iş tablolarını ve `voltguard_site` şemasını, ayrıca özel `config.json`, `saha-config.json` ve bağlantı/katalog ayarlarını kapsamalıdır. Yeni sitenin `staff/` kimlik ve PDF deposu ayrıca korunur.

## Ayrı yerel kurulum

Ubuntu ayarı bulunmayan, bilerek yerel kurulmuş bir ortam şirket kayıtlarını `<VG_DATA_DIR>/company/` altında `state.json`, `store.lock`, `catalog.json` olarak tutar. Bu mod ayrı kurulumlar ve sentetik testler içindir; Ubuntu verisinin kopyası veya bağlantı kesintisi yedeği değildir. Yerel iş verileri Ubuntu’ya otomatik birleştirilmez. Özel dizin Git’e, statik çıktıya veya yayın kopyasına dahil edilmez; symlink/junction web köküne veya izinli ana dizinin dışına çıkarsa erişim kapanır.

Yalnızca bu ayrı yerel kurulumda katalog dosyalarını yetkili terminalden bir kez aktarmak için:

```text
export VG_DATA_DIR=/home/voltgua2/vg-data
node tools/company-catalog.cjs /özel/kaynak/Teklif-Voltguard-main
```

Bu işlem ürün satırlarını, kablo fiyatlarını ve hazır paketleri yerel özel `catalog.json` dosyasına yazar; mevcut kataloğun üzerine sessizce yazmaz. Ubuntu bağlantısını kurmaz ve eski Supabase hesabını taşımaz. Yerel önizlemenin çalışan daveti, oturumu veya PDF’leri başka kuruluma kendiliğinden taşınmaz.

Tarayıcıdaki özel kayıtlar yalnızca bellektedir. Yedekler, taslaklar, seçimler ve favoriler gerçek çalışan kimliğine bağlı özel sunucu depolamasına yazılır; `localStorage` bir kimlik/yetki veya bordro deposu değildir. Kaydedilemeyen değişiklik ekranda bildirilir, yeniden denenebilir ve çıkıştan önce yazma kuyruğu tamamlanır.

## API ve yetki

`/api/company.php` yanıtları `api: "vg-company/1"`, `ok`, `data`, `csrf` kullanır. `bootstrap` GET ile yalnızca tam çalışan oturumunda kimlik, yetkiler, çalışana ait tercih kayıtları ve özel katalog döndürür. `query`, `rpc`, `storage` POST işlemleri aynı köken Origin ve `X-VG-STAFF-CSRF` gerektirir. PHP çalışmıyorsa, kayıt bozuksa veya depo doğrulanamıyorsa erişim kapanır.

Genel iş kayıtları yalnızca şirket çalışanları arasında paylaşılır. Bordro/personel tabloları ayrı korunur: normal çalışan yalnızca kendi yeni çalışan kimliğiyle açıkça eşlenmiş personel ve o personele bağlı kayıtları okuyabilir; boş eşleme, eski Supabase UUID’si, e-posta/ad benzerliği veya tarayıcı rolü erişim vermez. Yönetici ve bordro sorumlusu bordro kayıtlarını yönetir; yalnızca yönetici davet/erişim/yetki/kurtarma ve hesap işlem geçmişini yönetir. Ubuntu’daki eski `auth.users` bağlantısı korunur; yeni çalışan eşlemesi özel yan kayıtta tutulur. Eski uygulama bağlantıyı değiştirirse yeni eşleme geçersizleşir. Sunucu hiçbir kullanıcı şifre özeti, TOTP anahtarı veya davet özeti döndürmez.

Tablo, alan, filtre, ilişki, sıralama, sayfalama ve işlem türleri izin listelerine bağlıdır. Filtre olmadan toplu güncelleme/silme kabul edilmez. Yazılan actor ve zaman alanları sunucuda atanır. Yabancı anahtarlar doğrulanır; toplu hata bütün işlemi geri alır. Ham puantaj, beyaz yaka bordro/avans ve sürümlü belge yazmaları özel işlemlere yönlendirilir.

Belgelerde revizyon, puantaj ve bordroda yüklenmiş `updated_at` sürümü kullanılır. Ubuntu katmanı ayrıca gerçek satır ve eşleme özetini işlem içinde karşılaştırır; eski uygulama arada kayıt değiştirmişse 409 ile reddedilir. Değişen satırlar tek PostgreSQL işlemiyle kaydedilir; toplu hata tüm yazmayı geri alır. Veritabanı tetikleyicilerinin atadığı gerçek tarih, teklif referansı ve tutarlar yanıt olarak döner. Avans/taksit/gider bordro güncellemeleri atomiktir; tekrar gönderim ikinci avans üretmez ve kuruş kalanı taksitlerde kaybolmaz. İlişkili geçmişi olan personel/araç silinmesi eski `ON DELETE CASCADE` davranışıyla sessiz veri kaybına yol açmaz. Bordro modülleri kaynak uygulamanın hesap akışını korur; işletme muhasebe verileri ve dönem oranları yetkili kullanıcı tarafından doğrulanmalıdır.

## Dış bağlantılar

Bu kurulumda **Ubuntu’daki merkezi iş kayıtları ve dosya içe aktarma** kullanılır. Excel/JSON, tablo yapıştırma, kaydedilmiş sayaç ölçümleri, grafik ve raporlar çalışır. Merkezi veri bağlantısı canlı sayaç servisi değildir: KOSBİ/OSOS collector ve WorkTracker kapalı kalır; kapalı bir işlem başarı veya sahte ölçüm üretmez. Kaynakta gereken `Gunay/osos_collector.py` bulunmadığı için otomatik ölçüm varmış gibi çalıştırılmaz. Harici yapay zekâ yerine açıkça adlandırılmış, düzenlenebilir teklif/e-posta şablonları vardır; bu servislere şirket verisi veya gizli anahtar gönderilmez. E-posta eylemi kullanıcı tarafından gönderilebilen mail taslağı açar.

## Başka yayın sunucusunda bağlantı

cPanel veya başka bir PHP sunucusunda SSH çalıştırıcısı ve `proc_open` izni, Ubuntu’ya özel ağ erişimi, SSH hedefi/anahtarı ve doğrulanmış `known_hosts` kaydı gerekir. Geliştirme bilgisayarındaki `sunucu` hedefi veya Tailscale oturumu bu sunucuya otomatik geçmez. Bağlantı ayarı ve anahtar özel dizinde tutulur; statik yayın paketine eklenmez. Genel veritabanı portu açmak, TLS veya SSH sunucu anahtarı doğrulamasını kapatmak bağlantı kurulumunun bir parçası değildir. Ubuntu’ya erişim sağlanamıyorsa şirket iş alanı hata verir; yeni çalışan giriş/PDF sistemi kendi özel deposunda çalışmaya devam eder.

Netlify yayını yalnızca herkese açık statik siteyi içerir; özel çalışan portalı ve modül varlıkları, PHP ve özel ayarlar bu pakete girmez. Bu bölümü kullanmak için cPanel/PHP yayını ve o sunucudan iki Ubuntu yardımcısına doğrulanmış SSH erişimi gerekir. Netlify'daki genel sitenin başarılı yayımlanması çalışan uygulamasının kurulmuş olduğunu göstermez.

## Kontrol

`npm test` gerçek PHP/HTTP yetki, veri ve sürüm kontrollerini çalıştırır. `npm run test:staff-browser` giriş ve tam modül iş akışlarını yalnızca sentetik geçici kayıtlarla kontrol eder. `tools/tests/ubuntu-company-bridge-integration.py` ana şirket bağlantısını, `tools/tests/saha-source-integration.py --config <özel-QA-ayar-yolu> --source <kaynak-yardımcı-yolu>` ise SahaTakip kaynak bağlantısını ayrı, boş ve `vg_bridge_qa_` önekli veritabanlarında denetler. Kaynak testi gerçek PostgreSQL üzerinde asıl tablolara yazma, bileşik/bigint anahtarlar, eski uygulama değişikliğinde çakışma, atomik geri alma, tekrar gönderim, bordro sahipliği, özel dosya yetkileri ve RLS sınırlarını sentetik verilerle doğrular. Üretim veritabanı adını reddeder; yeniden kullanım yalnızca işaretli sentetik fixture için açık `--reset-fixtures` seçeneğiyle yapılır. `tools/tests/saha-source-unit.test.cjs` ayrıca kaynak birim kontrollerini ve PHP/Ubuntu şema eşliğini denetler. Testler gerçek çalışanı, bordroyu ve özel kataloğu değiştirmez. Yayında ayrıca HTTPS, PHP/SSH çalıştırma, özel ağ erişimi, özel depo izinleri ve yetkisiz URL/varlık denemeleri kontrol edilmelidir.
