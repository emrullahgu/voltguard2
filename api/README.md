# VoltGuard hesap API'si (`api/auth.php`)

## Site sahibinin sunucuda yapması gerekenler (kontrol listesi)

1. **Cloudflare Turnstile (iletişim / teklif / "Sor" formları)** — iki parça birlikte ayarlanır:
   - Herkese açık *site anahtarı*: `index.html`, `sor.html`, `fabrika-cozumleri.html` içindeki
     `data-sitekey="REPLACE_WITH_TURNSTILE_SITE_KEY"` değerini Cloudflare panelindeki site anahtarıyla değiştirin.
     Anahtar yer tutucu kaldıkça sayfalar Turnstile betiğini **hiç yüklemez** (bozuk kutu görünmez).
   - Gizli anahtar: sunucuda `TURNSTILE_SECRET_KEY` ortam değişkeni. **Gizli anahtarı yalnızca site anahtarı sayfalara
     yazıldıktan sonra tanımlayın.** Gizli anahtar var ama formda jeton yoksa `contact.php` güvenli tarafta kalır (422
     "Güvenlik doğrulaması yüklenemedi") ve `error_log`a yapılandırma uyarısı yazar.
   - Gizli anahtar yoksa formlar çalışır; koruma alan doğrulama, bal tuzağı, IP başına 10 dakikada 5 ve site geneli
     saatte 40 mesaj sınırıdır (Turnstile açıkken saatte 120). Her gönderimde `error_log`a "bot doğrulaması kapalı" yazılır.
   - Deploy sonrası bir test mesajı gönderip `info@voltguard.com.tr` kutusunda görün.
2. **Ortam değişkenleri `.htaccess` ile verilmez**: deploy `.htaccess` dosyasının üzerine yazar ve `SetEnv` satırları kaybolur.
   cPanel → *MultiPHP INI Editor / LiteSpeed* ya da hosting panelinin ortam değişkeni ekranını kullanın
   (LiteSpeed'de `lsapi` için `.user.ini` docroot **dışındaki** PHP yapılandırmasıyla). Varsayılanlar canlı için uygundur;
   zorunlu olan yalnızca Turnstile gizli anahtarıdır.
3. **Özel veri dizini** `/home/voltgua2/vg-data` (docroot dışı) yazılabilir olmalı; docroot içine düşme seçeneği yoktur, yoksa API 503 döner.
4. **E-posta**: `noreply@voltguard.com.tr` gönderici olarak izinli olmalı; SPF ve DKIM kayıtlarını doğrulayın.
5. **Topluluk**: misafir yorumları varsayılan olarak açıktır. `VG_COMMUNITY_GUESTS=off` topluluğu yalnızca üyelere açar;
   `VG_COMMUNITY_GUEST_DAILY` (varsayılan 100) site geneli günlük misafir yorum sınırıdır. En az bir moderatör atayın
   (`php tools/community-admin.php grant <kullanıcı-id>`, bkz. `COMMUNITY.md`); 3 farklı ziyaretçinin bildirdiği yorumlar
   moderatör "İncelendi, yayımla" diyene kadar gizlenir.
6. **Netlify** (`voltguard2.netlify.app`) yalnızca statik vitrindir: `/hesap/*`, `/calisan/*` ve `/topluluk.html`
   `https://voltguard.com.tr` adresine 301 ile yönlenir. Netlify'a özel alan adı olarak `voltguard.com.tr` bağlanırsa bu
   yönlendirmeler döngü yaratır; o durumda `netlify.toml` içindeki bu kuralları kaldırın.

Sunucu tarafı üyelik sistemi: kayıt, giriş/çıkış, profil, şifre değiştirme ve sıfırlama, hesap silme (KVKK),
favoriler / hesaplama geçmişi / projeler / dokümanlar senkronu ve tüm verilerin JSON olarak dışa aktarımı.

- PHP 7.4 – 8.x, Composer veya harici kütüphane yok.
- Depolama: `pdo_sqlite` varsa SQLite (tek dosya), yoksa JSON dosyaları (`flock` + atomik `rename`).
- Bu dosya web'den okunamaz (`.htaccess` `*.md` dosyalarını engeller). Gizli bilgi (şifre, anahtar) **yazmayın**.

## Dosyalar

| Dosya | İçerik |
| --- | --- |
| `auth.php` | Tek giriş noktası (JSON yönlendirici) |
| `lib/bootstrap.php` | Sabitler, JSON yanıt, istek ayrıştırma, istemci IP, veri klasörü, gizli anahtar |
| `lib/store.php` | `VgStore` arayüzü, `VgSqliteStore`, `VgJsonStore`, depo seçimi |
| `lib/security.php` | Oturum (VGSESS), CSRF, Origin/Referer denetimi, hız sınırları |
| `lib/validate.php` | Alan doğrulama, şifre kuralı, koleksiyon şemaları ve sınırları |
| `lib/mailer.php` | Şifre sıfırlama ve "şifreniz değişti" e-postaları (`mail()`) |
| `lib/handlers.php` | İşlemler ve yönlendirici (`vg_run`) |

`api/lib/` web'den erişilemez (kök `.htaccess` + `api/lib/.htaccess`); dosyalar `VG_API` sabiti olmadan hiçbir şey yapmaz.

## Kurulum

cPanel deploy (`.cpanel.yml`) `api/` klasörünü kopyalar. Web kökü dışındaki özel veri dizini yazılabilir olmalıdır; ilk istekte tablolar oluşur. Canlı hesap işlemleri HTTPS gerektirir. Düz HTTP yalnızca loopback istemci ve localhost adresi birlikte doğrulanınca geliştirme için kabul edilir.

**`api/` her deploy'da silinip yeniden kopyalanır; içine asla veri yazılmaz.** Çalışma verisi şu sırayla seçilen klasördedir:

1. `VG_DATA_DIR` ortam değişkeni (verilmişse ve yazılamıyorsa API 503 döner; sessizce başka klasöre geçmez),
2. `dirname(DOCUMENT_ROOT)/vg-data` → cPanel'de `/home/voltgua2/vg-data` (public_html **dışı**, önerilen),

`DOCUMENT_ROOT/_vgdata` eski kurulumların koruması için kapalı tutulur; hesap, iletişim, oturum ve hız sınırı verisi için artık kullanılmaz. Özel dizin yoksa sistem 503 verir. Dizinlerin fiziksel hedefi de denetlenir; web köküne çıkan sembolik bağlantı/junction kabul edilmez. Eski verisi `_vgdata` altında olan kurulumda dizini yedekleyip web kökü dışına taşıyın ve `VG_DATA_DIR` değerini ayarlayın.

Klasör içeriği (hepsi 0600/0700):

```
vg-data/
  store.kind            "sqlite" veya "json" (ilk istekte yazılır; sonradan değişmez → kullanıcılar iki depoya bölünmez)
  store-kind.lock       ilk depo seçimini eşzamanlı isteklerde kilitler
  vg-accounts.sqlite    SQLite modu: users, user_data, reset_tokens tabloları
  json/                 JSON modu: emails.json, tokens.json, users/<id>.json, data/<id>/<koleksiyon>.json, store.lock
  sessions/             PHP oturum dosyaları (VGSESS)
  rl/                   hız sınırı sayaçları (HMAC ile özetlenmiş anahtarlar, 24 saatte temizlenir)
  secret.key            kuruluma özel rastgele anahtar (sayaç adları için HMAC)
  dummy.hash            zamanlama eşitleme için rastgele şifre özeti
  outbox/               yalnızca VG_MAIL_OUTBOX=1 iken (test)
```

Yedekleme: `vg-data/` klasörünü (özellikle `vg-accounts.sqlite` veya `json/`) yedekleyin. `sessions/`, `rl/` yedeklenmesi gerekmez.

### Ortam değişkenleri (isteğe bağlı)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `VG_DATA_DIR` | — | Veri klasörü (mutlak yol) |
| `VG_SITE_URL` | `https://voltguard.com.tr` | Sıfırlama e-postasındaki bağlantının kökü (Host başlığına güvenilmez) |
| `VG_STORE` | otomatik | `sqlite` / `json` — yalnızca ilk kurulumda etkilidir |
| `VG_ALLOWED_HOSTS` | — | Origin denetiminde Host'a ek olarak kabul edilecek host'lar (virgüllü) |
| `VG_TRUSTED_PROXIES` | — | Cloudflare dışındaki HTTPS sonlandırıcı vekillerin IP/CIDR listesi; rastgele istemcinin X-Forwarded-Proto başlığına güvenilmez |
| `VG_CONTACT_ALLOWED_ORIGINS` | — | İletişim formu staging kökenleri (örn. `https://staging.example`); canlı izinler kanonik HTTPS ve www adresidir |
| `VG_RATE_SCALE` | `1` | Hız sınırı eşiklerini çarpar (staging/test) |
| `VG_MAIL_OUTBOX` | — | `1`: e-posta gönderilmez, `outbox/` klasörüne `.eml` yazılır. **Canlıda tanımlamayın.** |

| `TURNSTILE_SECRET_KEY` | — | İletişim formları için Turnstile gizli anahtarı (yukarıdaki kontrol listesi) |
| `TURNSTILE_EXPECTED_HOSTNAME` | `voltguard.com.tr` | Siteverify yanıtında beklenen alan adı |
| `VG_COMMUNITY_GUESTS` | açık | `off`: topluluğa yalnızca üyeler yazar |
| `VG_COMMUNITY_GUEST_DAILY` | `100` | Site geneli 24 saatlik misafir yorum sınırı |

Ortam değişkenlerini `.htaccess` (`SetEnv`) ile **vermeyin**: her deploy `.htaccess` dosyasının üzerine yazar. Hosting panelinin
ortam değişkeni / PHP yapılandırma ekranını kullanın. Varsayılanlar canlı sunucu için uygundur.

## Uç noktalar

Tüm yanıtlar `application/json`, `Cache-Control: no-store` ve `{"api":"vg-auth/1", "ok": true|false, ...}` biçimindedir.
Hata: `{"ok":false,"error":"<kod>","message":"<Türkçe mesaj>","fields":{...}}` (+ 429'da `retryAfter` ve `Retry-After`).

| İşlem | Yöntem | Gövde (JSON) | Not |
| --- | --- | --- | --- |
| `me` | GET | — | `{user|null, csrf, expired?}`; anonim oturumu ve CSRF jetonunu başlatır |
| `register` | POST | `name, email, password, company?, phone?, website:"" (bal tuzağı), remember?` | 201; otomatik giriş; eski `consent:true` alanı kabul edilir fakat zorunlu değildir |
| `login` | POST | `email, password, remember?` | e-posta ve IP başına kademeli kilit |
| `logout` | POST | `{}` | oturum dosyası silinir, çerez temizlenir |
| `update_profile` | POST | `name?, company?, phone?, email?, password?` | e-posta değişikliği mevcut şifre ister |
| `change_password` | POST | `current, password` | diğer oturumlar kapanır, yeni CSRF döner, bildirim e-postası |
| `delete_account` | POST | `password, confirm:true` | hesap, koleksiyonlar, üye yorumları ve moderatör yetkisi silinir; yanıtlar için kimliksiz boş yorum kaydı kalabilir |
| `forgot_password` | POST | `email` | her durumda aynı yanıt; jeton 1 saat, tek kullanım |
| `reset_password` | POST | `token, password` | tüm oturumlar kapanır |
| `data_get` | GET | `?collection=all|favorites,history,...` | `{collections:{<ad>:{items,rev,updatedAt}}}` |
| `data_put` | POST | `collection, ops:[{op:"upsert",item}|{op:"delete",id}]` veya `collection, items:[...], base_rev?` | sunucu doğrular, `serverAt` ekler, sınırları uygular; `base_rev` uyuşmazsa 409 |
| `export` | GET | — | `Content-Disposition: attachment` JSON (şifre özeti yok) |

İşlem adı `?action=` ile ya da PATH_INFO ile verilebilir (`/api/auth.php/login`).

Koleksiyon sınırları: favoriler 200, geçmiş 500 (dolunca en eskiler düşer), projeler 200, dokümanlar 500;
ayrıca JSON boyutu sınırı (128 KB – 1 MB). Kimlik biçimleri: favori = araç slug'ı, `h_…`, `p_…`, `d_…`.

Geçmiş kaydı (`history`) alanları: `id, toolSlug, toolName, toolUrl, params:[{label,value}] (en fazla 60), result:{value, note,
breakdown?}, note, savedAt, serverAt`. `result.breakdown` isteğe bağlıdır: hesap sayfasındaki `.calc-breakdown` satırları
("Etiket: Değer"), en fazla 20 satır × 200 karakter; boşsa alan yazılmaz. İstemci (`js/voltguard-auth.js` cleanItem) aynı kuralı uygular.

## Güvenlik özeti

- `password_hash(PASSWORD_DEFAULT, cost 11)` + `password_verify`, girişte gerekirse yeniden özetleme; şifre 8–64 karakter,
  harf + rakam, yaygın şifre listesi; var olmayan hesapta da aynı maliyetli doğrulama (zamanlama ile hesap tespiti yok).
- Oturum çerezi `VGSESS`: HttpOnly, HTTPS'te Secure, SameSite=Lax, strict mode; girişte `session_regenerate_id(true)`.
  Süreler: normal 2 saat boşta / 12 saat en fazla; "Beni hatırla" 14 gün boşta / 30 gün en fazla.
  Şifre veya e-posta değişince / şifre sıfırlanınca kullanıcının `epoch` değeri artar → diğer tüm oturumlar geçersiz olur.
  E-posta değişince bekleyen sıfırlama jetonları silinir ve ESKİ adrese bildirim e-postası gider.
- CSRF: oturuma bağlı jeton, durum değiştiren her istekte `X-VG-CSRF` başlığı (`hash_equals`). Çerezsiz POST oturum açmadan reddedilir.
- Origin (yoksa Referer) aynı köken olmalı; `Sec-Fetch-Site: cross-site` reddedilir; yalnızca `application/json` gövde.
- Hız sınırları ("IP" = IPv4 adresi ya da IPv6 /64 öneki, `vg_rl_ip_key()`): giriş e-posta+IP çifti başına 15 dk'da 5 hatadan
  sonra 30 sn → 15 dk'ya kadar artan kilit (başkası sahibini kendi bağlantısından kilitleyemez), e-posta başına dağıtık denemelere
  karşı 15 dk'da 50 hata → 15 dk, IP başına 30 hata → 15 dk; kayıt IP başına 10/saat; şifre sıfırlama isteği IP başına 5/15 dk ve
  e-posta başına 3/saat (sessiz); sıfırlama IP başına 10/15 dk; e-posta değişikliği hesap başına 5/saat ve IP başına 10/saat;
  mevcut şifre doğrulaması kullanıcı başına 5 hata; `me` (anonim oturum açılışı) istemci başına 10 dakikada 1200.
- Temizlik: süresi dolmuş sayaç (rl/) ve oturum dosyaları saatte en fazla bir kez, yanıt gönderildikten sonra taranıp silinir
  (`gc-rl.last`, `gc-sessions.last` işaret dosyaları).
- E-posta `mail()` ile `-f noreply@voltguard.com.tr` zarf göndericisiyle gider: cPanel'de bu adresin (veya alan adının)
  gönderici olarak izinli olduğunu, SPF/DKIM kayıtlarının tanımlı olduğunu kontrol edin.
- Sıfırlama bağlantısı URL parçasında (`#t=`) taşınır: sunucu günlüklerine ve Referer'a gitmez; veritabanında yalnızca SHA-256 özeti tutulur.
- Günlüklere (error_log) kişisel veri yazılmaz; yalnızca hata türü/konumu.
- Cloudflare arkasında `CF-Connecting-IP` yalnızca istek gerçek bir Cloudflare adresinden geliyorsa kullanılır (contact.php ile aynı).
- Hız sınırı dizini veya sayaç yazımı başarısızsa koruma sessizce devre dışı kalmaz; istek 503 ile kapanır.
- `store.kind` bozuksa veya var olan veri için kayıpsa depo otomatik değişmez; yedekten kontrollü kurtarma gerekir.
- `consent_at` ve `consent_ver` eski veri şemasındaki alan adlarıdır. Yeni kayıtlarda bunlar kayıt talebinin zamanı ve sunulan aydınlatma metninin sürümünü belirtir; genel veri işleme rızası sayılmaz.

## İletişim formu (`/contact.php`)

Yalnızca `POST` form verisi, doğrulanan aynı site kökeni ve en fazla 32 KB gövde kabul edilir. Dosya eki alınmaz. Ad, Türkiye telefonu (cep, sabit hat veya 850), isteğe bağlı e-posta, hizmet alanı, 20–1000 karakter mesaj ve form zaman işareti doğrulanır. Aydınlatma metni formda sunulur; aydınlatma için onay veya genel amaçlı açık rıza gönderimin ön koşulu değildir.

Ana sayfa formu, VoltGuard'a Sor ve teklif sihirbazı aynı uç noktayı `js/vg-quote.js` ile kullanır (ayrı bir teklif sistemi yoktur):

- `kind=quote` (teklif sihirbazı): telefon **veya** e-postadan biri yeterlidir; `kind=contact`: telefon zorunludur.
- `requestId` (16–64 karakter `[A-Za-z0-9_-]`): aynı talebin yeniden denemesinde aynı kalır. Kabul edilen talep `requests/` altında HMAC adlı, kişisel veri içermeyen bir kayıtla (talep numarası, içerik özeti, zaman; 7 gün) işaretlenir. Aynı kimlik + aynı içerik ikinci e-posta üretmez ve ilk talep numarasını `duplicate: true` ile döndürür; aynı kimlik + farklı içerik `409 already_received` döner. Kayıt `flock` ile kilitlenir, eşzamanlı çift gönderim tek kayda iner.
- Başarı yanıtı yalnızca e-posta gönderim sistemine (önizlemede `outbox/`) teslimden sonra verilir: `{success, message, reference: "VG-yymmdd-XXXXX", duplicate, preview}`. İstemci talep numarası olmayan bir yanıtı başarı saymaz (PHP çalışmayan statik önizlemede sahte başarı gösterilmez).
- `simulation` + `simulationConsent=1` (yalnızca `kind=quote`): ziyaretçinin VoltSim'de görüp onayladığı özet (`trafo`, `pano`, `komp`, `ges`; girdiler, sonuçlar, varsayımlar, hesaplama sürümü). Onay olmadan veya sınır dışı içerikle 422 döner; özet e-postaya eklenir, ayrıca saklanmaz.
- Hata yanıtları `code` alanı taşır (`invalid_phone`, `contact_required`, `simulation_consent`, `mail_unavailable` …).

IP adresi e-postaya/günlüğe yazılmaz; spam sayacı özel dizinde HMAC adıyla, IPv6 için /64 gruplamasıyla tutulur. IP başına 10 dakikada 5 istek ve site geneli saatlik sınır (Turnstile kapalıyken 40, açıkken 120) vardır. Sayaç arızası gönderimi durdurur. `TURNSTILE_SECRET_KEY` tanımlıysa Siteverify sunucu doğrulaması ve hostname eşleşmesi zorunludur (jeton yoksa 422 + yapılandırma uyarısı); `TURNSTILE_EXPECTED_HOSTNAME` varsayılanı `voltguard.com.tr` olur. Anahtar yoksa alan doğrulama, bal tuzağı ve hız sınırları çalışır.

## Güvenlik başlıkları

`.htaccess` yol bazlı CSP uygular (`mod_setenvif` ile `VG_CSP_*`): genel sayfalar mevcut politikayı; `/hesap/` ve `/calisan/`
satır içi betik ve `eval` olmadan (`script-src 'self'`, `frame-ancestors 'none'`); `/calisan/uygulama/` derlenmiş uygulama için
satır içi betiksiz (`'unsafe-eval'` yalnızca kütüphaneler için); `/api/` `default-src 'none'`. Hesap sayfalarının betikleri
`js/hesap-*.js` dosyalarındadır; bu sayfalara satır içi `<script>` veya `onclick=` eklemeyin (`tools/tests/account-hardening.test.cjs` denetler).

Mesaj `info@voltguard.com.tr` adresine, sabit alan adı göndericisiyle ve doğrulanmış Reply-To ile gönderilir. `mail()` yoksa veya kabul etmezse 503 döner; başarı yalnızca taşıyıcının iletiyi kabul ettiğini belirtir, gelen kutusu teslim garantisi değildir. `VG_MAIL_OUTBOX=1` yalnızca yerel test içindir; yanıt gerçek e-posta gönderilmediğini açıkça bildirir.

## curl ile test

```sh
B=https://voltguard.com.tr
J=/tmp/vg.cookies
# 1) oturum + CSRF jetonu
CSRF=$(curl -s -c $J -b $J "$B/api/auth.php?action=me" | sed -E 's/.*"csrf":"([a-f0-9]+)".*/\1/')
# 2) kayıt
curl -s -c $J -b $J -H "Content-Type: application/json" -H "Origin: $B" -H "X-VG-CSRF: $CSRF" \
  -d '{"name":"Test Kullanıcı","email":"test@example.com","password":"Deneme1234","consent":true}' \
  "$B/api/auth.php?action=register"
# Kayıt/giriş yanıtındaki yeni "csrf" değerini sonraki isteklerde kullanın:
CSRF=$(curl -s -c $J -b $J "$B/api/auth.php?action=me" | sed -E 's/.*"csrf":"([a-f0-9]+)".*/\1/')
# 3) favori ekle
curl -s -c $J -b $J -H "Content-Type: application/json" -H "Origin: $B" -H "X-VG-CSRF: $CSRF" \
  -d '{"collection":"favorites","ops":[{"op":"upsert","item":{"toolSlug":"kablo-kesiti-hesaplama","toolName":"Kablo Kesiti"}}]}' \
  "$B/api/auth.php?action=data_put"
# 4) veriler ve dışa aktarma
curl -s -b $J "$B/api/auth.php?action=data_get"
curl -s -b $J -OJ "$B/api/auth.php?action=export"
# 5) hesabı sil
curl -s -c $J -b $J -H "Content-Type: application/json" -H "Origin: $B" -H "X-VG-CSRF: $CSRF" \
  -d '{"password":"Deneme1234","confirm":true}' "$B/api/auth.php?action=delete_account"
```

Deploy sonrası hızlı kontrol: `/api/lib/bootstrap.php`, `/api/README.md`, `/_vgdata/x` → 403/404 olmalı;
`/api/auth.php?action=me` → `{"api":"vg-auth/1","ok":true,...}` ve `Set-Cookie: VGSESS=...; secure; HttpOnly; SameSite=Lax`.

Kapsamlı uçtan uca test betiği (Node 18+, bağımlılıksız) geliştirme ortamında tutulur:
`node api-test.mjs --base https://staging.example --static` (kayıt, giriş kilidi, CSRF/Origin, veri senkronu, sınırlar,
şifre değiştirme/sıfırlama, dışa aktarma ve hesap silme). Canlı sunucuda çalıştırırken kayıt IP sınırına (10/saat) dikkat edin.
