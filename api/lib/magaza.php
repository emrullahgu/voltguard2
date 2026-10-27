<?php
/*
 * VoltGuard Magaza cekirdegi (tasarim: api/MAGAZA.md).
 * Ozel veri klasoru (tek kilit + atomik yazma), herkese acik katalog, ozel yapilandirma (tedarikci kaynaklari, marj),
 * USD tabanli fiyat motoru (TL ve KDV dahil gosterim), TCMB kuru, imzali sepet fiyat jetonu, siparis kaydi ve panel
 * yetkisi. Tedarikci adresleri, alis fiyatlari ve marj YALNIZCA vg_data_dir()/magaza/ altindadir; git'e ve herkese
 * acik yanitlara girmez.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VGM_SERVICE = 'vg-magaza/1';
const VGM_PRICE_MAX_AGE = 172800;        // tedarikci fiyati en fazla 48 saat once dogrulanmis olmali
const VGM_LIVE_RECHECK_AFTER = 21600;    // sepet adiminda 6 saatten eski fiyat canli yeniden kontrol edilir
const VGM_LIVE_MIN_INTERVAL = 600;       // ayni urun icin canli kontrol en sik 10 dakikada bir
const VGM_RATE_FETCH_MAX_AGE = 172800;   // kur en fazla 48 saat once TCMB'den okunmus olmali (cron calisiyor mu?)
const VGM_RATE_MAX_AGE = 864000;         // TCMB yayin tarihi en fazla 10 gun once (uzun bayram tatilleri)
const VGM_HOLD_RATIO = 0.25;             // kabul edilen fiyata gore +-%25'ten buyuk degisim personel onayi bekler
const VGM_QUOTE_TTL = 1800;              // sepet fiyat jetonu 30 dakika gecerli
const VGM_MAX_LINES = 40;
const VGM_HISTORY = 20;
const VGM_MAX_FILE = 4194304;            // ozel JSON dosyalari (4 MiB)
const VGM_ORDERS_MAX = 33554432;         // siparisler.json (32 MiB)
const VGM_REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VGM_DEFAULT_VAT = 20;
const VGM_STATUS_LABELS = [
    'odeme_bekleniyor' => 'Ödeme bekleniyor',
    'odeme_alindi' => 'Ödeme alındı',
    'tedarikte' => 'Tedarik ediliyor',
    'kargoda' => 'Kargoya verildi',
    'teslim_edildi' => 'Teslim edildi',
    'iptal' => 'İptal edildi',
    'iade' => 'İade edildi',
];
const VGM_TRANSITIONS = [
    'odeme_bekleniyor' => ['odeme_alindi', 'iptal'],
    'odeme_alindi' => ['tedarikte', 'iptal'],
    'tedarikte' => ['kargoda', 'iptal'],
    'kargoda' => ['teslim_edildi', 'iade', 'iptal'],
    'teslim_edildi' => ['iade'],
    'iptal' => [],
    'iade' => [],
];
/* firma.json: bu alanlardan biri bossa magaza siparise kapalidir (6563 / Mesafeli Sozlesmeler: satici kimligi). */
const VGM_FIRMA_REQUIRED = ['unvan', 'adres', 'il', 'telefon', 'eposta', 'mersis', 'vkn', 'vergiDairesi', 'iadeKargo', 'mudur', 'sermaye'];

/* ------------------------------------------------------------------ depolama */

function vgm_dir(): string
{
    $base = vg_private_data_directory(vg_data_dir());
    $dir = vg_private_data_directory($base . '/magaza', $base);
    vg_protect_dir($dir);
    return $dir;
}

/** Tum magaza yazmalari tek kilitte; okumalar paylasimli kilitte. */
function vgm_locked(bool $write, callable $work)
{
    $dir = vgm_dir();
    $file = $dir . '/store.lock';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('magaza lock cannot be opened');
    }
    @chmod($file, 0600);
    $deadline = microtime(true) + 8;
    do {
        $locked = flock($fp, ($write ? LOCK_EX : LOCK_SH) | LOCK_NB);
        if (!$locked) {
            usleep(20000);
        }
    } while (!$locked && microtime(true) < $deadline);
    if (!$locked) {
        fclose($fp);
        vg_unavailable('magaza lock timed out');
    }
    try {
        return $work($dir);
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vgm_read(string $dir, string $name, array $empty, int $max = VGM_MAX_FILE): array
{
    $file = $dir . '/' . $name;
    if (!is_file($file)) {
        return $empty;
    }
    $bytes = @filesize($file);
    if ($bytes === false || $bytes > $max) {
        vg_unavailable('magaza stored file exceeds limits');
    }
    $raw = @file_get_contents($file, false, null, 0, $max + 1);
    $state = is_string($raw) ? json_decode($raw, true, 64) : null;
    if (!is_array($state) || ($state['version'] ?? null) !== 1) {
        vg_unavailable('magaza stored JSON is invalid (' . $name . ')');
    }
    return $state;
}

/** Atomik yazma: gecici dosya + rename; canli dosya hic kesilmez. Cagiran ozel kilidi tutar. */
function vgm_write(string $dir, string $name, array $state, int $max = VGM_MAX_FILE): void
{
    $json = vg_json_encode($state);
    if (strlen($json) > $max) {
        vg_fail(507, 'storage_full', 'Mağaza kayıt sınırına ulaşıldı. Lütfen bizi telefonla arayın.');
    }
    $file = $dir . '/' . $name;
    $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $fp = @fopen($tmp, 'x+b');
    if ($fp === false) {
        vg_unavailable('magaza temporary file cannot be created');
    }
    @chmod($tmp, 0600);
    try {
        $offset = 0;
        while ($offset < strlen($json)) {
            $wrote = fwrite($fp, substr($json, $offset));
            if ($wrote === false || $wrote === 0) {
                vg_unavailable('magaza write failed');
            }
            $offset += $wrote;
        }
        if (!fflush($fp)) {
            vg_unavailable('magaza flush failed');
        }
        fclose($fp);
        $fp = null;
        if (!@rename($tmp, $file)) {
            vg_unavailable('magaza atomic replacement failed');
        }
        @chmod($file, 0600);
    } finally {
        if (is_resource($fp)) {
            fclose($fp);
        }
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
}

/* ------------------------------------------------------------------ herkese acik katalog ve satici */

/** Katalog/satici dosyasi. VG_MAGAZA_CATALOG / VG_MAGAZA_FIRMA yalnizca testlerde sentetik veri icin verilir. */
function vgm_lib_file(string $name, string $env): string
{
    $override = getenv($env);
    if (is_string($override) && $override !== '' && is_file($override)) {
        return $override;
    }
    return __DIR__ . '/magaza/' . $name;
}

/** api/lib/magaza/katalog.json: urunler id ile, slug -> id ve siralanmis kategoriler. Bozuk kayit atlanir. */
function vgm_catalog(): array
{
    static $catalog = null;
    if ($catalog !== null) {
        return $catalog;
    }
    $raw = @file_get_contents(vgm_lib_file('katalog.json', 'VG_MAGAZA_CATALOG'));
    $data = is_string($raw) ? json_decode($raw, true, 64) : null;
    if (!is_array($data) || ($data['version'] ?? null) !== 1 || !is_array($data['products'] ?? null)
        || !is_array($data['categories'] ?? null)) {
        vg_unavailable('magaza catalog is invalid');
    }
    $categories = [];
    foreach ($data['categories'] as $c) {
        if (is_array($c) && is_string($c['id'] ?? null) && preg_match('/^[a-z0-9-]{2,60}$/D', $c['id']) === 1) {
            $categories[$c['id']] = $c;
        }
    }
    uasort($categories, function (array $a, array $b): int {
        return ((int)($a['order'] ?? 0)) <=> ((int)($b['order'] ?? 0));
    });
    $products = [];
    $slugs = [];
    foreach ($data['products'] as $p) {
        if (!is_array($p) || !is_string($p['id'] ?? null) || preg_match('/^vgm-[0-9]{4,6}$/D', $p['id']) !== 1
            || !is_string($p['slug'] ?? null) || preg_match('/^[a-z0-9-]{3,90}$/D', $p['slug']) !== 1
            || !is_string($p['name'] ?? null) || !isset($categories[$p['category'] ?? ''])
            || isset($products[$p['id']]) || isset($slugs[$p['slug']])) {
            continue;
        }
        $p['vat'] = is_int($p['vat'] ?? null) && $p['vat'] >= 0 && $p['vat'] <= 30 ? $p['vat'] : VGM_DEFAULT_VAT;
        $p['shipping'] = ($p['shipping'] ?? '') === 'nakliye' ? 'nakliye' : 'kargo';
        $p['maxQty'] = is_int($p['maxQty'] ?? null) && $p['maxQty'] >= 1 && $p['maxQty'] <= 999 ? $p['maxQty'] : 50;
        $products[$p['id']] = $p;
        $slugs[$p['slug']] = $p['id'];
    }
    return $catalog = ['categories' => $categories, 'products' => $products, 'slugs' => $slugs];
}

function vgm_product(string $id): ?array
{
    return vgm_catalog()['products'][$id] ?? null;
}

function vgm_product_by_slug(string $slug): ?array
{
    $c = vgm_catalog();
    return isset($c['slugs'][$slug]) ? $c['products'][$c['slugs'][$slug]] : null;
}

function vgm_category(string $id): ?array
{
    return vgm_catalog()['categories'][$id] ?? null;
}

/** api/lib/magaza/firma.json: satici kimligi ve banka bilgisi (herkese acik). */
function vgm_firma(): array
{
    static $firma = null;
    if ($firma !== null) {
        return $firma;
    }
    $raw = @file_get_contents(vgm_lib_file('firma.json', 'VG_MAGAZA_FIRMA'));
    $data = is_string($raw) ? json_decode($raw, true, 8) : null;
    if (!is_array($data) || ($data['version'] ?? null) !== 1 || !is_array($data['banka'] ?? null)) {
        vg_unavailable('magaza seller identity is invalid');
    }
    return $firma = $data;
}

/** Eksik zorunlu satici/banka alanlari (bos dizi: tamam). */
function vgm_firma_missing(array $f): array
{
    $missing = [];
    foreach (VGM_FIRMA_REQUIRED as $key) {
        if (!is_string($f[$key] ?? null) || trim($f[$key]) === '') {
            $missing[] = $key;
        }
    }
    foreach (['ad', 'hesapSahibi', 'iban'] as $key) {
        if (!is_string($f['banka'][$key] ?? null) || trim($f['banka'][$key]) === '') {
            $missing[] = 'banka.' . $key;
        }
    }
    if (!in_array('banka.iban', $missing, true) && !vgm_iban_valid((string)$f['banka']['iban'])) {
        $missing[] = 'banka.iban';
    }
    return $missing;
}

/** TR IBAN: 26 karakter, mod-97 = 1 (bosluklar yok sayilir). */
function vgm_iban_valid(string $iban): bool
{
    $s = strtoupper((string)preg_replace('/\s+/', '', $iban));
    if (preg_match('/^TR[0-9]{24}$/D', $s) !== 1) {
        return false;
    }
    $moved = substr($s, 4) . substr($s, 0, 4);
    $digits = '';
    foreach (str_split($moved) as $ch) {
        $digits .= ctype_alpha($ch) ? (string)(ord($ch) - 55) : $ch;
    }
    $rem = 0;
    foreach (str_split($digits, 7) as $chunk) {
        $rem = (int)(((string)$rem . $chunk)) % 97;
    }
    return $rem === 1;
}

/* ------------------------------------------------------------------ ozel yapilandirma (kaynaklar.json) */

function vgm_config_default(): array
{
    return ['version' => 1, 'open' => false,
        'margin' => ['default' => 0.15, 'byCategory' => [], 'byProduct' => []],
        'shipping' => ['feeTry' => 0.0, 'freeOverTry' => 0.0],
        'paymentHours' => 24, 'fxBuffer' => 0.0, 'sources' => [], 'blockedSuppliers' => []];
}

/** Cagiran kilidi tutar. Dosya yoksa varsayilan (kapali magaza, kaynak yok). */
function vgm_config(string $dir): array
{
    $config = vgm_read($dir, 'kaynaklar.json', vgm_config_default());
    return array_replace(vgm_config_default(), $config);
}

function vgm_host(string $url): string
{
    $host = parse_url($url, PHP_URL_HOST);
    return is_string($host) ? (string)preg_replace('/^www\./', '', strtolower($host)) : '';
}

/**
 * tools/magaza-admin.php import: ozel yapilandirmayi dogrular ve temizler. Hata listesi bos degilse yazilmaz.
 * Kaynak alan adi blockedSuppliers icindeyse (Sikayetvar elemesi) reddedilir.
 */
function vgm_config_clean(array $in, array &$errors): array
{
    $errors = [];
    $catalog = vgm_catalog();
    $out = vgm_config_default();
    $ratio = function ($v, string $where, float $max) use (&$errors): ?float {
        if (!is_int($v) && !is_float($v)) {
            $errors[] = $where . ': sayı olmalı';
            return null;
        }
        if ($v < 0 || $v > $max) {
            $errors[] = $where . ': 0 ile ' . $max . ' arasında olmalı';
            return null;
        }
        return (float)$v;
    };
    if (($in['version'] ?? null) !== 1) {
        $errors[] = 'version: 1 olmalı';
    }
    $out['open'] = ($in['open'] ?? false) === true;
    $margin = is_array($in['margin'] ?? null) ? $in['margin'] : [];
    $out['margin']['default'] = $ratio($margin['default'] ?? 0.15, 'margin.default', 1.0) ?? 0.15;
    foreach ((array)($margin['byCategory'] ?? []) as $cat => $v) {
        if (!isset($catalog['categories'][$cat])) {
            $errors[] = 'margin.byCategory: bilinmeyen kategori ' . $cat;
        } elseif (($m = $ratio($v, 'margin.byCategory.' . $cat, 1.0)) !== null) {
            $out['margin']['byCategory'][$cat] = $m;
        }
    }
    foreach ((array)($margin['byProduct'] ?? []) as $id => $v) {
        if (!isset($catalog['products'][$id])) {
            $errors[] = 'margin.byProduct: bilinmeyen ürün ' . $id;
        } elseif (($m = $ratio($v, 'margin.byProduct.' . $id, 1.0)) !== null) {
            $out['margin']['byProduct'][$id] = $m;
        }
    }
    $ship = is_array($in['shipping'] ?? null) ? $in['shipping'] : [];
    $out['shipping']['feeTry'] = $ratio($ship['feeTry'] ?? 0, 'shipping.feeTry', 100000.0) ?? 0.0;
    $out['shipping']['freeOverTry'] = $ratio($ship['freeOverTry'] ?? 0, 'shipping.freeOverTry', 10000000.0) ?? 0.0;
    $hours = $in['paymentHours'] ?? 24;
    if (!is_int($hours) || $hours < 1 || $hours > 168) {
        $errors[] = 'paymentHours: 1–168 arası tam sayı olmalı';
    } else {
        $out['paymentHours'] = $hours;
    }
    $out['fxBuffer'] = $ratio($in['fxBuffer'] ?? 0, 'fxBuffer', 0.1) ?? 0.0;
    $blocked = [];
    foreach ((array)($in['blockedSuppliers'] ?? []) as $host) {
        $h = is_string($host) ? (string)preg_replace('/^www\./', '', strtolower(trim($host))) : '';
        if (preg_match('/^[a-z0-9.-]{3,100}$/D', $h) !== 1) {
            $errors[] = 'blockedSuppliers: geçersiz alan adı';
            continue;
        }
        $blocked[$h] = true;
    }
    $out['blockedSuppliers'] = array_keys($blocked);
    foreach ((array)($in['sources'] ?? []) as $id => $list) {
        if (!isset($catalog['products'][$id])) {
            $errors[] = 'sources: bilinmeyen ürün ' . $id;
            continue;
        }
        if (!is_array($list) || count($list) < 1 || count($list) > 5) {
            $errors[] = 'sources.' . $id . ': 1–5 kaynak olmalı';
            continue;
        }
        $clean = [];
        foreach (array_values($list) as $i => $src) {
            $where = 'sources.' . $id . '[' . $i . ']';
            $url = is_array($src) && is_string($src['url'] ?? null) ? trim($src['url']) : '';
            $host = vgm_host($url);
            if (strlen($url) > 600 || strpos($url, 'https://') !== 0 || $host === '' || preg_match('/[\x00-\x20"<>\\\\]/', $url) === 1) {
                $errors[] = $where . ': https adresi olmalı';
                continue;
            }
            $supplier = is_string($src['supplier'] ?? null) ? (string)preg_replace('/^www\./', '', strtolower(trim($src['supplier']))) : '';
            if ($supplier !== $host) {
                $errors[] = $where . ': supplier alan adı adresle aynı olmalı (' . $host . ')';
                continue;
            }
            if (isset($blocked[$host])) {
                $errors[] = $where . ': ' . $host . ' engelli tedarikçi listesinde (şikâyet incelemesi)';
                continue;
            }
            $currency = $src['currency'] ?? 'TRY';
            if (!in_array($currency, ['TRY', 'USD', 'EUR'], true)) {
                $errors[] = $where . ': currency TRY/USD/EUR olmalı';
                continue;
            }
            if (!is_bool($src['vatIncluded'] ?? null)) {
                $errors[] = $where . ': vatIncluded true/false olmalı';
                continue;
            }
            $priority = $src['priority'] ?? ($i + 1);
            if (!is_int($priority) || $priority < 1 || $priority > 9) {
                $errors[] = $where . ': priority 1–9 olmalı';
                continue;
            }
            /* Tedarikciyle anlasilan bayi indirimi: maliyet = sitedeki fiyat x (1 - discount). */
            $discount = $ratio($src['discount'] ?? 0, $where . '.discount', 0.5);
            if ($discount === null) {
                continue;
            }
            $clean[] = ['url' => $url, 'supplier' => $host, 'vatIncluded' => $src['vatIncluded'], 'currency' => $currency,
                'priority' => $priority, 'discount' => $discount];
        }
        usort($clean, function (array $a, array $b): int {
            return $a['priority'] <=> $b['priority'];
        });
        if ($clean) {
            $out['sources'][$id] = $clean;
        }
    }
    return $out;
}

function vgm_margin(array $config, array $p): float
{
    $m = is_array($config['margin'] ?? null) ? $config['margin'] : [];
    foreach ([$m['byProduct'][$p['id']] ?? null, $m['byCategory'][$p['category']] ?? null, $m['default'] ?? null] as $v) {
        if ((is_int($v) || is_float($v)) && $v >= 0 && $v <= 1) {
            return (float)$v;
        }
    }
    return 0.15;
}

/** Magaza siparise acik mi: sahibin karari (open) + eksiksiz satici kimligi ve gecerli IBAN. */
function vgm_shop_open(array $config): bool
{
    return ($config['open'] ?? false) === true && vgm_firma_missing(vgm_firma()) === [];
}

/** Urunun engellenmemis kaynaklari (oncelik sirasiyla). */
function vgm_sources(array $config, string $id): array
{
    $blocked = array_flip((array)($config['blockedSuppliers'] ?? []));
    $out = [];
    foreach ((array)($config['sources'][$id] ?? []) as $i => $src) {
        if (is_array($src) && !isset($blocked[$src['supplier'] ?? ''])) {
            $out[$i] = $src;
        }
    }
    return $out;
}

/* ------------------------------------------------------------------ calisma durumu (fiyat, kur) */

function vgm_prices_state(string $dir): array
{
    return vgm_read($dir, 'fiyatlar.json', ['version' => 1, 'items' => [], 'lastRunAt' => null, 'lastRunSummary' => null]);
}

function vgm_rate_state(string $dir): ?array
{
    $r = vgm_read($dir, 'kur.json', ['version' => 1]);
    return is_numeric($r['usdTry'] ?? null) && (float)$r['usdTry'] > 0 ? $r : null;
}

/** Kur kullanilabilir mi: son 48 saatte okunmus ve TCMB yayin tarihi son 10 gun icinde. */
function vgm_rate_ok(?array $rate, int $now): bool
{
    if ($rate === null || !is_numeric($rate['usdTry'] ?? null) || (float)$rate['usdTry'] <= 0) {
        return false;
    }
    $published = is_string($rate['date'] ?? null) ? strtotime($rate['date'] . 'T15:30:00+03:00') : false;
    return $now - (int)($rate['fetchedAt'] ?? 0) <= VGM_RATE_FETCH_MAX_AGE
        && $published !== false && $now - $published <= VGM_RATE_MAX_AGE;
}

/* ------------------------------------------------------------------ fiyat motoru */

function vgm_round2(float $v): float
{
    return round($v, 2, PHP_ROUND_HALF_UP);
}

function vgm_iso_time($v): ?int
{
    if (!is_string($v) || $v === '') {
        return null;
    }
    $t = strtotime($v);
    return $t === false ? null : $t;
}

/**
 * Gosterilecek ve tahsil edilecek fiyat. $s: fiyatlar.json'daki kayit (yoksa katalogdaki listUsd kullanilir).
 * Donus: usdNet (KDV haric USD), tryNet, tryGross (KDV dahil TL), vat, checkedAt, rateDate, basis (live|list|null),
 * orderable ve reason (ok|closed|stale|held|error|unavailable|no_rate|no_source|freight).
 */
function vgm_price(array $p, ?array $s, ?array $rate, array $config, bool $open, int $now): array
{
    $vat = (int)$p['vat'];
    $out = ['usdNet' => null, 'tryNet' => null, 'tryGross' => null, 'vat' => $vat, 'checkedAt' => null,
        'rateDate' => null, 'basis' => null, 'orderable' => false, 'reason' => 'no_source'];
    $usd = null;
    $status = 'ok';
    if (is_array($s) && is_numeric($s['costUsd'] ?? null) && is_int($s['checkedAt'] ?? null)) {
        $usd = vgm_round2((float)$s['costUsd'] * (1 + vgm_margin($config, $p)));
        $out['checkedAt'] = $s['checkedAt'];
        $out['basis'] = 'live';
        $status = (string)($s['status'] ?? 'error');
        if (($s['available'] ?? true) === false) {
            $status = 'unavailable';
        }
    } elseif ((is_int($p['listUsd'] ?? null) || is_float($p['listUsd'] ?? null)) && $p['listUsd'] > 0) {
        $usd = (float)$p['listUsd'];
        $out['checkedAt'] = vgm_iso_time($p['listCheckedAt'] ?? null);
        $out['basis'] = 'list';
        if (is_array($s) && isset($s['status'])) {
            /* Ilk kontrol held/gone/hata dondurduysa liste fiyati bunu gizleyemez. */
            $status = (string)$s['status'];
        }
        if (is_array($s) && ($s['available'] ?? true) === false) {
            $status = 'unavailable';
        }
    }
    if ($usd === null || $usd <= 0) {
        return $out;
    }
    $out['usdNet'] = $usd;
    $rateOk = vgm_rate_ok($rate, $now);
    if ($rateOk) {
        $out['rateDate'] = (string)$rate['date'];
        $buffer = (float)($config['fxBuffer'] ?? 0);
        $out['tryNet'] = vgm_round2($usd * (float)$rate['usdTry'] * (1 + $buffer));
        $out['tryGross'] = vgm_round2($out['tryNet'] * (1 + $vat / 100));
    }
    if ($p['shipping'] === 'nakliye') {
        $out['reason'] = 'freight';
    } elseif (!$rateOk) {
        $out['reason'] = 'no_rate';
    } elseif ($status === 'held') {
        $out['reason'] = 'held';
    } elseif ($status === 'unavailable') {
        $out['reason'] = 'unavailable';
    } elseif ($status === 'error' && preg_match('/identity_mismatch|ambiguous_price/', (string)($s['note'] ?? '')) === 1) {
        /* Sayfa baska bir urunu ya da celiskili fiyat gosteriyor: son kabul edilen fiyat 48 saat dolmadan da satilmaz.
           Gecici ag hatalarinda son dogrulanmis fiyat 48 saat boyunca gecerli kalir. */
        $out['reason'] = 'error';
    } elseif ($out['checkedAt'] === null || $now - $out['checkedAt'] > VGM_PRICE_MAX_AGE) {
        $out['reason'] = 'stale';
    } elseif (vgm_sources($config, $p['id']) === []
        || ($out['basis'] === 'live' && !isset(vgm_sources($config, $p['id'])[(int)($s['source'] ?? -1)]))) {
        /* Fiyati veren kaynak sonradan engellendiyse/kaldirildiysa o fiyatla satilmaz; yeni kaynaktan kontrol beklenir. */
        $out['reason'] = 'no_source';
    } elseif ($out['basis'] !== 'live') {
        /* listUsd yalnizca gosterim icindir; siparis icin canli tedarikci dogrulamasi (status ok) gerekir. */
        $out['reason'] = 'stale';
    } elseif (!$open) {
        $out['reason'] = 'closed';
    } else {
        $out['reason'] = 'ok';
        $out['orderable'] = true;
    }
    return $out;
}

/** Sipariş verilemeyen fiyatin musteriye gosterilecek aciklamasi. */
function vgm_reason_text(string $reason): string
{
    $map = [
        'ok' => '',
        'closed' => 'Mağazamız çok yakında siparişe açılacak. Bu ürün için şimdiden teklif isteyebilirsiniz.',
        'stale' => 'Fiyat teyidi bekleniyor. Güncel fiyat ve stok için teklif isteyin.',
        'held' => 'Tedarik fiyatı değişti; ekibimiz kontrol ediyor. Güncel fiyat için teklif isteyin.',
        'error' => 'Fiyat şu anda doğrulanamadı. Güncel fiyat için teklif isteyin.',
        'unavailable' => 'Tedarik stoğunda yok. Benzer ürün veya termin için teklif isteyin.',
        'no_rate' => 'Döviz kuru güncellenemedi. Lütfen kısa süre sonra tekrar deneyin veya teklif isteyin.',
        'no_source' => 'Bu ürün şu anda çevrim içi satışta değil. Teklif isteyin.',
        'freight' => 'Bu ürün ağır/hacimli olduğu için nakliye dahil teklif ile satılır.',
    ];
    return $map[$reason] ?? $map['error'];
}

/**
 * Bir tedarikci kontrolunun sonucunu urun kaydina isler (cron, canli kontrol ve panelin elle girisi).
 * $offer: ['price'=>float,'currency'=>TRY|USD|EUR,'vatIncluded'=>bool,'available'=>bool,'method'=>string,
 *          'discount'=>?float (kaynagin bayi indirimi, 0-0.5)] ya da hata: ['error'=>kod,'gone'=>bool].
 * $rates: ['USD'=>float,'EUR'=>?float] (TL karsiliklari, kontrol ani).
 * Kabul edilen degerler (costTry/costUsd/rateAtCheck/checkedAt) yalnizca gecerli ve olagan bir teklifle degisir.
 */
function vgm_apply_check(?array $item, array $p, int $sourceIndex, array $offer, array $rates, int $now): array
{
    $item = is_array($item) ? $item : ['status' => 'error', 'history' => []];
    $item['lastAttemptAt'] = $now;
    $item['history'] = array_slice(is_array($item['history'] ?? null) ? $item['history'] : [], -(VGM_HISTORY - 1));
    if (isset($offer['error'])) {
        $item['status'] = !empty($offer['gone']) ? 'unavailable' : 'error';
        if (!empty($offer['gone'])) {
            $item['available'] = false;
        }
        $item['note'] = vg_text((string)$offer['error'], 120);
        $item['history'][] = [$now, null, $item['status']];
        return $item;
    }
    $usdTry = (float)($rates['USD'] ?? 0);
    $price = (float)($offer['price'] ?? 0);
    $currency = (string)($offer['currency'] ?? 'TRY');
    $toTry = $currency === 'TRY' ? 1.0 : (float)($rates[$currency] ?? 0);
    if ($usdTry <= 0 || $toTry <= 0 || $price <= 0 || !is_finite($price)) {
        $item['status'] = 'error';
        $item['note'] = $usdTry <= 0 ? 'kur yok' : 'geçersiz fiyat';
        $item['history'][] = [$now, null, 'error'];
        return $item;
    }
    $vatFactor = 1 + ((int)$p['vat']) / 100;
    $discount = is_int($offer['discount'] ?? null) || is_float($offer['discount'] ?? null) ? min(0.5, max(0.0, (float)$offer['discount'])) : 0.0;
    $gross = $price * (1 - $discount) * $toTry * (($offer['vatIncluded'] ?? true) ? 1 : $vatFactor);
    $costTry = vgm_round2($gross);
    $costUsd = round($gross / $vatFactor / $usdTry, 4);
    $candidate = ['costTry' => $costTry, 'costUsd' => $costUsd, 'rateAtCheck' => $usdTry, 'at' => $now,
        'source' => $sourceIndex, 'method' => vg_text((string)($offer['method'] ?? ''), 40)];
    $available = ($offer['available'] ?? true) !== false;
    $prev = is_numeric($item['costUsd'] ?? null) ? (float)$item['costUsd'] : null;
    $manual = strpos($candidate['method'], 'manual') === 0;
    /* Ilk kabulde onceki deger yok: katalogdaki dogrulanmis liste fiyatiyla (marj dahil) karsilastirilir; yanlis
       yerel ayar / 1000 kat hatali okuma canliya cikmasin. */
    if (!$manual && $prev === null && (is_int($p['listUsd'] ?? null) || is_float($p['listUsd'] ?? null)) && $p['listUsd'] > 0) {
        $ratio = $costUsd / ((float)$p['listUsd'] / 1.15);
        if ($ratio < 0.5 || $ratio > 1.5) {
            $prev = (float)$p['listUsd'] / 1.15;
        }
    }
    if (!$manual && $prev !== null && $prev > 0 && abs($costUsd - $prev) / $prev > VGM_HOLD_RATIO) {
        $item['status'] = 'held';
        $item['held'] = $candidate + ['prevCostTry' => $item['costTry'] ?? null, 'available' => $available];
        $item['note'] = 'Fiyat değişimi %' . (string)round(abs($costUsd - $prev) / $prev * 100) . ' — personel onayı bekliyor';
        $item['history'][] = [$now, $costTry, 'held'];
        return $item;
    }
    $item['costTry'] = $costTry;
    $item['costUsd'] = $costUsd;
    $item['rateAtCheck'] = $usdTry;
    $item['checkedAt'] = $now;
    $item['source'] = $sourceIndex;
    $item['method'] = $candidate['method'];
    $item['available'] = $available;
    $item['status'] = $available ? 'ok' : 'unavailable';
    $item['held'] = null;
    $item['note'] = '';
    $item['history'][] = [$now, $costTry, $item['status']];
    return $item;
}

/** Panel karari: held fiyati onayla, reddet. Elle giris vgm_apply_check(... method 'manual:<ad>') ile yapilir. */
function vgm_decide_held(array $item, string $decision, string $note, int $now): array
{
    $held = is_array($item['held'] ?? null) ? $item['held'] : null;
    if ($held === null) {
        vg_fail(409, 'not_held', 'Bu ürün için onay bekleyen fiyat yok.');
    }
    if ($decision === 'approve') {
        foreach (['costTry', 'costUsd', 'rateAtCheck', 'source', 'method'] as $k) {
            $item[$k] = $held[$k];
        }
        $item['checkedAt'] = (int)$held['at'];
        $item['available'] = ($held['available'] ?? true) !== false;
        $item['status'] = $item['available'] ? 'ok' : 'unavailable';
    } else {
        $item['status'] = 'error';
    }
    $item['held'] = null;
    $item['note'] = vg_text($note, 200);
    $item['history'] = array_slice(is_array($item['history'] ?? null) ? $item['history'] : [], -(VGM_HISTORY - 1));
    $item['history'][] = [$now, $decision === 'approve' ? $item['costTry'] : null, 'decision:' . $decision];
    return $item;
}

/* ------------------------------------------------------------------ sepet ve fiyat jetonu */

/** Istemci sepeti: [{id, qty}] — bilinmeyen urun, gecersiz adet, fazla satir reddedilir; ayni urun birlestirilir. */
function vgm_cart_items($items): array
{
    if (!is_array($items) || ($items !== [] && array_keys($items) !== range(0, count($items) - 1))) {
        vg_fail(400, 'invalid_cart', 'Sepet okunamadı. Sayfayı yenileyip tekrar deneyin.');
    }
    if (count($items) === 0) {
        vg_fail(422, 'empty_cart', 'Sepetiniz boş.');
    }
    if (count($items) > VGM_MAX_LINES) {
        vg_fail(422, 'cart_too_large', 'Sepette en fazla ' . VGM_MAX_LINES . ' farklı ürün olabilir.');
    }
    $out = [];
    foreach ($items as $row) {
        $id = is_array($row) && is_string($row['id'] ?? null) ? $row['id'] : '';
        $qty = is_array($row) ? ($row['qty'] ?? null) : null;
        $p = $id !== '' ? vgm_product($id) : null;
        if ($p === null) {
            vg_fail(422, 'unknown_product', 'Sepetteki bir ürün artık satışta değil. Sepetinizi yenileyin.');
        }
        if (!is_int($qty) || $qty < 1) {
            vg_fail(422, 'invalid_qty', 'Ürün adedi geçersiz.');
        }
        $out[$id] = ($out[$id] ?? 0) + $qty;
        if ($out[$id] > $p['maxQty']) {
            vg_fail(422, 'qty_limit', $p['name'] . ' için en fazla ' . $p['maxQty'] . ' ' . ($p['unit'] ?? 'adet') . ' sipariş verilebilir; daha fazlası için teklif isteyin.');
        }
    }
    return $out;
}

function vgm_sign(string $purpose, string $payload): string
{
    return vg_b64url(hash_hmac('sha256', 'magaza:' . $purpose . "\0" . $payload, vg_secret(), true));
}

function vgm_token_encode(string $purpose, array $data): string
{
    $body = vg_b64url(vg_json_encode($data));
    return $body . '.' . vgm_sign($purpose, $body);
}

function vgm_token_decode(string $purpose, string $token, int $now): ?array
{
    if (strlen($token) > 16384 || preg_match('/^([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{43})$/D', $token, $m) !== 1) {
        return null;
    }
    if (!hash_equals(vgm_sign($purpose, $m[1]), $m[2])) {
        return null;
    }
    $b64 = strtr($m[1], '-_', '+/');
    $json = base64_decode($b64 . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
    $data = is_string($json) ? json_decode($json, true, 8) : null;
    if (!is_array($data) || ($data['v'] ?? null) !== 1 || !is_int($data['exp'] ?? null) || $data['exp'] < $now) {
        return null;
    }
    return $data;
}

/**
 * Sepet fiyati (cagiran kilidi tutmaz; okuma kilidi icinde durum alinir). $cart: vgm_cart_items() ciktisi.
 * Siparis verilebilen satirlar imzali jetona girer; jeton 30 dk icinde siparise donusturulebilir.
 */
function vgm_quote(array $cart, int $now): array
{
    list($config, $state, $rate) = vgm_locked(false, function (string $dir): array {
        return [vgm_config($dir), vgm_prices_state($dir), vgm_rate_state($dir)];
    });
    $open = vgm_shop_open($config);
    $lines = [];
    $signed = [];
    $tryNet = 0.0;
    $tryGross = 0.0;
    $usdNet = 0.0;
    $warnings = [];
    foreach ($cart as $id => $qty) {
        $p = vgm_product($id);
        $price = vgm_price($p, $state['items'][$id] ?? null, $rate, $config, $open, $now);
        /* Musteriye USD tutar gosterilmez (sahibin karari); USD yalnizca imzali jetonda ve siparis kaydinda. */
        $line = ['id' => $id, 'slug' => $p['slug'], 'name' => $p['name'], 'brand' => $p['brand'] ?? '', 'qty' => $qty,
            'unit' => $p['unit'] ?? 'adet', 'vat' => $price['vat'],
            'unitTryNet' => $price['tryNet'], 'unitTryGross' => $price['tryGross'], 'lineTryGross' => null,
            'checkedAt' => $price['checkedAt'] !== null ? vg_iso($price['checkedAt']) : null,
            'orderable' => $price['orderable'], 'reason' => $price['reason'], 'reasonText' => vgm_reason_text($price['reason']),
            'mpn' => $p['mpn'] ?? '', 'specs' => vgm_specs_snapshot($p), 'deliveryDays' => isset($p['deliveryDays']) ? (int)$p['deliveryDays'] : null,
            'customMade' => ($p['customMade'] ?? false) === true];
        if ($price['orderable']) {
            $lineNet = vgm_round2($price['tryNet'] * $qty);
            $lineGross = vgm_round2($price['tryGross'] * $qty);
            $line['lineTryGross'] = $lineGross;
            $tryNet += $lineNet;
            $tryGross += $lineGross;
            $usdNet += $price['usdNet'] * $qty;
            $signed[] = [$id, $qty, $price['usdNet'], $price['tryNet'], $price['tryGross'], $price['vat']];
        } else {
            $warnings[] = $p['name'] . ': ' . vgm_reason_text($price['reason']);
        }
        $lines[] = $line;
    }
    $ship = is_array($config['shipping'] ?? null) ? $config['shipping'] : [];
    $fee = (float)($ship['feeTry'] ?? 0);
    $freeOver = (float)($ship['freeOverTry'] ?? 0);
    $shippingTry = ($signed && $fee > 0 && ($freeOver <= 0 || $tryGross < $freeOver)) ? vgm_round2($fee) : 0.0;
    $totals = ['tryNet' => vgm_round2($tryNet), 'tryVat' => vgm_round2($tryGross - $tryNet), 'shippingTry' => $shippingTry,
        'tryGross' => vgm_round2($tryGross + $shippingTry)];
    $quote = null;
    if ($signed) {
        $exp = $now + VGM_QUOTE_TTL;
        $quote = ['token' => vgm_token_encode('quote', ['v' => 1, 'exp' => $exp, 'lines' => $signed,
            'shippingTry' => $shippingTry, 'totals' => $totals + ['usdNet' => vgm_round2($usdNet)],
            'rate' => ['usdTry' => (float)$rate['usdTry'], 'date' => (string)$rate['date']]]),
            'expiresAt' => vg_iso($exp)];
    }
    return ['open' => $open, 'lines' => $lines, 'totals' => $totals, 'quote' => $quote, 'warnings' => $warnings,
        'rate' => vgm_rate_ok($rate, $now) ? ['usdTry' => (float)$rate['usdTry'], 'date' => (string)$rate['date']] : null,
        'shipping' => ['feeTry' => vgm_round2($fee), 'freeOverTry' => vgm_round2($freeOver)]];
}

/* ------------------------------------------------------------------ siparis */

/** Ornek: VGS-261027-7K3QX (TSI tarihi + 5 karakter; karisan 0/O, 1/I harfleri yok). */
function vgm_reference(): string
{
    try {
        $date = (new DateTime('now', new DateTimeZone('Europe/Istanbul')))->format('ymd');
    } catch (Throwable $e) {
        $date = gmdate('ymd');
    }
    $suffix = '';
    for ($i = 0; $i < 5; $i++) {
        $suffix .= VGM_REF_CHARS[random_int(0, strlen(VGM_REF_CHARS) - 1)];
    }
    return 'VGS-' . $date . '-' . $suffix;
}

function vgm_reference_valid(string $ref): bool
{
    return preg_match('/^VGS-[0-9]{6}-[A-HJ-NP-Z2-9]{5}$/D', $ref) === 1;
}

/**
 * Siparisi en fazla bir kez olusturur (contact.php'deki vg_enquiry_once ile ayni sozlesme, ayri kayit klasoru).
 * $create(): string referans dondurur ya da vg_fail ile cikar; kayit yalnizca basaridan sonra yazilir. Ayni kimlik
 * ayni icerikle gelirse ilk referans doner; farkli icerikle gelirse 409.
 * @return array{reference: string, duplicate: bool}
 */
function vgm_order_once(string $requestId, string $fingerprint, callable $create): array
{
    if (preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $requestId) !== 1) {
        vg_fail(400, 'invalid_request', 'Sipariş bilgisi eksik. Sayfayı yenileyip yeniden deneyin.');
    }
    $base = vgm_dir();
    $dir = vg_private_data_directory($base . '/istekler', $base);
    $file = $dir . '/' . hash_hmac('sha256', 'siparis' . "\0" . $requestId, vg_secret()) . '.json';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('order request record cannot be opened');
    }
    try {
        if (!flock($fp, LOCK_EX)) {
            vg_unavailable('order request record cannot be locked');
        }
        $raw = stream_get_contents($fp);
        $record = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        if (is_array($record) && is_string($record['reference'] ?? null) && is_string($record['fp'] ?? null)) {
            if (hash_equals($record['fp'], $fingerprint)) {
                return ['reference' => $record['reference'], 'duplicate' => true];
            }
            vg_fail(409, 'already_received', 'Bu sipariş ' . $record['reference'] . ' numarasıyla daha önce alındı. Yeni bir sipariş için sayfayı yenileyin.',
                [], [], ['reference' => $record['reference']]);
        }
        $reference = $create();
        $encoded = vg_json_encode(['reference' => $reference, 'fp' => $fingerprint, 'at' => vg_now()]);
        if (!(rewind($fp) && ftruncate($fp, 0) && fwrite($fp, $encoded) === strlen($encoded) && fflush($fp))) {
            error_log('VoltGuard magaza: order request record write failed');
        }
        @chmod($file, 0600);
        return ['reference' => $reference, 'duplicate' => false];
    } finally {
        @flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vgm_orders_read(string $dir): array
{
    return vgm_read($dir, 'siparisler.json', ['version' => 1, 'orders' => []], VGM_ORDERS_MAX);
}

function vgm_orders_write(string $dir, array $state): void
{
    vgm_write($dir, 'siparisler.json', $state, VGM_ORDERS_MAX);
}

function vgm_transition_ok(string $from, string $to): bool
{
    return in_array($to, VGM_TRANSITIONS[$from] ?? [], true);
}

/** Siparis kaydina yazilan ana teknik ozellikler (on bilgilendirme formu icin; en fazla 8 satir). */
function vgm_specs_snapshot(array $p): array
{
    $out = [];
    foreach (is_array($p['specs'] ?? null) ? $p['specs'] : [] as $row) {
        if (is_array($row) && count($row) >= 2 && is_string($row[0]) && (is_string($row[1]) || is_numeric($row[1]))) {
            $out[] = [vgm_clip((string)$row[0], 60), vgm_clip((string)$row[1], 120)];
        }
        if (count($out) >= 8) {
            break;
        }
    }
    return $out;
}

/** Musteriye gosterilebilecek siparis gorunumu: tedarikci, maliyet ve ic notlar yok. */
function vgm_order_public(array $o): array
{
    $items = [];
    foreach ($o['items'] as $it) {
        $items[] = ['name' => $it['name'], 'brand' => $it['brand'] ?? '', 'mpn' => $it['mpn'] ?? '', 'qty' => $it['qty'],
            'unit' => $it['unit'] ?? 'adet', 'unitTryGross' => $it['unitTryGross'], 'lineTryGross' => $it['lineTryGross']];
    }
    $history = [];
    foreach ($o['history'] as $h) {
        $history[] = ['at' => vg_iso((int)$h['at']), 'status' => $h['status'], 'label' => VGM_STATUS_LABELS[$h['status']] ?? $h['status'],
            'note' => (string)($h['publicNote'] ?? '')];
    }
    return ['reference' => $o['ref'], 'createdAt' => vg_iso((int)$o['createdAt']), 'status' => $o['status'],
        'statusLabel' => VGM_STATUS_LABELS[$o['status']] ?? $o['status'], 'payBy' => vg_iso((int)$o['payBy']),
        'items' => $items, 'totals' => array_diff_key($o['totals'], ['usdNet' => 1]), 'rate' => $o['rate'], 'history' => $history,
        'tracking' => $o['tracking'] ?? null];
}

/* ------------------------------------------------------------------ panel yetkisi */

function vgm_panel_state(string $dir): array
{
    return vgm_read($dir, 'panel.json', ['version' => 1, 'users' => []], 65536);
}

/** Panel yetkisi verir (tools/magaza-admin.php grant). Uye kimligi hesap deposundan cozulmus olmalidir. */
function vgm_panel_grant(string $userId, string $email, int $now): void
{
    vgm_locked(true, function (string $dir) use ($userId, $email, $now): void {
        $state = vgm_panel_state($dir);
        $state['users'][$userId] = ['email' => $email, 'grantedAt' => $now];
        vgm_write($dir, 'panel.json', $state, 65536);
    });
}

/** Yetkiyi geri alir; yetki yoksa false. */
function vgm_panel_revoke(string $userId): bool
{
    return (bool)vgm_locked(true, function (string $dir) use ($userId): bool {
        $state = vgm_panel_state($dir);
        if (!isset($state['users'][$userId])) {
            return false;
        }
        unset($state['users'][$userId]);
        vgm_write($dir, 'panel.json', $state, 65536);
        return true;
    });
}

/** [userId => ['email','grantedAt']] */
function vgm_panel_list(): array
{
    return (array)vgm_locked(false, function (string $dir): array {
        return (array)vgm_panel_state($dir)['users'];
    });
}

/** Uye hesabinin magaza paneli yetkisi (tools/magaza-admin.php grant). */
function vgm_is_panel(?array $user): bool
{
    if ($user === null || !is_string($user['id'] ?? null)) {
        return false;
    }
    return (bool)vgm_locked(false, function (string $dir) use ($user): bool {
        $users = vgm_panel_state($dir)['users'];
        return is_array($users) && isset($users[$user['id']]);
    });
}

/* ------------------------------------------------------------------ bicimlendirme */

function vgm_fmt_try(float $v): string
{
    return number_format($v, 2, ',', '.') . ' ₺';
}

function vgm_fmt_usd(float $v): string
{
    return number_format($v, 2, ',', '.') . ' USD';
}

function vgm_local(int $ts, string $format = 'd.m.Y H:i'): string
{
    try {
        $d = new DateTime('@' . $ts);
        $d->setTimezone(new DateTimeZone('Europe/Istanbul'));
        return $d->format($format);
    } catch (Throwable $e) {
        return gmdate($format, $ts) . ' UTC';
    }
}
