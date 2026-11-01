<?php
/* Explicit employee AI requests. Credentials never leave the server. */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

function vg_int_ai_definitions(): array
{
    return [
        'gemini' => ['label' => 'Google Gemini', 'key' => 'VG_GEMINI_API_KEY', 'modelKey' => 'VG_GEMINI_MODEL',
            'defaultModel' => 'gemini-3.8-flash', 'privacyUrl' => 'https://ai.google.dev/gemini-api/docs/pricing',
            'notice' => 'İleti Google’a gönderilir. Ücretsiz katmanda içerik Google ürünlerini geliştirmek için kullanılabilir.'],
        'groq' => ['label' => 'Groq', 'key' => 'VG_GROQ_API_KEY', 'modelKey' => 'VG_GROQ_MODEL',
            'defaultModel' => 'openai/gpt-oss-20b', 'privacyUrl' => 'https://console.groq.com/docs/your-data',
            'notice' => 'İleti Groq’a gönderilir. Saklama ve veri kullanımı koşulları hesap ayarlarına bağlıdır.'],
        'openrouter' => ['label' => 'OpenRouter · ücretsiz modeller', 'key' => 'VG_OPENROUTER_API_KEY', 'modelKey' => 'VG_OPENROUTER_MODEL',
            'defaultModel' => 'openrouter/free', 'privacyUrl' => 'https://openrouter.ai/docs/guides/privacy/provider-logging',
            'notice' => 'İleti OpenRouter’a gönderilir. Ücretsiz yönlendirmede alt model ve sağlayıcı değişebilir; veri toplamayan sağlayıcılar talep edilir.'],
        'cloudflare' => ['label' => 'Cloudflare Workers AI', 'key' => 'VG_CLOUDFLARE_API_TOKEN', 'modelKey' => 'VG_CLOUDFLARE_AI_MODEL',
            'defaultModel' => '@cf/openai/gpt-oss-20b', 'privacyUrl' => 'https://developers.cloudflare.com/workers-ai/platform/data-usage/',
            'notice' => 'İleti Cloudflare Workers AI’a gönderilir. Standart çıkarımda içerik model eğitimi için kullanılmaz.'],
    ];
}

function vg_int_ai_valid_model(string $provider, string $model): bool
{
    if (strlen($model) > 160 || !preg_match('/^[A-Za-z0-9@][A-Za-z0-9._:\/\-]*$/D', $model)) return false;
    if ($provider === 'gemini') return preg_match('/^gemini-[A-Za-z0-9._-]+$/D', $model) === 1;
    if ($provider === 'openrouter') return $model === 'openrouter/free' || preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*:free$/D', $model) === 1;
    if ($provider === 'cloudflare') return preg_match('/^@cf\/[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/D', $model) === 1;
    return true;
}

/** Configuration presence is not a successful upstream connection or a quota guarantee. */
function vg_int_ai_status(): array
{
    $result = [];
    foreach (vg_int_ai_definitions() as $provider => $definition) {
        $model = $definition['defaultModel']; $configured = false; $validModel = true;
        try {
            $configuredModel = trim(vg_int_secret($definition['modelKey']));
            $model = $configuredModel !== '' ? $configuredModel : $definition['defaultModel'];
            $validModel = vg_int_ai_valid_model($provider, $model);
            $key = vg_int_secret($definition['key']);
            $configured = trim($key) !== '' && !preg_match('/[\r\n]/', $key) && $validModel;
            if ($provider === 'cloudflare') $configured = $configured && preg_match('/^[a-f0-9]{32}$/Di', vg_int_secret('VG_CLOUDFLARE_ACCOUNT_ID')) === 1;
        } catch (VgIntegrationError $error) {
            // A malformed credential for one provider must not disable another provider.
            $configured = false;
        }
        $result[$provider] = [
            'provider' => $provider, 'label' => $definition['label'], 'configured' => (bool)$configured,
            'model' => $validModel ? $model : $definition['defaultModel'],
            'privacyUrl' => $definition['privacyUrl'], 'notice' => $definition['notice'],
        ];
    }
    return $result;
}

function vg_int_ai_input_text($value): string
{
    if (!is_string($value) || strlen($value) > 48000 || !preg_match('//u', $value) || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
        throw new VgIntegrationError(400, 'invalid_ai_input', 'İleti geçerli metin olmalı.');
    }
    $value = trim($value);
    if ($value === '') throw new VgIntegrationError(400, 'invalid_ai_input', 'Gönderilecek iletiyi yazın.');
    return $value;
}

function vg_int_ai_text_length(string $value): int
{
    return (int)preg_match_all('/./us', $value);
}

function vg_int_ai_usage(array $data): array
{
    $input = $data['prompt_tokens'] ?? $data['promptTokenCount'] ?? null;
    $output = $data['completion_tokens'] ?? $data['candidatesTokenCount'] ?? null;
    $total = $data['total_tokens'] ?? $data['totalTokenCount'] ?? null;
    $valid = static function ($n): ?int { return is_int($n) && $n >= 0 && $n <= 1000000000 ? $n : null; };
    return ['inputTokens' => $valid($input), 'outputTokens' => $valid($output), 'totalTokens' => $valid($total)];
}

/** No tools, automatic customer context, automatic retries or provider failover. */
function vg_int_ai(array $input, ?callable $fetch = null): array
{
    foreach (array_keys($input) as $key) {
        if (!in_array($key, ['provider', 'prompt', 'history', 'maxOutputTokens'], true)) {
            throw new VgIntegrationError(400, 'invalid_ai_input', 'Desteklenmeyen yapay zekâ isteği alanı.');
        }
    }
    $provider = $input['provider'] ?? null;
    if (!is_string($provider) || !array_key_exists($provider, vg_int_ai_definitions())) {
        throw new VgIntegrationError(400, 'invalid_ai_provider', 'Geçerli bir yapay zekâ sağlayıcısı seçin.');
    }
    $prompt = vg_int_ai_input_text($input['prompt'] ?? null);
    $length = vg_int_ai_text_length($prompt);
    $history = $input['history'] ?? [];
    if (!is_array($history) || count($history) > 12 || ($history !== [] && array_keys($history) !== range(0, count($history) - 1))) {
        throw new VgIntegrationError(400, 'invalid_ai_input', 'Görüşme geçmişi en fazla 12 ileti olabilir.');
    }
    $messages = [];
    foreach ($history as $entry) {
        if (!is_array($entry) || count($entry) !== 2 || !isset($entry['role'], $entry['content']) || !in_array($entry['role'], ['user', 'assistant'], true)) {
            throw new VgIntegrationError(400, 'invalid_ai_input', 'Görüşme geçmişindeki ileti doğrulanamadı.');
        }
        $content = vg_int_ai_input_text($entry['content']);
        $length += vg_int_ai_text_length($content);
        $messages[] = ['role' => $entry['role'], 'content' => $content];
    }
    if ($length > 12000) throw new VgIntegrationError(400, 'ai_input_too_long', 'İleti ve geçmiş toplamı en fazla 12.000 karakter olabilir.');
    $tokens = $input['maxOutputTokens'] ?? 1024;
    if (!is_int($tokens) || $tokens < 64 || $tokens > 1024) throw new VgIntegrationError(400, 'invalid_ai_input', 'Yanıt sınırı 64–1024 arasında tam sayı olmalı.');
    $status = vg_int_ai_status()[$provider];
    if (!$status['configured']) throw new VgIntegrationError(503, 'ai_not_configured', 'Bu sağlayıcı için sunucu bağlantı ayarı gerekiyor.');
    $definitions = vg_int_ai_definitions();
    $key = vg_int_secret($definitions[$provider]['key']);
    $model = $status['model'];
    $system = 'VoltGuard teknik yardım asistanısın. Türkçe, açık ve ölçülü yanıt ver. Kullanıcının yazdığı metni teknik açıklama, taslak veya özet olarak ele al. Şirket kayıtlarına, dosyalara veya araçlara erişimin yoktur; işlem yaptığını, kayıt kaydettiğini ya da ölçüm doğruladığını iddia etme. Elektrik işlerinde tahminleri belirt; kritik hesapları yetkin kişinin doğrulamasını iste. Gizli bilgileri isteme.';
    $messages[] = ['role' => 'user', 'content' => $prompt];
    $headers = ['Accept' => 'application/json', 'Content-Type' => 'application/json'];
    if ($provider === 'gemini') {
        $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
        $headers['x-goog-api-key'] = $key;
        $contents = array_map(static function (array $message): array { return ['role' => $message['role'] === 'assistant' ? 'model' : 'user', 'parts' => [['text' => $message['content']]]]; }, $messages);
        $body = ['systemInstruction' => ['parts' => [['text' => $system]]], 'contents' => $contents, 'generationConfig' => ['maxOutputTokens' => $tokens, 'temperature' => 0.2]];
    } else {
        array_unshift($messages, ['role' => 'system', 'content' => $system]);
        $headers['Authorization'] = 'Bearer ' . $key;
        $body = ['model' => $model, 'messages' => $messages, 'stream' => false];
        if ($provider === 'groq') {
            $url = 'https://api.groq.com/openai/v1/chat/completions';
            $body['max_completion_tokens'] = $tokens;
            if (in_array($model, ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'], true)) {
                $body['include_reasoning'] = false;
                $body['reasoning_effort'] = 'low';
            }
        } elseif ($provider === 'openrouter') {
            $url = 'https://openrouter.ai/api/v1/chat/completions';
            $body['max_tokens'] = $tokens;
            $body['provider'] = ['data_collection' => 'deny', 'allow_fallbacks' => false];
        } else {
            $url = 'https://api.cloudflare.com/client/v4/accounts/' . vg_int_secret('VG_CLOUDFLARE_ACCOUNT_ID') . '/ai/run/' . $model;
            unset($body['model']);
            $body['max_tokens'] = $tokens;
        }
    }
    $fetch = $fetch ?? 'vg_int_http';
    $response = $fetch('POST', $url, ['headers' => $headers, 'body' => json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'timeout' => 25, 'maxBytes' => 262144]);
    $httpStatus = (int)($response['status'] ?? 0);
    if ($httpStatus === 429) throw new VgIntegrationError(429, 'ai_quota_exceeded', 'Sağlayıcının kullanım sınırına ulaşıldı. İleti otomatik yeniden gönderilmedi; daha sonra yeniden deneyin.');
    if ($httpStatus === 401 || $httpStatus === 403 || $httpStatus === 402) throw new VgIntegrationError(503, 'ai_provider_access', 'Sağlayıcı erişim veya hesap kotası nedeniyle isteği kabul etmedi. Sunucu bağlantı ayarını kontrol edin.');
    if ($httpStatus < 200 || $httpStatus >= 300) throw new VgIntegrationError(502, 'ai_provider_unavailable', 'Yapay zekâ sağlayıcısı yanıt veremedi. İleti otomatik yeniden gönderilmedi.');
    $raw = $response['body'] ?? null;
    $data = is_string($raw) && strlen($raw) <= 262144 ? json_decode($raw, true, 32) : null;
    if (!is_array($data) || json_last_error() !== JSON_ERROR_NONE || isset($data['error']) || ($data['success'] ?? true) === false || !empty($data['errors'])) {
        throw new VgIntegrationError(502, 'invalid_ai_response', 'Yapay zekâ sağlayıcısının yanıtı doğrulanamadı.');
    }
    $text = '';
    $finish = '';
    $usage = [];
    if ($provider === 'gemini') {
        $candidate = $data['candidates'][0] ?? [];
        if (!is_array($candidate)) throw new VgIntegrationError(502, 'invalid_ai_response', 'Yapay zekâ sağlayıcısının yanıtı doğrulanamadı.');
        $finish = $candidate['finishReason'] ?? '';
        if (isset($data['promptFeedback']['blockReason']) || in_array($finish, ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'], true)) {
            throw new VgIntegrationError(422, 'ai_content_blocked', 'Sağlayıcı bu ileti için yanıt oluşturmadı. İletiyi gözden geçirin.');
        }
        $parts = $candidate['content']['parts'] ?? [];
        if (!is_array($parts)) throw new VgIntegrationError(502, 'invalid_ai_response', 'Yapay zekâ sağlayıcısının yanıtı doğrulanamadı.');
        foreach ($parts as $part) {
            if (is_array($part) && ($part['thought'] ?? false) !== true && is_string($part['text'] ?? null)) $text .= $part['text'];
        }
        $usage = is_array($data['usageMetadata'] ?? null) ? $data['usageMetadata'] : [];
    } elseif ($provider === 'cloudflare') {
        $result = $data['result'] ?? null;
        if (is_array($result)) {
            $text = is_string($result['response'] ?? null) ? $result['response'] : '';
            $usage = is_array($result['usage'] ?? null) ? $result['usage'] : [];
        }
    } else {
        $choice = $data['choices'][0] ?? [];
        $text = is_string($choice['message']['content'] ?? null) ? $choice['message']['content'] : '';
        $finish = $choice['finish_reason'] ?? '';
        $usage = is_array($data['usage'] ?? null) ? $data['usage'] : [];
        if ($provider === 'openrouter' && is_string($data['model'] ?? null) && strlen($data['model']) <= 160 && preg_match('/^[A-Za-z0-9@][A-Za-z0-9._:\/\-]*$/D', $data['model'])) $model = $data['model'];
    }
    if (!is_string($text) || trim($text) === '' || strlen($text) > 131072 || !preg_match('//u', $text)) throw new VgIntegrationError(502, 'invalid_ai_response', 'Sağlayıcı geçerli bir metin yanıtı oluşturmadı.');
    return ['text' => trim($text), 'provider' => $provider, 'model' => $model,
        'usage' => vg_int_ai_usage($usage), 'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
        'truncated' => in_array($finish, ['length', 'MAX_TOKENS'], true)];
}
