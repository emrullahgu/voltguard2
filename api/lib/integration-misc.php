<?php
/* Fixed, read-only provider adapters. Endpoint owns access policy/cache; transport owns TLS and global limits. */
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }

function vg_int_misc_bad(): void {
    throw new VgIntegrationError(502, 'invalid_provider_data', 'Veri kaynağının yanıtı doğrulanamadı.');
}
function vg_int_misc_text($value, int $max = 300): string {
    if ($value === null) return '';
    if (!is_string($value)) vg_int_misc_bad();
    $value = preg_replace('/\s+/u', ' ', strip_tags($value));
    if (!is_string($value)) vg_int_misc_bad();
    return function_exists('mb_substr') ? mb_substr(trim($value), 0, $max, 'UTF-8') : substr(trim($value), 0, $max);
}
function vg_int_misc_query(array $input, string $key = 'q', int $max = 180): string {
    $value = $input[$key] ?? null;
    if (!is_string($value) || preg_match('/[\x00-\x1f\x7f]/', $value) || !preg_match('/^.{1,' . $max . '}$/usD', trim($value))) {
        throw new VgIntegrationError(400, 'invalid_input', 'Geçerli bir arama değeri girin.');
    }
    return trim($value);
}
function vg_int_misc_number($value, float $min, float $max, bool $input = false): float {
    if (($input && (!is_scalar($value) || is_bool($value) || !is_numeric($value))) ||
        (!$input && !is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < $min || $value > $max) {
        if (!$input) vg_int_misc_bad();
        throw new VgIntegrationError(400, 'invalid_input', 'Geçerli bir sayısal değer girin.');
    }
    return (float)$value;
}
function vg_int_misc_limit(array $input): int {
    $value = vg_int_misc_number($input['limit'] ?? 5, 5, 20, true);
    if (floor($value) !== $value) throw new VgIntegrationError(400, 'invalid_input', 'Sonuç sayısı 5–20 arasında tam sayı olmalı.');
    return (int)$value;
}
function vg_int_misc_key(string $name): string {
    $key = vg_int_secret($name);
    if ($key === '') throw new VgIntegrationError(503, 'not_configured', 'Bu veri servisi için sunucu bağlantı anahtarı henüz tanımlanmadı.');
    return $key;
}
function vg_int_misc_time($timestamp): string {
    if (!is_int($timestamp) || $timestamp < 946684800 || $timestamp > time() + 3600) vg_int_misc_bad();
    return gmdate('Y-m-d\TH:i:s\Z', $timestamp);
}
function vg_int_misc_url($value, array $hosts = []): string {
    if (!is_string($value) || strlen($value) > 2048 || preg_match('/[\x00-\x20\x7f\\\\]/', $value)) vg_int_misc_bad();
    $parts = parse_url($value);
    $host = is_array($parts) ? strtolower($parts['host'] ?? '') : '';
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) ||
        isset($parts['port']) || !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/D', $host) ||
        ($hosts && !in_array($host, $hosts, true))) vg_int_misc_bad();
    return $value;
}
function vg_int_misc_get(string $endpoint, array $query, array $headers, callable $fetch): array {
    $url = $endpoint . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
    return vg_int_json($fetch('GET', $url, ['headers' => $headers + ['Accept' => 'application/json'], 'timeout' => 20, 'maxBytes' => 1048576]));
}
function vg_int_misc_base(string $provider, string $url): array {
    return ['provider' => $provider, 'source' => ['name' => $provider, 'url' => $url], 'retrievedAt' => gmdate('Y-m-d\TH:i:s\Z')];
}
function vg_int_misc_public_ip($value): string {
    if (!is_string($value) || !filter_var($value, FILTER_VALIDATE_IP)) throw new VgIntegrationError(400, 'invalid_input', 'Elle geçerli bir genel IP adresi girin.');
    $packed = inet_pton($value);
    // IPv4-mapped IPv6 must obey the embedded IPv4 restrictions as well.
    $candidate = strlen($packed) === 16 && substr($packed, 0, 12) === str_repeat("\0", 10) . "\xff\xff" ? inet_ntop(substr($packed, 12)) : $value;
    if (!filter_var($candidate, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) throw new VgIntegrationError(400, 'invalid_input', 'Yerel veya ayrılmış IP adresleri sorgulanamaz.');
    if (strpos($candidate, ':') === false) {
        $parts = array_map('intval', explode('.', $candidate));
        if ($parts[0] === 0 || $parts[0] >= 224 || $parts[0] === 100 && $parts[1] >= 64 && $parts[1] <= 127 ||
            $parts[0] === 198 && ($parts[1] === 18 || $parts[1] === 19) ||
            in_array(implode('.', array_slice($parts, 0, 3)), ['192.0.0', '192.0.2', '192.88.99', '198.51.100', '203.0.113'], true)) throw new VgIntegrationError(400, 'invalid_input', 'Yerel veya ayrılmış IP adresleri sorgulanamaz.');
    } elseif (!preg_match('/^[23]/i', $candidate) || preg_match('/^(?:20010[01]|20010db8|2002|3fff0)/', bin2hex(inet_pton($candidate)))) {
        throw new VgIntegrationError(400, 'invalid_input', 'Yerel veya ayrılmış IP adresleri sorgulanamaz.');
    }
    return inet_ntop($packed);
}

function vg_int_misc(string $action, array $input, ?callable $fetch = null): array {
    $fetch = $fetch ?? 'vg_int_http';
    if ($action === 'openweather') {
        $lat = vg_int_misc_number($input['lat'] ?? null, -90, 90, true);
        $lon = vg_int_misc_number($input['lon'] ?? null, -180, 180, true);
        $data = vg_int_misc_get('https://api.openweathermap.org/data/2.5/weather', ['lat' => $lat, 'lon' => $lon, 'units' => 'metric', 'lang' => 'tr', 'appid' => vg_int_misc_key('VG_OPENWEATHER_API_KEY')], [], $fetch);
        if ((string)($data['cod'] ?? '') !== '200') vg_int_misc_bad();
        $dt = $data['dt'] ?? null;
        return vg_int_misc_base('OpenWeather', 'https://openweathermap.org/') + [
            'inputs' => ['lat' => $lat, 'lon' => $lon], 'observedAt' => vg_int_misc_time($dt), 'stale' => time() - $dt > 10800,
            'location' => vg_int_misc_text($data['name'] ?? '', 100),
            'temperatureC' => vg_int_misc_number($data['main']['temp'] ?? null, -100, 100),
            'humidityPercent' => vg_int_misc_number($data['main']['humidity'] ?? null, 0, 100),
            'windSpeedMps' => isset($data['wind']['speed']) ? vg_int_misc_number($data['wind']['speed'], 0, 150) : null,
            'description' => vg_int_misc_text($data['weather'][0]['description'] ?? '', 180),
            'units' => ['temperature' => '°C', 'humidity' => '%', 'windSpeed' => 'm/s'],
            'notice' => 'Güncel hava koşullarıdır; tasarım uç sıcaklığı veya GES üretim tahmini değildir.',
        ];
    }
    if ($action === 'ipinfo') {
        $ip = vg_int_misc_public_ip($input['ip'] ?? null);
        $data = vg_int_misc_get('https://api.ipinfo.io/lite/' . rawurlencode($ip), [], ['Authorization' => 'Bearer ' . vg_int_misc_key('VG_IPINFO_TOKEN')], $fetch);
        if (($data['ip'] ?? '') !== $ip || !is_string($data['country_code'] ?? null) || !preg_match('/^[A-Z]{2}$/D', $data['country_code'])) vg_int_misc_bad();
        return vg_int_misc_base('IPinfo Lite', 'https://ipinfo.io/') + [
            'ip' => $ip, 'countryCode' => $data['country_code'], 'country' => vg_int_misc_text($data['country'] ?? '', 100),
            'asn' => vg_int_misc_text($data['asn'] ?? '', 40), 'organization' => vg_int_misc_text($data['as_name'] ?? '', 160),
            'notice' => 'Kullanıcının elle girdiği genel IP için yaklaşık ülke/ASN bilgisi; ziyaretçi otomatik izlenmez, şehir veya koordinat verilmez.',
            'attribution' => ['label' => 'IP data by IPinfo', 'url' => 'https://ipinfo.io/'],
        ];
    }
    if ($action === 'nominatim') {
        $q = vg_int_misc_query($input);
        $data = vg_int_misc_get('https://nominatim.openstreetmap.org/search', ['q' => $q, 'format' => 'jsonv2', 'limit' => 5, 'addressdetails' => 0], ['Accept-Language' => 'tr'], $fetch);
        $items = [];
        if (count($data) > 5) vg_int_misc_bad();
        foreach ($data as $row) {
            if (!is_array($row) || !is_numeric($row['lat'] ?? null) || !is_numeric($row['lon'] ?? null)) vg_int_misc_bad();
            $items[] = ['label' => vg_int_misc_text($row['display_name'] ?? '', 400), 'lat' => vg_int_misc_number((float)$row['lat'], -90, 90), 'lon' => vg_int_misc_number((float)$row['lon'], -180, 180)];
        }
        return vg_int_misc_base('OpenStreetMap Nominatim', 'https://nominatim.openstreetmap.org/') + [
            'query' => $q, 'items' => $items, 'attribution' => ['label' => '© OpenStreetMap contributors · ODbL', 'url' => 'https://www.openstreetmap.org/copyright'],
            'usagePolicy' => 'https://operations.osmfoundation.org/policies/nominatim/',
            'notice' => 'Yalnız elle başlatılan saha konumu araması. Otomatik tamamlama ve toplu sorgu yapılmaz; uygulama genelinde en çok saniyede bir istek ve önbellek uygulanır.',
        ];
    }
    if ($action === 'coingecko') {
        $key = vg_int_secret('VG_COINGECKO_DEMO_KEY');
        $data = vg_int_misc_get('https://api.coingecko.com/api/v3/simple/price', ['ids' => 'bitcoin,ethereum', 'vs_currencies' => 'try,usd', 'include_last_updated_at' => 'true'], $key === '' ? [] : ['x-cg-demo-api-key' => $key], $fetch);
        $items = [];
        foreach (['bitcoin' => 'BTC', 'ethereum' => 'ETH'] as $id => $symbol) {
            $row = $data[$id] ?? [];
            $dt = $row['last_updated_at'] ?? null;
            $items[] = ['id' => $id, 'symbol' => $symbol, 'prices' => ['TRY' => vg_int_misc_number($row['try'] ?? null, 0, 1e15), 'USD' => vg_int_misc_number($row['usd'] ?? null, 0, 1e15)], 'observedAt' => vg_int_misc_time($dt), 'stale' => time() - $dt > 600];
        }
        return vg_int_misc_base('CoinGecko', 'https://www.coingecko.com/') + ['items' => $items, 'notice' => 'Sağlayıcının son güncelleme zamanı gösterilir. Gösterge piyasa verisidir; teklif kuru veya yatırım önerisi değildir.'];
    }
    if ($action === 'github') {
        $owner = $input['owner'] ?? null; $repo = $input['repo'] ?? null;
        if (!is_string($owner) || !preg_match('/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/D', $owner) ||
            !is_string($repo) || !preg_match('/^[A-Za-z0-9._-]{1,100}$/D', $repo) || $repo === '.' || $repo === '..') throw new VgIntegrationError(400, 'invalid_input', 'Geçerli GitHub sahibi ve depo adı girin.');
        $key = vg_int_secret('VG_GITHUB_TOKEN');
        $headers = ['Accept' => 'application/vnd.github+json', 'X-GitHub-Api-Version' => '2026-03-10'];
        if ($key !== '') $headers['Authorization'] = 'Bearer ' . $key;
        $data = vg_int_misc_get('https://api.github.com/repos/' . $owner . '/' . $repo, [], $headers, $fetch);
        if (($data['private'] ?? null) !== false || ($data['visibility'] ?? '') !== 'public') throw new VgIntegrationError(403, 'public_repository_only', 'Bu bağlantı yalnız herkese açık depoları gösterir.');
        if (!is_string($data['full_name'] ?? null) || strcasecmp($data['full_name'], $owner . '/' . $repo) !== 0) vg_int_misc_bad();
        return vg_int_misc_base('GitHub', 'https://github.com/') + ['repository' => [
            'name' => $data['full_name'], 'url' => 'https://github.com/' . rawurlencode($owner) . '/' . rawurlencode($repo),
            'description' => vg_int_misc_text($data['description'] ?? '', 400), 'language' => vg_int_misc_text($data['language'] ?? '', 80),
            'stars' => vg_int_misc_number($data['stargazers_count'] ?? null, 0, 1e9), 'forks' => vg_int_misc_number($data['forks_count'] ?? null, 0, 1e9),
            'license' => vg_int_misc_text($data['license']['spdx_id'] ?? '', 80),
        ]];
    }
    if ($action === 'unsplash') {
        $q = vg_int_misc_query($input); $limit = vg_int_misc_limit($input);
        $data = vg_int_misc_get('https://api.unsplash.com/search/photos', ['query' => $q, 'per_page' => $limit, 'page' => 1, 'content_filter' => 'high'], ['Authorization' => 'Client-ID ' . vg_int_misc_key('VG_UNSPLASH_ACCESS_KEY'), 'Accept-Version' => 'v1'], $fetch);
        if (!is_array($data['results'] ?? null)) vg_int_misc_bad();
        $items = [];
        foreach (array_slice($data['results'], 0, $limit) as $row) {
            $profile = vg_int_misc_url($row['user']['links']['html'] ?? null, ['unsplash.com']);
            $photo = vg_int_misc_url($row['links']['html'] ?? null, ['unsplash.com']);
            $items[] = [
                'id' => vg_int_misc_text($row['id'] ?? '', 100), 'description' => vg_int_misc_text($row['alt_description'] ?? $row['description'] ?? '', 300),
                'imageUrl' => vg_int_misc_url($row['urls']['small'] ?? null, ['images.unsplash.com']),
                'photographer' => vg_int_misc_text($row['user']['name'] ?? '', 120),
                'photographerUrl' => $profile . (strpos($profile, '?') === false ? '?' : '&') . 'utm_source=voltguard&utm_medium=referral',
                'photoUrl' => $photo . (strpos($photo, '?') === false ? '?' : '&') . 'utm_source=voltguard&utm_medium=referral',
                'attribution' => 'Photo by ' . vg_int_misc_text($row['user']['name'] ?? '', 120) . ' on Unsplash',
            ];
            if ($items[count($items) - 1]['photographer'] === '') vg_int_misc_bad();
        }
        return vg_int_misc_base('Unsplash', 'https://unsplash.com/?utm_source=voltguard&utm_medium=referral') + ['query' => $q, 'items' => $items, 'notice' => 'Arama önizlemesidir. Görseller API hotlink adresiyle, fotoğrafçı profil bağlantısı ve Unsplash atfıyla gösterilmelidir. Görsel seçme, indirme veya yayımlama işlemi sunulmaz.'];
    }
    if ($action === 'tmdb') {
        if (vg_int_secret('VG_TMDB_COMMERCIAL_LICENSE') !== '1' && !vg_int_development()) throw new VgIntegrationError(503, 'license_required', 'Ticari kullanım lisansı doğrulanana kadar TMDB üretimde kapalıdır.');
        $q = vg_int_misc_query($input); $limit = vg_int_misc_limit($input);
        $data = vg_int_misc_get('https://api.themoviedb.org/3/search/movie', ['query' => $q, 'include_adult' => 'false', 'language' => 'tr-TR', 'page' => 1], ['Authorization' => 'Bearer ' . vg_int_misc_key('VG_TMDB_TOKEN')], $fetch);
        if (!is_array($data['results'] ?? null)) vg_int_misc_bad();
        $items = [];
        foreach (array_slice($data['results'], 0, $limit) as $row) {
            if (($row['adult'] ?? false) === true) continue;
            $id = vg_int_misc_number($row['id'] ?? null, 1, 1e12);
            $items[] = ['id' => $id, 'title' => vg_int_misc_text($row['title'] ?? '', 200), 'releaseDate' => vg_int_misc_text($row['release_date'] ?? '', 10), 'url' => 'https://www.themoviedb.org/movie/' . (int)$id];
        }
        return vg_int_misc_base('TMDB', 'https://www.themoviedb.org/') + ['query' => $q, 'items' => $items, 'attribution' => 'This product uses the TMDB API but is not endorsed or certified by TMDB.', 'brandingUrl' => 'https://www.themoviedb.org/about/logos-attribution'];
    }
    if ($action === 'newsapi') {
        if (vg_int_secret('VG_NEWSAPI_PRODUCTION_ALLOWED') !== '1' && !vg_int_development()) throw new VgIntegrationError(503, 'development_only', 'NewsAPI ücretsiz geliştirici planı üretimde kullanılamaz.');
        $q = vg_int_misc_query($input); $limit = vg_int_misc_limit($input);
        $data = vg_int_misc_get('https://newsapi.org/v2/everything', ['q' => $q, 'pageSize' => $limit, 'page' => 1, 'sortBy' => 'publishedAt'], ['X-Api-Key' => vg_int_misc_key('VG_NEWSAPI_KEY')], $fetch);
        if (($data['status'] ?? '') !== 'ok' || !is_array($data['articles'] ?? null)) vg_int_misc_bad();
        $items = [];
        foreach (array_slice($data['articles'], 0, $limit) as $row) {
            if (($row['title'] ?? '') === '[Removed]') continue;
            $items[] = ['title' => vg_int_misc_text($row['title'] ?? '', 300), 'publisher' => vg_int_misc_text($row['source']['name'] ?? '', 120), 'url' => vg_int_misc_url($row['url'] ?? null), 'publishedAt' => vg_int_misc_text($row['publishedAt'] ?? '', 40)];
        }
        return vg_int_misc_base('NewsAPI', 'https://newsapi.org/') + ['query' => $q, 'items' => $items, 'notice' => 'Yalnız başlık, yayıncı ve özgün haber bağlantısı gösterilir. Tam haber metni aktarılmaz; ücretsiz geliştirici sonuçları gecikmeli olabilir.'];
    }
    if ($action === 'jsonplaceholder' || $action === 'dummyjson') {
        $limit = vg_int_misc_limit($input);
        $dummy = $action === 'dummyjson';
        $data = vg_int_misc_get($dummy ? 'https://dummyjson.com/products' : 'https://jsonplaceholder.typicode.com/posts', $dummy ? ['limit' => $limit, 'select' => 'id,title,price,category'] : ['_limit' => $limit], [], $fetch);
        $rows = $dummy ? ($data['products'] ?? null) : $data;
        if (!is_array($rows)) vg_int_misc_bad();
        $items = [];
        foreach (array_slice($rows, 0, $limit) as $row) {
            $item = ['id' => vg_int_misc_number($row['id'] ?? null, 1, 1e9), 'title' => vg_int_misc_text($row['title'] ?? '', 300)];
            if ($dummy) { $item['demoPrice'] = vg_int_misc_number($row['price'] ?? null, 0, 1e12); $item['category'] = vg_int_misc_text($row['category'] ?? '', 120); }
            else $item['body'] = vg_int_misc_text($row['body'] ?? '', 600);
            $items[] = $item;
        }
        return vg_int_misc_base($dummy ? 'DummyJSON' : 'JSONPlaceholder', $dummy ? 'https://dummyjson.com/' : 'https://jsonplaceholder.typicode.com/') + ['synthetic' => true, 'items' => $items, 'notice' => 'SENTETİK TEST VERİSİ: gerçek müşteri, çalışan, ürün, stok veya teklif kaydı değildir. Yalnız okuma yapılır; operasyon kayıtlarına kaydedilmez.'];
    }
    throw new VgIntegrationError(400, 'unknown_action', 'Bilinmeyen veri servisi.');
}
