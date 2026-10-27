<?php
/*
 * Urun kaynagi okuyucu (gelistirici araci; sunucuya kopyalanmaz). Tedarikci urun sayfasini magazanin fiyat okuyucusuyla
 * (api/lib/magaza-kaynak.php: ayni SSRF korumasi, ayni ayristirici) okur ve sonucu yazar; kaynaklar.json hazirlanirken
 * fiyatin okunabildigini ve cakisma olmadigini dogrulamak icindir. Yerel PHP (openssl + curl + mbstring eklentileriyle):
 *
 *   .qa/php/runtime/php.exe -n -d extension_dir=.qa/php/runtime/ext -d extension=openssl -d extension=curl -d extension=mbstring tools/magaza/kaynak-oku.php [--file adresler.txt] <url>...
 *
 * Her URL icin bir JSON satiri yazar: {url, status, why, offer}. offer: ok, price, currency, available, name, brand, gtin,
 * mpn, sku, image, method (jsonld|microdata|og|platform:<ad>), candidates, error. Ayni sunucuya istekler arasinda en az
 * 1 sn beklenir; izinli alan adi URL'nin kendi alan adidir; durust bot kimligi kullanilir. --file: satir basina bir URL
 * (# ile baslayan satirlar yorumdur). Cikis kodu: tum teklifler okunduysa 0, aksi halde 3.
 * Cikti adreslerini ve tedarikci adlarini depoya KOYMAYIN (api/MAGAZA.md kural 5).
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
$root = dirname(__DIR__, 2);
require $root . '/api/lib/bootstrap.php';
require $root . '/api/lib/magaza.php';
require $root . '/api/lib/magaza-kaynak.php';

$args = array_slice($argv, 1);
$urls = [];
for ($i = 0; $i < count($args); $i++) {
    if ($args[$i] === '--file') {
        $file = (string)($args[++$i] ?? '');
        if (!is_file($file)) {
            fwrite(STDERR, "Dosya bulunamadı: $file\n");
            exit(2);
        }
        foreach ((array)file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim((string)$line);
            if ($line !== '' && $line[0] !== '#') {
                $urls[] = $line;
            }
        }
    } else {
        $urls[] = $args[$i];
    }
}
if (!$urls) {
    fwrite(STDERR, "Kullanım: kaynak-oku.php [--file adresler.txt] <url>...\n");
    exit(2);
}

$last = [];
$failed = 0;
foreach ($urls as $url) {
    $host = vgm_host($url);
    if ($host !== '' && isset($last[$host])) {
        $wait = 1.0 - (microtime(true) - $last[$host]);
        if ($wait > 0) {
            usleep((int)ceil($wait * 1000000));
        }
    }
    $why = '';
    $status = 0;
    $html = '';
    if ($host === '') {
        $why = 'scheme_not_allowed';
    } else {
        $html = vgm_fetch($url, [$host], $why, $status);
        $last[$host] = microtime(true);
    }
    $offer = $html !== '' ? vgm_parse_offer($html, $url) : null;
    if ($offer === null || !$offer['ok']) {
        $failed++;
    }
    echo json_encode(['url' => $url, 'status' => $status, 'why' => $why, 'offer' => $offer],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
}
exit($failed === 0 ? 0 : 3);
