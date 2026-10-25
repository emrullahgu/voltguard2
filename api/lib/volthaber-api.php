<?php
/*
 * VoltHaber JSON API yonlendiricisi (api/volthaber.php). Zarf uyelik API'siyle aynidir: {"api":"vg-auth/1","ok":...}.
 * Herkese acik GET: list, article, most_read, categories. Herkese acik POST: subscribe, confirm, unsubscribe.
 * Editor islemleri: oturum (VGSESS) + Origin + X-VG-CSRF + sunucuda atanmis editor rolu (tools/volthaber-admin.php).
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

function vh_api_routes(): array
{
    return [
        // herkese acik
        'list' => ['GET', 'public'], 'article' => ['GET', 'public'], 'most_read' => ['GET', 'public'], 'categories' => ['GET', 'public'],
        'status' => ['GET', 'public'],
        'subscribe' => ['POST', 'public'], 'confirm' => ['POST', 'public'], 'unsubscribe' => ['POST', 'public'],
        // oturum bilgisi (editor mi?)
        'editor_me' => ['GET', 'session'],
        // editor
        'editor_list' => ['GET', 'editor'], 'editor_get' => ['GET', 'editor'], 'save' => ['POST', 'editor'], 'preview' => ['POST', 'editor'],
        'publish' => ['POST', 'editor'], 'schedule' => ['POST', 'editor'], 'archive' => ['POST', 'editor'], 'to_draft' => ['POST', 'editor'],
        'discard' => ['POST', 'editor'], 'submit' => ['POST', 'editor'], 'review' => ['POST', 'editor'], 'hold' => ['POST', 'editor'],
        'sources' => ['GET', 'editor'], 'source_save' => ['POST', 'editor'], 'fetch_run' => ['POST', 'editor'],
        'fetch_log' => ['GET', 'editor'], 'pub_log' => ['GET', 'editor'], 'stats' => ['GET', 'editor'], 'subscribers_export' => ['POST', 'editor'],
        'social' => ['GET', 'editor'], 'digest_list' => ['GET', 'editor'], 'digest_create' => ['POST', 'editor'], 'digest_send' => ['POST', 'editor'],
    ];
}

function vh_get_param(string $key): string
{
    $v = $_GET[$key] ?? '';
    return is_string($v) ? $v : '';
}

function vh_api_run(): void
{
    ob_start();
    try {
        $action = vg_action();
        $routes = vh_api_routes();
        if (!isset($routes[$action])) {
            vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
        }
        list($method, $role) = $routes[$action];
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
            $body = vg_json_body($role === 'editor' ? 262144 : 4096);
        }
        if ($role === 'public') {
            $retry = vg_rl_hit('vh_read', vg_rl_ip_key(), 240, 60);
            if ($retry > 0) {
                vg_too_many($retry);
            }
            $result = vh_public_action($action, $body);
            vg_send(200, $result);
            vg_schedule_gc();
            vg_finish_and_run_jobs();
            return;
        }
        if ($method === 'POST' && (!isset($_COOKIE[VG_SESSION_NAME]) || (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') === '')) {
            vg_fail(403, 'csrf', 'Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin.');
        }
        $store = vg_store();
        vg_session_start();
        if ($method === 'POST') {
            vg_require_csrf();
        }
        $user = vg_session_user($store);
        $csrf = vg_csrf_token();
        session_write_close();
        if ($action === 'editor_me') {
            $editor = vh_is_editor($user);
            vg_send(200, ['ok' => true, 'service' => VH_SERVICE, 'user' => $user ? ['id' => $user['id'], 'name' => $user['name']] : null,
                'editor' => $editor, 'csrf' => $csrf]);
            vg_finish_and_run_jobs();
            return;
        }
        if ($user === null) {
            vg_fail(401, 'unauthorized', 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.');
        }
        if (!vh_is_editor($user)) {
            vg_fail(403, 'forbidden', 'Bu işlem yalnızca VoltHaber editörlerine açıktır.');
        }
        $retry = vg_rl_hit('vh_editor', $user['id'], 600, 600);
        if ($retry > 0) {
            vg_too_many($retry);
        }
        $result = vh_editor_action($action, $body, ['id' => $user['id'], 'name' => $user['name']]);
        if (isset($result['_raw'])) {
            vg_send_raw(200, $result['_raw'], $result['_headers'] ?? []);
        } else {
            $status = (int)($result['_status'] ?? 200);
            unset($result['_status']);
            vg_send($status, $result + ['csrf' => $csrf]);
        }
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
        error_log('VoltHaber: ' . get_class($error) . ' at ' . basename($error->getFile()) . ':' . $error->getLine());
        vg_send(500, ['ok' => false, 'error' => 'server_error', 'message' => 'VoltHaber şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.']);
    }
    vg_finish_and_run_jobs();
}

/* ------------------------------------------------------------------ herkese acik */

function vh_public_action(string $action, array $body): array
{
    if ($action === 'subscribe') {
        return vh_subscribe($body);
    }
    if ($action === 'confirm') {
        return vh_confirm($body);
    }
    if ($action === 'unsubscribe') {
        return vh_unsubscribe($body);
    }
    $now = vg_now();
    list($state, $views) = vh_locked(false, function (string $dir) {
        return [vh_articles($dir), vh_views($dir)];
    });
    $live = vh_live_list($state, $now);
    if ($action === 'list') {
        $f = vh_query_filter($_GET);
        $list = array_values(array_filter($live, function ($a) use ($f) {
            return vh_matches($a, $f);
        }));
        $page = vh_page($list, $f['page']);
        return ['ok' => true, 'service' => VH_SERVICE, 'items' => array_map(function ($a) use ($views) {
            return vh_public_article($a, $views, false);
        }, $page['items']), 'page' => $page['page'], 'pages' => $page['pages'], 'total' => $page['total']];
    }
    if ($action === 'article') {
        $slug = vh_get_param('slug');
        if (preg_match('/^[a-z0-9-]{3,90}$/', $slug) !== 1) {
            vg_fail(422, 'invalid_slug', 'Adres geçersiz.');
        }
        foreach ($live as $a) {
            if ($a['slug'] === $slug) {
                return ['ok' => true, 'service' => VH_SERVICE, 'item' => vh_public_article($a, $views, true)];
            }
        }
        vg_fail(404, 'not_found', 'Yazı bulunamadı.');
    }
    if ($action === 'most_read') {
        $limit = vh_get_param('limit');
        $limit = preg_match('/^[1-9][0-9]?$/', $limit) === 1 ? min(20, (int)$limit) : 5;
        return ['ok' => true, 'service' => VH_SERVICE, 'items' => array_map(function ($a) use ($views) {
            return vh_public_article($a, $views, false);
        }, vh_most_read($live, $views, $limit))];
    }
    if ($action === 'status') {
        return ['ok' => true, 'service' => VH_SERVICE] + vh_freshness($live);
    }
    // categories
    $out = [];
    foreach (vh_categories() as $id => $c) {
        $out[] = ['id' => $id, 'name' => $c[0], 'description' => $c[1], 'count' => count(array_filter($live, function ($a) use ($id) {
            return $a['category'] === $id;
        }))];
    }
    return ['ok' => true, 'service' => VH_SERVICE, 'items' => $out];
}

/* ------------------------------------------------------------------ editor */

function vh_body_id(array $body): string
{
    $id = $body['id'] ?? '';
    if (!is_string($id) || preg_match('/^a[a-f0-9]{16}$/', $id) !== 1) {
        vg_fail(422, 'invalid_id', 'Kayıt kimliği geçersiz.');
    }
    return $id;
}

function vh_only(array $body, array $keys): void
{
    foreach (array_keys($body) as $k) {
        if (!in_array($k, $keys, true)) {
            vg_fail(400, 'invalid_request', 'Gönderilen alanlardan biri desteklenmiyor.');
        }
    }
}

function vh_editor_view(array $a, array $views): array
{
    $a['views'] = (int)($views[$a['id']] ?? 0);
    $a['live'] = vh_is_live($a, vg_now());
    $a['createdAt'] = vg_iso($a['createdAt']);
    $a['updatedAt'] = vg_iso($a['updatedAt']);
    $a['publishAt'] = $a['publishAt'] ? vg_iso($a['publishAt']) : null;
    $a['publishedAt'] = $a['publishedAt'] ? vg_iso($a['publishedAt']) : null;
    $a['url'] = '/volthaber/' . $a['slug'] . '/';
    return $a;
}

function vh_editor_action(string $action, array $body, array $user): array
{
    $ok = ['ok' => true, 'service' => VH_SERVICE];
    switch ($action) {
        case 'editor_list':
            list($state, $views) = vh_locked(false, function (string $dir) {
                return [vh_articles($dir), vh_views($dir)];
            });
            $status = vh_get_param('status');
            $origin = vh_get_param('origin');
            $q = vh_get_param('q');
            $list = array_values(array_filter($state['articles'], function ($a) use ($status, $origin, $q) {
                if ($status !== '' && $a['status'] !== $status) {
                    return false;
                }
                if ($origin === 'inbox' && !($a['origin'] === 'ingest' && $a['status'] === 'draft')) {
                    return false;
                }
                if ($origin === 'editorial' && $a['origin'] === 'ingest' && $a['status'] === 'draft') {
                    return false;
                }
                return $q === '' || vh_matches($a, ['q' => vg_substr($q, 80)]);
            }));
            usort($list, function ($x, $y) {
                return $y['updatedAt'] <=> $x['updatedAt'];
            });
            $page = vh_get_param('page');
            $p = vh_page($list, preg_match('/^[1-9][0-9]{0,2}$/', $page) === 1 ? (int)$page : 1, 30);
            return $ok + ['items' => array_map(function ($a) use ($views) {
                $v = vh_editor_view($a, $views);
                unset($v['body'], $v['bodyHtml']);
                return $v;
            }, $p['items']), 'page' => $p['page'], 'pages' => $p['pages'], 'total' => $p['total'],
                'categories' => vh_categories(), 'types' => vh_types(), 'tools' => vh_tool_links(), 'stages' => vh_stages(),
                'steps' => array_map(function ($s) {
                    return ['stage' => $s[0], 'name' => $s[2], 'checklist' => $s[3]];
                }, vh_review_steps())];

        case 'editor_get':
            $id = vh_get_param('id');
            if (preg_match('/^a[a-f0-9]{16}$/', $id) !== 1) {
                vg_fail(422, 'invalid_id', 'Kayıt kimliği geçersiz.');
            }
            list($state, $views) = vh_locked(false, function (string $dir) {
                return [vh_articles($dir), vh_views($dir)];
            });
            if (!isset($state['articles'][$id])) {
                vg_fail(404, 'not_found', 'Kayıt bulunamadı.');
            }
            return $ok + ['item' => vh_editor_view($state['articles'][$id], $views)];

        case 'preview':
            vh_only($body, ['body']);
            $md = vh_multiline($body['body'] ?? '', 'body', 'Metin', VH_BODY_MAX);
            return $ok + ['html' => vh_markdown($md)];

        case 'save':
            return vh_locked(true, function (string $dir) use ($body, $user, $ok) {
                $state = vh_articles($dir);
                $existing = null;
                if (isset($body['id'])) {
                    $id = vh_body_id($body);
                    if (!isset($state['articles'][$id])) {
                        vg_fail(404, 'not_found', 'Kayıt bulunamadı.');
                    }
                    $existing = $state['articles'][$id];
                    if ($existing['status'] === 'archived') {
                        vg_fail(409, 'archived', 'Arşivlenmiş yazı düzenlenemez; önce taslağa alın.');
                    }
                } elseif (count($state['articles']) >= VH_MAX_ARTICLES) {
                    vg_fail(422, 'storage_full', 'Kayıt sınırına ulaşıldı.');
                }
                // Yayindaki yazida icerik degisirse son onayli surum yayinda kalir, degisiklik akistan yeniden gecer.
                $a = vh_build_article($body, $existing, $state, $user);
                $state['articles'][$a['id']] = $a;
                vh_save_articles($dir, $state);
                vh_log($dir, 'publog.json', ['at' => vg_now(), 'action' => $existing ? 'update' : 'create', 'id' => $a['id'], 'title' => $a['title'], 'by' => $user['name']], 500);
                return $ok + ['_status' => $existing ? 200 : 201, 'item' => vh_editor_view($a, [])];
            });

        case 'submit':
        case 'review':
        case 'hold':
            return vh_review_action($action, $body, $user);

        case 'publish':
        case 'schedule':
        case 'archive':
        case 'to_draft':
        case 'discard':
            vh_only($body, $action === 'schedule' ? ['id', 'publishAt'] : ['id']);
            $id = vh_body_id($body);
            $publishAt = null;
            if ($action === 'schedule') {
                $raw = $body['publishAt'] ?? '';
                $ts = is_string($raw) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/', $raw) === 1 ? strtotime($raw) : false;
                if ($ts === false || $ts <= vg_now() + 60 || $ts > vg_now() + 31536000) {
                    vg_fail(422, 'invalid_field', 'Yayın zamanı ileri bir tarih olmalı (en fazla 1 yıl).', ['publishAt' => 'Geçersiz zaman.']);
                }
                $publishAt = (int)$ts;
            }
            return vh_locked(true, function (string $dir) use ($action, $id, $publishAt, $user, $ok) {
                $state = vh_articles($dir);
                if (!isset($state['articles'][$id])) {
                    vg_fail(404, 'not_found', 'Kayıt bulunamadı.');
                }
                $a = $state['articles'][$id];
                $now = vg_now();
                if ($action === 'discard') {
                    if ($a['origin'] !== 'ingest' || $a['status'] !== 'draft') {
                        vg_fail(409, 'not_discardable', 'Yalnızca gelen kutusundaki otomatik taslaklar silinebilir; diğerlerini arşivleyin.');
                    }
                    unset($state['articles'][$id]);
                } elseif ($action === 'publish' || $action === 'schedule') {
                    vh_assert_publishable($a);
                    $wasLive = vh_is_live($a, $now);
                    if ($wasLive && $action === 'schedule') {
                        vg_fail(409, 'already_live', 'Yayındaki yazı planlanamaz; onaylı düzeltmeyi "Yayımla" ile yayına alın.');
                    }
                    if ($wasLive) {
                        // Onayli duzeltme: ilk yayin tarihi korunur, guncelleme tarihi yalnizca burada yazilir.
                        $a['publishedAt'] = vh_live_at($a);
                        $a['revisedAt'] = $now;
                    } else {
                        $a['publishedAt'] = $action === 'publish' ? $now : null;
                    }
                    $a['status'] = $action === 'publish' ? 'published' : 'scheduled';
                    $a['publishAt'] = $publishAt;
                    $a['liveCopy'] = null;
                    $a['editor'] = ['id' => $user['id'], 'name' => $user['name']];
                    vh_history($a, $user, $action . ($wasLive ? '_revision' : ''));
                } elseif ($action === 'archive') {
                    $a['status'] = 'archived';
                    $a['liveCopy'] = null;
                    vh_history($a, $user, 'archive');
                } else {
                    // Yayindan kaldirma: onaylar da dusurulur; yeniden yayin akisi bastan yapilir.
                    $a['status'] = 'draft';
                    $a['publishAt'] = null;
                    $a['liveCopy'] = null;
                    vh_reset_review($a);
                    vh_history($a, $user, 'to_draft');
                }
                if ($action !== 'discard') {
                    $a['updatedAt'] = $now;
                    $state['articles'][$id] = $a;
                }
                vh_save_articles($dir, $state);
                vh_log($dir, 'publog.json', ['at' => $now, 'action' => $action, 'id' => $id, 'title' => $a['title'], 'by' => $user['name'],
                    'publishAt' => $publishAt ? vg_iso($publishAt) : null], 500);
                return $ok + ['item' => $action === 'discard' ? null : vh_editor_view($a, [])];
            });

        case 'sources':
            $s = vh_locked(false, function (string $dir) {
                return vh_sources($dir);
            });
            $items = [];
            foreach ($s['sources'] as $src) {
                $rt = $s['runtime'][$src['id']] ?? [];
                $src['lastFetchAt'] = isset($rt['lastFetchAt']) ? vg_iso((int)$rt['lastFetchAt']) : null;
                $src['lastOkAt'] = isset($rt['lastOkAt']) ? vg_iso((int)$rt['lastOkAt']) : null;
                $src['lastStatus'] = (string)($rt['lastStatus'] ?? '');
                $src['termsFresh'] = vh_terms_fresh($src);
                $items[] = $src;
            }
            return $ok + ['items' => $items, 'categories' => vh_categories(), 'scheduler' => vh_scheduler_status($s)];

        case 'source_save':
            return vh_locked(true, function (string $dir) use ($body, $ok, $user) {
                $s = vh_sources($dir);
                $id = is_string($body['id'] ?? null) ? $body['id'] : '';
                $idx = null;
                foreach ($s['sources'] as $i => $src) {
                    if ($src['id'] === $id) {
                        $idx = $i;
                    }
                }
                if ($idx === null && count($s['sources']) >= 60) {
                    vg_fail(422, 'limit', 'En fazla 60 kaynak tanımlanabilir.');
                }
                $clean = vh_clean_source($body, $idx !== null ? $s['sources'][$idx] : null);
                if ($idx === null) {
                    $s['sources'][] = $clean;
                } else {
                    $s['sources'][$idx] = $clean;
                }
                vh_write($dir, 'sources.json', $s, 4194304);
                vh_log($dir, 'publog.json', ['at' => vg_now(), 'action' => 'source_save', 'id' => $clean['id'], 'title' => $clean['name'] . ($clean['enabled'] ? ' (açık)' : ' (kapalı)'), 'by' => $user['name']], 500);
                return $ok + ['item' => $clean];
            });

        case 'fetch_run':
            vh_only($body, ['sourceId']);
            $sid = $body['sourceId'] ?? '';
            if ($sid !== '' && (!is_string($sid) || preg_match('/^[a-z0-9-]{1,40}$/', $sid) !== 1)) {
                vg_fail(422, 'invalid_field', 'Kaynak kimliği geçersiz.');
            }
            $retry = vg_rl_hit('vh_fetch_run', 'site', 6, 600);
            if ($retry > 0) {
                vg_too_many($retry, 'Tarama çok sık istendi. ' . vg_human_wait($retry) . ' sonra tekrar deneyin.');
            }
            return $ok + vh_run_fetch(['sourceId' => $sid, 'force' => true, 'trigger' => 'editor', 'budget' => 25]);

        case 'fetch_log':
            return $ok + ['items' => vh_locked(false, function (string $dir) {
                return array_map(function ($e) {
                    $e['at'] = vg_iso((int)$e['at']);
                    return $e;
                }, vh_log_entries($dir, 'fetchlog.json', 200));
            })];

        case 'pub_log':
            return $ok + ['items' => vh_locked(false, function (string $dir) {
                return array_map(function ($e) {
                    $e['at'] = vg_iso((int)$e['at']);
                    return $e;
                }, vh_log_entries($dir, 'publog.json', 200));
            })];

        case 'stats':
            return $ok + vh_locked(false, function (string $dir) {
                $state = vh_articles($dir);
                $views = vh_views($dir);
                $counts = ['draft' => 0, 'scheduled' => 0, 'published' => 0, 'archived' => 0, 'inbox' => 0];
                foreach ($state['articles'] as $a) {
                    $counts[$a['status']]++;
                    if ($a['origin'] === 'ingest' && $a['status'] === 'draft') {
                        $counts['inbox']++;
                    }
                }
                $live = vh_live_list($state, vg_now());
                return ['counts' => $counts, 'mostRead' => array_map(function ($a) use ($views) {
                    return ['id' => $a['id'], 'title' => $a['title'], 'url' => '/volthaber/' . $a['slug'] . '/', 'views' => (int)($views[$a['id']] ?? 0)];
                }, vh_most_read($live, $views, 15)), 'subscribers' => vh_subscriber_stats(vh_subscribers($dir))];
            });

        case 'subscribers_export':
            vh_only($body, []);
            $csv = vh_locked(false, function (string $dir) {
                $rows = ["\xEF\xBB\xBF" . implode(',', array_map('vh_csv_cell', ['e_posta', 'durum', 'riza_zamani', 'riza_metni_surumu', 'onay_zamani', 'kayit_zamani']))];
                foreach (vh_subscribers($dir)['subscribers'] as $s) {
                    if (($s['status'] ?? '') !== 'active') {
                        continue;
                    }
                    $rows[] = implode(',', array_map('vh_csv_cell', [(string)$s['email'], 'aktif', $s['consentAt'] ? vg_iso((int)$s['consentAt']) : '',
                        (string)$s['consentVersion'], $s['confirmedAt'] ? vg_iso((int)$s['confirmedAt']) : '', $s['createdAt'] ? vg_iso((int)$s['createdAt']) : '']));
                }
                return implode("\r\n", $rows) . "\r\n";
            });
            vh_locked(true, function (string $dir) use ($user) {
                vh_log($dir, 'publog.json', ['at' => vg_now(), 'action' => 'subscribers_export', 'id' => '', 'title' => 'Abone listesi dışa aktarıldı', 'by' => $user['name']], 500);
            });
            return ['_raw' => $csv, '_headers' => ['Content-Type: text/csv; charset=utf-8', 'Content-Disposition: attachment; filename="volthaber-aboneler-' . gmdate('Ymd') . '.csv"']];

        case 'social':
            $id = vh_get_param('id');
            if (preg_match('/^a[a-f0-9]{16}$/', $id) !== 1) {
                vg_fail(422, 'invalid_id', 'Kayıt kimliği geçersiz.');
            }
            $state = vh_locked(false, function (string $dir) {
                return vh_articles($dir);
            });
            if (!isset($state['articles'][$id])) {
                vg_fail(404, 'not_found', 'Kayıt bulunamadı.');
            }
            return $ok + ['drafts' => vh_social_drafts($state['articles'][$id])];

        case 'digest_list':
            return $ok + vh_locked(false, function (string $dir) {
                $d = vh_read($dir, 'digests.json', ['version' => 1, 'digests' => []], 8388608);
                $out = [];
                foreach ($d['digests'] as $g) {
                    $out[] = ['id' => $g['id'], 'subject' => $g['subject'], 'createdAt' => vg_iso((int)$g['createdAt']), 'createdBy' => $g['createdBy'],
                        'total' => count($g['recipients']), 'sent' => (int)$g['sent'], 'failed' => (int)$g['failed'], 'done' => (bool)$g['done'],
                        'lastBatchAt' => $g['lastBatchAt'] ? vg_iso((int)$g['lastBatchAt']) : null, 'articleIds' => $g['articleIds']];
                }
                usort($out, function ($a, $b) {
                    return strcmp($b['createdAt'], $a['createdAt']);
                });
                return ['items' => array_slice($out, 0, 30)];
            });

        case 'digest_create':
            return vh_digest_create($body, $user);

        case 'digest_send':
            vh_only($body, ['id']);
            $did = $body['id'] ?? '';
            if (!is_string($did) || preg_match('/^d[a-f0-9]{12}$/', $did) !== 1) {
                vg_fail(422, 'invalid_id', 'Bülten kimliği geçersiz.');
            }
            return $ok + vh_digest_send_batch($did);
    }
    vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
    return [];
}

/* ------------------------------------------------------------------ sosyal medya taslaklari (sablon; harici yapay zeka yok) */

function vh_social_drafts(array $a): array
{
    $url = vg_site_url() . '/volthaber/' . $a['slug'] . '/';
    $cat = vh_categories()[$a['category']][0] ?? '';
    $summary = $a['summary'] !== '' ? $a['summary'] : vh_plain($a['body'], 280);
    $tags = array_map(function ($t) {
        return '#' . str_replace('-', '', ucwords($t, '-'));
    }, array_slice($a['tags'], 0, 5));
    $baseTags = ['#VoltGuard', '#VoltHaber', '#Elektrik', '#Enerji'];
    $hash = implode(' ', array_values(array_unique(array_merge($tags, $baseTags))));
    $source = $a['source'] && $a['source']['name'] !== '' ? 'Kaynak: ' . $a['source']['name'] : 'VoltGuard Mühendislik analizi';
    $headings = [];
    if (preg_match_all('/^#{2,3}\s+(.+)$/mu', $a['body'], $m)) {
        $headings = array_slice(array_map('trim', $m[1]), 0, 4);
    }
    $linkedin = $a['title'] . "\n\n" . $summary . "\n\n"
        . ($headings ? "Yazıda neler var:\n" . implode("\n", array_map(function ($h) {
            return '• ' . $h;
        }, $headings)) . "\n\n" : '')
        . $source . "\nDevamı VoltHaber'de: " . $url . "\n\n" . $hash;
    $instagram = '⚡ ' . $a['title'] . "\n\n" . vh_plain($summary, 300) . "\n\n" . $source
        . "\nBağlantı profildeki VoltHaber sayfasında.\n.\n" . $hash . ' #MühendislikHaberleri';
    $shorts = [
        'konu' => $a['title'],
        'sure' => '45–60 sn',
        'akis' => [
            '0–3 sn – Kanca: "' . $cat . ' alanında bilmeniz gereken bir gelişme."',
            '3–15 sn – Ne oldu: ' . vh_plain($summary, 160),
            '15–40 sn – Sahada ne anlama geliyor: ' . ($headings ? implode('; ', $headings) : 'tesis sahibi ve mühendis için pratik sonuçlar (editör tamamlar)'),
            '40–55 sn – Kaynak ve kapanış: ' . $source . '. Ayrıntılar ve resmî metin bağlantısı VoltHaber\'de.',
            'Ekran yazısı: voltguard.com.tr/volthaber',
        ],
        'not' => 'Videoda yalnızca yazıda doğrulanmış bilgiler kullanılmalı; rakam veya alıntı eklenmeden önce kaynakla karşılaştırılmalı.',
    ];
    return [
        'linkedin' => $linkedin,
        'instagram' => $instagram,
        'shorts' => $shorts,
        'card' => ['title' => $a['title'], 'category' => $cat, 'summary' => vh_plain($summary, 220), 'source' => $source,
            'date' => $a['publishedAt'] ? gmdate('d.m.Y', (int)$a['publishedAt']) : gmdate('d.m.Y'), 'url' => 'voltguard.com.tr/volthaber'],
        'notice' => 'Taslaklar şablondan üretilir ve otomatik paylaşılmaz. Paylaşmadan önce metni okuyun, düzenleyin ve kaynak bağlantısını kontrol edin.',
    ];
}

/* ------------------------------------------------------------------ bulten (digest) */

function vh_digest_create(array $body, array $user): array
{
    vh_only($body, ['subject', 'intro', 'articleIds']);
    $subject = vh_line($body['subject'] ?? '', 'subject', 'Konu', 5, 120);
    $intro = vh_multiline($body['intro'] ?? '', 'intro', 'Giriş metni', 1500);
    $ids = $body['articleIds'] ?? [];
    if (!is_array($ids) || !$ids || count($ids) > 10) {
        vg_fail(422, 'invalid_field', '1–10 yazı seçin.', ['articleIds' => '1–10 yazı.']);
    }
    return vh_locked(true, function (string $dir) use ($subject, $intro, $ids, $user) {
        $state = vh_articles($dir);
        $now = vg_now();
        foreach ($ids as $id) {
            if (!is_string($id) || !isset($state['articles'][$id]) || !vh_is_live($state['articles'][$id], $now)) {
                vg_fail(422, 'invalid_field', 'Bültene yalnızca yayındaki yazılar eklenebilir.', ['articleIds' => 'Yayında olmayan yazı.']);
            }
        }
        $subs = vh_subscribers($dir);
        $recipients = [];
        foreach ($subs['subscribers'] as $s) {
            if (($s['status'] ?? '') === 'active') {
                $recipients[] = $s['id'];
            }
        }
        $d = vh_read($dir, 'digests.json', ['version' => 1, 'digests' => []], 8388608);
        foreach ($d['digests'] as $g) {
            if (!$g['done'] && $now - (int)$g['createdAt'] < 86400) {
                vg_fail(409, 'digest_in_progress', 'Gönderimi tamamlanmamış bir bülten var. Önce onu tamamlayın.');
            }
        }
        $id = 'd' . bin2hex(random_bytes(6));
        $d['digests'][$id] = ['id' => $id, 'subject' => $subject, 'intro' => $intro, 'articleIds' => array_values($ids), 'createdAt' => $now,
            'createdBy' => $user['name'], 'recipients' => $recipients, 'cursor' => 0, 'sent' => 0, 'failed' => 0, 'lastBatchAt' => null, 'done' => !$recipients];
        // En fazla 50 bulten kaydi tutulur.
        if (count($d['digests']) > 50) {
            uasort($d['digests'], function ($a, $b) {
                return $a['createdAt'] <=> $b['createdAt'];
            });
            $d['digests'] = array_slice($d['digests'], -50, null, true);
        }
        vh_write($dir, 'digests.json', $d, 8388608);
        vh_log($dir, 'publog.json', ['at' => $now, 'action' => 'digest_create', 'id' => $id, 'title' => $subject . ' (' . count($recipients) . ' alıcı)', 'by' => $user['name']], 500);
        return ['ok' => true, 'service' => VH_SERVICE, '_status' => 201, 'id' => $id, 'total' => count($recipients)];
    });
}

/** Bir sonraki kucuk grubu gonderir; gruplar arasi en az VH_DIGEST_GAP saniye. */
function vh_digest_send_batch(string $id): array
{
    $now = vg_now();
    $batch = vh_locked(true, function (string $dir) use ($id, $now) {
        $d = vh_read($dir, 'digests.json', ['version' => 1, 'digests' => []], 8388608);
        if (!isset($d['digests'][$id])) {
            vg_fail(404, 'not_found', 'Bülten bulunamadı.');
        }
        $g = $d['digests'][$id];
        if ($g['done']) {
            return ['done' => true, 'g' => $g, 'targets' => []];
        }
        if ($g['lastBatchAt'] && $now - (int)$g['lastBatchAt'] < VH_DIGEST_GAP) {
            $wait = VH_DIGEST_GAP - ($now - (int)$g['lastBatchAt']);
            vg_fail(429, 'rate_limited', 'Gruplar arasında en az ' . VH_DIGEST_GAP . ' saniye beklenir. ' . $wait . ' saniye sonra devam edin.', [], ['Retry-After: ' . $wait], ['retryAfter' => $wait]);
        }
        $slice = array_slice($g['recipients'], (int)$g['cursor'], VH_DIGEST_BATCH);
        $subs = vh_subscribers($dir)['subscribers'];
        $targets = [];
        foreach ($slice as $sid) {
            if (isset($subs[$sid]) && ($subs[$sid]['status'] ?? '') === 'active' && $subs[$sid]['email'] !== '') {
                $targets[] = [$sid, $subs[$sid]['email']];
            }
        }
        // Imlec once ilerletilir: ayni grup iki kez gonderilmez (en fazla bir kez).
        $d['digests'][$id]['cursor'] = (int)$g['cursor'] + count($slice);
        $d['digests'][$id]['lastBatchAt'] = $now;
        vh_write($dir, 'digests.json', $d, 8388608);
        $state = vh_articles($dir);
        $arts = [];
        foreach ($g['articleIds'] as $aid) {
            if (isset($state['articles'][$aid])) {
                $arts[] = $state['articles'][$aid];
            }
        }
        return ['done' => false, 'g' => $g, 'targets' => $targets, 'arts' => $arts];
    });
    if ($batch['done']) {
        return ['sent' => (int)$batch['g']['sent'], 'total' => count($batch['g']['recipients']), 'done' => true, 'batch' => 0];
    }
    $g = $batch['g'];
    $text = ($g['intro'] !== '' ? $g['intro'] . "\n\n" : '') . "Bu sayıda:\n\n";
    foreach ($batch['arts'] as $a) {
        $text .= '■ ' . $a['title'] . "\n" . vh_plain($a['summary'], 300) . "\n" . vg_site_url() . '/volthaber/' . $a['slug'] . "/\n\n";
    }
    $sent = 0;
    $failed = 0;
    foreach ($batch['targets'] as $t) {
        $ok = vg_mail_send($t[1], $g['subject'], "Merhaba,\n\n" . $text . vh_mail_footer($t[0]), 'volthaber-digest');
        $ok ? $sent++ : $failed++;
        usleep(200000); // 5 e-posta/sn ustune cikma
    }
    return vh_locked(true, function (string $dir) use ($id, $sent, $failed) {
        $d = vh_read($dir, 'digests.json', ['version' => 1, 'digests' => []], 8388608);
        $g = $d['digests'][$id];
        $g['sent'] = (int)$g['sent'] + $sent;
        $g['failed'] = (int)$g['failed'] + $failed;
        $g['done'] = (int)$g['cursor'] >= count($g['recipients']);
        $d['digests'][$id] = $g;
        vh_write($dir, 'digests.json', $d, 8388608);
        return ['sent' => $g['sent'], 'failed' => $g['failed'], 'total' => count($g['recipients']), 'done' => $g['done'], 'batch' => $sent, 'nextInSeconds' => $g['done'] ? 0 : VH_DIGEST_GAP];
    });
}
