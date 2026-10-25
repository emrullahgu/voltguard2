<?php
/*
 * VoltHaber - sektor haberleri ve teknik analiz platformu: veri, dogrulama, sinirli Markdown, roller, abonelik.
 * PHP 7.4+; Composer yok. Veri yalnizca vg_data_dir()/volthaber/ altinda (docroot DISI) tutulur.
 * Ucuncu taraf iceriginden YALNIZCA baslik, baglanti, tarih ve kaynak adi saklanir; govde/ozet/gorsel alinmaz.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VH_SERVICE = 'vg-volthaber/1';
const VH_MAX_ARTICLES = 3000;
const VH_MAX_BYTES = 16777216;           // articles.json en fazla 16 MiB
const VH_MAX_INGEST_DRAFTS = 500;        // gelen kutusu siniri
const VH_PER_PAGE = 12;
const VH_TITLE_MIN = 10;
const VH_TITLE_MAX = 160;
const VH_SUMMARY_MIN = 40;
const VH_SUMMARY_MAX = 400;
const VH_BODY_MAX = 40000;
const VH_ANALYSIS_BODY_MIN = 300;
const VH_CONSENT_VERSION = 'volthaber-bulten-2026-10-24b';
const VH_CONFIRM_TTL = 172800;           // onay baglantisi 48 saat
const VH_MAX_SUBSCRIBERS = 20000;
const VH_DIGEST_BATCH = 20;              // bir grupta en fazla 20 e-posta
const VH_DIGEST_GAP = 60;                // gruplar arasi en az 60 saniye

/**
 * Kategori kimligi => [ad, kisa aciklama]. Kimlikler adreste kullanilir (/volthaber/kategori/<id>/); yayindaki
 * adresler kirilmasin diye eski kimlikler korunur, yalnizca adlar VoltHaber'in yayin alanlarina gore guncellenir.
 */
function vh_categories(): array
{
    return [
        'mevzuat' => ['Elektrik Mevzuatı', 'Resmî Gazete değişiklikleri, EPDK kurul kararları ve kamu duyurularının özetleri.'],
        'kompanzasyon' => ['Enerji Kalitesi ve Kompanzasyon', 'Reaktif enerji, harmonikler, gerilim olayları ve verimlilik.'],
        'yenilenebilir' => ['GES ve Depolama', 'Güneş, rüzgâr, enerji depolama ve lisanssız üretim.'],
        'e-mobilite' => ['Şarj Altyapısı', 'Elektrikli araç şarj altyapısı ve şarj hizmeti mevzuatı.'],
        'otomasyon' => ['Endüstriyel Otomasyon', 'PLC, SCADA, sürücüler, ölçüm sistemleri ve tesis verisi.'],
        'saha-notlari' => ['VoltGuard Saha Notları', 'VoltGuard ekibinin sahada gördüğü sorunlar ve çözümler.'],
        'tesisat-guvenlik' => ['Elektrik Tesisatı ve İş Güvenliği', 'Periyodik kontrol, topraklama, koruma ve işletme güvenliği.'],
        'enerji-piyasasi' => ['Enerji Piyasası', 'Elektrik piyasası, tarifeler ve piyasa işletmecisi duyuruları.'],
    ];
}

function vh_types(): array
{
    return [
        'analiz' => 'VoltGuard Analizi',
        'resmi' => 'Resmî Duyuru Özeti',
        'kaynak' => 'Kaynak Bağlantısı',
    ];
}

/* VoltGuard hizmetleri, VoltSim ve hesap araclari: ilgili bag onerileri (yalnizca site ici). */
function vh_tool_links(): array
{
    return [
        ['/hizmetler/enerji-kalitesi-olcumu.html', 'Enerji kalitesi ölçümü hizmeti', 'kompanzasyon'],
        ['/hizmetler/harmonik-filtreli-kompanzasyon.html', 'Harmonik filtreli kompanzasyon hizmeti', 'kompanzasyon'],
        ['/voltsim/enerji-kalitesi/', 'VoltSim enerji kalitesi simülasyonu', 'kompanzasyon'],
        ['/voltsim/kompanzasyon/', 'VoltSim kompanzasyon simülasyonu', 'kompanzasyon'],
        ['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama', 'kompanzasyon'],
        ['/hesaplama/kompanzasyon-hesaplama/', 'Kompanzasyon hesaplama', 'kompanzasyon'],
        ['/hizmetler/fabrika-cati-ges.html', 'Fabrika çatı GES hizmeti', 'yenilenebilir'],
        ['/voltsim/ges/', 'VoltSim GES simülasyonu', 'yenilenebilir'],
        ['/voltsim/depolama-hibrit/', 'VoltSim depolama ve hibrit sistem simülasyonu', 'yenilenebilir'],
        ['/voltsim/res/', 'VoltSim RES simülasyonu', 'yenilenebilir'],
        ['/hesaplama/ges-uretim-hesaplama/', 'GES üretim hesaplama', 'yenilenebilir'],
        ['/voltsim/sarj-istasyonu/', 'VoltSim şarj istasyonu simülasyonu', 'e-mobilite'],
        ['/hizmetler/plc-scada-otomasyon.html', 'PLC ve SCADA otomasyon hizmeti', 'otomasyon'],
        ['/voltsim/konveyor-scada/', 'VoltSim konveyör ve SCADA simülasyonu', 'otomasyon'],
        ['/voltsim/motor-otomasyon/', 'VoltSim motor otomasyonu simülasyonu', 'otomasyon'],
        ['/voltsim/pompa-vfd/', 'VoltSim pompa ve sürücü (VFD) simülasyonu', 'otomasyon'],
        ['/voltsim/ariza-tespit/', 'VoltSim arıza tespit laboratuvarı', 'saha-notlari'],
        ['/hizmetler/elektrik-periyodik-kontrol.html', 'Elektrik periyodik kontrol hizmeti', 'tesisat-guvenlik'],
        ['/voltsim/topraklama/', 'VoltSim topraklama simülasyonu', 'tesisat-guvenlik'],
        ['/hesaplama/periyodik-kontrol-planlayici/', 'Periyodik kontrol planlayıcı', 'tesisat-guvenlik'],
        ['/bilgi/mevzuat-guncellemeleri.html', 'Elektrik mevzuatı değişiklikleri 2025–2026', 'mevzuat'],
    ];
}

/* ------------------------------------------------------------------ metin yardimcilari */

/** Turkce harfleri ASCII'ye katlar, kucuk harf yapar (mbstring gerektirmez). */
function vh_fold(string $s): string
{
    $s = strtr($s, [
        'Ç' => 'c', 'ç' => 'c', 'Ğ' => 'g', 'ğ' => 'g', 'İ' => 'i', 'I' => 'i', 'ı' => 'i', 'Ö' => 'o', 'ö' => 'o',
        'Ş' => 's', 'ş' => 's', 'Ü' => 'u', 'ü' => 'u', 'Â' => 'a', 'â' => 'a', 'Î' => 'i', 'î' => 'i', 'Û' => 'u', 'û' => 'u',
        'É' => 'e', 'é' => 'e', 'È' => 'e', 'è' => 'e', 'Ä' => 'a', 'ä' => 'a', 'Ø' => 'o', 'ø' => 'o', 'Å' => 'a', 'å' => 'a',
        '’' => '', "'" => '', 'Ê' => 'e', 'ê' => 'e',
    ]);
    return strtolower($s);
}

function vh_slugify(string $s, int $max = 80): string
{
    $s = (string)preg_replace('/[^a-z0-9]+/', '-', vh_fold($s));
    $s = trim($s, '-');
    if (strlen($s) > $max) {
        $s = rtrim(substr($s, 0, $max), '-');
        $cut = strrpos($s, '-');
        if ($cut !== false && $cut > $max * 0.6) {
            $s = substr($s, 0, $cut);
        }
    }
    return $s;
}

function vh_fold_words(string $s): string
{
    return trim((string)preg_replace('/[^a-z0-9]+/', ' ', vh_fold($s)));
}

function vh_esc(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

/** Tek satir metin: gecersiz UTF-8 veya kontrol karakteri reddedilir (sessizce bozulmaz). */
function vh_line($v, string $field, string $label, int $min, int $max, bool $required = true): string
{
    if ($v === null || $v === '') {
        if ($required && $min > 0) {
            vg_fail(422, 'invalid_field', $label . ' zorunludur.', [$field => $label . ' zorunludur.']);
        }
        return '';
    }
    if (!is_string($v) || preg_match('//u', $v) !== 1 || preg_match('/[\x00-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', $v) === 1) {
        vg_fail(422, 'invalid_field', $label . ' geçersiz karakter içeriyor.', [$field => 'Geçersiz karakter.']);
    }
    $v = trim((string)preg_replace('/\s{2,}/u', ' ', $v));
    $len = vg_strlen($v);
    if (($required || $v !== '') && ($len < $min || $len > $max)) {
        vg_fail(422, 'invalid_field', $label . ' ' . $min . '–' . $max . ' karakter olmalı.', [$field => $min . '–' . $max . ' karakter olmalı.']);
    }
    return $v;
}

function vh_multiline($v, string $field, string $label, int $max): string
{
    if ($v === null || $v === '') {
        return '';
    }
    if (!is_string($v) || preg_match('//u', $v) !== 1 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', $v) === 1) {
        vg_fail(422, 'invalid_field', $label . ' geçersiz karakter içeriyor.', [$field => 'Geçersiz karakter.']);
    }
    $v = trim(str_replace(["\r\n", "\r"], "\n", $v));
    if (vg_strlen($v) > $max) {
        vg_fail(422, 'invalid_field', $label . ' en fazla ' . $max . ' karakter olabilir.', [$field => 'En fazla ' . $max . ' karakter.']);
    }
    return $v;
}

/** Yalnizca https, kimlik bilgisi yok, gecerli alan adi. Gecersizse ''. */
function vh_https_url($v): string
{
    if (!is_string($v) || $v === '' || strlen($v) > 600 || preg_match('/[\x00-\x20\x7F<>"\'`\\\\]/', $v) === 1) {
        return '';
    }
    $p = parse_url($v);
    if (!is_array($p) || strtolower((string)($p['scheme'] ?? '')) !== 'https' || empty($p['host'])
        || isset($p['user']) || isset($p['pass'])) {
        return '';
    }
    $host = strtolower((string)$p['host']);
    if (preg_match('/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $host) !== 1) {
        return '';
    }
    if (isset($p['port']) && (int)$p['port'] !== 443) {
        return '';
    }
    return $v;
}

/** Site ici yol (/voltsim/ges/ gibi). */
function vh_internal_path($v): string
{
    return is_string($v) && strlen($v) <= 200 && preg_match('#^/(?!/)[a-z0-9\-/._]*(\#[a-z0-9\-]+)?$#', $v) === 1
        && strpos($v, '..') === false ? $v : '';
}

/** Ayni haberi yakalamak icin normallestirilmis URL: sema/www/sondaki / / utm_ parametreleri / parca atilir. */
function vh_url_key(string $url): string
{
    $p = parse_url($url);
    if (!is_array($p) || empty($p['host'])) {
        return '';
    }
    $host = (string)preg_replace('/^www\./', '', strtolower((string)$p['host']));
    $path = rtrim((string)($p['path'] ?? ''), '/');
    $query = '';
    if (!empty($p['query'])) {
        parse_str((string)$p['query'], $q);
        foreach (array_keys($q) as $k) {
            if (preg_match('/^(utm_|fbclid|gclid|mc_)/i', (string)$k) === 1) {
                unset($q[$k]);
            }
        }
        ksort($q);
        $query = $q ? '?' . http_build_query($q) : '';
    }
    return $host . $path . $query;
}

/** Iki baslik neredeyse ayni mi (katlanmis kelimelerde duzenleme uzakligi %8'den az). */
function vh_titles_similar(string $a, string $b): bool
{
    $x = vh_fold_words($a);
    $y = vh_fold_words($b);
    if ($x === '' || $y === '') {
        return false;
    }
    if ($x === $y) {
        return true;
    }
    $lx = strlen($x);
    $ly = strlen($y);
    if (abs($lx - $ly) > max(3, (int)(0.1 * max($lx, $ly))) || $lx > 255 || $ly > 255) {
        return false;
    }
    return levenshtein($x, $y) <= max(2, (int)floor(0.08 * max($lx, $ly)));
}

/* ------------------------------------------------------------------ sinirli Markdown */

/*
 * Desteklenen: ## / ### baslik, paragraf, - / * madde, 1. sirali liste, > alinti, **kalin**, *italik*, `kod`,
 * [metin](https://... veya /site-ici). Ham HTML desteklenmez: tum girdi once kacislanir.
 */
function vh_md_inline(string $text): string
{
    $s = vh_esc($text);
    $codes = [];
    $s = (string)preg_replace_callback('/`([^`]{1,200})`/', function ($m) use (&$codes) {
        $codes[] = '<code>' . $m[1] . '</code>';
        return "\x01" . (count($codes) - 1) . "\x01";
    }, $s);
    $links = [];
    $s = (string)preg_replace_callback('/\[([^\]\x01]{1,200})\]\(([^)\s]{1,600})\)/', function ($m) use (&$links) {
        $raw = html_entity_decode($m[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $label = $m[1];
        $internal = vh_internal_path($raw);
        $external = $internal === '' ? vh_https_url($raw) : '';
        if ($internal === '' && $external === '') {
            return $label;
        }
        $attrs = $internal !== '' ? '' : ' target="_blank" rel="noopener noreferrer"';
        $links[] = '<a href="' . vh_esc($internal !== '' ? $internal : $external) . '"' . $attrs . '>' . $label . '</a>';
        return "\x02" . (count($links) - 1) . "\x02";
    }, $s);
    $s = (string)preg_replace('/\*\*(?=\S)(.+?)(?<=\S)\*\*/u', '<strong>$1</strong>', $s);
    $s = (string)preg_replace('/(?<![\*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?![\*\w])/u', '<em>$1</em>', $s);
    $s = (string)preg_replace_callback('/\x02(\d+)\x02/', function ($m) use ($links) {
        return $links[(int)$m[1]] ?? '';
    }, $s);
    // Bag etiketleri icindeki bicimlendirme yukarida uygulanmis olabilir; kod parcalari en son geri konur.
    $s = (string)preg_replace_callback('/\x01(\d+)\x01/', function ($m) use ($codes) {
        return $codes[(int)$m[1]] ?? '';
    }, $s);
    return $s;
}

function vh_markdown(string $src): string
{
    $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $src));
    $out = [];
    $para = [];
    $list = null;      // 'ul' | 'ol'
    $items = [];
    $quote = [];
    $flushPara = function () use (&$para, &$out) {
        if ($para) {
            $out[] = '<p>' . vh_md_inline(implode(' ', $para)) . '</p>';
            $para = [];
        }
    };
    $flushList = function () use (&$list, &$items, &$out) {
        if ($list !== null && $items) {
            $out[] = '<' . $list . ' class="article__list">' . implode('', array_map(function ($i) {
                return '<li>' . vh_md_inline($i) . '</li>';
            }, $items)) . '</' . $list . '>';
        }
        $list = null;
        $items = [];
    };
    $flushQuote = function () use (&$quote, &$out) {
        if ($quote) {
            $out[] = '<blockquote><p>' . vh_md_inline(implode(' ', $quote)) . '</p></blockquote>';
            $quote = [];
        }
    };
    foreach ($lines as $line) {
        $t = trim($line);
        if ($t === '') {
            $flushPara();
            $flushList();
            $flushQuote();
            continue;
        }
        if (preg_match('/^(#{1,3})\s+(.+)$/u', $t, $m) === 1) {
            $flushPara();
            $flushList();
            $flushQuote();
            $tag = strlen($m[1]) === 3 ? 'h3' : 'h2';
            $out[] = '<' . $tag . '>' . vh_md_inline(trim($m[2], " #")) . '</' . $tag . '>';
            continue;
        }
        if (preg_match('/^[-*]\s+(.+)$/u', $t, $m) === 1 || preg_match('/^\d{1,3}[.)]\s+(.+)$/u', $t, $m) === 1) {
            $kind = preg_match('/^\d/', $t) === 1 ? 'ol' : 'ul';
            $flushPara();
            $flushQuote();
            if ($list !== null && $list !== $kind) {
                $flushList();
            }
            $list = $kind;
            $items[] = $m[1];
            continue;
        }
        if (preg_match('/^>\s?(.*)$/u', $t, $m) === 1) {
            $flushPara();
            $flushList();
            $quote[] = $m[1];
            continue;
        }
        if ($list !== null) {
            // Madde devami: bir onceki maddeye eklenir.
            $items[count($items) - 1] .= ' ' . $t;
            continue;
        }
        $flushQuote();
        $para[] = $t;
    }
    $flushPara();
    $flushList();
    $flushQuote();
    return implode("\n", $out);
}

/** Duz metin ozeti (meta aciklama, RSS, e-posta): Markdown isaretleri atilir. */
function vh_plain(string $md, int $max = 300): string
{
    $s = (string)preg_replace('/\[([^\]]*)\]\([^)]*\)/', '$1', $md);
    $s = (string)preg_replace('/[#>*`]+/', '', $s);
    $s = trim((string)preg_replace('/\s+/u', ' ', $s));
    return vg_strlen($s) > $max ? rtrim(vg_substr($s, $max - 1)) . '…' : $s;
}

/* ------------------------------------------------------------------ depolama */

function vh_dir(): string
{
    $base = vg_data_dir();
    $data = realpath($base);
    $root = realpath(vg_doc_root());
    if ($data === false || $root === false) {
        vg_unavailable('volthaber data path cannot be resolved');
    }
    $norm = function (string $p): string {
        return strtolower(rtrim(str_replace('\\', '/', $p), '/'));
    };
    if ($norm((string)$data) === $norm((string)$root) || strpos($norm((string)$data) . '/', $norm((string)$root) . '/') === 0) {
        vg_unavailable('volthaber VG_DATA_DIR must be outside document root');
    }
    $dir = $base . '/volthaber';
    if (!vg_ensure_dir($dir)) {
        vg_unavailable('volthaber directory is not writable');
    }
    vg_protect_dir($dir);
    $resolved = realpath($dir);
    if ($resolved === false || strpos($norm((string)$resolved) . '/', $norm((string)$root) . '/') === 0) {
        vg_unavailable('volthaber directory resolves inside document root');
    }
    @chmod($dir, 0700);
    return $dir;
}

/** Tum VoltHaber yazmalari tek kilitte; okumalar paylasimli kilitte. */
function vh_locked(bool $write, callable $work, string $lockName = 'store')
{
    $dir = vh_dir();
    $file = $dir . '/' . $lockName . '.lock';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('volthaber lock cannot be opened');
    }
    @chmod($file, 0600);
    $deadline = microtime(true) + 8;
    do {
        $locked = flock($fp, ($write ? LOCK_EX : LOCK_SH) | LOCK_NB);
        if (!$locked) {
            usleep(20000);
        }
    } while (!$locked && microtime(true) < $deadline);
    if (!$locked) {
        fclose($fp);
        vg_unavailable('volthaber lock timed out');
    }
    try {
        return $work($dir);
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vh_read(string $dir, string $name, array $empty, int $max): array
{
    $file = $dir . '/' . $name;
    if (!is_file($file)) {
        return $empty;
    }
    $bytes = @filesize($file);
    if ($bytes === false || $bytes > $max) {
        vg_unavailable('volthaber stored file exceeds limits');
    }
    $raw = @file_get_contents($file, false, null, 0, $max + 1);
    $state = is_string($raw) ? json_decode($raw, true, 64) : null;
    if (!is_array($state) || ($state['version'] ?? null) !== 1) {
        vg_unavailable('volthaber stored JSON is invalid (' . $name . ')');
    }
    return $state;
}

/** Atomik yazma: gecici dosya + rename; canli dosya hic kesilmez. Cagiran ozel kilidi tutar. */
function vh_write(string $dir, string $name, array $state, int $max): void
{
    $json = vg_json_encode($state);
    if (strlen($json) > $max) {
        vg_fail(422, 'storage_full', 'VoltHaber depolama sınırına ulaşıldı. Eski taslakları arşivleyin veya silin.');
    }
    $file = $dir . '/' . $name;
    $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $fp = @fopen($tmp, 'x+b');
    if ($fp === false) {
        vg_unavailable('volthaber temporary file cannot be created');
    }
    @chmod($tmp, 0600);
    try {
        $offset = 0;
        while ($offset < strlen($json)) {
            $wrote = fwrite($fp, substr($json, $offset));
            if ($wrote === false || $wrote === 0) {
                vg_unavailable('volthaber write failed');
            }
            $offset += $wrote;
        }
        if (!fflush($fp)) {
            vg_unavailable('volthaber flush failed');
        }
        fclose($fp);
        $fp = null;
        if (!@rename($tmp, $file)) {
            vg_unavailable('volthaber atomic replacement failed');
        }
        @chmod($file, 0600);
    } finally {
        if (is_resource($fp)) {
            fclose($fp);
        }
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
}

/* ------------------------------------------------------------------ makaleler */

function vh_seed_state(): array
{
    $file = __DIR__ . '/volthaber-seed.json';
    $raw = is_file($file) ? @file_get_contents($file) : false;
    $seed = is_string($raw) ? json_decode($raw, true, 64) : null;
    $state = ['version' => 1, 'articles' => []];
    if (!is_array($seed) || !is_array($seed['articles'] ?? null)) {
        return $state;
    }
    foreach ($seed['articles'] as $a) {
        if (!is_array($a) || !is_string($a['slug'] ?? null)) {
            continue;
        }
        $id = 'a' . substr(sha1('seed|' . $a['slug']), 0, 16);
        $a['id'] = $id;
        $a['bodyHtml'] = vh_markdown((string)($a['body'] ?? ''));
        $a['impactHtml'] = vh_markdown((string)($a['impact'] ?? ''));
        $a['commentaryHtml'] = vh_markdown((string)($a['commentary'] ?? ''));
        $state['articles'][$id] = vh_normalize_article($a);
    }
    return $state;
}

/** Saklanan kaydi beklenen alanlara indirger (eksik alanlar varsayilanla doldurulur). */
function vh_normalize_article(array $a): array
{
    $int = function ($v) {
        return is_int($v) ? $v : null;
    };
    $srcRow = function (array $s): array {
        return [
            'name' => (string)($s['name'] ?? ''),
            'url' => (string)($s['url'] ?? ''),
            'publishedAt' => (string)($s['publishedAt'] ?? ''),
            'licenseNote' => (string)($s['licenseNote'] ?? ''),
        ];
    };
    $status = in_array($a['status'] ?? '', ['draft', 'scheduled', 'published', 'archived'], true) ? $a['status'] : 'draft';
    return [
        'id' => (string)$a['id'],
        'slug' => (string)($a['slug'] ?? ''),
        'title' => (string)($a['title'] ?? ''),
        'summary' => (string)($a['summary'] ?? ''),
        'summaryBy' => is_string($a['summaryBy'] ?? null) ? $a['summaryBy'] : null,
        'body' => (string)($a['body'] ?? ''),
        'bodyHtml' => (string)($a['bodyHtml'] ?? ''),
        'impact' => (string)($a['impact'] ?? ''),
        'impactHtml' => (string)($a['impactHtml'] ?? ''),
        'commentary' => (string)($a['commentary'] ?? ''),
        'commentaryHtml' => (string)($a['commentaryHtml'] ?? ''),
        'category' => (string)($a['category'] ?? 'mevzuat'),
        'tags' => array_values(array_filter(is_array($a['tags'] ?? null) ? $a['tags'] : [], 'is_string')),
        'type' => (string)($a['type'] ?? 'kaynak'),
        'source' => is_array($a['source'] ?? null) ? $srcRow($a['source']) : null,
        'extraSources' => array_values(array_map($srcRow, array_filter(is_array($a['extraSources'] ?? null) ? $a['extraSources'] : [], 'is_array'))),
        'eventDate' => is_string($a['eventDate'] ?? null) ? $a['eventDate'] : '',
        'image' => is_array($a['image'] ?? null) ? [
            'url' => (string)($a['image']['url'] ?? ''),
            'credit' => (string)($a['image']['credit'] ?? ''),
            'rightsNote' => (string)($a['image']['rightsNote'] ?? ''),
            'licenseUrl' => (string)($a['image']['licenseUrl'] ?? ''),
        ] : null,
        'status' => $status,
        'publishAt' => $int($a['publishAt'] ?? null),
        'publishedAt' => $int($a['publishedAt'] ?? null),
        // Icerik guncelleme zamani yalnizca onayli bir duzeltmeyle degisir (tarama, sayac, durum degisikligi degistirmez).
        'revisedAt' => $int($a['revisedAt'] ?? null),
        'revisionNote' => (string)($a['revisionNote'] ?? ''),
        'review' => vh_normalize_review(is_array($a['review'] ?? null) ? $a['review'] : [], $status),
        'liveCopy' => is_array($a['liveCopy'] ?? null) ? $a['liveCopy'] : null,
        'author' => is_array($a['author'] ?? null) ? ['id' => $a['author']['id'] ?? null, 'name' => (string)($a['author']['name'] ?? '')] : ['id' => null, 'name' => 'VoltGuard Mühendislik Ekibi'],
        'editor' => is_array($a['editor'] ?? null) ? ['id' => $a['editor']['id'] ?? null, 'name' => (string)($a['editor']['name'] ?? '')] : null,
        'seo' => ['title' => (string)($a['seo']['title'] ?? ''), 'description' => (string)($a['seo']['description'] ?? '')],
        'related' => array_values(array_filter(is_array($a['related'] ?? null) ? $a['related'] : [], function ($r) {
            return is_array($r) && is_string($r['url'] ?? null) && is_string($r['label'] ?? null);
        })),
        'featured' => !empty($a['featured']),
        'pick' => !empty($a['pick']),
        'origin' => in_array($a['origin'] ?? '', ['editor', 'ingest', 'seed'], true) ? $a['origin'] : 'editor',
        'ingest' => is_array($a['ingest'] ?? null) ? $a['ingest'] : null,
        'flags' => array_values(array_filter(is_array($a['flags'] ?? null) ? $a['flags'] : [], 'is_string')),
        'createdAt' => is_int($a['createdAt'] ?? null) ? $a['createdAt'] : vg_now(),
        'updatedAt' => is_int($a['updatedAt'] ?? null) ? $a['updatedAt'] : vg_now(),
    ];
}

/** Makale durumu; dosya yoksa tohum icerigi (ilk yazmada kalici olur). */
function vh_articles(string $dir): array
{
    if (!is_file($dir . '/articles.json')) {
        return vh_seed_state();
    }
    $state = vh_read($dir, 'articles.json', ['version' => 1, 'articles' => []], VH_MAX_BYTES);
    if (!is_array($state['articles'] ?? null) || count($state['articles']) > VH_MAX_ARTICLES + 50) {
        vg_unavailable('volthaber article schema is invalid');
    }
    foreach ($state['articles'] as $id => $a) {
        if (!is_string($id) || preg_match('/^a[a-f0-9]{16}$/', $id) !== 1 || !is_array($a) || ($a['id'] ?? '') !== $id) {
            vg_unavailable('volthaber stored article is invalid');
        }
        // Akistan once kaydedilmis kayitlar yeni alanlarla (yayin akisi, etki/yorum bolumleri) tamamlanir.
        $state['articles'][$id] = vh_normalize_article($a);
    }
    // Tohuma sonradan eklenen kayitlar (yayin akisini bekleyen hazir taslak gibi) mevcut kuruluma da eklenir.
    // Tohum kimlikleri sabittir: arsivlenen veya duzenlenen kayit yeniden yazilmaz.
    foreach (vh_seed_state()['articles'] as $id => $a) {
        if (!isset($state['articles'][$id]) && vh_find_slug($state, $a['slug']) === null) {
            $state['articles'][$id] = $a;
        }
    }
    return $state;
}

function vh_save_articles(string $dir, array $state): void
{
    vh_write($dir, 'articles.json', $state, VH_MAX_BYTES);
}

function vh_is_live(array $a, int $now): bool
{
    if ($a['status'] === 'published') {
        return (int)($a['publishedAt'] ?? 0) <= $now;
    }
    if ($a['status'] === 'scheduled') {
        return is_int($a['publishAt']) && $a['publishAt'] <= $now;
    }
    return false;
}

function vh_live_at(array $a): int
{
    return (int)($a['status'] === 'scheduled' ? $a['publishAt'] : ($a['publishedAt'] ?? $a['createdAt']));
}

/** Zamani gelmis planli yazilari "published" durumuna gecirir. Ozel kilit altinda cagrilir. */
function vh_materialize_schedule(array &$state, int $now): int
{
    $n = 0;
    foreach ($state['articles'] as $id => $a) {
        if ($a['status'] === 'scheduled' && is_int($a['publishAt']) && $a['publishAt'] <= $now) {
            $state['articles'][$id]['status'] = 'published';
            $state['articles'][$id]['publishedAt'] = $a['publishAt'];
            $n++;
        }
    }
    return $n;
}

function vh_views(string $dir): array
{
    $state = vh_read($dir, 'views.json', ['version' => 1, 'views' => []], 4194304);
    return is_array($state['views'] ?? null) ? $state['views'] : [];
}

/** Toplam okunma sayaci (kisi bazli kayit yok). */
function vh_count_view(string $articleId): void
{
    if (preg_match('/^a[a-f0-9]{16}$/', $articleId) !== 1) {
        return;
    }
    // Ayni istemci (IPv6'da /48) ayni haberi 30 dakikada bir kez sayar: "en cok okunanlar" listesi
    // tekrarlanan isteklerle yonlendirilemesin ve her istek sayac dosyasini yeniden yazmasin.
    // Tekillestirme kuralidir, kotu kullanim esigi degil: VG_RATE_SCALE ile olceklenmez.
    $seen = false;
    vg_rl_update('vh_view', vg_rl_ip_key(48) . '|' . $articleId, function (array $st, int $now) use (&$seen) {
        $at = (int)($st['at'] ?? 0);
        if ($at > $now - 1800) {
            $seen = true;
            return $st;
        }
        return ['at' => $now];
    });
    if ($seen) {
        return;
    }
    vh_locked(true, function (string $dir) use ($articleId) {
        $state = vh_read($dir, 'views.json', ['version' => 1, 'views' => []], 4194304);
        $views = is_array($state['views'] ?? null) ? $state['views'] : [];
        $views[$articleId] = (int)($views[$articleId] ?? 0) + 1;
        vh_write($dir, 'views.json', ['version' => 1, 'views' => $views], 4194304);
    }, 'views');
}

function vh_public_article(array $a, array $views, bool $full): array
{
    $cats = vh_categories();
    $out = [
        'id' => $a['id'],
        'slug' => $a['slug'],
        'url' => '/volthaber/' . $a['slug'] . '/',
        'title' => $a['title'],
        'summary' => $a['summary'],
        'category' => $a['category'],
        'categoryName' => $cats[$a['category']][0] ?? $a['category'],
        'tags' => $a['tags'],
        'type' => $a['type'],
        'typeName' => vh_types()[$a['type']] ?? $a['type'],
        'source' => $a['source'] && $a['source']['url'] !== '' ? $a['source'] : null,
        'image' => $a['image'],
        'eventDate' => $a['eventDate'] !== '' ? $a['eventDate'] : null,
        'publishedAt' => vg_iso(vh_live_at($a)),
        // Yalnizca onayli bir icerik duzeltmesinde degisir; tarama, sayac veya durum degisikligi tarih degistirmez.
        'revisedAt' => $a['revisedAt'] ? vg_iso($a['revisedAt']) : null,
        'author' => $a['author']['name'],
        'editor' => $a['editor'] ? $a['editor']['name'] : '',
        'review' => vh_public_review($a),
        'views' => (int)($views[$a['id']] ?? 0),
    ];
    if ($full) {
        $out['bodyHtml'] = $a['bodyHtml'];
        $out['impactHtml'] = $a['impactHtml'];
        $out['commentaryHtml'] = $a['commentaryHtml'];
        $out['sources'] = vh_all_sources($a);
        $out['revisionNote'] = $a['revisionNote'];
        $out['seo'] = $a['seo'];
        $out['related'] = $a['related'];
    }
    return $out;
}

/** Yayindaki yazilar (bekleyen duzeltmesi olanlar son onayli surumleriyle), yeniden eskiye. */
function vh_live_list(array $state, int $now): array
{
    $list = array_map('vh_live_view', array_values(array_filter($state['articles'], function ($a) use ($now) {
        return vh_is_live($a, $now);
    })));
    usort($list, function ($x, $y) {
        return vh_live_at($y) <=> vh_live_at($x) ?: strcmp($x['id'], $y['id']);
    });
    return $list;
}

function vh_matches(array $a, array $filter): bool
{
    if (($filter['category'] ?? '') !== '' && $a['category'] !== $filter['category']) {
        return false;
    }
    if (($filter['type'] ?? '') !== '' && $a['type'] !== $filter['type']) {
        return false;
    }
    if (($filter['tag'] ?? '') !== '' && !in_array($filter['tag'], $a['tags'], true)) {
        return false;
    }
    if (($filter['q'] ?? '') !== '') {
        $hay = vh_fold_words($a['title'] . ' ' . $a['summary'] . ' ' . implode(' ', $a['tags']) . ' ' . ($a['source']['name'] ?? ''));
        foreach (explode(' ', vh_fold_words($filter['q'])) as $term) {
            if ($term !== '' && strpos($hay, $term) === false) {
                return false;
            }
        }
    }
    return true;
}

function vh_query_filter(array $src): array
{
    $f = ['category' => '', 'type' => '', 'tag' => '', 'q' => '', 'page' => 1];
    $cat = $src['category'] ?? '';
    if (is_string($cat) && $cat !== '') {
        if (!isset(vh_categories()[$cat])) {
            vg_fail(422, 'invalid_category', 'Kategori bulunamadı.');
        }
        $f['category'] = $cat;
    }
    $type = $src['type'] ?? '';
    if (is_string($type) && $type !== '') {
        if (!isset(vh_types()[$type])) {
            vg_fail(422, 'invalid_type', 'İçerik türü geçersiz.');
        }
        $f['type'] = $type;
    }
    $tag = $src['tag'] ?? '';
    if (is_string($tag) && $tag !== '') {
        if (preg_match('/^[a-z0-9-]{2,40}$/', $tag) !== 1) {
            vg_fail(422, 'invalid_tag', 'Etiket geçersiz.');
        }
        $f['tag'] = $tag;
    }
    $q = $src['q'] ?? '';
    if (is_string($q) && $q !== '') {
        if (preg_match('//u', $q) !== 1 || strlen($q) > 240) {
            vg_fail(422, 'invalid_query', 'Arama ifadesi geçersiz.');
        }
        $f['q'] = trim(vg_substr($q, 80));
    }
    $page = $src['page'] ?? '1';
    if (!is_string($page) || preg_match('/^[1-9][0-9]{0,2}$/', $page) !== 1) {
        vg_fail(422, 'invalid_page', 'Sayfa numarası geçersiz.');
    }
    $f['page'] = (int)$page;
    return $f;
}

/** Sayfalanmis sonuc. */
function vh_page(array $list, int $page, int $per = VH_PER_PAGE): array
{
    $total = count($list);
    $pages = max(1, (int)ceil($total / $per));
    return ['items' => array_slice($list, ($page - 1) * $per, $per), 'page' => $page, 'pages' => $pages, 'total' => $total];
}

function vh_most_read(array $live, array $views, int $limit): array
{
    $list = array_values(array_filter($live, function ($a) use ($views) {
        return (int)($views[$a['id']] ?? 0) > 0;
    }));
    usort($list, function ($x, $y) use ($views) {
        return (int)($views[$y['id']] ?? 0) <=> (int)($views[$x['id']] ?? 0) ?: vh_live_at($y) <=> vh_live_at($x);
    });
    return array_slice($list, 0, $limit);
}

function vh_find_slug(array $state, string $slug): ?array
{
    foreach ($state['articles'] as $a) {
        if ($a['slug'] === $slug) {
            return $a;
        }
    }
    return null;
}

/** Ilgili yazilar: ayni kategori ve ortak etiket puani. */
function vh_related(array $live, array $article, int $limit = 4): array
{
    $scored = [];
    foreach ($live as $a) {
        if ($a['id'] === $article['id']) {
            continue;
        }
        $score = ($a['category'] === $article['category'] ? 2 : 0) + count(array_intersect($a['tags'], $article['tags'])) * 3;
        if ($score > 0) {
            $scored[] = [$score, vh_live_at($a), $a];
        }
    }
    usort($scored, function ($x, $y) {
        return $y[0] <=> $x[0] ?: $y[1] <=> $x[1];
    });
    return array_map(function ($s) {
        return $s[2];
    }, array_slice($scored, 0, $limit));
}

/* ------------------------------------------------------------------ editorler (roller) */

function vh_user_id_valid($v): bool
{
    return is_string($v) && preg_match('/^u[a-f0-9]{24}$/', $v) === 1;
}

function vh_editors(string $dir): array
{
    $state = vh_read($dir, 'editors.json', ['version' => 1, 'editors' => []], 65536);
    if (!is_array($state['editors'] ?? null) || count($state['editors']) > 50) {
        vg_unavailable('volthaber editor configuration is invalid');
    }
    foreach ($state['editors'] as $id) {
        if (!vh_user_id_valid($id)) {
            vg_unavailable('volthaber editor identifier is invalid');
        }
    }
    return array_values(array_unique($state['editors']));
}

function vh_is_editor(?array $user): bool
{
    if ($user === null) {
        return false;
    }
    return (bool)vh_locked(false, function (string $dir) use ($user) {
        return in_array($user['id'], vh_editors($dir), true);
    });
}

/* ------------------------------------------------------------------ yayin gunlugu */

function vh_log(string $dir, string $file, array $entry, int $keep): void
{
    $state = vh_read($dir, $file, ['version' => 1, 'entries' => []], 2097152);
    $entries = is_array($state['entries'] ?? null) ? $state['entries'] : [];
    array_unshift($entries, $entry);
    vh_write($dir, $file, ['version' => 1, 'entries' => array_slice($entries, 0, $keep)], 2097152);
}

function vh_log_entries(string $dir, string $file, int $limit): array
{
    $state = vh_read($dir, $file, ['version' => 1, 'entries' => []], 2097152);
    return array_slice(is_array($state['entries'] ?? null) ? $state['entries'] : [], 0, $limit);
}

/* ------------------------------------------------------------------ dogrulama ve kayit */

const VH_RESERVED_SLUGS = ['kategori', 'etiket', 'sitemap', 'rss', 'ara', 'arama', 'yayin-ilkeleri', 'abonelik', 'index', 'api', 'sayfa'];

/**
 * Editor girdisini dogrular ve mevcut kayitla birlestirir. $existing null ise yeni kayit.
 * Dondurur: [makale, uyarilar]. Yineleme (ayni kaynak URL) 409; benzer baslik 409 (confirmSimilar ile isaretlenerek kabul).
 */
function vh_build_article(array $body, ?array $existing, array $state, array $user): array
{
    $allowed = ['id', 'title', 'slug', 'summary', 'body', 'impact', 'commentary', 'eventDate', 'extraSources', 'revisionNote', 'category', 'tags', 'type',
        'source', 'image', 'seo', 'related', 'featured', 'pick', 'confirmSimilar', 'updatedAt'];
    foreach (array_keys($body) as $k) {
        if (!in_array($k, $allowed, true)) {
            vg_fail(400, 'invalid_request', 'Gönderilen alanlardan biri desteklenmiyor: ' . vh_esc((string)$k));
        }
    }
    $a = $existing ?? [
        'id' => 'a' . bin2hex(random_bytes(8)), 'status' => 'draft', 'publishAt' => null, 'publishedAt' => null,
        'author' => ['id' => $user['id'], 'name' => $user['name']], 'editor' => null, 'origin' => 'editor', 'ingest' => null,
        'flags' => [], 'createdAt' => vg_now(), 'summaryBy' => null, 'featured' => false, 'pick' => false,
    ];
    if ($existing !== null && isset($body['updatedAt']) && $body['updatedAt'] !== vg_iso($existing['updatedAt'])) {
        vg_fail(409, 'conflict', 'Bu yazı siz düzenlerken başka bir editör tarafından değiştirildi. Sayfayı yenileyin.');
    }
    $a['title'] = vh_line($body['title'] ?? ($existing['title'] ?? null), 'title', 'Başlık', VH_TITLE_MIN, VH_TITLE_MAX);
    if (array_key_exists('summary', $body)) {
        $summary = vh_multiline($body['summary'], 'summary', 'Özet', VH_SUMMARY_MAX);
        $summary = trim((string)preg_replace('/\s+/u', ' ', $summary));
        if ($summary !== ($existing['summary'] ?? '')) {
            $a['summaryBy'] = $summary === '' ? null : $user['id'];
        }
        $a['summary'] = $summary;
    } else {
        $a['summary'] = $existing['summary'] ?? '';
    }
    if (array_key_exists('body', $body)) {
        $a['body'] = vh_multiline($body['body'], 'body', 'Metin', VH_BODY_MAX);
    } else {
        $a['body'] = $existing['body'] ?? '';
    }
    $a['bodyHtml'] = vh_markdown($a['body']);
    // "Fabrikalar ve isletmeler icin anlami" ve "VoltGuard yorumu": kaynak bilgisinden ayri tutulan bolumler.
    foreach (['impact' => 'İşletmeler için anlamı', 'commentary' => 'VoltGuard yorumu'] as $k => $label) {
        $a[$k] = array_key_exists($k, $body) ? vh_multiline($body[$k], $k, $label, 6000) : ($existing[$k] ?? '');
        $a[$k . 'Html'] = vh_markdown($a[$k]);
    }
    $ev = array_key_exists('eventDate', $body) ? $body['eventDate'] : ($existing['eventDate'] ?? '');
    if ($ev !== '' && $ev !== null && (!is_string($ev) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $ev, $em) !== 1 || !checkdate((int)$em[2], (int)$em[3], (int)$em[1]))) {
        vg_fail(422, 'invalid_field', 'Olay tarihi YYYY-AA-GG biçiminde geçerli bir tarih olmalı.', ['eventDate' => 'YYYY-AA-GG']);
    }
    $a['eventDate'] = (string)$ev;
    $a['revisionNote'] = array_key_exists('revisionNote', $body)
        ? vh_line($body['revisionNote'], 'revisionNote', 'Güncelleme notu', 0, 300, false) : ($existing['revisionNote'] ?? '');
    $cat = $body['category'] ?? ($existing['category'] ?? '');
    if (!is_string($cat) || !isset(vh_categories()[$cat])) {
        vg_fail(422, 'invalid_field', 'Kategori seçin.', ['category' => 'Geçerli bir kategori seçin.']);
    }
    $a['category'] = $cat;
    $type = $body['type'] ?? ($existing['type'] ?? '');
    if (!is_string($type) || !isset(vh_types()[$type])) {
        vg_fail(422, 'invalid_field', 'İçerik türü seçin.', ['type' => 'analiz, resmi veya kaynak olmalı.']);
    }
    $a['type'] = $type;
    // Etiketler
    $tags = $body['tags'] ?? ($existing['tags'] ?? []);
    if (!is_array($tags) || count($tags) > 8) {
        vg_fail(422, 'invalid_field', 'En fazla 8 etiket eklenebilir.', ['tags' => 'En fazla 8 etiket.']);
    }
    $clean = [];
    foreach ($tags as $t) {
        $slug = is_string($t) && preg_match('//u', $t) === 1 && strlen($t) <= 120 ? vh_slugify($t, 40) : '';
        if (strlen($slug) < 2) {
            vg_fail(422, 'invalid_field', 'Etiketler 2–40 karakter olmalı.', ['tags' => 'Geçersiz etiket.']);
        }
        if (!in_array($slug, $clean, true)) {
            $clean[] = $slug;
        }
    }
    $a['tags'] = $clean;
    // Kaynak
    $src = array_key_exists('source', $body) ? $body['source'] : ($existing['source'] ?? null);
    $a['source'] = $src !== null ? vh_clean_source_row($src, 'source') : null;
    $extra = array_key_exists('extraSources', $body) ? $body['extraSources'] : ($existing['extraSources'] ?? []);
    if (!is_array($extra) || count($extra) > 6) {
        vg_fail(422, 'invalid_field', 'En fazla 6 ek kaynak eklenebilir.', ['extraSources' => 'En fazla 6.']);
    }
    $a['extraSources'] = [];
    foreach (array_values($extra) as $i => $row) {
        $row = vh_clean_source_row($row, 'extraSources.' . $i);
        if ($row !== null) {
            if ($row['url'] === '') {
                vg_fail(422, 'invalid_field', 'Ek kaynaklarda https bağlantısı zorunludur.', ['extraSources' => 'Bağlantı eksik.']);
            }
            $a['extraSources'][] = $row;
        }
    }
    // Gorsel: yalnizca kendi/lisansli; hak notu zorunlu.
    $img = array_key_exists('image', $body) ? $body['image'] : ($existing['image'] ?? null);
    if ($img !== null && $img !== [] && !(is_array($img) && ($img['url'] ?? '') === '')) {
        if (!is_array($img)) {
            vg_fail(422, 'invalid_field', 'Görsel bilgisi geçersiz.', ['image' => 'Geçersiz.']);
        }
        foreach (array_keys($img) as $k) {
            if (!in_array($k, ['url', 'credit', 'rightsNote', 'licenseUrl'], true)) {
                vg_fail(400, 'invalid_request', 'Görsel alanlarından biri desteklenmiyor.');
            }
        }
        $iu = (string)($img['url'] ?? '');
        $own = preg_match('#^/(public|assets)/[a-z0-9\-/._]+\.(webp|jpe?g|png|avif)$#i', $iu) === 1 && strpos($iu, '..') === false;
        if (!$own && vh_https_url($iu) === '') {
            vg_fail(422, 'invalid_field', 'Görsel adresi /public/ altında kendi dosyamız veya https adresi olmalı.', ['image.url' => 'Geçersiz görsel adresi.']);
        }
        $lic = (string)($img['licenseUrl'] ?? '');
        if ($lic !== '' && vh_https_url($lic) === '') {
            vg_fail(422, 'invalid_field', 'Lisans kaydı adresi https olmalı.', ['image.licenseUrl' => 'Yalnızca https.']);
        }
        $img = [
            'url' => $iu,
            'credit' => vh_line($img['credit'] ?? '', 'image.credit', 'Görsel künyesi', 2, 160),
            'rightsNote' => vh_line($img['rightsNote'] ?? '', 'image.rightsNote', 'Görsel kullanım hakkı kaydı', 10, 400),
            'licenseUrl' => $lic,
        ];
    } else {
        $img = null;
    }
    $a['image'] = $img;
    // SEO
    $seo = $body['seo'] ?? ($existing['seo'] ?? []);
    if (!is_array($seo)) {
        vg_fail(422, 'invalid_field', 'SEO alanları geçersiz.');
    }
    $a['seo'] = [
        'title' => vh_line($seo['title'] ?? '', 'seo.title', 'SEO başlığı', 0, 70, false),
        'description' => vh_line($seo['description'] ?? '', 'seo.description', 'SEO açıklaması', 0, 170, false),
    ];
    // Ilgili arac/simulasyon baglari
    $rel = $body['related'] ?? ($existing['related'] ?? []);
    if (!is_array($rel) || count($rel) > 6) {
        vg_fail(422, 'invalid_field', 'En fazla 6 ilgili bağlantı eklenebilir.', ['related' => 'En fazla 6.']);
    }
    $a['related'] = [];
    foreach ($rel as $r) {
        if (!is_array($r) || vh_internal_path($r['url'] ?? '') === '') {
            vg_fail(422, 'invalid_field', 'İlgili bağlantılar site içi yol olmalı (ör. /voltsim/ges/).', ['related' => 'Site içi yol.']);
        }
        $a['related'][] = ['url' => $r['url'], 'label' => vh_line($r['label'] ?? '', 'related.label', 'Bağlantı adı', 2, 80)];
    }
    $a['featured'] = array_key_exists('featured', $body) ? $body['featured'] === true : !empty($existing['featured']);
    $a['pick'] = array_key_exists('pick', $body) ? $body['pick'] === true : !empty($existing['pick']);
    // Slug
    $slugIn = $body['slug'] ?? '';
    if ($slugIn !== '' && $slugIn !== null) {
        if (!is_string($slugIn) || preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $slugIn) !== 1 || strlen($slugIn) < 3 || strlen($slugIn) > 90) {
            vg_fail(422, 'invalid_field', 'Adres (slug) küçük harf, rakam ve tire içermeli (3–90).', ['slug' => 'Geçersiz adres.']);
        }
        $slug = $slugIn;
    } elseif ($existing !== null && $existing['slug'] !== '') {
        $slug = $existing['slug'];
    } else {
        $slug = vh_slugify($a['title']);
        if (strlen($slug) < 3) {
            $slug = 'haber-' . substr($a['id'], 1, 6);
        }
    }
    if (in_array($slug, VH_RESERVED_SLUGS, true)) {
        vg_fail(422, 'invalid_field', 'Bu adres ayrılmıştır.', ['slug' => 'Ayrılmış adres.']);
    }
    $base = $slug;
    $n = 2;
    while (true) {
        $clash = vh_find_slug($state, $slug);
        if ($clash === null || $clash['id'] === $a['id']) {
            break;
        }
        if ($slugIn !== '' && $slugIn !== null) {
            vg_fail(409, 'slug_taken', 'Bu adres başka bir yazıda kullanılıyor.', ['slug' => 'Kullanımda.']);
        }
        $slug = substr($base, 0, 84) . '-' . $n++;
    }
    // Yayindaki yazinin adresi degisirse eski baglantilar kirilir.
    if ($existing !== null && $existing['slug'] !== $slug && in_array($existing['status'], ['published', 'scheduled'], true)) {
        vg_fail(409, 'slug_locked', 'Yayındaki yazının adresi değiştirilemez.', ['slug' => 'Yayındaki yazı.']);
    }
    $a['slug'] = $slug;
    // Yineleme denetimi
    // Yalnizca yeni kayitta veya baslik/kaynak degistiginde denetlenir (onaylanmis benzerlik sonraki duzenlemeleri engellemez).
    $titleChanged = $existing === null || vh_fold_words($existing['title']) !== vh_fold_words($a['title']);
    $oldUrl = $existing !== null && $existing['source'] ? (string)$existing['source']['url'] : '';
    $flags = $titleChanged ? array_values(array_diff($a['flags'] ?? [], ['similar_title'])) : ($a['flags'] ?? []);
    $urlKey = $a['source'] && $a['source']['url'] !== '' ? vh_url_key($a['source']['url']) : '';
    if ($existing !== null && $urlKey !== '' && $oldUrl !== '' && vh_url_key($oldUrl) === $urlKey) {
        $urlKey = '';
    }
    foreach ($state['articles'] as $other) {
        if ($other['id'] === $a['id'] || $other['status'] === 'archived') {
            continue;
        }
        if (!$titleChanged && $urlKey === '') {
            break;
        }
        if ($urlKey !== '' && $other['source'] && $other['source']['url'] !== '' && vh_url_key($other['source']['url']) === $urlKey) {
            vg_fail(409, 'duplicate_source', 'Bu kaynak adresi zaten başka bir kayıtta var: "' . $other['title'] . '".', ['source.url' => 'Yinelenen kaynak.'], [], ['duplicateOf' => $other['id']]);
        }
        if ($titleChanged && vh_titles_similar($other['title'], $a['title'])) {
            if (($body['confirmSimilar'] ?? false) !== true) {
                vg_fail(409, 'duplicate_title', 'Neredeyse aynı başlıklı bir kayıt var: "' . $other['title'] . '". Yine de kaydetmek için onaylayın.', ['title' => 'Benzer başlık.'], [], ['duplicateOf' => $other['id']]);
            }
            $flags[] = 'similar_title';
        }
    }
    $a['flags'] = array_values(array_unique($flags));
    $a['updatedAt'] = vg_now();
    $a = vh_normalize_article($a);
    vh_after_content_save($a, $existing, $user);
    return $a;
}

/** Yayin kurallari. Hata varsa 422 ve alan listesi. */
/** Tek kaynak satiri (birincil veya ek kaynak). Bos satir null doner. */
function vh_clean_source_row($src, string $field): ?array
{
    if (!is_array($src)) {
        vg_fail(422, 'invalid_field', 'Kaynak bilgisi geçersiz.', [$field => 'Geçersiz.']);
    }
    foreach (array_keys($src) as $k) {
        if (!in_array($k, ['name', 'url', 'publishedAt', 'licenseNote'], true)) {
            vg_fail(400, 'invalid_request', 'Kaynak alanlarından biri desteklenmiyor.');
        }
    }
    $url = (string)($src['url'] ?? '');
    if ($url !== '' && vh_https_url($url) === '') {
        vg_fail(422, 'invalid_field', 'Kaynak adresi https:// ile başlayan geçerli bir adres olmalı.', [$field . '.url' => 'Yalnızca https adresleri kabul edilir.']);
    }
    $date = (string)($src['publishedAt'] ?? '');
    if ($date !== '' && preg_match('/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$/', $date) !== 1) {
        vg_fail(422, 'invalid_field', 'Kaynak tarihi YYYY-AA-GG biçiminde olmalı.', [$field . '.publishedAt' => 'YYYY-AA-GG']);
    }
    $row = [
        'name' => vh_line($src['name'] ?? '', $field . '.name', 'Kaynak adı', 2, 120, $url !== ''),
        'url' => $url,
        'publishedAt' => $date,
        'licenseNote' => vh_line($src['licenseNote'] ?? '', $field . '.licenseNote', 'Kullanım notu', 0, 300, false),
    ];
    return $row['name'] === '' && $row['url'] === '' ? null : $row;
}

require_once __DIR__ . '/volthaber-review.php';

/* ------------------------------------------------------------------ abonelik */

function vh_subscribers(string $dir): array
{
    $state = vh_read($dir, 'subscribers.json', ['version' => 1, 'subscribers' => [], 'rates' => []], 16777216);
    if (!is_array($state['subscribers'] ?? null) || !is_array($state['rates'] ?? null)) {
        vg_unavailable('volthaber subscriber schema is invalid');
    }
    return $state;
}

function vh_email_hash(string $email): string
{
    return hash_hmac('sha256', 'vh-email|' . $email, vg_secret());
}

function vh_ip_hash(): string
{
    return substr(hash_hmac('sha256', 'vh-ip|' . vg_rl_ip_key(), vg_secret()), 0, 32);
}

/** Abonelikten cikis jetonu: saklanmaz, abone kimliginden HMAC ile turetilir. */
function vh_unsub_token(string $subId): string
{
    return $subId . '.' . substr(hash_hmac('sha256', 'vh-unsub|' . $subId, vg_secret()), 0, 32);
}

function vh_unsub_link(string $subId): string
{
    return vg_site_url() . '/volthaber/abonelik.html#iptal=' . vh_unsub_token($subId);
}

function vh_mail_footer(string $subId): string
{
    return "\n\n--\nVoltHaber · VoltGuard Mühendislik, Ege Teknopark, İzmir\n"
        . "Bu e-postayı VoltHaber bültenine açık rızanızla abone olduğunuz için aldınız.\n"
        . "Abonelikten tek tıkla çıkın: " . vh_unsub_link($subId) . "\n"
        . "Kişisel verilerin işlenmesi: " . vg_site_url() . "/gizlilik.html\n";
}

function vh_mail_confirm(string $email, string $subId, string $token): bool
{
    $link = vg_site_url() . '/volthaber/abonelik.html#onay=' . $token;
    $body = "Merhaba,\n\nVoltHaber e-posta bültenine abone olmak için bu adres kullanıldı. Aboneliği onaylamak için 48 saat içinde aşağıdaki bağlantıyı açın:\n\n"
        . $link . "\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; onaylanmayan kayıt 48 saat sonra geçersiz olur ve size başka e-posta gönderilmez."
        . vh_mail_footer($subId);
    return vg_mail_send($email, 'VoltHaber aboneliğinizi onaylayın', $body, 'volthaber-confirm');
}

/* Teslim vaat etmez: e-posta yanittan sonra gonderilir; tasiyici reddederse yalnizca error_log kaydi olur. */
const VH_SUBSCRIBE_MESSAGE = 'Talebiniz alındı. Aboneliğiniz, e-posta adresinize gönderilecek onay bağlantısını açtığınızda başlar. Onay e-postası birkaç dakika içinde gelmezse istenmeyen e-posta klasörünü kontrol edin veya info@voltguard.com.tr adresine yazın.';

function vh_subscribe(array $body): array
{
    foreach (array_keys($body) as $k) {
        if (!in_array($k, ['email', 'consent', 'website', 'source'], true)) {
            vg_fail(400, 'invalid_request', 'Gönderilen alanlardan biri desteklenmiyor.');
        }
    }
    // Bal tuzagi: botlara basarili gibi gorunur, hicbir sey kaydedilmez.
    if (isset($body['website']) && $body['website'] !== '') {
        return ['ok' => true, 'service' => VH_SERVICE, 'pending' => true, 'message' => VH_SUBSCRIBE_MESSAGE];
    }
    if (($body['consent'] ?? null) !== true) {
        vg_fail(422, 'consent_required', 'Bülten için açık rıza kutusunu işaretlemeniz gerekir.', ['consent' => 'Zorunlu.']);
    }
    $email = vg_normalize_email($body['email'] ?? '');
    if ($email === '' || strlen($email) > 254) {
        vg_fail(422, 'invalid_email', 'Geçerli bir e-posta adresi yazın.', ['email' => 'Geçersiz e-posta.']);
    }
    // Genel e-posta yetenegi kayittan once denetlenir (sifre sifirlama ile ayni); adres bazinda teslim sonucu
    // bildirilmez, yoksa yanit adresin zaten abone olup olmadigini belli eder.
    if (!vg_mail_can_send()) {
        vg_fail(503, 'mail_unavailable', 'Bülten onay e-postası şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin veya info@voltguard.com.tr adresinden destek alın.');
    }
    // IPv6'da /48 blogu (kayit ve topluluk ile ayni): tek musteri blogundan cok sayida adresle kayit doldurulamasin.
    $retry = vg_rl_hit('vh_subscribe_ip', vg_rl_ip_key(48), 5, 3600);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    $now = vg_now();
    $send = null;
    vh_locked(true, function (string $dir) use ($email, $now, &$send) {
        $state = vh_subscribers($dir);
        $purged = vh_purge_expired_pending($state, $now);
        $eh = vh_email_hash($email);
        // E-posta basina gunde 3 onay e-postasi (sessiz: hesap tespiti yok).
        foreach ($state['rates'] as $k => $r) {
            if (!is_array($r) || (int)($r['until'] ?? 0) <= $now) {
                unset($state['rates'][$k]);
            }
        }
        $rk = substr($eh, 0, 40);
        $hits = array_values(array_filter((array)($state['rates'][$rk]['hits'] ?? []), function ($t) use ($now) {
            return is_int($t) && $t > $now - 86400;
        }));
        $found = null;
        foreach ($state['subscribers'] as $id => $s) {
            if (($s['emailHash'] ?? '') === $eh) {
                $found = $id;
                break;
            }
        }
        if (($found !== null && $state['subscribers'][$found]['status'] === 'active') || count($hits) >= 3) {
            // zaten abone / gunluk sinir: ayni genel yanit; suresi dolan bekleyen kayitlarin silinmesi yine yazilir
            if ($purged) {
                vh_write($dir, 'subscribers.json', $state, 16777216);
            }
            return;
        }
        if ($found === null && count($state['subscribers']) >= VH_MAX_SUBSCRIBERS) {
            vg_fail(503, 'unavailable', 'Bülten şu anda yeni abone kabul etmiyor.');
        }
        $token = vg_b64url(random_bytes(24));
        $id = $found ?? ('s' . bin2hex(random_bytes(10)));
        $state['subscribers'][$id] = [
            'id' => $id, 'email' => $email, 'emailHash' => $eh, 'status' => 'pending',
            'consentAt' => $now, 'consentVersion' => VH_CONSENT_VERSION, 'ipHash' => vh_ip_hash(),
            'createdAt' => $found !== null ? (int)($state['subscribers'][$found]['createdAt'] ?? $now) : $now,
            'confirmedAt' => null, 'unsubscribedAt' => null,
            'confirmHash' => hash('sha256', $token), 'confirmExpires' => $now + VH_CONFIRM_TTL,
        ];
        $hits[] = $now;
        $state['rates'][$rk] = ['hits' => $hits, 'until' => $now + 86400];
        vh_write($dir, 'subscribers.json', $state, 16777216);
        $send = [$email, $id, $token];
    });
    if ($send !== null) {
        // Yanittan sonra gonderilir: yanit suresi adresin zaten abone olup olmadigini belli etmesin.
        $job = function () use ($send) {
            if (!vh_mail_confirm($send[0], $send[1], $send[2])) {
                error_log('VoltHaber: confirmation mail not accepted by transport');
            }
        };
        if (vg_can_finish_early()) {
            vg_after_response($job);
        } else {
            $job();
        }
    }
    return ['ok' => true, 'service' => VH_SERVICE, 'pending' => true, 'message' => VH_SUBSCRIBE_MESSAGE];
}

/**
 * Onaylanmadan suresi dolan bekleyen kayitlari tamamen siler (aydinlatma metni: "48 saat sonra gecersiz olur").
 * Rizasi dogrulanmamis e-posta adresi saklanmaz ve bu kayitlar abone sinirini dolduramaz. Degisiklik varsa true.
 */
function vh_purge_expired_pending(array &$state, int $now): bool
{
    $purged = false;
    foreach ($state['subscribers'] as $id => $s) {
        if (is_array($s) && ($s['status'] ?? '') === 'pending' && (int)($s['confirmExpires'] ?? 0) < $now) {
            unset($state['subscribers'][$id]);
            $purged = true;
        }
    }
    return $purged;
}

function vh_confirm(array $body): array
{
    $retry = vg_rl_hit('vh_token_ip', vg_rl_ip_key(), 30, 3600);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    $token = $body['token'] ?? '';
    if (!is_string($token) || preg_match('/^[A-Za-z0-9_-]{32}$/', $token) !== 1 || count($body) !== 1) {
        vg_fail(422, 'invalid_token', 'Onay bağlantısı geçersiz.');
    }
    $hash = hash('sha256', $token);
    $now = vg_now();
    return vh_locked(true, function (string $dir) use ($hash, $now) {
        $state = vh_subscribers($dir);
        foreach ($state['subscribers'] as $id => $s) {
            if (($s['confirmHash'] ?? '') !== '' && hash_equals((string)$s['confirmHash'], $hash)) {
                if ((int)($s['confirmExpires'] ?? 0) < $now) {
                    vh_purge_expired_pending($state, $now);
                    vh_write($dir, 'subscribers.json', $state, 16777216);
                    vg_fail(410, 'token_expired', 'Onay bağlantısının süresi dolmuş. Lütfen yeniden abone olun.');
                }
                $state['subscribers'][$id]['status'] = 'active';
                $state['subscribers'][$id]['confirmedAt'] = $now;
                $state['subscribers'][$id]['confirmHash'] = '';
                $state['subscribers'][$id]['confirmExpires'] = 0;
                vh_write($dir, 'subscribers.json', $state, 16777216);
                return ['ok' => true, 'service' => VH_SERVICE, 'confirmed' => true];
            }
        }
        vg_fail(404, 'invalid_token', 'Onay bağlantısı geçersiz veya daha önce kullanılmış.');
        return [];
    });
}

function vh_unsubscribe(array $body): array
{
    $retry = vg_rl_hit('vh_token_ip', vg_rl_ip_key(), 30, 3600);
    if ($retry > 0) {
        vg_too_many($retry);
    }
    $token = $body['token'] ?? '';
    if (!is_string($token) || preg_match('/^(s[a-f0-9]{20})\.([a-f0-9]{32})$/', $token, $m) !== 1 || count($body) !== 1
        || !hash_equals(vh_unsub_token($m[1]), $token)) {
        vg_fail(422, 'invalid_token', 'Abonelikten çıkış bağlantısı geçersiz.');
    }
    $id = $m[1];
    $now = vg_now();
    return vh_locked(true, function (string $dir) use ($id, $now) {
        $state = vh_subscribers($dir);
        if (isset($state['subscribers'][$id])) {
            // KVKK: e-posta adresi silinir; yalnizca rizanin geri alindigini gosteren ozet kayit kalir.
            $s = $state['subscribers'][$id];
            $state['subscribers'][$id] = [
                'id' => $id, 'email' => '', 'emailHash' => $s['emailHash'] ?? '', 'status' => 'unsubscribed',
                'consentAt' => $s['consentAt'] ?? null, 'consentVersion' => $s['consentVersion'] ?? '',
                'ipHash' => '', 'createdAt' => $s['createdAt'] ?? null, 'confirmedAt' => $s['confirmedAt'] ?? null,
                'unsubscribedAt' => $now, 'confirmHash' => '', 'confirmExpires' => 0,
            ];
            vh_write($dir, 'subscribers.json', $state, 16777216);
        }
        return ['ok' => true, 'service' => VH_SERVICE, 'unsubscribed' => true];
    });
}

function vh_subscriber_stats(array $state): array
{
    $c = ['active' => 0, 'pending' => 0, 'unsubscribed' => 0];
    foreach ($state['subscribers'] as $s) {
        $st = (string)($s['status'] ?? '');
        if (isset($c[$st])) {
            $c[$st]++;
        }
    }
    return $c;
}

function vh_csv_cell(string $v): string
{
    // CSV/formul enjeksiyonuna karsi: = + - @ ile baslayan hucreler metin olarak isaretlenir.
    if ($v !== '' && strpos('=+-@' . "\t\r", $v[0]) !== false) {
        $v = "'" . $v;
    }
    return '"' . str_replace('"', '""', $v) . '"';
}
