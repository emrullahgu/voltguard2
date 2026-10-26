<?php
/** Private-terminal diagnostics only. Do not load application bootstrap/store/session helpers here: they can write. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

function access_diag_inside(string $path, string $root): bool
{
    $normalize = function (string $p): string {
        $p = rtrim(str_replace('\\', '/', $p), '/');
        return PHP_OS_FAMILY === 'Windows' ? strtolower($p) : $p;
    };
    $path = $normalize($path); $root = $normalize($root);
    return $path === $root || strpos($path, $root . '/') === 0;
}

/** Read only an existing regular file whose resolved target stays within the requested store. */
function access_diag_read(string $file, string $anchor): array
{
    if (!file_exists($file)) return ['status' => 'missing'];
    $actual = realpath($file); $base = realpath($anchor);
    if ($actual === false || $base === false || !is_file($actual) || !access_diag_inside($actual, $base)) return ['status' => 'unsafe_path'];
    $size = @filesize($actual);
    if ($size === false || $size > 32 * 1024 * 1024) return ['status' => 'unreadable_or_too_large'];
    $raw = @file_get_contents($actual);
    return is_string($raw) ? ['status' => 'ok', 'raw' => $raw] : ['status' => 'unreadable'];
}

function access_diag_json(string $file, string $anchor): array
{
    $read = access_diag_read($file, $anchor);
    if ($read['status'] !== 'ok') return ['status' => $read['status']];
    $data = json_decode($read['raw'], true, 64);
    return is_array($data) ? ['status' => 'ok', 'data' => $data] : ['status' => 'invalid_json'];
}

function access_diag_json_accounts(string $dir, string $anchor, ?string $email): array
{
    $out = ['exists' => is_dir($dir), 'status' => 'missing', 'accountCount' => null, 'accountFileCount' => null, 'emailExists' => null];
    if (!$out['exists']) return $out;
    $actual = realpath($dir); $base = realpath($anchor);
    if ($actual === false || $base === false || !access_diag_inside($actual, $base)) { $out['status'] = 'unsafe_path'; return $out; }
    $read = access_diag_json($dir . '/emails.json', $anchor);
    $out['status'] = $read['status'];
    if ($read['status'] !== 'ok') return $out;
    $index = $read['data']; $valid = [];
    foreach ($index as $address => $id) {
        if (is_string($address) && filter_var($address, FILTER_VALIDATE_EMAIL) && is_string($id) && preg_match('/^u[a-f0-9]{24}$/D', $id)) $valid[$address] = $id;
    }
    if (count($valid) !== count($index)) $out['status'] = 'invalid_email_index';
    $out['accountCount'] = count($valid);
    $users = realpath($dir . '/users'); $base = realpath($dir);
    if ($users !== false && $base !== false && access_diag_inside($users, $base)) {
        $files = @scandir($users);
        if (is_array($files)) $out['accountFileCount'] = count(array_filter($files, function ($f) use ($users) {
            return preg_match('/^u[a-f0-9]{24}\.json$/D', $f) && is_file($users . '/' . $f);
        }));
    }
    if ($email !== null) {
        $out['emailExists'] = false;
        if (isset($valid[$email])) {
            $user = access_diag_json($dir . '/users/' . $valid[$email] . '.json', $anchor);
            if ($user['status'] !== 'ok') { $out['emailExists'] = null; $out['requestedRecordStatus'] = $user['status']; }
            else $out['emailExists'] = isset($user['data']['email']) && is_string($user['data']['email']) && strtolower(trim($user['data']['email'])) === $email;
        }
    }
    return $out;
}

function access_diag_sqlite(string $file, string $anchor, ?string $email): array
{
    $out = ['exists' => is_file($file), 'status' => 'missing', 'accountCount' => null, 'emailExists' => null];
    if (!$out['exists']) return $out;
    $actual = realpath($file); $base = realpath($anchor);
    if ($actual === false || $base === false || !access_diag_inside($actual, $base)) { $out['status'] = 'unsafe_path'; return $out; }
    // Immutable SQLite never creates locks/journals/shm. Do not ignore a live WAL or a pending rollback journal.
    foreach (['-wal', '-shm', '-journal'] as $suffix) {
        if (file_exists($actual . $suffix)) { $out['status'] = 'sidecar_present_use_consistent_snapshot'; return $out; }
    }
    $path = str_replace('\\', '/', $actual);
    if (preg_match('/^[a-z]:\//i', $path)) $path = '/' . $path;
    $uri = 'file:' . str_replace(['%2F', '%3A'], ['/', ':'], rawurlencode($path)) . '?mode=ro&immutable=1';
    $db = null;
    try {
        // PDO preserves SQLite URI parameters; PHP's SQLite3 wrapper expands URI filenames as ordinary paths.
        if (class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true) && defined('PDO::SQLITE_ATTR_OPEN_FLAGS') && defined('PDO::SQLITE_OPEN_READONLY')) {
            $db = new PDO('sqlite:' . $uri, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY]);
            $out['accountCount'] = (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn();
            if ($email !== null) {
                $stmt = $db->prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1');
                $stmt->execute([$email]); $out['emailExists'] = $stmt->fetchColumn() !== false;
                $stmt = null;
            }
            $out['status'] = 'ok';
        } else $out['status'] = 'readonly_sqlite_driver_unavailable';
    } catch (Throwable $error) {
        // Never print exception text: it can contain paths, SQL values or driver details.
        $out['status'] = 'sqlite_read_failed'; $out['accountCount'] = null; $out['emailExists'] = null;
    } finally {
        $db = null;
    }
    return $out;
}

function access_diag_staff(string $dir, ?string $email): array
{
    $read = access_diag_json($dir . '/staff/state.json', $dir);
    $out = ['exists' => is_file($dir . '/staff/state.json'), 'status' => $read['status'], 'accountCount' => null, 'activeMfaAdminCount' => null];
    if ($email !== null) $out['requestedAccount'] = ['exists' => null];
    if ($read['status'] === 'missing') { $out['accountCount'] = 0; $out['activeMfaAdminCount'] = 0; if ($email !== null) $out['requestedAccount']['exists'] = false; return $out; }
    if ($read['status'] !== 'ok') return $out;
    $state = $read['data'];
    if (($state['version'] ?? null) !== 1 || !isset($state['users']) || !is_array($state['users'])) { $out['status'] = 'invalid_staff_store'; return $out; }
    foreach (['invites', 'payroll', 'rates', 'audit'] as $collection) {
        if (!isset($state[$collection]) || !is_array($state[$collection])) $out['status'] = 'invalid_staff_store';
    }
    $out['accountCount'] = count($state['users']); $out['activeMfaAdminCount'] = 0;
    $out['statusCounts'] = ['active' => 0, 'invited' => 0, 'enrollment' => 0, 'disabled' => 0, 'unknown' => 0];
    if ($email !== null) $out['requestedAccount'] = ['exists' => false];
    foreach ($state['users'] as $user) {
        if (!is_array($user)) { $out['status'] = 'invalid_staff_store'; continue; }
        $status = is_string($user['status'] ?? null) && isset($out['statusCounts'][$user['status']]) ? $user['status'] : 'unknown';
        $role = in_array($user['role'] ?? null, ['employee', 'payroll', 'admin'], true) ? $user['role'] : 'unknown';
        $mfa = is_string($user['mfaSecret'] ?? null) && $user['mfaSecret'] !== '';
        $out['statusCounts'][$status]++;
        if ($role === 'admin' && $status === 'active' && $mfa) $out['activeMfaAdminCount']++;
        if ($email !== null && is_string($user['email'] ?? null) && strtolower(trim($user['email'])) === $email) $out['requestedAccount'] = ['exists' => true, 'status' => $status, 'role' => $role, 'mfaEnrolled' => $mfa];
    }
    return $out;
}

function access_diag_store(string $path, string $docroot, ?string $email): array
{
    $actual = realpath($path);
    $out = ['path' => str_replace('\\', '/', $path), 'exists' => is_dir($path), 'readable' => is_readable($path), 'writable' => is_writable($path),
        'outsideDocroot' => $actual !== false ? !access_diag_inside($actual, $docroot) : null, 'kind' => null, 'markerStatus' => 'missing', 'accountCount' => null, 'emailExists' => null];
    $marker = access_diag_read($path . '/store.kind', $path);
    $out['markerStatus'] = $marker['status'];
    if ($marker['status'] === 'ok') {
        $kind = trim($marker['raw']);
        if (in_array($kind, ['json', 'sqlite'], true)) $out['kind'] = $kind;
        else $out['markerStatus'] = 'invalid_kind';
    }
    $out['json'] = access_diag_json_accounts($path . '/json', $path, $email);
    $out['sqlite'] = access_diag_sqlite($path . '/vg-accounts.sqlite', $path, $email);
    $out['staff'] = access_diag_staff($path, $email);
    if ($out['kind'] !== null) {
        $active = $out[$out['kind']];
        $out['accountCount'] = $active['accountCount']; $out['emailExists'] = $active['emailExists'];
    }
    return $out;
}

function access_diag_main(array $args): int
{
    $options = [];
    for ($i = 1; $i < count($args); $i++) {
        if ($args[$i] === '--help') { fwrite(STDOUT, "Usage: php tools/diagnose-access.php --docroot /absolute/public_html [--email address]\nVG_DATA_DIR selects the private store. This tool never initializes storage, sends mail or creates a session.\n"); return 0; }
        if (!preg_match('/^--(docroot|email)(?:=(.*))?$/D', $args[$i], $match) || isset($options[$match[1]])) throw new InvalidArgumentException();
        $value = $match[2] ?? ($args[$i + 1] ?? '');
        if (!isset($match[2])) $i++;
        if ($value === '' || strpos($value, '--') === 0) throw new InvalidArgumentException();
        $options[$match[1]] = $value;
    }
    if (!isset($options['docroot']) || !preg_match('~^(?:[a-z]:[\\\\/]|/|\\\\\\\\)~i', $options['docroot'])) throw new InvalidArgumentException();
    $docroot = realpath($options['docroot']);
    if ($docroot === false || !is_dir($docroot)) throw new InvalidArgumentException();
    $email = isset($options['email']) ? strtolower(trim($options['email'])) : null;
    if ($email !== null && (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL))) throw new InvalidArgumentException();
    $env = trim((string)getenv('VG_DATA_DIR'));
    if ($env !== '' && !preg_match('~^(?:[a-z]:[\\\\/]|/|\\\\\\\\)~i', $env)) throw new InvalidArgumentException();
    $selectedPath = $env !== '' ? $env : dirname($docroot) . '/vg-data';
    $selected = access_diag_store($selectedPath, $docroot, $email);
    $legacy = access_diag_store($docroot . '/_vgdata', $docroot, $email);
    $findings = [];
    if (!$selected['exists']) $findings[] = 'selected_directory_missing';
    if ($selected['outsideDocroot'] === false) $findings[] = 'selected_directory_inside_webroot';
    if ($selected['markerStatus'] !== 'ok' && ($selected['json']['exists'] || $selected['sqlite']['exists'])) $findings[] = 'selected_store_marker_missing_or_invalid';
    $selectedCount = $selected['accountCount']; $legacyCount = max($legacy['json']['accountCount'] ?? 0, $legacy['sqlite']['accountCount'] ?? 0);
    if ($legacyCount > 0 && ($selectedCount === 0 || (!$selected['json']['exists'] && !$selected['sqlite']['exists']))) $findings[] = 'legacy_accounts_not_in_selected_store';
    if ($email !== null && ($legacy['json']['emailExists'] === true || $legacy['sqlite']['emailExists'] === true) && $selected['emailExists'] === false) $findings[] = 'requested_member_only_in_legacy_store';
    if ($selected['staff']['accountCount'] === 0) $findings[] = 'selected_staff_not_initialized';
    if (($legacy['staff']['accountCount'] ?? 0) > 0 && $selected['staff']['accountCount'] === 0) $findings[] = 'legacy_staff_not_in_selected_store';
    if ($selected['staff']['accountCount'] > 0 && $selected['staff']['activeMfaAdminCount'] === 0) $findings[] = 'selected_staff_has_no_active_mfa_admin';
    $outbox = getenv('VG_MAIL_OUTBOX') === '1';
    if ($outbox) $findings[] = 'cli_mail_outbox_enabled_no_delivery';
    elseif (!function_exists('mail')) $findings[] = 'cli_mail_function_unavailable';
    $stores = ['selected' => $selected, 'legacy' => $legacy];
    $defaultPath = dirname($docroot) . '/vg-data';
    if ($env !== '' && (realpath($selectedPath) ?: str_replace('\\', '/', $selectedPath)) !== (realpath($defaultPath) ?: str_replace('\\', '/', $defaultPath))) $stores['externalDefault'] = access_diag_store($defaultPath, $docroot, $email);
    $report = ['format' => 'vg-access-diagnostics/1', 'readOnly' => true, 'docroot' => str_replace('\\', '/', $docroot), 'requestedEmail' => $email,
        'selectionSource' => $env !== '' ? 'VG_DATA_DIR' : 'docroot_parent',
        'runtime' => ['sapi' => PHP_SAPI, 'phpVersion' => PHP_VERSION, 'mailFunctionAvailable' => function_exists('mail'), 'sendmailPathConfigured' => trim((string)ini_get('sendmail_path')) !== '',
            'outboxMode' => $outbox, 'pdoSqliteLoaded' => extension_loaded('pdo_sqlite'), 'sqlite3Loaded' => extension_loaded('sqlite3'), 'fileinfoLoaded' => extension_loaded('fileinfo')],
        'stores' => $stores, 'findings' => $findings,
        'notes' => ['CLI PHP/environment may differ from the web PHP runtime. Mail capability is not a delivery test.', 'No application bootstrap is loaded; no directories, sessions, databases, locks, records or mail are created.',
            'JSON account counts are valid email-index entries; accountFileCount is reported separately. Files may change during this unlocked read.', 'SQLite uses PDO immutable/read-only; inspect a consistent offline snapshot if the database may be changing. Sidecars are refused. Legacy data is never migrated.']];
    fwrite(STDOUT, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
    return 0;
}

try { exit(access_diag_main($argv)); }
catch (InvalidArgumentException $error) { fwrite(STDERR, "Use --docroot <existing absolute web root> and optional --email <address>; VG_DATA_DIR must be absolute. No data was changed.\n"); exit(2); }
catch (Throwable $error) { fwrite(STDERR, "Diagnostics could not complete; no exception details or account contents are disclosed.\n"); exit(1); }
