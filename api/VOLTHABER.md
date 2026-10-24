# VoltHaber API ve yayın sistemi

VoltHaber, `/volthaber/` altında yayımlanan sektör haberleri ve teknik analiz bölümüdür. Ana sayfadaki
"VoltGuard'dan Haberler" bölümünden bağımsızdır. Bu dosya web'den okunamaz (`.htaccess` `*.md` dosyalarını engeller).

## Dosyalar

| Dosya | İçerik |
| --- | --- |
| `api/volthaber.php` | JSON API giriş noktası |
| `api/lib/volthaber.php` | Depolama, doğrulama, sınırlı Markdown, roller, abonelik |
| `api/lib/volthaber-api.php` | Yönlendirici, editör işlemleri, bülten, sosyal taslaklar |
| `api/lib/volthaber-fetch.php` | RSS/Atom tarayıcı (SSRF korumalı) |
| `api/lib/volthaber-registry.php` | Doğrulanmış kaynak kaydı (kanıt ve kontrol tarihiyle) |
| `api/lib/volthaber-render.php` | Sunucu tarafı sayfa üretimi |
| `api/lib/volthaber-seed.json` | Açılış içeriği (`node tools/build-volthaber-seed.cjs`) |
| `volthaber/index.php` | Herkese açık sayfalar, `sitemap.xml`, `rss.xml` |
| `volthaber/index.html` | `tools/shell.py` ile senkron şablon; PHP olmayan yansıda statik yedek |
| `hesap/volthaber-panel.html` | Editör paneli (`js/hesap-volthaber-panel.js`) |
| `tools/volthaber-admin.php` | Editör yetkisi (yalnızca CLI) |
| `tools/volthaber-fetch.php` | Zamanlanmış tarama (yalnızca CLI) |

## Veri

`vg_data_dir()/volthaber/` (docroot dışı, 0700/0600, tek kilit + atomik yazma): `articles.json`, `views.json`
(yalnızca toplam sayaç), `sources.json`, `editors.json`, `subscribers.json`, `digests.json`, `fetchlog.json`,
`publog.json`. İlk istekte `articles.json` yoksa açılış içeriği kullanılır ve ilk yazmada kalıcı olur.
Yedeklerken `vg-data/volthaber/` dizinini de alın.

## Uç noktalar

Zarf: `{"api":"vg-auth/1","ok":true|false,"service":"vg-volthaber/1",...}`.

Herkese açık: `list` (GET `category, tag, type, q, page`), `article` (GET `slug`), `most_read`, `categories`,
`subscribe` (POST `email, consent:true, website:""`), `confirm` (POST `token`), `unsubscribe` (POST `token`).

Editör (oturum + Origin + `X-VG-CSRF` + editör rolü): `editor_me`, `editor_list`, `editor_get`, `save`, `preview`,
`publish`, `schedule` (`publishAt` ISO), `archive`, `to_draft`, `discard` (yalnız gelen kutusu), `sources`,
`source_save`, `fetch_run`, `fetch_log`, `pub_log`, `stats`, `subscribers_export` (POST → CSV), `social`,
`digest_list`, `digest_create`, `digest_send`.

## Kurallar

- Türler: `analiz` (özgün, en az 300 karakter), `resmi` (kaynak zorunlu), `kaynak` (kaynak zorunlu; özeti bir
  editör yazmış olmalı, başlığın tekrarı olamaz). Yayın için en az 40 karakter editör özeti gerekir.
- Aynı kaynak adresi (utm/www/sondaki / farkı yok sayılır) reddedilir; neredeyse aynı başlık `confirmSimilar` ile
  işaretlenerek kaydedilir.
- Yalnızca https adresleri; görselde künye ve kullanım hakkı kaydı zorunlu; ham HTML desteklenmez.
- Tarayıcı yalnızca başlık, bağlantı, tarih ve kaynak adını saklar. "İzin gerekli" kaynak etkinleştirilemez.
- Bülten: açık rıza + çift onay; her e-postada tek tıkla çıkış; çıkışta e-posta adresi silinir. Gönderim 20'şerlik
  gruplarla, gruplar arasında en az 60 saniye.

## Test

`node tools/tests/volthaber-api.test.cjs` (VG_PHP ile PHP seçilir; ağ kullanılmaz, akışlar yerel örneklerden okunur).
Yerel önizleme: `php -S 127.0.0.1:8090 -t . tools/volthaber-dev-router.php` (VG_DATA_DIR docroot dışında olmalı).
