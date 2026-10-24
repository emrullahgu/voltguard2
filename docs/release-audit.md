# Sürüm denetimi — `claude/site-polish` @ 33e37bd

Tarih: 24.10.2026 16:53 (Europe/Istanbul) · Denetleyen: release-audit oturumu
Kapsam: commit edilmiş kod (33e37bd). Çalışma kopyasındaki commit edilmemiş değişiklikler (aynı anda çalışan diğer
oturumlara ait 29 dosya ve yeni dosyalar) bu denetimin **dışındadır**; sonuçlar onlara genellenemez.

## 1. Depo durumu

| Konu | Durum | Kanıt |
|---|---|---|
| Aktif dal | `claude/site-polish` | `git branch --show-current` |
| HEAD | `33e37bd` "Redirect old /voltsim.html and /volthaber.html; sitemap consistency test" | `git log -1` |
| Uzak dal | `origin/claude/site-polish` = 33e37bd (push edilmiş) | `git rev-parse origin/claude/site-polish` |
| PR | #11 → `main`, açık, birleştirilmedi | GitHub |
| Ajan dalları | 5 ajan dalı (`worktree-agent-*`) HEAD'e tamamen birleştirilmiş; HEAD'de olmayan commit yok | `git rev-list --count HEAD..<dal>` = 0 |
| Koyu/açık tema | **Tamamlanmadı.** Ajan dalı `worktree-agent-a25dfa240146936b0`: 0 commit, ~230 commit edilmemiş dosya, ajan çalışıyor. HEAD'de tema yok. | `git -C .claude/worktrees/agent-a25dfa240146936b0 status` |
| Commit edilmemiş (bu oturuma ait) | `tools/ci/apache-smoke.sh`, `tools/ci/apache-smoke-client.php` (hazırlık testi betikleri; commit/push sizin onayınızı bekliyor) | `git status` |
| Commit edilmemiş (diğer oturumlar) | 29 değişmiş + 8 yeni dosya (VoltHaber, güvenlik, SEO, teklif sihirbazı, performans… oturumları). Dokunulmadı. | `git status` |

## 2. Son başarısız CI'ın gerçek nedeni

| Commit | voltguard-ci | Neden |
|---|---|---|
| ab29b91 | **failure** — 1/390 | `tools/tests/deploy-integrity.test.cjs` › "üretilen sayfalar ve arama dizini kaynaklarıyla güncel": `node tools/build-search-index.cjs --check` → `js/search-index.js güncel değil`. Ana sayfadan iki kart kaldırıldı, `npm run build:content` çalıştırılmadı; dizinde silinen metin kaldı. |
| dbdd1c2 | success — 390/390 | Dizin yeniden üretildi. Test gevşetilmedi/silinmedi. |
| 33e37bd | success — 392/392 (+2 yeni sitemap tutarlılık testi) | — |
| 62fad21 | **test edilmedi** | ab29b91 ile aynı push'ta gitti; sunucu CI'ı yalnız dal başını test eder. Ara commit'ler ayrıca test edilmiyor. |

Kanıt: `.qa/ci-ab29b91.log`, `.qa/ci-33e37bd.log` (sunucu: `~/servisler/voltguard-ci/logs/`).
Önleme önerisi: içerik değiştiren commit'lerden önce `npm run build:content`; isteğe bağlı `pre-commit` kancası (kurulmadı).

## 3. Üretilen dosyalar — temiz checkout

Ortam: Windows 11, Node 24.18, Python 3.12, PHP 8.3.35 (yerel taşınabilir), `git -c core.autocrlf=false clone` (Linux ile aynı LF içerik), commit dbdd1c2 → 33e37bd farkı yalnız `.htaccess`, `netlify.toml` ve yeni test.

| Komut | Sonuç |
|---|---|
| `node tools/build-{mevzuat-guncellemeleri,sozluk,arama,search-index,engage}.cjs --check` | 5/5 güncel |
| `python tools/shell.py --check` | 0 dosya değişecek |
| `python tools/sync-versions.py --check` | 0 eski sürüm referansı |
| `node tools/build-voltsim.cjs` | 18 sayfa, 0 değişiklik |
| `node tools/build-engineering.cjs` sonrası `git status -- araclar` (ZIP hariç) | 0 fark |
| `node tools/test.cjs` (VG_PHP ile) | **390/390**, 0 atlanan (dbdd1c2) — `.qa/clean-checkout-test.log` |
| `node --test tools/tests/sitemap-consistency.test.cjs` (yeni) | 2/2: her sitemap adresi var olan, dizine açık sayfaya çözülür; dizine açık her içerik sayfası sitemapte |
| Sunucu CI (Docker, Linux, PHP 8.3.36, Node 24.22) @33e37bd | **392/392** — `.qa/ci-33e37bd.log` |

## 4. Adresler ve API'ler — ortama göre

### 4a. Canlı (https://voltguard.com.tr) — yalnız okuma (GET/HEAD) yapıldı

Canlı site `main` dalını yayınlıyor (7f3be03); PR #10/#11 birleştirilmediği için bu daldaki hiçbir yeni özellik canlıda **yok**.

| Adres | Canlı yanıt |
|---|---|
| `/voltsim/`, `/voltsim/pano/`, `/volthaber/`, `/hesaplama/periyodik-kontrol-planlayici/`, `/arama.html` | 404 |
| `/voltsim.html` | 404 (bir denemede bağlantı hatası, tekrarında 404) |
| `/api/volthaber.php`, `/api/metrics.php` | 404 |
| `/api/auth.php?action=me` | 200 `application/json` (mevcut üyelik API'si) |
| CDN | Yanıtlarda `cf-ray`, `x-cache`, `via` yok → önünde CDN görünmüyor |

### 4b. Hazırlık (staging) — Apache 2.4.69 + PHP 8.3.36, Docker, Ubuntu sunucu, ağsız konteyner

`tools/ci/apache-smoke.sh 33e37bd`: commit'in deploy edilen dosyaları (tools/, .git hariç) gerçek `.htaccess` kurallarıyla sunulur; veri klasörü docroot dışında; TLS sonlandırması `X-Forwarded-Proto: https` ile taklit edilir (kanonik HTTPS kuralı gevşetilmedi). Sonuç: **46/46** — `.qa/apache-smoke-33e37bd.log`.

| Kontrol | Sonuç |
|---|---|
| `/voltsim/`, `/voltsim/selektivite/`, `/voltsim/depolama-hibrit/` | 200 `text/html`, içerik doğru |
| `/voltsim` · `/voltsim.html` · `/voltsim/index.html` | 301 → `/voltsim/` |
| `/voltsim/olmayan-modul/` | 404 |
| Hesap araçları temiz adresleri, `.html` → `/…/` | 200 / 301 doğru |
| `/js/search-index.js` | 200 `text/javascript` |
| `/api/lib/*.php`, `/api/*.md`, `/tools/…`, `/.git/config` | 403/404 (erişilemez) |
| `/volthaber`, `/volthaber.html`, `/volthaber/index.php` | 301 → `/volthaber/` |
| `/volthaber/` | 200, PHP ile üretildi, ortak başlık var, `robots` dizine açık |
| `/volthaber/rss.xml`, `/volthaber/sitemap.xml` | 200 XML; sitemapte ≥ 11 yazı |
| Yazı sayfası | 200, `Article` JSON-LD, doğru kanonik adres |
| `GET /api/volthaber.php?action=list` | 200 `application/json`, `ok:true`, 11 öğe, `slug/title/type/category` alanları |
| `GET /api/metrics.php?action=popular` | 200 JSON `ok:true` |
| **Yazma:** ölçüm olayı (`collect`, gerçek beacon biçimi) | 200 `accepted:1`; `/data/metrics/days/2026-10-24.json` dosyasında sayıldı; dosyada IP/UA yok |
| **Yazma:** üye kaydı | 201, kullanıcı oluştu |
| **Yazma:** editör yetkisi (CLI) → taslak → yayın | 201 / 200; yazı sayfası 200, listede ve VoltHaber sitemapinde |
| **Yazma:** bülten aboneliği | 200 JSON — 33e37bd'de bulgu K1 (sonra 8c8cba2'de düzeltildi) |

### 4c. Netlify önizleme (https://deploy-preview-11--voltguard2.netlify.app) — statik, PHP yok

Yayınlanan commit 33e37bd (Netlify durumu: success).

| Adres | Sonuç | Not |
|---|---|---|
| `/voltsim/`, modüller, hesap araçları, `/arama.html`, `/js/search-index.js` | 200 | Statik özellikler çalışır (VoltSim, hesaplar, site içi arama) |
| `/voltsim`, `/voltsim.html` · `/volthaber.html` | 301 → `/voltsim/` · `/volthaber/` | |
| `/volthaber/` | 200 statik yedek sayfa | Haber içeriği **yok**; sayfa voltguard.com.tr'ye yönlendiren mesaj gösterir |
| `/volthaber/rss.xml` ve diğer alt adresler | 301 → voltguard.com.tr | Canlıda henüz yok (404) |
| `/api/*.php` | 404 | **Desteklenmez:** VoltHaber API'si, ölçüm toplama, bülten, editör paneli, büyüme paneli |
| `/hesap/*`, `/topluluk.html`, `/calisan/*` | 301 → voltguard.com.tr | Üyelik ve topluluk Netlify'da çalışmaz |

Netlify'da ölçüm betiği `*.netlify.app` alan adında hiç istek göndermez; bu bir **kapatma**dır, ölçümün çalıştığının kanıtı değildir. Ölçümün çalıştığının kanıtı 4b'dir.

## 5. Önbellek (CDN / tarayıcı / service worker)

| Katman | Davranış (33e37bd) | Risk |
|---|---|---|
| CDN | Canlıda CDN izi yok. Netlify kendi CDN'i: HTML `max-age=0, must-revalidate`. | Düşük |
| HTML | Apache `no-cache`; Netlify `max-age=0` | Düşük |
| css/js `?v=<içerik özeti>` | Apache 1 yıl `immutable` (`VG_VERSIONED`); sürümsüz css/js 600 sn | Düşük: özet içerikle değişir (CRLF/LF bağımsız) |
| `sw.js` | `no-cache`; `VERSION = '2026-10-23.1'`; değişince skipWaiting + clients.claim | — |
| Service worker HTML | ağ-öncelikli, **2,5 sn zaman aşımında önbellekten** | Orta: yavaş bağlantıda ziyaretçi eski sayfayı görebilir (sayfa sonra yenilenir) |
| Service worker css/js/görsel | `?v=` olanlar önbellek-öncelikli; sürümsüzler stale-while-revalidate | Düşük |
| `/api/`, `*.php`, `/hesap/`, `/calisan/` | SW tarafından hiç önbelleğe alınmaz | — |
| **Görseller** (`public/**/*.webp` vb.) | 1 yıl `immutable`, dosya adı **sürümsüz** | **Orta (K2):** aynı adla yeniden üretilen görsel (ör. `public/voltsim/*.webp` kart önizlemeleri) eski ziyaretçide 1 yıl eski kalabilir |

## 6. Bu denetimde yapılan düzeltmeler (33e37bd'de)

1. `/voltsim.html` ve `/volthaber.html` → klasör adreslerine 301 (`.htaccess`, `netlify.toml`); Apache ve Netlify'da doğrulandı.
2. `tools/tests/sitemap-consistency.test.cjs` eklendi (sitemap ↔ dosya tutarlılığı).
3. Arama dizini yeniden üretildi (dbdd1c2; ab29b91 hatasının giderilmesi).
4. Hazırlık testi betikleri `tools/ci/apache-smoke.sh` + `apache-smoke-client.php` yazıldı (commit edilmedi).

## 7. Kalan sorunlar

Güncelleme (24.10.2026): K1, güvenlik oturumunun be42b35 · 4d18c65 · 8c8cba2 commit'leriyle birlikte dala alındı; bu üç commit 33e37bd sonrası olduğundan 1–6. bölümlerdeki sonuçlar onları kapsamaz (temiz kopya test sonucu yalnız K1 satırında).

| # | Sorun | Etki | Durum |
|---|---|---|---|
| K1 | ~~Bülten aboneliği, e-posta aktarımı başarısız olsa da "Onay e-postası gönderildi" yanıtı veriyor~~ | — | **Düzeltildi — 8c8cba2** (güvenlik oturumu). Yanıt artık gönderim vaat etmiyor ("Talebiniz alındı…"); sunucuda `mail()` yoksa 503 `mail_unavailable`. Adres bazlı hata bilinçli olarak verilmez (abone olup olmadığını belli ederdi). Doğrulama (temiz kopya, 8c8cba2): `volthaber-api.test.cjs` 272 kontrol geçti, tüm testler 392/392; yeni test eski kodla başarısız. Açık kalan: `mail()` var ama MTA yoksa yanıt 200 (nötr) — gerçek aktarım denemesi yapılmıyor; Apache hazırlık testi bu commit için yeniden koşulmadı. |
| K2 | `public/` görselleri sürümsüz adla 1 yıl `immutable` | Yeniden üretilen görsel eski ziyaretçide güncellenmez | Düzeltilmedi (görsel adlarını üreten dosyalar başka oturumların alanında) |
| K3 | Ara commit'ler CI'da test edilmiyor (yalnız dal başı) | Bozuk ara commit fark edilmeyebilir | Bilgi |
| K4 | Canlıda hiçbir yeni özellik yok; `.htaccess`'in cPanel/LiteSpeed üzerindeki davranışı yalnız Apache 2.4 konteynerinde denendi | Canlı sunucu LiteSpeed ise kural farkları olabilir | Canlı deploy sonrası aynı duman testi canlıya karşı (yalnız okuma) çalıştırılmalı |
| K5 | E-posta (kayıt onayı, şifre sıfırlama, bülten) hiçbir ortamda gerçek gönderimle denenmedi | — | Canlıda sahibin test aboneliğiyle doğrulanmalı |
| K6 | Koyu/açık tema tamamlanmadı | — | Ajan çalışıyor; birleştirilmedi |
| K7 | Çalışma kopyasında diğer oturumlara ait commit edilmemiş değişiklikler var | Bu rapor onları kapsamaz | Her oturum kendi işini commit edip test etmeli |

## 8. Test türleri hakkında

- WebKit testleri **Playwright WebKit otomasyonudur**, fiziksel Safari değildir.
- 360/390/768 px görünümler **cihaz görünümü taklididir** (viewport + dokunma), gerçek cihaz testi değildir.
- 3D testler Chrome'da **SwiftShader yazılımsal WebGL** ile koşar; gerçek GPU davranışı farklı olabilir.
- Hazırlık testi Docker'daki Apache 2.4'tür; canlı cPanel sunucusu değildir.
