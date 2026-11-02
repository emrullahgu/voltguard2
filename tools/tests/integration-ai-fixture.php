<?php
declare(strict_types=1);
define('VG_API', true);
final class VgIntegrationError extends RuntimeException
{
    public int $httpStatus;
    public string $errorCode;
    public function __construct(int $status, string $code, string $message)
    {
        parent::__construct($message); $this->httpStatus = $status; $this->errorCode = $code;
    }
}
function vg_int_secret(string $key): string {
    $value = (string)($GLOBALS['fixtureSecrets'][$key] ?? '');
    if ($value === '__invalid__') throw new VgIntegrationError(503, 'configuration_invalid', 'Sentetik geçersiz ayar.');
    return $value;
}
require dirname(__DIR__, 2) . '/api/lib/integration-ai.php';
$fixture = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$GLOBALS['fixtureSecrets'] = $fixture['secrets'] ?? [];
$requests = [];
try {
    $fetch = static function (string $method, string $url, array $options) use (&$requests, $fixture): array {
        $requests[] = ['method' => $method, 'url' => $url, 'options' => $options];
        $response = $fixture['response'] ?? ['status' => 200, 'body' => '{}'];
        if (isset($response['json'])) $response['body'] = json_encode($response['json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        return $response;
    };
    $result = ($fixture['action'] ?? 'chat') === 'status' ? vg_int_ai_status() : vg_int_ai($fixture['input'] ?? [], $fetch);
    $output = ['ok' => true, 'result' => $result, 'requests' => $requests];
} catch (VgIntegrationError $error) {
    $output = ['ok' => false, 'status' => $error->httpStatus, 'code' => $error->errorCode, 'message' => $error->getMessage(), 'requests' => $requests];
}
echo json_encode($output, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
