<?php
/*
 * VoltGuard Magaza yonetimi. Yalnizca sunucu terminalinden; HTTP ile asla calismaz (tools/volthaber-admin.php ile ayni kalip).
 *
 *   php tools/magaza-admin.php grant <uye-e-posta>          panel yetkisi ver
 *   php tools/magaza-admin.php revoke <uye-e-posta>         yetkiyi geri al
 *   php tools/magaza-admin.php list                         yetkilileri listele
 *   php tools/magaza-admin.php import <dosya> [--dry-run]   ozel kaynak/marj yapilandirmasini dogrula ve yaz
 *   php tools/magaza-admin.php export-config                yapilandirmayi JSON olarak yazdir
 *   php tools/magaza-admin.php orders [--status durum]      siparisleri listele
 *   php tools/magaza-admin.php order <referans> [--json]    tek siparis
 *   php tools/magaza-admin.php set-status <referans> <durum> [--note ..] [--public-note ..] [--tracking "Firma|Kod"] [--notify]
 *   php tools/magaza-admin.php status [--json]              panel "Durum" sekmesiyle ayni veri
 *   php tools/magaza-admin.php check [--product vgm-0001]   fiyat/kur kontrolunu simdi calistir
 *
 * Cikis kodlari: 0 basarili, 1 basarisiz, 2 kullanim hatasi. VG_DATA_DIR (sunucunun ozel veri klasoru) zorunludur.
 * Cikti operatorun terminaline gider: tedarikci adresleri ve maliyetler burada gorunebilir; hicbir dosyaya veya
 * gunluge yazilmaz.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
$lib = dirname(__DIR__) . '/api/lib/';
require_once $lib . 'bootstrap.php';
require_once $lib . 'store.php';
require_once $lib . 'security.php';
require_once $lib . 'validate.php';
require_once $lib . 'mailer.php';
require_once $lib . 'magaza.php';
foreach (['magaza-belge.php', 'magaza-kaynak.php', 'magaza-siparis.php', 'magaza-api.php'] as $optional) {
    if (is_file($lib . $optional)) {
        require_once $lib . $optional;
    }
}
unset($lib, $optional);

$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);

const VGMA_PANEL_LIMIT = 25;

function vgma_usage(): string
{
    return "Kullanım:\n"
        . "  php tools/magaza-admin.php grant <üye-e-posta>          Mağaza paneli yetkisi verir\n"
        . "  php tools/magaza-admin.php revoke <üye-e-posta>         Yetkiyi geri alır\n"
        . "  php tools/magaza-admin.php list                         Yetkilileri listeler\n"
        . "  php tools/magaza-admin.php import <dosya> [--dry-run]   Kaynak/marj yapılandırmasını doğrular ve yazar\n"
        . "  php tools/magaza-admin.php export-config                Yapılandırmayı JSON olarak yazdırır\n"
        . "  php tools/magaza-admin.php orders [--status durum]      Siparişleri listeler\n"
        . "  php tools/magaza-admin.php order <referans> [--json]    Tek siparişin ayrıntısı\n"
        . "  php tools/magaza-admin.php set-status <referans> <durum> [--note \"...\"] [--public-note \"...\"]\n"
        . "                                [--tracking \"Firma|Kod\"] [--notify]\n"
        . "  php tools/magaza-admin.php status [--json]              Mağaza durumu (panelin Durum sekmesiyle aynı)\n"
        . "  php tools/magaza-admin.php check [--product vgm-0001]   Fiyat ve kur kontrolünü şimdi çalıştırır\n"
        . "Durumlar: " . implode(', ', array_keys(VGM_STATUS_LABELS)) . "\n"
        . "VG_DATA_DIR ortam değişkeni sunucunun özel veri klasörünü göstermelidir.\n";
}

function vgma_err(string $message): void
{
    fwrite(STDERR, $message . "\n");
}

/**
 * Argumanlari ayristirir: --ad deger, --ad=deger ve bayraklar. Bilinmeyen secenek ya da eksik deger: null.
 * @return array{0: array, 1: array}|null [konumsal, secenekler]
 */
function vgma_parse(array $args, array $valued, array $flags): ?array
{
    $pos = [];
    $opt = [];
    $count = count($args);
    for ($i = 0; $i < $count; $i++) {
        $a = (string)$args[$i];
        if (strlen($a) > 2 && substr($a, 0, 2) === '--') {
            $name = substr($a, 2);
            $value = null;
            $eq = strpos($name, '=');
            if ($eq !== false) {
                $value = substr($name, $eq + 1);
                $name = substr($name, 0, $eq);
            }
            if (in_array($name, $flags, true)) {
                if ($value !== null) {
                    return null;
                }
                $opt[$name] = true;
            } elseif (in_array($name, $valued, true)) {
                if ($value === null) {
                    if ($i + 1 >= $count) {
                        return null;
                    }
                    $value = (string)$args[++$i];
                }
                $opt[$name] = $value;
            } else {
                return null;
            }
            continue;
        }
        $pos[] = $a;
    }
    return [$pos, $opt];
}

function vgma_ts($v): int
{
    if (is_int($v)) {
        return $v;
    }
    if (is_float($v) || (is_string($v) && preg_match('/^[0-9]+$/D', $v) === 1)) {
        return (int)$v;
    }
    return (int)(vgm_iso_time($v) ?? 0);
}

/** Karakter (bayt degil) genisligine gore bosluk doldurur; sigmayan metin kirpilir. */
function vgma_pad(string $s, int $width, bool $left = false): string
{
    $s = vg_substr($s, $width);
    $fill = str_repeat(' ', max(0, $width - vg_strlen($s)));
    return $left ? $fill . $s : $s . $fill;
}

function vgma_when($v): string
{
    $t = vgma_ts($v);
    return $t > 0 ? vgm_local($t) : '-';
}

function vgma_label(string $status): string
{
    return VGM_STATUS_LABELS[$status] ?? $status;
}

/* ------------------------------------------------------------------ uyeler ve yetki */

/** Uye hesabi: e-posta normalize edilir, hesap deposundan aranir. */
function vgma_member(string $email): ?array
{
    $e = vg_normalize_email($email);
    return $e === '' ? null : vg_store()->findUserByEmail($e);
}

function vgma_cmd_grant(array $pos): int
{
    if (count($pos) !== 1 || vg_normalize_email($pos[0]) === '') {
        vgma_err("Geçerli bir üye e-postası verin.\n" . vgma_usage());
        return 2;
    }
    $user = vgma_member($pos[0]);
    if ($user === null) {
        vgma_err('Hesap bulunamadı. Önce normal bir üyelik hesabı oluşturulmalı.');
        return 1;
    }
    $list = vgm_panel_list();
    if (isset($list[$user['id']])) {
        echo "Bu üye zaten mağaza paneli yetkilisi.\n";
        return 0;
    }
    if (count($list) >= VGMA_PANEL_LIMIT) {
        vgma_err('Panel yetkilisi sınırına ulaşıldı (' . VGMA_PANEL_LIMIT . ').');
        return 1;
    }
    vgm_panel_grant($user['id'], $user['email'], vg_now());
    echo "Mağaza paneli yetkisi verildi: " . $user['email'] . "\n";
    return 0;
}

function vgma_cmd_revoke(array $pos): int
{
    if (count($pos) !== 1 || vg_normalize_email($pos[0]) === '') {
        vgma_err("Geçerli bir üye e-postası verin.\n" . vgma_usage());
        return 2;
    }
    $email = vg_normalize_email($pos[0]);
    $user = vgma_member($email);
    $id = $user['id'] ?? '';
    if ($id === '') {
        /* Hesap silinmis olabilir: yetki kaydindaki e-postadan bul. */
        foreach (vgm_panel_list() as $uid => $row) {
            if (is_array($row) && strtolower((string)($row['email'] ?? '')) === $email) {
                $id = (string)$uid;
                break;
            }
        }
    }
    if ($id === '') {
        vgma_err('Hesap veya panel yetkisi bulunamadı.');
        return 1;
    }
    echo vgm_panel_revoke($id) ? "Mağaza paneli yetkisi geri alındı: " . $email . "\n" : "Bu üyenin mağaza paneli yetkisi zaten yoktu.\n";
    return 0;
}

function vgma_cmd_list(): int
{
    $list = vgm_panel_list();
    if (!$list) {
        echo "Mağaza paneli yetkilisi yok.\n";
        return 0;
    }
    foreach ($list as $id => $row) {
        $row = is_array($row) ? $row : [];
        echo $id . '  ' . (string)($row['email'] ?? '-') . '  ' . vgma_when($row['grantedAt'] ?? 0) . "\n";
    }
    return 0;
}

/* ------------------------------------------------------------------ yapilandirma */

function vgma_cmd_import(array $pos, array $opt): int
{
    if (count($pos) !== 1) {
        vgma_err("İçe aktarılacak dosyayı verin.\n" . vgma_usage());
        return 2;
    }
    $file = $pos[0];
    $size = is_file($file) && is_readable($file) ? filesize($file) : false;
    if ($size === false || $size > 1048576) {
        vgma_err('Dosya okunamadı ya da 1 MiB sınırını aşıyor.');
        return 1;
    }
    $raw = (string)file_get_contents($file);
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
        $raw = substr($raw, 3);
    }
    $in = json_decode($raw, true, 64);
    if (!is_array($in)) {
        vgma_err(json_last_error() === JSON_ERROR_NONE ? 'Geçersiz JSON: kök değer bir nesne olmalı.' : 'Geçersiz JSON: ' . json_last_error_msg());
        return 1;
    }
    $errors = [];
    $clean = vgm_config_clean($in, $errors);
    if ($errors) {
        $errors = array_values(array_unique($errors));
        foreach ($errors as $e) {
            vgma_err('- ' . $e);
        }
        vgma_err(count($errors) . ' hata var; hiçbir şey yazılmadı.');
        return 1;
    }
    $sources = 0;
    foreach ($clean['sources'] as $list) {
        $sources += count($list);
    }
    $unsourced = 0;
    foreach (vgm_catalog()['products'] as $id => $p) {
        if (!isset($clean['sources'][$id])) {
            $unsourced++;
        }
    }
    if (!isset($opt['dry-run'])) {
        vgm_locked(true, function (string $dir) use ($clean): void {
            vgm_write($dir, 'kaynaklar.json', $clean);
        });
    }
    echo (isset($opt['dry-run']) ? 'Doğrulama başarılı (dosya yazılmadı)' : 'Yapılandırma içe aktarıldı') . ': '
        . count($clean['sources']) . ' üründe toplam ' . $sources . " kaynak, mağaza " . ($clean['open'] ? 'AÇIK' : 'kapalı') . ".\n";
    if ($unsourced > 0) {
        echo 'Not: ' . $unsourced . " üründe kaynak yok; bu ürünler siparişe kapalı kalır.\n";
    }
    $missing = vgm_firma_missing(vgm_firma());
    if ($clean['open'] && $missing) {
        echo 'UYARI: "open": true ama satıcı bilgileri eksik (' . implode(', ', $missing) . "); mağaza bunlar tamamlanana kadar kapalı kalır.\n";
    }
    return 0;
}

function vgma_cmd_export_config(): int
{
    $config = vgm_locked(false, function (string $dir): array {
        return vgm_config($dir);
    });
    /* Bos haritalar JSON'da [] degil {} olsun (disa aktarilan dosya dogrudan duzenlenip tekrar yuklenebilir). */
    foreach (['byCategory', 'byProduct'] as $key) {
        if (empty($config['margin'][$key])) {
            $config['margin'][$key] = new stdClass();
        }
    }
    if (empty($config['sources'])) {
        $config['sources'] = new stdClass();
    }
    echo vg_json_encode($config, true) . "\n";
    return 0;
}

/* ------------------------------------------------------------------ siparisler */

/** Siparis kaydi: siparis modulu varsa onun fonksiyonu, yoksa cekirdek okuyucu. */
function vgma_order(string $ref): ?array
{
    if (function_exists('vgm_order_get')) {
        return vgm_order_get($ref);
    }
    $orders = vgm_locked(false, function (string $dir): array {
        return (array)vgm_orders_read($dir)['orders'];
    });
    return is_array($orders[$ref] ?? null) ? $orders[$ref] : null;
}

/** Tum siparisler (yeniden eskiye); status verilirse yalnizca o durum. */
function vgma_orders(?string $status): array
{
    $rows = [];
    if (function_exists('vgm_orders_list')) {
        for ($page = 1; $page <= 500; $page++) {
            $filter = ['page' => $page];
            if ($status !== null) {
                $filter['status'] = $status;
            }
            $res = vgm_orders_list($filter);
            foreach ((array)($res['orders'] ?? []) as $o) {
                if (is_array($o)) {
                    $rows[] = $o;
                }
            }
            if ($page >= (int)($res['pages'] ?? 1)) {
                break;
            }
        }
    } else {
        $orders = vgm_locked(false, function (string $dir): array {
            return (array)vgm_orders_read($dir)['orders'];
        });
        foreach ($orders as $o) {
            if (is_array($o) && ($status === null || ($o['status'] ?? '') === $status)) {
                $rows[] = $o;
            }
        }
    }
    usort($rows, function (array $a, array $b): int {
        return vgma_ts($b['createdAt'] ?? 0) <=> vgma_ts($a['createdAt'] ?? 0);
    });
    return $rows;
}

function vgma_cmd_orders(array $opt): int
{
    $status = isset($opt['status']) ? (string)$opt['status'] : null;
    if ($status !== null && !isset(VGM_STATUS_LABELS[$status])) {
        vgma_err('Bilinmeyen durum. Geçerli durumlar: ' . implode(', ', array_keys(VGM_STATUS_LABELS)));
        return 2;
    }
    $rows = vgma_orders($status);
    if (!$rows) {
        echo "Sipariş yok.\n";
        return 0;
    }
    $now = vg_now();
    foreach ($rows as $o) {
        $customer = is_array($o['customer'] ?? null) ? $o['customer'] : [];
        $totals = is_array($o['totals'] ?? null) ? $o['totals'] : [];
        $name = (string)($o['customerName'] ?? $customer['name'] ?? '');
        $amount = $o['amountTry'] ?? $totals['tryGross'] ?? null;
        $st = (string)($o['status'] ?? '');
        $late = ($o['overdue'] ?? null) === true || ($st === 'odeme_bekleniyor' && !isset($o['overdue']) && vgma_ts($o['payBy'] ?? 0) > 0 && vgma_ts($o['payBy']) < $now);
        echo vgma_pad((string)($o['ref'] ?? $o['reference'] ?? '-'), 17) . '  ' . vgma_pad(vgma_when($o['createdAt'] ?? 0), 16) . '  '
            . vgma_pad(vgma_label($st), 18) . '  ' . vgma_pad($name, 24) . '  '
            . vgma_pad(is_numeric($amount) ? vgm_fmt_try((float)$amount) : '-', 16, true) . ($late ? '  ÖDEME SÜRESİ GEÇTİ' : '') . "\n";
    }
    echo count($rows) . " sipariş.\n";
    return 0;
}

function vgma_mask(string $s): string
{
    return strlen($s) > 4 ? str_repeat('*', strlen($s) - 2) . substr($s, -2) : $s;
}

function vgma_print_order(array $o): void
{
    $c = (array)($o['customer'] ?? []);
    $b = (array)($o['billing'] ?? []);
    $s = (array)($o['shippingAddress'] ?? []);
    $t = (array)($o['totals'] ?? []);
    $r = (array)($o['rate'] ?? []);
    echo 'Sipariş ' . (string)($o['ref'] ?? '') . ' — ' . vgma_label((string)($o['status'] ?? '')) . "\n";
    echo 'Oluşturma: ' . vgma_when($o['createdAt'] ?? 0) . ' · Son ödeme: ' . vgma_when($o['payBy'] ?? 0) . "\n";
    echo 'Müşteri: ' . (string)($c['name'] ?? '') . ' <' . (string)($c['email'] ?? '') . '> ' . (string)($c['phone'] ?? '') . "\n";
    echo 'Fatura: ' . (string)($b['type'] ?? '') . ' · ' . (string)($b['company'] ?? $b['name'] ?? '')
        . (isset($b['tckn']) && $b['tckn'] !== '' ? ' · TCKN ' . vgma_mask((string)$b['tckn']) : '')
        . (isset($b['vkn']) && $b['vkn'] !== '' ? ' · VKN ' . (string)$b['vkn'] . ' ' . (string)($b['taxOffice'] ?? '') : '') . "\n";
    echo '  ' . trim((string)($b['address'] ?? '') . ' ' . (string)($b['district'] ?? '') . '/' . (string)($b['city'] ?? '')) . "\n";
    echo 'Teslimat: ' . (string)($s['name'] ?? '') . ' · ' . (string)($s['phone'] ?? '') . "\n";
    echo '  ' . trim((string)($s['address'] ?? '') . ' ' . (string)($s['district'] ?? '') . '/' . (string)($s['city'] ?? '') . ' ' . (string)($s['postalCode'] ?? '')) . "\n";
    if (($o['notes'] ?? '') !== '') {
        echo 'Müşteri notu: ' . (string)$o['notes'] . "\n";
    }
    echo "Ürünler:\n";
    foreach ((array)($o['items'] ?? []) as $it) {
        $it = (array)$it;
        echo '  ' . (string)($it['qty'] ?? 0) . ' ' . (string)($it['unit'] ?? 'adet') . ' × ' . (string)($it['name'] ?? '') . ' [' . (string)($it['id'] ?? '') . '] '
            . vgm_fmt_try((float)($it['unitTryGross'] ?? 0)) . ' = ' . vgm_fmt_try((float)($it['lineTryGross'] ?? 0))
            . ' (personel: ' . vgm_fmt_usd((float)($it['unitUsdNet'] ?? 0)) . "/adet, KDV hariç)\n";
    }
    echo 'Toplam: ara ' . vgm_fmt_try((float)($t['tryNet'] ?? 0)) . ' + KDV ' . vgm_fmt_try((float)($t['tryVat'] ?? 0)) . ' + kargo ' . vgm_fmt_try((float)($t['shippingTry'] ?? 0))
        . ' = ' . vgm_fmt_try((float)($t['tryGross'] ?? 0)) . ' (USD ' . vgm_fmt_usd((float)($t['usdNet'] ?? 0)) . ' KDV hariç; kur ' . (string)($r['usdTry'] ?? '-') . ' / ' . (string)($r['date'] ?? '-') . ")\n";
    echo 'Ödeme: havale/EFT, açıklama = ' . (string)($o['ref'] ?? '') . "\n";
    $tr = $o['tracking'] ?? null;
    if (is_array($tr)) {
        echo 'Kargo: ' . (string)($tr['company'] ?? '') . ' · ' . (string)($tr['code'] ?? '') . (($tr['url'] ?? '') !== '' ? ' · ' . (string)$tr['url'] : '') . "\n";
    }
    echo "Geçmiş:\n";
    foreach ((array)($o['history'] ?? []) as $h) {
        $h = (array)$h;
        echo '  ' . vgma_when($h['at'] ?? 0) . '  ' . vgma_label((string)($h['status'] ?? '')) . '  (' . (string)($h['by'] ?? '-') . ')'
            . (($h['note'] ?? '') !== '' ? '  iç not: ' . (string)$h['note'] : '') . (($h['publicNote'] ?? '') !== '' ? '  müşteri notu: ' . (string)$h['publicNote'] : '') . "\n";
    }
    $sources = (array)(((array)($o['private'] ?? []))['sources'] ?? []);
    if ($sources) {
        echo "Tedarik kaynakları (gizli):\n";
        foreach ($sources as $id => $list) {
            foreach ((array)$list as $src) {
                $src = (array)$src;
                echo '  ' . $id . ': ' . (string)($src['supplier'] ?? '') . ' · ' . (string)($src['url'] ?? '') . ' · alış ' . vgm_fmt_try((float)($src['costTry'] ?? 0)) . "\n";
            }
        }
    }
}

function vgma_cmd_order(array $pos, array $opt): int
{
    $ref = count($pos) === 1 ? strtoupper(trim($pos[0])) : '';
    if (!vgm_reference_valid($ref)) {
        vgma_err("Geçerli bir sipariş referansı verin (VGS-yymmdd-XXXXX).\n" . vgma_usage());
        return 2;
    }
    $o = vgma_order($ref);
    if ($o === null) {
        vgma_err('Sipariş bulunamadı.');
        return 1;
    }
    if (isset($opt['json'])) {
        echo vg_json_encode($o, true) . "\n";
    } else {
        vgma_print_order($o);
    }
    return 0;
}

function vgma_cmd_set_status(array $pos, array $opt): int
{
    $ref = count($pos) === 2 ? strtoupper(trim($pos[0])) : '';
    $status = count($pos) === 2 ? $pos[1] : '';
    if (!vgm_reference_valid($ref) || !isset(VGM_STATUS_LABELS[$status])) {
        vgma_err("Referans ve geçerli bir durum verin.\n" . vgma_usage());
        return 2;
    }
    $change = ['status' => $status, 'notify' => isset($opt['notify'])];
    if (isset($opt['note']) && trim((string)$opt['note']) !== '') {
        $change['note'] = vg_text((string)$opt['note'], 1000, true);
    }
    if (isset($opt['public-note']) && trim((string)$opt['public-note']) !== '') {
        $change['publicNote'] = vg_text((string)$opt['public-note'], 1000, true);
    }
    if (isset($opt['tracking'])) {
        $parts = explode('|', (string)$opt['tracking'], 3);
        $company = vg_text($parts[0], 60);
        $code = vg_text($parts[1] ?? '', 60);
        $url = trim($parts[2] ?? '');
        if ($company === '' || $code === '' || ($url !== '' && strpos($url, 'https://') !== 0)) {
            vgma_err('--tracking "Firma|Takip kodu" ya da "Firma|Takip kodu|https://takip-adresi" biçiminde olmalı.');
            return 2;
        }
        $change['tracking'] = ['company' => $company, 'code' => $code] + ($url !== '' ? ['url' => vg_text($url, 300)] : []);
    }
    if (!function_exists('vgm_order_update')) {
        vgma_err('Sipariş modülü (api/lib/magaza-siparis.php) bulunamadı; durum güncellenemiyor.');
        return 1;
    }
    $order = vgm_order_update($ref, $change, ['id' => 'cli', 'name' => 'Sunucu terminali'], vg_now());
    echo 'Sipariş ' . $ref . ' güncellendi: ' . vgma_label((string)($order['status'] ?? $status)) . ($change['notify'] ? (($order['_mailSent'] ?? false) ? ". Müşteriye e-posta gönderildi.\n" : ". UYARI: müşteri e-postası gönderilemedi.\n") : ".\n");
    return 0;
}

/* ------------------------------------------------------------------ durum ve kontrol */

/** vgm_refresh ozetindeki alan adlarinin Turkcesi (sira onemli). */
function vgma_summary_text(array $s): string
{
    $labels = ['checked' => 'kontrol edilen', 'ok' => 'güncel', 'held' => 'onay bekleyen', 'error' => 'hatalı', 'unavailable' => 'stokta yok',
        'skipped' => 'atlanan'];
    $parts = [];
    foreach ($labels as $key => $label) {
        if (isset($s[$key]) && is_numeric($s[$key])) {
            $parts[] = $label . ' ' . $s[$key];
        }
    }
    if (isset($s['rateUpdated'])) {
        $parts[] = 'kur ' . ($s['rateUpdated'] ? 'güncellendi' : 'güncellenmedi');
    }
    if (isset($s['seconds']) && is_numeric($s['seconds'])) {
        $parts[] = $s['seconds'] . ' sn';
    }
    return implode(', ', $parts);
}

/** panel_status ile ayni fonksiyon (vgm_panel_status, api/lib/magaza-api.php): cikti her iki yerde birebir aynidir. */
function vgma_cmd_status(array $opt): int
{
    if (!function_exists('vgm_panel_status')) {
        vgma_err('API modülü (api/lib/magaza-api.php) bulunamadı; durum okunamıyor.');
        return 1;
    }
    $s = vgm_panel_status(vg_now());
    if (isset($opt['json'])) {
        echo vg_json_encode($s, true) . "\n";
        return 0;
    }
    $missing = (array)($s['firmaMissing'] ?? []);
    echo 'Mağaza: ' . ($s['open'] ? 'siparişe AÇIK' : 'siparişe KAPALI')
        . (!$s['open'] && ($s['configOpen'] ?? false) === true ? ' (kaynak dosyasında open=true ama satıcı bilgileri eksik)' : '')
        . (!$s['open'] && ($s['configOpen'] ?? false) !== true ? ' (kaynak dosyasında open=false; açılış sahibin kararı)' : '') . "\n";
    echo 'Eksik satıcı alanları: ' . ($missing ? implode(', ', $missing) : 'yok') . "\n";
    $r = $s['rate'] ?? null;
    echo 'Kur: ' . (is_array($r) ? number_format((float)$r['usdTry'], 4, ',', '.') . ' ₺ (TCMB ' . (string)($r['date'] ?? '-') . '; son okuma ' . vgma_when($r['fetchedAt'] ?? 0)
        . '; ' . ($r['ok'] ? 'kullanılabilir' : 'GÜNCEL DEĞİL, sipariş alınamaz') . ')' : 'YOK, sipariş alınamaz') . "\n";
    $cron = (array)($s['cron'] ?? []);
    echo 'Fiyat kontrolü (cron): son çalışma ' . vgma_when($cron['lastRunAt'] ?? 0) . ' (' . (($cron['healthy'] ?? false) ? 'sağlıklı' : 'SAĞLIKSIZ: cron çalışmıyor olabilir') . ')'
        . (is_array($cron['summary'] ?? null) ? '; son özet: ' . vgma_summary_text($cron['summary']) : '') . "\n";
    $c = (array)($s['counts'] ?? []);
    echo 'Ürün fiyatları (kaynağı olan ürünler): güncel ' . (int)($c['ok'] ?? 0) . ', onay bekleyen ' . (int)($c['held'] ?? 0) . ', hatalı ' . (int)($c['error'] ?? 0)
        . ', stokta yok ' . (int)($c['unavailable'] ?? 0) . ', fiyat teyidi eski ' . (int)($c['stale'] ?? 0) . '; kaynağı olmayan ' . (int)($c['noSource'] ?? 0)
        . ' (katalogda toplam ' . (int)($s['products'] ?? 0) . " ürün)\n";
    $o = (array)($s['orders'] ?? []);
    echo 'Siparişler: ödeme bekleyen ' . (int)($o['awaitingPayment'] ?? 0) . ', ödeme süresi geçen ' . (int)($o['overdue'] ?? 0) . "\n";
    return 0;
}

/** Fiyat/kur kontrolu: cron ile ayni vgm_refresh. --product ile tek urun (kalp atisi yazilmaz), yoksa tam calisma. */
function vgma_cmd_check(array $opt): int
{
    $id = isset($opt['product']) ? (string)$opt['product'] : null;
    if ($id !== null && (preg_match('/^vgm-[0-9]{4,6}$/D', $id) !== 1 || vgm_product($id) === null)) {
        vgma_err('Katalogda böyle bir ürün yok.');
        return 2;
    }
    if (!function_exists('vgm_refresh')) {
        vgma_err('Fiyat kontrol modülü (api/lib/magaza-kaynak.php) bulunamadı; kontrol çalıştırılamıyor.');
        return 1;
    }
    $result = vgm_refresh($id !== null ? ['ids' => [$id]] : []);
    echo 'Kontrol tamamlandı: ' . vgma_summary_text($result) . ".\n";
    if (isset($result['rateError'])) {
        vgma_err('Uyarı: kur alınamadı (' . (string)$result['rateError'] . ').');
        if ((int)($result['checked'] ?? 0) === 0) {
            vgma_err('Güvenilir kur olmadan fiyat kontrolü yapılamaz.');
            return 1;
        }
    }
    return 0;
}

/* ------------------------------------------------------------------ giris */

function vgma_main(array $argv): int
{
    $cmd = (string)($argv[1] ?? '');
    $rest = array_slice($argv, 2);
    if ($cmd === '--help' || $cmd === '-h' || $cmd === 'help') {
        echo vgma_usage();
        return 0;
    }
    $spec = [
        'grant' => [[], []], 'revoke' => [[], []], 'list' => [[], []], 'import' => [[], ['dry-run']], 'export-config' => [[], []],
        'orders' => [['status'], []], 'order' => [[], ['json']], 'set-status' => [['note', 'public-note', 'tracking'], ['notify']],
        'status' => [[], ['json']], 'check' => [['product'], []],
    ];
    if (!isset($spec[$cmd])) {
        vgma_err($cmd === '' ? vgma_usage() : 'Bilinmeyen komut: ' . $cmd . "\n" . vgma_usage());
        return 2;
    }
    $parsed = vgma_parse($rest, $spec[$cmd][0], $spec[$cmd][1]);
    if ($parsed === null) {
        vgma_err("Geçersiz seçenek.\n" . vgma_usage());
        return 2;
    }
    list($pos, $opt) = $parsed;
    if (in_array($cmd, ['list', 'export-config', 'orders', 'status', 'check'], true) && $pos) {
        vgma_err("Bu komut konumsal argüman almaz.\n" . vgma_usage());
        return 2;
    }
    if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
        vgma_err("VG_DATA_DIR değişkenini API'nin mevcut özel veri klasörüne ayarlayın.");
        return 2;
    }
    switch ($cmd) {
        case 'grant':
            return vgma_cmd_grant($pos);
        case 'revoke':
            return vgma_cmd_revoke($pos);
        case 'list':
            return vgma_cmd_list();
        case 'import':
            return vgma_cmd_import($pos, $opt);
        case 'export-config':
            return vgma_cmd_export_config();
        case 'orders':
            return vgma_cmd_orders($opt);
        case 'order':
            return vgma_cmd_order($pos, $opt);
        case 'set-status':
            return vgma_cmd_set_status($pos, $opt);
        case 'status':
            return vgma_cmd_status($opt);
        default:
            return vgma_cmd_check($opt);
    }
}

try {
    exit(vgma_main($argv));
} catch (VgHttpError $error) {
    vgma_err('Hata (' . $error->errCode . '): ' . $error->getMessage());
    exit(1);
} catch (Throwable $error) {
    error_log('VoltGuard magaza-admin: ' . get_class($error) . ' ' . $error->getMessage());
    vgma_err('Beklenmeyen hata (' . get_class($error) . '). Sunucu günlüklerine bakın.');
    exit(1);
}
