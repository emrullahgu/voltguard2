<?php
/*
 * VoltGuard hesap API - oturum, CSRF, kaynak (Origin) denetimi ve hiz sinirlari.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

/* ------------------------------------------------------------------ kaynak denetimi */

function vg_strip_default_port(string $hostPort): string
{
    return (string)preg_replace(vg_is_https() ? '/:443$/' : '/:80$/', '', strtolower($hostPort));
}

function vg_allowed_hosts(): array
{
    $hosts = [];
    $h = vg_strip_default_port((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($h !== '') {
        $hosts[] = $h;
    }
    $extra = getenv('VG_ALLOWED_HOSTS');
    if (is_string($extra) && $extra !== '') {
        foreach (explode(',', $extra) as $x) {
            $x = vg_strip_default_port(trim($x));
            if ($x !== '') {
                $hosts[] = $x;
            }
        }
    }
    return $hosts;
}

function vg_url_is_same_origin(string $url, bool $originOnly = false): bool
{
    $p = parse_url($url);
    if (!is_array($p) || empty($p['host']) || empty($p['scheme']) || isset($p['user']) || isset($p['pass'])) {
        return false;
    }
    if ($originOnly && (isset($p['query']) || isset($p['fragment']) || !in_array($p['path'] ?? '', ['', '/'], true))) return false;
    $scheme = strtolower((string)$p['scheme']);
    if ($scheme !== (vg_is_https() ? 'https' : 'http')) {
        return false;
    }
    $hp = strtolower((string)$p['host']) . (isset($p['port']) ? ':' . (int)$p['port'] : '');
    return in_array(vg_strip_default_port($hp), vg_allowed_hosts(), true);
}

/** Tarayicinin capraz site istegi oldugunu bildirdigi istekleri reddeder (Sec-Fetch-Site). */
function vg_check_fetch_site(): void
{
    $site = strtolower((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    if ($site === 'cross-site') {
        vg_fail(403, 'forbidden_origin', 'Bu istek kabul edilmedi.');
    }
}

/** Durum degistiren isteklerde Origin (yoksa Referer) bu sitenin kendisi olmali. */
function vg_require_same_origin(): void
{
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin !== '') {
        if (!vg_url_is_same_origin($origin, true)) {
            vg_fail(403, 'forbidden_origin', 'Bu istek kabul edilmedi.');
        }
        return;
    }
    $ref = (string)($_SERVER['HTTP_REFERER'] ?? '');
    if ($ref !== '' && !vg_url_is_same_origin($ref)) {
        vg_fail(403, 'forbidden_origin', 'Bu istek kabul edilmedi.');
    }
}

/* ------------------------------------------------------------------ oturum */

function vg_cookie_options(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => vg_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

function vg_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $base = vg_private_data_directory(vg_data_dir());
    $dir = vg_private_data_directory($base . '/sessions', $base);
    /* Gecersiz bicimli cerez: PHP'nin uyari verip oturumu acamamasi yerine yok sayilir (yeni kimlik uretilir). */
    if (isset($_COOKIE[VG_SESSION_NAME]) && (!is_string($_COOKIE[VG_SESSION_NAME])
        || preg_match('/^[A-Za-z0-9,-]{22,256}$/', $_COOKIE[VG_SESSION_NAME]) !== 1)) {
        unset($_COOKIE[VG_SESSION_NAME]);
    }
    ini_set('session.save_handler', 'files');
    session_save_path($dir);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_cookies', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.lazy_write', '1');
    ini_set('session.serialize_handler', 'php');   // vg_session_gc() "remember" bayragini bu bicimde arar
    /* Dosyalar en uzun mutlak sureden sonra temizlenir; asil gecerlilik suresi asagida uygulanir. */
    ini_set('session.gc_maxlifetime', (string)(VG_ABS_LONG + 86400));
    ini_set('session.gc_probability', '1');
    ini_set('session.gc_divisor', '200');
    session_cache_limiter('');
    session_name(VG_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => vg_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    if (!@session_start()) {
        vg_unavailable('session_start failed');
    }
}

function vg_csrf_token(): string
{
    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function vg_require_csrf(): void
{
    $sent = (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '');
    $known = isset($_SESSION['csrf']) && is_string($_SESSION['csrf']) ? $_SESSION['csrf'] : '';
    if ($known === '' || $sent === '' || !hash_equals($known, $sent)) {
        vg_fail(403, 'csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.');
    }
}

/** Oturumdaki kullanici; zaman asimi veya sifre/oturum surumu degistiyse null (oturum kapatilir). */
function vg_session_user(VgStore $store): ?array
{
    $s = $_SESSION['vg'] ?? null;
    if (!is_array($s) || empty($s['uid']) || !is_string($s['uid'])) {
        return null;
    }
    $now = vg_now();
    $remember = !empty($s['remember']);
    $idle = $remember ? VG_IDLE_LONG : VG_IDLE_SHORT;
    $abs = $remember ? VG_ABS_LONG : VG_ABS_SHORT;
    if ($now - (int)($s['last'] ?? 0) > $idle || $now - (int)($s['created'] ?? 0) > $abs) {
        vg_session_drop_user();
        $_SESSION['expired'] = 1;
        return null;
    }
    $u = $store->findUserById($s['uid']);
    if ($u === null || (int)$u['epoch'] !== (int)($s['epoch'] ?? -1)) {
        vg_session_drop_user();
        $_SESSION['expired'] = 1;
        return null;
    }
    if ($now - (int)$s['last'] >= 60) {
        $_SESSION['vg']['last'] = $now;
    }
    return $u;
}

function vg_require_user(VgStore $store): array
{
    $u = vg_session_user($store);
    if ($u === null) {
        vg_fail(401, 'unauthorized', 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.');
    }
    return $u;
}

/** Oturum cerezini mutlak sure sonunda bitecek sekilde yeniden yazar ("Beni hatirla"). */
function vg_set_persistent_cookie(int $expires): void
{
    if (headers_sent()) {
        return;
    }
    header_remove('Set-Cookie');
    setcookie(VG_SESSION_NAME, session_id(), vg_cookie_options($expires));
}

/** Giris: oturum kimligi yenilenir (session fixation), CSRF jetonu dondurulur. */
function vg_session_login(array $user, bool $remember): void
{
    session_regenerate_id(true);
    $now = vg_now();
    $_SESSION = [
        'vg' => [
            'uid' => $user['id'],
            'epoch' => (int)$user['epoch'],
            'created' => $now,
            'last' => $now,
            'remember' => $remember,
        ],
        'csrf' => bin2hex(random_bytes(32)),
    ];
    if ($remember) {
        vg_set_persistent_cookie($now + VG_ABS_LONG);
    }
    /* vg_set_persistent_cookie Set-Cookie basliklarini sildigi icin bilinen cihaz cerezi en son yazilir. */
    vg_kdev_remember($user);
}

/** Sifre degisince: oturum surumu guncellenir, kimlik ve CSRF jetonu yenilenir; cerez suresi korunur. */
function vg_session_refresh(int $epoch): void
{
    $s = $_SESSION['vg'] ?? [];
    session_regenerate_id(true);
    $s['epoch'] = $epoch;
    $s['last'] = vg_now();
    $_SESSION['vg'] = $s;
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    if (!empty($s['remember'])) {
        vg_set_persistent_cookie((int)($s['created'] ?? vg_now()) + VG_ABS_LONG);
    }
}

/** Kullaniciyi oturumdan cikarir ama anonim oturumu (yeni kimlik + yeni CSRF) surdurur. */
function vg_session_drop_user(): void
{
    unset($_SESSION['vg']);
    if (session_status() === PHP_SESSION_ACTIVE && !headers_sent()) {
        session_regenerate_id(true);
    }
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

/** Cikis / hesap silme: oturum dosyasi silinir ve cerez temizlenir. */
function vg_session_destroy(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    if (!headers_sent()) {
        header_remove('Set-Cookie');
        setcookie(VG_SESSION_NAME, '', vg_cookie_options(time() - 86400));
    }
}

/* ------------------------------------------------------------------ bilinen cihaz */

/*
 * Basarili giristen sonra tarayiciya HttpOnly "bilinen cihaz" cerezi (VGDEV) yazilir: icinde yalnizca
 * HMAC(gizli anahtar, kullanici kimligi | oturum surumu) ozetleri bulunur (e-posta / kimlik acik yazilmaz).
 * Bu cerezi tasiyan istemci, baskalarinin dagitik hatali denemeleriyle tetiklenen e-posta geneli kilitten
 * (login_email) muaf tutulur; e-posta+istemci ve istemci kilitleri aynen gecerlidir. Sifre veya e-posta
 * degisince (epoch artar) eski ozetler kendiliginden gecersiz olur.
 */
const VG_KDEV_NAME = 'VGDEV';
const VG_KDEV_TTL = 15552000;      // 180 gun
const VG_KDEV_MAX = 4;             // ayni tarayicida en fazla 4 hesap

function vg_kdev_mac(array $user): string
{
    return substr(hash_hmac('sha256', 'kdev|' . $user['id'] . '|' . (int)$user['epoch'], vg_secret()), 0, 32);
}

/** Cerezdeki gecerli bicimli ozetler. */
function vg_kdev_list(): array
{
    $raw = $_COOKIE[VG_KDEV_NAME] ?? '';
    if (!is_string($raw) || $raw === '' || strlen($raw) > 200) {
        return [];
    }
    $out = [];
    foreach (explode('.', $raw) as $m) {
        if (preg_match('/^[0-9a-f]{32}$/', $m) === 1 && !in_array($m, $out, true)) {
            $out[] = $m;
        }
    }
    return array_slice($out, 0, VG_KDEV_MAX);
}

function vg_kdev_has(array $user): bool
{
    $mac = vg_kdev_mac($user);
    foreach (vg_kdev_list() as $m) {
        if (hash_equals($mac, $m)) {
            return true;
        }
    }
    return false;
}

function vg_kdev_write(array $list): void
{
    if (headers_sent()) {
        return;
    }
    $list = array_slice(array_values($list), 0, VG_KDEV_MAX);
    if ($list) {
        setcookie(VG_KDEV_NAME, implode('.', $list), vg_cookie_options(time() + VG_KDEV_TTL));
    } else {
        setcookie(VG_KDEV_NAME, '', vg_cookie_options(time() - 86400));
    }
    $_COOKIE[VG_KDEV_NAME] = implode('.', $list);
}

/** Bu tarayiciyi kullanicinin bilinen cihazi olarak isaretler (guncel epoch ile). */
function vg_kdev_remember(array $user): void
{
    $mac = vg_kdev_mac($user);
    $prev = array_values(array_filter(vg_kdev_list(), function ($m) use ($mac) {
        return !hash_equals($mac, $m);
    }));
    if (isset($user['_old_epoch'])) {
        $old = vg_kdev_mac(['id' => $user['id'], 'epoch' => (int)$user['_old_epoch']]);
        $prev = array_values(array_filter($prev, function ($m) use ($old) {
            return !hash_equals($old, $m);
        }));
    }
    array_unshift($prev, $mac);
    vg_kdev_write($prev);
}

/** Hesap silinince bu tarayicidaki ozeti kaldirir. */
function vg_kdev_forget(array $user): void
{
    $mac = vg_kdev_mac($user);
    $list = vg_kdev_list();
    $kept = array_values(array_filter($list, function ($m) use ($mac) {
        return !hash_equals($mac, $m);
    }));
    if (count($kept) !== count($list)) {
        vg_kdev_write($kept);
    }
}

/* ------------------------------------------------------------------ hiz sinirlari */

/*
 * Sayaclar veri klasorundeki rl/ altinda, anahtarin HMAC ozeti adli dosyalarda tutulur (IP veya e-posta
 * dosya adinda/icerikte acik yazilmaz). Her dosya tek flock altinda oku-degistir-yaz yapilir.
 */
function vg_rl_file(string $bucket, string $id): string
{
    $base = vg_private_data_directory(vg_data_dir());
    $dir = vg_private_data_directory($base . '/rl', $base);
    return $dir . '/' . hash_hmac('sha256', $bucket . "\0" . $id, vg_secret()) . '.json';
}

/** $fn(array $state, int $now): ?array -> null dosyayi siler. Donen yeni durum (ya da []) geri verilir. */
function vg_rl_update(string $bucket, string $id, callable $fn): array
{
    $file = vg_rl_file($bucket, $id);
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('rate counter cannot be opened');
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        vg_unavailable('rate counter cannot be locked');
    }
    $raw = stream_get_contents($fp);
    $state = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (!is_array($state)) {
        $state = [];
    }
    $new = $fn($state, vg_now());
    $encoded = is_array($new) ? vg_json_encode($new) : '';
    $written = rewind($fp) && ftruncate($fp, 0)
        && ($encoded === '' || fwrite($fp, $encoded) === strlen($encoded)) && fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if (!$written) vg_unavailable('rate counter write failed');
    @chmod($file, 0600);
    if (!is_array($new)) {
        @unlink($file);
        return [];
    }
    return $new;
}

function vg_rl_peek(string $bucket, string $id): array
{
    $file = vg_rl_file($bucket, $id);
    if (!is_file($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    $state = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    return is_array($state) ? $state : [];
}

function vg_rl_clear(string $bucket, string $id): void
{
    @unlink(vg_rl_file($bucket, $id));
}

/**
 * Hiz sinirlarinda kullanilan istemci anahtari. IPv4 adresi aynen; IPv6 adresi /64 onekine indirgenir (bir IPv6
 * istemcisi genellikle tum /64 blogunu kullanir ve her istekte adres degistirerek sinirlari asabilir).
 * $v6prefix ile daha genis blok (/56, /48) secilebilir: musteriye genellikle /56-/48 verildiginden saldirganin
 * elindeki ayri sayac sayisi azalir.
 */
function vg_rl_ip_key(int $v6prefix = 64): string
{
    $ip = vg_client_ip();
    $bin = @inet_pton($ip);
    if ($bin !== false && strlen($bin) === 16) {
        $bytes = intdiv(max(16, min(64, $v6prefix)), 8);
        $net = inet_ntop(substr($bin, 0, $bytes) . str_repeat("\0", 16 - $bytes));
        return ($net !== false ? $net : $ip) . '/' . ($bytes * 8);
    }
    return $ip;
}

/**
 * Kayan pencere sayaci. Izin verilirse istegi sayar ve 0, asildiysa bekleme suresini (saniye) dondurur.
 */
function vg_rl_hit(string $bucket, string $id, int $max, int $window): int
{
    $max = vg_rate_scale($max);
    $retry = 0;
    vg_rl_update($bucket, $id, function (array $st, int $now) use ($max, $window, &$retry) {
        $hits = [];
        foreach (($st['hits'] ?? []) as $t) {
            if (is_int($t) && $now - $t < $window) {
                $hits[] = $t;
            }
        }
        if (count($hits) >= $max) {
            $retry = max(1, $window - ($now - min($hits)));
            return ['hits' => $hits];
        }
        $hits[] = $now;
        return ['hits' => $hits];
    });
    return $retry;
}

function vg_too_many(int $retry, string $message = ''): void
{
    $retry = max(1, $retry);
    vg_fail(429, 'rate_limited', $message !== '' ? $message : 'Çok fazla deneme yapıldı. Lütfen ' . vg_human_wait($retry) . ' sonra tekrar deneyin.', [], ['Retry-After: ' . $retry], ['retryAfter' => $retry]);
}

function vg_human_wait(int $seconds): string
{
    if ($seconds < 60) {
        return $seconds . ' saniye';
    }
    return (int)ceil($seconds / 60) . ' dakika';
}

/*
 * Basarisiz giris/sifre denetimi sayaci (kademeli kilit):
 *   anahtar basina (e-posta / kullanici): 15 dk icinde 5. hatadan itibaren 30 sn, 60 sn, 2 dk ... en fazla 15 dk kilit
 *   IP basina: 15 dk icinde 30 hata -> 15 dk kilit
 */
const VG_FAIL_WINDOW = 900;

function vg_fail_lock_remaining(string $bucket, string $id): int
{
    $st = vg_rl_peek($bucket, $id);
    $lock = (int)($st['lock'] ?? 0);
    $now = vg_now();
    return $lock > $now ? $lock - $now : 0;
}

function vg_fail_record(string $bucket, string $id, int $threshold, bool $progressive): int
{
    $threshold = vg_rate_scale($threshold);
    $st = vg_rl_update($bucket, $id, function (array $st, int $now) use ($threshold, $progressive) {
        $first = (int)($st['first'] ?? 0);
        $fails = (int)($st['fails'] ?? 0);
        $lock = (int)($st['lock'] ?? 0);
        if ($first === 0 || ($now - $first > VG_FAIL_WINDOW && $lock <= $now)) {
            $first = $now;
            $fails = 0;
        }
        $fails++;
        if ($fails >= $threshold) {
            $wait = $progressive ? (int)min(VG_FAIL_WINDOW, 30 * (2 ** min(10, $fails - $threshold))) : VG_FAIL_WINDOW;
            $lock = $now + $wait;
        }
        return ['first' => $first, 'fails' => $fails, 'lock' => $lock];
    });
    $now = vg_now();
    return isset($st['lock']) && (int)$st['lock'] > $now ? (int)$st['lock'] - $now : 0;
}

/*
 * Temizlik zamanlamasi: her temizlik en fazla saatte bir, o saatteki ilk istekte ve YANIT GONDERILDIKTEN SONRA
 * (vg_after_response) calisir; klasorun tamami taranir. Isaret dosyasi (gc-*.last) son calisma zamanini tutar.
 * Iki istek ayni anda baslatirsa temizlik iki kez calisir; zarari yoktur.
 */
const VG_GC_EVERY = 3600;
const VG_GC_BUDGET = 3.0;   // saniye; asilirsa kalan dosyalar bir sonraki calismada ele alinir

function vg_gc_due(string $name): bool
{
    $marker = vg_data_dir() . '/' . $name . '.last';
    $mt = @filemtime($marker);
    if ($mt !== false && time() - $mt < VG_GC_EVERY) {
        return false;
    }
    @file_put_contents($marker, (string)time());
    return true;
}

function vg_schedule_gc(): void
{
    if (vg_gc_due('gc-rl')) {
        vg_after_response('vg_rl_gc');
    }
    if (vg_gc_due('gc-sessions')) {
        vg_after_response('vg_session_gc');
    }
}

/** Suresi dolmus sayac dosyalarini siler (en uzun pencere 1 saat, kilit en fazla 15 dk; 1 gunden eski dosyalar). */
function vg_rl_gc(): void
{
    $dir = vg_data_dir() . '/rl';
    $dh = @opendir($dir);
    if ($dh === false) {
        return;
    }
    $start = microtime(true);
    $limit = time() - 86400;
    while (($f = readdir($dh)) !== false) {
        if (microtime(true) - $start > VG_GC_BUDGET) {
            break;
        }
        if (substr($f, -5) !== '.json') {
            continue;
        }
        $path = $dir . '/' . $f;
        $mt = @filemtime($path);
        if ($mt !== false && $mt < $limit) {
            @unlink($path);
        }
    }
    closedir($dh);
}

/*
 * Oturum dosyasi temizligi. PHP'nin kendi GC'si en uzun sure (30 gun) ile calisir; burada suresi dolmus
 * oturumlar daha erken silinir: "Beni hatirla" isaretli oturumlar 14 gun, digerleri (anonim dahil) 2 saat islem
 * yapilmazsa. Dosya degisiklik zamani son erisim zamanidir (lazy_write erisimde zaman damgasini gunceller).
 */
function vg_session_gc(): void
{
    $dir = vg_data_dir() . '/sessions';
    $dh = @opendir($dir);
    if ($dh === false) {
        return;
    }
    $start = microtime(true);
    $now = time();
    while (($f = readdir($dh)) !== false) {
        if (microtime(true) - $start > VG_GC_BUDGET) {
            break;
        }
        if (strpos($f, 'sess_') !== 0) {
            continue;
        }
        $path = $dir . '/' . $f;
        $mt = @filemtime($path);
        if ($mt === false || $now - $mt < VG_IDLE_SHORT) {
            continue;
        }
        $limit = VG_IDLE_SHORT;
        if ($now - $mt < VG_IDLE_LONG) {
            $raw = @file_get_contents($path, false, null, 0, 4096);
            if (is_string($raw) && strpos($raw, 's:8:"remember";b:1;') !== false) {
                $limit = VG_IDLE_LONG;
            }
        } else {
            $limit = VG_IDLE_LONG;
        }
        if ($now - $mt > $limit) {
            @unlink($path);
        }
    }
    closedir($dh);
}
