<?php
/*
 * Test kosucusu (tools/tests/magaza-kaynak.test.cjs): stdin'den {"op": ..., ...} JSON'u okur, sonucu JSON olarak yazar.
 * Gercek api/lib kodunu cagirir; ag yerine VG_MAGAZA_FIXTURE_DIR, veri icin gecici VG_DATA_DIR kullanilir.
 */
declare(strict_types=1);

define('VG_API', 1);
$root = dirname(__DIR__, 5);
$_SERVER['DOCUMENT_ROOT'] = $root;
foreach (['bootstrap', 'store', 'security', 'validate', 'magaza', 'magaza-kaynak'] as $lib) {
    require $root . '/api/lib/' . $lib . '.php';
}

$in = json_decode((string)stream_get_contents(STDIN), true);
if (!is_array($in)) {
    fwrite(STDERR, "gecersiz girdi\n");
    exit(2);
}

try {
    $out = null;
    switch ((string)($in['op'] ?? '')) {
        case 'number':
            $out = array_map(function ($c) {
                return vgm_parse_number((string)$c[0], (bool)$c[1]);
            }, $in['cases']);
            break;
        case 'ip':
            $out = array_map('vgm_ip_blocked', $in['ips']);
            break;
        case 'availability':
            $out = array_map('vgm_availability', $in['values']);
            break;
        case 'currency':
            $out = array_map('vgm_currency', $in['values']);
            break;
        case 'parse':
            $html = isset($in['file']) ? (string)file_get_contents($in['file']) : (string)($in['html'] ?? '');
            $out = vgm_parse_offer($html, (string)($in['url'] ?? 'https://tedarikci-bir.example/urun/dm-450'));
            break;
        case 'parse_many':
            $out = [];
            foreach ((array)$in['items'] as $item) {
                $html = isset($item['file']) ? (string)file_get_contents($item['file']) : (string)($item['html'] ?? '');
                $out[] = vgm_parse_offer($html, (string)($item['url'] ?? 'https://tedarikci-bir.example/urun/dm-450'));
            }
            break;
        case 'check_url':
            $why = '';
            $r = vgm_check_fetch_url((string)$in['url'], $why, (array)($in['allow'] ?? []), (bool)($in['skipDns'] ?? false));
            $out = ['why' => $why, 'host' => $r[0] ?? null, 'ip' => $r[1] ?? null, 'path' => $r[2] ?? null];
            break;
        case 'fetch':
            $why = '';
            $status = 0;
            if (isset($in['deadlineIn'])) {
                vgm_fetch_deadline(microtime(true) + (float)$in['deadlineIn']);
            }
            $body = vgm_fetch((string)$in['url'], (array)$in['allow'], $why, $status);
            $out = ['why' => $why, 'status' => $status, 'length' => strlen($body), 'body' => strlen($body) <= 4000 ? $body : null];
            break;
        case 'offer':
            $out = vgm_fetch_offer((array)$in['src'], (array)$in['product']);
            break;
        case 'tcmb':
            $why = '';
            $out = ['rate' => vgm_parse_tcmb((string)$in['xml'], $why), 'why' => $why];
            break;
        case 'rates':
            $why = '';
            $out = ['rate' => vgm_fetch_rates($why), 'why' => $why];
            break;
        case 'refresh':
            $dir = vgm_locked(true, function (string $d) use ($in): string {
                foreach (['config' => 'kaynaklar.json', 'prices' => 'fiyatlar.json', 'rate' => 'kur.json'] as $key => $file) {
                    if (isset($in[$key])) {
                        vgm_write($d, $file, (array)$in[$key]);
                    }
                }
                return $d;
            });
            $summary = vgm_refresh((array)($in['opts'] ?? []));
            $state = vgm_locked(false, function (string $d): array {
                return [vgm_prices_state($d), vgm_rate_state($d)];
            });
            $out = ['summary' => $summary, 'prices' => $state[0], 'rate' => $state[1], 'dir' => $dir];
            break;
        case 'price':
            $out = vgm_price((array)$in['product'], isset($in['item']) ? (array)$in['item'] : null, isset($in['rate']) ? (array)$in['rate'] : null,
                (array)($in['config'] ?? []), (bool)($in['open'] ?? true), (int)$in['now']);
            break;
        case 'check':
            $out = vgm_apply_check(isset($in['item']) ? (array)$in['item'] : ['history' => []], (array)$in['product'], 0,
                (array)$in['offer'], (array)$in['rates'], (int)$in['now']);
            break;
        case 'status':
            $out = vgm_refresh_status((int)($in['now'] ?? time()));
            break;
        default:
            fwrite(STDERR, "bilinmeyen islem\n");
            exit(2);
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['exception' => get_class($e), 'message' => $e->getMessage()]);
    exit(1);
}
