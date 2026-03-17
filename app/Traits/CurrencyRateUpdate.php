<?php

namespace App\Traits;


use Facades\App\Services\BasicCurl;

trait CurrencyRateUpdate
{
    public function cryptoRateUpdate($convert, $symbols)
    {
        $codes = collect(is_array($symbols) ? $symbols : explode(',', (string) $symbols))
            ->map(fn($symbol) => strtoupper(trim((string) $symbol)))
            ->filter()
            ->unique()
            ->values();

        if ($codes->isEmpty()) {
            return [
                'status' => false,
                'res' => 'No crypto currencies selected for sync',
            ];
        }

        $baseUrl = rtrim((string) config('exchange_engine.bybit.base_url', 'https://api.bybit.com'), '/');
        $response = json_decode(BasicCurl::curlGetRequest("{$baseUrl}/v5/market/tickers?category=spot"));

        if (($response->retCode ?? 1) !== 0 || !isset($response->result->list) || !is_array($response->result->list)) {
            return [
                'status' => false,
                'res' => $response->retMsg ?? 'Bybit market data is unavailable',
            ];
        }

        $tickers = collect($response->result->list)->mapWithKeys(function ($ticker) {
            return [strtoupper((string) $ticker->symbol) => $ticker];
        });

        $baseRateFactor = strtoupper((string) $convert) === 'USD'
            ? 1
            : (float) basicControl()->exchange_rate;

        $results = [];
        $errors = [];

        foreach ($codes as $code) {
            $usdRate = $this->resolveBybitUsdRate($code, $tickers);

            if ($usdRate === null) {
                $errors[$code] = "Bybit spot pair for {$code} was not found";
                continue;
            }

            $results[] = [
                'code' => $code,
                'usd_rate' => $usdRate,
                'rate' => $usdRate * $baseRateFactor,
            ];
        }

        if (empty($results)) {
            return [
                'status' => false,
                'res' => collect($errors)->values()->implode(', '),
            ];
        }

        return [
            'status' => true,
            'res' => $results,
            'errors' => $errors,
        ];
    }

    protected function resolveBybitUsdRate(string $code, $tickers): ?float
    {
        $code = $this->normalizeBybitCurrencyCode($code);

        if (in_array($code, ['USD', 'USDT'], true)) {
            return 1.0;
        }

        $directRate = $this->getTickerLastPrice($tickers, "{$code}USDT");
        if ($directRate !== null) {
            return $directRate;
        }

        foreach (['USDC', 'BTC', 'ETH'] as $quoteCurrency) {
            $crossRate = $this->getTickerLastPrice($tickers, "{$code}{$quoteCurrency}");
            $quoteToUsdRate = $this->getTickerLastPrice($tickers, "{$quoteCurrency}USDT");

            if ($crossRate !== null && $quoteToUsdRate !== null) {
                return $crossRate * $quoteToUsdRate;
            }
        }

        return null;
    }

    protected function normalizeBybitCurrencyCode(string $code): string
    {
        $code = strtoupper(trim($code));

        if (str_contains($code, '_')) {
            return explode('_', $code)[0];
        }

        return $code;
    }

    protected function getTickerLastPrice($tickers, string $symbol): ?float
    {
        $ticker = $tickers->get(strtoupper($symbol));
        if (!$ticker) {
            return null;
        }

        $lastPrice = (float) ($ticker->lastPrice ?? 0);
        return $lastPrice > 0 ? $lastPrice : null;
    }

    public function fiatRateUpdate($source, $currencies)
    {
        if (basicControl()->currency_layer_access_key) {
            $endpoint = 'live';
            $currency_layer_url = "http://api.currencylayer.com";
            $currency_layer_access_key = basicControl()->currency_layer_access_key;

            $baseCurrencyAPIUrl = "$currency_layer_url/$endpoint?access_key=$currency_layer_access_key&source=$source&currencies=$currencies";
            $baseCurrencyConvert = BasicCurl::curlGetRequest($baseCurrencyAPIUrl);
            $result = json_decode($baseCurrencyConvert);

            if (isset($result->success) && isset($result->quotes)) {
                return [
                    'status' => true,
                    'res' => $result->quotes,
                ];
            }

            return [
                'status' => false,
                'res' => 'something went wrong',
            ];
        }
        return [
            'status' => false,
            'res' => 'Please set currencylayer api key',
        ];
    }
}
