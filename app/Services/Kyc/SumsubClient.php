<?php

namespace App\Services\Kyc;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class SumsubClient
{
    public function createApplicant(array $payload, string $levelName): array
    {
        $uri = '/resources/applicants?levelName=' . urlencode($levelName);

        return $this->request('POST', $uri, $payload);
    }

    public function generateSdkToken(string $externalUserId, string $levelName, int $ttlInSecs = 3600): array
    {
        $query = http_build_query([
            'userId' => $externalUserId,
            'levelName' => $levelName,
            'ttlInSecs' => $ttlInSecs,
        ], '', '&', PHP_QUERY_RFC3986);

        return $this->request('POST', '/resources/accessTokens/sdk?' . $query);
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
        $baseUrl = rtrim((string) (basicControl()->sumsub_base_url ?: 'https://api.sumsub.com'), '/');

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
            throw new RuntimeException('Sumsub API error: ' . $response->body());
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
}
