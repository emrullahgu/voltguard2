<?php
/*
 * VoltHaber kaynak taramasi (cron). Yalnizca sunucu terminalinden; HTTP ile calismaz.
 *   VG_DATA_DIR=/home/voltgua2/vg-data php tools/volthaber-fetch.php              etkin kaynaklar (kaynak basina 30 dk siniri)
 *   ... php tools/volthaber-fetch.php --source epias                               tek kaynak
 *   ... php tools/volthaber-fetch.php --check-url https://ornek.gov.tr/rss          SSRF denetimi (ag istegi yapmaz, yalnizca DNS)
 *   php tools/volthaber-fetch.php --parse dosya.xml                                yerel akis dosyasini ayristirir (veri yazmaz)
 * Zamani gelen planli yazilar da her calismada yayina alinir.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/store.php';
require dirname(__DIR__) . '/api/lib/security.php';
require dirname(__DIR__) . '/api/lib/validate.php';
require dirname(__DIR__) . '/api/lib/volthaber.php';
require dirname(__DIR__) . '/api/lib/volthaber-registry.php';
require dirname(__DIR__) . '/api/lib/volthaber-fetch.php';

$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);
$args = array_slice($argv, 1);
$opt = function (string $name) use ($args): ?string {
    $i = array_search($name, $args, true);
    return $i === false ? null : (string)($args[$i + 1] ?? '');
};

try {
    if (($u = $opt('--check-url')) !== null) {
        $why = '';
        $ok = vh_check_fetch_url($u, $why);
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
