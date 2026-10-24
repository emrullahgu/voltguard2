<?php
/* PHP 7.4+; shares account identity, never company authorization. */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VG_COMMUNITY_MAX_POSTS = 5000;
const VG_COMMUNITY_MAX_BYTES = 20971520;
const VG_COMMUNITY_MESSAGE_MAX = 2000;
/* Reports from this many different visitors hide a comment until a moderator reviews it. */
const VG_COMMUNITY_REPORT_HIDE = 3;
/* Site-wide guest comments per 24 hours (VG_COMMUNITY_GUEST_DAILY overrides; members are not affected). */
const VG_COMMUNITY_GUEST_DAILY = 100;

/** Guest posting mode: VG_COMMUNITY_GUESTS=off makes the community members-only. */
function vg_community_guests_allowed(): bool
{
    return strtolower(trim((string)getenv('VG_COMMUNITY_GUESTS'))) !== 'off';
}

function vg_community_guest_daily(): int
{
    $value = getenv('VG_COMMUNITY_GUEST_DAILY');
    return is_string($value) && preg_match('/^[0-9]{1,5}$/D', $value) === 1 ? (int)$value : VG_COMMUNITY_GUEST_DAILY;
}

/** Folds Turkish letters, look-alike digits and separators so "V0lt-Guard" and "Yönetici" are recognized. */
function vg_community_name_key(string $name): string
{
    $lower = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    $lower = strtr($lower, ['ı' => 'i', 'İ' => 'i', 'i̇' => 'i', 'ö' => 'o', 'ü' => 'u', 'ş' => 's', 'ç' => 'c', 'ğ' => 'g', 'â' => 'a', 'î' => 'i', 'û' => 'u',
        '0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', '@' => 'a', '$' => 's']);
    return (string)preg_replace('/[^a-z]/', '', $lower);
}

/** Guest display names may not impersonate the company, its staff roles or moderators. */
function vg_community_reserved_name(string $name): bool
{
    $key = vg_community_name_key($name);
    foreach (['voltguard', 'moderator', 'moderater', 'yonetici', 'yonetim', 'administrator', 'sitesahibi', 'emrullahgunay'] as $reserved) {
        if (strpos($key, $reserved) !== false) return true;
    }
    return in_array($key, ['admin', 'destek', 'support', 'ekip', 'resmi', 'official', 'sistem'], true);
}

function vg_community_post_hidden(array $post): bool
{
    // Distinct reporting networks decide, not sessions: one visitor with throwaway sessions cannot hide a comment.
    // Records written before network marks existed keep the earlier per-session count.
    $marks = is_array($post['reportNets'] ?? null) ? $post['reportNets'] : ($post['reports'] ?? null);
    return empty($post['deleted']) && empty($post['reviewed']) && is_array($marks)
        && count($marks) >= VG_COMMUNITY_REPORT_HIDE;
}

function vg_community_id($value): string
{
    return is_string($value) && preg_match('/^c_[a-f0-9]{24}$/', $value) === 1 ? $value : '';
}

function vg_community_user_id($value): bool
{
    return is_string($value) && preg_match('/^u[a-f0-9]{24}$/', $value) === 1;
}

function vg_community_guest_id($value): bool
{
    return is_string($value) && preg_match('/^g[a-f0-9]{48}$/', $value) === 1;
}

/** A guest's ownership comes from the HttpOnly server session, never a submitted identifier. */
function vg_community_identity(?array $user): array
{
    if ($user !== null) {
        return ['actor' => $user['id'], 'member' => $user];
    }
    if (!vg_community_guest_id($_SESSION['vg_community_guest'] ?? null)) {
        $_SESSION['vg_community_guest'] = 'g' . bin2hex(random_bytes(24));
    }
    return ['actor' => $_SESSION['vg_community_guest'], 'member' => null];
}

/** The public server must never serve the community's private files. */
function vg_community_dir(): string
{
    $base = vg_data_dir();
    $data = realpath($base);
    $root = realpath(vg_doc_root());
    if ($data === false || $root === false) {
        vg_unavailable('community data path cannot be resolved');
    }
    $dataNorm = strtolower(rtrim(str_replace('\\', '/', (string)$data), '/'));
    $rootNorm = strtolower(rtrim(str_replace('\\', '/', (string)$root), '/'));
    if ($dataNorm === $rootNorm || strpos($dataNorm . '/', $rootNorm . '/') === 0) {
        vg_unavailable('community VG_DATA_DIR must be outside document root');
    }
    $dir = $base . '/community';
    if (!vg_ensure_dir($dir)) {
        vg_unavailable('community directory is not writable');
    }
    vg_protect_dir($dir);
    $resolved = realpath($dir);
    $norm = $resolved === false ? '' : strtolower(rtrim(str_replace('\\', '/', $resolved), '/'));
    if ($norm === '' || $norm === $rootNorm || strpos($norm . '/', $rootNorm . '/') === 0) {
        vg_unavailable('community directory resolves inside document root');
    }
    return $dir;
}

/** One lock covers comments, spam counters and moderator provisioning. */
function vg_community_locked(bool $write, callable $work)
{
    $dir = vg_community_dir();
    $file = $dir . '/store.lock';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('community lock cannot be opened');
    }
    @chmod($file, 0600);
    $deadline = microtime(true) + 5;
    $locked = false;
    do {
        $locked = flock($fp, ($write ? LOCK_EX : LOCK_SH) | LOCK_NB);
        if (!$locked) {
            usleep(20000);
        }
    } while (!$locked && microtime(true) < $deadline);
    if (!$locked) {
        fclose($fp);
        vg_unavailable('community lock timed out');
    }
    try {
        return $work($dir);
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vg_community_read_json(string $file, array $empty, int $max): array
{
    if (!is_file($file)) {
        return $empty;
    }
    $bytes = @filesize($file);
    if ($bytes === false || $bytes > $max) {
        vg_unavailable('community stored file exceeds limits');
    }
    $raw = @file_get_contents($file, false, null, 0, $max + 1);
    $state = is_string($raw) ? json_decode($raw, true, 32) : null;
    if (!is_array($state) || strlen((string)$raw) > $max) {
        vg_unavailable('community stored JSON is invalid');
    }
    return $state;
}

/** Caller holds the global exclusive lock. Never truncate the live file. */
function vg_community_write_json(string $file, array $state, int $max): void
{
    $json = vg_json_encode($state);
    if (strlen($json) > $max) {
        vg_fail(422, 'community_full', 'Topluluk depolama sınırına ulaştı. Lütfen site yönetimiyle iletişime geçin.');
    }
    $tmp = $file . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $fp = @fopen($tmp, 'x+b');
    if ($fp === false) {
        vg_unavailable('community temporary file cannot be created');
    }
    @chmod($tmp, 0600);
    $offset = 0;
    try {
        while ($offset < strlen($json)) {
            $wrote = fwrite($fp, substr($json, $offset));
            if ($wrote === false || $wrote === 0) {
                vg_unavailable('community write failed');
            }
            $offset += $wrote;
        }
        if (!fflush($fp)) {
            vg_unavailable('community flush failed');
        }
        fclose($fp);
        $fp = null;
        if (!@rename($tmp, $file)) {
            vg_unavailable('community atomic replacement failed');
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

function vg_community_read_state(string $dir): array
{
    $state = vg_community_read_json($dir . '/comments.json', ['version' => 1, 'posts' => [], 'rates' => []], VG_COMMUNITY_MAX_BYTES);
    if (($state['version'] ?? null) !== 1 || !isset($state['posts'], $state['rates'])
        || !is_array($state['posts']) || !is_array($state['rates'])
        || count($state['posts']) > VG_COMMUNITY_MAX_POSTS || count($state['rates']) > 20000) {
        vg_unavailable('community stored schema is invalid');
    }
    foreach ($state['posts'] as $id => $post) {
        if (vg_community_id($id) === '' || !is_array($post) || ($post['id'] ?? '') !== $id
            || !array_key_exists('parentId', $post)
            || ($post['parentId'] !== null && vg_community_id($post['parentId']) === '')
            || !is_int($post['createdAt'] ?? null) || !is_bool($post['deleted'] ?? null)
            || (!$post['deleted'] && ((!vg_community_user_id($post['authorId'] ?? null)
                    && !vg_community_guest_id($post['authorId'] ?? null))
                || !is_string($post['message'] ?? null) || strlen($post['message']) > VG_COMMUNITY_MESSAGE_MAX * 4
                || (vg_community_guest_id($post['authorId']) && (!is_string($post['guestName'] ?? null)
                    || vg_strlen($post['guestName']) < 2 || vg_strlen($post['guestName']) > 60))))) {
            vg_unavailable('community stored comment is invalid');
        }
    }
    return $state;
}

function vg_community_moderators(string $dir): array
{
    $state = vg_community_read_json($dir . '/moderators.json', ['version' => 1, 'moderators' => []], 65536);
    if (($state['version'] ?? null) !== 1 || !is_array($state['moderators'] ?? null)
        || count($state['moderators']) > 100) {
        vg_unavailable('community moderator configuration is invalid');
    }
    foreach ($state['moderators'] as $id) {
        if (!vg_community_user_id($id)) {
            vg_unavailable('community moderator identifier is invalid');
        }
    }
    return array_values(array_unique($state['moderators']));
}

/** Account deletion also erases its public comments; replies retain only parent markers. */
function vg_community_delete_account(VgStore $store, string $uid): void
{
    vg_community_locked(true, function (string $dir) use ($store, $uid) {
        $state = vg_community_read_state($dir);
        $changed = false;
        foreach ($state['posts'] as $id => $post) {
            if (!$post['deleted'] && $post['authorId'] === $uid) {
                $state['posts'][$id] = ['id' => $id, 'parentId' => $post['parentId'],
                    'createdAt' => $post['createdAt'], 'deleted' => true, 'deletedAt' => vg_now()];
                $changed = true;
            }
        }
        if ($changed) vg_community_write_json($dir . '/comments.json', $state, VG_COMMUNITY_MAX_BYTES);
        $moderators = vg_community_moderators($dir);
        if (in_array($uid, $moderators, true)) {
            $moderators = array_values(array_filter($moderators, static function (string $id) use ($uid): bool { return $id !== $uid; }));
            vg_community_write_json($dir . '/moderators.json', ['version' => 1, 'moderators' => $moderators], 65536);
        }
        // Publishers take the same lock and recheck account existence before writing.
        $store->deleteUser($uid);
    });
}

/** The member's own public comments for the KVKK data export (no other visitor's data). */
function vg_community_export(string $uid): array
{
    return vg_community_locked(false, function (string $dir) use ($uid) {
        $state = vg_community_read_state($dir);
        $out = [];
        foreach ($state['posts'] as $post) {
            if (!$post['deleted'] && ($post['authorId'] ?? null) === $uid) {
                $out[] = ['id' => $post['id'], 'parentId' => $post['parentId'], 'message' => $post['message'], 'createdAt' => vg_iso($post['createdAt'])];
            }
        }
        return $out;
    });
}

function vg_community_fields(array $body, array $allowed): void
{
    foreach (array_keys($body) as $field) {
        if (!in_array($field, $allowed, true)) {
            vg_fail(400, 'invalid_request', 'Gönderilen alanlardan biri desteklenmiyor.');
        }
    }
}

function vg_community_message($raw): string
{
    if (!is_string($raw) || preg_match('//u', $raw) !== 1
        || strlen($raw) > VG_COMMUNITY_MESSAGE_MAX * 4
        || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $raw) === 1) {
        vg_fail(422, 'invalid_message', 'Lütfen geçerli bir yorum yazın.', ['message' => 'Yorum biçimi geçersiz.']);
    }
    $message = trim(str_replace(["\r\n", "\r"], "\n", $raw));
    $length = vg_strlen($message);
    if ($length < 2 || $length > VG_COMMUNITY_MESSAGE_MAX) {
        vg_fail(422, 'invalid_message', 'Yorum 2–2000 karakter uzunluğunda olmalı.', ['message' => 'Yorum 2–2000 karakter uzunluğunda olmalı.']);
    }
    // HTML/Markdown is deliberately not interpreted. Clients must use textContent.
    return $message;
}

function vg_community_guest_name($raw): string
{
    if (!is_string($raw) || preg_match('//u', $raw) !== 1 || strlen($raw) > 240
        || preg_match('/[\x00-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}<>:@\/\\\\]/u', $raw) === 1) {
        vg_fail(422, 'invalid_name', 'Lütfen geçerli bir görünen ad yazın.', ['authorName' => 'Ad alanı 2–60 karakter uzunluğunda olmalı.']);
    }
    $name = trim((string)preg_replace('/\s{2,}/u', ' ', $raw));
    if (vg_strlen($name) < 2 || vg_strlen($name) > 60 || preg_match('/\p{L}/u', $name) !== 1) {
        vg_fail(422, 'invalid_name', 'Lütfen 2–60 karakter uzunluğunda bir ad yazın.', ['authorName' => 'Ad alanı 2–60 karakter uzunluğunda olmalı.']);
    }
    if (vg_community_reserved_name($name)) {
        vg_fail(422, 'reserved_name', 'Bu görünen ad VoltGuard ekibine ayrılmıştır. Lütfen kendi adınızı veya bir takma ad yazın.', ['authorName' => 'Bu ad VoltGuard ekibine ayrılmıştır.']);
    }
    return $name;
}

/** Persist spam counters with the comment under the same lock; storage errors fail closed. */
function vg_community_rate(array &$state, string $kind, string $identifier, int $maximum, int $window, string $message = 'Çok hızlı yorum gönderiyorsunuz. Lütfen biraz bekleyin.'): void
{
    $now = vg_now();
    foreach ($state['rates'] as $key => $counter) {
        if (!is_array($counter) || !is_int($counter['until'] ?? null) || $counter['until'] <= $now) {
            unset($state['rates'][$key]);
        }
    }
    $key = hash_hmac('sha256', 'community|' . $kind . '|' . $identifier, vg_secret());
    $counter = $state['rates'][$key] ?? ['hits' => [], 'until' => $now + $window];
    $hits = array_values(array_filter(is_array($counter['hits'] ?? null) ? $counter['hits'] : [], function ($time) use ($now, $window) {
        return is_int($time) && $time > $now - $window && $time <= $now;
    }));
    if (count($hits) >= $maximum) {
        vg_too_many(max(1, $window - ($now - min($hits))), $message);
    }
    if (!isset($state['rates'][$key]) && count($state['rates']) >= 20000) {
        vg_fail(503, 'unavailable', 'Topluluk şu anda yoğun. Lütfen biraz sonra tekrar deneyin.');
    }
    $hits[] = $now;
    $state['rates'][$key] = ['hits' => $hits, 'until' => $now + $window];
}

function vg_community_public_post(array $post, VgStore $store, array $identity, bool $moderator, array &$names, array $moderatorIds = []): array
{
    $deleted = $post['deleted'];
    $author = $deleted ? '' : $post['authorId'];
    $guest = !$deleted && vg_community_guest_id($author);
    if ($guest) {
        $names[$author] = $post['guestName'];
    } elseif ($author !== '' && !array_key_exists($author, $names)) {
        $account = $store->findUserById($author);
        $names[$author] = $account === null ? 'Silinmiş üye' : vg_text($account['name'], 80);
    }
    // Member account names get the same anti-impersonation rule as guest names; only moderators may carry them.
    if (!$guest && $author !== '' && vg_community_reserved_name($names[$author]) && !in_array($author, $moderatorIds, true)) {
        $names[$author] = 'Üye';
    }
    $hidden = vg_community_post_hidden($post);
    $masked = $hidden && !$moderator;
    $out = [
        'id' => $post['id'],
        'parentId' => $post['parentId'],
        'authorName' => $deleted ? 'Yorum silindi' : ($masked ? 'İncelemedeki yorum' : $names[$author]),
        'authorType' => $deleted || $masked ? null : ($guest ? 'guest' : 'member'),
        'message' => $deleted || $masked ? '' : $post['message'],
        'createdAt' => vg_iso($post['createdAt']),
        'deleted' => $deleted,
        'canDelete' => !$deleted && ($moderator || $identity['actor'] === $author),
    ];
    if ($hidden) {
        $out['hidden'] = true;
    }
    if ($moderator && !$deleted) {
        $out['reports'] = is_array($post['reports'] ?? null) ? count($post['reports']) : 0;
    }
    return $out;
}

function vg_community_list(VgStore $store, array $identity): array
{
    foreach (array_keys($_GET) as $field) {
        if (!in_array($field, ['action', 'limit', 'before'], true)) {
            vg_fail(400, 'invalid_request', 'Liste isteği geçersiz.');
        }
    }
    $limit = 20;
    if (isset($_GET['limit'])) {
        if (!is_string($_GET['limit']) || preg_match('/^[1-9][0-9]?$/', $_GET['limit']) !== 1
            || (int)$_GET['limit'] > 50) {
            vg_fail(422, 'invalid_limit', 'Bir sayfada 1–50 yorum görüntülenebilir.');
        }
        $limit = (int)$_GET['limit'];
    }
    $before = null;
    if (isset($_GET['before'])) {
        $before = vg_community_id($_GET['before']);
        if ($before === '') {
            vg_fail(422, 'invalid_cursor', 'Yorum sayfası kimliği geçersiz.');
        }
    }
    return vg_community_locked(false, function (string $dir) use ($store, $identity, $before, $limit) {
        $state = vg_community_read_state($dir);
        $user = $identity['member'];
        $moderatorIds = vg_community_moderators($dir);
        $moderator = $user !== null && in_array($user['id'], $moderatorIds, true);
        $posts = array_reverse(array_values($state['posts']));
        $offset = 0;
        if ($before !== null) {
            $found = false;
            foreach ($posts as $index => $post) {
                if ($post['id'] === $before) {
                    $offset = $index + 1;
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                vg_fail(409, 'page_changed', 'Yorum listesi değişti. Lütfen listeyi yenileyin.');
            }
        }
        $page = array_slice($posts, $offset, $limit);
        $names = [];
        $items = [];
        foreach ($page as $post) {
            $items[] = vg_community_public_post($post, $store, $identity, $moderator, $names, $moderatorIds);
        }
        return ['ok' => true, 'service' => 'vg-community/1', 'items' => $items,
            'nextBefore' => $offset + count($page) < count($posts) && $page ? $page[count($page) - 1]['id'] : null,
            'canPublish' => $user !== null || vg_community_guests_allowed(), 'guestsAllowed' => vg_community_guests_allowed(),
            'moderator' => $moderator];
    });
}

function vg_community_publish(VgStore $store, array $identity, array $body): array
{
    vg_community_fields($body, ['message', 'parentId', 'website', 'authorName']);
    if (array_key_exists('website', $body) && $body['website'] !== '') {
        vg_fail(422, 'invalid_request', 'Yorum gönderilemedi.');
    }
    if ($identity['member'] === null && !vg_community_guests_allowed()) {
        vg_fail(403, 'members_only', 'Topluluğa şu anda yalnızca üye hesabıyla yorum yazılabiliyor. Ücretsiz üye olabilir veya giriş yapabilirsiniz.');
    }
    $message = vg_community_message($body['message'] ?? null);
    $guestName = $identity['member'] === null ? vg_community_guest_name($body['authorName'] ?? null) : null;
    $parent = null;
    if (array_key_exists('parentId', $body) && $body['parentId'] !== null) {
        $parent = vg_community_id($body['parentId']);
        if ($parent === '') {
            vg_fail(422, 'invalid_parent', 'Yanıt verilen yorum kimliği geçersiz.');
        }
    }
    return vg_community_locked(true, function (string $dir) use ($store, $identity, $guestName, $message, $parent) {
        $state = vg_community_read_state($dir);
        $user = $identity['member'];
        $actor = $identity['actor'];
        if ($user !== null && $store->findUserById($user['id']) === null) {
            vg_fail(401, 'unauthorized', 'Hesabınız artık kullanılamıyor. Lütfen yeniden giriş yapın.');
        }
        if (count($state['posts']) >= VG_COMMUNITY_MAX_POSTS) {
            vg_fail(422, 'community_full', 'Topluluk depolama sınırına ulaştı. Lütfen site yönetimiyle iletişime geçin.');
        }
        if ($parent !== null) {
            if (!isset($state['posts'][$parent])) {
                vg_fail(404, 'comment_not_found', 'Yanıt verilen yorum bulunamadı.');
            }
            if ($state['posts'][$parent]['deleted']) {
                vg_fail(409, 'comment_deleted', 'Bu yorum silindi. Yeni bir yorum yazabilirsiniz.');
            }
            $depth = 0;
            $ancestor = $parent;
            while ($ancestor !== null) {
                if (++$depth > 3 || !isset($state['posts'][$ancestor])) {
                    vg_fail(422, 'reply_depth', 'Bu yanıta yeni bir yorum olarak devam edin.');
                }
                $ancestor = $state['posts'][$ancestor]['parentId'];
            }
        }
        vg_community_rate($state, 'publish_short', $actor, 1, 15);
        vg_community_rate($state, 'publish_quarter', $actor, 10, 900);
        vg_community_rate($state, 'publish_day', $actor, 40, 86400);
        // IPv6 visitors are grouped by /48 so rotating addresses inside one customer block does not reset the limit.
        vg_community_rate($state, 'publish_ip', vg_rl_ip_key(48), 30, 3600);
        if ($guestName !== null) {
            // Site-wide guest quota: distributed spam cannot fill the community; members can still write.
            vg_community_rate($state, 'guest_day', 'all', max(1, vg_community_guest_daily()), 86400,
                'Bugün için misafir yorum kotası doldu. Üye hesabıyla giriş yaparak yorum yazabilir ya da yarın tekrar deneyebilirsiniz.');
        }
        foreach ($state['posts'] as $post) {
            if (!$post['deleted'] && $post['authorId'] === $actor && $post['message'] === $message
                && $post['parentId'] === $parent && $post['createdAt'] > vg_now() - 86400) {
                vg_fail(409, 'duplicate_comment', 'Bu yorumunuz zaten gönderildi.');
            }
        }
        $id = 'c_' . bin2hex(random_bytes(12));
        $post = ['id' => $id, 'parentId' => $parent, 'authorId' => $actor,
            'message' => $message, 'createdAt' => vg_now(), 'deleted' => false];
        if ($guestName !== null) {
            $post['guestName'] = $guestName;
        }
        $state['posts'][$id] = $post;
        vg_community_write_json($dir . '/comments.json', $state, VG_COMMUNITY_MAX_BYTES);
        $moderatorIds = vg_community_moderators($dir);
        $moderator = $user !== null && in_array($user['id'], $moderatorIds, true);
        $names = $user === null ? [] : [$user['id'] => vg_text($user['name'], 80)];
        return ['_status' => 201, 'ok' => true, 'service' => 'vg-community/1',
            'item' => vg_community_public_post($post, $store, $identity, $moderator, $names, $moderatorIds)];
    });
}

function vg_community_delete(array $identity, array $body): array
{
    vg_community_fields($body, ['id']);
    $id = vg_community_id($body['id'] ?? null);
    if ($id === '') {
        vg_fail(422, 'invalid_id', 'Yorum kimliği geçersiz.');
    }
    return vg_community_locked(true, function (string $dir) use ($identity, $id) {
        $state = vg_community_read_state($dir);
        $user = $identity['member'];
        $moderator = $user !== null && in_array($user['id'], vg_community_moderators($dir), true);
        $post = $state['posts'][$id] ?? null;
        if ($post === null) {
            vg_fail(404, 'comment_not_found', 'Yorum bulunamadı.');
        }
        if ($post['deleted']) {
            vg_fail(404, 'comment_not_found', 'Yorum bulunamadı.');
        }
        if (!$moderator && $post['authorId'] !== $identity['actor']) {
            vg_fail(403, 'forbidden', 'Bu yorumu silme yetkiniz yok.');
        }
        vg_community_rate($state, 'delete', $identity['actor'], 30, 60);
        // Keep the parent pointer for replies; remove both content and author identity.
        $state['posts'][$id] = ['id' => $id, 'parentId' => $post['parentId'],
            'createdAt' => $post['createdAt'], 'deleted' => true, 'deletedAt' => vg_now()];
        vg_community_write_json($dir . '/comments.json', $state, VG_COMMUNITY_MAX_BYTES);
        return ['ok' => true, 'service' => 'vg-community/1', 'id' => $id, 'deleted' => true];
    });
}

/** Any visitor can report a comment once; enough distinct reports hide it until a moderator reviews it. */
function vg_community_report(array $identity, array $body): array
{
    vg_community_fields($body, ['id']);
    $id = vg_community_id($body['id'] ?? null);
    if ($id === '') {
        vg_fail(422, 'invalid_id', 'Yorum kimliği geçersiz.');
    }
    return vg_community_locked(true, function (string $dir) use ($identity, $id) {
        $state = vg_community_read_state($dir);
        $post = $state['posts'][$id] ?? null;
        if ($post === null || $post['deleted']) {
            vg_fail(404, 'comment_not_found', 'Yorum bulunamadı.');
        }
        if ($post['authorId'] === $identity['actor']) {
            vg_fail(409, 'own_comment', 'Kendi yorumunuzu bildiremezsiniz; dilerseniz silebilirsiniz.');
        }
        $mark = substr(hash_hmac('sha256', 'community-report|' . $identity['actor'], vg_secret()), 0, 24);
        $reports = is_array($post['reports'] ?? null) ? array_values(array_filter($post['reports'], 'is_string')) : [];
        if (!in_array($mark, $reports, true)) {
            vg_community_rate($state, 'report', $identity['actor'], 20, 3600, 'Kısa sürede çok fazla bildirim gönderdiniz. Lütfen daha sonra tekrar deneyin.');
            vg_community_rate($state, 'report_ip', vg_rl_ip_key(48), 40, 3600, 'Kısa sürede çok fazla bildirim gönderildi. Lütfen daha sonra tekrar deneyin.');
            if (count($reports) < 50) {
                $reports[] = $mark;
            }
            $state['posts'][$id]['reports'] = $reports;
            // One mark per client network (IPv4 address or IPv6 /48), bound to this comment.
            $net = substr(hash_hmac('sha256', 'community-report-net|' . $id . '|' . vg_rl_ip_key(48), vg_secret()), 0, 24);
            $nets = is_array($post['reportNets'] ?? null) ? array_values(array_filter($post['reportNets'], 'is_string')) : [];
            if (!in_array($net, $nets, true) && count($nets) < 50) {
                $nets[] = $net;
            }
            $state['posts'][$id]['reportNets'] = $nets;
            vg_community_write_json($dir . '/comments.json', $state, VG_COMMUNITY_MAX_BYTES);
        }
        return ['ok' => true, 'service' => 'vg-community/1', 'id' => $id, 'reported' => true,
            'hidden' => vg_community_post_hidden($state['posts'][$id])];
    });
}

/** Moderators restore a reviewed comment; later reports are still counted but no longer hide it. */
function vg_community_approve(array $identity, array $body): array
{
    vg_community_fields($body, ['id']);
    $id = vg_community_id($body['id'] ?? null);
    if ($id === '') {
        vg_fail(422, 'invalid_id', 'Yorum kimliği geçersiz.');
    }
    return vg_community_locked(true, function (string $dir) use ($identity, $id) {
        $state = vg_community_read_state($dir);
        $user = $identity['member'];
        if ($user === null || !in_array($user['id'], vg_community_moderators($dir), true)) {
            vg_fail(403, 'forbidden', 'Bu işlem için moderatör yetkisi gerekiyor.');
        }
        $post = $state['posts'][$id] ?? null;
        if ($post === null || $post['deleted']) {
            vg_fail(404, 'comment_not_found', 'Yorum bulunamadı.');
        }
        $state['posts'][$id]['reports'] = [];
        $state['posts'][$id]['reportNets'] = [];
        $state['posts'][$id]['reviewed'] = true;
        vg_community_write_json($dir . '/comments.json', $state, VG_COMMUNITY_MAX_BYTES);
        return ['ok' => true, 'service' => 'vg-community/1', 'id' => $id, 'hidden' => false];
    });
}

function vg_community_run(): void
{
    ob_start();
    try {
        $action = vg_action();
        $routes = ['list' => 'GET', 'publish' => 'POST', 'delete' => 'POST', 'report' => 'POST', 'approve' => 'POST'];
        if (!isset($routes[$action])) {
            vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
        }
        $method = $routes[$action];
        $request = vg_method();
        if ($request === 'HEAD' && $method === 'GET') {
            $request = 'GET';
        }
        if ($request !== $method) {
            vg_fail(405, 'method_not_allowed', 'Bu işlem için istek yöntemi desteklenmiyor.', [], ['Allow: ' . $method]);
        }
        vg_check_fetch_site();
        $body = [];
        if ($method === 'POST') {
            vg_require_same_origin();
            $body = vg_json_body(16384);
            if (!isset($_COOKIE[VG_SESSION_NAME]) || (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') === '') {
                vg_fail(403, 'csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.');
            }
        }
        if ($action === 'list') {
            $retry = vg_rl_hit('community_read', vg_rl_ip_key(), 120, 60);
            if ($retry > 0) {
                vg_too_many($retry);
            }
        }
        $store = vg_store();
        vg_session_start();
        if ($method === 'POST') {
            vg_require_csrf();
        }
        $user = vg_session_user($store);
        $identity = vg_community_identity($user);
        $csrf = vg_csrf_token();
        // Close the shared account session before taking the independent community lock.
        session_write_close();
        if ($action === 'list') {
            $result = vg_community_list($store, $identity);
            $result['csrf'] = $csrf;
        } elseif ($action === 'publish') {
            $result = vg_community_publish($store, $identity, $body);
        } elseif ($action === 'report') {
            $result = vg_community_report($identity, $body);
        } elseif ($action === 'approve') {
            $result = vg_community_approve($identity, $body);
        } else {
            $result = vg_community_delete($identity, $body);
        }
        $status = isset($result['_status']) ? (int)$result['_status'] : 200;
        unset($result['_status']);
        vg_send($status, $result);
        vg_schedule_gc();
    } catch (VgHttpError $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        $payload = ['ok' => false, 'error' => $error->errCode, 'message' => $error->getMessage()];
        if ($error->fields) {
            $payload['fields'] = $error->fields;
        }
        vg_send($error->status, $payload + $error->extra, $error->headers);
    } catch (Throwable $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        error_log('VoltGuard community: ' . get_class($error) . ' at ' . basename($error->getFile()) . ':' . $error->getLine());
        vg_send(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Yorumlar şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.']);
    }
    vg_finish_and_run_jobs();
}
