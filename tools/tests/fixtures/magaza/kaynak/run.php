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

/* Ozel veriyi parcali bicimde yazar (kaynaklar.json ayarlar, kaynak/<parca>.json); sira dosyasi yeniden kurulur. */
function t_write_config(string $d, array $config): void
{
    $sources = is_array($config['sources'] ?? null) ? $config['sources'] : [];
    unset($config['sources']);
    vgm_write($d, 'kaynaklar.json', $config);
    vgm_rmdir($d . '/kaynak');
    $shards = [];
    foreach ($sources as $id => $list) {
        $shards[vgm_shard_of((string)$id)][$id] = $list;
    }
    foreach ($shards as $s => $map) {
        vgm_write($d, 'kaynak/' . $s . '.json', $map, 16777216);
    }
    @unlink($d . '/fiyat-sira.json');
    vgm_sources_raw('');
}

function t_write_prices(string $d, array $state): void
{
    vgm_rmdir($d . '/fiyat');
    $byShard = [];
    foreach ((array)($state['items'] ?? []) as $id => $item) {
        $byShard[vgm_shard_of((string)$id)][$id] = $item;
    }
    foreach ($byShard as $s => $map) {
        vgm_write($d, 'fiyat/' . $s . '.json', $map);
    }
    vgm_status_update($d, ['lastRunAt' => $state['lastRunAt'] ?? null, 'lastRunSummary' => $state['lastRunSummary'] ?? null, 'problems' => []]);
    @unlink($d . '/fiyat-sira.json');
}

/** Tum fiyat parcalari + fiyat-durum.json: {items, lastRunAt, lastRunSummary, problems}. */
function t_read_prices(string $d): array
{
    $items = [];
    $files = glob($d . '/fiyat/*.json') ?: [];
    sort($files);
    foreach ($files as $f) {
        $items += vgm_read_map($d, 'fiyat/' . basename($f));
    }
    ksort($items);
    $s = vgm_status_read($d);
    return ['items' => $items, 'lastRunAt' => $s['lastRunAt'] ?? null, 'lastRunSummary' => $s['lastRunSummary'] ?? null,
        'problems' => $s['problems']];
}

/** Ozel klasordeki dosyalar (goreli, sirali). */
function t_files(string $d): array
{
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        $out[] = str_replace('\\', '/', substr($f->getPathname(), strlen($d) + 1));
    }
    sort($out);
    return $out;
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
                if (isset($in['config'])) {
                    t_write_config($d, (array)$in['config']);
                }
                if (isset($in['prices'])) {
                    t_write_prices($d, (array)$in['prices']);
                }
                if (isset($in['rate'])) {
                    vgm_write($d, 'kur.json', (array)$in['rate']);
                }
                return $d;
            });
            $summary = vgm_refresh((array)($in['opts'] ?? []));
            $state = vgm_locked(false, function (string $d): array {
                return [t_read_prices($d), vgm_rate_state($d), vgm_queue_read($d)];
            });
            $out = ['summary' => $summary, 'prices' => $state[0], 'rate' => $state[1], 'queue' => $state[2]['items'], 'dir' => $dir];
            break;
        case 'legacy':
            /* Eski tek dosyali ozel veri (kaynaklar.json icinde sources + fiyatlar.json) ilk kilitte parcalara tasinir. */
            $d = vgm_dir();
            file_put_contents($d . '/kaynaklar.json', json_encode($in['config']));
            file_put_contents($d . '/fiyatlar.json', json_encode($in['prices']));
            $state = vgm_locked(false, function (string $dd): array {
                return [vgm_config($dd), t_read_prices($dd), vgm_queue_read($dd)['items']];
            });
            $out = ['files' => t_files($d), 'config' => $state[0], 'prices' => $state[1], 'queue' => $state[2],
                'sources' => vgm_sources_many($state[0], array_keys((array)($in['config']['sources'] ?? [])))];
            break;
        case 'due':
            $out = vgm_due_order((array)$in['queue'], (int)$in['now'], (int)($in['age'] ?? 72000), (int)($in['retry'] ?? 7200));
            break;
        case 'catalog':
            /* Katalog okuma API'si (VG_MAGAZA_CATALOG dizini): istenen sorgularin sonuclari. */
            $out = [];
            foreach ((array)$in['calls'] as $call) {
                $fn = (string)$call[0];
                $arg = $call[1] ?? null;
                if ($fn === 'categories') {
                    $r = [];
                    foreach (vgm_categories() as $id => $c) {
                        $r[] = [$id, $c['parent'], $c['children'], $c['count']];
                    }
                    $out[] = $r;
                } elseif ($fn === 'list') {
                    $out[] = array_map(function (array $c): array {
                        return [$c['id'], $c['category']];
                    }, vgm_list((string)$arg));
                } elseif ($fn === 'product') {
                    $p = vgm_product((string)$arg);
                    $out[] = $p === null ? null : [$p['id'], $p['slug'], $p['category'], $p['vat'], $p['maxQty']];
                } elseif ($fn === 'slug') {
                    $p = vgm_product_by_slug((string)$arg);
                    $out[] = $p === null ? null : $p['id'];
                } elseif ($fn === 'search') {
                    $r = vgm_search((string)$arg, (int)($call[2] ?? 96));
                    $out[] = ['ids' => array_column($r['items'], 'id'), 'total' => $r['total']];
                } elseif ($fn === 'ids') {
                    $n = 0;
                    $first = null;
                    foreach (vgm_product_ids() as $id => $cat) {
                        $first = $first ?? [$id, $cat];
                        $n++;
                    }
                    $out[] = ['count' => $n, 'first' => $first];
                } elseif ($fn === 'manifest') {
                    $out[] = vgm_manifest();
                } else {
                    $out[] = 'unknown';
                }
            }
            break;
        case 'queue':
            $out = vgm_locked(false, function (string $d): array {
                return ['queue' => vgm_queue_read($d)['items'], 'status' => vgm_status_read($d), 'files' => t_files($d)];
            });
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
