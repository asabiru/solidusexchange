<?php

namespace App\Services\Kyc;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class SumsubClient
{
    private const DEFAULT_BASE_URL = 'https://api.sumsub.com';

    public function createApplicant(array $payload, string $levelName): array
    {
        $uri = '/resources/applicants?levelName=' . urlencode($levelName);

        return $this->request('POST', $uri, $payload);
    }

    public function generateSdkToken(string $externalUserId, string $levelName, int $ttlInSecs = 3600): array
    {
        $payload = [
            'userId' => $externalUserId,
            'levelName' => $levelName,
            'ttlInSecs' => $ttlInSecs,
        ];

        return $this->request('POST', '/resources/accessTokens/sdk', $payload);
    }

    public function verifyWebhook(Request $request): bool
    {
        $secretKey = trim((string) (basicControl()->sumsub_secret_key ?? ''));
        if ($secretKey === '') {
            return false;
        }

        $digest = trim((string) $request->header('x-payload-digest', ''));
        if ($digest === '') {
            return false;
        }

        $algorithmHeader = trim((string) $request->header('x-payload-digest-alg', 'HMAC_SHA256_HEX'));
        $rawBody = (string) $request->getContent();

        $algo = str_contains(strtoupper($algorithmHeader), '512') ? 'sha512' : 'sha256';
        $expectedHex = hash_hmac($algo, $rawBody, $secretKey);
        $binaryDigest = hex2bin($expectedHex);
        $expectedBase64 = $binaryDigest === false ? '' : base64_encode($binaryDigest);

        return hash_equals($expectedHex, $digest) || hash_equals($expectedBase64, $digest);
    }

    private function request(string $method, string $uri, array $payload = []): array
    {
        $appToken = trim((string) (basicControl()->sumsub_app_token ?? ''));
        $secretKey = trim((string) (basicControl()->sumsub_secret_key ?? ''));
        $baseUrl = $this->normalizeBaseUrl((string) (basicControl()->sumsub_base_url ?: self::DEFAULT_BASE_URL));

        if ($appToken === '' || $secretKey === '') {
            throw new RuntimeException('Configure Sumsub app token and secret key before using automatic KYC.');
        }

        $timestamp = (string) time();
        $body = $payload === [] ? '' : (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
        $signature = hash_hmac('sha256', $timestamp . strtoupper($method) . $uri . $body, $secretKey);

        $response = $this->http($baseUrl)->withHeaders([
            'X-App-Token' => $appToken,
            'X-App-Access-Ts' => $timestamp,
            'X-App-Access-Sig' => $signature,
        ])->send($method, $uri, $body === '' ? [] : ['body' => $body]);

        if (!$response->successful()) {
            $decodedError = $response->json();
            $description = is_array($decodedError) ? trim((string) ($decodedError['description'] ?? '')) : '';
            $errorName = is_array($decodedError) ? trim((string) ($decodedError['errorName'] ?? '')) : '';
            $errorCode = is_array($decodedError) ? trim((string) ($decodedError['errorCode'] ?? '')) : '';
            $correlationId = is_array($decodedError) ? trim((string) ($decodedError['correlationId'] ?? '')) : '';

            $parts = ["Sumsub API {$response->status()}"];

            if ($description !== '') {
                $parts[] = $description;
            }

            if ($errorName !== '') {
                $parts[] = "errorName={$errorName}";
            }

            if ($errorCode !== '') {
                $parts[] = "errorCode={$errorCode}";
            }

            if ($correlationId !== '') {
                $parts[] = "correlationId={$correlationId}";
            }

            if ($response->status() === 404) {
                $parts[] = 'Check API Base URL and level name.';
                $parts[] = 'Use only ' . self::DEFAULT_BASE_URL . ' as API Base URL.';
            }

            throw new RuntimeException(implode('. ', array_filter($parts)));
        }

        $decoded = $response->json();
        if (!is_array($decoded)) {
            throw new RuntimeException('Sumsub API returned an invalid response.');
        }

        return $decoded;
    }

    private function http(string $baseUrl): PendingRequest
    {
        return Http::baseUrl($baseUrl)
            ->acceptJson()
            ->contentType('application/json')
            ->timeout(20);
    }

    private function normalizeBaseUrl(string $baseUrl): string
    {
        $baseUrl = trim($baseUrl);
        if ($baseUrl === '') {
            return self::DEFAULT_BASE_URL;
        }

        $parts = parse_url($baseUrl);
        if (!is_array($parts) || empty($parts['host'])) {
            return self::DEFAULT_BASE_URL;
        }

        $scheme = !empty($parts['scheme']) ? strtolower($parts['scheme']) : 'https';
        $host = $parts['host'];
        $port = isset($parts['port']) ? ':' . $parts['port'] : '';

        return rtrim(sprintf('%s://%s%s', $scheme, $host, $port), '/');
    }
}
