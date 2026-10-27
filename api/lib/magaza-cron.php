<?php
/*
 * VoltGuard Magaza fiyat/kur denetimi (cron). Yalnizca sunucu terminalinden; HTTP ile calismaz (api/lib/ .htaccess ile
 * kapali, ayrica PHP_SAPI denetimi). api/ her deploy'da sunucuya kopyalanir; tools/ kopyalanmaz, bu yuzden cron
 * gorevi bu dosyayi cagirmalidir. Kurulum: api/MAGAZA.md "Kurulum".
 *   VG_DATA_DIR=/home/voltgua2/vg-data php api/lib/magaza-cron.php                 tum urunler + TCMB kuru (en cok 900 sn)
 *   ... php api/lib/magaza-cron.php --product vgm-0001                             tek urun (kalp atisi yazmaz)
 *   ... php api/lib/magaza-cron.php --rates                                        yalniz TCMB kuru
 *   ... php api/lib/magaza-cron.php --status                                       son calisma, sayimlar, kur (JSON)
 *   php api/lib/magaza-cron.php --parse dosya.html [--url https://ornek.test/urun] yerel sayfayi ayristirir (veri yazmaz)
 *   php api/lib/magaza-cron.php --check-url https://ornek.test/urun [--allow ornek.test]
 *                                                                                  SSRF + izinli alan adi denetimi (yalnizca DNS)
 * Her tam calisma fiyatlar.json'a kalp atisi (lastRunAt, lastRunSummary) yazar; panel cron'un gercekten calisip
 * calismadigini buradan gosterir (13 saatten eskiyse "saglikli degil"). Ayni anda iki tam calisma olmaz (cron.lock).
 * Cikti adres, alan adi veya maliyet icermez.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/store.php';
require __DIR__ . '/security.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/magaza.php';
require __DIR__ . '/magaza-kaynak.php';

$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__, 2);
$args = array_slice($argv, 1);
$opt = function (string $name) use ($args): ?string {
    $i = array_search($name, $args, true);
    return $i === false ? null : (string)($args[$i + 1] ?? '');
};

try {
    if (($u = $opt('--check-url')) !== null) {
        $why = '';
        $allow = $opt('--allow');
        $own = vgm_host($u);
        $list = $allow !== null && $allow !== '' ? explode(',', strtolower($allow)) : ($own !== '' ? [$own] : []);
        $ok = vgm_check_fetch_url($u, $why, $list);
        echo $ok ? 'allowed ' . $ok[1] . "\n" : 'blocked ' . $why . "\n";
        exit($ok ? 0 : 3);
    }
    if (($f = $opt('--parse')) !== null) {
        $raw = is_file($f) ? (string)file_get_contents($f, false, null, 0, VGM_FETCH_MAX_BYTES + 1) : '';
        $offer = vgm_parse_offer($raw, $opt('--url') ?? 'https://ornek.test/urun');
        echo vg_json_encode($offer, true) . "\n";
        exit($offer['ok'] ? 0 : 3);
    }
    if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
        fwrite(STDERR, "VG_DATA_DIR, API'nin özel veri klasörüne ayarlanmalıdır.\n");
        exit(2);
    }
    if (in_array('--status', $args, true)) {
        echo vg_json_encode(vgm_refresh_status(time()), true) . "\n";
        exit(0);
    }
    if (($id = $opt('--product')) !== null) {
        if (preg_match('/^vgm-[0-9]{4,6}$/D', $id) !== 1 || vgm_product($id) === null) {
            fwrite(STDERR, "Geçersiz ürün kimliği.\n");
            exit(2);
        }
        $summary = vgm_refresh(['ids' => [$id], 'live' => false, 'budget' => 120, 'max' => 10, 'spacing' => 2,
            'rates' => true, 'heartbeat' => false]);
        $item = vgm_locked(false, function (string $dir) use ($id): ?array {
            return vgm_prices_state($dir)['items'][$id] ?? null;
        });
        $view = is_array($item) ? array_intersect_key($item, array_flip(['status', 'costTry', 'costUsd', 'checkedAt',
            'lastAttemptAt', 'available', 'method', 'note', 'held'])) : null;
        echo vg_json_encode(['summary' => $summary, 'item' => $view], true) . "\n";
        exit(0);
    }
    if (in_array('--rates', $args, true)) {
        $summary = vgm_refresh(['ids' => [], 'rates' => true, 'forceRates' => true, 'heartbeat' => false]);
        $rate = vgm_locked(false, function (string $dir): ?array {
            return vgm_rate_state($dir);
        });
        echo vg_json_encode(['rateUpdated' => $summary['rateUpdated'], 'rateError' => $summary['rateError'] ?? null,
            'rate' => $rate === null ? null : array_intersect_key($rate, array_flip(['usdTry', 'eurTry', 'date', 'fetchedAt']))], true) . "\n";
        exit($summary['rateUpdated'] ? 0 : 1);
    }
    // tam calisma: ayni anda ikinci bir calisma baslamaz
    $lock = @fopen(vgm_dir() . '/cron.lock', 'c+');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
        echo "Başka bir fiyat denetimi çalışıyor; bu çalışma atlandı.\n";
        exit(0);
    }
    $summary = vgm_refresh(['ids' => null, 'live' => false, 'budget' => 900, 'spacing' => 2, 'rates' => true]);
    $parts = [];
    foreach ($summary as $key => $value) {
        $parts[] = $key . '=' . (is_bool($value) ? ($value ? 'yes' : 'no') : (string)$value);
    }
    echo implode(' ', $parts) . "\n";
    flock($lock, LOCK_UN);
    fclose($lock);
} catch (VgHttpError $e) {
    fwrite(STDERR, "Mağaza fiyat denetimi başarısız: " . $e->errCode . "\n");
    exit(1);
} catch (Throwable $e) {
    fwrite(STDERR, "Mağaza fiyat denetimi başarısız. Özel veri klasörünü ve sunucu günlüklerini kontrol edin.\n");
    exit(1);
}
