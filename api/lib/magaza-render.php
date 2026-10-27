<?php
/*
 * VoltGuard Magaza sunucu tarafi sayfa uretimi (magaza/index.php). Sablon: magaza/index.html (tools/shell.py ile ortak
 * baslik/alt bilgi senkron tutulur); sablondaki <!--vgm:meta--> ve <!--vgm:main--> bolgeleri burada uretilen HTML ile
 * degistirilir. Fiyatlar istek aninda vgm_price() ile hesaplanir; musteriye YALNIZCA KDV dahil TL gosterilir (USD, maliyet,
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

/** Arama icin Turkce harfleri ASCII'ye indirger (istemci js/magaza.js ile ayni eslesme). */
function vgmr_fold(string $s): string
{
    $s = strtr($s, ['İ' => 'i', 'I' => 'i', 'ı' => 'i', 'Ç' => 'c', 'ç' => 'c', 'Ğ' => 'g', 'ğ' => 'g', 'Ö' => 'o', 'ö' => 'o',
        'Ş' => 's', 'ş' => 's', 'Ü' => 'u', 'ü' => 'u', 'Â' => 'a', 'â' => 'a', 'Î' => 'i', 'î' => 'i', 'Û' => 'u', 'û' => 'u']);
    return strtolower($s);
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

/** Istek anindaki yapilandirma, fiyat durumu ve kur (paylasimli kilit altinda tek okuma). */
function vgmr_context(int $now): array
{
    list($config, $state, $rate) = vgm_locked(false, function (string $dir): array {
        return [vgm_config($dir), vgm_prices_state($dir), vgm_rate_state($dir)];
    });
    return ['now' => $now, 'config' => $config, 'items' => is_array($state['items'] ?? null) ? $state['items'] : [],
        'rate' => $rate, 'open' => vgm_shop_open($config)];
}

function vgmr_price(array $p, array $ctx): array
{
    $s = $ctx['items'][$p['id']] ?? null;
    return vgm_price($p, is_array($s) ? $s : null, $ctx['rate'], $ctx['config'], $ctx['open'], $ctx['now']);
}

/** Durum rozeti: [css, etiket]. */
function vgmr_chip(array $price): array
{
    switch ($price['reason']) {
        case 'ok':
            return ['ok', 'Sipariş verilebilir'];
        case 'closed':
            return ['soon', 'Yakında siparişe açılıyor'];
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

/** Fiyat gosterilebilir mi: eskimis, bekletilen, hatali veya kursuz fiyat guncel fiyat gibi sunulmaz. */
function vgmr_price_visible(array $price): bool
{
    return $price['tryGross'] !== null && in_array($price['reason'], ['ok', 'closed', 'freight', 'unavailable'], true);
}

/** Fiyat gosterimi: yalnizca TL ve KDV dahil. $full: kontrol zamani ve kur notu da yazilir. */
function vgmr_price_html(array $price, bool $full): string
{
    if (!vgmr_price_visible($price)) {
        return '<p class="vgm-price vgm-price--none"><span class="vgm-price__ask">Güncel fiyat için teklif isteyin</span></p>';
    }
    $vat = (int)$price['vat'];
    $h = '<p class="vgm-price"><span class="vgm-price__amount">' . vgmr_esc(vgm_fmt_try((float)$price['tryGross'])) . '</span>'
        . ' <span class="vgm-price__vat">KDV dahil' . ($full ? ' (%' . $vat . ')' : '') . '</span></p>';
    if ($full) {
        if ($price['checkedAt'] !== null) {
            $h .= '<p class="vgm-price__meta">Fiyat güncelleme tarihi: <time datetime="' . vgmr_esc(vg_iso((int)$price['checkedAt'])) . '">'
                . vgmr_esc(vgm_local((int)$price['checkedAt'])) . '</time></p>';
        }
        $h .= '<p class="vgm-price__note">' . vgmr_esc(VGMR_NOTE_RATE) . '.</p>';
    }
    return $h;
}

/* ------------------------------------------------------------------ katalog yardimcilari */

/** Urunler: kategori sirasi, sonra ada gore. $category verilirse yalnizca o kategori. */
function vgmr_sorted_products(?string $category = null): array
{
    $c = vgm_catalog();
    $order = array_flip(array_keys($c['categories']));
    $list = [];
    foreach ($c['products'] as $p) {
        if ($category === null || $p['category'] === $category) {
            $list[] = $p;
        }
    }
    usort($list, function (array $a, array $b) use ($order): int {
        $byCat = ($order[$a['category']] ?? 999) <=> ($order[$b['category']] ?? 999);
        return $byCat !== 0 ? $byCat : strcmp(vgmr_fold((string)$a['name']), vgmr_fold((string)$b['name']));
    });
    return $list;
}

function vgmr_category_counts(): array
{
    $counts = [];
    foreach (vgm_catalog()['products'] as $p) {
        $counts[$p['category']] = ($counts[$p['category']] ?? 0) + 1;
    }
    return $counts;
}

function vgmr_img_path($v): string
{
    if (!is_string($v) || preg_match('#^/public/[A-Za-z0-9_./-]{1,200}$#D', $v) !== 1 || strpos($v, '..') !== false) {
        return '';
    }
    return $v;
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

/* ------------------------------------------------------------------ ortak bilesenler */

/** Yapiskan magaza cubugu: sepet baglantisi ve [data-vgm-cart-count] rozeti (js/magaza.js doldurur). */
function vgmr_bar(): string
{
    return '<div class="vgm-bar"><div class="vgm-wrap vgm-bar__in">'
        . '<nav class="vgm-bar__nav" aria-label="Mağaza menüsü">'
        . '<a class="vgm-bar__brand" href="/magaza/">Mağaza</a>'
        . '<a class="vgm-bar__opt" href="/magaza/siparis-takip.html">Sipariş takibi</a>'
        . '<a class="vgm-bar__opt" href="/magaza/odeme-ve-teslimat.html">Ödeme ve teslimat</a></nav>'
        . '<a class="vgm-bar__cart" href="/magaza/sepet.html" data-vgm-cart-link>'
        . '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
        . 'stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.4-1l2-6.4H6.1"/>'
        . '<circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>'
        . '<span class="vgm-bar__label">Sepet</span><span class="vgm-badge" data-vgm-cart-count hidden>0</span></a>'
        . '</div></div>';
}

function vgmr_banner(array $ctx): string
{
    if ($ctx['open']) {
        return '';
    }
    return '<div class="vgm-banner" role="status"><div class="vgm-wrap"><strong>' . vgmr_esc(VGMR_CLOSED) . '.</strong> '
        . 'Ürünleri ve fiyatları şimdiden inceleyebilir, güncel stok ve fiyat için teklif isteyebilirsiniz.</div></div>';
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

function vgmr_card(array $p, array $ctx, array $cats): string
{
    $price = vgmr_price($p, $ctx);
    $url = '/magaza/urun/' . $p['slug'] . '/';
    $images = vgmr_images($p);
    $chip = vgmr_chip($price);
    $catName = vgmr_cat_name($cats[$p['category']] ?? [], (string)$p['category']);
    $brand = trim(vgmr_str($p['brand'] ?? ''));
    $search = vgmr_fold(implode(' ', [$p['name'], $brand, vgmr_str($p['mpn'] ?? ''), $catName]));
    $dataPrice = vgmr_price_visible($price) ? number_format((float)$price['tryGross'], 2, '.', '') : '';
    $h = '<li class="vgm-card" data-vgm-card data-id="' . vgmr_esc((string)$p['id']) . '" data-category="' . vgmr_esc((string)$p['category']) . '"'
        . ' data-brand="' . vgmr_esc($brand) . '" data-name="' . vgmr_esc((string)$p['name']) . '" data-price="' . $dataPrice . '"'
        . ' data-search="' . vgmr_esc($search) . '">';
    $h .= '<a class="vgm-card__media th-paper" href="' . vgmr_esc($url) . '" tabindex="-1" aria-hidden="true">'
        . ($images ? vgmr_img_tag($images[0], true, ' loading="lazy" decoding="async"') : vgmr_placeholder()) . '</a>';
    $h .= '<div class="vgm-card__body">';
    if ($brand !== '') {
        $h .= '<p class="vgm-card__brand">' . vgmr_esc($brand) . '</p>';
    }
    $h .= '<h3 class="vgm-card__title"><a href="' . vgmr_esc($url) . '">' . vgmr_esc((string)$p['name']) . '</a></h3>';
    $summary = trim(vgmr_str($p['summary'] ?? ''));
    if ($summary !== '') {
        $h .= '<p class="vgm-card__sum">' . vgmr_esc(vgmr_clip($summary, 110)) . '</p>';
    }
    $h .= '<div class="vgm-card__foot">' . vgmr_price_html($price, false)
        . '<span class="vgm-chip vgm-chip--' . $chip[0] . '">' . vgmr_esc($chip[1]) . '</span></div>';
    return $h . '</div></li>';
}

function vgmr_grid(array $products, array $ctx): string
{
    $cats = vgm_catalog()['categories'];
    $h = '<ul class="vgm-grid" data-vgm-grid>';
    foreach (array_slice($products, 0, VGMR_LIST_LIMIT) as $p) {
        $h .= vgmr_card($p, $ctx, $cats);
    }
    return $h . '</ul>';
}

function vgmr_itemlist_ld(array $products, string $name): array
{
    $list = [];
    foreach (array_slice($products, 0, 50) as $i => $p) {
        $list[] = ['@type' => 'ListItem', 'position' => $i + 1, 'name' => (string)$p['name'], 'url' => VGMR_SITE . '/magaza/urun/' . $p['slug'] . '/'];
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

/** Vitrin: /magaza/ */
function vgmr_render_hub(array $ctx): array
{
    $products = vgmr_sorted_products();
    $cats = vgm_catalog()['categories'];
    $counts = vgmr_category_counts();
    $has = count($products) > 0;
    $main = '<main class="vgm vgm--hub" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx) . "\n"
        . '<header class="vgm-hero"><div class="vgm-wrap">'
        . '<p class="vgm-kicker">VoltGuard Mağaza</p>'
        . '<h1>Elektrik ve güneş enerjisi ürünleri</h1>'
        . '<p class="vgm-lead">Güneş paneli, inverter, enerji depolama, koruma ve ölçü cihazlarını tek yerde inceleyin. Fiyatlar Türk lirası ve KDV dahil '
        . 'gösterilir; ödeme havale/EFT ile yapılır, satış faturalıdır. Seçim yaparken mühendislerimize danışabilirsiniz.</p>'
        . vgmr_trust() . '</div></header>' . "\n" . '<div class="vgm-wrap">';
    if (!$has) {
        $main .= vgmr_empty_state('Ürünler hazırlanıyor', 'Mağazamızın ürün kataloğunu hazırlıyoruz; güneş enerjisi ve elektrik ürünleri çok yakında burada olacak. '
            . 'Bu sırada ihtiyacınız olan ürün veya proje için bizden teklif alabilirsiniz.');
    } else {
        $tiles = '';
        foreach ($cats as $id => $c) {
            if (empty($counts[$id])) {
                continue;
            }
            $tiles .= '<li><a class="vgm-cat" href="/magaza/kategori/' . vgmr_esc((string)$id) . '/">' . vgmr_cat_icon((string)$id)
                . '<span class="vgm-cat__name">' . vgmr_esc(vgmr_cat_name($c, (string)$id)) . '</span>'
                . '<span class="vgm-cat__count">' . (int)$counts[$id] . ' ürün</span></a></li>';
        }
        $main .= '<section class="vgm-section" aria-labelledby="vgm-cats-h"><h2 id="vgm-cats-h">Kategoriler</h2><ul class="vgm-cats">' . $tiles . '</ul></section>';
        $brands = [];
        foreach ($products as $p) {
            $b = trim(vgmr_str($p['brand'] ?? ''));
            if ($b !== '') {
                $brands[$b] = true;
            }
        }
        $brandNames = array_keys($brands);
        usort($brandNames, function ($a, $b): int {
            return strcmp(vgmr_fold((string)$a), vgmr_fold((string)$b));
        });
        $catOpts = '<option value="">Tüm kategoriler</option>';
        foreach ($cats as $id => $c) {
            if (!empty($counts[$id])) {
                $catOpts .= '<option value="' . vgmr_esc((string)$id) . '">' . vgmr_esc(vgmr_cat_name($c, (string)$id)) . '</option>';
            }
        }
        $brandOpts = '<option value="">Tüm markalar</option>';
        foreach ($brandNames as $b) {
            $brandOpts .= '<option value="' . vgmr_esc((string)$b) . '">' . vgmr_esc((string)$b) . '</option>';
        }
        $main .= '<section class="vgm-section" aria-labelledby="vgm-all-h"><h2 id="vgm-all-h">Tüm ürünler <span class="vgm-count">(' . count($products) . ')</span></h2>'
            . '<form class="vgm-tools" data-vgm-tools hidden role="search" aria-label="Ürünlerde ara ve filtrele" onsubmit="return false">'
            . '<div class="vgm-field vgm-field--grow"><label for="vgm-q">Ürün ara</label><input id="vgm-q" type="search" data-vgm-q placeholder="Ad, marka veya model" autocomplete="off" maxlength="80"></div>'
            . '<div class="vgm-field"><label for="vgm-cat">Kategori</label><select id="vgm-cat" data-vgm-cat>' . $catOpts . '</select></div>'
            . '<div class="vgm-field"><label for="vgm-brand">Marka</label><select id="vgm-brand" data-vgm-brand>' . $brandOpts . '</select></div>'
            . '<div class="vgm-field"><label for="vgm-sort">Sırala</label><select id="vgm-sort" data-vgm-sort>'
            . '<option value="">Önerilen sıra</option><option value="price-asc">Fiyat (artan)</option><option value="price-desc">Fiyat (azalan)</option>'
            . '<option value="name">Ada göre (A-Z)</option></select></div>'
            . '<p class="vgm-tools__count" role="status" aria-live="polite" data-vgm-count></p></form>'
            . vgmr_grid($products, $ctx)
            . '<p class="vgm-empty" data-vgm-empty hidden>Aramanızla eşleşen ürün bulunamadı. Filtreleri değiştirin veya bize sorun.</p>'
            . '<p class="vgm-fine">' . vgmr_esc(VGMR_NOTE_RATE) . '. Her ürünün fiyat kontrol zamanı ürün sayfasında yer alır.</p></section>';
    }
    $main .= vgmr_help_cta() . '</div></main>';
    $ld = [vgmr_breadcrumb_ld([['Ana sayfa', '/'], ['Mağaza', '/magaza/']])];
    if ($has) {
        $ld[] = vgmr_itemlist_ld($products, 'VoltGuard Mağaza ürünleri');
    }
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta([
        'title' => 'VoltGuard Mağaza – Güneş Enerjisi ve Elektrik Ürünleri',
        'desc' => 'VoltGuard Mağaza: güneş paneli, inverter, enerji depolama ve elektrik malzemeleri. Türk lirası ve KDV dahil fiyatlar her gün güncellenir; havale/EFT ile ödeme, faturalı satış.',
        'url' => VGMR_SITE . '/magaza/', 'robots' => $has ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow', 'ld' => $ld])];
}

/** Kategori: /magaza/kategori/<id>/ — bilinmeyen kategori icin null. */
function vgmr_render_category(array $ctx, string $id): ?array
{
    $c = vgm_category($id);
    if ($c === null) {
        return null;
    }
    $products = vgmr_sorted_products($id);
    $name = vgmr_cat_name($c, $id);
    $title = is_string($c['title'] ?? null) && $c['title'] !== '' ? $c['title'] : $name;
    $intro = trim(vgmr_str($c['intro'] ?? ''));
    $crumbs = [['Ana sayfa', '/'], ['Mağaza', '/magaza/'], [$name, '/magaza/kategori/' . $id . '/']];
    $main = '<main class="vgm vgm--category" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx) . "\n"
        . '<div class="vgm-wrap">' . vgmr_breadcrumb_html($crumbs)
        . '<header class="vgm-head"><p class="vgm-kicker">' . vgmr_esc($name) . '</p><h1>' . vgmr_esc($title) . '</h1>'
        . ($intro !== '' ? '<p class="vgm-lead">' . vgmr_esc($intro) . '</p>' : '') . '</header>';
    if ($products) {
        $main .= '<section class="vgm-section" aria-label="Ürünler">' . vgmr_grid($products, $ctx)
            . '<p class="vgm-fine">' . vgmr_esc(VGMR_NOTE_RATE) . '. Fiyatlar Türk lirası ve KDV dahildir.</p></section>';
    } else {
        $main .= vgmr_empty_state('Bu kategoride ürünler hazırlanıyor', 'Bu kategorideki ürünleri çok yakında ekleyeceğiz. İhtiyacınız olan ürün için bizden teklif alabilirsiniz.');
    }
    $main .= vgmr_help_cta() . '<p class="vgm-back"><a class="vgm-link" href="/magaza/">&larr; Tüm kategoriler</a></p></div></main>';
    $ld = [vgmr_breadcrumb_ld($crumbs)];
    if ($products) {
        $ld[] = vgmr_itemlist_ld($products, $title);
    }
    $desc = $intro !== '' ? vgmr_clip($intro, 150) : $title . ' – VoltGuard Mağaza.';
    return ['status' => 200, 'main' => $main, 'meta' => vgmr_meta([
        'title' => $title . ' | ' . VGMR_TITLE_SUFFIX, 'desc' => $desc, 'url' => VGMR_SITE . '/magaza/kategori/' . $id . '/',
        'robots' => $products ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow', 'ld' => $ld])];
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
    return $h . '</div>';
}

function vgmr_buy_box(array $p, array $price, array $ctx): string
{
    $max = (int)$p['maxQty'];
    $h = '<div class="vgm-buy" id="satin-al">' . vgmr_price_html($price, true);
    $qty = '<div class="vgm-qty"><label for="vgm-qty">Adet</label><input id="vgm-qty" type="number" inputmode="numeric" min="1" max="' . $max
        . '" step="1" value="1" data-vgm-qty></div>';
    $model = trim(vgmr_str($p['mpn'] ?? ''));
    if ($price['orderable']) {
        $h .= '<div class="vgm-buy__row">' . $qty
            . '<button type="button" class="vgm-btn vgm-btn--primary" data-vgm-add="' . vgmr_esc((string)$p['id']) . '" data-max="' . $max . '">Sepete ekle</button></div>'
            . '<p class="vgm-buy__live" role="status" aria-live="polite" data-vgm-live></p>'
            . '<noscript><p class="vgm-fine">Sepet için tarayıcınızda JavaScript açık olmalıdır. Sipariş için <a href="' . VGMR_CONTACT . '">bize yazabilirsiniz</a>.</p></noscript>'
            . '<ul class="vgm-facts"><li>Ödeme yalnızca havale/EFT ile alınır.</li><li>Faturalı satış; fiyata KDV dahildir.</li>'
            . '<li>En fazla ' . $max . ' ' . vgmr_esc((string)($p['unit'] ?? 'adet')) . ' sipariş verilebilir; fazlası için teklif isteyin.</li></ul>';
    } else {
        $h .= '<div class="vgm-notice vgm-notice--info" role="note"><strong>Şu anda çevrim içi sipariş verilemiyor.</strong> '
            . vgmr_esc(vgm_reason_text((string)$price['reason'])) . '</div>'
            . '<div class="vgm-buy__row">' . $qty
            . '<a class="vgm-btn vgm-btn--primary" href="' . VGMR_CONTACT . '" data-vgm-quote data-name="' . vgmr_esc((string)$p['name']) . '" data-model="' . vgmr_esc($model) . '">Teklif isteyin</a></div>';
    }
    return $h . '<p class="vgm-buy__ask"><a class="vgm-link" href="/sor.html">Mühendisimize sorun</a></p></div>';
}

/** Ilgili urunler: katalogdaki related kimlikleri, eksikse ayni kategoriden (en cok 4). */
function vgmr_related(array $p): array
{
    $out = [];
    foreach (is_array($p['related'] ?? null) ? $p['related'] : [] as $rid) {
        $r = is_string($rid) ? vgm_product($rid) : null;
        if ($r !== null && $r['id'] !== $p['id'] && !isset($out[$r['id']])) {
            $out[$r['id']] = $r;
        }
    }
    if (count($out) < 4) {
        foreach (vgmr_sorted_products((string)$p['category']) as $r) {
            if ($r['id'] !== $p['id'] && !isset($out[$r['id']])) {
                $out[$r['id']] = $r;
            }
            if (count($out) >= 4) {
                break;
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
    $cats = vgm_catalog()['categories'];
    $cat = $cats[$p['category']] ?? [];
    $catName = vgmr_cat_name($cat, (string)$p['category']);
    $url = VGMR_SITE . '/magaza/urun/' . $p['slug'] . '/';
    $images = vgmr_images($p);
    $brand = trim(vgmr_str($p['brand'] ?? ''));
    $model = trim(vgmr_str($p['mpn'] ?? ''));
    $gtin = trim(vgmr_str($p['gtin'] ?? ''));
    $summary = trim(vgmr_str($p['summary'] ?? ''));
    $crumbs = [['Ana sayfa', '/'], ['Mağaza', '/magaza/'], [$catName, '/magaza/kategori/' . $p['category'] . '/'],
        [(string)$p['name'], '/magaza/urun/' . $p['slug'] . '/']];

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
        $relHtml = '<section class="vgm-section vgm-related" aria-labelledby="vgm-rel-h"><h2 id="vgm-rel-h">Benzer ürünler</h2><ul class="vgm-grid">';
        foreach ($related as $r) {
            $relHtml .= vgmr_card($r, $ctx, $cats);
        }
        $relHtml .= '</ul></section>';
    }

    $main = '<main class="vgm vgm--product" id="main" tabindex="-1">' . "\n" . vgmr_bar() . "\n" . vgmr_banner($ctx) . "\n"
        . '<div class="vgm-wrap">' . vgmr_breadcrumb_html($crumbs)
        . '<article class="vgm-product">' . $head
        . '<div class="vgm-product__gallery">' . vgmr_gallery($p, $images) . '</div>'
        . '<div class="vgm-product__buy">' . vgmr_buy_box($p, $price, $ctx) . '</div>'
        . '<div class="vgm-product__details">' . $details . '</div></article>'
        . $relHtml . vgmr_help_cta() . '</div></main>';

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

/** /magaza/sitemap.xml: vitrin, urunu olan kategoriler ve urunler. */
function vgmr_sitemap(): string
{
    $counts = vgmr_category_counts();
    $urls = [VGMR_SITE . '/magaza/'];
    foreach (vgm_catalog()['categories'] as $id => $c) {
        if (!empty($counts[$id])) {
            $urls[] = VGMR_SITE . '/magaza/kategori/' . $id . '/';
        }
    }
    foreach (vgmr_sorted_products() as $p) {
        $urls[] = VGMR_SITE . '/magaza/urun/' . $p['slug'] . '/';
    }
    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    foreach ($urls as $u) {
        $xml .= '  <url><loc>' . vgmr_esc($u) . "</loc></url>\n";
    }
    return $xml . "</urlset>\n";
}
