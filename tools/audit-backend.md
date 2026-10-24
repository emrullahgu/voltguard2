# Backend incelemesi ve uygulanan işler

Tarih: 23 Ekim 2026. Kapsam: `contact.php`, `api/` uç noktaları, ortak kimlik/depo/güvenlik kodu, Apache kuralları ve ilgili HTTP testleri. Testler gerçek PHP sunucusunda, işletim sisteminin geçici dizininde oluşturulan sentetik hesaplarla çalıştırıldı. Canlı hesap, e-posta veya Ubuntu veritabanına yazılmadı.

## Bulgular ve tamamlanan işler

| Öncelik | Bulgu | Uygulama / durum |
| --- | --- | --- |
| P1 | İletişim kodu `mb_strlen` ve PHP 8'e özgü yardımcılar nedeniyle yalın PHP kurulumunda hata veriyordu. | Ortak UTF-8 yardımcıları kullanıldı; PHP 7.4 uyumlu kod, `php -n` altında Türkçe form ile doğrulandı. |
| P1 | İletişim spam sayacı paylaşılan geçici dizinde, IP'nin anahtarsız özetiyle tutuluyor; sayaç arızası gönderime izin veriyordu. | Web kökü dışındaki özel veri dizini, kurulum anahtarlı HMAC, IPv6 /64 gruplaması ve atomik sayaç kullanılıyor. Sayaç açılamaz/yazılamazsa gönderim 503 ile duruyor. |
| P1 | Hesap deposu `.htaccess` güvencesiyle web köküne düşebiliyordu. | Hesap, oturum, iletişim ve hız sınırı dizinleri fiziksel hedefleriyle denetleniyor; web köküne çıkan bağlantı/junction 503 veriyor. Web kökündeki eski veri kurulumu özel dizine taşınmalı. |
| P1 | İstemcinin `X-Forwarded-Proto` başlığı HTTPS sanılabiliyordu. | Başlık yalnızca Cloudflare aralıkları veya açıkça tanımlı `VG_TRUSTED_PROXIES` üzerinden kabul ediliyor. Hesap/çalışan işlemlerinde HTTPS zorunlu; HTTP geliştirme istisnası hem loopback bağlantı hem localhost Host gerektiriyor. |
| P1 | Genel KVKK onayı iletişim ve üyelik için zorunluydu. | Talep işlemleri genel açık rıza kutusuna bağlanmıyor. Eski payload alanları uyum için kabul ediliyor. Kayıtta sunulan aydınlatma sürümü 2026-10-23 olarak kaydediliyor; eski `consent_*` adlarının rıza anlamına gelmediği dokümante edildi. |
| P1 | Hesap silmek üyenin topluluk yorumunu ve özel yazar kimliğini bırakıyordu. | Hesap silme, üye yorum metnini/yazar kimliğini ve moderatör yetkisini temizliyor. Yanıt ilişkileri için yalnız kimliksiz boş kayıt kalıyor. Silmeyle eşzamanlı yayın, aynı kilit ve hesap varlığı denetimiyle korunuyor. |
| P1 | Silinen/yenilenen bordronun eski PDF'si özel depoda kalıyordu. | Önce durum kaydı tamamlanıyor; sonra artık kullanılmayan PDF fiziksel olarak siliniyor. Yazım başarısızsa hâlâ başvurulan belge silinmiyor. Silme hatası görünür hata dönüyor. |
| P1 | E-posta gönderimi PHP fonksiyonu yokken kontrollü karşılanmıyordu; test modu gerçek gönderim gibi anlaşılabiliyordu. | Ortak taşıyıcı, güvenli Reply-To, sabit zarf göndericisi ve 503 hata yolu kullanılıyor. `VG_MAIL_OUTBOX=1` yanıtı e-posta gönderilmediğini açıkça belirtiyor. |
| P2 | Turnstile yanıtında hostname yoksa eski kod kabul ediyordu. | Yapılandırılmış Turnstile için başarılı Siteverify yanıtı, HTTP 200 ve beklenen hostname zorunlu. Token boyutu, zaman aşımı ve yanıt boyutu sınırlı; ağ/servis hatası başarıya dönüşmüyor. |
| P2 | Formun kaynak ve içerik türü denetimleri gevşekti. | Şema/port dahil tam köken, Fetch Metadata, form MIME türü, gövde sınırı, dizi parametreleri, kontrol karakterleri, telefon ve e-posta denetleniyor. Dosya eki reddediliyor. |
| P2 | Ortak Origin denetimi HTTPS:80 ve HTTP/HTTPS farkını aynı köken sayabiliyordu. | Şema ve o şemaya özgü port normalizasyonu düzeltildi; URL içindeki kullanıcı bilgisi reddediliyor. |
| P2 | `application/json-evil` MIME türü ve boş JSON listesi nesne gibi kabul edilebiliyordu. | Gerçek `application/json` türü ve nesne başlangıcı zorunlu. |
| P2 | Bozuk/kayıp depo seçim dosyası otomatik yeni depo seçimine yol açabiliyordu. | İlk depo seçimi ayrı kilit altında yapılır. Var olan verinin işareti kayıpsa veya işaret bozuksa otomatik geçiş yapılmaz. Boş/bozuk JSON da boş depo sayılmaz. |
| P2 | Hesap silmede dosya silme hataları yutuluyordu. | Fiziksel koleksiyon ve hesap silme hataları 503 olarak bildirilir; tamamlanmayan iş başarı diye gösterilmez. |
| P2 | İletişim e-postası gereksiz IP içeriyor, hata günlüğü telefon sonunu kaydediyordu. | Form günlüklerinden tüm kişisel alanlar ve e-posta gövdesinden gereksiz IP çıkarıldı. PHP sürümü X-Mailer başlığında açıklanmıyor. |
| P2 | Apollo/CDN izinleri kaldırılan bağımlılıklardan sonra CSP'de duruyordu; HTTPS redirect Host başlığını kullanıyordu. | `.htaccess` CSP Apollo/cdnjs kaynaklarından temizlendi; HTTPS yönlendirme hedefi sabit kanonik alan adı oldu. |

## Doğrulama

- `node --test tools/tests/backend-hardening.test.cjs tools/tests/auth-forgot.test.cjs`: ilk turda 5 test geçti; sonradan mail taşıyıcısı yokluğu ve yapılandırılmış CAPTCHA eksikliği için ek gerçek HTTP testi eklendi.
- `node --test tools/tests/staff-api.test.cjs tools/tests/community-api.test.cjs tools/tests/company-api.test.cjs tools/tests/company-ubuntu.test.cjs tools/tests/preview-api.test.cjs tools/tests/company-calculations.test.cjs tools/tests/ubuntu-company-bridge.test.cjs`: 11 test geçti; şirket API 257, Ubuntu adaptörü 109, önizleme 216 kontrol.
- PDF temizliği sonrası tekrar: çalışan API 232 kontrol; şirket API 257, topluluk 98, önizleme 216 kontrol ve hardening/forgot testleri geçti.
- Son topluluk ve hardening turu: 5 test geçti; topluluk 103 kontrolü geçti. Kapsam hesap yorumlarının silinmesi, taşıyıcı yokluğu ve yapılandırılmış CAPTCHA eksikliğini de içeriyor.
- `api/` altındaki 16 PHP dosyası ve `contact.php` için `php -n -l` sözdizimi doğrulaması geçti; backend değişikliklerinde `git diff --check` temiz.
- Test e-postaları gerçek adreslere gönderilmedi. Rate limit, kaynak/MIME reddi, hesap oluşturma, özel dosya erişimi, MFA, bordro sahipliği, PDF yenileme/silme, tek kullanımlık davetler ve bozuk depo davranışı gerçek HTTP üzerinden doğrulandı.

## Canlı ortamda tamamlanması gereken işler

- [ ] `VG_DATA_DIR` değerinin web kökü dışında olduğunu ve varsa eski `_vgdata` verisinin yedeklenip bu dizine taşındığını doğrula. Değişiklik eski veriyi otomatik taşımıyor veya silmiyor.
- [ ] Güvenlik desteği devam eden PHP sürümü, gerekli `fileinfo`/SQLite uzantıları, dosya izinleri ve disk alanını sunucuda doğrula. Kodun eski PHP sözdizimiyle uyumlu olması eski sürümlerin güvenlik bakımını sağlamaz.
- [ ] `noreply@voltguard.com.tr` zarf göndericisi, mail taşıyıcısı, SPF/DKIM/DMARC ve gerçek gelen kutusu teslimini kontrollü bir canlı mesajla doğrula. `mail()` kabulü teslim garantisi değildir; bu denetimde gerçek gönderim yapılmadı.
- [ ] Turnstile kullanılacaksa gerçek anahtarı yalnız sunucu ortamına ekle, sitekey ve hostname eşleşmesini canlıda doğrula. Anahtarsız durumda form doğrulama, bal tuzağı ve IP sınırı çalışır; CAPTCHA varmış gibi gösterilmez.
- [ ] Cloudflare dışındaki TLS sonlandırıcılar için yalnız gerçek vekil IP/CIDR değerlerini `VG_TRUSTED_PROXIES` içinde tanımla; dış istemcinin vekil başlıklarını değiştiremediğini kontrol et.
- [ ] Ubuntu SSH bağlantısını gerçek özel yapılandırma ve anahtarlarla doğrula. Canlı OSOS/harici yapay zekâ servisi tanımlı değilse mevcut API bunları kapalı bildirir; sahte ölçüm veya sahte servis yanıtı üretilmez.
- [ ] Kurumun yedek saklama, geri yükleme, kişisel veri imha ve yetim PDF temizliği süreçlerini uygula. Ani süreç sonlandırması, disk arızası ve yedeklerden geri dönüş kod testleriyle idari olarak tamamlanmış sayılmaz.
- [ ] Apache/LiteSpeed üzerinde gerçek response header ve redirect kontrolü yap. Yerel PHP sunucusu `.htaccess` çalıştırmadığından Apache modül davranışı bu testlerle doğrulanmış değildir.

## Kaynaklar ve sınır

KVKK Kurumunun [aydınlatma yükümlülüğü duyurusu](https://www.kvkk.gov.tr/Icerik/6765/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESI-HAKKINDA-KAMUOYU-DUYURUSU), aydınlatma ile açık rızanın ayrılmasını ve aydınlatma onayının hizmet ön koşulu yapılmamasını açıklar. [Aydınlatma yükümlülüğü bilgisi](https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-) metinde kimlik, amaç, alıcılar, yöntem/hukuki sebep ve ilgili kişi haklarının bulunmasını gerektirir. Teknik akış bu ayrım doğrultusunda düzeltildi; şirketin veri sorumlusu yükümlülüklerinin tamamı kod değişikliğiyle yerine getirilmiş sayılmaz.

Cloudflare [sunucu doğrulaması dokümanı](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) Siteverify zorunluluğunu, tokenın beş dakikalık süresini ve tek kullanımlı olmasını açıklar. Bu denetim bir mevzuat veya güvenlik sertifikası değildir; uygulanan kontroller ve doğrulanmamış canlı bağımlılıklar yukarıda ayrı belirtilmiştir.
