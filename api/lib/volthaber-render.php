<?php
/*
 * VoltHaber sunucu tarafi sayfa uretimi (volthaber/index.php). Sablon: volthaber/index.html (tools/shell.py ile ortak
 * baslik/alt bilgi senkron tutulur). Sablondaki <!--vh:meta--> ve <!--vh:main--> bolgeleri burada uretilen HTML ile
 * degistirilir. Tum degiskenler vh_esc ile kacislanir; govde HTML'i yalnizca sunucudaki sinirli Markdown ciktisidir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VH_SITE = 'https://voltguard.com.tr';
const VH_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function vh_tr_date(int $ts, bool $time = false): string
{
    try {
        $d = new DateTime('@' . $ts);
        $d->setTimezone(new DateTimeZone('Europe/Istanbul'));
        $s = (int)$d->format('j') . ' ' . VH_MONTHS[(int)$d->format('n') - 1] . ' ' . $d->format('Y');
        return $time ? $s . ', ' . $d->format('H:i') : $s;
    } catch (Throwable $e) {
        return gmdate('d.m.Y', $ts);
    }
}

function vh_ld(array $data): string
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE);
    return '  <script type="application/ld+json">' . ($json === false ? '{}' : $json) . "</script>\n";
}

function vh_template(): string
{
    $file = dirname(__DIR__, 2) . '/volthaber/index.html';
    $tpl = @file_get_contents($file);
    if (!is_string($tpl) || strpos($tpl, '<!--vh:meta-->') === false || strpos($tpl, '<!--vh:main-->') === false) {
        throw new RuntimeException('volthaber template missing');
    }
    return $tpl;
}

/** Sablondaki bolgeleri degistirir. */
function vh_page_html(string $meta, string $main): string
{
    $tpl = vh_template();
    $tpl = (string)preg_replace_callback('#<!--vh:meta-->.*?<!--/vh:meta-->#s', function () use ($meta) {
        return "<!--vh:meta-->\n" . $meta . "  <!--/vh:meta-->";
    }, $tpl, 1);
    $tpl = (string)preg_replace_callback('#<!--vh:main-->.*?<!--/vh:main-->#s', function () use ($main) {
        return "<!--vh:main-->\n" . $main . "\n  <!--/vh:main-->";
    }, $tpl, 1);
    return $tpl;
}

function vh_meta(array $m): string
{
    $title = $m['title'];
    $desc = $m['desc'];
    $url = $m['url'];
    $robots = $m['robots'] ?? 'index, follow, max-image-preview:large, max-snippet:-1';
    $img = $m['image'] ?? VH_SITE . '/public/og-image.png';
    $out = '  <title>' . vh_esc($title) . "</title>\n"
        . '  <meta name="description" content="' . vh_esc($desc) . "\">\n"
        . '  <meta name="robots" content="' . vh_esc($robots) . "\">\n"
        . '  <link rel="canonical" href="' . vh_esc($url) . "\">\n"
        . '  <link rel="alternate" type="application/rss+xml" title="VoltHaber" href="/volthaber/rss.xml">' . "\n"
        . '  <meta property="og:type" content="' . vh_esc($m['type'] ?? 'website') . "\">\n"
        . '  <meta property="og:title" content="' . vh_esc($m['ogTitle'] ?? $title) . "\">\n"
        . '  <meta property="og:description" content="' . vh_esc($desc) . "\">\n"
        . '  <meta property="og:url" content="' . vh_esc($url) . "\">\n"
        . '  <meta property="og:image" content="' . vh_esc($img) . "\">\n"
        . "  <meta property=\"og:site_name\" content=\"VoltGuard\">\n  <meta property=\"og:locale\" content=\"tr_TR\">\n"
        . "  <meta name=\"twitter:card\" content=\"summary_large_image\">\n";
    if (!empty($m['published'])) {
        $out .= '  <meta property="article:published_time" content="' . vh_esc($m['published']) . "\">\n"
            . '  <meta property="article:modified_time" content="' . vh_esc($m['modified']) . "\">\n"
            . '  <meta property="article:section" content="' . vh_esc($m['section']) . "\">\n";
    }
    foreach ($m['ld'] ?? [] as $ld) {
        $out .= vh_ld($ld);
    }
    return $out;
}

function vh_breadcrumb_ld(array $items): array
{
    $list = [];
    foreach ($items as $i => $it) {
        $list[] = ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $it[0], 'item' => VH_SITE . $it[1]];
    }
    return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $list];
}

function vh_breadcrumb_html(array $items): string
{
    $parts = [];
    $last = count($items) - 1;
    foreach ($items as $i => $it) {
        $parts[] = $i === $last ? '<span aria-current="page">' . vh_esc($it[0]) . '</span>' : '<a href="' . vh_esc($it[1]) . '">' . vh_esc($it[0]) . '</a>';
    }
    return '<nav class="breadcrumb vh-crumb" aria-label="breadcrumb">' . implode(' &rsaquo; ', $parts) . '</nav>';
}

/* ------------------------------------------------------------------ bilesenler */

function vh_type_badge(array $a): string
{
    $cls = ['analiz' => 'vh-badge--analiz', 'resmi' => 'vh-badge--resmi', 'kaynak' => 'vh-badge--kaynak'][$a['type']] ?? '';
    return '<span class="vh-badge ' . $cls . '">' . vh_esc(vh_types()[$a['type']] ?? '') . '</span>';
}

function vh_card(array $a, string $variant = ''): string
{
    $cats = vh_categories();
    $url = '/volthaber/' . $a['slug'] . '/';
    $ts = vh_live_at($a);
    $src = $a['type'] !== 'analiz' && $a['source'] && $a['source']['name'] !== '' ? ' · ' . vh_esc($a['source']['name']) : '';
    return '<article class="vh-card' . ($variant !== '' ? ' vh-card--' . $variant : '') . '">'
        . '<div class="vh-card__meta">' . vh_type_badge($a) . '<a class="vh-card__cat" href="/volthaber/kategori/' . vh_esc($a['category']) . '/">' . vh_esc($cats[$a['category']][0] ?? '') . '</a></div>'
        . '<h3 class="vh-card__title"><a href="' . vh_esc($url) . '">' . vh_esc($a['title']) . '</a></h3>'
        . ($variant !== 'compact' ? '<p class="vh-card__sum">' . vh_esc(vh_plain($a['summary'], $variant === 'hero' ? 320 : 190)) . '</p>' : '')
        . '<p class="vh-card__foot"><time datetime="' . vg_iso($ts) . '">' . vh_tr_date($ts) . '</time>' . $src . '</p>'
        . '</article>';
}

function vh_section(string $title, string $id, array $items, string $more = '', string $variant = ''): string
{
    if (!$items) {
        return '';
    }
    return '<section class="vh-sec" aria-labelledby="' . $id . '"><div class="vh-sec__head"><h2 id="' . $id . '">' . vh_esc($title) . '</h2>'
        . ($more !== '' ? '<a class="vh-more" href="' . vh_esc($more) . '">Tümü <span aria-hidden="true">&rarr;</span></a>' : '') . '</div>'
        . '<div class="vh-grid' . ($variant !== '' ? ' vh-grid--' . $variant : '') . '">' . implode('', array_map(function ($a) use ($variant) {
            return vh_card($a, $variant === 'list' ? 'compact' : '');
        }, $items)) . '</div></section>';
}

function vh_cat_nav(string $active = ''): string
{
    $out = '<nav class="vh-cats" aria-label="VoltHaber kategorileri"><a href="/volthaber/"' . ($active === '' ? ' aria-current="page"' : '') . '>Tümü</a>';
    foreach (vh_categories() as $id => $c) {
        $out .= '<a href="/volthaber/kategori/' . $id . '/"' . ($active === $id ? ' aria-current="page"' : '') . '>' . vh_esc($c[0]) . '</a>';
    }
    return $out . '</nav>';
}

function vh_search_form(string $q = ''): string
{
    return '<form class="vh-search" action="/volthaber/" method="get" role="search">'
        . '<label class="vg-sr-only vh-sr" for="vh-q">VoltHaber\'de ara</label>'
        . '<input id="vh-q" name="q" type="search" maxlength="80" value="' . vh_esc($q) . '" placeholder="Haber, yönetmelik veya konu ara…" autocomplete="off">'
        . '<button type="submit" class="btn btn--primary">Ara</button></form>';
}

function vh_newsletter(): string
{
    return '<section class="vh-news" aria-labelledby="vh-news-t"><h2 id="vh-news-t">VoltHaber bülteni</h2>'
        . '<p>Mevzuat değişiklikleri ve VoltGuard analizleri, ayda birkaç e-posta. İstediğiniz an tek tıkla ayrılabilirsiniz.</p>'
        . '<form class="vh-news__form" data-vh-subscribe method="post" novalidate>'
        . '<label for="vh-news-email">E-posta adresiniz</label>'
        . '<input id="vh-news-email" name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email">'
        . '<div class="vh-hp" aria-hidden="true"><label for="vh-news-web">Web sitesi</label><input id="vh-news-web" name="website" type="text" tabindex="-1" autocomplete="off"></div>'
        // KVK Kurulu 2026/347 ilke karari: aydinlatma ve acik riza ayri baslik ve ayri beyanla, alt alta sunulur.
        . '<div class="vh-legal"><h3 class="vh-legal__t">Aydınlatma</h3>'
        . '<p class="vh-legal__p">E-posta adresiniz, VoltGuard tarafından yalnızca bülteni göndermek için, aşağıda vereceğiniz açık rızaya dayanılarak işlenir; üçüncü kişilerle paylaşılmaz. Ayrıntılar ve haklarınız: <a href="/gizlilik.html#volthaber-bulten">VoltHaber bülteni aydınlatma metni</a>.</p></div>'
        . '<div class="vh-legal"><h3 class="vh-legal__t">Açık rıza</h3>'
        . '<label class="vh-consent"><input type="checkbox" name="consent" required> <span>VoltHaber bülteninin e-posta adresime gönderilmesine açık rıza veriyorum. Rızamı her e-postadaki bağlantıyla dilediğim zaman geri alabilirim.</span></label></div>'
        . '<button type="submit" class="btn btn--accent">Abone ol</button>'
        . '<p class="vh-news__msg" role="status" aria-live="polite"></p>'
        . '<noscript><p class="vh-news__msg">Abonelik formu için JavaScript gereklidir.</p></noscript>'
        . '</form></section>';
}

function vh_tools_block(string $cat = ''): string
{
    $links = vh_tool_links();
    if ($cat !== '') {
        $own = array_values(array_filter($links, function ($l) use ($cat) {
            return $l[2] === $cat;
        }));
        $links = $own ?: array_slice($links, 0, 4);
    }
    return '<section class="vh-tools" aria-labelledby="vh-tools-t"><h2 id="vh-tools-t">VoltSim simülasyonları ve hesap araçları</h2><ul>'
        . implode('', array_map(function ($l) {
            return '<li><a href="' . vh_esc($l[0]) . '">' . vh_esc($l[1]) . '</a></li>';
        }, $links)) . '</ul></section>';
}

function vh_most_read_block(array $items, array $views): string
{
    if (!$items) {
        return '';
    }
    $out = '<section class="vh-rank" aria-labelledby="vh-rank-t"><h2 id="vh-rank-t">En çok okunanlar</h2><ol>';
    foreach ($items as $a) {
        $out .= '<li><a href="/volthaber/' . vh_esc($a['slug']) . '/">' . vh_esc($a['title']) . '</a></li>';
    }
    return $out . '</ol></section>';
}

function vh_pagination(string $base, int $page, int $pages, string $extra = ''): string
{
    if ($pages <= 1) {
        return '';
    }
    $link = function (int $p) use ($base, $extra) {
        $q = $p > 1 ? 'sayfa=' . $p : '';
        $q = trim($q . ($extra !== '' ? ($q !== '' ? '&' : '') . $extra : ''), '&');
        return vh_esc($base . ($q !== '' ? '?' . $q : ''));
    };
    $out = '<nav class="vh-pager" aria-label="Sayfalar">';
    if ($page > 1) {
        $out .= '<a rel="prev" href="' . $link($page - 1) . '">&larr; Önceki</a>';
    }
    $out .= '<span>Sayfa ' . $page . ' / ' . $pages . '</span>';
    if ($page < $pages) {
        $out .= '<a rel="next" href="' . $link($page + 1) . '">Sonraki &rarr;</a>';
    }
    return $out . '</nav>';
}

function vh_share(string $url, string $title): string
{
    $u = rawurlencode($url);
    $t = rawurlencode($title);
    $links = [
        ['LinkedIn', 'https://www.linkedin.com/sharing/share-offsite/?url=' . $u, 'fab fa-linkedin-in'],
        ['WhatsApp', 'https://wa.me/?text=' . rawurlencode($title . ' ' . $url), 'fab fa-whatsapp'],
        ['X', 'https://twitter.com/intent/tweet?url=' . $u . '&text=' . $t, 'fab fa-x-twitter'],
        ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' . $u, 'fab fa-facebook-f'],
    ];
    $out = '<div class="vh-share" aria-label="Paylaş"><span class="vh-share__label">Paylaş:</span>';
    foreach ($links as $l) {
        $out .= '<a href="' . vh_esc($l[1]) . '" target="_blank" rel="noopener noreferrer nofollow">' . vh_esc($l[0]) . '</a>';
    }
    return $out . '<button type="button" class="vh-copy" data-vh-copy="' . vh_esc($url) . '">Bağlantıyı kopyala</button></div>';
}

function vh_shell_main(string $inner, string $crumb = ''): string
{
    return '  <main class="vh" id="main" tabindex="-1">' . $crumb . $inner . '</main>';
}

function vh_masthead(string $h1, string $lead, string $activeCat = '', string $q = ''): string
{
    return '<header class="vh-mast"><div class="vh-wrap"><p class="vh-mast__kicker"><span class="vh-logo">Volt<b>Haber</b></span> · VoltGuard sektör haberleri</p>'
        . '<h1>' . vh_esc($h1) . '</h1>' . ($lead !== '' ? '<p class="vh-mast__lead">' . vh_esc($lead) . '</p>' : '')
        . vh_search_form($q) . '</div></header><div class="vh-wrap">' . vh_cat_nav($activeCat) . '</div>';
}

/* ------------------------------------------------------------------ sayfalar */

function vh_render_home(array $state, array $views, int $page, string $q): array
{
    $now = vg_now();
    $live = vh_live_list($state, $now);
    $orgLd = ['@context' => 'https://schema.org', '@type' => 'CollectionPage', 'name' => 'VoltHaber', 'url' => VH_SITE . '/volthaber/',
        'inLanguage' => 'tr-TR', 'isPartOf' => ['@type' => 'WebSite', '@id' => VH_SITE . '/#website'],
        'publisher' => ['@type' => 'Organization', '@id' => VH_SITE . '/#organization', 'name' => 'VoltGuard']];
    $crumb = [['Ana Sayfa', '/'], ['VoltHaber', '/volthaber/']];
    if ($q !== '') {
        $hits = array_values(array_filter($live, function ($a) use ($q) {
            return vh_matches($a, ['q' => $q]);
        }));
        $p = vh_page($hits, $page);
        $body = vh_masthead('Arama: ' . $q, $p['total'] . ' sonuç bulundu.', '', $q)
            . '<div class="vh-wrap vh-cols"><div class="vh-col-main">'
            . ($p['items'] ? '<div class="vh-grid vh-grid--list">' . implode('', array_map('vh_card', $p['items'])) . '</div>' : '<p class="vh-empty">Aramanızla eşleşen yazı bulunamadı. Farklı bir ifade deneyin veya kategorilere göz atın.</p>')
            . vh_pagination('/volthaber/', $p['page'], $p['pages'], 'q=' . rawurlencode($q)) . '</div>'
            . '<aside class="vh-col-side">' . vh_newsletter() . '</aside></div>';
        return ['meta' => vh_meta(['title' => 'VoltHaber araması: ' . $q . ' | VoltGuard', 'desc' => 'VoltHaber arama sonuçları.', 'url' => VH_SITE . '/volthaber/', 'robots' => 'noindex, follow']),
            'main' => vh_shell_main($body)];
    }
    $p = vh_page($live, $page);
    if ($page > 1 && $page > $p['pages']) {
        return [];
    }
    $title = 'VoltHaber – Elektrik ve Enerji Sektörü Haberleri, Mevzuat ve Analizler' . ($page > 1 ? ' – Sayfa ' . $page : '') . ' | VoltGuard';
    $desc = 'Elektrik, enerji piyasası, GES/RES, şarj altyapısı ve iş güvenliği mevzuatındaki gelişmeler: Resmî Gazete özetleri, kaynaklı sektör haberleri ve VoltGuard mühendislerinin teknik analizleri.';
    $url = VH_SITE . '/volthaber/' . ($page > 1 ? '?sayfa=' . $page : '');
    $meta = vh_meta(['title' => $title, 'desc' => $desc, 'url' => $url, 'ld' => [$orgLd, vh_breadcrumb_ld($crumb)]]);
    $all = '<section class="vh-sec" aria-labelledby="vh-all"><div class="vh-sec__head"><h2 id="vh-all">' . ($page > 1 ? 'Tüm yazılar – sayfa ' . $page : 'Son yazılar') . '</h2></div>'
        . '<div class="vh-grid vh-grid--list">' . implode('', array_map('vh_card', $p['items'])) . '</div>'
        . vh_pagination('/volthaber/', $p['page'], $p['pages']) . '</section>';
    if ($page > 1) {
        $body = vh_masthead('VoltHaber', '', '') . '<div class="vh-wrap vh-cols"><div class="vh-col-main">' . $all . '</div><aside class="vh-col-side">'
            . vh_most_read_block(vh_most_read($live, $views, 5), $views) . vh_newsletter() . '</aside></div>';
        return ['meta' => $meta, 'main' => vh_shell_main($body)];
    }
    // Manset: isaretli yazi, yoksa en yeni analiz, yoksa en yeni yazi.
    $featured = null;
    foreach ($live as $a) {
        if ($a['featured']) {
            $featured = $a;
            break;
        }
    }
    if ($featured === null) {
        foreach ($live as $a) {
            if ($a['type'] === 'analiz') {
                $featured = $a;
                break;
            }
        }
    }
    $featured = $featured ?? ($live[0] ?? null);
    $notFeatured = function ($a) use ($featured) {
        return $featured === null || $a['id'] !== $featured['id'];
    };
    $latest = array_slice(array_values(array_filter($live, $notFeatured)), 0, 5);
    $resmi = array_slice(array_values(array_filter($live, function ($a) {
        return $a['type'] === 'resmi';
    })), 0, 4);
    $analiz = array_slice(array_values(array_filter($live, function ($a) use ($notFeatured) {
        return $a['type'] === 'analiz' && $notFeatured($a);
    })), 0, 4);
    $picks = array_slice(array_values(array_filter($live, function ($a) {
        return $a['pick'];
    })), 0, 4);
    $top = '';
    if ($featured !== null) {
        $top = '<div class="vh-top"><div class="vh-top__hero">' . vh_card($featured, 'hero') . '</div>'
            . '<div class="vh-top__latest"><h2 class="vh-mini-h">Bugün ve son eklenenler</h2>'
            . implode('', array_map(function ($a) {
                return vh_card($a, 'compact');
            }, $latest)) . '</div></div>';
    } else {
        $top = '<p class="vh-empty">Henüz yayımlanmış yazı yok.</p>';
    }
    $body = vh_masthead('Elektrik ve enerji sektöründen haberler, mevzuat özetleri ve teknik analizler',
            'Resmî kaynaklardan derlenen duyurular, kaynağı gösterilmiş sektör haberleri ve VoltGuard mühendislerinin özgün analizleri.')
        . '<div class="vh-wrap">' . $top . '</div>'
        . '<div class="vh-wrap vh-cols"><div class="vh-col-main">'
        . vh_section('Mevzuat ve resmî duyurular', 'vh-resmi', $resmi, '/volthaber/kategori/mevzuat/')
        . vh_section('VoltGuard analizleri', 'vh-analiz', $analiz)
        . vh_section('Editörün seçtikleri', 'vh-picks', $picks)
        . $all
        . '</div><aside class="vh-col-side">'
        . vh_most_read_block(vh_most_read($live, $views, 5), $views)
        . vh_newsletter() . vh_tools_block()
        . '<p class="vh-policy"><a href="/volthaber/yayin-ilkeleri.html">Yayın ve telif ilkelerimiz</a> · <a href="/volthaber/rss.xml">RSS</a></p>'
        . '</aside></div>';
    return ['meta' => $meta, 'main' => vh_shell_main($body)];
}

function vh_render_listing(array $state, array $views, string $kind, string $key, int $page): array
{
    $now = vg_now();
    $live = vh_live_list($state, $now);
    $cats = vh_categories();
    if ($kind === 'kategori') {
        if (!isset($cats[$key])) {
            return [];
        }
        $name = $cats[$key][0];
        $lead = $cats[$key][1];
        $list = array_values(array_filter($live, function ($a) use ($key) {
            return $a['category'] === $key;
        }));
    } else {
        $list = array_values(array_filter($live, function ($a) use ($key) {
            return in_array($key, $a['tags'], true);
        }));
        if (!$list) {
            return [];
        }
        $name = '#' . $key;
        $lead = '"' . $key . '" etiketli yazılar.';
    }
    $p = vh_page($list, $page);
    if ($page > 1 && $page > $p['pages']) {
        return [];
    }
    $path = '/volthaber/' . $kind . '/' . $key . '/';
    $crumb = [['Ana Sayfa', '/'], ['VoltHaber', '/volthaber/'], [$name, $path]];
    $meta = vh_meta([
        'title' => $name . ' – VoltHaber' . ($page > 1 ? ' – Sayfa ' . $page : '') . ' | VoltGuard',
        'desc' => $kind === 'kategori' ? $lead . ' VoltHaber\'de kaynaklı haberler ve VoltGuard analizleri.' : 'VoltHaber\'de ' . $key . ' etiketli haberler, mevzuat özetleri ve analizler.',
        'url' => VH_SITE . $path . ($page > 1 ? '?sayfa=' . $page : ''),
        // Bos kategori ve etiket sayfalari dizine eklenmez (ince icerik).
        'robots' => $p['total'] > 0 && $kind === 'kategori' ? 'index, follow' : 'noindex, follow',
        'ld' => [vh_breadcrumb_ld($crumb)],
    ]);
    $body = vh_masthead($name, $lead, $kind === 'kategori' ? $key : '')
        . '<div class="vh-wrap vh-cols"><div class="vh-col-main">'
        . ($p['items'] ? '<div class="vh-grid vh-grid--list">' . implode('', array_map('vh_card', $p['items'])) . '</div>' : '<p class="vh-empty">Bu kategoride henüz yayımlanmış yazı yok.</p>')
        . vh_pagination($path, $p['page'], $p['pages']) . '</div>'
        . '<aside class="vh-col-side">' . vh_newsletter() . vh_tools_block($kind === 'kategori' ? $key : '') . '</aside></div>';
    return ['meta' => $meta, 'main' => vh_shell_main($body, '<div class="vh-wrap">' . vh_breadcrumb_html($crumb) . '</div>')];
}

function vh_render_article(array $state, array $views, array $a): array
{
    $now = vg_now();
    $live = vh_live_list($state, $now);
    $cats = vh_categories();
    $catName = $cats[$a['category']][0] ?? '';
    $url = VH_SITE . '/volthaber/' . $a['slug'] . '/';
    $ts = vh_live_at($a);
    $crumb = [['Ana Sayfa', '/'], ['VoltHaber', '/volthaber/'], [$catName, '/volthaber/kategori/' . $a['category'] . '/'], [$a['title'], '/volthaber/' . $a['slug'] . '/']];
    $desc = $a['seo']['description'] !== '' ? $a['seo']['description'] : vh_plain($a['summary'], 165);
    $img = $a['image'] ? (strpos($a['image']['url'], '/') === 0 ? VH_SITE . $a['image']['url'] : $a['image']['url']) : VH_SITE . '/public/og-image.png';
    $authorName = $a['author']['name'] !== '' ? $a['author']['name'] : 'VoltGuard';
    $articleLd = [
        '@context' => 'https://schema.org', '@type' => 'Article', '@id' => $url . '#article',
        'headline' => vg_substr($a['title'], 110), 'description' => $desc, 'inLanguage' => 'tr-TR', 'image' => $img,
        'datePublished' => vg_iso($ts), 'dateModified' => vg_iso(max($ts, $a['updatedAt'])), 'articleSection' => $catName,
        'keywords' => implode(', ', $a['tags']), 'mainEntityOfPage' => $url,
        'author' => $a['author']['id'] === null ? ['@type' => 'Organization', 'name' => $authorName, 'url' => VH_SITE . '/'] : ['@type' => 'Person', 'name' => $authorName],
        'publisher' => ['@type' => 'Organization', '@id' => VH_SITE . '/#organization', 'name' => 'VoltGuard', 'logo' => ['@type' => 'ImageObject', 'url' => VH_SITE . '/public/voltguard-logo.webp']],
        'isPartOf' => ['@type' => 'WebSite', '@id' => VH_SITE . '/#website'],
    ];
    if ($a['source'] && $a['source']['url'] !== '') {
        $articleLd['isBasedOn'] = $a['source']['url'];
    }
    $meta = vh_meta(['title' => ($a['seo']['title'] !== '' ? $a['seo']['title'] : $a['title']) . ' | VoltHaber', 'ogTitle' => $a['title'], 'desc' => $desc, 'url' => $url, 'type' => 'article', 'image' => $img,
        'published' => vg_iso($ts), 'modified' => vg_iso(max($ts, $a['updatedAt'])), 'section' => $catName, 'ld' => [$articleLd, vh_breadcrumb_ld($crumb)]]);

    $byline = '<p class="vh-byline"><time datetime="' . vg_iso($ts) . '">' . vh_tr_date($ts, true) . '</time>'
        . ' · Hazırlayan: ' . vh_esc($authorName)
        . ($a['editor'] && $a['editor']['name'] !== '' && $a['editor']['name'] !== $authorName ? ' · Editör: ' . vh_esc($a['editor']['name']) : '')
        . ($a['updatedAt'] > $ts + 3600 ? ' · Güncelleme: <time datetime="' . vg_iso($a['updatedAt']) . '">' . vh_tr_date($a['updatedAt']) . '</time>' : '') . '</p>';
    $figure = '';
    if ($a['image']) {
        $figure = '<figure class="vh-figure"><img src="' . vh_esc($a['image']['url']) . '" alt="" loading="lazy" decoding="async"><figcaption>' . vh_esc($a['image']['credit']) . '</figcaption></figure>';
    }
    $source = '';
    if ($a['source'] && $a['source']['url'] !== '') {
        $s = $a['source'];
        $sd = $s['publishedAt'] !== '' && strtotime($s['publishedAt']) !== false ? vh_tr_date((int)strtotime($s['publishedAt'] . (strlen($s['publishedAt']) === 10 ? 'T12:00:00Z' : ''))) : '';
        $source = '<aside class="vh-source" aria-label="Kaynak"><h2>Kaynak</h2><p><strong>' . vh_esc($s['name']) . '</strong>' . ($sd !== '' ? ' · ' . $sd : '') . '</p>'
            . '<p><a class="btn btn--primary btn--md" href="' . vh_esc($s['url']) . '" target="_blank" rel="noopener noreferrer">' . ($a['type'] === 'kaynak' ? 'Haberin tamamını kaynağında okuyun' : 'Kaynağı açın') . ' <span aria-hidden="true">&#8599;</span></a></p>'
            . ($s['licenseNote'] !== '' ? '<p class="vh-source__note">' . vh_esc($s['licenseNote']) . '</p>' : '')
            . '</aside>';
    }
    $kaynakNote = $a['type'] === 'kaynak' ? '<p class="vh-note">Bu kart, ' . vh_esc($a['source']['name'] ?? 'kaynak') . ' tarafından yayımlanan habere yönlendirir. Yukarıdaki özet VoltHaber editörü tarafından yazılmıştır; haberin metni ve görselleri kaynağına aittir.</p>' : '';
    $resmiNote = $a['type'] === 'resmi' ? '<p class="kb-disclaimer">Bu özet bilgilendirme amaçlıdır. Bağlayıcı olan Resmî Gazete\'de yayımlanan metin ve yürürlükteki güncel mevzuattır.</p>' : '';
    $tags = $a['tags'] ? '<p class="vh-tags">' . implode('', array_map(function ($t) {
        return '<a href="/volthaber/etiket/' . vh_esc($t) . '/">#' . vh_esc($t) . '</a>';
    }, $a['tags'])) . '</p>' : '';
    $rel = $a['related'] ? '<section class="vh-tools" aria-labelledby="vh-rel-tools"><h2 id="vh-rel-tools">İlgili araç ve simülasyonlar</h2><ul>' . implode('', array_map(function ($r) {
        return '<li><a href="' . vh_esc($r['url']) . '">' . vh_esc($r['label']) . '</a></li>';
    }, $a['related'])) . '</ul></section>' : '';
    $relatedArticles = vh_related($live, $a, 4);
    $article = '<article class="article vh-article">'
        . '<p class="vh-article__kick">' . vh_type_badge($a) . '<a class="article__cat" href="/volthaber/kategori/' . vh_esc($a['category']) . '/">' . vh_esc($catName) . '</a></p>'
        . '<h1>' . vh_esc($a['title']) . '</h1>' . $byline
        . '<p class="article__summary">' . vh_esc($a['summary']) . '</p>' . $figure . $kaynakNote
        . '<div class="vh-body">' . $a['bodyHtml'] . '</div>'
        . $source . $resmiNote . $tags . vh_share($url, $a['title']) . $rel
        . '<p class="vh-policy">Bir hata mı fark ettiniz? <a href="/volthaber/yayin-ilkeleri.html#duzeltme">Düzeltme ve kaldırma talebi</a></p>'
        . '</article>';
    $after = '<div class="vh-wrap vh-after">'
        . ($relatedArticles ? '<section class="vh-sec" aria-labelledby="vh-related"><div class="vh-sec__head"><h2 id="vh-related">İlgili yazılar</h2></div><div class="vh-grid">' . implode('', array_map('vh_card', $relatedArticles)) . '</div></section>' : '')
        . vh_newsletter() . '</div>';
    return ['meta' => $meta, 'main' => vh_shell_main($article . $after, vh_breadcrumb_html($crumb))];
}

function vh_render_message(int $status, string $title, string $text): array
{
    $meta = vh_meta(['title' => $title . ' | VoltHaber', 'desc' => $text, 'url' => VH_SITE . '/volthaber/', 'robots' => 'noindex, follow']);
    $body = '<div class="vh-wrap vh-msg"><p class="vh-mast__kicker"><span class="vh-logo">Volt<b>Haber</b></span></p><h1>' . vh_esc($title) . '</h1><p>' . vh_esc($text) . '</p>'
        . '<p><a class="btn btn--primary btn--md" href="/volthaber/">VoltHaber ana sayfası</a></p></div>';
    return ['meta' => $meta, 'main' => vh_shell_main($body), 'status' => $status];
}

/* ------------------------------------------------------------------ XML */

function vh_xml(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function vh_sitemap(array $state): string
{
    $live = vh_live_list($state, vg_now());
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    $latest = $live ? max(array_map(function ($a) {
        return max(vh_live_at($a), $a['updatedAt']);
    }, $live)) : vg_now();
    $out .= '  <url><loc>' . VH_SITE . '/volthaber/</loc><lastmod>' . gmdate('Y-m-d', $latest) . "</lastmod></url>\n";
    $out .= '  <url><loc>' . VH_SITE . "/volthaber/yayin-ilkeleri.html</loc></url>\n";
    foreach (vh_categories() as $id => $c) {
        $in = array_filter($live, function ($a) use ($id) {
            return $a['category'] === $id;
        });
        if ($in) {
            $out .= '  <url><loc>' . VH_SITE . '/volthaber/kategori/' . $id . '/</loc></url>' . "\n";
        }
    }
    foreach ($live as $a) {
        $out .= '  <url><loc>' . vh_xml(VH_SITE . '/volthaber/' . $a['slug'] . '/') . '</loc><lastmod>' . gmdate('Y-m-d', max(vh_live_at($a), $a['updatedAt'])) . "</lastmod></url>\n";
    }
    return $out . "</urlset>\n";
}

function vh_rss(array $state): string
{
    $live = array_slice(vh_live_list($state, vg_now()), 0, 30);
    $cats = vh_categories();
    $out = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">' . "\n<channel>\n"
        . "  <title>VoltHaber – VoltGuard</title>\n  <link>" . VH_SITE . "/volthaber/</link>\n"
        . '  <atom:link href="' . VH_SITE . '/volthaber/rss.xml" rel="self" type="application/rss+xml"/>' . "\n"
        . "  <description>Elektrik ve enerji sektöründen mevzuat özetleri, kaynaklı haberler ve VoltGuard teknik analizleri.</description>\n"
        . "  <language>tr</language>\n";
    if ($live) {
        $out .= '  <lastBuildDate>' . gmdate('D, d M Y H:i:s', vh_live_at($live[0])) . " +0000</lastBuildDate>\n";
    }
    foreach ($live as $a) {
        $link = VH_SITE . '/volthaber/' . $a['slug'] . '/';
        $out .= "  <item>\n    <title>" . vh_xml($a['title']) . "</title>\n    <link>" . vh_xml($link) . "</link>\n    <guid isPermaLink=\"true\">" . vh_xml($link) . "</guid>\n"
            . '    <pubDate>' . gmdate('D, d M Y H:i:s', vh_live_at($a)) . " +0000</pubDate>\n"
            . '    <category>' . vh_xml($cats[$a['category']][0] ?? '') . "</category>\n"
            . '    <description>' . vh_xml($a['summary']) . "</description>\n  </item>\n";
    }
    return $out . "</channel>\n</rss>\n";
}
