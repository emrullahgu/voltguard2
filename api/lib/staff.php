<?php
/** Independent invite-only employee accounts. No public-account identity is accepted. */
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }
const VG_STAFF_COOKIE = 'VGSTAFF';
const VG_STAFF_IDLE = 1800;
const VG_STAFF_ABSOLUTE = 28800;
const VG_STAFF_CHALLENGE = 600;
const VG_STAFF_PDF_LIMIT = 8388608;

function vg_staff_error(int $status = 403, string $code = 'staff_forbidden', string $message = 'Bu işlem için geçerli çalışan yetkisi gerekiyor.'): void {
    vg_fail($status, $code, $message);
}

/** Resolve junctions/symlinks before accepting a private storage directory. */
function vg_staff_private_directory(string $candidate, ?string $anchor = null): string {
    if (!vg_ensure_dir($candidate)) vg_staff_error(503, 'staff_unavailable', 'Çalışan sistemi şu anda kullanılamıyor.');
    $actual = realpath($candidate); $web = realpath(vg_doc_root());
    if ($actual === false || $web === false) vg_staff_error(503, 'staff_unavailable', 'Çalışan sistemi şu anda kullanılamıyor.');
    $normalize = function ($path) { return strtolower(rtrim(str_replace('\\', '/', $path), '/')); };
    $resolved = $normalize($actual); $public = $normalize($web);
    if ($resolved === $public || strpos($resolved, $public . '/') === 0) vg_staff_error(503, 'staff_private_storage', 'Çalışan sistemi için özel depolama kurulmalı.');
    if ($anchor !== null) {
        $inside = realpath($anchor);
        if ($inside === false || strpos($resolved, $normalize($inside) . '/') !== 0) vg_staff_error(503, 'staff_private_storage', 'Çalışan sistemi için özel depolama kurulmalı.');
    }
    @chmod($actual, 0700);
    return $actual;
}

function vg_staff_dir(): string {
    static $dir;
    if ($dir !== null) return $dir;
    $base = realpath(vg_data_dir());
    $web = realpath(vg_doc_root());
    if ($base === false || $web === false) vg_staff_error(503, 'staff_unavailable', 'Çalışan sistemi şu anda kullanılamıyor.');
    $a = strtolower(str_replace('\\', '/', $base));
    $b = strtolower(rtrim(str_replace('\\', '/', $web), '/'));
    // Fail closed instead of using the public account system's web-root fallback.
    if ($a === $b || strpos($a, $b . '/') === 0) vg_staff_error(503, 'staff_private_storage', 'Çalışan sistemi için özel depolama kurulmalı.');
    $target = vg_staff_private_directory($base . '/staff', $base);
    vg_protect_dir($target);
    return $dir = $target;
}

/** One exclusive lock serializes invites, replay counters and payroll authorization. */
function vg_staff_store(callable $fn) {
    $dir = vg_staff_dir();
    $lock = @fopen($dir . '/store.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) vg_staff_error(503, 'staff_unavailable', 'Çalışan sistemi şu anda kullanılamıyor.');
    @chmod($dir . '/store.lock', 0600);
    try {
        $file = $dir . '/state.json';
        $state = ['version' => 1, 'users' => [], 'invites' => [], 'payroll' => [], 'rates' => [], 'audit' => []];
        if (is_file($file)) {
            $raw = @file_get_contents($file);
            $decoded = is_string($raw) ? json_decode($raw, true, 64) : null;
            if (!is_array($decoded) || ($decoded['version'] ?? null) !== 1) throw new RuntimeException('invalid staff store');
            foreach (['users', 'invites', 'payroll', 'rates', 'audit'] as $key) if (!isset($decoded[$key]) || !is_array($decoded[$key])) throw new RuntimeException('invalid staff collection');
            $state = $decoded;
        }
        $before = vg_json_encode($state);
        $result = $fn($state);
        $after = vg_json_encode($state);
        if ($after !== $before) {
            $tmp = $dir . '/state-' . bin2hex(random_bytes(12)) . '.tmp';
            if (@file_put_contents($tmp, $after, LOCK_EX) !== strlen($after)) { @unlink($tmp); throw new RuntimeException('staff write failed'); }
            @chmod($tmp, 0600);
            if (!@rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException('staff rename failed'); }
            @chmod($file, 0600);
        }
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function vg_staff_audit(array &$state, string $event, ?string $target = null): void {
    $state['audit'][] = ['at' => vg_iso(time()), 'actor' => $_SESSION['staff']['uid'] ?? 'cli', 'event' => $event, 'target' => $target];
    $state['audit'] = array_slice($state['audit'], -500);
}

/** Unlike best-effort counters, failed private storage prevents requests. */
function vg_staff_rate(string $bucket, string $key, int $max, int $window = 900): void {
    $retry = vg_staff_store(function (array &$s) use ($bucket, $key, $max, $window) {
        $now = time();
        foreach ($s['rates'] as $id => $r) if (($r['until'] ?? 0) <= $now) unset($s['rates'][$id]);
        $id = hash_hmac('sha256', 'staff:' . $bucket . ':' . $key, vg_secret());
        $r = $s['rates'][$id] ?? ['hits' => [], 'until' => $now + $window];
        $hits = array_values(array_filter($r['hits'], function ($t) use ($now, $window) { return is_int($t) && $t > $now - $window; }));
        if (count($hits) >= $max) return max(1, $window - ($now - min($hits)));
        if (count($s['rates']) >= 20000 && !isset($s['rates'][$id])) return $window;
        $hits[] = $now;
        $s['rates'][$id] = ['hits' => $hits, 'until' => $now + $window];
        return 0;
    });
    if ($retry > 0) vg_fail(429, 'staff_rate_limited', 'Çok fazla deneme yapıldı. Lütfen daha sonra yeniden deneyin.', [], ['Retry-After: ' . $retry], ['retryAfter' => $retry]);
}

function vg_staff_session_start(): void {
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    if (PHP_SAPI !== 'cli' && !vg_is_https() && preg_match('/^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$/D', $host) !== 1) vg_staff_error(503, 'staff_https_required', 'Çalışan sistemi güvenli HTTPS bağlantısı gerektirir.');
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (session_name() !== VG_STAFF_COOKIE) vg_staff_error(503, 'staff_session_conflict', 'Çalışan sistemi şu anda kullanılamıyor.');
        return;
    }
    $dir = vg_staff_private_directory(vg_staff_dir() . '/sessions', vg_staff_dir());
    if (isset($_COOKIE[VG_STAFF_COOKIE]) && (!is_string($_COOKIE[VG_STAFF_COOKIE]) || preg_match('/^[A-Za-z0-9,-]{22,256}$/', $_COOKIE[VG_STAFF_COOKIE]) !== 1)) unset($_COOKIE[VG_STAFF_COOKIE]);
    ini_set('session.save_handler', 'files');
    session_save_path($dir);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', (string)VG_STAFF_ABSOLUTE);
    session_cache_limiter('');
    session_name(VG_STAFF_COOKIE);
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => vg_is_https(), 'httponly' => true, 'samesite' => 'Strict']);
    if (!@session_start()) vg_staff_error(503, 'staff_unavailable', 'Çalışan sistemi şu anda kullanılamıyor.');
}

function vg_staff_csrf(): string {
    if (!isset($_SESSION['staff_csrf']) || !is_string($_SESSION['staff_csrf'])) $_SESSION['staff_csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['staff_csrf'];
}

function vg_staff_write_guard(): void {
    vg_check_fetch_site();
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    // Browser writes always carry Origin; missing Origin also fails closed.
    $parts = parse_url($origin);
    $scheme = vg_is_https() ? 'https' : 'http';
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $sent = is_array($parts) && isset($parts['host']) ? strtolower($parts['host']) . (isset($parts['port']) ? ':' . $parts['port'] : '') : '';
    $normalize = function ($h) use ($scheme) { return (string)preg_replace($scheme === 'https' ? '/:443$/' : '/:80$/', '', $h); };
    if (($parts['scheme'] ?? '') !== $scheme || $normalize($sent) !== $normalize($host) || $sent === '') vg_staff_error(403, 'staff_origin', 'Bu istek kabul edilmedi.');
    $token = (string)($_SERVER['HTTP_X_VG_STAFF_CSRF'] ?? '');
    if ($token === '' || !hash_equals(vg_staff_csrf(), $token)) vg_staff_error(403, 'staff_csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyin.');
}

function vg_staff_rotate(): void {
    if (!session_regenerate_id(true)) throw new RuntimeException('staff session rotation failed');
    $_SESSION['staff_csrf'] = bin2hex(random_bytes(32));
}

function vg_staff_public_user(array $u): array {
    return ['id' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']];
}

/** Called with the current locked snapshot, never a client-supplied role. */
function vg_staff_user_in(array $state): ?array {
    $a = $_SESSION['staff'] ?? null;
    if (!is_array($a) || empty($a['uid']) || empty($a['mfa'])) return null;
    $now = time();
    $u = $state['users'][$a['uid']] ?? null;
    if (!is_array($u) || ($u['status'] ?? '') !== 'active' || empty($u['mfaSecret']) || $u['epoch'] !== ($a['epoch'] ?? -1)
        || $now - (int)($a['last'] ?? 0) >= VG_STAFF_IDLE || $now - (int)($a['created'] ?? 0) >= VG_STAFF_ABSOLUTE) {
        unset($_SESSION['staff'], $_SESSION['staff_pending']);
        return null;
    }
    $_SESSION['staff']['last'] = $now;
    return $u;
}

function vg_staff_require_user(): array {
    vg_staff_session_start();
    $u = vg_staff_store(function (array &$s) { return vg_staff_user_in($s); });
    if ($u === null) vg_staff_error(401, 'staff_unauthorized', 'Çalışan hesabınızla ve doğrulama kodunuzla giriş yapın.');
    return vg_staff_public_user($u);
}

function vg_staff_require_in(array $state, array $roles = []): array {
    $u = vg_staff_user_in($state);
    if ($u === null) vg_staff_error(401, 'staff_unauthorized', 'Çalışan hesabınızla ve doğrulama kodunuzla giriş yapın.');
    if ($roles && !in_array($u['role'], $roles, true)) vg_staff_error();
    return $u;
}

function vg_staff_password($value): string {
    if (!is_string($value) || !preg_match('//u', $value)) vg_staff_error(422, 'staff_password', 'Şifre 12–64 karakter ve en fazla 72 bayt olmalı.');
    $count = preg_match_all('/./us', $value);
    if ($count < 12 || $count > 64 || strlen($value) > 72 || strpos($value, "\0") !== false) vg_staff_error(422, 'staff_password', 'Şifre 12–64 karakter ve en fazla 72 bayt olmalı.');
    return $value;
}

function vg_staff_base32(string $bytes): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = '';
    for ($i = 0; $i < strlen($bytes); $i++) $bits .= str_pad(decbin(ord($bytes[$i])), 8, '0', STR_PAD_LEFT);
    $out = '';
    foreach (str_split($bits, 5) as $group) $out .= $alphabet[bindec(str_pad($group, 5, '0'))];
    return $out;
}

function vg_staff_totp(string $secret, int $step): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = '';
    foreach (str_split($secret) as $char) {
        $v = strpos($alphabet, $char);
        if ($v === false) throw new RuntimeException('invalid authenticator secret');
        $bits .= str_pad(decbin($v), 5, '0', STR_PAD_LEFT);
    }
    $key = ''; foreach (str_split($bits, 8) as $group) if (strlen($group) === 8) $key .= chr(bindec($group));
    $hash = hash_hmac('sha1', pack('N2', intdiv($step, 4294967296), $step % 4294967296), $key, true);
    $offset = ord($hash[19]) & 15;
    $binary = unpack('N', substr($hash, $offset, 4))[1] & 0x7fffffff;
    return str_pad((string)($binary % 1000000), 6, '0', STR_PAD_LEFT);
}

function vg_staff_totp_step(string $secret, $code, int $last): int {
    if (!is_string($code) || preg_match('/^[0-9]{6}$/D', $code) !== 1) return -1;
    $current = intdiv(time(), 30);
    foreach ([$current, $current - 1, $current + 1] as $step) if ($step > $last && hash_equals(vg_staff_totp($secret, $step), $code)) return $step;
    return -1;
}

function vg_staff_begin_pending(array $u, string $mode): array {
    vg_staff_rotate();
    unset($_SESSION['staff']);
    $_SESSION['staff_pending'] = ['uid' => $u['id'], 'epoch' => $u['epoch'], 'created' => time(), 'mode' => $mode];
    if ($mode === 'enroll') $_SESSION['staff_pending']['secret'] = vg_staff_base32(random_bytes(20));
    return vg_staff_pending_payload($u);
}

function vg_staff_pending_payload(array $u): array {
    $p = $_SESSION['staff_pending'];
    $out = ['mfa_required' => true, 'mode' => $p['mode'], 'csrf' => vg_staff_csrf()];
    if ($p['mode'] === 'enroll') {
        $out['secret'] = $p['secret'];
        $out['otpauth'] = 'otpauth://totp/' . rawurlencode('VoltGuard:' . $u['email']) . '?secret=' . $p['secret'] . '&issuer=VoltGuard&algorithm=SHA1&digits=6&period=30';
    }
    return $out;
}

function vg_staff_finish_login(array $u): array {
    vg_staff_rotate();
    unset($_SESSION['staff_pending']);
    $_SESSION['staff'] = ['uid' => $u['id'], 'epoch' => $u['epoch'], 'mfa' => true, 'created' => time(), 'last' => time()];
    return ['user' => vg_staff_public_user($u), 'csrf' => vg_staff_csrf()];
}

function vg_staff_make_invite(array &$state, array $input, bool $bootstrap = false): array {
    $email = strtolower(trim(is_string($input['email'] ?? null) ? $input['email'] : ''));
    $name = trim(is_string($input['name'] ?? null) ? $input['name'] : '');
    $role = $input['role'] ?? 'employee';
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || !preg_match('//u', $name) || strlen($name) < 2 || strlen($name) > 240 || !in_array($role, ['employee', 'payroll', 'admin'], true)) vg_staff_error(422, 'staff_invalid_fields', 'Ad, e-posta ve hesap rolünü kontrol edin.');
    if ($bootstrap && count($state['users']) > 0) vg_staff_error(409, 'staff_bootstrapped', 'İlk yönetici kurulumu zaten yapılmış.');
    $id = null;
    foreach ($state['users'] as $candidate) if ($candidate['email'] === $email) { $id = $candidate['id']; break; }
    if ($id !== null) {
        $old = $state['users'][$id];
        // Re-invites are a recovery operation: never allow reset of oneself/last administrator.
        if ($id === ($_SESSION['staff']['uid'] ?? null)) vg_staff_error(409, 'staff_self_reset', 'Kendi hesabınız için başka bir yöneticiden yardım alın.');
        vg_staff_keep_admin($state, $id);
        $epoch = $old['epoch'] + 1;
    } else {
        if (count($state['users']) >= 10000) vg_staff_error(409, 'staff_capacity', 'Çalışan sınırına ulaşıldı.');
        $id = 's' . bin2hex(random_bytes(12)); $epoch = 1;
    }
    foreach ($state['invites'] as $hash => $invite) if ($invite['userId'] === $id || $invite['expires'] <= time()) unset($state['invites'][$hash]);
    $state['users'][$id] = ['id' => $id, 'name' => $name, 'email' => $email, 'role' => $role, 'status' => 'invited', 'epoch' => $epoch, 'password' => null, 'mfaSecret' => null, 'lastTotpStep' => -1, 'createdAt' => $state['users'][$id]['createdAt'] ?? vg_iso(time())];
    $token = bin2hex(random_bytes(32)); $expires = time() + 86400;
    $state['invites'][hash('sha256', $token)] = ['userId' => $id, 'expires' => $expires, 'epoch' => $epoch];
    vg_staff_audit($state, $bootstrap ? 'admin_bootstrap' : 'invitation_created', $id);
    return ['userId' => $id, 'activationUrl' => vg_staff_site_url() . '/calisan/etkinlestir.html#t=' . $token, 'expiresAt' => vg_iso($expires)];
}

function vg_staff_site_url(): string {
    $value = getenv('VG_STAFF_SITE_URL');
    if (!is_string($value) || trim($value) === '') return 'https://voltguard.com.tr';
    $value = rtrim(trim($value), '/');
    if (preg_match('#^https://[A-Za-z0-9.\-]+(:[0-9]+)?$#D', $value) === 1 || preg_match('#^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$#D', $value) === 1) return $value;
    vg_staff_error(503, 'staff_site_url', 'Çalışan sistemi yapılandırması kontrol edilmeli.');
    return '';
}

function vg_staff_keep_admin(array $state, string $id): void {
    $target = $state['users'][$id] ?? null;
    if (!$target || $target['role'] !== 'admin' || $target['status'] === 'disabled') return;
    foreach ($state['users'] as $u) if ($u['id'] !== $id && $u['role'] === 'admin' && $u['status'] === 'active' && !empty($u['mfaSecret'])) return;
    vg_staff_error(409, 'staff_last_admin', 'Son yönetici kapatılamaz. Önce ikinci yönetici hesabını etkinleştirin.');
}

function vg_staff_money($value): string {
    if (!is_string($value) && !is_int($value) && !is_float($value)) vg_staff_error(422, 'staff_payroll_invalid', 'Bordro tutarlarını kontrol edin.');
    $text = trim((string)$value);
    if (!preg_match('/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/D', $text)) vg_staff_error(422, 'staff_payroll_invalid', 'Tutarlar negatif olmamalı ve en fazla iki ondalık basamak içermeli.');
    $parts = explode('.', $text); return $parts[0] . '.' . str_pad($parts[1] ?? '', 2, '0');
}

function vg_staff_payroll_visible(array $user, array $row): bool {
    return in_array($user['role'], ['admin', 'payroll'], true) || $row['userId'] === $user['id'];
}

function vg_staff_payroll_public(array $row, array $state): array {
    $out = $row; unset($out['pdfFile']);
    $out['employeeName'] = $state['users'][$row['userId']]['name'] ?? '';
    $out['hasPdf'] = !empty($row['pdfFile']);
    return $out;
}

function vg_staff_dispatch(string $action, array $body): array {
    if ($action === 'me') return vg_staff_store(function (array &$s) {
        $u = vg_staff_user_in($s);
        $out = ['user' => $u ? vg_staff_public_user($u) : null, 'csrf' => vg_staff_csrf(), 'mfa' => null];
        $p = $_SESSION['staff_pending'] ?? null;
        if (!$u && is_array($p)) {
            $candidate = $s['users'][$p['uid']] ?? null;
            if (!$candidate || $candidate['epoch'] !== $p['epoch'] || $candidate['status'] === 'disabled' || time() - $p['created'] >= VG_STAFF_CHALLENGE) unset($_SESSION['staff_pending']);
            else $out['mfa'] = ['required' => true] + vg_staff_pending_payload($candidate);
        }
        return $out;
    });
    if ($action === 'login') {
        $email = strtolower(trim(is_string($body['email'] ?? null) ? $body['email'] : ''));
        vg_staff_rate('login-ip', vg_rl_ip_key(), 30);
        vg_staff_rate('login-email', $email, 10);
        $pw = is_string($body['password'] ?? null) ? $body['password'] : '';
        if (strlen($pw) > 256) $pw = '';
        return vg_staff_store(function (array &$s) use ($email, $pw) {
            $found = null; foreach ($s['users'] as $u) if ($u['email'] === $email) { $found = $u; break; }
            // A valid static dummy bcrypt hash avoids generating a new hash on every failed login.
            $hash = $found['password'] ?? '$2y$12$wXYfSiKtABLDKBQgXXFxyOcXeA5c1BiMeO.gMwV3sCuh.cBOaxnVy';
            $matches = password_verify($pw, $hash);
            if (!$found || !$matches || !in_array($found['status'], ['active', 'enrollment'], true)) vg_staff_error(401, 'staff_login_failed', 'E-posta, şifre veya çalışan erişimi geçersiz.');
            return vg_staff_begin_pending($found, empty($found['mfaSecret']) ? 'enroll' : 'verify');
        });
    }
    if ($action === 'activate') {
        vg_staff_rate('activate-ip', vg_rl_ip_key(), 15, 3600);
        $token = is_string($body['token'] ?? null) ? $body['token'] : '';
        $password = vg_staff_password($body['password'] ?? null);
        if (preg_match('/^[a-f0-9]{64}$/D', $token) !== 1) vg_staff_error(400, 'staff_invite_invalid', 'Bağlantı geçersiz, kullanılmış veya süresi dolmuş.');
        $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        if (!is_string($passwordHash)) throw new RuntimeException('staff password hash failed');
        return vg_staff_store(function (array &$s) use ($token, $passwordHash) {
            $hash = hash('sha256', $token); $invite = $s['invites'][$hash] ?? null;
            $u = $invite ? ($s['users'][$invite['userId']] ?? null) : null;
            if (!$invite || !$u || $invite['expires'] <= time() || $u['epoch'] !== $invite['epoch'] || $u['status'] !== 'invited') vg_staff_error(400, 'staff_invite_invalid', 'Bağlantı geçersiz, kullanılmış veya süresi dolmuş.');
            unset($s['invites'][$hash]);
            $u['password'] = $passwordHash; $u['status'] = 'enrollment'; $u['epoch']++;
            $s['users'][$u['id']] = $u;
            vg_staff_audit($s, 'invitation_activated', $u['id']);
            return vg_staff_begin_pending($u, 'enroll');
        });
    }
    if ($action === 'mfa_verify' || $action === 'mfa_enroll') {
        vg_staff_rate('mfa-ip', vg_rl_ip_key(), 30);
        $p = $_SESSION['staff_pending'] ?? null;
        if (!is_array($p)) vg_staff_error(401, 'staff_challenge_expired', 'Giriş adımını yeniden başlatın.');
        vg_staff_rate('mfa-user', $p['uid'], 10);
        return vg_staff_store(function (array &$s) use ($action, $body, $p) {
            $u = $s['users'][$p['uid']] ?? null;
            $mode = $action === 'mfa_enroll' ? 'enroll' : 'verify';
            if (!$u || $u['epoch'] !== $p['epoch'] || $u['status'] === 'disabled' || $p['mode'] !== $mode || time() - $p['created'] >= VG_STAFF_CHALLENGE) vg_staff_error(401, 'staff_challenge_expired', 'Giriş adımını yeniden başlatın.');
            if (($mode === 'enroll' && !empty($u['mfaSecret'])) || ($mode === 'verify' && $u['status'] !== 'active')) vg_staff_error(401, 'staff_challenge_expired', 'Giriş adımını yeniden başlatın.');
            $secret = $mode === 'enroll' ? $p['secret'] : $u['mfaSecret'];
            $step = vg_staff_totp_step($secret, $body['code'] ?? null, $u['lastTotpStep']);
            if ($step < 0) vg_staff_error(401, 'staff_mfa_failed', 'Doğrulama kodu geçersiz veya daha önce kullanılmış.');
            $u['lastTotpStep'] = $step;
            if ($mode === 'enroll') { $u['mfaSecret'] = $secret; $u['status'] = 'active'; $u['epoch']++; }
            $s['users'][$u['id']] = $u;
            vg_staff_audit($s, $mode === 'enroll' ? 'mfa_enrolled' : 'login', $u['id']);
            return vg_staff_finish_login($u);
        });
    }
    if ($action === 'logout') {
        $_SESSION = []; vg_staff_rotate(); return ['user' => null, 'csrf' => vg_staff_csrf()];
    }
    if ($action === 'create_invite') {
        vg_staff_rate('invite-ip', vg_rl_ip_key(), 30, 3600);
        return vg_staff_store(function (array &$s) use ($body) { vg_staff_require_in($s, ['admin']); return vg_staff_make_invite($s, $body); });
    }
    if ($action === 'users') return vg_staff_store(function (array &$s) {
        $manager = vg_staff_require_in($s, ['admin', 'payroll']);
        $items = []; foreach ($s['users'] as $u) $items[] = vg_staff_public_user($u) + ['status' => $u['status'], 'mfaEnrolled' => !empty($u['mfaSecret'])];
        return ['items' => $items, 'canInvite' => $manager['role'] === 'admin'];
    });
    if ($action === 'disable_user') return vg_staff_store(function (array &$s) use ($body) {
        $actor = vg_staff_require_in($s, ['admin']); $id = $body['userId'] ?? '';
        if (!is_string($id) || !isset($s['users'][$id])) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
        if ($id === $actor['id']) vg_staff_error(409, 'staff_self_disable', 'Kendi hesabınızı kapatamazsınız.');
        vg_staff_keep_admin($s, $id);
        $s['users'][$id]['status'] = 'disabled'; $s['users'][$id]['epoch']++;
        foreach ($s['invites'] as $key => $invite) if ($invite['userId'] === $id) unset($s['invites'][$key]);
        vg_staff_audit($s, 'user_disabled', $id); return [];
    });
    if ($action === 'payroll_list') return vg_staff_store(function (array &$s) {
        $u = vg_staff_require_in($s); $items = [];
        foreach ($s['payroll'] as $row) if (vg_staff_payroll_visible($u, $row)) $items[] = vg_staff_payroll_public($row, $s);
        usort($items, function ($a, $b) { return strcmp($b['period'] . $b['createdAt'], $a['period'] . $a['createdAt']); });
        return ['items' => $items, 'canManage' => in_array($u['role'], ['admin', 'payroll'], true)];
    });
    if ($action === 'payroll_create') return vg_staff_store(function (array &$s) use ($body) {
        vg_staff_require_in($s, ['admin', 'payroll']);
        $id = $body['userId'] ?? ''; $period = $body['period'] ?? ''; $note = $body['note'] ?? '';
        if (!is_string($id) || !isset($s['users'][$id]) || !is_string($period) || preg_match('/^20[0-9]{2}-(0[1-9]|1[0-2])$/D', $period) !== 1 || !is_string($note) || strlen($note) > 2000 || !preg_match('//u', $note)) vg_staff_error(422, 'staff_payroll_invalid', 'Çalışan, dönem ve açıklamayı kontrol edin.');
        $row = ['id' => 'p' . bin2hex(random_bytes(12)), 'userId' => $id, 'period' => $period, 'gross' => vg_staff_money($body['gross'] ?? ''), 'net' => vg_staff_money($body['net'] ?? ''), 'deductions' => vg_staff_money($body['deductions'] ?? ''), 'note' => $note, 'createdAt' => vg_iso(time()), 'pdfFile' => null];
        if (count($s['payroll']) >= 50000) vg_staff_error(409, 'staff_capacity', 'Bordro sınırına ulaşıldı.');
        $s['payroll'][$row['id']] = $row; vg_staff_audit($s, 'payroll_created', $row['id']);
        return ['item' => vg_staff_payroll_public($row, $s)];
    });
    if ($action === 'payroll_delete') return vg_staff_store(function (array &$s) use ($body) {
        vg_staff_require_in($s, ['admin', 'payroll']); $id = $body['statementId'] ?? '';
        if (!is_string($id) || !isset($s['payroll'][$id])) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
        $file = $s['payroll'][$id]['pdfFile']; unset($s['payroll'][$id]);
        // Files removed after state commit would need a journal; orphaned private PDFs are harmless.
        vg_staff_audit($s, 'payroll_deleted', $id); return [];
    });
    vg_staff_error(404, 'staff_action_not_found', 'İşlem bulunamadı.'); return [];
}

function vg_staff_pdf_upload(array $input): array {
    vg_staff_rate('pdf-ip', vg_rl_ip_key(), 30, 3600);
    // Check management authorization before parsing or moving any file.
    vg_staff_store(function (array &$s) { vg_staff_require_in($s, ['admin', 'payroll']); });
    $file = $_FILES['pdf'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name']) || ($file['size'] ?? 0) < 8 || $file['size'] > VG_STAFF_PDF_LIMIT) vg_staff_error(422, 'staff_pdf_invalid', 'En fazla 8 MB boyutunda bir PDF dosyası yükleyin.');
    if (!class_exists('finfo')) vg_staff_error(503, 'staff_upload_unavailable', 'PDF yükleme şu anda kullanılamıyor.');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $head = @file_get_contents($file['tmp_name'], false, null, 0, 5);
    $size = @filesize($file['tmp_name']);
    $tail = $size ? @file_get_contents($file['tmp_name'], false, null, max(0, $size - 2048), 2048) : '';
    if ($mime !== 'application/pdf' || $head !== '%PDF-' || !is_string($tail) || strpos($tail, '%%EOF') === false || $size > VG_STAFF_PDF_LIMIT) vg_staff_error(422, 'staff_pdf_invalid', 'Dosya geçerli bir PDF olarak doğrulanamadı.');
    $directory = vg_staff_private_directory(vg_staff_dir() . '/documents', vg_staff_dir());
    $filename = bin2hex(random_bytes(24)) . '.pdf'; $path = $directory . '/' . $filename;
    if (!move_uploaded_file($file['tmp_name'], $path)) throw new RuntimeException('staff upload failed'); @chmod($path, 0600);
    try {
        return vg_staff_store(function (array &$s) use ($input, $filename) {
            vg_staff_require_in($s, ['admin', 'payroll']); $id = $input['statementId'] ?? '';
            if (!is_string($id) || !isset($s['payroll'][$id])) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
            $s['payroll'][$id]['pdfFile'] = $filename; vg_staff_audit($s, 'payroll_pdf_uploaded', $id);
            return ['item' => vg_staff_payroll_public($s['payroll'][$id], $s)];
        });
    } catch (Throwable $e) { @unlink($path); throw $e; }
}

function vg_staff_pdf_download(string $id): void {
    // Keep the store lock until streaming finishes: disable cannot race authorization.
    vg_staff_store(function (array &$s) use ($id) {
        $u = vg_staff_require_in($s); $row = $s['payroll'][$id] ?? null;
        if (!$row || !vg_staff_payroll_visible($u, $row) || empty($row['pdfFile']) || !preg_match('/^[a-f0-9]{48}\.pdf$/D', $row['pdfFile'])) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
        $directory = vg_staff_private_directory(vg_staff_dir() . '/documents', vg_staff_dir());
        $path = $directory . '/' . $row['pdfFile'];
        $actual = realpath($path);
        if ($actual === false || strpos(strtolower(str_replace('\\', '/', $actual)), strtolower(rtrim(str_replace('\\', '/', $directory), '/')) . '/') !== 0) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
        $stream = @fopen($path, 'rb'); if ($stream === false) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
        vg_common_headers(200, []);
        header('Content-Type: application/pdf'); header('Content-Disposition: attachment; filename="bordro-' . $row['period'] . '.pdf"');
        header('Content-Length: ' . filesize($path)); header("Content-Security-Policy: sandbox; default-src 'none'");
        fpassthru($stream); fclose($stream);
        return null;
    });
}

function vg_staff_run(): void {
    ob_start();
    try {
        vg_check_fetch_site(); vg_staff_session_start(); $action = vg_action(); $method = vg_method();
        $reads = ['me', 'users', 'payroll_list', 'payroll_download'];
        $writes = ['login', 'activate', 'mfa_verify', 'mfa_enroll', 'logout', 'create_invite', 'disable_user', 'payroll_create', 'payroll_delete', 'payroll_upload'];
        if (!in_array($action, array_merge($reads, $writes), true)) vg_staff_error(404, 'staff_action_not_found', 'İşlem bulunamadı.');
        if (($method === 'GET' && !in_array($action, $reads, true)) || ($method === 'POST' && !in_array($action, $writes, true)) || !in_array($method, ['GET', 'POST'], true)) vg_staff_error(405, 'staff_method', 'İstek yöntemi desteklenmiyor.');
        $input = [];
        if ($method === 'POST') {
            vg_staff_write_guard();
            if ($action === 'payroll_upload') {
                if (strpos(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data;') !== 0 || (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > VG_STAFF_PDF_LIMIT + 65536) vg_staff_error(413, 'staff_pdf_invalid', 'En fazla 8 MB boyutunda bir PDF dosyası yükleyin.');
                $input = $_POST;
            } else $input = vg_json_body(16384);
        }
        if ($action === 'payroll_download') {
            $id = $_GET['id'] ?? ''; if (!is_string($id) || preg_match('/^p[a-f0-9]{24}$/D', $id) !== 1) vg_staff_error(404, 'staff_not_found', 'Kayıt bulunamadı.');
            vg_discard_output(); vg_staff_pdf_download($id); return;
        }
        $payload = $action === 'payroll_upload' ? vg_staff_pdf_upload($input) : vg_staff_dispatch($action, $input);
        vg_discard_output(); vg_common_headers(200, []); echo vg_json_encode(['api' => 'vg-staff/1', 'ok' => true] + $payload);
    } catch (VgHttpError $e) {
        vg_discard_output(); vg_common_headers($e->status, $e->headers); echo vg_json_encode(['api' => 'vg-staff/1', 'ok' => false, 'error' => $e->errCode, 'message' => $e->getMessage()] + $e->extra);
    } catch (Throwable $e) {
        error_log('VoltGuard staff: request failed (' . get_class($e) . ')');
        vg_discard_output(); vg_common_headers(503, []); echo vg_json_encode(['api' => 'vg-staff/1', 'ok' => false, 'error' => 'staff_unavailable', 'message' => 'Çalışan sistemi şu anda kullanılamıyor.']);
    } finally {
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    }
}
