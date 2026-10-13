# VoltGuard Tools hesap API'si (`api/auth.php`)

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

Ek kurulum gerekmez: cPanel deploy (`.cpanel.yml`) `api/` klasörünü kopyalar, ilk istekte veri klasörü ve tablolar oluşur.

**`api/` her deploy'da silinip yeniden kopyalanır; içine asla veri yazılmaz.** Çalışma verisi şu sırayla seçilen klasördedir:

1. `VG_DATA_DIR` ortam değişkeni (verilmişse ve yazılamıyorsa API 503 döner; sessizce başka klasöre geçmez),
2. `dirname(DOCUMENT_ROOT)/vg-data` → cPanel'de `/home/voltgua2/vg-data` (public_html **dışı**, önerilen),
3. `DOCUMENT_ROOT/_vgdata` (web'den `.htaccess` ile kapalı; içine ayrıca `Require all denied` içeren `.htaccess` ve boş `index.html` bırakılır).

Klasör içeriği (hepsi 0600/0700):

```
vg-data/
  store.kind            "sqlite" veya "json" (ilk istekte yazılır; sonradan değişmez → kullanıcılar iki depoya bölünmez)
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
| `VG_RATE_SCALE` | `1` | Hız sınırı eşiklerini çarpar (staging/test) |
| `VG_MAIL_OUTBOX` | — | `1`: e-posta gönderilmez, `outbox/` klasörüne `.eml` yazılır. **Canlıda tanımlamayın.** |

cPanel'de ortam değişkeni için `.htaccess` içine `SetEnv VG_DATA_DIR /home/voltgua2/vg-data` yazılabilir
(LiteSpeed/Apache `mod_env`). Varsayılanlar canlı sunucu için uygundur; değişken tanımlamak gerekmez.

## Uç noktalar

Tüm yanıtlar `application/json`, `Cache-Control: no-store` ve `{"api":"vg-auth/1", "ok": true|false, ...}` biçimindedir.
Hata: `{"ok":false,"error":"<kod>","message":"<Türkçe mesaj>","fields":{...}}` (+ 429'da `retryAfter` ve `Retry-After`).

| İşlem | Yöntem | Gövde (JSON) | Not |
| --- | --- | --- | --- |
| `me` | GET | — | `{user|null, csrf, expired?}`; anonim oturumu ve CSRF jetonunu başlatır |
| `register` | POST | `name, email, password, company?, phone?, consent:true, website:"" (bal tuzağı), remember?` | 201; otomatik giriş |
| `login` | POST | `email, password, remember?` | e-posta ve IP başına kademeli kilit |
| `logout` | POST | `{}` | oturum dosyası silinir, çerez temizlenir |
| `update_profile` | POST | `name?, company?, phone?, email?, password?` | e-posta değişikliği mevcut şifre ister |
| `change_password` | POST | `current, password` | diğer oturumlar kapanır, yeni CSRF döner, bildirim e-postası |
| `delete_account` | POST | `password, confirm:true` | hesap + tüm veriler kalıcı silinir |
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
  mevcut şifre doğrulaması kullanıcı başına 5 hata.
- Temizlik: süresi dolmuş sayaç (rl/) ve oturum dosyaları saatte en fazla bir kez, yanıt gönderildikten sonra taranıp silinir
  (`gc-rl.last`, `gc-sessions.last` işaret dosyaları).
- E-posta `mail()` ile `-f noreply@voltguard.com.tr` zarf göndericisiyle gider: cPanel'de bu adresin (veya alan adının)
  gönderici olarak izinli olduğunu, SPF/DKIM kayıtlarının tanımlı olduğunu kontrol edin.
- Sıfırlama bağlantısı URL parçasında (`#t=`) taşınır: sunucu günlüklerine ve Referer'a gitmez; veritabanında yalnızca SHA-256 özeti tutulur.
- Günlüklere (error_log) kişisel veri yazılmaz; yalnızca hata türü/konumu.
- Cloudflare arkasında `CF-Connecting-IP` yalnızca istek gerçek bir Cloudflare adresinden geliyorsa kullanılır (contact.php ile aynı).

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
