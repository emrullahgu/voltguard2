# VoltGuard şirket uygulamaları

Özel giriş `/calisan/uygulama/`; mevcut `/calisan/` çalışan panelindeki **Çalışan uygulamalarını aç** bağlantısından ulaşılır. Teklif, keşif-metraj, GES, görev, iş ve ürün takibi, akaryakıt, OSOS, haftalık enerji raporları, periyodik kontrol raporları, iki bordro sistemi, profil ve çalışan yönetimi aynı çalışan oturumundadır. Kaynak işlev envanteri `tools/staff-app/FEATURES.md` dosyasındadır.

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
| `site` | Bu kurulum için bir kez üretilip korunan, 32–64 karakter uzunluğunda küçük harfli onaltılık kimlik |
| `sshExecutable` | İsteğe bağlı SSH çalıştırıcısının tam yolu; varsayılan Windows OpenSSH veya `/usr/bin/ssh` |
| `timeout` | İsteğe bağlı 5–45 saniye; varsayılan 25 |

`site` değeri, yeni çalışan eşlemelerinin ve tercihlerinin kapsamını belirler; yedeklenmeli, rastgele yeniden oluşturulmamalıdır. SSH parola sormadan çalışır ve `StrictHostKeyChecking=yes` ile bilinen sunucu anahtarını doğrular. Ağ kesintisi, yanlış ayar, süresi aşılmış işlem veya geçersiz yanıt erişimi kapatır. Ubuntu ayarı varken yerel `state.json` dosyasına otomatik geçiş yapılmaz. Ayarı silmek bağlantıyı onarmak değildir; ayrı bir veri deposu seçer.

Ubuntu’daki yardımcı ayarı `/home/emrullah/voltguard-site-bridge/config.json` içindedir; `container`, `database`, `user`, `catalogSources` alanlarını kullanır. Mevcut hedef `sb-voltguard-db` konteynerindeki `postgres` veritabanıdır. Yardımcı sadece izinli şirket tablolarını işler. `voltguard_site` özel şeması yeni çalışan eşlemelerini, kişisel tercihleri, işlem geçmişini, tekrar gönderim kayıtlarını ve eski şemada olmayan üç modül tablosunu saklar. Bu özel şemada RLS açıktır ve `PUBLIC`, `anon`, `authenticated` erişimi kaldırılır. Mevcut iş tablolarının RLS politikaları veya eski kimlik kayıtları değiştirilmez.

Yeni portalın erişim kararı PHP çalışan oturumu ve yardımcıdaki ek izin denetimlerinden gelir. Yardımcı Docker/PostgreSQL işletim yetkisi kullanır; genel Supabase oturumu bu bağlantının güvenlik sınırı değildir. Özel SSH anahtarının sahibini ve sunucuda çalıştırabileceği işlemleri sınırlandırın; üretimde bu bağlantıyı genel amaçlı işletmeci anahtarıyla paylaşmayın. Yardımcı ve özel ayar dosyaları webden açılan uygulamanın içine konmaz. Unix dosyalarını 0600, dizinleri 0700 ve Windows erişimini uygun kullanıcı ACL’leriyle koruyun.

Fatura ürünleri ve fiyat kaynakları Ubuntu’daki şu dosyalardan okunur; Git’e veya derlenmiş JavaScript’e içerikleri eklenmez:

| Katalog | Ubuntu dosyası |
| --- | --- |
| `historicalInvoice1` | `/home/emrullah/voltguard-portal/app/fatura/Fatura.json` |
| `historicalInvoice2` | `/home/emrullah/voltguard-portal/app/fatura/Fatura2.json` |
| `cablePrices` | `/home/emrullah/voltguard-portal/app/src/serer-kablo-fiyat.json` |
| `packages` | `/home/emrullah/voltguard-portal/app/src/hazir-paketler.json` |

Eski fatura satırları geçmiş fiyat olarak işaretlenir; teklif öncesi fiyat doğrulanabilir ve güncellenebilir. Kataloğa erişim de tamamlanmış çalışan oturumu gerektirir. Ubuntu yedeği mevcut iş tablolarına ek olarak `voltguard_site` şemasını ve özel bağlantı/katalog ayarlarını kapsamalıdır. Yeni sitenin `staff/` kimlik ve PDF deposu ayrıca korunur.

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

## Kontrol

`npm test` gerçek PHP/HTTP yetki, veri ve sürüm kontrollerini çalıştırır. `npm run test:staff-browser` giriş ve tam modül iş akışlarını yalnızca sentetik geçici kayıtlarla kontrol eder. `tools/tests/ubuntu-company-bridge-integration.py` ayrı, boş ve `vg_bridge_qa_` önekli veritabanı gerektirir; gerçek iş kayıtlarını kullanmaz. Ubuntu testleri gerçek PostgreSQL üzerinde okuma, çakışma, atomik geri alma, tekrar gönderim, kimlik eşleme, veritabanı tetikleyicileri ve özel tablo erişim sınırlarını sentetik verilerle denetler. Testler gerçek çalışanı, bordroyu ve özel kataloğu değiştirmez. Yayında ayrıca HTTPS, PHP/SSH çalıştırma, özel ağ erişimi, özel depo izinleri ve yetkisiz URL/varlık denemeleri kontrol edilmelidir.
