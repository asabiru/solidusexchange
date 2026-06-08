<?php

namespace App\Library;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Arr;
use RuntimeException;
use Throwable;

class CryptoCloud
{
    private string $apiKey = '';
    private string $shopId = '';
    private string $secretKey = '';
    private string $payoutApiKey = '';
    private string $baseUrl = 'https://api.cryptocloud.plus/v2';

    public function setup(string $apiKey, string $shopId, string $secretKey = '', string $payoutApiKey = ''): void
    {
        $this->apiKey = trim($apiKey);
        $this->shopId = trim($shopId);
        $this->secretKey = trim($secretKey);
        $this->payoutApiKey = trim($payoutApiKey);
    }

    public function createStaticWallet(string $currencyCode, string $identify): array
    {
        return $this->post('/invoice/static/create', [
            'shop_id' => $this->shopId,
            'currency' => $currencyCode,
            'identify' => $identify,
        ], $this->apiKey);
    }

    public function subscribeStaticWallet(string $uuid): array
    {
        return $this->post('/invoice/static/subscribe', [
            'uuid' => $uuid,
        ], $this->apiKey);
    }

    public function createPayout(string $currencyCode, string $toAddress, float $amount, ?string $orderId = null): array
    {
        $payload = [
            'currency_code' => $currencyCode,
            'to_address' => $toAddress,
            'amount' => $amount,
        ];

        if (!empty($orderId)) {
            $payload['order_id'] = $orderId;
        }

        return $this->post('/invoice/api/out/create', $payload, $this->payoutApiKey ?: $this->apiKey);
    }

    public function verifyPostback(?string $token): bool
    {
        if (empty($token) || empty($this->secretKey)) {
            return false;
        }

        try {
            JWT::decode($token, new Key($this->secretKey, 'HS256'));
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    private function post(string $path, array $payload, string $token): array
    {
        if (empty($token)) {
            throw new RuntimeException('CryptoCloud API key is not configured.');
        }

        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_URL => $this->baseUrl . $path,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_ENCODING => '',
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_CUSTOMREQUEST => 'POST',
            CURLOPT_POSTFIELDS => json_encode($payload),
            CURLOPT_HTTPHEADER => [
                'Authorization: Token ' . $token,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
        ]);

        $rawResponse = curl_exec($curl);
        $statusCode = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);

        if ($rawResponse === false) {
            $message = curl_error($curl);
            curl_close($curl);
            throw new RuntimeException('CryptoCloud request failed: ' . $message);
        }

        curl_close($curl);

        $response = json_decode($rawResponse, true);

        if (!is_array($response)) {
            throw new RuntimeException('CryptoCloud returned an invalid response.');
        }

        if ($statusCode >= 400 || ($response['status'] ?? null) !== 'success') {
            $message = $this->extractErrorMessage($response);
            throw new RuntimeException($message ?: 'CryptoCloud request was rejected.');
        }

        return $response;
    }

    private function extractErrorMessage(array $response): ?string
    {
        $result = $response['result'] ?? null;

        if (is_string($result) && $result !== '') {
            return $result;
        }

        if (is_array($result)) {
            $messages = [];
            array_walk_recursive($result, static function ($value) use (&$messages) {
                if (is_scalar($value) && $value !== '') {
                    $messages[] = (string)$value;
                }
            });

            if ($messages) {
                return implode(' ', Arr::flatten($messages));
            }
        }

        return $response['message'] ?? null;
    }
}
