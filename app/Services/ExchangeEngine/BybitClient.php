<?php

namespace App\Services\ExchangeEngine;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class BybitClient
{
    public function getBestAsk(string $symbol): float
    {
        $response = $this->publicRequest('GET', '/v5/market/orderbook', [
            'category' => 'spot',
            'symbol' => strtoupper($symbol),
            'limit' => 1,
        ]);

        $askPrice = $response['result']['a'][0][0] ?? null;
        if ($askPrice === null) {
            throw new RuntimeException("Bybit orderbook did not return ask price for {$symbol}.");
        }

        return (float)$askPrice;
    }

    public function getInstrumentInfo(string $symbol): array
    {
        $response = $this->publicRequest('GET', '/v5/market/instruments-info', [
            'category' => 'spot',
            'symbol' => strtoupper($symbol),
        ]);

        $instrument = $response['result']['list'][0] ?? null;
        if (!$instrument) {
            throw new RuntimeException("Bybit instrument info did not return data for {$symbol}.");
        }

        return $instrument;
    }

    public function createSpotMarketBuyByBaseQty(string $symbol, float $qty, string $orderLinkId): array
    {
        return $this->privateRequest('POST', '/v5/order/create', [
            'category' => 'spot',
            'symbol' => strtoupper($symbol),
            'side' => 'Buy',
            'orderType' => 'Market',
            'marketUnit' => 'baseCoin',
            'qty' => $this->formatNumber($qty, 16),
            'orderLinkId' => substr($orderLinkId, 0, 36),
        ]);
    }

    public function waitForClosedOrder(string $symbol, string $orderId, int $attempts = 8, int $sleepMilliseconds = 500): array
    {
        $lastOrder = null;

        for ($i = 0; $i < $attempts; $i++) {
            $lastOrder = $this->getOrder($symbol, $orderId);
            if ($lastOrder && $this->isFinalOrderState($lastOrder)) {
                return $lastOrder;
            }

            usleep($sleepMilliseconds * 1000);
        }

        if ($lastOrder) {
            return $lastOrder;
        }

        throw new RuntimeException("Bybit order {$orderId} was not found.");
    }

    private function getOrder(string $symbol, string $orderId): ?array
    {
        $params = [
            'category' => 'spot',
            'symbol' => strtoupper($symbol),
            'orderId' => $orderId,
        ];

        foreach (['/v5/order/realtime', '/v5/order/history'] as $endpoint) {
            $response = $this->privateRequest('GET', $endpoint, $params, false);
            $order = $response['result']['list'][0] ?? null;
            if ($order) {
                return $order;
            }
        }

        return null;
    }

    private function isFinalOrderState(array $order): bool
    {
        return in_array(($order['orderStatus'] ?? null), ['Filled', 'Cancelled', 'PartiallyFilledCanceled', 'Rejected'], true);
    }

    private function publicRequest(string $method, string $uri, array $params = []): array
    {
        $response = $this->http()->send($method, $uri, [
            'query' => $params,
        ]);

        return $this->decodeResponse($response->json(), $uri);
    }

    private function privateRequest(string $method, string $uri, array $params = [], bool $throwWhenEmpty = true): array
    {
        $timestamp = (string)round(microtime(true) * 1000);
        $apiKey = trim((string)config('exchange_engine.bybit.api_key'));
        $apiSecret = trim((string)config('exchange_engine.bybit.api_secret'));
        $recvWindow = (string)config('exchange_engine.bybit.recv_window', 5000);

        if ($apiKey === '' || $apiSecret === '') {
            throw new RuntimeException('Set BYBIT_API_KEY and BYBIT_API_SECRET before using exchange engine.');
        }

        $payload = strtoupper($method) === 'GET'
            ? $this->buildQueryString($params)
            : $this->buildJsonBody($params);

        $signature = hash_hmac('sha256', $timestamp . $apiKey . $recvWindow . $payload, $apiSecret);

        $options = [
            'headers' => [
                'X-BAPI-API-KEY' => $apiKey,
                'X-BAPI-TIMESTAMP' => $timestamp,
                'X-BAPI-SIGN' => $signature,
                'X-BAPI-RECV-WINDOW' => $recvWindow,
                'X-BAPI-SIGN-TYPE' => '2',
            ],
        ];

        if (strtoupper($method) === 'GET') {
            $options['query'] = $params;
        } else {
            $options['body'] = $payload;
        }

        $response = $this->http()->withHeaders($options['headers'])->send($method, $uri, $options);

        return $this->decodeResponse($response->json(), $uri, $throwWhenEmpty);
    }

    private function http(): PendingRequest
    {
        return Http::baseUrl((string)config('exchange_engine.bybit.base_url'))
            ->acceptJson()
            ->contentType('application/json')
            ->timeout((int)config('exchange_engine.bybit.timeout', 10));
    }

    private function decodeResponse(?array $response, string $uri, bool $throwWhenEmpty = true): array
    {
        if (!$response) {
            if ($throwWhenEmpty) {
                throw new RuntimeException("Empty response from Bybit endpoint {$uri}.");
            }

            return [];
        }

        if (!array_key_exists('retCode', $response)) {
            if (!empty($response['error'])) {
                throw new RuntimeException("Bybit API error on {$uri}: {$response['error']}");
            }

            throw new RuntimeException("Unexpected response from Bybit endpoint {$uri}.");
        }

        if (($response['retCode'] ?? 0) !== 0) {
            $message = $response['retMsg'] ?? 'Unknown Bybit error';
            throw new RuntimeException("Bybit API error on {$uri}: {$message}");
        }

        return $response;
    }

    private function buildQueryString(array $params): string
    {
        ksort($params);

        return http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }

    private function buildJsonBody(array $params): string
    {
        ksort($params);

        return (string)json_encode($params, JSON_UNESCAPED_SLASHES);
    }

    private function formatNumber(float $value, int $scale = 16): string
    {
        return rtrim(rtrim(number_format($value, $scale, '.', ''), '0'), '.') ?: '0';
    }
}
