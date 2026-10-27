<?php
// Apache + PHP hazırlık ortamı duman testi (tools/ci/apache-smoke.sh konteyner içinde çalıştırır).
// http://localhost üzerinden gerçek Apache'ye (.htaccess kurallarıyla) istek atar; yalnızca HTTP kodunu değil
// içerik türünü, JSON şemasını ve gerçek yazma işlemlerinin (ölçüm toplamı, kayıt, editör yayını) sonucunu denetler.
declare(strict_types=1);

$base = 'http://localhost';
$data = getenv('VG_DATA_DIR') ?: '/data';
$fails = 0; $passes = 0;
$cookies = [];

function line(bool $ok, string $what, string $detail = ''): void
{
    global $fails, $passes;
    $ok ? $passes++ : $fails++;
    echo ($ok ? 'OK   ' : 'FAIL ') . $what . ($detail !== '' ? ' — ' . $detail : '') . "\n";
}

function req(string $method, string $path, ?array $json = null, array $headers = []): array
{
    global $base, $cookies;
    // Canlıda TLS sunucuda sonlanır; .htaccess HTTPS'e zorladığı için hazırlık ortamı X-Forwarded-Proto ile HTTPS'i taklit eder
    $h = ['Accept: */*', 'X-Forwarded-Proto: https'];
    if ($cookies) {
        $h[] = 'Cookie: ' . implode('; ', array_map(fn($k, $v) => "$k=$v", array_keys($cookies), $cookies));
    }
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    $body = null;
    if ($json !== null) { $body = json_encode($json, JSON_UNESCAPED_UNICODE); $h[] = 'Content-Type: application/json'; }
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $h), 'content' => $body,
        'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 20]]);
    $resp = @file_get_contents($base . $path, false, $ctx);
    $rh = $http_response_header ?? [];
    $status = 0; $type = ''; $loc = '';
    foreach ($rh as $l) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $l, $m)) $status = (int)$m[1];
        elseif (stripos($l, 'Content-Type:') === 0) $type = trim(substr($l, 13));
        elseif (stripos($l, 'Location:') === 0) $loc = trim(substr($l, 9));
        elseif (stripos($l, 'Set-Cookie:') === 0 && preg_match('#^Set-Cookie:\s*([^=]+)=([^;]*)#i', $l, $m)) $cookies[$m[1]] = $m[2];
    }
    return ['status' => $status, 'type' => $type, 'loc' => $loc, 'body' => (string)$resp, 'headers' => $rh];
}

function expectStatus(string $path, int $status, string $typePrefix = '', ?string $contains = null, string $loc = ''): array
{
    $r = req('GET', $path);
    $ok = $r['status'] === $status
        && ($typePrefix === '' || stripos($r['type'], $typePrefix) === 0)
        && ($contains === null || strpos($r['body'], $contains) !== false)
        && ($loc === '' || preg_match('#' . preg_quote($loc, '#') . '$#', $r['loc']));
    line($ok, "GET $path → $status" . ($loc ? " $loc" : '') . ($typePrefix ? " [$typePrefix]" : ''),
        "geldi {$r['status']} {$r['type']}" . ($r['loc'] ? " → {$r['loc']}" : ''));
    return $r;
}

function api(string $method, string $path, ?array $json = null, array $headers = []): array
{
    $r = req($method, $path, $json, $headers + ['Origin' => 'http://localhost']);
    $r['json'] = json_decode($r['body'], true);
    return $r;
}

// ------------------------------------------------------------------ yönlendirme ve statik sayfalar
echo "## Rotalar\n";
// The imported native workspace stays private under actual Apache rewrites.
expectStatus('/calisan/uygulama/saha.php', 303, '', null, '/calisan/giris.html');
expectStatus('/calisan/uygulama/saha-entry.html', 403);
$sahaAssets = glob('/var/www/html/calisan/uygulama/assets/saha/_expo/static/js/web/*.js') ?: [];
line(count($sahaAssets) > 0, 'Saha web export is present in the private deployment');
if ($sahaAssets) {
    $sahaPath = substr($sahaAssets[0], strlen('/var/www/html'));
    expectStatus($sahaPath, 401, 'application/json', 'staff_unauthorized');
}
expectStatus('/api/saha-asset.php?bucket=photos&path=synthetic-missing.png', 401, 'application/json', 'staff_unauthorized');
expectStatus('/voltsim/', 200, 'text/html', 'VoltSim');
expectStatus('/voltsim', 301, '', null, '/voltsim/');
expectStatus('/voltsim.html', 301, '', null, '/voltsim/');
expectStatus('/voltsim/index.html', 301, '', null, '/voltsim/');
expectStatus('/voltsim/selektivite/', 200, 'text/html', 'Selektivite');
expectStatus('/voltsim/depolama-hibrit/', 200, 'text/html');
expectStatus('/voltsim/olmayan-modul/', 404);
expectStatus('/hesaplama/periyodik-kontrol-planlayici/', 200, 'text/html', 'pk-app');
expectStatus('/hesaplama/periyodik-kontrol-planlayici.html', 301, '', null, '/hesaplama/periyodik-kontrol-planlayici/');
expectStatus('/hesaplama/trafo-kapasite-artirimi/', 200, 'text/html');
expectStatus('/hesaplama-araclari/', 200, 'text/html', 'Periyodik Kontrol');
expectStatus('/arama.html', 200, 'text/html', 'site-search');
expectStatus('/bilgi/elektrik-terimleri-sozlugu.html', 200, 'text/html', 'DefinedTermSet');
expectStatus('/js/search-index.js', 200, 'text/javascript', 'VG_SEARCH_INDEX'); // RFC 9239: text/javascript
expectStatus('/sitemap.xml', 200, '', '/volthaber/');

echo "## Gizli dosyalar\n";
foreach (['/api/lib/volthaber.php', '/api/lib/bootstrap.php', '/api/VOLTHABER.md', '/tools/volthaber-admin.php', '/.git/config'] as $p) {
    $r = req('GET', $p);
    line(in_array($r['status'], [403, 404], true), "GET $p erişilemez", "geldi {$r['status']}");
}

echo "## VoltHaber (PHP ile üretilen sayfalar)\n";
expectStatus('/volthaber', 301, '', null, '/volthaber/');
expectStatus('/volthaber.html', 301, '', null, '/volthaber/');
expectStatus('/volthaber/index.php', 301, '', null, '/volthaber/');
$home = expectStatus('/volthaber/', 200, 'text/html', 'VoltHaber');
line(strpos($home['body'], '<!--vg:header-->') !== false, 'VoltHaber sayfası ortak başlığı içeriyor');
line(!preg_match('#<meta name="robots" content="[^"]*noindex#', $home['body']), 'VoltHaber ana sayfası dizine açık');
$rss = expectStatus('/volthaber/rss.xml', 200, '', '<rss');
line(stripos($rss['type'], 'xml') !== false, 'RSS içerik türü XML', $rss['type']);
$sm = expectStatus('/volthaber/sitemap.xml', 200, '', '<urlset');
preg_match_all('#<loc>https://voltguard\.com\.tr(/volthaber/[a-z0-9-]+/)</loc>#', $sm['body'], $m);
$articles = array_values(array_filter($m[1], fn($u) => strpos($u, '/kategori/') === false));
line(count($articles) >= 11, 'VoltHaber sitemap yazı sayısı ≥ 11', (string)count($articles));
if ($articles) {
    $a = expectStatus($articles[0], 200, 'text/html', '"@type":"Article"');
    line(strpos($a['body'], 'rel="canonical" href="https://voltguard.com.tr' . $articles[0] . '"') !== false, 'Yazı kanonik adresi doğru');
}
expectStatus('/volthaber/olmayan-bir-haber-adresi/', 404);

echo "## API şemaları\n";
$l = api('GET', '/api/volthaber.php?action=list');
$items = $l['json']['items'] ?? null;
line($l['status'] === 200 && stripos($l['type'], 'application/json') === 0 && ($l['json']['ok'] ?? false) === true && is_array($items)
    && count($items) >= 11 && !array_diff(['slug', 'title', 'type', 'category'], array_keys($items[0] ?? [])),
    'volthaber list: JSON, ok, ≥11 öğe, slug/title/type/category alanları', $l['status'] . ' ' . $l['type'] . ' ' . (is_array($items) ? count($items) : 'yok'));
$p = api('GET', '/api/metrics.php?action=popular');
line($p['status'] === 200 && stripos($p['type'], 'application/json') === 0 && ($p['json']['ok'] ?? false) === true,
    'metrics popular: JSON ve ok', $p['status'] . ' ' . substr($p['body'], 0, 120));

echo "## Gerçek yazma işlemleri\n";
// 1) Loopback hazırlık trafiği canlı rapora karışmadan test toplamlarına yazılmalı.
// js/vg-metrics.js ile aynı gövde: {v:1, ev:[{e,p,r,se,d}]}
$payload = json_encode(['v' => 1, 'ev' => [['e' => 'pageview', 'p' => '/voltsim/', 'r' => 'arama', 'se' => 'google', 'd' => 'masaustu']]]);
$ctx = stream_context_create(['http' => ['method' => 'POST', 'ignore_errors' => true, 'content' => $payload,
    'header' => "X-Forwarded-Proto: https\r\nOrigin: http://localhost\r\nContent-Type: text/plain;charset=UTF-8\r\nUser-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"]]);
$resp = @file_get_contents($base . '/api/metrics.php?action=collect', false, $ctx);
$st = 0; foreach ($http_response_header ?? [] as $hl) if (preg_match('#^HTTP/\S+ (\d{3})#', $hl, $mm)) $st = (int)$mm[1];
clearstatcache();
$collected = json_decode((string)$resp, true);
$bucketDirectory = ['live' => 'days', 'test' => 'test-days'][$collected['bucket'] ?? ''] ?? null;
$files = $bucketDirectory !== null ? (glob($data . '/metrics/' . $bucketDirectory . '/*.json') ?: []) : [];
$found = false;
foreach ($files as $f) {
    $dayData = json_decode((string)@file_get_contents($f), true);
    if (is_array($dayData) && basename($f) === ($dayData['date'] ?? '') . '.json'
        && ($dayData['pv'] ?? 0) === 1 && ($dayData['pages']['/voltsim/'] ?? 0) === 1
        && ($dayData['ev']['pageview'] ?? 0) === 1) $found = true;
}
line($st === 200 && ($collected['bucket'] ?? '') === 'test' && ($collected['accepted'] ?? 0) === 1 && $found,
    'Ölçüm olayı gerçek test günlük toplamlarına yazıldı', "HTTP $st " . substr((string)$resp, 0, 160) . ", dosyalar: " . implode(',', array_map('basename', $files)));
line((glob($data . '/metrics/days/*.json') ?: []) === [], 'Hazırlık ölçümü canlı günlük toplamlarına karışmadı');
$raw = implode('', array_map(fn($f) => (string)@file_get_contents($f), $files));
line($raw !== '' && strpos($raw, '127.0.0.1') === false && stripos($raw, 'Mozilla') === false, 'Ölçüm dosyasında IP veya tarayıcı bilgisi yok');

// 2) Üyelik + editör yetkisi + yazı yayını (sunucu oturumu, CSRF ve Apache yönlendirmeleriyle)
$me = api('GET', '/api/auth.php?action=me');
$csrf = $me['json']['csrf'] ?? '';
line($me['status'] === 200 && $csrf !== '' && stripos($me['type'], 'application/json') === 0, 'auth me: JSON ve CSRF jetonu');
$email = 'smoke-' . bin2hex(random_bytes(4)) . '@example.test';
$reg = api('POST', '/api/auth.php?action=register', ['name' => 'Duman Testi', 'email' => $email, 'password' => 'Deneme12345', 'consent' => true], ['X-VG-CSRF' => $csrf]);
$uid = $reg['json']['user']['id'] ?? '';
line($reg['status'] === 201 && $uid !== '', 'Üye kaydı oluşturuldu', $reg['status'] . ' ' . substr($reg['body'], 0, 160));
$csrf = $reg['json']['csrf'] ?? $csrf;
if ($uid !== '') {
    exec('php ' . escapeshellarg('/var/www/html/tools/volthaber-admin.php') . ' grant ' . escapeshellarg($uid) . ' 2>&1', $out, $rc);
    line($rc === 0, 'Editör yetkisi CLI ile verildi', implode(' ', $out));
    $title = 'Duman testi yazısı ' . date('His');
    $save = api('POST', '/api/volthaber.php?action=save', ['title' => $title, 'type' => 'analiz', 'category' => 'kompanzasyon',
        'summary' => 'Bu yazı Apache hazırlık ortamında yönlendirme, oturum ve yayın akışını uçtan uca denetlemek için oluşturuldu.',
        'impact' => 'Bu sentetik kayıt yalnız hazırlık ortamındaki yayın iş akışını sınar; gerçek bir fabrika, teknik karar veya mevzuat değişikliği hakkında iddia içermez.',
        'commentary' => 'VoltGuard hazırlık ortamı testi: kaynak bilgisi ve yorum alanlarının ayrı kaydedildiğini doğruluyoruz; bu metin canlı sitede yayımlanmaz.',
        'eventDate' => gmdate('Y-m-d'),
        'source' => ['name' => 'Sentetik Apache test kaynağı', 'url' => 'https://smoke.example.test/fixture', 'publishedAt' => gmdate('Y-m-d'),
            'licenseNote' => 'Yalnız izole hazırlık ortamındaki sentetik test kaydı; üçüncü taraf metin veya görsel kullanılmaz.'],
        'body' => str_repeat('Hazırlık ortamı duman testi gövde metni; gerçek yayın değildir ve canlı sitede bulunmaz. ', 6)], ['X-VG-CSRF' => $csrf]);
    $id = $save['json']['item']['id'] ?? '';
    line(in_array($save['status'], [200, 201], true) && $id !== '', 'Taslak kaydedildi', $save['status'] . ' ' . substr($save['body'], 0, 160));
    $blocked = api('POST', '/api/volthaber.php?action=publish', ['id' => $id], ['X-VG-CSRF' => $csrf]);
    line($blocked['status'] === 422 && ($blocked['json']['error'] ?? '') === 'not_approved', 'Onaylanmamış taslağın doğrudan yayını engellendi');
    $submitted = api('POST', '/api/volthaber.php?action=submit', ['id' => $id], ['X-VG-CSRF' => $csrf]);
    line($submitted['status'] === 200 && ($submitted['json']['item']['review']['stage'] ?? '') === 'source_check', 'Sentetik taslak kaynak kontrolüne gönderildi', (string)$submitted['status']);
    $checklists = [
        'source' => [['sourcesOpened' => true, 'termsChecked' => true, 'noCopiedText' => true, 'imagesLicensed' => true], 'tech_check'],
        'technical' => [['claimsVerified' => true, 'impactReviewed' => true, 'commentarySeparated' => true, 'linksChecked' => true], 'approval'],
        'approval' => [['readyToPublish' => true], 'approved'],
    ];
    foreach ($checklists as $step => [$checklist, $nextStage]) {
        $reviewed = api('POST', '/api/volthaber.php?action=review', ['id' => $id, 'step' => $step, 'checklist' => $checklist,
            'note' => 'Sentetik test fikstürü denetlendi; üçüncü taraf içerik veya görsel yok.'], ['X-VG-CSRF' => $csrf]);
        line($reviewed['status'] === 200 && ($reviewed['json']['item']['review']['stage'] ?? '') === $nextStage,
            'Gerçek yayın akışı kontrolü: ' . $step, $reviewed['status'] . ' ' . substr($reviewed['body'], 0, 160));
    }
    $pub = api('POST', '/api/volthaber.php?action=publish', ['id' => $id], ['X-VG-CSRF' => $csrf]);
    $slug = $pub['json']['item']['slug'] ?? '';
    line($pub['status'] === 200 && $slug !== '', 'Yazı yayımlandı', $pub['status'] . ' ' . substr($pub['body'], 0, 160));
    if ($slug !== '') {
        expectStatus('/volthaber/' . $slug . '/', 200, 'text/html', htmlspecialchars($title, ENT_QUOTES));
        $l2 = api('GET', '/api/volthaber.php?action=list');
        line(in_array($slug, array_column($l2['json']['items'] ?? [], 'slug'), true), 'Yayımlanan yazı listede');
        $sm2 = req('GET', '/volthaber/sitemap.xml');
        line(strpos($sm2['body'], '/volthaber/' . $slug . '/') !== false, 'Yayımlanan yazı sitemapte');
    }
}

// 3) Bülten aboneliği: kayıt oluşur; e-posta gönderimi bu ortamda yapılandırılmamıştır (sonuç raporlanır)
$sub = api('POST', '/api/volthaber.php?action=subscribe', ['email' => 'okur-' . bin2hex(random_bytes(3)) . '@example.test', 'consent' => true, 'website' => '']);
line(stripos($sub['type'], 'application/json') === 0 && is_array($sub['json']), 'Bülten aboneliği JSON yanıt verdi', $sub['status'] . ' ' . substr($sub['body'], 0, 200));

echo "\nSONUÇ: $passes geçti, $fails başarısız\n";
exit($fails ? 1 : 0);
