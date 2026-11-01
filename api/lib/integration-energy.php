<?php
/* Public solar/climatology adapters. Transport, caching and rate limits live in integrations.php. */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

function vg_int_energy_number(array $input, string $key, float $min, float $max, ?float $default = null): float
{
    $value = array_key_exists($key, $input) ? $input[$key] : $default;
    if ((!is_int($value) && !is_float($value) && !is_string($value)) ||
        !is_numeric($value) || !is_finite((float)$value) || (float)$value < $min || (float)$value > $max) {
        throw new VgIntegrationError(400, 'invalid_input', 'Geçerli ' . $key . ' değeri girin.');
    }
    return (float)$value;
}

function vg_int_energy_value($value, float $min, float $max): float
{
    if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value) || $value < $min || $value > $max) {
        throw new VgIntegrationError(502, 'invalid_provider_data', 'Veri servisinden geçerli aylık veri alınamadı.');
    }
    return (float)$value;
}

function vg_int_energy_json(string $url, callable $fetch): array
{
    $response = $fetch('GET', $url, ['headers' => ['Accept' => 'application/json'], 'timeout' => 25, 'maxBytes' => 524288]);
    $status = (int)($response['status'] ?? 0);
    if ($status === 429 || $status === 503) {
        throw new VgIntegrationError(503, 'provider_busy', 'Veri servisi şu anda yoğun; biraz sonra tekrar deneyin.');
    }
    if ($status < 200 || $status >= 300) {
        throw new VgIntegrationError(502, 'provider_unavailable', 'Veri servisine şu anda ulaşılamıyor.');
    }
    $body = $response['body'] ?? null;
    $data = is_string($body) ? json_decode($body, true, 32) : null;
    if (!is_array($data) || json_last_error() !== JSON_ERROR_NONE || isset($data['error']) || isset($data['errors'])) {
        throw new VgIntegrationError(502, 'invalid_provider_data', 'Veri servisinin yanıtı doğrulanamadı.');
    }
    return $data;
}

/** @return array Normalized monthly energy or climate, always with source and units. */
function vg_int_energy(string $action, array $input, ?callable $fetch = null): array
{
    if ($action !== 'pvgis' && $action !== 'nasa_power') {
        throw new VgIntegrationError(400, 'unknown_action', 'Bilinmeyen enerji servisi.');
    }
    $fetch = $fetch ?? 'vg_int_http';
    $lat = vg_int_energy_number($input, 'lat', -90, 90);
    $lon = vg_int_energy_number($input, 'lon', -180, 180);
    $retrievedAt = gmdate('Y-m-d\TH:i:s\Z');
    if ($action === 'pvgis') {
        $peakPower = vg_int_energy_number($input, 'peakPower', 0.001, 1000000, 1);
        $tilt = vg_int_energy_number($input, 'tilt', 0, 90, 15);
        $azimuth = vg_int_energy_number($input, 'azimuth', -180, 180, 0);
        $loss = vg_int_energy_number($input, 'loss', 0, 100, 14);
        // Pin the stable PVGIS 5.3 PVcalc contract; PVGIS 6 uses a different API/schema.
        $endpoint = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc';
        $url = $endpoint . '?' . http_build_query([
            'lat' => $lat, 'lon' => $lon, 'peakpower' => $peakPower, 'loss' => $loss,
            'angle' => $tilt, 'aspect' => $azimuth, 'pvtechchoice' => 'crystSi',
            'mountingplace' => 'free', 'usehorizon' => 1, 'outputformat' => 'json',
        ], '', '&', PHP_QUERY_RFC3986);
        $data = vg_int_energy_json($url, $fetch);
        $rows = $data['outputs']['monthly']['fixed'] ?? null;
        $meteo = $data['inputs']['meteo_data'] ?? null;
        if (!is_array($rows) || count($rows) !== 12 || !is_array($meteo) ||
            !is_int($meteo['year_min'] ?? null) || !is_int($meteo['year_max'] ?? null) ||
            $meteo['year_min'] < 1900 || $meteo['year_max'] < $meteo['year_min'] ||
            !is_string($meteo['radiation_db'] ?? null)) {
            throw new VgIntegrationError(502, 'invalid_provider_data', 'PVGIS aylık verisi veya kaynak dönemi eksik.');
        }
        $months = [];
        foreach ($rows as $row) {
            $month = $row['month'] ?? null;
            if (!is_int($month) || $month < 1 || $month > 12 || isset($months[$month])) {
                throw new VgIntegrationError(502, 'invalid_provider_data', 'PVGIS ay sıralaması doğrulanamadı.');
            }
            $energy = vg_int_energy_value($row['E_m'] ?? null, 0, $peakPower * 1000);
            $months[$month] = ['month' => $month, 'energyKwh' => $energy, 'specificKwhPerKwp' => $energy / $peakPower];
        }
        ksort($months);
        $annual = array_sum(array_column($months, 'energyKwh'));
        // Sum the displayed monthly values; provider totals may differ by rounding.
        return [
            'provider' => 'PVGIS', 'version' => '5.3',
            'source' => ['name' => 'European Commission JRC / PVGIS', 'url' => 'https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en', 'dataset' => substr($meteo['radiation_db'], 0, 80)],
            'dataPeriod' => ['startYear' => $meteo['year_min'], 'endYear' => $meteo['year_max']],
            'retrievedAt' => $retrievedAt, 'endpoint' => $endpoint,
            'inputs' => ['lat' => $lat, 'lon' => $lon, 'peakPower' => $peakPower, 'tilt' => $tilt, 'azimuth' => $azimuth, 'loss' => $loss],
            'monthly' => array_values($months), 'annualEnergyKwh' => $annual, 'annualSpecificKwhPerKwp' => $annual / $peakPower,
            'units' => ['energy' => 'kWh', 'specificEnergy' => 'kWh/kWp'],
            'assumptions' => [
                'Kristal silisyum, serbest havalandırmalı sabit montaj ve sayısal arazi ufku kullanılır; bina/engel gölgeleri modellenmez.',
                'Azimut güneyden ölçülür: 0° güney, +90° batı, −90° doğu, ±180° kuzey.',
                'Aylık AC üretim PVGIS kayıplarını içerir; bu değerlere inverter verimi veya sistem kaybı ikinci kez uygulanmaz.',
                'Uzun dönem tahminidir; sayaç ölçümü veya belirli bir yılın üretim garantisi değildir.',
            ],
        ];
    }

    $endpoint = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
    $url = $endpoint . '?' . http_build_query([
        'parameters' => 'ALLSKY_SFC_SW_DWN,T2M', 'community' => 'RE',
        'longitude' => $lon, 'latitude' => $lat, 'format' => 'JSON',
    ], '', '&', PHP_QUERY_RFC3986);
    $data = vg_int_energy_json($url, $fetch);
    $parameters = $data['parameters'] ?? [];
    $values = $data['properties']['parameter'] ?? [];
    $header = $data['header'] ?? [];
    if (($parameters['ALLSKY_SFC_SW_DWN']['units'] ?? null) !== 'kW-hr/m^2/day' ||
        ($parameters['T2M']['units'] ?? null) !== 'C' || !is_string($header['range'] ?? null)) {
        throw new VgIntegrationError(502, 'invalid_provider_data', 'NASA POWER birimleri veya veri dönemi doğrulanamadı.');
    }
    $months = [];
    foreach (['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as $index => $month) {
        $months[] = [
            'month' => $index + 1,
            'irradiationKwhPerM2Day' => vg_int_energy_value($values['ALLSKY_SFC_SW_DWN'][$month] ?? null, 0, 20),
            'temperatureC' => vg_int_energy_value($values['T2M'][$month] ?? null, -100, 80),
        ];
    }
    return [
        'provider' => 'NASA POWER',
        'source' => ['name' => 'NASA POWER', 'url' => 'https://power.larc.nasa.gov/', 'dataset' => 'ALLSKY_SFC_SW_DWN, T2M'],
        'dataPeriod' => ['description' => substr($header['range'], 0, 300)],
        'retrievedAt' => $retrievedAt, 'endpoint' => $endpoint,
        'inputs' => ['lat' => $lat, 'lon' => $lon], 'monthly' => $months,
        'units' => ['irradiation' => 'kWh/m²/day', 'temperature' => '°C'],
        'assumptions' => [
            'Aylık uzun dönem iklim ortalamalarıdır; günlük tahmin veya anlık hava durumu değildir.',
            'Işınım yatay yüzeyde günlük ortalama güneş enerjisidir; kWh/kWp panel üretimi değildir.',
            '2 m hava sıcaklığı tasarım uç sıcaklığı veya panel hücre sıcaklığı değildir.',
            'Uydu/yeniden analiz ızgarası bina ve yerel engel gölgesini çözmez; GES üretimine doğrudan aktarılmaz.',
        ],
    ];
}
