<?php
/**
 * Read-only, aggregate retention inventory. Never load the application bootstrap here: it can write.
 * php tools/retention-audit.php --data-dir <existing-absolute-private-directory> [--docroot <existing-web-root>]
 *                              [--max-entries 10000] [--max-seconds 5]
 * No environment/default data directory, deletion mode, network request or application helper is used.
 * Exit: 0 complete inventory, 1 partial inventory/error, 2 invalid arguments.
 * Reading a file can update filesystem-managed access time; this tool never sets timestamps or permissions.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('display_errors', '0');
ini_set('log_errors', '0');

function retention_output(array $value, int $exit): void
{
    echo json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    exit($exit);
}

function retention_error(string $code, int $exit = 1): void
{
    retention_output(['tool' => 'voltguard-retention-audit/1', 'ok' => false, 'error' => $code], $exit);
}

function retention_normalize(string $path): string
{
    $path = str_replace('\\', '/', $path);
    $path = rtrim($path, '/');
    if ($path === '') $path = '/';
    return PHP_OS_FAMILY === 'Windows' ? strtolower($path) : $path;
}

function retention_inside(string $path, string $anchor): bool
{
    $path = retention_normalize($path); $anchor = retention_normalize($anchor);
    return $path === $anchor || strpos($path, rtrim($anchor, '/') . '/') === 0;
}

/** Windows junctions can be untyped lstat entries rather than is_link(); exclude them before realpath. */
function retention_link(string $path): bool
{
    if (is_link($path)) return true;
    if (PHP_OS_FAMILY !== 'Windows') return false;
    $stat = @lstat($path);
    return is_array($stat) && ($stat['mode'] & 0170000) === 0;
}

/** Lexical absolute path, before any filesystem access. UNC/device/network paths are not accepted. */
function retention_absolute(string $path): ?string
{
    if ($path === '' || strlen($path) > 2048 || preg_match('/[\x00-\x1f\x7f]/', $path)) return null;
    $path = str_replace('\\', '/', $path);
    if (strpos($path, '//') === 0 || strpos($path, '://') !== false) return null;
    if ($path[0] !== '/' && !preg_match('#^[A-Za-z]:/#D', $path)) return null;
    $prefix = '/';
    if (preg_match('#^[A-Za-z]:/#D', $path)) { $prefix = substr($path, 0, 3); $path = substr($path, 3); }
    elseif (PHP_OS_FAMILY === 'Windows') return null;
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') continue;
        if ($part === '..') { if (!$parts) return null; array_pop($parts); continue; }
        if (strpos($part, ':') !== false) return null;
        $parts[] = $part;
    }
    return rtrim($prefix, '/') . '/' . implode('/', $parts);
}

/** Reject every symlink/junction component, including a link used as the supplied root. */
function retention_existing_directory(string $path): ?string
{
    $absolute = retention_absolute($path); if ($absolute === null) return null;
    $parts = explode('/', str_replace('\\', '/', $absolute));
    $cursor = $absolute[0] === '/' ? '/' : array_shift($parts) . '/';
    foreach ($parts as $part) {
        if ($part === '') continue;
        $cursor = rtrim($cursor, '/') . '/' . $part;
        clearstatcache(true, $cursor);
        if (retention_link($cursor)) return null;
        $stat = @lstat($cursor);
        if (!is_array($stat) || ($stat['mode'] & 0170000) !== 0040000) return null;
        $actual = @realpath($cursor);
        if ($actual === false || retention_normalize($actual) !== retention_normalize($cursor)) return null;
    }
    $actual = @realpath($absolute);
    return $actual !== false && is_dir($actual) ? $actual : null;
}

function retention_partial(array &$context, string $reason): void { $context['incompleteReasons'][$reason] = true; }

function retention_budget(array &$context): bool
{
    if ($context['entriesExamined'] >= $context['maxEntries']) { retention_partial($context, 'entry_limit'); return false; }
    if (microtime(true) - $context['started'] >= $context['maxSeconds']) { retention_partial($context, 'time_limit'); return false; }
    return true;
}

function retention_group(string $kind, ?int $threshold): array
{
    return [
        'status' => 'missing', 'inspection' => $kind,
        'files' => 0, 'bytes' => 0, 'ignoredEntries' => 0, 'symlinkEntries' => 0, 'unsafeEntries' => 0,
        'inaccessibleEntries' => 0, 'lockedFiles' => 0, 'oversizeFiles' => 0,
        'malformedMetadata' => 0,
        'contentInspectedFiles' => 0, 'contentNotInspectedFiles' => 0,
        'ageBuckets' => ['under1Day' => 0, 'from1To7Days' => 0, 'from7To30Days' => 0, 'from30To365Days' => 0, 'atLeast365Days' => 0],
        'futureMtimeFiles' => 0, 'observedMtimeThresholdSeconds' => $threshold,
        'pastObservedMtimeThresholdFiles' => $threshold === null ? null : 0,
        'runtimeExpiryInspected' => false,
        'businessRetentionDecision' => $kind === 'metadata_only' ? 'company_decision_required' : 'not_a_deletion_approval',
        'businessRecordCount' => null,
    ];
}

function retention_same_file(array $first, array $second): bool
{
    return (int)$first['ino'] !== 0 && $first['dev'] === $second['dev'] && $first['ino'] === $second['ino']
        && ($second['mode'] & 0170000) === 0100000 && (int)$second['nlink'] === 1;
}

/** Existing, unlocked regular files only. No source body or pathname ever enters the report. */
function retention_open(string $path, string $anchor, array $before, array &$group, array &$context)
{
    $fp = @fopen($path, 'rb');
    if ($fp === false) { $group['inaccessibleEntries']++; retention_partial($context, 'unreadable_content'); return false; }
    $opened = @fstat($fp);
    clearstatcache(true, $path); $after = @lstat($path); $actual = @realpath($path);
    if (!is_array($opened) || !is_array($after) || !retention_same_file($before, $opened)
        || !retention_same_file($opened, $after) || retention_link($path) || $actual === false
        || !retention_inside($actual, $anchor) || retention_normalize($actual) !== retention_normalize($path)) {
        fclose($fp); $group['unsafeEntries']++; return false;
    }
    if (!@flock($fp, LOCK_SH | LOCK_NB)) { fclose($fp); $group['lockedFiles']++; retention_partial($context, 'locked_content'); return false; }
    @stream_set_read_buffer($fp, 0);
    return $fp;
}

function retention_inspect_file(string $path, string $anchor, string $kind, int $maxSize, ?int $threshold, array &$group, array &$context): void
{
    clearstatcache(true, $path);
    if (retention_link($path)) { $group['symlinkEntries']++; return; }
    $stat = @lstat($path);
    if (!is_array($stat)) { $group['inaccessibleEntries']++; retention_partial($context, 'unreadable_metadata'); return; }
    $actual = @realpath($path);
    if ($actual !== false && retention_normalize($actual) !== retention_normalize($path)) { $group['symlinkEntries']++; return; }
    if (($stat['mode'] & 0170000) !== 0100000 || $actual === false || !retention_inside($actual, $anchor)
        || retention_normalize($actual) !== retention_normalize($path) || (int)$stat['nlink'] !== 1) { $group['unsafeEntries']++; return; }
    $size = (int)$stat['size']; $group['files']++; $group['bytes'] += $size;
    $age = $context['now'] - (int)$stat['mtime'];
    if ($age < 0) $group['futureMtimeFiles']++;
    $bucket = $age < 86400 ? 'under1Day' : ($age < 604800 ? 'from1To7Days' : ($age < 2592000 ? 'from7To30Days' : ($age < 31536000 ? 'from30To365Days' : 'atLeast365Days')));
    $group['ageBuckets'][$bucket]++;
    if ($threshold !== null && $age > $threshold) $group['pastObservedMtimeThresholdFiles']++;
    if ($size > $maxSize) { $group['oversizeFiles']++; $group['contentNotInspectedFiles']++; return; }
    if (in_array($kind, ['metadata_only', 'cache_metadata_only'], true)) { $group['contentNotInspectedFiles']++; return; }
    if ($context['readBytes'] + $size > $context['maxReadBytes']) {
        $group['contentNotInspectedFiles']++; retention_partial($context, 'read_byte_limit'); return;
    }
    $fp = retention_open($path, $anchor, $stat, $group, $context);
    if ($fp === false) { $group['contentNotInspectedFiles']++; return; }
    try {
        $raw = stream_get_contents($fp, min($maxSize + 1, $context['maxReadBytes'] - $context['readBytes']));
        $context['readBytes'] += is_string($raw) ? strlen($raw) : 0;
        if (!is_string($raw)) { $group['inaccessibleEntries']++; retention_partial($context, 'unreadable_content'); return; }
        if (!feof($fp)) { $group['contentNotInspectedFiles']++; retention_partial($context, 'content_changed_or_read_limit'); return; }
        if (strlen($raw) > $maxSize) { $group['oversizeFiles']++; $group['contentNotInspectedFiles']++; return; }
        $value = json_decode($raw, true, 32);
        if (!is_array($value) || ($kind === 'request_metadata_json' && (!is_string($value['reference'] ?? null)
            || !is_string($value['fp'] ?? null) || !is_int($value['at'] ?? null)))) $group['malformedMetadata']++;
        $group['contentInspectedFiles']++;
    } finally { @flock($fp, LOCK_UN); fclose($fp); }
}

function retention_scan(string $root, array $parts, string $pattern, string $kind, int $maxSize, ?int $threshold, array &$context, ?string $onlyFile = null): array
{
    $group = retention_group($kind, $threshold); $directory = $root;
    foreach ($parts as $part) {
        $directory .= '/' . $part;
        clearstatcache(true, $directory);
        if (retention_link($directory)) { $group['status'] = 'excluded_link'; $group['symlinkEntries']++; retention_partial($context, 'excluded_directory'); return $group; }
        if (!file_exists($directory)) return $group;
        $actual = @realpath($directory);
        if ($actual !== false && retention_normalize($actual) !== retention_normalize($directory)) { $group['status'] = 'excluded_link'; $group['symlinkEntries']++; retention_partial($context, 'excluded_directory'); return $group; }
        $resolved = retention_existing_directory($directory);
        if ($resolved === null || !retention_inside($resolved, $root)) { $group['status'] = 'unsafe_or_inaccessible'; $group['unsafeEntries']++; retention_partial($context, 'excluded_directory'); return $group; }
    }
    $group['status'] = 'scanned';
    if ($onlyFile !== null) {
        if (!retention_budget($context)) { $group['status'] = 'partial'; return $group; }
        $path = $directory . '/' . $onlyFile;
        if (!file_exists($path) && !retention_link($path)) { $group['status'] = 'missing'; return $group; }
        $context['entriesExamined']++; retention_inspect_file($path, $root, $kind, $maxSize, $threshold, $group, $context);
        return $group;
    }
    $dh = @opendir($directory);
    if ($dh === false) { $group['status'] = 'inaccessible'; $group['inaccessibleEntries']++; retention_partial($context, 'unreadable_directory'); return $group; }
    try {
        while (($name = readdir($dh)) !== false) {
            if ($name === '.' || $name === '..') continue;
            if (!retention_budget($context)) { $group['status'] = 'partial'; break; }
            $context['entriesExamined']++;
            if (!preg_match($pattern, $name)) { $group['ignoredEntries']++; continue; }
            retention_inspect_file($directory . '/' . $name, $root, $kind, $maxSize, $threshold, $group, $context);
        }
    } finally { closedir($dh); }
    return $group;
}

try {
    $options = [];
    $allowed = ['data-dir', 'docroot', 'max-entries', 'max-seconds'];
    for ($i = 1; $i < $argc; $i++) {
        if ($argv[$i] === '--help' && $argc === 2) retention_output(['tool' => 'voltguard-retention-audit/1', 'usage' => 'php tools/retention-audit.php --data-dir <existing-absolute-private-directory> [--docroot <existing-web-root>] [--max-entries 10000] [--max-seconds 5]', 'mode' => 'read_only'], 0);
        if (substr($argv[$i], 0, 2) !== '--') retention_error('invalid_arguments', 2);
        $name = substr($argv[$i], 2);
        if (!in_array($name, $allowed, true) || isset($options[$name]) || !isset($argv[$i + 1]) || substr($argv[$i + 1], 0, 2) === '--') retention_error('invalid_arguments', 2);
        $options[$name] = $argv[++$i];
    }
    if (!isset($options['data-dir'])) retention_error('explicit_data_directory_required', 2);
    foreach (['max-entries' => [1, 10000], 'max-seconds' => [1, 30]] as $name => $bounds) {
        if (isset($options[$name]) && (!preg_match('/^[0-9]{1,5}$/D', $options[$name]) || (int)$options[$name] < $bounds[0] || (int)$options[$name] > $bounds[1])) retention_error('invalid_arguments', 2);
    }
    $root = retention_existing_directory($options['data-dir']);
    $docroot = retention_existing_directory($options['docroot'] ?? dirname(__DIR__));
    if ($root === null || $docroot === null) retention_error('unsafe_or_missing_directory');
    if (retention_inside($root, $docroot) || retention_inside($docroot, $root)) retention_error('data_directory_overlaps_web_root');
    $context = ['started' => microtime(true), 'now' => time(), 'maxEntries' => (int)($options['max-entries'] ?? 10000), 'maxSeconds' => (int)($options['max-seconds'] ?? 5), 'entriesExamined' => 0, 'readBytes' => 0, 'maxReadBytes' => 8388608, 'incompleteReasons' => []];
    $hash = '/^[a-f0-9]{64}\.json$/D'; $groups = [];
    $groups['contact_request_metadata'] = retention_scan($root, ['requests'], $hash, 'request_metadata_json', 65536, 604800, $context);
    $groups['rate_limit_metadata'] = retention_scan($root, ['rl'], $hash, 'json_metadata', 65536, 86400, $context);
    $groups['integration_cache'] = retention_scan($root, ['integrations'], $hash, 'cache_metadata_only', 4194304, null, $context);
    $groups['shop_orders_file'] = retention_scan($root, ['magaza'], '', 'metadata_only', 33554432, null, $context, 'siparisler.json');
    $groups['shop_request_metadata'] = retention_scan($root, ['magaza', 'istekler'], $hash, 'metadata_only', 65536, null, $context);
    $groups['shop_enquiry_files'] = retention_scan($root, ['magaza-talep'], '/^[0-9]{4}-(?:0[1-9]|1[0-2])\.jsonl$/D', 'metadata_only', 8388608, null, $context);
    $complete = !$context['incompleteReasons'];
    retention_output([
        'tool' => 'voltguard-retention-audit/1', 'ok' => true, 'mode' => 'read_only', 'complete' => $complete,
        'checkedAt' => gmdate('c', $context['now']), 'entriesExamined' => $context['entriesExamined'], 'metadataBytesRead' => $context['readBytes'],
        'limits' => ['entries' => $context['maxEntries'], 'seconds' => $context['maxSeconds'], 'metadataBytes' => $context['maxReadBytes']],
        'incompleteReasons' => array_keys($context['incompleteReasons']), 'groups' => $groups,
        'limitations' => ['Aggregate file inventory, not a consistent transactional snapshot or deletion approval.', 'Age buckets use file modification time, not customer activity or statutory retention start.', 'Cache bodies and runtime expiry fields are not inspected; cache files can contain provider session tickets.', 'Business file bodies, secrets, configuration, sessions, mail, payroll, backups and external stores are not inspected.', 'Physical expiry and company-approved business retention remain separate; no cleanup is performed.'],
    ], $complete ? 0 : 1);
} catch (Throwable $error) { retention_error('scan_failed'); }
