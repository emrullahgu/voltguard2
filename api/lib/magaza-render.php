<?php
/*
 * VoltGuard Magaza sunucu tarafi sayfa uretimi (magaza/index.php). Sablon: magaza/index.html (tools/shell.py ile ortak
 * baslik/alt bilgi senkron tutulur); sablondaki <!--vgm:meta--> ve <!--vgm:main--> bolgeleri burada uretilen HTML ile
 * degistirilir. Katalog parcali okunur (api/MAGAZA.md): urun sayfasi iki dosya, kategori sayfasi kendi liste dosyalari, arama
 * arama.json; hicbir sayfa tum urun parcalarini yuklemez. Fiyatlar istek aninda yalnizca sayfadaki urunler icin
 * vgm_price() ile hesaplanir; musteriye YALNIZCA KDV dahil TL gosterilir (USD, maliyet,
 * marj ve tedarikci bilgisi sayfaya hic girmez). Tum degiskenler vgmr_esc ile kacislanir; JSON-LD json_encode HEX
 * bayraklariyla uretilir. Bu dosya mb_* kullanmaz (mbstring olmayan sunucularda da calisir).
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VGMR_SITE = 'https://voltguard.com.tr';
const VGMR_TITLE_SUFFIX = 'VoltGuard Mağaza';
const VGMR_CONTACT = '/iletisim.html#iletisim';
const VGMR_NOTE_RATE = 'Fiyatlar her gün TCMB döviz kuruyla güncellenir';
const VGMR_CLOSED = 'Mağazamız çok yakında siparişe açılıyor';
const VGMR_LIST_LIMIT = 400;
const VGMR_PAGE_SIZE = 48;               // kategori sayfasinda urun
const VGMR_SORT_LIVE_MAX = 3000;         // fiyat siralamasi bu kart sayisina kadar gorunen TL ile (vgmr_sort_cards)
const VGMR_SORT_CACHE_TTL = 900;          // fiyat siralamasi TL haritasi onbellegi zaman dilimi, sn (vgmr_sort_tl_map)
/** Telefonda (dar ekran) secili suzgec yokken teknik ozellik panelini ilk boyamadan once kapatan satir ici betik (vgmr_facets_html). */
const VGMR_FACETS_NARROW_JS = '<script>(function(d){if(d&&window.matchMedia&&matchMedia("(max-width: 47.99rem)").matches&&!d.querySelector("input:checked"))d.removeAttribute("open")})(document.currentScript&&document.currentScript.previousElementSibling)</script>';
const VGMR_LIST_SHOW_MAX = VGM_LIST_SHOW_MAX;   // api/lib/magaza.php vgm_price_display
const VGMR_LAST_SHOW_MAX = VGM_LAST_SHOW_MAX;
/** Sunucuda firma.json'dan doldurulan hukuki sayfalar (vgmr_render_legal_html; .htaccess ile ayni liste). */
const VGMR_LEGAL_PAGES = ['on-bilgilendirme-formu', 'mesafeli-satis-sozlesmesi', 'iade-ve-cayma', 'kvkk-aydinlatma', 'odeme-ve-teslimat'];
const VGMR_SITEMAP_LIMIT = 10000;        // site haritasi parcasinda en cok adres
const VGMR_SORTS = ['onerilen' => 'Önerilen sıra', 'fiyat-artan' => 'Fiyat (artan)', 'fiyat-azalan' => 'Fiyat (azalan)', 'ad' => 'Ada göre (A–Z)'];
/** Satis birimi: [adet etiketi, fiyat eki, kisa ad]. Katalog "unit" alani (tools/magaza/katalog-ortak.cjs UNITS). */
const VGMR_UNITS = ['adet' => ['Adet', '', 'adet'], 'metre' => ['Metre', '/ m', 'm'], 'paket' => ['Paket', '/ paket', 'paket'], 'takım' => ['Takım', '/ takım', 'takım'],
    'kutu' => ['Kutu', '/ kutu', 'kutu'], 'rulo' => ['Rulo', '/ rulo', 'rulo'], 'kg' => ['Kilogram', '/ kg', 'kg'], 'set' => ['Set', '/ set', 'set']];
const VGMR_NOTE_VAT = 'Fiyatlar Türk lirası ve KDV dahildir; listelenen fiyatlar bağlayıcı teklif değildir, sipariş anında TL olarak sabitlenir.';

/* ------------------------------------------------------------------ yardimcilar */

function vgmr_esc(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

function vgmr_str($v): string
{
    return is_string($v) ? $v : '';
}

/** UTF-8 guvenli kisaltma (mbstring gerektirmez). */
function vgmr_clip(string $s, int $max): string
{
    $s = trim((string)preg_replace('/\s+/u', ' ', $s));
    if (preg_match('/^.{0,' . $max . '}/su', $s, $m) === 1) {
        $cut = $m[0];
        if ($cut !== $s) {
            $cut = rtrim($cut, " ,.;:-") . '…';
        }
        return $cut;
    }
    return '';
}

/** Arama icin Turkce harfleri ASCII'ye indirger (vgm_fold; katalog yazicisi ve js/magaza.js ile ayni eslesme). */
function vgmr_fold(string $s): string
{
    return vgm_fold($s);
}

function vgmr_ld(array $data): string
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS
        | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE);
    return '  <script type="application/ld+json">' . ($json === false ? '{}' : $json) . "</script>\n";
}

function vgmr_template(): string
{
    $file = dirname(__DIR__, 2) . '/magaza/index.html';
    $tpl = @file_get_contents($file);
    if (!is_string($tpl) || strpos($tpl, '<!--vgm:meta-->') === false || strpos($tpl, '<!--vgm:main-->') === false) {
        throw new RuntimeException('magaza template missing');
    }
    return $tpl;
}

/** Sablondaki bolgeleri degistirir. */
function vgmr_page_html(string $meta, string $main): string
{
    $tpl = vgmr_template();
    $tpl = (string)preg_replace_callback('#<!--vgm:meta-->.*?<!--/vgm:meta-->#s', function () use ($meta) {
        return "<!--vgm:meta-->\n" . $meta . "  <!--/vgm:meta-->";
    }, $tpl, 1);
    $tpl = (string)preg_replace_callback('#<!--vgm:main-->.*?<!--/vgm:main-->#s', function () use ($main) {
        return "<!--vgm:main-->\n" . $main . "\n  <!--/vgm:main-->";
    }, $tpl, 1);
    return $tpl;
}

function vgmr_meta(array $m): string
{
    $title = (string)$m['title'];
    $desc = (string)$m['desc'];
    $url = (string)$m['url'];
    $robots = (string)($m['robots'] ?? 'index, follow, max-image-preview:large, max-snippet:-1');
    $img = (string)($m['image'] ?? VGMR_SITE . '/public/og-image.png');
    $out = '  <title>' . vgmr_esc($title) . "</title>\n"
        . '  <meta name="description" content="' . vgmr_esc($desc) . "\">\n"
        . '  <meta name="robots" content="' . vgmr_esc($robots) . "\">\n"
        . '  <link rel="canonical" href="' . vgmr_esc($url) . "\">\n"
        . '  <meta property="og:type" content="' . vgmr_esc((string)($m['type'] ?? 'website')) . "\">\n"
        . '  <meta property="og:title" content="' . vgmr_esc($title) . "\">\n"
        . '  <meta property="og:description" content="' . vgmr_esc($desc) . "\">\n"
        . '  <meta property="og:url" content="' . vgmr_esc($url) . "\">\n"
        . '  <meta property="og:image" content="' . vgmr_esc($img) . "\">\n"
        . "  <meta property=\"og:site_name\" content=\"VoltGuard\">\n  <meta property=\"og:locale\" content=\"tr_TR\">\n"
        . "  <meta name=\"twitter:card\" content=\"summary_large_image\">\n";
    foreach ($m['links'] ?? [] as $link) {
        $out .= '  <link rel="' . vgmr_esc((string)$link[0]) . '" href="' . vgmr_esc((string)$link[1]) . "\">\n";
    }
    if (isset($m['price']) && is_string($m['price'])) {
        $out .= '  <meta property="product:price:amount" content="' . vgmr_esc($m['price']) . "\">\n"
            . "  <meta property=\"product:price:currency\" content=\"TRY\">\n";
    }
    foreach ($m['ld'] ?? [] as $ld) {
        $out .= vgmr_ld($ld);
    }
    return $out;
}

/** $items: [[ad, yol-veya-null], ...] — son ogenin yolu yok sayilir (gecerli sayfa). */
function vgmr_breadcrumb_ld(array $items): array
{
    $list = [];
    foreach ($items as $i => $it) {
        $list[] = ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $it[0], 'item' => VGMR_SITE . $it[1]];
    }
    return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $list];
}

function vgmr_breadcrumb_html(array $items): string
{
    $parts = [];
    $last = count($items) - 1;
    foreach ($items as $i => $it) {
        $parts[] = $i === $last
            ? '<li><span aria-current="page">' . vgmr_esc($it[0]) . '</span></li>'
            : '<li><a href="' . vgmr_esc($it[1]) . '">' . vgmr_esc($it[0]) . '</a></li>';
    }
    return '<nav class="vgm-crumb" aria-label="Sayfa yolu"><ol>' . implode('', $parts) . '</ol></nav>';
}

/* ------------------------------------------------------------------ durum ve fiyat */

/**
 * Istek anindaki yapilandirma ve kur (paylasimli kilit altinda tek okuma). Fiyat kayitlari yalnizca sayfadaki urunler
 * icin, gerektiginde parca parca okunur (vgmr_price).
 */
function vgmr_context(int $now): array
{
    list($config, $rate, $dir) = vgm_locked(false, function (string $dir): array {
        return [vgm_config($dir), vgm_rate_state($dir), $dir];
    });
    return ['now' => $now, 'config' => $config, 'rate' => $rate, 'open' => vgm_shop_open($config), 'dir' => $dir];
}

/** Urunun (ya da liste kartinin) fiyati: yalnizca o urunun fiyat parcasi okunur (istek boyunca parca onbellegi). */
function vgmr_price(array $p, array $ctx): array
{
    static $shards = [];
    $id = (string)$p['id'];
    $key = $ctx['dir'] . '|' . vgm_shard_of($id);
    if (!array_key_exists($key, $shards)) {
        $shards[$key] = vgm_read_map($ctx['dir'], 'fiyat/' . vgm_shard_of($id) . '.json');
    }
    $s = $shards[$key][$id] ?? null;
    $price = vgm_price($p, is_array($s) ? $s : null, $ctx['rate'], $ctx['config'], $ctx['open'], $ctx['now']);
    $price['display'] = vgmr_price_display($price, $ctx['now']);
    $price['now'] = $ctx['now'];
    return $price;
}

/** Satis birimi bilgisi: [key, etiket, fiyat eki, kisa ad]. */
function vgmr_unit(array $p): array
{
    $key = is_string($p['unit'] ?? null) && isset(VGMR_UNITS[$p['unit']]) ? $p['unit'] : 'adet';
    return array_merge([$key], VGMR_UNITS[$key]);
}

/**
 * Adet kurallari (P1-09; katalog alanlari minQty, step, packQty — tools/magaza/katalog-derle.cjs semasi): en az, adim, paket
 * ve en cok. Alan yoksa 1 / 1 / 0 / maxQty; tutarsiz degerler maxQty'ye sigdirilir.
 */
function vgmr_qty_rules(array $p): array
{
    $max = max(1, (int)($p['maxQty'] ?? 1));
    $min = is_int($p['minQty'] ?? null) && $p['minQty'] >= 1 ? min($p['minQty'], $max) : 1;
    $step = is_int($p['step'] ?? null) && $p['step'] >= 1 ? min($p['step'], $max) : 1;
    $pack = is_int($p['packQty'] ?? null) && $p['packQty'] >= 1 ? $p['packQty'] : 0;
    if ($min % $step !== 0) {
        $min = (int)ceil($min / $step) * $step;
        if ($min > $max) {
            $min = $max;
        }
    }
    return ['min' => $min, 'step' => $step, 'pack' => $pack, 'max' => $max];
}

/** Tahmini kargoya verilis suresi (gun): urun, yoksa kategori varsayilani, yoksa 0 (= en gec 30 gun). */
function vgmr_delivery_days(array $p): int
{
    return vgm_delivery_days($p) ?? 0;
}

/** Gun araligi etiketi: 1 -> "1", 2..3 -> "1–N", 4+ -> "N" (P1-10; "1–1 gün" yazilmaz). */
function vgmr_days_label(int $days): string
{
    return $days === 1 ? '1' : ($days <= 3 ? '1–' . $days : (string)$days);
}

/**
 * Durum rozeti: [css, etiket] ya da null (rozet basilmaz). Stok ve termin ayri okunur (P1-10); magaza genel olarak kapaliyken
 * ("closed") her kartta ayni rozeti tekrarlamak yerine band yeterlidir.
 */
function vgmr_chip(array $price, array $p = []): ?array
{
    if (in_array(vgmr_display_of($price), ['list', 'last'], true)) {
        return null;   // fiyatin altindaki gri etiket ("Liste fiyati – sipariste teyit edilir") durumu zaten soyler
    }
    switch ($price['reason']) {
        case 'ok':
            $days = $p ? vgmr_delivery_days($p) : 0;
            return ['ok', $days > 0 ? 'Stokta · ' . vgmr_days_label($days) . ' gün' : 'Stokta'];
        case 'closed':
            return null;
        case 'freight':
            return ['quote', 'Nakliye dahil teklif'];
        case 'unavailable':
            return ['off', 'Tedarikte yok'];
        case 'stale':
            return ['wait', 'Fiyat teyidi bekleniyor'];
        case 'held':
            return ['wait', 'Fiyat kontrol ediliyor'];
        case 'error':
            return ['wait', 'Fiyat doğrulanamadı'];
        case 'no_rate':
            return ['wait', 'Kur güncelleniyor'];
        default:
            return ['quote', 'Teklif ile satılır'];
    }
}

/** schema.org stok durumu; belirsizse null (alan yazilmaz). */
function vgmr_availability(array $price): ?string
{
    if ($price['orderable']) {
        return 'https://schema.org/InStock';
    }
    if ($price['reason'] === 'unavailable') {
        return 'https://schema.org/OutOfStock';
    }
    if ($price['reason'] === 'closed') {
        return 'https://schema.org/PreOrder';
    }
    return null;
}

/** Fiyat dogrulanmis (guncel) fiyat olarak gosterilebilir mi: eskimis, bekletilen, hatali veya kursuz fiyat bu sayilmaz. */
function vgmr_price_visible(array $price): bool
{
    return $price['tryGross'] !== null && in_array($price['reason'], ['ok', 'closed', 'freight', 'unavailable'], true);
}

/**
 * Fiyat GOSTERIMI siparisten ayridir (P1-08): siparis 48 saat kuralina bagli kalir (vgm_price "orderable" degismez), ama
 * binlerce urunun her birini 48 saatte bir canli dogrulamak gercekci olmadigindan gosterimde iki ek durum vardir:
 *  - "list": katalogun liste fiyati (basis=list), listCheckedAt en cok VGMR_LIST_SHOW_MAX once; gri "Liste fiyatı –
 *    siparişte teyit edilir" etiketiyle.
 *  - "last": son canli dogrulanan fiyat 48 saati gecmis (stale) ama en cok VGMR_LAST_SHOW_MAX once; gri "Son doğrulanan
 *    tedarik fiyatı (bugünkü kurla)" etiketiyle (TL tutari bugunku kur/marjla yeniden hesaplanir; o gun dogrulanan TL degildir).
 * Bekletilen (held), hatali (error) ya da kursuz fiyat bu yollarla gosterilmez; yapilandirilmis veride (JSON-LD Offer)
 * yalnizca "verified" fiyat yer alir.
 * Donus: verified | list | last | null (fiyat yok: "teklif isteyin").
 */
function vgmr_price_display(array $price, ?int $now = null): ?string
{
    return vgm_price_display($price, $now ?? (is_int($price['now'] ?? null) ? $price['now'] : time()));
}

/** Gosterim durumu (vgmr_price sonucunda hazir; dogrudan vgm_price sonucu icin burada hesaplanir). */
function vgmr_display_of(array $price): ?string
{
    return array_key_exists('display', $price) ? $price['display'] : vgmr_price_display($price);
}

/** Goreli tazelik: "bugün", "dün", "3 gün önce" (Istanbul takvim gunu). */
function vgmr_ago(int $ts, int $now): string
{
    $days = (int)round((strtotime(vgm_local($now, 'Y-m-d') . 'T00:00:00Z') - strtotime(vgm_local($ts, 'Y-m-d') . 'T00:00:00Z')) / 86400);
    return $days <= 0 ? 'bugün' : ($days === 1 ? 'dün' : $days . ' gün önce');
}

/** Liste / son dogrulanan fiyat etiketi ve tazeligi: [etiket, tazelik metni]. */
function vgmr_display_label(array $price): array
{
    $ago = vgmr_ago((int)$price['checkedAt'], is_int($price['now'] ?? null) ? $price['now'] : time());
    return vgmr_display_of($price) === 'list'
        ? ['Liste fiyatı – siparişte teyit edilir', $ago . ' güncellendi']
        : ['Son doğrulanan tedarik fiyatı (bugünkü kurla)', $ago . ' doğrulandı'];
}

/**
 * Fiyat gosterimi: yalnizca TL ve KDV dahil. $full: kontrol zamani ve kur notu da yazilir (urun sayfasi); kartta "KDV dahil"
 * tekrar edilmez, liste ustunde bir kez yazilir (vgmr_grid_note). $p: satis birimi icin urun/kart ("₺/m" gibi; P1-09).
 * Liste ve son dogrulanan fiyat (P1-08) gri etiket ve goreli tazelikle yazilir; siparis/sepete ekleme bundan etkilenmez.
 */
function vgmr_price_html(array $price, bool $full, array $p = []): string
{
    $display = vgmr_display_of($price);
    if ($display === null) {
        return '<p class="vgm-price vgm-price--none"><span class="vgm-price__ask">Güncel fiyat için teklif isteyin</span></p>';
    }
    $vat = (int)$price['vat'];
    $unit = vgmr_unit($p);
    $soft = $display !== 'verified';
    $now = is_int($price['now'] ?? null) ? $price['now'] : time();
    $h = '<p class="vgm-price' . ($soft ? ' vgm-price--soft' : '') . '"><span class="vgm-price__amount">' . vgmr_esc(vgm_fmt_try((float)$price['tryGross']))
        . ($unit[2] !== '' ? ' <span class="vgm-price__unit">' . vgmr_esc($unit[2]) . '</span>' : '') . '</span>'
        . ($full ? ' <span class="vgm-price__vat">KDV dahil (%' . $vat . ')' . ($unit[2] !== '' ? ', ' . vgmr_esc($unit[3]) . ' başına' : '') . '</span>' : '') . '</p>';
    if ($soft) {
        list($label, $fresh) = vgmr_display_label($price);
        $h .= '<p class="vgm-price__basis" data-vgm-basis="' . $display . '">' . vgmr_esc($label) . ' · <time datetime="' . vgmr_esc(vg_iso((int)$price['checkedAt'])) . '">'
            . vgmr_esc($fresh) . '</time></p>';
    }
    if ($full) {
        if ($soft) {
            $h .= '<p class="vgm-price__meta">' . ($display === 'list'
                ? 'Bu fiyat bilgi amaçlıdır; sipariş, tedarik fiyatı son 48 saat içinde doğrulandığında açılır.'
                : 'Tedarik fiyatının son doğrulaması 48 saati geçti; TL tutarı bugünkü kurla hesaplanmıştır. Sipariş için fiyatın yeniden doğrulanması gerekir.') . '</p>';
        } elseif ($price['checkedAt'] !== null) {
            $h .= '<p class="vgm-price__meta">Fiyat güncelleme tarihi: <time datetime="' . vgmr_esc(vg_iso((int)$price['checkedAt'])) . '">'
                . vgmr_esc(vgm_local((int)$price['checkedAt'])) . '</time> (' . vgmr_esc(vgmr_ago((int)$price['checkedAt'], $now)) . ')</p>';
        }
        $h .= '<p class="vgm-price__note">' . vgmr_esc(VGMR_NOTE_RATE) . '.</p>';
    }
    return $h;
}

/* ------------------------------------------------------------------ katalog yardimcilari */

/** Marka filtresi icin adres parcasi (ASCII, tireli). */
function vgmr_slug(string $s): string
{
    return trim((string)preg_replace('/[^a-z0-9]+/', '-', vgm_fold($s)), '-');
}

/** Gorsel adresi: depodaki /public/ ya da medya deposu /magaza-gorsel/ (yalnizca .webp). */
function vgmr_img_path($v): string
{
    if (!is_string($v) || strpos($v, '..') !== false) {
        return '';
    }
    if (preg_match('#^/public/[A-Za-z0-9_./-]{1,200}$#D', $v) === 1
        || preg_match('#^/magaza-gorsel/[0-9a-f]{2}/[a-z0-9-]{3,90}\.[0-9a-f]{8}(?:-t)?\.webp$#D', $v) === 1) {
        return $v;
    }
    return '';
}

function vgmr_dim($v): int
{
    return is_int($v) && $v >= 1 && $v <= 8000 ? $v : 0;
}

/** Gecerli gorseller: [src, thumb, w, h, alt]. */
function vgmr_images(array $p): array
{
    $out = [];
    foreach (is_array($p['images'] ?? null) ? $p['images'] : [] as $im) {
        $src = is_array($im) ? vgmr_img_path($im['src'] ?? null) : '';
        if ($src === '') {
            continue;
        }
        $thumb = vgmr_img_path($im['thumb'] ?? null);
        $alt = trim(vgmr_str($im['alt'] ?? ''));
        $out[] = ['src' => $src, 'thumb' => $thumb !== '' ? $thumb : $src, 'w' => vgmr_dim($im['w'] ?? null), 'h' => vgmr_dim($im['h'] ?? null),
            'alt' => $alt !== '' ? $alt : (string)$p['name']];
    }
    return $out;
}

function vgmr_img_tag(array $im, bool $thumb, string $extra = ''): string
{
    $dims = ($im['w'] > 0 && $im['h'] > 0) ? ' width="' . $im['w'] . '" height="' . $im['h'] . '"' : '';
    return '<img src="' . vgmr_esc($thumb ? $im['thumb'] : $im['src']) . '" alt="' . vgmr_esc($thumb ? '' : $im['alt']) . '"' . $dims . $extra . '>';
}

/** Liste kartinin kucuk gorseli (kart: thumb alani; tam kayit: ilk gorsel). */
function vgmr_card_image(array $p): string
{
    $images = vgmr_images($p);
    if ($images) {
        return vgmr_img_tag($images[0], true, ' loading="lazy" decoding="async"');
    }
    $thumb = vgmr_img_path($p['thumb'] ?? null);
    if ($thumb !== '') {
        return '<img src="' . vgmr_esc($thumb) . '" alt="" width="400" height="400" loading="lazy" decoding="async">';
    }
    return vgmr_placeholder();
}

function vgmr_placeholder(): string
{
    return '<span class="vgm-ph" aria-hidden="true"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" '
        . 'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M13 2L5 14h6l-1 8 9-12h-6z"/></svg></span>';
}

function vgmr_cat_icon(string $id): string
{
    $paths = [
        'gunes-panelleri' => '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
        'inverterler' => '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6.5 12c1.5-3 3-3 4.5 0s3 3 4.5 0"/>',
        'enerji-depolama' => '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3M10.5 9.5l-2 3h3l-2 3"/>',
        'ges-montaj-ve-kablolama' => '<path d="M4 18l2.5-11h13L17 18z"/><path d="M5.25 12.5h13.25M11 7l-.7 11M15.5 7l-.3 11"/>',
        'sarj-istasyonlari' => '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
        'koruma-cihazlari' => '<path d="M12 3l8 3v6c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
        'kompanzasyon' => '<path d="M3 12h7M14 12h7M10 6v12M14 6v12"/>',
        'olcu-ve-test' => '<path d="M4 17a8 8 0 1 1 16 0zM12 17l4-5"/>',
        'pano-malzemeleri' => '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
        'kablolar' => '<path d="M3 7h4c4 0 3 10 7 10h7M3 5v4M21 15v4"/>',
        'aydinlatma' => '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z"/>',
        'topraklama-ve-yildirim' => '<path d="M13 2L5 14h6l-1 8 9-12h-6z"/>',
    ];
    $inner = $paths[$id] ?? '<path d="M13 2L5 14h6l-1 8 9-12h-6z"/>';
    return '<svg class="vgm-ico" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" '
        . 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' . $inner . '</svg>';
}

function vgmr_cat_name(array $c, string $id): string
{
    return is_string($c['name'] ?? null) && $c['name'] !== '' ? $c['name'] : $id;
}

/** Kategori yolu (ust kategori varsa once o): [[ad, adres], ...]. */
function vgmr_cat_crumbs(string $id): array
{
    $c = vgm_category($id);
    if ($c === null) {
        return [];
    }
    $out = [];
    if ($c['parent'] !== null && ($parent = vgm_category($c['parent'])) !== null) {
        $out[] = [vgmr_cat_name($parent, $c['parent']), '/magaza/kategori/' . $c['parent'] . '/'];
    }
    $out[] = [vgmr_cat_name($c, $id), '/magaza/kategori/' . $id . '/'];
    return $out;
}

/* ------------------------------------------------------------------ ortak bilesenler */

/** Arama kutusu (GET /magaza/ara/). */
function vgmr_search_form(string $q, string $class, string $idSuffix): string
{
    return '<form class="vgm-search ' . $class . '" action="/magaza/ara/" method="get" role="search" aria-label="Mağazada ara">'
        . '<label class="vgm-sr" for="vgm-q-' . $idSuffix . '">Ürün ara</label>'
        . '<input id="vgm-q-' . $idSuffix . '" type="search" name="q" value="' . vgmr_esc($q) . '" placeholder="Ürün, marka veya model ara" maxlength="80" autocomplete="off">'
        . '<button type="submit" class="vgm-search__btn"><span class="vgm-sr">Ara</span>'
        . '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">'
        . '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button></form>';
}

/**
 * Yapiskan magaza cubugu: arama, sepet baglantisi ve [data-vgm-cart-count] rozeti (js/magaza.js doldurur). Dar ekranda
 * (<48rem) arama satiri JS varsa [data-vgm-search-toggle] dugmesiyle acilir (P1-07); JS yoksa her zaman gorunur.
 */
function vgmr_bar(string $q = ''): string
{
    return '<div class="vgm-bar" data-vgm-bar><div class="vgm-wrap vgm-bar__in">'
        . '<nav class="vgm-bar__nav" aria-label="Mağaza menüsü">'
        . '<a class="vgm-bar__brand" href="/magaza/">Mağaza</a>'
        . '<a class="vgm-bar__opt" href="/magaza/siparis-takip.html">Sipariş takibi</a>'
        . '<a class="vgm-bar__opt" href="/magaza/odeme-ve-teslimat.html">Ödeme ve teslimat</a></nav>'
        . '<button type="button" class="vgm-bar__search" data-vgm-search-toggle aria-expanded="' . ($q !== '' ? 'true' : 'false') . '" aria-controls="vgm-q-bar">'
        . '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">'
        . '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><span class="vgm-sr">Ürün ara</span></button>'
        . vgmr_search_form($q, 'vgm-search--bar', 'bar')
        . '<a class="vgm-bar__cart" href="/magaza/sepet.html" data-vgm-cart-link>'
        . '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
        . 'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.4-1l2-6.4H6.1"/>'
        . '<circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>'
        . '<span class="vgm-bar__label">Sepet</span><span class="vgm-badge" data-vgm-cart-count hidden>0</span></a>'
        . '</div></div>';
}

/** Kapali magaza bandi: vitrinde tam metin, diger sayfalarda tek satir; kapatilabilir (js/magaza.js localStorage'da hatirlar). */
function vgmr_banner(array $ctx, bool $full = false): string
{
    if ($ctx['open']) {
        return '';
    }
    return '<div class="vgm-banner' . ($full ? ' vgm-banner--full' : '') . '" role="status" data-vgm-banner><div class="vgm-wrap vgm-banner__in"><p><strong>' . vgmr_esc(VGMR_CLOSED) . '.</strong>'
        . ($full ? ' Ürünleri ve fiyatları şimdiden inceleyebilir, güncel stok ve fiyat için teklif isteyebilirsiniz.' : ' <a class="vgm-banner__link" href="' . VGMR_CONTACT . '">Teklif isteyin</a>') . '</p>'
        . '<button type="button" class="vgm-banner__close" data-vgm-banner-close aria-label="Bildirimi kapat">&times;</button></div></div>';
}

/** Liste ustunde bir kez yazilan fiyat notu (kartlarda "KDV dahil" tekrar edilmez; P1-10). */
function vgmr_grid_note(): string
{
    return '<p class="vgm-grid__note">' . vgmr_esc(VGMR_NOTE_VAT) . '</p>';
}

/**
 * Kart basligi (P1-11): kartin "MARKA · KOD" satirinda zaten gorunen marka ve model kodu baslikta tekrar edilmez.
 * Basta tekrar eden marka ("Schneider A9F74116 ..." -> "A9F74116 ...") ve ardindan tam model kodu ($mpn; buyuk/kucuk harf
 * duyarsiz, ayiriciyla biten) kirpilir: "ABB 2CCG001232R0001 S803P-C80 ..." -> "S803P-C80 ...". Geriye bir sey kalmazsa ad
 * oldugu gibi kalir. Urun sayfasindaki H1 tam addir.
 */
function vgmr_card_title(string $name, string $brand, string $mpn = ''): string
{
    $t = vgmr_strip_brand($name, $brand);
    $mpn = trim($mpn);
    $len = strlen($mpn);
    if ($len > 0 && strlen($t) > $len + 1 && vgm_fold(substr($t, 0, $len)) === vgm_fold($mpn)
        && preg_match('/^[\s\-–:·,\/]/u', substr($t, $len)) === 1) {
        $rest = trim((string)preg_replace('/^[\s\-–:·,\/]+/u', '', substr($t, $len)));
        if ($rest !== '') {
            return $rest;
        }
    }
    return $t;
}

/** Basta tekrar eden markayi (ya da markanin en az 3 harfli ilk sozcugunu) kirpar. */
function vgmr_strip_brand(string $name, string $brand): string
{
    $len = strlen($brand);
    if ($brand !== '' && strlen($name) > $len + 1 && vgm_fold(substr($name, 0, $len)) === vgm_fold($brand)
        && preg_match('/^[\s\-–:·]/u', substr($name, $len)) === 1) {
        $rest = trim((string)preg_replace('/^[\s\-–:·]+/u', '', substr($name, $len)));
        if ($rest !== '') {
            return $rest;
        }
    }
    /* "HES Kablo" markasi + "HES H07V-K ..." basligi: markanin ilk sozcugu (en az 3 harf) da tekrar sayilir. */
    $first = (string)preg_replace('/\s.*$/su', '', $brand);
    $flen = strlen($first);
    if ($first !== $brand && preg_match('/^.{3}/su', $first) === 1 && strlen($name) > $flen + 1 && substr($name, $flen, 1) === ' '
        && vgm_fold(substr($name, 0, $flen)) === vgm_fold($first)) {
        $rest = trim(substr($name, $flen));
        if ($rest !== '') {
            return $rest;
        }
    }
    return $name;
}

function vgmr_trust(): string
{
    $items = [['Havale/EFT ile ödeme', 'Sipariş sonrası IBAN ve sipariş numaranız gösterilir.'],
        ['Fiyatlar her gün doğrulanır', 'Tedarik fiyatı ve TCMB kuru güncel tutulur.'],
        ['Faturalı satış', 'Tüm fiyatlar Türk lirası ve KDV dahildir.'],
        ['Mühendis desteği', 'Doğru ürünü seçmek için mühendislerimize sorun.']];
    $h = '<ul class="vgm-trust">';
    foreach ($items as $it) {
        $h .= '<li><strong>' . vgmr_esc($it[0]) . '</strong><span>' . vgmr_esc($it[1]) . '</span></li>';
    }
    return $h . '</ul>';
}

/** Urun karti (liste karti ya da tam urun kaydi). Fiyat yalnizca bu urunun fiyat parcasindan hesaplanir. */
function vgmr_card(array $p, array $ctx): string
{
    $price = vgmr_price($p, $ctx);
    $url = '/magaza/urun/' . $p['slug'] . '/';
    $chip = vgmr_chip($price, $p);
    $brand = trim(vgmr_str($p['brand'] ?? ''));
    $mpn = trim(vgmr_str($p['mpn'] ?? ''));
    $unit = vgmr_unit($p);
    $name = (string)$p['name'];
    $h = '<li class="vgm-card" data-vgm-card data-id="' . vgmr_esc((string)$p['id']) . '">';
    $h .= '<a class="vgm-card__media th-paper" href="' . vgmr_esc($url) . '" tabindex="-1" aria-hidden="true">' . vgmr_card_image($p) . '</a>';
    $h .= '<div class="vgm-card__body">';
    if ($brand !== '' || $mpn !== '') {
        /* Profesyonel alici listeyi model koduna gore tarar: her kartta mono "MARKA · KOD" satiri (P1-11). */
        $h .= '<p class="vgm-card__code">' . ($brand !== '' ? '<span class="vgm-card__brand">' . vgmr_esc($brand) . '</span>' : '')
            . ($brand !== '' && $mpn !== '' ? '<span class="vgm-card__sep" aria-hidden="true"> · </span>' : '')
            . ($mpn !== '' ? '<span class="vgm-card__mpn">' . vgmr_esc($mpn) . '</span>' : '') . '</p>';
    }
    $title = vgmr_card_title($name, $brand, $mpn);
    $h .= '<h3 class="vgm-card__title"><a href="' . vgmr_esc($url) . '"' . ($title !== $name ? ' aria-label="' . vgmr_esc($name) . '"' : '') . '>'
        . vgmr_esc($title) . '</a></h3>';
    $summary = trim(vgmr_str($p['summary'] ?? ''));
    if ($summary !== '') {
        $h .= '<p class="vgm-card__sum">' . vgmr_esc(vgmr_clip($summary, 110)) . '</p>';
    }
    $h .= '<div class="vgm-card__foot">' . vgmr_price_html($price, false, $p) . '<p class="vgm-card__chips">';
    if ($unit[0] !== 'adet') {
        $h .= '<span class="vgm-chip vgm-chip--unit">' . vgmr_esc($unit[0]) . ' ile satılır</span>';
    }
    if ($chip !== null) {
        $h .= '<span class="vgm-chip vgm-chip--' . $chip[0] . '">' . vgmr_esc($chip[1]) . '</span>';
    }
    $h .= '</p>';
    /* Sepet once (sahibin karari, 2026-11-02): fiyati gosterilen ya da gosterilmeyen HER urun sepete eklenebilir; sepet
       siparis (yalnizca dogrulanmis fiyatli satirlar, magaza acikken) ya da tek seferde teklif olarak gonderilir. */
    $q = vgmr_qty_rules($p);
    $qid = 'vgm-cq-' . preg_replace('/[^a-z0-9-]/', '', (string)$p['id']);
    $ctxName = $mpn !== '' ? $mpn : vgmr_clip($title, 60);   // her kartta ayirt edilebilir erisilebilir ad
    $h .= '<div class="vgm-card__add"><label class="vgm-sr" for="' . $qid . '">' . vgmr_esc($unit[1] . ' – ' . $ctxName) . '</label>'
        . '<input id="' . $qid . '" type="number" inputmode="numeric" min="' . $q['min'] . '" max="' . $q['max'] . '" step="' . $q['step'] . '" value="' . $q['min'] . '" data-vgm-qty>'
        . '<button type="button" class="vgm-btn vgm-btn--primary vgm-btn--sm" data-vgm-add="' . vgmr_esc((string)$p['id']) . '" data-max="' . $q['max'] . '" data-min="' . $q['min']
        . '" data-step="' . $q['step'] . '" data-name="' . vgmr_esc($name) . '" data-slug="' . vgmr_esc((string)$p['slug']) . '" data-unit="' . vgmr_esc($unit[0])
        . '" data-orderable="' . ($price['orderable'] ? '1' : '0') . '">+ Sepete ekle<span class="vgm-sr"> – ' . vgmr_esc($ctxName) . '</span></button>'
        . '<p class="vgm-card__live" role="status" aria-live="polite" data-vgm-live></p></div>';
    return $h . '</div></div></li>';
}

function vgmr_grid(array $products, array $ctx): string
{
    $h = '<ul class="vgm-grid" data-vgm-grid>';
    foreach (array_slice($products, 0, VGMR_LIST_LIMIT) as $p) {
        $h .= vgmr_card($p, $ctx);
    }
    return $h . '</ul>';
}

function vgmr_itemlist_ld(array $products, string $name, int $offset = 0): array
{
    $list = [];
    foreach (array_slice($products, 0, 50) as $i => $p) {
        $list[] = ['@type' => 'ListItem', 'position' => $offset + $i + 1, 'name' => (string)$p['name'], 'url' => VGMR_SITE . '/magaza/urun/' . $p['slug'] . '/'];
    }
    return ['@context' => 'https://schema.org', '@type' => 'ItemList', 'name' => $name, 'itemListElement' => $list];
}

function vgmr_empty_state(string $title, string $text): string
{
    return '<section class="vgm-empty-state"><div class="vgm-empty-state__ico" aria-hidden="true">' . vgmr_cat_icon('gunes-panelleri') . '</div>'
        . '<h2>' . vgmr_esc($title) . '</h2><p>' . vgmr_esc($text) . '</p>'
        . '<p class="vgm-actions"><a class="vgm-btn vgm-btn--primary" href="' . VGMR_CONTACT . '">Teklif isteyin</a>'
        . '<a class="vgm-btn vgm-btn--ghost" href="/hizmetler/">Hizmetlerimiz</a>'
        . '<a class="vgm-link" href="/iletisim.html">İletişim</a></p></section>';
}

function vgmr_help_cta(): string
{
    return '<aside class="vgm-help"><div><h2>Doğru ürünü seçemediniz mi?</h2>'
        . '<p>Güç, kablo kesiti, koruma ve uyumluluk sorularınızı mühendislerimize iletin; size uygun ürünü birlikte seçelim.</p></div>'
        . '<p class="vgm-actions"><a class="vgm-btn vgm-btn--primary" href="/sor.html">Mühendisimize sorun</a>'
        . '<a class="vgm-btn vgm-btn--ghost" href="' . VGMR_CONTACT . '">Teklif isteyin</a></p></aside>';
}

/* ------------------------------------------------------------------ sayfalar */

/**
 * Vitrinde one cikan urunler: her ust kategoriden bir urun (en cok $max). Urunu olan en kucuk yaprak listesi okunur
 * (50.000 urunde de vitrin en cok $max kucuk liste dosyasi okur).
 */
function vgmr_featured(int $max = 8): array
{
    $cats = vgm_categories();
    $out = [];
    foreach ($cats as $id => $c) {
        if ($c['parent'] !== null || $c['count'] < 1) {
            continue;
        }
        $leaf = null;
        $best = PHP_INT_MAX;
        foreach ($c['children'] as $child) {
            $n = (int)($cats[$child]['count'] ?? 0);
            if ($n > 0 && $n < $best) {
                $leaf = (string)$child;
                $best = $n;
            }
        }
        $cards = vgm_list_file($leaf ?? (string)$id);
        if (!$cards && $leaf !== null) {
            $cards = vgm_list_file((string)$id);
        }
        if ($cards) {
            $out[] = $cards[0];
        }
        if (count($out) >= $max) {
            break;
        }
    }
    return $out;
}

const VGMR_HUB_SUBS = 6;                 // vitrin kategori kartinda en cok alt kategori (urun sayisina gore)

/**
 * Vitrin kategori karti: simge, ad, urun sayisi ve en kalabalik VGMR_HUB_SUBS alt kategori tek bir kartta; altta
 * "Tümünü gör (N)". Kart esit yukseklikte (izgara satiri), icerik dogal akar; alt kategori listesi kartin DISINA tasmaz.
 */
function vgmr_hub_tile(array $cats, string $id, array $c): string
{
    $name = vgmr_cat_name($c, $id);
    $href = '/magaza/kategori/' . vgmr_esc($id) . '/';
    $subs = [];
    foreach ($c['children'] as $child) {
        $cc = $cats[$child] ?? null;
        if ($cc !== null && $cc['count'] > 0) {
            $subs[] = [(string)$child, $cc];
        }
    }
    usort($subs, function (array $a, array $b): int {
        return [(int)$b[1]['count'], $a[0]] <=> [(int)$a[1]['count'], $b[0]];
    });
    $hid = 'vgm-cat-' . preg_replace('/[^a-z0-9-]/', '', $id);
    $h = '<li class="vgm-cats__item"><article class="vgm-cat" aria-labelledby="' . $hid . '">'
        . '<a class="vgm-cat__head" href="' . $href . '"><span class="vgm-cat__ico">' . vgmr_cat_icon($id) . '</span>'
        . '<span class="vgm-cat__title"><span class="vgm-cat__name" id="' . $hid . '">' . vgmr_esc($name) . '</span>'
        . '<span class="vgm-cat__count">' . number_format((int)$c['count'], 0, ',', '.') . ' ürün</span></span></a>';
    if ($subs) {
        $h .= '<ul class="vgm-cat__subs" aria-label="' . vgmr_esc($name) . ' alt kategorileri">';
        foreach (array_slice($subs, 0, VGMR_HUB_SUBS) as $s) {
            $h .= '<li><a href="/magaza/kategori/' . vgmr_esc($s[0]) . '/"><span class="vgm-cat__sub">' . vgmr_esc(vgmr_cat_name($s[1], $s[0])) . '</span>'
                . '<span class="vgm-cat__n">' . number_format((int)$s[1]['count'], 0, ',', '.') . '<span class="vgm-sr"> ürün</span></span></a></li>';
        }
        $h .= '</ul>';
    }
    $more = 'Tümünü gör (' . number_format((int)$c['count'], 0, ',', '.') . ' ürün)';
    return $h . '<a class="vgm-cat__all" href="' . $href . '">' . vgmr_esc($more) . '<span class="vgm-sr"> – ' . vgmr_esc($name) . '</span><span aria-hidden="true"> →</span></a>'
        . '</article></li>';
}

/** Vitrin: /magaza/ — ust kategoriler (sayilar ve alt kategori baglantilari), arama ve one cikan urunler. */
function vgmr_render_hub(array $ctx): array
{
    $cats = vgm_categories();
    $total = vgm_manifest()['products'];
    $has = $total > 0;
    $main = '<main class="vgm vgm--hub" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx, true) . "\n"
        . '<header class="vgm-hero"><div class="vgm-wrap">'
        . '<p class="vgm-kicker">VoltGuard Mağaza</p>'
        . '<h1>Elektrik ve güneş enerjisi ürünleri</h1>'
        . '<p class="vgm-lead">Güneş paneli, inverter, enerji depolama, koruma ve ölçü cihazlarını tek yerde inceleyin. Fiyatlar Türk lirası ve KDV dahil '
        . 'gösterilir; ödeme havale/EFT ile yapılır, satış faturalıdır. Seçim yaparken mühendislerimize danışabilirsiniz.</p>'
        . ($has ? vgmr_search_form('', 'vgm-search--hero', 'hub') : '')
        . vgmr_trust() . '</div></header>' . "\n" . '<div class="vgm-wrap">';
    if (!$has) {
        $main .= vgmr_empty_state('Ürünler hazırlanıyor', 'Mağazamızın ürün kataloğunu hazırlıyoruz; güneş enerjisi ve elektrik ürünleri çok yakında burada olacak. '
            . 'Bu sırada ihtiyacınız olan ürün veya proje için bizden teklif alabilirsiniz.');
    } else {
        $tiles = '';
        foreach ($cats as $id => $c) {
            if ($c['parent'] !== null || $c['count'] < 1) {
                continue;
            }
            $tiles .= vgmr_hub_tile($cats, (string)$id, $c);
        }
        $main .= '<section class="vgm-section" aria-labelledby="vgm-cats-h"><h2 id="vgm-cats-h">Kategoriler <span class="vgm-count">(' . number_format((int)$total, 0, ',', '.') . ' ürün)</span></h2>'
            . '<ul class="vgm-cats">' . $tiles . '</ul></section>';
        $featured = vgmr_featured();
        if ($featured) {
            $main .= '<section class="vgm-section" aria-labelledby="vgm-feat-h"><h2 id="vgm-feat-h">Öne çıkan ürünler</h2>' . vgmr_grid_note()
                . vgmr_grid($featured, $ctx)
                . '<p class="vgm-fine">' . vgmr_esc(VGMR_NOTE_RATE) . '. Her ürünün fiyat kontrol zamanı ürün sayfasında yer alır.</p></section>';
        }
    }
    $main .= vgmr_help_cta() . '</div></main>';
    $ld = [vgmr_breadcrumb_ld([['Ana sayfa', '/'], ['Mağaza', '/magaza/']])];
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta([
        'title' => 'VoltGuard Mağaza – Güneş Enerjisi ve Elektrik Ürünleri',
        'desc' => 'VoltGuard Mağaza: güneş paneli, inverter, enerji depolama ve elektrik malzemeleri. Türk lirası ve KDV dahil fiyatlar her gün güncellenir; havale/EFT ile ödeme, faturalı satış.',
        'url' => VGMR_SITE . '/magaza/', 'robots' => $has ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow', 'ld' => $ld])];
}

/** Kategori teknik suzgec parametreleri (kanonik sira) => kart "attr" anahtari (tools/magaza/katalog-ortak.cjs ATTR_KEYS; P1-06). */
const VGMR_ATTR_PARAMS = ['kutup' => 'poles', 'akim' => 'amps', 'egri' => 'curve', 'ka' => 'ka', 'kesit' => 'section', 'faz' => 'phase', 'kw' => 'kw'];
const VGMR_FACET_MAX_VALUES = 12;        // bir suzgecte adreste en cok deger
const VGMR_SEARCH_BRAND_CATS = 2;        // arama: marka sayimi en cok bu kadar yaprak kategoride (liste dosyasi okunur; once kategori cipiyle daraltilir)
/** Kanonik parametre sirasi (js/magaza.js data-vgm-params ile ayni). */
const VGMR_CATEGORY_PARAMS = ['marka', 'kutup', 'akim', 'egri', 'ka', 'kesit', 'faz', 'kw', 'sirala'];
const VGMR_SEARCH_PARAMS = ['q', 'kategori', 'marka'];

/** Kategori sayfasi sorgu parametreleri: gecersizse null (404). Teknik suzgecler "kutup=1P,3P" ya da form dizisi kutup[]=1P. */
function vgmr_category_query(array $get): ?array
{
    $q = ['sayfa' => 1, 'marka' => '', 'sirala' => 'onerilen', 'attr' => []];
    foreach (['sayfa', 'marka', 'sirala'] as $k) {
        if (isset($get[$k]) && !is_string($get[$k])) {
            return null;
        }
    }
    if (isset($get['sayfa'])) {
        if (preg_match('/^[1-9][0-9]{0,5}$/D', $get['sayfa']) !== 1) {
            return null;
        }
        $q['sayfa'] = (int)$get['sayfa'];
    }
    if (isset($get['marka']) && $get['marka'] !== '') {
        if (preg_match('/^[a-z0-9-]{1,80}$/D', $get['marka']) !== 1) {
            return null;
        }
        $q['marka'] = $get['marka'];
    }
    if (isset($get['sirala']) && $get['sirala'] !== '') {
        if (!isset(VGMR_SORTS[$get['sirala']])) {
            return null;
        }
        $q['sirala'] = $get['sirala'];
    }
    foreach (VGMR_ATTR_PARAMS as $param => $key) {
        if (!isset($get[$param])) {
            continue;
        }
        $raw = $get[$param];
        if (is_string($raw)) {
            $raw = explode(',', $raw);
        } elseif (!is_array($raw) || count($raw) > VGMR_FACET_MAX_VALUES || ($raw !== [] && array_keys($raw) !== range(0, count($raw) - 1))) {
            return null;
        }
        $vals = [];
        foreach ($raw as $v) {
            if (!is_string($v)) {
                return null;
            }
            if ($v === '') {
                continue;
            }
            if (preg_match('/^[A-Za-z0-9.+]{1,12}$/D', $v) !== 1) {
                return null;
            }
            $vals[$v] = true;
        }
        if (count($vals) > VGMR_FACET_MAX_VALUES) {
            return null;
        }
        if ($vals) {
            $q['attr'][$param] = array_map('strval', array_keys($vals));   // "16" dizi anahtarinda int olur; karsilastirma metinle
        }
    }
    return $q;
}

/**
 * Kategori adresi: parametre sirasi sabit (marka, kutup, akim, egri, ka, kesit, faz, kw, sirala, sayfa); varsayilanlar
 * yazilmaz; bir suzgecin birden cok degeri virgulle (kutup=1P,3P). HTML'e yazilmaya hazir (&amp;).
 */
function vgmr_category_url(string $id, string $marka, string $sirala, int $sayfa, array $attr = []): string
{
    $parts = [];
    if ($marka !== '') {
        $parts[] = 'marka=' . rawurlencode($marka);
    }
    foreach (VGMR_ATTR_PARAMS as $param => $key) {
        if (!empty($attr[$param])) {
            $parts[] = $param . '=' . implode(',', array_map('rawurlencode', $attr[$param]));
        }
    }
    if ($sirala !== 'onerilen') {
        $parts[] = 'sirala=' . rawurlencode($sirala);
    }
    if ($sayfa > 1) {
        $parts[] = 'sayfa=' . $sayfa;
    }
    return '/magaza/kategori/' . $id . '/' . ($parts ? '?' . implode('&amp;', $parts) : '');
}

/** Kart "attr" degerinin adres/karsilastirma bicimi: 16 -> "16", 4.5 -> "4.5", "1P+N"; cozulemezse null. */
function vgmr_attr_value($v): ?string
{
    if (is_int($v)) {
        return (string)$v;
    }
    if (is_float($v) && is_finite($v)) {
        return rtrim(rtrim(sprintf('%.3F', $v), '0'), '.');
    }
    if (is_string($v) && preg_match('/^[A-Za-z0-9.+]{1,12}$/D', $v) === 1) {
        return $v;
    }
    return null;
}

/** Suzgec degerinin gorunen etiketi (ondalik virgul, birim; faz: Monofaze/Trifaze). */
function vgmr_attr_label(array $f, string $v): string
{
    if ($f['key'] === 'phase') {
        return $v === '1' ? 'Monofaze (1 faz)' : ($v === '3' ? 'Trifaze (3 faz)' : $v . ' faz');
    }
    $unit = is_string($f['unit'] ?? null) ? trim($f['unit']) : '';
    return str_replace('.', ',', $v) . ($unit !== '' ? ' ' . $unit : '');
}

/** Degerleri suzgecin gorunen sirasina dizer (number: sayisal artan; enum: dogal sira). */
function vgmr_attr_sort(array $vals, array $f): array
{
    usort($vals, function (string $a, string $b) use ($f): int {
        return $f['type'] === 'number' ? ((float)$a <=> (float)$b ?: strcmp($a, $b)) : (strnatcasecmp($a, $b) ?: strcmp($a, $b));
    });
    return $vals;
}

/**
 * Kategorinin teknik suzgec tanimlari (kategoriler.json "filters"; yoksa ust kategorininki): adres parametresi => tanim,
 * kanonik parametre sirasiyla. Bilinmeyen anahtar/tur atlanir.
 */
function vgmr_cat_filters(array $c): array
{
    $defs = is_array($c['filters'] ?? null) ? $c['filters'] : [];
    if (!$defs && $c['parent'] !== null) {
        $parent = vgm_category((string)$c['parent']);
        $defs = is_array($parent) && is_array($parent['filters'] ?? null) ? $parent['filters'] : [];
    }
    $byKey = [];
    foreach ($defs as $f) {
        if (is_array($f) && is_string($f['key'] ?? null) && in_array($f['key'], VGMR_ATTR_PARAMS, true) && is_string($f['label'] ?? null)
            && in_array($f['type'] ?? null, ['enum', 'number'], true)) {
            $byKey[$f['key']] = $f;
        }
    }
    $out = [];
    foreach (VGMR_ATTR_PARAMS as $param => $key) {
        if (isset($byKey[$key])) {
            $out[$param] = $byKey[$key];
        }
    }
    return $out;
}

/** Kart etkin teknik suzgeclere uyuyor mu ($skip: sayimi yapilan suzgec haric tutulur). attr'siz kart hicbir suzgece girmez. */
function vgmr_attr_match(array $card, array $active, ?string $skip = null): bool
{
    foreach ($active as $param => $vals) {
        if ($param === $skip) {
            continue;
        }
        $attr = is_array($card['attr'] ?? null) ? $card['attr'] : [];
        $v = vgmr_attr_value($attr[VGMR_ATTR_PARAMS[$param]] ?? null);
        if ($v === null || !in_array($v, $vals, true)) {
            return false;
        }
    }
    return true;
}

/**
 * Teknik suzgec sayimlari: parametre => [deger => urun sayisi]. Bir grubun sayilari diger gruplarin etkin degerleri
 * uygulanarak hesaplanir (ayni grupta birden cok deger "veya" ile birlesir).
 */
function vgmr_attr_facets(array $cards, array $filters, array $active = []): array
{
    $out = [];
    foreach ($filters as $param => $f) {
        $counts = [];
        foreach ($cards as $card) {
            $attr = is_array($card['attr'] ?? null) ? $card['attr'] : [];
            $v = vgmr_attr_value($attr[$f['key']] ?? null);
            if ($v === null || !vgmr_attr_match($card, $active, $param)) {
                continue;
            }
            $counts[$v] = ($counts[$v] ?? 0) + 1;
        }
        $out[$param] = $counts;
    }
    return $out;
}

/**
 * Teknik suzgec kutusu (form icinde; "Uygula" ile gonderilir). Kategoride en az iki degeri olan (ya da tek degeri yalnizca
 * bir kisim urunde bulunan) gruplar gosterilir; az
 * urunlu degerler (1 urun, kategori 48'den buyukse) secili degilse gizlenir; diger secimlerle eslesmeyen degerler pasif.
 */
function vgmr_facets_html(array $filters, array $universe, array $facets, array $active, int $catTotal): string
{
    $groups = '';
    $selected = 0;
    foreach ($filters as $param => $f) {
        $vals = array_keys($universe[$param] ?? []);
        $on = $active[$param] ?? [];
        /* Tek degerli grup yalnizca daraltiyorsa gosterilir (degeri olmayan urunler var); her urunde ayni deger bilgi tasimaz. */
        if (!$vals || (count($vals) === 1 && !$on && (int)array_sum($universe[$param]) >= $catTotal)) {
            continue;
        }
        $items = '';
        foreach (vgmr_attr_sort(array_map('strval', $vals), $f) as $v) {
            $n = (int)($facets[$param][$v] ?? 0);
            $checked = in_array($v, $on, true);
            if (!$checked && (int)$universe[$param][$v] < 2 && $catTotal > VGMR_PAGE_SIZE) {
                continue;
            }
            $selected += $checked ? 1 : 0;
            $items .= '<li><label class="vgm-facet' . (!$checked && $n === 0 ? ' vgm-facet--empty' : '') . '"><input type="checkbox" name="' . $param . '[]" value="' . vgmr_esc($v) . '"'
                . ($checked ? ' checked' : '') . (!$checked && $n === 0 ? ' disabled' : '') . '> <span>' . vgmr_esc(vgmr_attr_label($f, $v)) . '</span> <span class="vgm-count">(' . $n . ')</span></label></li>';
        }
        if ($items === '') {
            continue;
        }
        $groups .= '<fieldset class="vgm-facets__group"><legend>' . vgmr_esc((string)$f['label']) . '</legend><ul>' . $items . '</ul></fieldset>';
    }
    if ($groups === '') {
        return '';
    }
    /* Telefonda panel urunlerin onunde iki ekran kapliyordu: secili suzgec yoksa ilk boyamadan ONCE kapatilir (satir ici
       betik hemen </details>'ten sonra calisir; defer'li magaza.js'yi beklemek gec kapanip duzen kaymasi yapiyordu). JS'siz
       ve genis ekranda sunucunun acik hali kalir; ekran genisleyince magaza.js paneli yeniden acar. */
    return '<details class="vgm-facets" data-vgm-facets open><summary>Teknik özellikler' . ($selected ? ' <span class="vgm-count">(' . $selected . ' seçili)</span>' : '') . '</summary>'
        . '<div class="vgm-facets__groups">' . $groups . '</div></details>'
        . ($selected ? '' : VGMR_FACETS_NARROW_JS);
}

/** Etkin suzgec cipleri: her biri yalnizca kendini kaldiran adrese gider; birden coksa "Tumunu temizle". */
function vgmr_active_filters_html(string $id, string $marka, string $brandName, string $sirala, array $active, array $filters): string
{
    $chips = [];
    if ($marka !== '') {
        $chips[] = [vgmr_category_url($id, '', $sirala, 1, $active), 'Marka: ' . $brandName];
    }
    foreach ($active as $param => $vals) {
        foreach ($vals as $v) {
            $rest = $active;
            $rest[$param] = array_values(array_filter($vals, function (string $x) use ($v): bool {
                return $x !== $v;
            }));
            $chips[] = [vgmr_category_url($id, $marka, $sirala, 1, $rest), $filters[$param]['label'] . ': ' . vgmr_attr_label($filters[$param], $v)];
        }
    }
    if (!$chips) {
        return '';
    }
    $h = '<ul class="vgm-active-filters" aria-label="Etkin süzgeçler">';
    foreach ($chips as $c) {
        $h .= '<li><a class="vgm-chip vgm-chip--active" href="' . $c[0] . '" aria-label="' . vgmr_esc('Süzgeci kaldır: ' . $c[1]) . '">' . vgmr_esc($c[1]) . ' <span aria-hidden="true">×</span></a></li>';
    }
    if (count($chips) > 1) {
        $h .= '<li><a class="vgm-link" href="' . vgmr_category_url($id, '', $sirala, 1) . '">Tümünü temizle</a></li>';
    }
    return $h . '</ul>';
}

/**
 * Liste siralamasi (P1-15). Fiyat: $ctx verilmisse ve kategoride gosterilebilir TL fiyati olan kart varsa kartta GORUNEN
 * KDV dahil TL (vgmr_price; marj, KDV ve canli fiyat dahil) — gosterilemeyenler sonda. Hic gorunur fiyat yoksa (kur yok,
 * kaynak yok) ya da liste VGMR_SORT_LIVE_MAX'tan buyukse katalogun "sortTry" anahtari, yoksa listUsd; fiyati olmayanlar sonda.
 * $tlMap: kimlik => gorunen TL (vgmr_sort_tl_map; kategori icin onbellekli). Verilmezse kartlarin fiyati burada okunur.
 */
function vgmr_sort_cards(array $cards, string $sort, ?array $ctx = null, ?array $tlMap = null): array
{
    if ($sort === 'onerilen') {
        return $cards;
    }
    $names = [];
    $prices = [];
    $ids = [];
    foreach ($cards as $c) {
        $names[] = vgm_fold((string)$c['name']);
        $v = (is_int($c['sortTry'] ?? null) || is_float($c['sortTry'] ?? null)) && $c['sortTry'] > 0 ? $c['sortTry'] : ($c['listUsd'] ?? null);
        $prices[] = (is_int($v) || is_float($v)) && $v > 0 ? (float)$v : null;
        $ids[] = (string)$c['id'];
    }
    if ($ctx !== null && $sort !== 'ad' && ($tlMap !== null || count($cards) <= VGMR_SORT_LIVE_MAX)) {
        $map = $tlMap ?? vgmr_sort_tl_compute($cards, $ctx);
        $tl = [];
        $any = false;
        foreach ($cards as $c) {
            $v = $map[(string)$c['id']] ?? null;
            $v = is_int($v) || is_float($v) ? (float)$v : null;
            $any = $any || $v !== null;
            $tl[] = $v;
        }
        if ($any) {
            $prices = $tl;
        }
    }
    if ($sort === 'ad') {
        array_multisort($names, SORT_ASC, SORT_STRING, $ids, SORT_ASC, SORT_STRING, $cards);
        return $cards;
    }
    $missing = [];
    $keys = [];
    foreach ($prices as $v) {
        $missing[] = $v === null ? 1 : 0;
        $keys[] = $v === null ? 0.0 : ($sort === 'fiyat-azalan' ? -$v : $v);
    }
    array_multisort($missing, SORT_ASC, SORT_NUMERIC, $keys, SORT_ASC, SORT_NUMERIC, $names, SORT_ASC, SORT_STRING, $ids, SORT_ASC, SORT_STRING, $cards);
    return $cards;
}

/** Kartlarin kartta GORUNEN KDV dahil TL fiyati (gosterilemeyen: null); her kartin fiyat parcasi okunur. */
function vgmr_sort_tl_compute(array $cards, array $ctx): array
{
    $map = [];
    foreach ($cards as $c) {
        $pr = vgmr_price($c, $ctx);
        $map[(string)$c['id']] = vgmr_display_of($pr) !== null ? (float)$pr['tryGross'] : null;
    }
    return $map;
}

/**
 * Fiyat siralamasi icin kategorinin TUM kartlarinin gorunen TL haritasi, veri dizininde kategori basina tek dosyada
 * onbellekli (onbellek/sirala/<kategori>.json). Buyuk bir kategoride her istek yuzlerce urunun fiyat parcalarini (id/100
 * parca; 9.681 urunde ~97) okumasin diye. Anahtar: kartlar, kur, yapilandirma (marj, kaynaklar), magaza acik/kapali,
 * dokunulan fiyat/<parca>.json dosyalarinin degisim zamani+boyutu ve VGMR_SORT_CACHE_TTL'lik zaman dilimi (48 saat / 30 gun
 * gosterim esikleri en cok bu kadar gec yansir; sayfadaki fiyat ve etiket her istekte canli hesaplanir). Onbellek okunamaz
 * ya da yazilamazsa canli hesaplanir; sayfa hicbir zaman onbellek yuzunden hata vermez.
 */
function vgmr_sort_tl_map(string $id, array $all, array $ctx): array
{
    $shards = [];
    foreach ($all as $c) {
        $shards[vgm_shard_of((string)$c['id'])] = true;
    }
    ksort($shards);
    $stat = [];
    foreach (array_keys($shards) as $sh) {
        $f = $ctx['dir'] . '/fiyat/' . $sh . '.json';
        $stat[] = $sh . ':' . (is_file($f) ? @filemtime($f) . '.' . @filesize($f) : '-');
    }
    $key = sha1((string)json_encode([$all, $ctx['rate'], $ctx['config'], $ctx['open'], intdiv((int)$ctx['now'], VGMR_SORT_CACHE_TTL), $stat]));
    $file = $ctx['dir'] . '/onbellek/sirala/' . $id . '.json';
    $raw = is_file($file) ? @file_get_contents($file, false, null, 0, 4194304) : false;
    $hit = is_string($raw) ? json_decode($raw, true, 8) : null;
    if (is_array($hit) && ($hit['key'] ?? null) === $key && is_array($hit['tl'] ?? null)) {
        return $hit['tl'];
    }
    $map = vgmr_sort_tl_compute($all, $ctx);
    $json = json_encode(['key' => $key, 'tl' => $map]);
    $parent = dirname($file);
    if (is_string($json) && (is_dir($parent) || @mkdir($parent, 0700, true))) {
        $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($tmp, $json) === strlen($json)) {
            if (!@rename($tmp, $file)) {
                @unlink($tmp);
            }
        } else {
            @unlink($tmp);
        }
    }
    return $map;
}

/** Sayfa gezinme cubugu ($url: sayfa numarasi => HTML'e hazir adres). */
function vgmr_pager_links(callable $url, int $page, int $pages): string
{
    if ($pages <= 1) {
        return '';
    }
    $h = '<nav class="vgm-pager" aria-label="Sayfalar"><ul>';
    if ($page > 1) {
        $h .= '<li><a class="vgm-pager__step" rel="prev" href="' . $url($page - 1) . '">&larr; Önceki</a></li>';
    }
    $shown = array_unique(array_filter([1, $page - 2, $page - 1, $page, $page + 1, $page + 2, $pages], function (int $n) use ($pages): bool {
        return $n >= 1 && $n <= $pages;
    }));
    sort($shown);
    $prev = 0;
    foreach ($shown as $n) {
        if ($prev && $n > $prev + 1) {
            $h .= '<li class="vgm-pager__gap" aria-hidden="true">…</li>';
        }
        $h .= $n === $page
            ? '<li><span class="vgm-pager__num" aria-current="page">' . $n . '</span></li>'
            : '<li><a class="vgm-pager__num" href="' . $url($n) . '" aria-label="Sayfa ' . $n . '">' . $n . '</a></li>';
        $prev = $n;
    }
    if ($page < $pages) {
        $h .= '<li><a class="vgm-pager__step" rel="next" href="' . $url($page + 1) . '">Sonraki &rarr;</a></li>';
    }
    return $h . '</ul></nav>';
}

/** Kategori sayfa gezinme cubugu (suzgecleri korur). */
function vgmr_pager(string $id, string $marka, string $sirala, int $page, int $pages, array $attr = []): string
{
    return vgmr_pager_links(function (int $n) use ($id, $marka, $sirala, $attr): string {
        return vgmr_category_url($id, $marka, $sirala, $n, $attr);
    }, $page, $pages);
}

/**
 * Kategori: /magaza/kategori/<id>/?marka=&kutup=&...&sirala=&sayfa= — alt kategori baglantilari, marka suzgeci, teknik
 * suzgecler (kategoriler.json "filters" + kart "attr"; P1-06), siralama ve sayfa basina 48 urun. Bilinmeyen kategori,
 * marka, suzgec ya da deger ve aralik disi sayfa icin null (404). Suzulmus/siralanmis gorunumler noindex,follow ve
 * kanonik adres suzulmemis 1. sayfa; suzulmemis sayfalar kendi adresine kanoniktir.
 */
function vgmr_render_category(array $ctx, string $id, array $get = []): ?array
{
    $c = vgm_category($id);
    $query = vgmr_category_query($get);
    if ($c === null || $query === null) {
        return null;
    }
    $filters = vgmr_cat_filters($c);
    $active = $query['attr'];
    foreach (array_keys($active) as $param) {
        if (!isset($filters[$param])) {
            return null;
        }
    }
    $all = vgm_list($id);
    $brands = [];
    $slugOf = [];   // marka adi => adres parcasi (her marka bir kez hesaplanir)
    foreach ($all as $card) {
        $b = trim(vgmr_str($card['brand'] ?? ''));
        $slug = $slugOf[$b] ?? ($slugOf[$b] = vgmr_slug($b));
        if ($slug === '') {
            continue;
        }
        if (!isset($brands[$slug])) {
            $brands[$slug] = ['name' => $b, 'count' => 0];
        }
        $brands[$slug]['count']++;
    }
    uasort($brands, function (array $a, array $b): int {
        return strcmp(vgm_fold($a['name']), vgm_fold($b['name'])) ?: strcmp($a['name'], $b['name']);
    });
    $marka = $query['marka'];
    $sirala = $query['sirala'];
    if ($marka !== '' && !isset($brands[$marka])) {
        return null;
    }
    $cards = $all;
    if ($marka !== '') {
        $cards = array_values(array_filter($all, function (array $card) use ($marka, $slugOf): bool {
            return ($slugOf[trim(vgmr_str($card['brand'] ?? ''))] ?? '') === $marka;
        }));
    }
    // teknik suzgecler: degerler kategoride bulunmali (sonsuz adres alani yok); adreste ve sayfada kanonik sirada
    $universe = $filters ? vgmr_attr_facets($all, $filters) : [];
    foreach ($active as $param => $vals) {
        foreach ($vals as $v) {
            if (!isset($universe[$param][$v])) {
                return null;
            }
        }
        $active[$param] = vgmr_attr_sort($vals, $filters[$param]);
    }
    $facets = $filters ? vgmr_attr_facets($cards, $filters, $active) : [];
    if ($active) {
        $cards = array_values(array_filter($cards, function (array $card) use ($active): bool {
            return vgmr_attr_match($card, $active);
        }));
    }
    $tlMap = ($sirala === 'fiyat-artan' || $sirala === 'fiyat-azalan') && count($all) <= VGMR_SORT_LIVE_MAX ? vgmr_sort_tl_map($id, $all, $ctx) : null;
    $cards = vgmr_sort_cards($cards, $sirala, $ctx, $tlMap);
    $total = count($cards);
    $pages = max(1, (int)ceil($total / VGMR_PAGE_SIZE));
    $page = $query['sayfa'];
    if ($page > $pages) {
        return null;
    }
    $slice = array_slice($cards, ($page - 1) * VGMR_PAGE_SIZE, VGMR_PAGE_SIZE);
    $filtered = $marka !== '' || $sirala !== 'onerilen' || $active;
    $name = vgmr_cat_name($c, $id);
    $title = is_string($c['title'] ?? null) && $c['title'] !== '' ? $c['title'] : $name;
    $intro = trim(vgmr_str($c['intro'] ?? ''));
    $crumbs = array_merge([['Ana sayfa', '/'], ['Mağaza', '/magaza/']], vgmr_cat_crumbs($id));

    // alt kategori baglantilari (ust kategoride alt kategoriler; alt kategoride kardesler ve "tumu")
    $chips = '';
    $parentId = $c['parent'];
    $family = $parentId !== null ? vgm_category($parentId) : $c;
    $familyId = $parentId !== null ? $parentId : $id;
    if ($family !== null && $family['children']) {
        $chips .= '<li><a class="vgm-subcat"' . ($familyId === $id ? ' aria-current="page"' : '') . ' href="/magaza/kategori/' . vgmr_esc($familyId) . '/">Tümü <span class="vgm-count">('
            . (int)$family['count'] . ')</span></a></li>';
        foreach ($family['children'] as $child) {
            $cc = vgm_category($child);
            if ($cc === null || $cc['count'] < 1) {
                continue;
            }
            $chips .= '<li><a class="vgm-subcat"' . ($child === $id ? ' aria-current="page"' : '') . ' href="/magaza/kategori/' . vgmr_esc((string)$child) . '/">'
                . vgmr_esc(vgmr_cat_name($cc, (string)$child)) . ' <span class="vgm-count">(' . (int)$cc['count'] . ')</span></a></li>';
        }
    }

    $main = '<main class="vgm vgm--category" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx) . "\n"
        . '<div class="vgm-wrap">' . vgmr_breadcrumb_html($crumbs)
        . '<header class="vgm-head"><p class="vgm-kicker">' . vgmr_esc($name) . '</p><h1>' . vgmr_esc($title) . '</h1>'
        . ($intro !== '' && $page === 1 && !$filtered ? '<p class="vgm-lead" data-vgm-clamp>' . vgmr_esc($intro) . '</p>' : '') . '</header>'
        . ($chips !== '' ? '<nav class="vgm-subcats" aria-label="Alt kategoriler" data-vgm-scroller><ul>' . $chips . '</ul></nav>' : '');
    if ($all) {
        $brandOpts = '<option value="">Tüm markalar (' . count($all) . ')</option>';
        foreach ($brands as $slug => $b) {
            $brandOpts .= '<option value="' . vgmr_esc((string)$slug) . '"' . ($slug === $marka ? ' selected' : '') . '>' . vgmr_esc($b['name']) . ' (' . $b['count'] . ')</option>';
        }
        $sortOpts = '';
        foreach (VGMR_SORTS as $key => $label) {
            $sortOpts .= '<option value="' . $key . '"' . ($key === $sirala ? ' selected' : '') . '>' . vgmr_esc($label) . '</option>';
        }
        $from = $total ? ($page - 1) * VGMR_PAGE_SIZE + 1 : 0;
        $to = ($page - 1) * VGMR_PAGE_SIZE + count($slice);
        $main .= '<section class="vgm-section" aria-label="Ürünler">'
            . '<form class="vgm-filter" action="/magaza/kategori/' . vgmr_esc($id) . '/" method="get" data-vgm-filter data-vgm-params="' . implode(',', VGMR_CATEGORY_PARAMS) . '">'
            . '<div class="vgm-field"><label for="vgm-marka">Marka</label><select id="vgm-marka" name="marka">' . $brandOpts . '</select></div>'
            . '<div class="vgm-field"><label for="vgm-sirala">Sırala</label><select id="vgm-sirala" name="sirala">' . $sortOpts . '</select></div>'
            . vgmr_facets_html($filters, $universe, $facets, $active, count($all))
            . '<button type="submit" class="vgm-btn vgm-btn--ghost vgm-btn--sm" data-vgm-filter-submit>Uygula</button>'
            . '<p class="vgm-filter__count" role="status">' . $total . ' ürün' . ($total > count($slice) ? ' · ' . $from . '–' . $to . ' gösteriliyor' : '') . '</p></form>'
            . vgmr_active_filters_html($id, $marka, $marka !== '' ? $brands[$marka]['name'] : '', $sirala, $active, $filters);
        if ($slice) {
            $main .= vgmr_grid_note() . vgmr_grid($slice, $ctx) . vgmr_pager($id, $marka, $sirala, $page, $pages, $active);
        } else {
            $main .= '<p class="vgm-empty">Seçtiğiniz süzgeçlerle eşleşen ürün yok. <a class="vgm-link" href="' . vgmr_category_url($id, '', $sirala, 1) . '">Süzgeçleri temizleyin</a> veya bize sorun.</p>';
        }
        $main .= '<p class="vgm-fine">' . vgmr_esc(VGMR_NOTE_RATE) . '. Fiyatlar Türk lirası ve KDV dahildir.</p></section>';
    } else {
        $main .= vgmr_empty_state('Bu kategoride ürünler hazırlanıyor', 'Bu kategorideki ürünleri çok yakında ekleyeceğiz. İhtiyacınız olan ürün için bizden teklif alabilirsiniz.');
    }
    $main .= vgmr_help_cta() . '<p class="vgm-back"><a class="vgm-link" href="/magaza/">&larr; Tüm kategoriler</a></p></div></main>';
    $ld = [vgmr_breadcrumb_ld($crumbs)];
    if ($slice) {
        $ld[] = vgmr_itemlist_ld($slice, $title, ($page - 1) * VGMR_PAGE_SIZE);
    }
    $base = VGMR_SITE . '/magaza/kategori/' . $id . '/';
    $canonical = $filtered || $page === 1 ? $base : $base . '?sayfa=' . $page;
    $links = [];
    if ($page > 1) {
        $links[] = ['prev', VGMR_SITE . html_entity_decode(vgmr_category_url($id, $marka, $sirala, $page - 1, $active), ENT_QUOTES)];
    }
    if ($page < $pages) {
        $links[] = ['next', VGMR_SITE . html_entity_decode(vgmr_category_url($id, $marka, $sirala, $page + 1, $active), ENT_QUOTES)];
    }
    $desc = $intro !== '' ? vgmr_clip($intro, 150) : $title . ' – VoltGuard Mağaza.';
    $pageTitle = $title . ($marka !== '' ? ' – ' . $brands[$marka]['name'] : '') . ($page > 1 ? ' – Sayfa ' . $page : '');
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta([
        'title' => $pageTitle . ' | ' . VGMR_TITLE_SUFFIX, 'desc' => $desc, 'url' => $canonical, 'links' => $links,
        'robots' => $all && !$filtered ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow', 'ld' => $ld])];
}

/** Arama adresi (HTML'e hazir): parametre sirasi sabit q, kategori, marka, sayfa; varsayilanlar yazilmaz. */
function vgmr_search_url(string $q, string $kategori, string $marka, int $sayfa): string
{
    $parts = ['q=' . rawurlencode($q)];
    if ($kategori !== '') {
        $parts[] = 'kategori=' . rawurlencode($kategori);
    }
    if ($marka !== '') {
        $parts[] = 'marka=' . rawurlencode($marka);
    }
    if ($sayfa > 1) {
        $parts[] = 'sayfa=' . $sayfa;
    }
    return '/magaza/ara/?' . implode('&amp;', $parts);
}

/**
 * Arama: /magaza/ara/?q=&kategori=&marka=&sayfa= (noindex; P1-04/05). Sonuclar puan sirasiyla, sayfa basina 48; tum
 * terimleri iceren urun yoksa en yakin eslesmeler "Benzer sonuclar" olarak. Kategori cipleri sayimli; marka secimi isabetler
 * en cok VGMR_SEARCH_BRAND_CATS yaprak kategorideyse (yalnizca o liste dosyalari okunur). Gecersiz kategori/marka yok sayilir;
 * aralik disi sayfa 404. Gecersiz UTF-8 sorgu (Latin-5 ham bayt gibi) 400 ile yanitlanir (P1-14).
 */
function vgmr_render_search(array $ctx, string $q, array $get = []): array
{
    if (preg_match('//u', $q) !== 1) {
        return vgmr_render_message(400, 'Arama metni okunamadı', 'Arama metni geçerli bir karakter kodlamasında değil. Lütfen aramayı yeniden yazın veya kategorilere göz atın.');
    }
    $q = trim((string)preg_replace('/\s+/u', ' ', $q));
    if (strlen($q) > 160) {
        $q = '';
    }
    $q = vgmr_clip($q, 80);
    $str = function (string $k) use ($get): string {
        return isset($get[$k]) && is_string($get[$k]) ? $get[$k] : '';
    };
    $kategori = preg_match('/^[a-z0-9-]{2,60}$/D', $str('kategori')) === 1 ? $str('kategori') : '';
    $marka = preg_match('/^[a-z0-9-]{1,80}$/D', $str('marka')) === 1 ? $str('marka') : '';
    $sayfa = preg_match('/^[1-9][0-9]{0,5}$/D', $str('sayfa')) === 1 ? (int)$str('sayfa') : 1;
    $result = $q !== '' ? vgm_search($q, 0) : ['items' => [], 'total' => 0, 'mode' => 'and', 'all' => [], 'facets' => ['category' => []]];
    $all = $result['all'];

    // kategori daraltma: yaprak kategori ya da ust kategori (alt kategorileri dahil)
    $parentOf = [];
    $catCounts = [];   // gosterilen kategori => sayi (yaprak; ust kategori secildiyse o da)
    foreach ($result['facets']['category'] as $cat => $n) {
        $cc = vgm_category((string)$cat);
        if ($cc === null) {
            continue;
        }
        $catCounts[(string)$cat] = $n;
        $parentOf[(string)$cat] = $cc['parent'];
    }
    if ($kategori !== '' && !isset($catCounts[$kategori]) && !in_array($kategori, $parentOf, true)) {
        $kategori = '';
    }
    $hits = $all;
    if ($kategori !== '') {
        $hits = array_filter($all, function (string $cat) use ($kategori, $parentOf): bool {
            return $cat === $kategori || ($parentOf[$cat] ?? null) === $kategori;
        });
    }
    // marka: yalnizca az sayida yaprak kategoride (liste dosyalari okunur); kartlar burada bir kez yuklenir
    $brands = [];
    $cards = null;
    if ($hits && count(array_unique($hits)) <= VGMR_SEARCH_BRAND_CATS) {
        $cards = vgm_cards_for($hits);
        $slugOf = [];
        foreach ($cards as $cid => $card) {
            $b = trim(vgmr_str($card['brand'] ?? ''));
            $slug = $slugOf[$b] ?? ($slugOf[$b] = vgmr_slug($b));
            if ($slug === '') {
                continue;
            }
            $brands[$slug] = ['name' => $b, 'count' => ($brands[$slug]['count'] ?? 0) + 1];
        }
        uasort($brands, function (array $a, array $b): int {
            return strcmp(vgm_fold($a['name']), vgm_fold($b['name'])) ?: strcmp($a['name'], $b['name']);
        });
        if ($marka !== '' && isset($brands[$marka])) {
            $cards = array_filter($cards, function (array $card) use ($marka, $slugOf): bool {
                return ($slugOf[trim(vgmr_str($card['brand'] ?? ''))] ?? '') === $marka;
            });
            $hits = array_intersect_key($hits, $cards);
        }
    }
    if (!isset($brands[$marka])) {
        $marka = '';
    }
    $total = count($hits);
    $pages = max(1, (int)ceil($total / VGMR_PAGE_SIZE));
    if ($sayfa > $pages) {
        return vgmr_render_message(404, 'Sayfa bulunamadı', 'Arama sonuçlarında bu sayfa yok. Aramanın ilk sayfasından devam edebilirsiniz.');
    }
    $sliceIds = array_slice($hits, ($sayfa - 1) * VGMR_PAGE_SIZE, VGMR_PAGE_SIZE, true);
    $slice = [];
    foreach ($cards !== null ? $sliceIds : vgm_cards_for($sliceIds) as $sid => $v) {   // puan sirasi
        if ($cards === null) {
            $slice[] = $v;
        } elseif (isset($cards[(string)$sid])) {
            $slice[] = $cards[(string)$sid];
        }
    }

    $crumbs = [['Ana sayfa', '/'], ['Mağaza', '/magaza/'], ['Arama', '/magaza/ara/']];
    $main = '<main class="vgm vgm--search" id="main" tabindex="-1">' . "\n" . vgmr_bar($q) . "\n" . vgmr_banner($ctx) . "\n"
        . '<div class="vgm-wrap">' . vgmr_breadcrumb_html($crumbs)
        . '<header class="vgm-head"><p class="vgm-kicker">Mağazada ara</p><h1>' . ($q !== '' ? '“' . vgmr_esc($q) . '” için sonuçlar' : 'Ürün arayın') . '</h1></header>'
        . vgmr_search_form($q, 'vgm-search--page', 'page');
    if ($q === '') {
        $main .= '<p class="vgm-lead">Ürün adı, marka, model kodu ya da barkod (GTIN) ile arayabilirsiniz.</p>';
    } elseif (!$all) {
        $tops = '';
        foreach (vgm_categories() as $cid => $cc) {
            if ($cc['parent'] === null && $cc['count'] > 0) {
                $tops .= '<li><a class="vgm-subcat" href="/magaza/kategori/' . vgmr_esc((string)$cid) . '/">' . vgmr_esc(vgmr_cat_name($cc, (string)$cid)) . '</a></li>';
            }
        }
        $main .= '<section class="vgm-section"><p class="vgm-empty">Aramanızla eşleşen ürün bulunamadı. Farklı bir sözcük deneyin, kategorilere göz atın veya bize sorun.</p>'
            . '<p class="vgm-actions"><a class="vgm-btn vgm-btn--primary" href="' . vgmr_esc('/iletisim.html?konu=magaza&q=' . rawurlencode($q) . '#iletisim') . '">Bu modeli bulamadık, tedarik edelim</a></p>'
            . ($tops !== '' ? '<nav class="vgm-subcats" aria-label="Kategoriler" data-vgm-scroller><ul>' . $tops . '</ul></nav>' : '') . '</section>';
    } else {
        $main .= '<section class="vgm-section" aria-label="Arama sonuçları">';
        if ($result['mode'] === 'or') {
            $main .= '<h2 class="vgm-search__mode">Benzer sonuçlar</h2><p class="vgm-lead">Aradığınız terimlerin tümünü içeren ürün bulunamadı; en yakın eşleşmeler:</p>';
        }
        if (count($catCounts) > 1 || $kategori !== '') {
            arsort($catCounts);
            $chips = '<li><a class="vgm-subcat"' . ($kategori === '' ? ' aria-current="page"' : '') . ' href="' . vgmr_search_url($q, '', '', 1) . '">Tümü <span class="vgm-count">('
                . count($all) . ')</span></a></li>';
            /* Ust kategori secildiyse (yaprak ciplerde yok) etkin daraltmayi adlandiran bir cip: alt kategorilerinin toplami. */
            if ($kategori !== '' && !isset($catCounts[$kategori])) {
                $sum = 0;
                foreach ($catCounts as $cid => $n) {
                    $sum += ($parentOf[(string)$cid] ?? null) === $kategori ? (int)$n : 0;
                }
                $pc = vgm_category($kategori);
                $chips .= '<li><a class="vgm-subcat" aria-current="page" href="' . vgmr_search_url($q, $kategori, '', 1) . '">'
                    . vgmr_esc(vgmr_cat_name($pc ?? [], $kategori)) . ' <span class="vgm-count">(' . $sum . ')</span></a></li>';
            }
            foreach ($catCounts as $cid => $n) {
                $cc = vgm_category((string)$cid);
                $chips .= '<li><a class="vgm-subcat"' . ($kategori === (string)$cid ? ' aria-current="page"' : '') . ' href="' . vgmr_search_url($q, (string)$cid, '', 1) . '">'
                    . vgmr_esc(vgmr_cat_name($cc, (string)$cid)) . ' <span class="vgm-count">(' . $n . ')</span></a></li>';
            }
            $main .= '<nav class="vgm-subcats" aria-label="Kategoriye göre daralt" data-vgm-scroller><ul>' . $chips . '</ul></nav>';
        }
        $from = ($sayfa - 1) * VGMR_PAGE_SIZE + 1;
        $to = ($sayfa - 1) * VGMR_PAGE_SIZE + count($slice);
        $count = '<p class="vgm-filter__count" role="status">' . $total . ' ürün bulundu' . ($total > count($slice) ? ' · ' . $from . '–' . $to . ' gösteriliyor' : '') . '</p>';
        if (count($brands) > 1 || $marka !== '') {
            $opts = '<option value="">Tüm markalar (' . count($hits) . ')</option>';
            if ($marka !== '') {
                $opts = '<option value="">Tüm markalar</option>';
            }
            foreach ($brands as $slug => $b) {
                $opts .= '<option value="' . vgmr_esc((string)$slug) . '"' . ($slug === $marka ? ' selected' : '') . '>' . vgmr_esc($b['name']) . ' (' . $b['count'] . ')</option>';
            }
            $main .= '<form class="vgm-filter" action="/magaza/ara/" method="get" data-vgm-filter data-vgm-params="' . implode(',', VGMR_SEARCH_PARAMS) . '">'
                . '<input type="hidden" name="q" value="' . vgmr_esc($q) . '">'
                . ($kategori !== '' ? '<input type="hidden" name="kategori" value="' . vgmr_esc($kategori) . '">' : '')
                . '<div class="vgm-field"><label for="vgm-marka">Marka</label><select id="vgm-marka" name="marka">' . $opts . '</select></div>'
                . '<button type="submit" class="vgm-btn vgm-btn--ghost vgm-btn--sm" data-vgm-filter-submit>Uygula</button>' . $count . '</form>';
        } else {
            $main .= $count;
        }
        $main .= vgmr_grid_note() . vgmr_grid($slice, $ctx)
            . vgmr_pager_links(function (int $n) use ($q, $kategori, $marka): string {
                return vgmr_search_url($q, $kategori, $marka, $n);
            }, $sayfa, $pages) . '</section>';
    }
    $main .= vgmr_help_cta() . '<p class="vgm-back"><a class="vgm-link" href="/magaza/">&larr; Tüm kategoriler</a></p></div></main>';
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta([
        'title' => ($q !== '' ? $q . ' – Arama' : 'Ürün arama') . ($sayfa > 1 ? ' – Sayfa ' . $sayfa : '') . ' | ' . VGMR_TITLE_SUFFIX,
        'desc' => 'VoltGuard Mağaza ürün araması.', 'url' => VGMR_SITE . '/magaza/ara/', 'robots' => 'noindex, follow',
        'ld' => [vgmr_breadcrumb_ld($crumbs)]])];
}

function vgmr_doc_url($v): string
{
    return is_string($v) && preg_match('#^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^\s"<>\\\\]*)?$#D', $v) === 1 ? $v : '';
}

function vgmr_gallery(array $p, array $images): string
{
    if (!$images) {
        return '<div class="vgm-gallery"><div class="vgm-gallery__stage th-paper">' . vgmr_placeholder() . '</div></div>';
    }
    $h = '<div class="vgm-gallery" data-vgm-gallery><div class="vgm-gallery__stage th-paper">'
        . vgmr_img_tag($images[0], false, ' data-vgm-main fetchpriority="high" decoding="async"') . '</div>';
    if (count($images) > 1) {
        $h .= '<ul class="vgm-thumbs" aria-label="Ürün görselleri">';
        foreach ($images as $i => $im) {
            $h .= '<li><a class="vgm-thumb th-paper" href="' . vgmr_esc($im['src']) . '" data-vgm-thumb data-src="' . vgmr_esc($im['src']) . '"'
                . ' data-alt="' . vgmr_esc($im['alt']) . '" data-w="' . $im['w'] . '" data-h="' . $im['h'] . '"'
                . ($i === 0 ? ' aria-current="true"' : '') . ' aria-label="' . vgmr_esc('Görsel ' . ($i + 1) . ' / ' . count($images)) . '">'
                . vgmr_img_tag($im, true, ' loading="lazy" decoding="async"') . '</a></li>';
        }
        $h .= '</ul>';
    }
    return $h . '<p class="vgm-fine vgm-gallery__note">Görseller temsilidir; ürünün marka ve modeli ürün bilgilerinde belirtilen şekildedir.</p></div>';
}

/** Stok ve termin satirlari (P1-10): tedarikci stogu (son kontrol) ve tahmini kargoya verilis. */
function vgmr_stock_html(array $p, array $price): string
{
    $days = vgmr_delivery_days($p);
    $checked = $price['checkedAt'] !== null ? ' (son kontrol: <time datetime="' . vgmr_esc(vg_iso((int)$price['checkedAt'])) . '">' . vgmr_esc(vgm_local((int)$price['checkedAt'])) . '</time>)' : '';
    if ($price['reason'] === 'unavailable') {
        $stock = '<strong>Tedarikçi stoğu: yok</strong>' . $checked;
    } elseif ($price['basis'] === 'live' && in_array($price['reason'], ['ok', 'closed'], true)) {
        $stock = '<strong>Tedarikçi stoğu: var</strong>' . $checked;
    } else {
        $stock = 'Stok durumu siparişte teyit edilir' . $checked;
    }
    $term = $price['reason'] === 'freight'
        ? 'Nakliye ve termin il bazında teklifle bildirilir'
        : 'Tahmini kargoya veriliş: ' . ($days > 0 ? vgmr_days_label($days) . ' gün' : 'en geç 30 gün') . ' (ödeme sonrası)';
    return '<ul class="vgm-stock" aria-label="Stok ve termin"><li>' . $stock . '</li><li>' . $term . '</li></ul>';
}

/**
 * Teklif baglantisi: iletisim formuna yapilandirilmis talep tasir (js/magaza.js onQuote; P1-12). JS/oturum deposu olmadan da
 * adres konuyu ve urunu secer (iletisim.html: ?konu=magaza&urun=<id>&niyet=<intent>).
 */
function vgmr_quote_link(array $p, string $label, string $class, string $intent = 'teklif'): string
{
    $href = '/iletisim.html?konu=magaza&urun=' . rawurlencode((string)$p['id']) . '&niyet=' . rawurlencode($intent) . '#iletisim';
    return '<a class="' . $class . '" href="' . vgmr_esc($href) . '" data-vgm-quote data-id="' . vgmr_esc((string)$p['id']) . '" data-name="' . vgmr_esc((string)$p['name'])
        . '" data-model="' . vgmr_esc(trim(vgmr_str($p['mpn'] ?? ''))) . '" data-url="' . vgmr_esc('/magaza/urun/' . $p['slug'] . '/') . '" data-intent="' . vgmr_esc($intent) . '">' . vgmr_esc($label) . '</a>';
}

/** Urun sayfasi bilgi kutusu: siparis verilemeyen urunun kisa nedeni (sepet once; "teklif isteyin" cagrisi ayrica yazilir). */
const VGMR_BUY_REASON = [
    'closed' => 'Mağazamız çok yakında siparişe açılacak.',
    'stale' => 'Fiyat teyidi bekleniyor; sipariş için fiyatın yeniden doğrulanması gerekir.',
    'held' => 'Tedarik fiyatı değişti; ekibimiz kontrol ediyor.',
    'error' => 'Fiyat şu anda doğrulanamadı.',
    'unavailable' => 'Tedarik stoğunda yok; benzer ürün veya termin önerebiliriz.',
    'no_rate' => 'Döviz kuru güncelleniyor.',
    'no_source' => 'Bu ürünün fiyatı teklifle bildirilir.',
    'freight' => 'Ağır/hacimli ürün; nakliye dahil fiyat teklifle bildirilir.',
];

function vgmr_buy_box(array $p, array $price, array $ctx): string
{
    $q = vgmr_qty_rules($p);
    $unit = vgmr_unit($p);
    $reason = (string)$price['reason'];
    $h = '<div class="vgm-buy" id="satin-al">' . vgmr_price_html($price, true, $p);
    $qty = '<div class="vgm-qty"><label for="vgm-qty">' . vgmr_esc($unit[1]) . '</label><input id="vgm-qty" type="number" inputmode="numeric" min="' . $q['min'] . '" max="' . $q['max']
        . '" step="' . $q['step'] . '" value="' . $q['min'] . '" data-vgm-qty></div>';
    $rules = [];
    if ($q['min'] > 1) {
        $rules[] = 'en az ' . $q['min'] . ' ' . $unit[3];
    }
    if ($q['step'] > 1) {
        $rules[] = $q['step'] . ' ' . $unit[3] . ' katlarında';
    }
    if ($q['pack'] > 1) {
        $rules[] = 'paket: ' . $q['pack'] . ' ' . $unit[3];
    }
    $unitNote = $unit[0] !== 'adet' ? ucfirst($unit[0]) . ' ile satılır' . ($rules ? ' (' . implode(', ', $rules) . ')' : '') . '.' : ($rules ? 'Sipariş adedi: ' . implode(', ', $rules) . '.' : '');
    $add = '<button type="button" class="vgm-btn vgm-btn--primary" data-vgm-add="' . vgmr_esc((string)$p['id']) . '" data-max="' . $q['max'] . '" data-min="' . $q['min'] . '" data-step="' . $q['step']
        . '" data-unit="' . vgmr_esc($unit[0]) . '" data-orderable="' . ($price['orderable'] ? '1' : '0') . '">Sepete ekle</button>';
    $live = '<p class="vgm-buy__live" role="status" aria-live="polite" data-vgm-live></p>'
        . '<noscript><p class="vgm-fine">Sepet için tarayıcınızda JavaScript açık olmalıdır. Sipariş veya teklif için <a href="' . VGMR_CONTACT . '">bize yazabilirsiniz</a>.</p></noscript>';
    if ($price['orderable']) {
        $h .= '<div class="vgm-buy__row">' . $qty . $add . '</div>' . $live
            . vgmr_stock_html($p, $price)
            . '<ul class="vgm-facts"><li>Ödeme yalnızca havale/EFT ile alınır.</li><li>Faturalı satış; fiyata KDV dahildir.</li>'
            . ($unitNote !== '' ? '<li>' . vgmr_esc($unitNote) . '</li>' : '')
            . '<li>En fazla ' . $q['max'] . ' ' . vgmr_esc($unit[3]) . ' sipariş verilebilir; daha fazlası için ' . vgmr_quote_link($p, 'proforma isteyin', 'vgm-link', 'proforma') . '.</li></ul>';
    } else {
        /* Sepet once (2026-11-02): siparis verilemeyen urun de sepete eklenir; sepet tek seferde teklif olarak gonderilir.
           Tek urunluk teklif baglantisi ikincil kalir (nedene gore: alternatif, nakliye, haber ver). */
        $h .= '<div class="vgm-notice vgm-notice--info" role="note"><strong>Şu anda çevrim içi sipariş verilemiyor.</strong> '
            . vgmr_esc((VGMR_BUY_REASON[$reason] ?? VGMR_BUY_REASON['error']) . ' Ürünü sepete ekleyin; sepetinizdeki tüm ürünler için tek seferde teklif isteyebilirsiniz.') . '</div>'
            . '<div class="vgm-buy__row">' . $qty . $add . '</div>' . $live;
        $alt = [];
        if ($reason === 'unavailable') {
            $alt[] = vgmr_quote_link($p, 'Alternatif ürün önerin', 'vgm-link', 'alternatif');
        } elseif ($reason === 'freight') {
            $alt[] = vgmr_quote_link($p, 'Yalnızca bu ürün için nakliye dahil teklif alın', 'vgm-link', 'nakliye');
        } else {
            $alt[] = vgmr_quote_link($p, 'Yalnızca bu ürün için teklif isteyin', 'vgm-link', 'teklif');
        }
        if ($reason === 'closed') {
            $alt[] = vgmr_quote_link($p, 'Siparişe açılınca haber verin', 'vgm-link', 'haber');
        }
        $h .= '<p class="vgm-buy__alt">' . implode('<span aria-hidden="true"> · </span>', $alt) . '</p>';
        $h .= vgmr_stock_html($p, $price);
        if ($unitNote !== '') {
            $h .= '<p class="vgm-fine">' . vgmr_esc($unitNote) . '</p>';
        }
    }
    return $h . '<p class="vgm-buy__ask"><a class="vgm-link" href="/sor.html">Mühendisimize sorun</a></p></div>';
}

/** Dar ekranda alt kenara yapisan fiyat + eylem seridi (#satin-al gorunumden cikinca js/magaza.js gosterir; P1-07). */
function vgmr_sticky_buy(array $p, array $price): string
{
    $unit = vgmr_unit($p);
    $display = vgmr_display_of($price);
    $amount = $display !== null
        ? '<span class="vgm-sticky__amount">' . vgmr_esc(vgm_fmt_try((float)$price['tryGross'])) . ($unit[2] !== '' ? ' <small>' . vgmr_esc($unit[2]) . '</small>' : '') . '</span><small class="vgm-sticky__vat">KDV dahil'
            . ($display === 'list' ? ' · liste fiyatı' : ($display === 'last' ? ' · son doğrulanan' : '')) . '</small>'
        : '<span class="vgm-sticky__amount vgm-sticky__amount--none">Fiyat için teklif</span>';
    $label = 'Sepete ekle';
    return '<div class="vgm-sticky" data-vgm-sticky hidden><div class="vgm-wrap vgm-sticky__in"><p class="vgm-sticky__price">' . $amount . '</p>'
        . '<a class="vgm-btn vgm-btn--primary vgm-btn--sm" href="#satin-al" data-vgm-sticky-go>' . vgmr_esc($label) . '</a></div></div>';
}

/** Ilgili urunler: katalogdaki related kimlikleri, eksikse ayni kategoriden (liste dosyasi; en cok 4). */
function vgmr_related(array $p): array
{
    $out = [];
    foreach (is_array($p['related'] ?? null) ? $p['related'] : [] as $rid) {
        $r = is_string($rid) ? vgm_product($rid) : null;
        if ($r !== null && $r['id'] !== $p['id'] && !isset($out[$r['id']])) {
            $out[$r['id']] = $r;
        }
        if (count($out) >= 4) {
            break;
        }
    }
    if (count($out) < 4) {
        $list = vgm_list_file((string)$p['category']);
        $at = 0;
        foreach ($list as $i => $card) {
            if ($card['id'] === $p['id']) {
                $at = $i;
                break;
            }
        }
        $n = count($list);
        for ($k = 1; $k < $n && count($out) < 4; $k++) {
            $r = $list[($at + $k) % $n];
            if ($r['id'] !== $p['id'] && !isset($out[$r['id']])) {
                $out[$r['id']] = $r;
            }
        }
    }
    return array_slice(array_values($out), 0, 4);
}

/** Urun: /magaza/urun/<slug>/ — bilinmeyen slug icin null. */
function vgmr_render_product(array $ctx, string $slug): ?array
{
    $p = vgm_product_by_slug($slug);
    if ($p === null) {
        return null;
    }
    $price = vgmr_price($p, $ctx);
    $cat = vgm_category((string)$p['category']) ?? [];
    $catName = vgmr_cat_name($cat, (string)$p['category']);
    $url = VGMR_SITE . '/magaza/urun/' . $p['slug'] . '/';
    $images = vgmr_images($p);
    $brand = trim(vgmr_str($p['brand'] ?? ''));
    $model = trim(vgmr_str($p['mpn'] ?? ''));
    $gtin = trim(vgmr_str($p['gtin'] ?? ''));
    $summary = trim(vgmr_str($p['summary'] ?? ''));
    $crumbs = array_merge([['Ana sayfa', '/'], ['Mağaza', '/magaza/']], vgmr_cat_crumbs((string)$p['category']),
        [[(string)$p['name'], '/magaza/urun/' . $p['slug'] . '/']]);

    $meta = [];
    if ($brand !== '') {
        $meta[] = '<span>Marka: <strong>' . vgmr_esc($brand) . '</strong></span>';
    }
    if ($model !== '') {
        $meta[] = '<span>Model: <strong>' . vgmr_esc($model) . '</strong></span>';
    }
    if ($gtin !== '') {
        $meta[] = '<span>GTIN: <strong>' . vgmr_esc($gtin) . '</strong></span>';
    }
    $head = '<header class="vgm-product__head"><p class="vgm-kicker"><a href="/magaza/kategori/' . vgmr_esc((string)$p['category']) . '/">' . vgmr_esc($catName) . '</a></p>'
        . '<h1>' . vgmr_esc((string)$p['name']) . '</h1>'
        . ($meta ? '<p class="vgm-meta">' . implode('', $meta) . '</p>' : '')
        . ($summary !== '' ? '<p class="vgm-summary">' . vgmr_esc($summary) . '</p>' : '') . '</header>';

    $details = '';
    $specs = [];
    foreach (is_array($p['specs'] ?? null) ? $p['specs'] : [] as $row) {
        if (is_array($row) && count($row) >= 2 && is_string($row[0]) && (is_string($row[1]) || is_numeric($row[1]))) {
            $specs[] = [$row[0], (string)$row[1]];
        }
    }
    if ($specs) {
        $rows = '';
        foreach ($specs as $s) {
            $rows .= '<tr><th scope="row">' . vgmr_esc($s[0]) . '</th><td>' . vgmr_esc($s[1]) . '</td></tr>';
        }
        $details .= '<section class="vgm-block" id="ozellikler" aria-labelledby="vgm-spec-h"><h2 id="vgm-spec-h">Teknik özellikler</h2>'
            . '<table class="vgm-specs"><tbody>' . $rows . '</tbody></table></section>';
    }
    $paras = '';
    foreach (is_array($p['description'] ?? null) ? $p['description'] : [] as $para) {
        if (is_string($para) && trim($para) !== '') {
            $paras .= '<p>' . vgmr_esc(trim($para)) . '</p>';
        }
    }
    if ($paras !== '') {
        $details .= '<section class="vgm-block" id="aciklama" aria-labelledby="vgm-desc-h"><h2 id="vgm-desc-h">Ürün açıklaması</h2>' . $paras . '</section>';
    }
    $docs = '';
    foreach (is_array($p['documents'] ?? null) ? $p['documents'] : [] as $d) {
        $du = is_array($d) ? vgmr_doc_url($d['url'] ?? null) : '';
        $dt = is_array($d) ? trim(vgmr_str($d['title'] ?? '')) : '';
        if ($du !== '' && $dt !== '') {
            $docs .= '<li><a href="' . vgmr_esc($du) . '" target="_blank" rel="noopener">' . vgmr_esc($dt) . '</a></li>';
        }
    }
    if ($docs !== '') {
        $details .= '<section class="vgm-block" id="belgeler" aria-labelledby="vgm-doc-h"><h2 id="vgm-doc-h">Üretici belgeleri</h2><ul class="vgm-docs">' . $docs . '</ul>'
            . '<p class="vgm-fine">Belgeler üreticinin kendi sayfasında açılır.</p></section>';
    }
    $details .= '<section class="vgm-block" id="teslimat-iade" aria-labelledby="vgm-ship-h"><h2 id="vgm-ship-h">Teslimat ve iade</h2>'
        . '<ul class="vgm-facts"><li><strong>Ödeme:</strong> Yalnızca havale/EFT. Siparişten sonra IBAN ve sipariş numaranız ekranda gösterilir ve e-postayla gönderilir.</li>'
        . '<li><strong>Teslimat:</strong> Siparişiniz ödemeniz hesabımıza geçtikten sonra hazırlanır ve kargoyla gönderilir. Ayrıntılar için '
        . '<a href="/magaza/odeme-ve-teslimat.html">ödeme ve teslimat</a> sayfasına bakın.</li>'
        . '<li><strong>İade ve cayma:</strong> Tüketici olarak yasal cayma hakkınız saklıdır; koşullar ve istisnalar '
        . '<a href="/magaza/iade-ve-cayma.html">iade ve cayma</a> sayfasındadır.</li></ul></section>';

    $related = vgmr_related($p);
    $relHtml = '';
    if ($related) {
        $relHtml = '<section class="vgm-section vgm-related" aria-labelledby="vgm-rel-h"><h2 id="vgm-rel-h">Benzer ürünler</h2>' . vgmr_grid_note() . '<ul class="vgm-grid">';
        foreach ($related as $r) {
            $relHtml .= vgmr_card($r, $ctx);
        }
        $relHtml .= '</ul></section>';
    }

    $main = '<main class="vgm vgm--product" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx) . "\n"
        . '<div class="vgm-wrap">' . vgmr_breadcrumb_html($crumbs)
        . '<article class="vgm-product">' . $head
        . '<div class="vgm-product__gallery">' . vgmr_gallery($p, $images) . '</div>'
        . '<div class="vgm-product__buy">' . vgmr_buy_box($p, $price, $ctx) . '</div>'
        . '<div class="vgm-product__details">' . $details . '</div></article>'
        . $relHtml . vgmr_help_cta() . '</div>' . vgmr_sticky_buy($p, $price) . '</main>';

    $ldProduct = ['@context' => 'https://schema.org', '@type' => 'Product', 'name' => (string)$p['name'], 'url' => $url, 'sku' => (string)$p['id'],
        'description' => $summary !== '' ? $summary : (string)$p['name'], 'category' => $catName];
    if ($images) {
        $ldProduct['image'] = array_map(function (array $im): string {
            return VGMR_SITE . $im['src'];
        }, $images);
    }
    if ($brand !== '') {
        $ldProduct['brand'] = ['@type' => 'Brand', 'name' => $brand];
    }
    if ($model !== '') {
        $ldProduct['mpn'] = $model;
    }
    if ($gtin !== '' && preg_match('/^[0-9]{8,14}$/D', $gtin) === 1) {
        $ldProduct['gtin'] = $gtin;
    }
    $priceStr = null;
    $validUntil = $ctx['now'] + 86400;
    if ($price['checkedAt'] !== null) {
        $validUntil = min($validUntil, (int)$price['checkedAt'] + 172800);
    }
    if ($price['tryGross'] !== null && in_array($price['reason'], ['ok', 'closed'], true) && $validUntil >= $ctx['now']) {
        $priceStr = number_format((float)$price['tryGross'], 2, '.', '');
        $offer = ['@type' => 'Offer', 'url' => $url, 'priceCurrency' => 'TRY', 'price' => $priceStr,
            'priceValidUntil' => vgm_local($validUntil, 'Y-m-d'), 'itemCondition' => 'https://schema.org/NewCondition',
            'seller' => ['@type' => 'Organization', 'name' => 'VoltGuard', 'url' => VGMR_SITE . '/']];
        $availability = vgmr_availability($price);
        if ($availability !== null) {
            $offer['availability'] = $availability;
        }
        $ldProduct['offers'] = $offer;
    }
    $descMeta = $summary !== '' ? vgmr_clip($summary, 150) : vgmr_clip((string)$p['name'] . ' – teknik özellikler, fiyat ve sipariş bilgisi.', 150);
    $m = ['title' => (string)$p['name'] . ' – Fiyat ve Özellikler | ' . VGMR_TITLE_SUFFIX, 'desc' => $descMeta, 'url' => $url, 'type' => 'product',
        'image' => $images ? VGMR_SITE . $images[0]['src'] : VGMR_SITE . '/public/og-image.png', 'ld' => [$ldProduct, vgmr_breadcrumb_ld($crumbs)]];
    if ($priceStr !== null) {
        $m['price'] = $priceStr;
    }
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta($m)];
}

/**
 * Odeme sayfasi: magaza/odeme.html statik sablonu, Turnstile site anahtari firma.json "turnstileSiteKey" alanindan
 * [data-vgm-sitekey] ogesine yazilarak sunulur (P1-03; .htaccess /magaza/odeme.html -> magaza/index.php). Anahtar yoksa
 * data-sitekey bos kalir ve js/magaza.js dogrulamayi gizler; sablonda yer tutucu metin bulunmaz.
 */
function vgmr_render_checkout_html(): string
{
    $file = dirname(__DIR__, 2) . '/magaza/odeme.html';
    $html = @file_get_contents($file);
    if (!is_string($html) || strpos($html, 'data-vgm-sitekey') === false) {
        throw new RuntimeException('magaza checkout template missing');
    }
    $firma = vgm_firma();
    $key = $firma['turnstileSiteKey'] ?? null;
    $key = is_string($key) && preg_match('/^[A-Za-z0-9_-]{10,80}$/D', $key) === 1 && strpos($key, 'REPLACE_WITH') !== 0 ? $key : '';
    $html = (string)preg_replace('/data-sitekey="[^"]*"(\s+data-vgm-sitekey)/', 'data-sitekey="' . vgmr_esc($key) . '"$1', $html, 1);
    /* Satici ve odeme bilgisi firma.json'dan (P1-13): yalnizca dolu alanlar; sablondaki statik metin yalnizca yedek. */
    $html = (string)preg_replace_callback('#<!--vgm:satici-->.*?<!--/vgm:satici-->#s', function () use ($firma): string {
        return "<!--vgm:satici-->\n" . vgmr_checkout_seller_html($firma) . "\n            <!--/vgm:satici-->";
    }, $html, 1);
    return (string)preg_replace_callback('#<!--vgm:satici-kisa-->.*?<!--/vgm:satici-kisa-->#s', function () use ($firma): string {
        return '<!--vgm:satici-kisa-->' . vgmr_seller_line_html($firma) . '<!--/vgm:satici-kisa-->';
    }, $html, 1);
}

function vgmr_firma_str(array $f, string $key): string
{
    return is_string($f[$key] ?? null) ? trim($f[$key]) : '';
}

/** IBAN maskesi: ilk ve son iki grup acik ("TR85 **** **** **** **** 9277 72"); tamami siparis sonrasi gosterilir. */
function vgmr_iban_mask(string $iban): string
{
    $g = preg_split('/\s+/', trim($iban), -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($g) || count($g) < 4) {
        return '';
    }
    $n = count($g);
    return $g[0] . ' ' . implode(' ', array_fill(0, $n - 3, '****')) . ' ' . $g[$n - 2] . ' ' . $g[$n - 1];
}

/**
 * Satici kimligi satirlari: [etiket, deger]; bos (null) alanlar atlanir, yer tutucu basilmaz (P1-01). $full: hukuki
 * sayfalardaki tam tablo (ticaret sicil, KEP, mudur, sermaye ve web sitesi de).
 */
function vgmr_seller_rows(array $f, bool $full = false): array
{
    $adres = vgmr_firma_str($f, 'adres') !== '' ? vgmr_firma_str($f, 'adres') : vgmr_firma_str($f, 'adresKisa');
    $vd = vgmr_firma_str($f, 'vergiDairesi');
    $vkn = vgmr_firma_str($f, 'vkn');
    $merkez = vgmr_firma_str($f, 'merkezAdres');
    /* Tescilli merkez isyerinden farkliysa ikisi ayri satirda (TTK md. 39/2; MSY md. 5/1-b,c); bildirim adresi isyeridir. */
    $addr = $merkez !== '' && $merkez !== $adres
        ? [['Merkez adresi (ticaret sicili)', $merkez], ['İşyeri ve bildirim adresi', $adres]] : [['Adres', $adres]];
    $rows = array_merge([['Unvan', vgmr_firma_str($f, 'unvan')]], $addr, [
        ['Vergi dairesi / no', $vd !== '' && $vkn !== '' ? $vd . ' / ' . $vkn : ($vkn !== '' ? $vkn : $vd)],
        ['MERSİS no', vgmr_firma_str($f, 'mersis')]]);
    if ($full) {
        $rows[] = ['Ticaret sicil no', vgmr_firma_str($f, 'ticaretSicil')];
        $rows[] = ['KEP adresi', vgmr_firma_str($f, 'kep')];
    }
    $rows[] = ['ETBİS', vgmr_firma_str($f, 'etbis')];
    if ($full) {
        $rows[] = ['Şirket müdürü', vgmr_firma_str($f, 'mudur')];
        $rows[] = ['Sermaye', vgmr_firma_str($f, 'sermaye')];
    }
    $rows[] = ['Telefon', vgmr_firma_str($f, 'telefon')];
    $rows[] = ['E-posta', vgmr_firma_str($f, 'eposta')];
    if ($full) {
        $rows[] = ['Web sitesi', vgmr_firma_str($f, 'web')];
    }
    return array_values(array_filter($rows, static fn(array $r): bool => $r[1] !== ''));
}

/** tel: adresi: "0545 …", "+90 545 …", "90545…" ve "545…" bicimlerinin hepsi +90545… olur. */
function vgmr_tel_href(string $phone): string
{
    $d = (string)preg_replace('/\D+/', '', $phone);
    $d = (string)preg_replace('/^(?:90|0)/', '', $d);
    return 'tel:+90' . $d;
}

/** Hukuki sayfalardaki satici tablosu (<dl>): firma.json'daki dolu alanlarin tamami; bos alan satiri basilmaz. */
function vgmr_legal_seller_dl(array $f): string
{
    $h = "<dl>\n";
    foreach (vgmr_seller_rows($f, true) as $r) {
        if ($r[0] === 'Telefon') {
            $v = '<a href="' . vgmr_esc(vgmr_tel_href($r[1])) . '">' . vgmr_esc($r[1]) . '</a>';
        } elseif ($r[0] === 'E-posta' || $r[0] === 'KEP adresi') {
            $v = '<a href="mailto:' . vgmr_esc($r[1]) . '">' . vgmr_esc($r[1]) . '</a>';
        } elseif ($r[0] === 'Web sitesi' && preg_match('#^https://[a-z0-9.-]+(?:/\S*)?$#iD', $r[1]) === 1) {
            $v = '<a href="' . vgmr_esc($r[1]) . '">' . vgmr_esc($r[1]) . '</a>';
        } else {
            $v = vgmr_esc($r[1]);
        }
        $h .= '            <dt>' . vgmr_esc($r[0]) . '</dt><dd>' . $v . "</dd>\n";
    }
    return $h . '          </dl>';
}

/** Hukuki belge alt bilgisi: firma.json belgeSurumu (YYYY-AA-GG) surum ve son guncelleme tarihi olarak (P1-02). */
function vgmr_legal_meta(array $f): ?string
{
    $v = vgmr_firma_str($f, 'belgeSurumu');
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $v, $m) !== 1 || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        return null;
    }
    return 'Belge sürümü: ' . $v . ' · Son güncelleme: ' . $m[3] . '.' . $m[2] . '.' . $m[1];
}

/**
 * Hukuki sayfa (magaza/<ad>.html, VGMR_LEGAL_PAGES): statik sablondaki <!--vgm:satici-dl--> ve <!--vgm:belge-meta-->
 * isaretleri firma.json'dan doldurulur (P1-01/P1-02); sablon metni yalnizca PHP'siz sunumda yedektir. Bilinmeyen ad: null.
 */
function vgmr_render_legal_html(string $name): ?string
{
    if (!in_array($name, VGMR_LEGAL_PAGES, true)) {
        return null;
    }
    $html = @file_get_contents(dirname(__DIR__, 2) . '/magaza/' . $name . '.html');
    if (!is_string($html) || strpos($html, '<!--vgm:satici-dl-->') === false) {
        throw new RuntimeException('magaza legal template missing');
    }
    $firma = vgm_firma();
    $html = (string)preg_replace_callback('#<!--vgm:satici-dl-->.*?<!--/vgm:satici-dl-->#s', function () use ($firma): string {
        return '<!--vgm:satici-dl-->' . vgmr_legal_seller_dl($firma) . '<!--/vgm:satici-dl-->';
    }, $html);
    $adres = vgmr_firma_str($firma, 'adres') !== '' ? vgmr_firma_str($firma, 'adres') : vgmr_firma_str($firma, 'adresKisa');
    if ($adres !== '') {   // ornek cayma formundaki bildirim adresi
        $html = (string)preg_replace_callback('#<!--vgm:adres-->.*?<!--/vgm:adres-->#s', function () use ($adres): string {
            return '<!--vgm:adres-->' . vgmr_esc($adres) . '<!--/vgm:adres-->';
        }, $html);
    }
    $meta = vgmr_legal_meta($firma);
    if ($meta !== null) {
        $html = (string)preg_replace_callback('#<!--vgm:belge-meta-->.*?<!--/vgm:belge-meta-->#s', function () use ($meta): string {
            return '<!--vgm:belge-meta-->' . vgmr_esc($meta) . '<!--/vgm:belge-meta-->';
        }, $html, 1);
    }
    return $html;
}

/** Odeme ozet kutusu: odeme sekli, hesap sahibi, maskeli IBAN ve kompakt satici blogu. */
function vgmr_checkout_seller_html(array $f): string
{
    $bank = is_array($f['banka'] ?? null) ? $f['banka'] : [];
    $bankName = is_string($bank['ad'] ?? null) ? trim($bank['ad']) : '';
    $holder = is_string($bank['hesapSahibi'] ?? null) ? trim($bank['hesapSahibi']) : '';
    $mask = vgmr_iban_mask(is_string($bank['iban'] ?? null) ? $bank['iban'] : '');
    $h = '<dl class="vgm-payinfo" aria-label="Ödeme bilgileri"><div><dt>Ödeme</dt><dd>Havale/EFT' . ($bankName !== '' ? ' · ' . vgmr_esc($bankName) : '')
        . ' · siparişten sonra 24 saat içinde</dd></div>'
        . ($holder !== '' ? '<div><dt>Hesap sahibi</dt><dd>' . vgmr_esc($holder) . '</dd></div>' : '')
        . ($mask !== '' ? '<div><dt>IBAN</dt><dd class="vgm-mono">' . vgmr_esc($mask) . ' <span class="vgm-payinfo__note">(tamamı sipariş sonrası)</span></dd></div>' : '')
        . '</dl>';
    $lines = [];
    foreach (vgmr_seller_rows($f) as $r) {
        if ($r[0] === 'Telefon') {
            $lines[] = '<a href="' . vgmr_esc(vgmr_tel_href($r[1])) . '">' . vgmr_esc($r[1]) . '</a>';
        } elseif ($r[0] === 'E-posta') {
            $lines[] = '<a href="mailto:' . vgmr_esc($r[1]) . '">' . vgmr_esc($r[1]) . '</a>';
        } else {
            $lines[] = ($r[0] === 'Unvan' || $r[0] === 'Adres' ? '' : vgmr_esc($r[0]) . ': ') . vgmr_esc($r[1]);
        }
    }
    return $h . '<section class="vgm-seller" aria-labelledby="vgm-seller-h"><h3 id="vgm-seller-h">Satıcı</h3><p>' . implode('<br>', $lines) . '</p>'
        . '<p class="vgm-fine"><a href="/magaza/odeme-ve-teslimat.html#satici">Satıcı bilgileri ve ödeme şartları</a></p></section>';
}

/** Basari ekranindaki tek satirlik satici bilgisi (fatura / tedarikci kaydi icin VKN, vergi dairesi, adres). */
function vgmr_seller_line_html(array $f): string
{
    $parts = [];
    foreach (vgmr_seller_rows($f) as $r) {
        $parts[] = ($r[0] === 'Unvan' || $r[0] === 'Adres' || $r[0] === 'Telefon' || $r[0] === 'E-posta' ? '' : $r[0] . ': ') . $r[1];
    }
    return '<strong>Satıcı:</strong> ' . vgmr_esc(implode(' · ', $parts)) . '.';
}

/** 404 / 503 sayfasi (noindex). */
function vgmr_render_message(int $status, string $title, string $text): array
{
    $main = '<main class="vgm vgm--message" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n"
        . '<div class="vgm-wrap"><section class="vgm-empty-state"><div class="vgm-empty-state__ico" aria-hidden="true">' . vgmr_cat_icon('') . '</div>'
        . '<h1>' . vgmr_esc($title) . '</h1><p>' . vgmr_esc($text) . '</p>'
        . '<p class="vgm-actions"><a class="vgm-btn vgm-btn--primary" href="/magaza/">Mağazaya dön</a>'
        . '<a class="vgm-btn vgm-btn--ghost" href="' . VGMR_CONTACT . '">Teklif isteyin</a>'
        . '<a class="vgm-link" href="/iletisim.html">İletişim</a></p></section></div></main>';
    return ['status' => $status, 'main' => $main, 'meta' => vgmr_meta([
        'title' => $title . ' | ' . VGMR_TITLE_SUFFIX, 'desc' => $text, 'url' => VGMR_SITE . '/magaza/', 'robots' => 'noindex, nofollow'])];
}

/* ------------------------------------------------------------------ site haritasi */

/** Site haritasi parca sayisi (vitrin + urunu olan kategoriler + urunler; parca basina en cok VGMR_SITEMAP_LIMIT adres). */
function vgmr_sitemap_parts(): int
{
    $cats = 0;
    foreach (vgm_categories() as $c) {
        if ($c['count'] > 0) {
            $cats++;
        }
    }
    return max(1, (int)ceil((1 + $cats + vgm_manifest()['products']) / VGMR_SITEMAP_LIMIT));
}

/** /magaza/sitemap.xml: site haritasi dizini (/magaza/sitemap-<n>.xml parcalari). */
function vgmr_sitemap_index(): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    $parts = vgmr_sitemap_parts();
    for ($n = 1; $n <= $parts; $n++) {
        $xml .= '  <sitemap><loc>' . vgmr_esc(VGMR_SITE . '/magaza/sitemap-' . $n . '.xml') . "</loc></sitemap>\n";
    }
    return $xml . "</sitemapindex>\n";
}

/** /magaza/sitemap-<n>.xml: n. parca; aralik disinda null (404). */
function vgmr_sitemap_part(int $n): ?string
{
    if ($n < 1 || $n > vgmr_sitemap_parts()) {
        return null;
    }
    $from = ($n - 1) * VGMR_SITEMAP_LIMIT;
    $to = $from + VGMR_SITEMAP_LIMIT;
    $i = 0;
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    $add = function (string $u) use (&$i, &$xml, $from, $to): bool {
        if ($i >= $from && $i < $to) {
            $xml .= '  <url><loc>' . vgmr_esc($u) . "</loc></url>\n";
        }
        $i++;
        return $i < $to;
    };
    $more = $add(VGMR_SITE . '/magaza/');
    foreach (vgm_categories() as $id => $c) {
        if ($more && $c['count'] > 0) {
            $more = $add(VGMR_SITE . '/magaza/kategori/' . $id . '/');
        }
    }
    if ($more) {
        foreach (vgm_all_cards() as $card) {
            if (!$add(VGMR_SITE . '/magaza/urun/' . $card['slug'] . '/')) {
                break;
            }
        }
    }
    return $xml . "</urlset>\n";
}
