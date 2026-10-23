# VoltGuard çalışan sistemi

Bu sistem `api/staff.php` üzerinden çalışır; genel site üyeliğinden tamamen ayrı çalışan kimlikleri ve `VGSTAFF` oturumu kullanır. Genel siteye kayıt olmak, şirket e-posta adresi kullanmak veya genel üyelikteki alanları değiştirmek çalışan erişimi vermez. `/calisan/uygulama/` Teklif-Voltguard kaynaklarındaki iş modüllerini aynı çalışan kimliğiyle kullanır. Eski Supabase/Firebase hesapları çalışan girişinde kullanılmaz. İş kayıtları ve teklif katalogları özel SSH bağlantısıyla mevcut Ubuntu sunucusundan okunur; iş kayıtları aynı veritabanına kaydedilir. Bağlantı kurulumu [COMPANY.md](COMPANY.md) içinde açıklanır.

## Sunucu kurulumu

PHP 7.4–8.x ve `fileinfo`, çalışan API'si ve `/calisan/index.php` için PHP çalıştıran Apache/LiteSpeed/PHP-FPM gerekir. Sunucunun saati doğru olmalıdır. Canlı bağlantı HTTPS olmalı; HTTP yalnızca localhost önizlemesine izinlidir. Netlify gibi sadece statik dosya sunan ortamlarda özel bölüm kullanılamaz.

`VG_DATA_DIR` web kökünün **dışındaki** yazılabilir mutlak dizine işaret etmeli (örneğin `/home/voltgua2/vg-data`). Varsayılan dış dizin de kullanılabilir. Web kökü içinde kalan veri yolu çalışan sistemi için 503 döndürür; genel hesabın `_vgdata` yedeğine geçmez. Çalışan verileri `<VG_DATA_DIR>/staff/` altında tutulur. `state.json`, `store.lock`, `sessions/` ve `documents/` yayına veya Git'e eklenmez. Dosyalar 0600, dizinler 0700 izinlidir. Windows üzerinde eşdeğer kullanıcı erişim kısıtlamaları işletim sistemi ACL'leriyle uygulanır.

`VG_STAFF_SITE_URL` davet bağlantısının köküdür; varsayılan `https://voltguard.com.tr`. Yalnızca HTTPS alan adı veya geliştirme için `http://127.0.0.1:<port>` / `http://localhost:<port>` kabul edilir. Host başlığı davet bağlantısına kullanılmaz. Güvenilen ters vekil HTTPS'i sonlandırıyorsa HTTPS bilgisini doğru aktarmalı ve dış istemcilerin vekil başlıklarını değiştirmesine izin vermemelidir.

Sunucudaki **özel terminalde**, site API'si ile aynı veri dizinini açıkça ayarlayıp ilk yönetici için:

```text
export VG_DATA_DIR=/home/voltgua2/vg-data
php tools/staff-admin.php bootstrap-invite --email info@voltguard.com.tr --name "VoltGuard Yönetici"
```

Bu komut şifre oluşturmaz. Bir kez kullanılabilen, 24 saat geçerli bir etkinleştirme bağlantısı üretir ve çalışan varsa tekrar ilk yönetici kurulmasına izin vermez. Bağlantıyı yalnızca kimliği doğrulanmış ilgili kişiyle paylaşın. Komut satırında şifre argümanı kabul edilmez. Site üzerinden ilk yönetici oluşturulamaz; herkese açık kayıt uç noktası yoktur. `tools/` HTTP erişimine kapalıdır, ayrıca betik sadece CLI'da çalışır.

Aktivasyon sayfasında çalışan kendi 12–64 karakterlik, bcrypt sınırı nedeniyle en fazla 72 baytlık şifresini belirler. Ardından bir doğrulayıcı uygulamasına sağlanan TOTP anahtarını elle ekler ve 6 haneli kodu doğrular. İki adımlı doğrulama tamamlanmadan hiçbir özel sayfa, çalışan listesi, bordro veya PDF açılmaz. Kurulumda üçüncü taraf QR servisi kullanılmaz.

İkinci gerçek yönetici hesabını etkinleştirin. Son etkin yönetici kapatılamaz veya yeniden davet edilerek sıfırlanamaz. Tüm yöneticilerin cihazları kaybolursa genel kullanıcıların erişebildiği kurtarma yolu yoktur; özel sunucu terminali ve kontrollü işletim kurtarması gerekir.

## Yetkiler ve hesap yönetimi

- `employee`: yalnızca kendisine bağlı bordro kayıtlarını ve PDF'lerini görür.
- `payroll`: çalışan listesini görür; tüm çalışanların bordro kayıtlarını oluşturabilir, PDF yükleyebilir ve kayıt silebilir. Davet oluşturamaz veya çalışan erişimini kapatamaz.
- `admin`: davet ve erişim yönetimiyle birlikte bordro yönetimini yapar.

Davet yenileme mevcut şifreyi, doğrulayıcıyı ve tüm oturumları geçersiz kılar; kişi yeni şifre ve doğrulayıcı kurar. Eski davetler çalışmaz. Erişim kapatılınca oturum sürümü artar; var olan oturum bir sonraki istekte reddedilir. Bordro kayıtları korunur. Davet süresi ve tek kullanım kontrolü, MFA tekrar kullanma engeli ve oturum iptali aynı özel veri kilidi altında denetlenir.

Çalışan oturumu 30 dakika işlem yapılmayınca ve her durumda 8 saat sonunda geçersiz olur. Şifre adımı ve MFA kurulumu için geçici oturum 10 dakikadır. Çerez HttpOnly, HTTPS'te Secure ve SameSite=Strict'tir. Giriş ve MFA adımlarında oturum kimliği ile CSRF yenilenir. TOTP 30 saniyelik adımlarla ±1 adım toleranslıdır; aynı veya daha eski zaman adımının kodu tekrar kullanılamaz. Yeni tarayıcıda hemen tekrar giriş yaparken sonraki kodu bekleyin.

## API sözleşmesi

`GET /api/staff.php?action=me` anonim veya özel oturum bilgisini ve CSRF değerini verir. Tüm yazmalarda aynı köken `Origin` başlığı ve `X-VG-STAFF-CSRF` zorunludur. API yanıtları `api: "vg-staff/1"`, `ok` ve başarı alanlarını/hata mesajını içerir. Tüm yanıtlar `private, no-store`, `noindex`, `nosniff` başlıklarını taşır.

| İşlem | Yöntem | Alanlar / Yetki |
| --- | --- | --- |
| `me` | GET | `user`, `csrf`, `mfa` (gerekirse `mode`, kurulum için `secret`, `otpauth`) |
| `login` | POST JSON | `email`, `password`; MFA adımına geçer, özel veri erişimi vermez |
| `activate` | POST JSON | `token`, `password`; yalnızca geçerli davet, MFA kurulumu gerekir |
| `mfa_enroll` | POST JSON | `code`; etkinleştirmeden sonra doğrulayıcı kurulumu |
| `mfa_verify` | POST JSON | `code`; şifreden sonra doğrulama |
| `logout` | POST JSON | Boş nesne |
| `users` | GET | Admin/payroll, yalnızca güvenli hesap alanları |
| `create_invite` | POST JSON | Admin: `email`, `name`, `role`; `activationUrl`, `expiresAt`, `userId` |
| `disable_user` | POST JSON | Admin: `userId` |
| `payroll_list` | GET | MFA sonrası; employee yalnızca kendi kayıtları |
| `payroll_create` | POST JSON | Admin/payroll: `userId`, `period` (`YYYY-MM`), `gross`, `net`, `deductions`, `note` |
| `payroll_upload` | POST multipart | Admin/payroll: `statementId`, `pdf` |
| `payroll_download` | GET | `id` sorgusu; kayıt sahibi/admin/payroll |
| `payroll_delete` | POST JSON | Admin/payroll: `statementId` |

`gross`, `net`, `deductions` muhasebe tarafından doğrulanmış tutarlardır. Vergi veya SGK hesaplanmaz. Tutarlar ondalık metin olarak saklanır ve iki basamağı aşan girdiler reddedilir. Sistemde demo veya varsayılan kullanıcı/bordro yoktur.

PDF yükleme 8 MB ile sınırlıdır. Gerçek PHP yüklemesi, fileinfo MIME, `%PDF-` başlangıcı ve `%%EOF` sonlandırıcısı kontrol edilir. Rastgele sunucu dosya adıyla web kökü dışında saklanır. İndirme her istekte kayıt sahibini/yetkisini tekrar doğrular ve attachment olarak gönderir; tahmin edilen kayıt kimliği veya dosya adı erişim sağlamaz. Bu biçim kontrolleri PDF zararlı içerik taraması değildir; dosyaları yetkili muhasebe kaynağından yükleyin. Kayıt silinince veya PDF yenilenince önce durum dosyası kaydedilir; ardından artık hiçbir kaydın kullanmadığı eski PDF silinir. Silme hatası sessizce yutulmaz. Ani süreç kesintisinden kalan yetim dosyalar ve yedekler kurumun saklama/temizlik politikasına tabidir.

JSON deposu atomik yeniden adlandırma ve özel kilit kullanır. Hatalı/okunamayan veri veya kilit alınamaması erişimi kapatır. Çok sunuculu/yoğun kullanım için bu dosya deposu yerine aynı erişim kurallarını koruyan veritabanı gerekir. Mevcut ölçek tek sunucu içindir.

`vg_staff_require_user()` PHP özel sayfa kapısıdır. Ortak `bootstrap.php`, `security.php` ve `staff.php` yüklenip bu fonksiyon HTML gönderilmeden çağrılır. 401 girişe yönlendirilir; 503 özel veri göstermez. Yalnızca ana menüden bağlantıyı gizlemek güvenlik kontrolü değildir.

## Yedek ve doğrulama

Özel `staff/` dizinini ve sunucu yapılandırmasını erişimi sınırlı, şifreli yedeğe dahil edin; oturum dosyaları geri yüklenmemeli. Yedek TOTP anahtarları, şifre özetleri ve kişisel bordro verileri içerir. İşlem geçmişi davet anahtarı, şifre, doğrulayıcı anahtarı veya bordro tutarı kaydetmez.

Canlıya almadan önce yetkisiz genel hesap, geçersiz/yeniden kullanılan davet, eksik MFA, başka çalışanın bordro/PDF kimliği, kapatılmış hesap, CSRF/Origin ve hız sınırı senaryoları gerçek PHP sunucusunda sentetik kayıtlarla doğrulanmalıdır. Statik önizleme veya kaynak testi canlı sunucudaki erişim kısıtlarını kanıtlamaz.
