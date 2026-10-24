<?php
/*
 * VoltHaber kaynak taramasi (cron). Yalnizca sunucu terminalinden; HTTP ile calismaz (api/lib/ .htaccess ile
 * kapali, ayrica PHP_SAPI denetimi). api/ her deploy'da sunucuya kopyalanir; tools/ kopyalanmaz, bu yuzden cron
 * gorevi bu dosyayi cagirmalidir. Kurulum: api/VOLTHABER.md "Zamanlanmis tarama".
 *   VG_DATA_DIR=/home/voltgua2/vg-data php api/lib/volthaber-cron.php           etkin kaynaklar (kaynak basina 30 dk siniri)
 *   ... php api/lib/volthaber-cron.php --source epias                            tek kaynak
 *   ... php api/lib/volthaber-cron.php --check-url https://ornek.gov.tr/rss [--allow ornek.gov.tr]
 *                                                                               SSRF + izinli alan adi denetimi (yalnizca DNS)
 *   php api/lib/volthaber-cron.php --parse dosya.xml                             yerel akis dosyasini ayristirir (veri yazmaz)
 *   ... php api/lib/volthaber-cron.php --status                                  son zamanlanmis calisma ve kaynak durumu
 * Her calisma sources.json'a kalp atisi yazar; panel cron'un gercekten calisip calismadigini buradan gosterir.
 * Zamani gelen planli yazilar da her calismada yayina alinir.
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
require __DIR__ . '/volthaber.php';
require __DIR__ . '/volthaber-registry.php';
require __DIR__ . '/volthaber-fetch.php';

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
        $ok = vh_check_fetch_url($u, $why, $allow !== null && $allow !== '' ? explode(',', strtolower($allow)) : []);
        echo $ok ? "allowed " . $ok[1] . "\n" : "blocked " . $why . "\n";
        exit($ok ? 0 : 3);
    }
    if (($f = $opt('--parse')) !== null) {
        $raw = is_file($f) ? (string)file_get_contents($f, false, null, 0, VH_FETCH_MAX_BYTES + 1) : '';
        $why = '';
        $items = vh_parse_feed($raw, $why);
        echo vg_json_encode(['ok' => $why === '', 'error' => $why, 'items' => array_map(function ($i) {
            $i['publishedAt'] = $i['publishedAt'] !== null ? vg_iso($i['publishedAt']) : null;
            return $i;
        }, $items)], true) . "\n";
        exit($why === '' ? 0 : 3);
    }
    if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
        fwrite(STDERR, "Set VG_DATA_DIR to the API's private data directory.\n");
        exit(2);
    }
    $source = $opt('--source');
    if ($source !== null && preg_match('/^[a-z0-9-]{1,40}$/', $source) !== 1) {
        fwrite(STDERR, "Invalid source id.\n");
        exit(2);
    }
    if (in_array('--status', $args, true)) {
        $st = vh_locked(false, function (string $dir) {
            return vh_sources($dir);
        });
        echo vg_json_encode(['scheduler' => vh_scheduler_status($st)], true) . "
";
        exit(0);
    }
    $res = vh_run_fetch(['sourceId' => $source ?? '', 'force' => false, 'trigger' => 'cron', 'budget' => 240]);
    foreach ($res['results'] as $r) {
        echo str_pad($r['sourceId'], 16) . ($r['ok'] ? 'ok' : 'skip/error:' . $r['error']) . ' items=' . $r['items'] . ' added=' . $r['added'] . "\n";
    }
    if ($res['scheduledPublished'] > 0) {
        echo 'scheduled published: ' . $res['scheduledPublished'] . "\n";
    }
} catch (VgHttpError $e) {
    fwrite(STDERR, "VoltHaber fetch failed: " . $e->errCode . "\n");
    exit(1);
} catch (Throwable $e) {
    fwrite(STDERR, "VoltHaber fetch failed. Check private data configuration and server logs.\n");
    exit(1);
}
