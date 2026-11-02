<?php
/*
 * Toplu teklif ayristirici (gelistirici araci; sunucuya kopyalanmaz). tools/magaza/tara.py ile indirilen urun
 * sayfalarini sunucunun ayristiricisiyla (vgm_parse_offer) okur; ayrica kategori izi (BreadcrumbList), gorsel
 * adresleri, sayfa basligi, kisa aciklama ve KDV ibareleri cikarilir. Cikti: <onbellek>/ayristirma/<alan>.jsonl.
 *
 *   php tools/magaza/toplu-ayristir.php [--alan x.com] [--hepsi]
 *
 * --hepsi verilmezse daha once ayristirilan URL'ler atlanir. Cikti tedarikci bilgisi icerir; depoya KOYMAYIN.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
define('VG_API', 1);
// VG_TA_ROOT: ayristiriciyi sabit bir kopyadan calistirmak icin (ornegin `git archive HEAD api/lib` cikisi); kod
// ayni anda duzenlenirken toplu ayristirma yarim dosyalardan etkilenmez.
$root = getenv('VG_TA_ROOT') ?: dirname(__DIR__, 2);
require $root . '/api/lib/bootstrap.php';
require $root . '/api/lib/magaza.php';
require $root . '/api/lib/magaza-kaynak.php';

$cache = getenv('VG_TARAMA_DIR') ?: ((getenv('LOCALAPPDATA') ?: (getenv('HOME') . '/.voltguard')) . '/VoltGuard/magaza-tarama');
$only = null;
$all = false;
for ($i = 1; $i < count($argv); $i++) {
    if ($argv[$i] === '--alan') {
        $only = $argv[++$i] ?? null;
    } elseif ($argv[$i] === '--hepsi') {
        $all = true;
    }
}

function ta_ld_nodes(string $html): array
{
    $nodes = [];
    foreach (vgm_script_blocks($html) as $raw) {
        $data = vgm_json_lenient($raw);
        if ($data === null) {
            continue;
        }
        $stack = [$data];
        while ($stack) {
            $n = array_pop($stack);
            if (!is_array($n)) {
                continue;
            }
            if (isset($n['@type'])) {
                $nodes[] = $n;
            }
            foreach ($n as $v) {
                if (is_array($v)) {
                    $stack[] = $v;
                }
            }
        }
    }
    return $nodes;
}

function ta_breadcrumb(array $nodes, string $html): array
{
    foreach ($nodes as $n) {
        if (in_array('BreadcrumbList', vgm_types($n['@type'] ?? null), true) && is_array($n['itemListElement'] ?? null)) {
            $items = $n['itemListElement'];
            usort($items, fn($a, $b) => ((int)($a['position'] ?? 0)) <=> ((int)($b['position'] ?? 0)));
            $out = [];
            foreach ($items as $it) {
                $name = $it['name'] ?? ($it['item']['name'] ?? null);
                if (is_string($name) && trim($name) !== '') {
                    $out[] = vgm_plain($name, 80);
                }
            }
            if ($out) {
                return $out;
            }
        }
    }
    // Yedek: breadcrumb sinifli liste
    if (preg_match('#<(ol|ul|div|nav)[^>]*(?:class|id)="[^"]*breadcrumb[^"]*"[^>]*>(.*?)</\1>#is', $html, $m)) {
        preg_match_all('#<(?:a|span|li)[^>]*>([^<]{2,80})<#', $m[2], $mm);
        return array_values(array_filter(array_map(fn($t) => vgm_plain(html_entity_decode($t), 80), $mm[1]),
            fn($t) => $t !== '' && !preg_match('/^[>\/»›|]+$/u', $t)));
    }
    return [];
}

function ta_images(array $nodes, string $html, string $url): array
{
    $imgs = [];
    foreach ($nodes as $n) {
        if (in_array('Product', vgm_types($n['@type'] ?? null), true)) {
            $im = $n['image'] ?? null;
            foreach ((array)$im as $v) {
                if (is_array($v)) {
                    $v = $v['url'] ?? ($v['contentUrl'] ?? null);
                }
                if (is_string($v) && $v !== '') {
                    $imgs[] = $v;
                }
            }
        }
    }
    if (preg_match_all('#<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]*content=["\']([^"\']+)#i', $html, $m)) {
        array_push($imgs, ...$m[1]);
    }
    if (preg_match_all('#itemprop=["\']image["\'][^>]*(?:content|src|href)=["\']([^"\']+)#i', $html, $m)) {
        array_push($imgs, ...$m[1]);
    }
    $out = [];
    foreach ($imgs as $u) {
        $u = html_entity_decode(trim($u));
        if (strpos($u, '//') === 0) {
            $u = 'https:' . $u;
        } elseif (!preg_match('#^https?://#i', $u)) {
            $u = vgm_resolve_location($url, $u);
        }
        if ($u !== '' && !in_array($u, $out, true)) {
            $out[] = $u;
        }
    }
    return array_slice($out, 0, 8);
}

function ta_description(array $nodes, string $html): string
{
    foreach ($nodes as $n) {
        if (in_array('Product', vgm_types($n['@type'] ?? null), true) && is_string($n['description'] ?? null)) {
            $d = vgm_plain(html_entity_decode(strip_tags($n['description'])), 2500);
            if (mb_strlen($d) > 40) {
                return $d;
            }
        }
    }
    if (preg_match('#<meta[^>]+name=["\']description["\'][^>]*content=["\']([^"\']*)#i', $html, $m)) {
        return vgm_plain(html_entity_decode($m[1]), 600);
    }
    return '';
}

function ta_specs_text(string $html): string
{
    // Ozellik tablolari (th/td ya da dt/dd) - spesifikasyon cikarimi icin, yayimlanmaz
    $pairs = [];
    if (preg_match_all('#<tr[^>]*>\s*<t[hd][^>]*>(.*?)</t[hd]>\s*<td[^>]*>(.*?)</td>#is', $html, $m, PREG_SET_ORDER)) {
        foreach (array_slice($m, 0, 40) as $r) {
            $k = vgm_plain(html_entity_decode(strip_tags($r[1])), 60);
            $v = vgm_plain(html_entity_decode(strip_tags($r[2])), 120);
            if ($k !== '' && $v !== '' && mb_strlen($k) < 60) {
                $pairs[] = "$k: $v";
            }
        }
    }
    return mb_substr(implode(' | ', $pairs), 0, 2000);
}

$domains = $only ? [$only] : array_values(array_filter(scandir($cache) ?: [], fn($d) => $d[0] !== '.' && is_file("$cache/$d/sayfalar.jsonl")));
@mkdir("$cache/ayristirma", 0777, true);
foreach ($domains as $dom) {
    $outFile = "$cache/ayristirma/$dom.jsonl";
    $done = [];
    if (!$all && is_file($outFile)) {
        foreach (file($outFile, FILE_IGNORE_NEW_LINES) as $line) {
            $j = json_decode($line, true);
            if (isset($j['url'])) {
                $done[$j['url']] = true;
            }
        }
    }
    $out = fopen($outFile, $all ? 'w' : 'a');
    $n = $ok = 0;
    foreach (file("$cache/$dom/sayfalar.jsonl", FILE_IGNORE_NEW_LINES) as $line) {
        $rec = json_decode($line, true);
        if (!is_array($rec) || ($rec['status'] ?? 0) !== 200 || isset($done[$rec['url']])) {
            continue;
        }
        $file = "$cache/$dom/sayfa/" . sha1($rec['url']) . '.html.gz';
        $html = is_file($file) ? (string)@gzdecode((string)file_get_contents($file)) : '';
        if ($html === '') {
            continue;
        }
        $done[$rec['url']] = true;
        $n++;
        $offer = vgm_parse_offer($html, $rec['url']);
        $utf = vgm_utf8($html);
        $nodes = ta_ld_nodes($utf);
        $title = preg_match('#<title[^>]*>(.*?)</title>#is', $utf, $m) ? vgm_plain(html_entity_decode($m[1]), 200) : '';
        $h1 = preg_match('#<h1[^>]*>(.*?)</h1>#is', $utf, $m) ? vgm_plain(html_entity_decode(strip_tags($m[1])), 200) : '';
        $plain = vgm_plain(html_entity_decode(strip_tags(vgm_strip_elements($utf, ['script', 'style']))), 400000);
        $vat = [
            'dahil' => preg_match('/kdv\s*dah[iı]l/iu', $plain) === 1,
            'arti' => preg_match('/\+\s*kdv/iu', $plain) === 1,
            'haric' => preg_match('/kdv\s*har[iı]ç/iu', $plain) === 1,
        ];
        if ($offer['ok']) {
            $ok++;
        }
        fwrite($out, json_encode([
            'url' => $rec['url'], 'final' => $rec['final'] ?? $rec['url'], 't' => $rec['t'] ?? null,
            'offer' => $offer, 'title' => $title, 'h1' => $h1, 'crumbs' => ta_breadcrumb($nodes, $utf),
            'images' => ta_images($nodes, $utf, $rec['url']), 'desc' => ta_description($nodes, $utf),
            'specs' => ta_specs_text($utf), 'vat' => $vat,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
    }
    fclose($out);
    fwrite(STDOUT, sprintf("%-32s yeni=%d fiyat_ok=%d\n", $dom, $n, $ok));
}
