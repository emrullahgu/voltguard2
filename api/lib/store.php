<?php
/*
 * VoltGuard hesap API - kalici depolama.
 * pdo_sqlite varsa SQLite (tek dosya), yoksa JSON dosyalari (flock + atomik rename) kullanilir.
 * Secim veri klasorundeki "store.kind" dosyasina yazilir ve sonraki isteklerde degismez; sunucuda eklenti
 * durumu degisse bile kullanicilar iki depoya bolunmez.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VG_COLLECTIONS = ['favorites', 'history', 'projects', 'documents'];

interface VgStore
{
    public function kind(): string;

    public function findUserByEmail(string $email): ?array;

    public function findUserById(string $id): ?array;

    /** false: e-posta zaten kayitli. */
    public function insertUser(array $user): bool;

    /** false: yeni e-posta baska bir hesapta kayitli. */
    public function updateUser(string $id, array $fields): bool;

    public function deleteUser(string $id): void;

    /** ['items' => array, 'rev' => int, 'updatedAt' => int] */
    public function getCollection(string $uid, string $coll): array;

    /** Atomik oku-degistir-yaz. $fn(array $state): array $items. Yeni durumu dondurur. */
    public function mutateCollection(string $uid, string $coll, callable $fn): array;

    /** Kullanicinin onceki jetonlarini gecersiz kilar ve yenisini saklar. */
    public function putResetToken(string $hash, string $uid, int $expires): void;

    /** Jetonu tek seferlik olarak tuketir (siler) ve ['uid' => ..., 'expires' => ...] dondurur. */
    public function takeResetToken(string $hash): ?array;

    public function deleteResetTokens(string $uid): void;
}

/* "Oturumunuz sona erdi. Lutfen yeniden giris yapin." (dosya ASCII kalsin diye kacisli) */
const VG_MSG_SESSION_GONE = "Oturumunuz sona erdi. L\u{fc}tfen yeniden giri\u{15f} yap\u{131}n.";

const VG_USER_FIELDS = ['id', 'email', 'name', 'company', 'phone', 'pass', 'epoch', 'consent_at', 'consent_ver', 'created_at', 'updated_at', 'last_login_at'];
const VG_USER_INT_FIELDS = ['epoch', 'consent_at', 'created_at', 'updated_at', 'last_login_at'];

function vg_normalize_user_row(array $row): array
{
    $out = [];
    foreach (VG_USER_FIELDS as $f) {
        $v = $row[$f] ?? (in_array($f, VG_USER_INT_FIELDS, true) ? 0 : '');
        $out[$f] = in_array($f, VG_USER_INT_FIELDS, true) ? (int)$v : (string)$v;
    }
    return $out;
}

function vg_empty_collection(): array
{
    return ['items' => [], 'rev' => 0, 'updatedAt' => 0];
}

/* ================================================================== SQLite */

final class VgSqliteStore implements VgStore
{
    /** @var PDO */
    private $pdo;

    public function __construct(string $file)
    {
        $isNew = !is_file($file);
        $this->pdo = new PDO('sqlite:' . $file, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        if ($isNew) {
            @chmod($file, 0600);
        }
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        /* Silinen/guncellenen kayitlarin eski baytlari dosyada (freelist) kalmasin; baglanti basina ayardir. */
        $this->pdo->exec('PRAGMA secure_delete = ON');
        $this->migrate();
    }

    public function kind(): string
    {
        return 'sqlite';
    }

    private function migrate(): void
    {
        $version = (int)$this->pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version >= 1) {
            return;
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                company TEXT NOT NULL DEFAULT \'\',
                phone TEXT NOT NULL DEFAULT \'\',
                pass TEXT NOT NULL,
                epoch INTEGER NOT NULL DEFAULT 1,
                consent_at INTEGER NOT NULL DEFAULT 0,
                consent_ver TEXT NOT NULL DEFAULT \'\',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_login_at INTEGER NOT NULL DEFAULT 0
            )');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS user_data (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                coll TEXT NOT NULL,
                body TEXT NOT NULL,
                rev INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, coll)
            )');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )');
            $this->pdo->exec('CREATE INDEX IF NOT EXISTS reset_tokens_user ON reset_tokens(user_id)');
            $this->pdo->exec('PRAGMA user_version = 1');
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $this->rollback();
            throw $e;
        }
    }

    private function rollback(): void
    {
        try {
            $this->pdo->exec('ROLLBACK');
        } catch (Throwable $ignored) {
            /* islem zaten kapanmis */
        }
    }

    private static function isUniqueViolation(PDOException $e): bool
    {
        return (string)$e->getCode() === '23000' || stripos($e->getMessage(), 'UNIQUE') !== false;
    }

    public function findUserByEmail(string $email): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $st->execute([$email]);
        $row = $st->fetch();
        return is_array($row) ? vg_normalize_user_row($row) : null;
    }

    public function findUserById(string $id): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
        $st->execute([$id]);
        $row = $st->fetch();
        return is_array($row) ? vg_normalize_user_row($row) : null;
    }

    public function insertUser(array $user): bool
    {
        $u = vg_normalize_user_row($user);
        $cols = VG_USER_FIELDS;
        $sql = 'INSERT INTO users (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
        try {
            $this->pdo->prepare($sql)->execute(array_values($u));
            return true;
        } catch (PDOException $e) {
            if (self::isUniqueViolation($e)) {
                return false;
            }
            throw $e;
        }
    }

    public function updateUser(string $id, array $fields): bool
    {
        $set = [];
        $vals = [];
        foreach ($fields as $k => $v) {
            if ($k === 'id' || !in_array($k, VG_USER_FIELDS, true)) {
                continue;
            }
            $set[] = $k . ' = ?';
            $vals[] = in_array($k, VG_USER_INT_FIELDS, true) ? (int)$v : (string)$v;
        }
        if (!$set) {
            return true;
        }
        $vals[] = $id;
        try {
            $this->pdo->prepare('UPDATE users SET ' . implode(', ', $set) . ' WHERE id = ?')->execute($vals);
            return true;
        } catch (PDOException $e) {
            if (self::isUniqueViolation($e)) {
                return false;
            }
            throw $e;
        }
    }

    public function deleteUser(string $id): void
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            foreach (['DELETE FROM reset_tokens WHERE user_id = ?', 'DELETE FROM user_data WHERE user_id = ?', 'DELETE FROM users WHERE id = ?'] as $sql) {
                $this->pdo->prepare($sql)->execute([$id]);
            }
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $this->rollback();
            throw $e;
        }
        /*
         * Silme islendi; VACUUM dosyayi yeniden yazarak eski silmelerden/guncellemelerden kalan artiklari da temizler.
         * Basarisizlik (SQLITE_BUSY vb.) silmeyi geri almaz; yok sayilir (secure_delete zaten yeni artik birakmaz).
         * Not: WAL kipine gecilirse burada PRAGMA wal_checkpoint(TRUNCATE) da calistirilmali.
         */
        try {
            $this->pdo->exec('VACUUM');
        } catch (Throwable $e) {
            /* yok say */
        }
    }

    private function readCollection(string $uid, string $coll): array
    {
        $st = $this->pdo->prepare('SELECT body, rev, updated_at FROM user_data WHERE user_id = ? AND coll = ?');
        $st->execute([$uid, $coll]);
        $row = $st->fetch();
        if (!is_array($row)) {
            return vg_empty_collection();
        }
        $items = json_decode((string)$row['body'], true);
        return [
            'items' => is_array($items) ? array_values($items) : [],
            'rev' => (int)$row['rev'],
            'updatedAt' => (int)$row['updated_at'],
        ];
    }

    public function getCollection(string $uid, string $coll): array
    {
        return $this->readCollection($uid, $coll);
    }

    public function mutateCollection(string $uid, string $coll, callable $fn): array
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $state = $this->readCollection($uid, $coll);
            $items = array_values($fn($state));
            $now = vg_now();
            $new = ['items' => $items, 'rev' => $state['rev'] + 1, 'updatedAt' => $now];
            $body = vg_json_encode($items);
            /* UPSERT (ON CONFLICT) SQLite 3.24 ister; eski sistem SQLite surumleri icin UPDATE + INSERT. */
            $up = $this->pdo->prepare('UPDATE user_data SET body = ?, rev = ?, updated_at = ? WHERE user_id = ? AND coll = ?');
            $up->execute([$body, $new['rev'], $now, $uid, $coll]);
            if ($up->rowCount() === 0) {
                $this->pdo->prepare('INSERT INTO user_data (user_id, coll, body, rev, updated_at) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$uid, $coll, $body, $new['rev'], $now]);
            }
            $this->pdo->exec('COMMIT');
            return $new;
        } catch (Throwable $e) {
            $this->rollback();
            if ($e instanceof PDOException && ((string)$e->getCode() === '23000' || stripos($e->getMessage(), 'FOREIGN KEY') !== false)) {
                /* Hesap bu istekle eszamanli silinmis (FK ihlali): 500 yerine oturum sona erdi. */
                throw new VgHttpError(401, 'unauthorized', VG_MSG_SESSION_GONE);
            }
            throw $e;
        }
    }

    public function putResetToken(string $hash, string $uid, int $expires): void
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $this->pdo->prepare('DELETE FROM reset_tokens WHERE user_id = ? OR expires_at < ?')->execute([$uid, vg_now()]);
            $this->pdo->prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
                ->execute([$hash, $uid, $expires, vg_now()]);
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $this->rollback();
            throw $e;
        }
    }

    public function takeResetToken(string $hash): ?array
    {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try {
            $st = $this->pdo->prepare('SELECT user_id, expires_at FROM reset_tokens WHERE token_hash = ?');
            $st->execute([$hash]);
            $row = $st->fetch();
            if (is_array($row)) {
                $this->pdo->prepare('DELETE FROM reset_tokens WHERE token_hash = ?')->execute([$hash]);
            }
            $this->pdo->exec('COMMIT');
        } catch (Throwable $e) {
            $this->rollback();
            throw $e;
        }
        return is_array($row) ? ['uid' => (string)$row['user_id'], 'expires' => (int)$row['expires_at']] : null;
    }

    public function deleteResetTokens(string $uid): void
    {
        $this->pdo->prepare('DELETE FROM reset_tokens WHERE user_id = ?')->execute([$uid]);
    }
}

/* ================================================================== JSON dosyalari */

/*
 * Yerlesim (hepsi 0600 / 0700):
 *   json/store.lock          tum islemler icin flock (okuma LOCK_SH, yazma LOCK_EX)
 *   json/emails.json         { "e-posta": "kullanici-id" }
 *   json/tokens.json         { "jeton-ozeti": { "u": id, "e": bitis, "c": olusturma } }
 *   json/users/<id>.json     kullanici kaydi
 *   json/data/<id>/<koleksiyon>.json   { items, rev, updatedAt }
 * Her yazma once gecici dosyaya yapilir, sonra rename() ile yerine konur (yarim dosya kalmaz).
 */
final class VgJsonStore implements VgStore
{
    /** @var string */
    private $dir;

    public function __construct(string $dir)
    {
        $this->dir = $dir;
        foreach ([$dir, $dir . '/users', $dir . '/data'] as $d) {
            if (!vg_ensure_dir($d)) {
                vg_unavailable('json store directory is not writable');
            }
        }
    }

    public function kind(): string
    {
        return 'json';
    }

    /** @return mixed */
    private function locked(bool $exclusive, callable $fn)
    {
        $fp = @fopen($this->dir . '/store.lock', 'c');
        if ($fp === false) {
            throw new RuntimeException('json store: lock file cannot be opened');
        }
        if (!flock($fp, $exclusive ? LOCK_EX : LOCK_SH)) {
            fclose($fp);
            throw new RuntimeException('json store: lock failed');
        }
        try {
            return $fn();
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    private function read(string $file): array
    {
        if (!is_file($file)) {
            return [];
        }
        $raw = @file_get_contents($file);
        if (!is_string($raw)) {
            throw new RuntimeException('json store: read failed');
        }
        if ($raw === '') {
            return [];
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new RuntimeException('json store: corrupt file ' . basename($file));
        }
        return $data;
    }

    private function write(string $file, array $data): void
    {
        $json = vg_json_encode($data);
        $tmp = dirname($file) . '/.tmp-' . bin2hex(random_bytes(6));
        if (@file_put_contents($tmp, $json) !== strlen($json)) {
            @unlink($tmp);
            throw new RuntimeException('json store: write failed');
        }
        @chmod($tmp, 0600);
        if (!@rename($tmp, $file)) {
            @unlink($tmp);
            throw new RuntimeException('json store: rename failed');
        }
    }

    private static function validId(string $id): bool
    {
        return preg_match('/^u[a-f0-9]{24}$/', $id) === 1;
    }

    private function userFile(string $id): string
    {
        return $this->dir . '/users/' . $id . '.json';
    }

    private function dataFile(string $uid, string $coll): string
    {
        return $this->dir . '/data/' . $uid . '/' . $coll . '.json';
    }

    public function findUserByEmail(string $email): ?array
    {
        return $this->locked(false, function () use ($email) {
            $index = $this->read($this->dir . '/emails.json');
            $id = isset($index[$email]) ? (string)$index[$email] : '';
            if (!self::validId($id)) {
                return null;
            }
            $u = $this->read($this->userFile($id));
            return $u ? vg_normalize_user_row($u) : null;
        });
    }

    public function findUserById(string $id): ?array
    {
        if (!self::validId($id)) {
            return null;
        }
        return $this->locked(false, function () use ($id) {
            $u = $this->read($this->userFile($id));
            return $u ? vg_normalize_user_row($u) : null;
        });
    }

    public function insertUser(array $user): bool
    {
        $u = vg_normalize_user_row($user);
        if (!self::validId($u['id'])) {
            throw new RuntimeException('json store: invalid user id');
        }
        return $this->locked(true, function () use ($u) {
            $indexFile = $this->dir . '/emails.json';
            $index = $this->read($indexFile);
            if (isset($index[$u['email']])) {
                return false;
            }
            $this->write($this->userFile($u['id']), $u);
            $index[$u['email']] = $u['id'];
            $this->write($indexFile, $index);
            return true;
        });
    }

    public function updateUser(string $id, array $fields): bool
    {
        if (!self::validId($id)) {
            return false;
        }
        return $this->locked(true, function () use ($id, $fields) {
            $file = $this->userFile($id);
            $u = $this->read($file);
            if (!$u) {
                return true;
            }
            $u = vg_normalize_user_row($u);
            $indexFile = $this->dir . '/emails.json';
            $index = null;
            if (isset($fields['email']) && (string)$fields['email'] !== $u['email']) {
                $index = $this->read($indexFile);
                if (isset($index[(string)$fields['email']])) {
                    return false;
                }
                unset($index[$u['email']]);
                $index[(string)$fields['email']] = $id;
            }
            foreach ($fields as $k => $v) {
                if ($k !== 'id' && in_array($k, VG_USER_FIELDS, true)) {
                    $u[$k] = in_array($k, VG_USER_INT_FIELDS, true) ? (int)$v : (string)$v;
                }
            }
            $this->write($file, $u);
            if ($index !== null) {
                $this->write($indexFile, $index);
            }
            return true;
        });
    }

    public function deleteUser(string $id): void
    {
        if (!self::validId($id)) {
            return;
        }
        $this->locked(true, function () use ($id) {
            $u = $this->read($this->userFile($id));
            $indexFile = $this->dir . '/emails.json';
            $index = $this->read($indexFile);
            $changed = false;
            foreach ($index as $email => $uid) {
                if ($uid === $id) {
                    unset($index[$email]);
                    $changed = true;
                }
            }
            if ($changed) {
                $this->write($indexFile, $index);
            }
            $tokFile = $this->dir . '/tokens.json';
            $tokens = $this->read($tokFile);
            $tokChanged = false;
            foreach ($tokens as $h => $t) {
                if (!is_array($t) || ($t['u'] ?? '') === $id) {
                    unset($tokens[$h]);
                    $tokChanged = true;
                }
            }
            if ($tokChanged) {
                $this->write($tokFile, $tokens);
            }
            $dataDir = $this->dir . '/data/' . $id;
            if (is_dir($dataDir)) {
                foreach ((array)glob($dataDir . '/*') as $f) {
                    if (is_string($f) && is_file($f)) {
                        @unlink($f);
                    }
                }
                @rmdir($dataDir);
            }
            if ($u || is_file($this->userFile($id))) {
                @unlink($this->userFile($id));
            }
            return null;
        });
    }

    private function readCollection(string $uid, string $coll): array
    {
        $d = $this->read($this->dataFile($uid, $coll));
        if (!$d) {
            return vg_empty_collection();
        }
        return [
            'items' => isset($d['items']) && is_array($d['items']) ? array_values($d['items']) : [],
            'rev' => (int)($d['rev'] ?? 0),
            'updatedAt' => (int)($d['updatedAt'] ?? 0),
        ];
    }

    public function getCollection(string $uid, string $coll): array
    {
        if (!self::validId($uid)) {
            return vg_empty_collection();
        }
        return $this->locked(false, function () use ($uid, $coll) {
            return $this->readCollection($uid, $coll);
        });
    }

    public function mutateCollection(string $uid, string $coll, callable $fn): array
    {
        if (!self::validId($uid)) {
            throw new RuntimeException('json store: invalid user id');
        }
        return $this->locked(true, function () use ($uid, $coll, $fn) {
            /* Hesap, kimlik dogrulamasiyla bu kilit arasinda silinmis olabilir: veri klasorunu yetim olarak yeniden yaratma. */
            if (!is_file($this->userFile($uid))) {
                throw new VgHttpError(401, 'unauthorized', VG_MSG_SESSION_GONE);
            }
            $state = $this->readCollection($uid, $coll);
            $items = array_values($fn($state));
            $new = ['items' => $items, 'rev' => $state['rev'] + 1, 'updatedAt' => vg_now()];
            if (!vg_ensure_dir($this->dir . '/data/' . $uid)) {
                throw new RuntimeException('json store: data directory is not writable');
            }
            $this->write($this->dataFile($uid, $coll), $new);
            return $new;
        });
    }

    public function putResetToken(string $hash, string $uid, int $expires): void
    {
        $this->locked(true, function () use ($hash, $uid, $expires) {
            $file = $this->dir . '/tokens.json';
            $tokens = $this->read($file);
            $now = vg_now();
            foreach ($tokens as $h => $t) {
                if (!is_array($t) || ($t['u'] ?? '') === $uid || (int)($t['e'] ?? 0) < $now) {
                    unset($tokens[$h]);
                }
            }
            $tokens[$hash] = ['u' => $uid, 'e' => $expires, 'c' => $now];
            $this->write($file, $tokens);
            return null;
        });
    }

    public function takeResetToken(string $hash): ?array
    {
        return $this->locked(true, function () use ($hash) {
            $file = $this->dir . '/tokens.json';
            $tokens = $this->read($file);
            if (!isset($tokens[$hash]) || !is_array($tokens[$hash])) {
                return null;
            }
            $t = $tokens[$hash];
            unset($tokens[$hash]);
            $this->write($file, $tokens);
            return ['uid' => (string)($t['u'] ?? ''), 'expires' => (int)($t['e'] ?? 0)];
        });
    }

    public function deleteResetTokens(string $uid): void
    {
        $this->locked(true, function () use ($uid) {
            $file = $this->dir . '/tokens.json';
            $tokens = $this->read($file);
            $changed = false;
            foreach ($tokens as $h => $t) {
                if (!is_array($t) || ($t['u'] ?? '') === $uid) {
                    unset($tokens[$h]);
                    $changed = true;
                }
            }
            if ($changed) {
                $this->write($file, $tokens);
            }
            return null;
        });
    }
}

/* ================================================================== secim */

function vg_sqlite_available(): bool
{
    return class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true);
}

function vg_store(): VgStore
{
    static $store = null;
    if ($store !== null) {
        return $store;
    }
    $dir = vg_data_dir();
    $marker = $dir . '/store.kind';
    $kind = is_file($marker) ? trim((string)@file_get_contents($marker)) : '';
    if ($kind !== 'sqlite' && $kind !== 'json') {
        $forced = getenv('VG_STORE');
        if ($forced === 'json' || $forced === 'sqlite') {
            $kind = $forced;
        } else {
            $kind = vg_sqlite_available() ? 'sqlite' : 'json';
        }
        @file_put_contents($marker, $kind, LOCK_EX);
        @chmod($marker, 0600);
    }
    try {
        if ($kind === 'sqlite') {
            if (!vg_sqlite_available()) {
                vg_unavailable('store.kind is sqlite but pdo_sqlite is not loaded');
            }
            $store = new VgSqliteStore($dir . '/vg-accounts.sqlite');
        } else {
            $store = new VgJsonStore($dir . '/json');
        }
    } catch (PDOException $e) {
        vg_unavailable('sqlite open failed');
    }
    return $store;
}
