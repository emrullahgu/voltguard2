<?php
/*
 * VoltGuard hesap API - temel yardimcilar (yapilandirma, JSON yanit, istek ayrıştırma, veri klasoru).
 * Bu dosya dogrudan cagrilamaz: api/lib/ web'e kapali (.htaccess) ve VG_API sabiti olmadan hicbir sey yapmaz.
 * PHP 7.4+ uyumlu; Composer veya harici kutuphane gerektirmez.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VG_API_VERSION = 'vg-auth/1';
/* Kayit sirasinda onaylanan uyelik + KVKK aydinlatma metninin surumu (gizlilik.html "Son guncelleme"). */
const VG_CONSENT_VERSION = '2026-10-12';
const VG_SESSION_NAME = 'VGSESS';
/* Oturum sureleri (saniye). "Beni hatirla" isaretli degilse kisa, isaretliyse uzun sureler uygulanir. */
const VG_IDLE_SHORT = 7200;        // 2 saat islem yapilmazsa
const VG_ABS_SHORT = 43200;        // en fazla 12 saat
const VG_IDLE_LONG = 1209600;      // 14 gun islem yapilmazsa
const VG_ABS_LONG = 2592000;       // en fazla 30 gun
const VG_RESET_TTL = 3600;         // sifre sifirlama baglantisi: 1 saat, tek kullanim
const VG_MAX_BODY = 65536;         // genel JSON istek govdesi siniri
const VG_MAX_BODY_DATA = 2097152;  // data_put (ice aktarma / tam liste) siniri: 2 MB
const VG_PW_OPTIONS = ['cost' => 11];

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/** Kullaniciya gosterilecek, kontrollu hata. Mesaj Turkce ve geneldir; kisisel veri icermez. */
final class VgHttpError extends Exception
{
    /** @var int */
    public $status;
    /** @var string */
    public $errCode;
    /** @var array */
    public $fields;
    /** @var array */
    public $headers;
    /** @var array */
    public $extra;

    public function __construct(int $status, string $code, string $message, array $fields = [], array $headers = [], array $extra = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errCode = $code;
        $this->fields = $fields;
        $this->headers = $headers;
        $this->extra = $extra;
    }
}

/** Hata firlatir (fonksiyon geri donmez). */
function vg_fail(int $status, string $code, string $message, array $fields = [], array $headers = [], array $extra = []): void
{
    throw new VgHttpError($status, $code, $message, $fields, $headers, $extra);
}

function vg_unavailable(string $logReason): void
{
    error_log('VoltGuard api: storage unavailable (' . $logReason . ')');
    vg_fail(503, 'unavailable', 'Hesap sistemi şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.');
}

/** Ek yanit basliklari (orn. Content-Disposition) icin biriktirici. */
function vg_extra_headers(?string $add = null): array
{
    static $list = [];
    if ($add !== null) {
        $list[] = $add;
    }
    return $list;
}

function vg_common_headers(int $status, array $headers): void
{
    if (headers_sent()) {
        return;
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Robots-Tag: noindex, nofollow');
    header_remove('X-Powered-By');
    foreach (array_merge(vg_extra_headers(), $headers) as $h) {
        header($h);
    }
}

function vg_discard_output(): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
}

function vg_json_encode($value, bool $pretty = false): string
{
    $flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE;
    if ($pretty) {
        $flags |= JSON_PRETTY_PRINT;
    }
    $json = json_encode($value, $flags);
    return $json === false ? '{}' : $json;
}

/** JSON yaniti gonderir. Her yanitta istemcinin API'yi taniyabilmesi icin "api" alani bulunur. */
function vg_send(int $status, array $payload, array $headers = []): void
{
    vg_discard_output();
    vg_common_headers($status, $headers);
    echo vg_json_encode(['api' => VG_API_VERSION] + $payload);
}

/** Hazir JSON govdesini (orn. disa aktarma dosyasi) gonderir. */
function vg_send_raw(int $status, string $json, array $headers = []): void
{
    vg_discard_output();
    vg_common_headers($status, $headers);
    echo $json;
}

/** Yanit gonderildikten sonra calisacak isler (e-posta gibi yavas islemler). */
function vg_after_response(?callable $job = null): array
{
    static $jobs = [];
    if ($job !== null) {
        $jobs[] = $job;
    }
    return $jobs;
}

/** Yanit istemciye gonderilip baglanti kapatilabiliyor mu (PHP-FPM veya LiteSpeed LSAPI)? */
function vg_can_finish_early(): bool
{
    return function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request');
}

function vg_finish_and_run_jobs(): void
{
    $jobs = vg_after_response();
    if (!$jobs) {
        return;
    }
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        flush();
    }
    ignore_user_abort(true);
    foreach ($jobs as $job) {
        try {
            $job();
        } catch (Throwable $e) {
            error_log('VoltGuard api: background job failed (' . get_class($e) . ')');
        }
    }
}

/* ------------------------------------------------------------------ istek */

function vg_method(): string
{
    return strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
}

/** Islem adi: ?action=login veya PATH_INFO (/api/auth.php/login). */
function vg_action(): string
{
    $a = '';
    if (isset($_GET['action']) && is_string($_GET['action'])) {
        $a = $_GET['action'];
    } elseif (isset($_SERVER['PATH_INFO']) && is_string($_SERVER['PATH_INFO'])) {
        $a = trim($_SERVER['PATH_INFO'], '/');
    }
    return preg_match('/^[a-z_]{2,32}$/', $a) === 1 ? $a : '';
}

function vg_is_https(): bool
{
    $https = strtolower((string)($_SERVER['HTTPS'] ?? ''));
    if ($https !== '' && $https !== 'off') {
        return true;
    }
    if ((string)($_SERVER['SERVER_PORT'] ?? '') === '443') {
        return true;
    }
    return strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/** Yalnizca application/json govde kabul edilir; boyut ve bicim denetlenir. */
function vg_json_body(int $max): array
{
    $ct = strtolower(trim((string)($_SERVER['CONTENT_TYPE'] ?? ($_SERVER['HTTP_CONTENT_TYPE'] ?? ''))));
    if (strpos($ct, 'application/json') !== 0) {
        vg_fail(415, 'unsupported_media_type', 'İstek biçimi desteklenmiyor.');
    }
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > $max) {
        vg_fail(413, 'too_large', 'Gönderilen veri çok büyük.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $max + 1);
    if (!is_string($raw)) {
        $raw = '';
    }
    if (strlen($raw) > $max) {
        vg_fail(413, 'too_large', 'Gönderilen veri çok büyük.');
    }
    if (trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true, 32);
    if (!is_array($data) || ($data !== [] && array_keys($data) === range(0, count($data) - 1))) {
        vg_fail(400, 'invalid_json', 'İstek okunamadı. Sayfayı yenileyip tekrar deneyin.');
    }
    return $data;
}

/* ------------------------------------------------------------------ istemci IP */

/* IPv4/IPv6 CIDR eslesmesi (contact.php ile ayni mantik). */
function vg_ip_in_cidr(string $ip, string $cidr): bool
{
    if (strpos($cidr, '/') === false) {
        return false;
    }
    list($subnet, $bits) = explode('/', $cidr, 2);
    $bits = (int)$bits;
    $ipBin = @inet_pton($ip);
    $subBin = @inet_pton($subnet);
    if ($ipBin === false || $subBin === false || strlen($ipBin) !== strlen($subBin)) {
        return false;
    }
    $bytes = intdiv($bits, 8);
    $rem = $bits % 8;
    if ($bytes > 0 && strncmp($ipBin, $subBin, $bytes) !== 0) {
        return false;
    }
    if ($rem === 0) {
        return true;
    }
    $mask = (0xff << (8 - $rem)) & 0xff;
    return (ord($ipBin[$bytes]) & $mask) === (ord($subBin[$bytes]) & $mask);
}

/** Istemci IP'si. CF-Connecting-IP yalnizca istek gercek bir Cloudflare adresinden geliyorsa dikkate alinir. */
function vg_client_ip(): string
{
    static $ip = null;
    if ($ip !== null) {
        return $ip;
    }
    $cfRanges = [
        '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
        '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
        '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
        '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
        '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
        '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
    ];
    $remote = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $cf = (string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? '');
    if ($remote !== '' && $cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) {
        foreach ($cfRanges as $range) {
            if (vg_ip_in_cidr($remote, $range)) {
                return $ip = $cf;
            }
        }
    }
    return $ip = ($remote !== '' ? $remote : 'unknown');
}

/* ------------------------------------------------------------------ veri klasoru */

function vg_doc_root(): string
{
    $dr = str_replace('\\', '/', (string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $dr = rtrim($dr, '/');
    if ($dr === '' || !@is_dir($dr)) {
        $dr = rtrim(str_replace('\\', '/', dirname(__DIR__, 2)), '/');
    }
    return $dr;
}

/** Klasorun web'den okunamamasi icin .htaccess ve bos index.html birakir (docroot disinda da zararsiz). */
function vg_protect_dir(string $dir): void
{
    $ht = $dir . '/.htaccess';
    if (!@is_file($ht)) {
        @file_put_contents($ht, "# VoltGuard calisma verisi: HTTP ile asla sunulmaz.\n"
            . "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
            . "Options -Indexes\n");
    }
    $idx = $dir . '/index.html';
    if (!@is_file($idx)) {
        @file_put_contents($idx, '');
    }
}

function vg_ensure_dir(string $dir): bool
{
    if (!@is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return @is_dir($dir) && @is_writable($dir);
}

/**
 * Calisma verisi klasoru (kullanicilar, oturumlar, sayaclar). api/ her deploy'da silindigi icin ASLA api/ icinde degildir.
 * Sira: VG_DATA_DIR ortam degiskeni -> docroot'un bir ustu/vg-data (public_html disi) -> docroot/_vgdata (.htaccess ile kapali).
 * VG_DATA_DIR verilmis ama kullanilamiyorsa sessizce baska klasore gecilmez (veri bolunmesin): 503 doner.
 */
function vg_data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $env = getenv('VG_DATA_DIR');
    if (is_string($env) && trim($env) !== '') {
        $p = rtrim(str_replace('\\', '/', trim($env)), '/');
        if (!vg_ensure_dir($p)) {
            vg_unavailable('VG_DATA_DIR is not writable');
        }
        vg_protect_dir($p);
        return $dir = $p;
    }
    $root = vg_doc_root();
    foreach ([dirname($root) . '/vg-data', $root . '/_vgdata'] as $p) {
        if (vg_ensure_dir($p)) {
            vg_protect_dir($p);
            return $dir = $p;
        }
    }
    vg_unavailable('no writable data directory');
    return '';
}

/** Kuruluma ozel gizli anahtar (sayac dosya adlari icin HMAC). Ilk istekte uretilir, 0600 izinle saklanir. */
function vg_secret(): string
{
    static $secret = null;
    if ($secret !== null) {
        return $secret;
    }
    $file = vg_data_dir() . '/secret.key';
    $value = @file_get_contents($file);
    if (!is_string($value) || strlen(trim($value)) < 64) {
        $fp = @fopen($file, 'x');
        if ($fp !== false) {
            $value = bin2hex(random_bytes(32));
            fwrite($fp, $value);
            fclose($fp);
            @chmod($file, 0600);
        } else {
            $value = @file_get_contents($file); // ayni anda baska bir istek olusturdu
        }
    }
    $value = trim((string)$value);
    if (strlen($value) < 64) {
        vg_unavailable('secret key could not be created');
    }
    return $secret = $value;
}

/** Ortam degiskeniyle (VG_RATE_SCALE) olceklenen hiz siniri esigi; test ortami icin. Varsayilan 1. */
function vg_rate_scale(int $max): int
{
    $s = getenv('VG_RATE_SCALE');
    $f = is_string($s) && is_numeric($s) ? (float)$s : 1.0;
    if ($f <= 0) {
        $f = 1.0;
    }
    return max(1, (int)round($max * $f));
}

/** Sifre sifirlama e-postasindaki baglantilarin koku. Host basligina guvenilmez (baglanti zehirlenmesi). */
function vg_site_url(): string
{
    $env = getenv('VG_SITE_URL');
    if (is_string($env) && preg_match('#^https?://[A-Za-z0-9.\-]+(:\d+)?$#', rtrim(trim($env), '/')) === 1) {
        return rtrim(trim($env), '/');
    }
    return 'https://voltguard.com.tr';
}

function vg_now(): int
{
    return time();
}

function vg_iso(int $ts): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $ts);
}

function vg_b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}
