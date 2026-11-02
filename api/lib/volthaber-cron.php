<?php
/*
 * VoltHaber kaynak taramasi (cron). Yalnizca sunucu terminalinden; HTTP ile calismaz (api/lib/ .htaccess ile
 * kapali, ayrica PHP_SAPI denetimi). api/ her deploy'da sunucuya kopyalanir; tools/ kopyalanmaz, bu yuzden cron
 * gorevi bu dosyayi cagirmalidir. Kurulum: api/VOLTHABER.md "Zamanlanmis tarama".
 *   VG_DATA_DIR=/home/voltgua2/vg-data php api/lib/volthaber-cron.php           etkin kaynaklar (kaynak basina 30 dk siniri)
 *   ... php api/lib/volthaber-cron.php --source epias                            tek kaynak
 *   ... php api/lib/volthaber-cron.php --draft-only                              sadece yeni taslak, yayinlama/temizlik yok
 *   ... php api/lib/volthaber-cron.php --check-url https://ornek.gov.tr/rss [--allow ornek.gov.tr]
 *                                                                               SSRF + izinli alan adi denetimi (yalnizca DNS)
 *   php api/lib/volthaber-cron.php --parse dosya.xml                             yerel akis dosyasini ayristirir (veri yazmaz)
 *   ... php api/lib/volthaber-cron.php --status                                  son zamanlanmis calisma ve kaynak durumu
 * Her calisma sources.json'a kalp atisi yazar; panel cron'un gercekten calisip calismadigini buradan gosterir.
 * Varsayilan tam kip zamani gelen planli yazilari da isler; --draft-only mevcut yayin takvimini degistirmez.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// Parse before bootstrap: unknown/mistyped switches must never fall through to a full fetch.
$args = array_slice($argv, 1);
if ($args === ['--help']) {
    echo "Usage: volthaber-cron.php [--draft-only] [--source id] | --status | --parse file | --check-url url [--allow hosts]\n";
    exit(0);
}
$options = [];
$values = ['--source', '--check-url', '--allow', '--parse'];
$flags = ['--draft-only', '--status'];
$invalid = function (): void { fwrite(STDERR, "Invalid VoltHaber arguments. Use --help.\n"); exit(2); };
for ($i = 0; $i < count($args); $i++) {
    $name = $args[$i];
    if (isset($options[$name])) $invalid();
    if (in_array($name, $flags, true)) { $options[$name] = true; continue; }
    if (!in_array($name, $values, true) || !isset($args[$i + 1]) || $args[$i + 1] === '' || substr($args[$i + 1], 0, 2) === '--') $invalid();
    $options[$name] = $args[++$i];
}
$source = $options['--source'] ?? null;
if ($source !== null && preg_match('/^[a-z0-9-]{1,40}$/D', $source) !== 1) $invalid();
if (isset($options['--allow']) && !isset($options['--check-url'])) $invalid();
$modes = count(array_intersect(array_keys($options), ['--check-url', '--parse', '--status']));
if ($modes > 1 || ($modes && (isset($options['--source']) || isset($options['--draft-only'])))) $invalid();
if (isset($options['--parse']) && isset($options['--allow'])) $invalid();
$draftOnly = isset($options['--draft-only']);

define('VG_API', 1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/store.php';
require __DIR__ . '/security.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/volthaber.php';
require __DIR__ . '/volthaber-registry.php';
require __DIR__ . '/volthaber-fetch.php';

$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__, 2);

try {
    if (($u = $options['--check-url'] ?? null) !== null) {
        $why = '';
        $allow = $options['--allow'] ?? null;
        $ok = vh_check_fetch_url($u, $why, $allow !== null && $allow !== '' ? explode(',', strtolower($allow)) : []);
        echo $ok ? "allowed " . $ok[1] . "\n" : "blocked " . $why . "\n";
        exit($ok ? 0 : 3);
    }
    if (($f = $options['--parse'] ?? null) !== null) {
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
    if (isset($options['--status'])) {
        $st = vh_locked(false, function (string $dir) {
            return vh_sources($dir);
        });
        echo vg_json_encode(['scheduler' => vh_scheduler_status($st)], true) . "\n";
        exit(0);
    }
    // Keep the coordination inode between runs; skip only genuine contention.
    $lockPath = vh_dir() . '/cron.lock';
    $beforeLock = @lstat($lockPath);
    if (is_link($lockPath) || (is_array($beforeLock)
        && (($beforeLock['mode'] & 0170000) !== 0100000 || (int)$beforeLock['nlink'] !== 1))) vg_unavailable('volthaber cron lock is unsafe');
    $lock = @fopen($lockPath, 'c+b');
    if ($lock === false) vg_unavailable('volthaber cron lock cannot be opened');
    $openedLock = @fstat($lock);
    if (!is_array($openedLock) || ($openedLock['mode'] & 0170000) !== 0100000 || (int)$openedLock['nlink'] !== 1) {
        fclose($lock); vg_unavailable('volthaber cron lock is unsafe');
    }
    @chmod($lockPath, 0600);
    $wouldBlock = 0;
    if (!flock($lock, LOCK_EX | LOCK_NB, $wouldBlock)) {
        fclose($lock);
        if ($wouldBlock) { echo "Another VoltHaber cron is running; skipped.\n"; exit(0); }
        vg_unavailable('volthaber cron lock failed');
    }
    try {
        $res = vh_run_fetch(['sourceId' => $source ?? '', 'force' => false, 'trigger' => 'cron', 'budget' => 240, 'draftOnly' => $draftOnly]);
    } finally { flock($lock, LOCK_UN); fclose($lock); }
    if ($draftOnly) echo "mode=draft-only\n";
    foreach ($res['results'] as $r) {
        echo str_pad($r['sourceId'], 16) . ($r['ok'] ? 'ok' : 'skip/error:' . $r['error']) . ' items=' . $r['items'] . ' added=' . $r['added'] . "\n";
        if (!empty($r['capacitySkipped'])) echo 'capacity skipped: ' . $r['capacitySkipped'] . ' reason=' . $r['capacityReason'] . "\n";
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
