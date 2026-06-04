<?php

namespace App\Services\Kyc;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class DiditClient
{
    private const DEFAULT_BASE_URL = 'https://verification.didit.me';

    public function createSession(array $payload): array
    {
        return $this->request('POST', '/v3/session/', $payload);
    }

    public function getDecision(string $sessionId): array
    {
        return $this->request('GET', '/v3/session/' . urlencode($sessionId) . '/decision/');
    }

    public function verifyWebhook(Request $request): bool
    {
        $secret = $this->webhookSecret();
        if ($secret === '') {
            return false;
        }

        $timestamp = (int) $request->header('X-Timestamp', 0);
        if ($timestamp <= 0 || abs(time() - $timestamp) > 300) {
            return false;
        }

        $payload = json_decode((string) $request->getContent(), true);
        if (!is_array($payload)) {
            return false;
        }

        $signatureV2 = trim((string) $request->header('X-Signature-V2', ''));
        if ($signatureV2 !== '') {
            $canonical = $this->canonicalJson($payload);
            if (hash_equals(hash_hmac('sha256', $canonical, $secret), $signatureV2)) {
                return true;
            }
        }

        $signature = trim((string) $request->header('X-Signature', ''));
        if ($signature !== '' && hash_equals(hash_hmac('sha256', (string) $request->getContent(), $secret), $signature)) {
            return true;
        }

        $simpleSignature = trim((string) $request->header('X-Signature-Simple', ''));
        if ($simpleSignature !== '') {
            $simple = implode(':', [
                $timestamp,
                (string) ($payload['session_id'] ?? ''),
                (string) ($payload['status'] ?? ''),
                (string) ($payload['webhook_type'] ?? ''),
            ]);

            return hash_equals(hash_hmac('sha256', $simple, $secret), $simpleSignature);
        }

        return false;
    }

    private function request(string $method, string $uri, array $payload = []): array
    {
        $apiKey = $this->apiKey();
        if ($apiKey === '') {
            throw new RuntimeException('Configure Didit API key before using automatic KYC.');
        }

        $response = $this->http($this->baseUrl())
            ->withHeaders(['x-api-key' => $apiKey])
            ->send($method, $uri, $payload === [] ? [] : ['json' => $payload]);

        if (!$response->successful()) {
            $decoded = $response->json();
            $detail = is_array($decoded) ? (string) ($decoded['detail'] ?? '') : '';
            $message = trim($detail) !== '' ? $detail : $response->body();
            throw new RuntimeException('Didit API ' . $response->status() . ': ' . $message);
        }

        $decoded = $response->json();
        if (!is_array($decoded)) {
            throw new RuntimeException('Didit API returned an invalid response.');
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

    private function canonicalJson(array $payload): string
    {
        $this->ksortRecursive($payload);

        return (string) json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function ksortRecursive(array &$payload): void
    {
        ksort($payload);

        foreach ($payload as &$value) {
            if (is_array($value)) {
                $this->ksortRecursive($value);
            }
        }
    }

    private function apiKey(): string
    {
        return trim((string) (basicControl()->didit_api_key ?? env('DIDIT_API_KEY', '')));
    }

    private function webhookSecret(): string
    {
        return trim((string) (basicControl()->didit_webhook_secret ?? env('DIDIT_WEBHOOK_SECRET', '')));
    }

    private function baseUrl(): string
    {
        $baseUrl = trim((string) (basicControl()->didit_base_url ?? env('DIDIT_BASE_URL', self::DEFAULT_BASE_URL)));
        if ($baseUrl === '') {
            return self::DEFAULT_BASE_URL;
        }

        $parts = parse_url($baseUrl);
        if (!is_array($parts) || empty($parts['host'])) {
            return self::DEFAULT_BASE_URL;
        }

        return rtrim($baseUrl, '/');
    }
}
