<?php

namespace App\Traits;


use App\Models\FiatCurrency;
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
                'res' => $response->retMsg ?? $response->error ?? 'Bybit market data is unavailable',
            ];
        }

        $tickers = collect($response->result->list)->mapWithKeys(function ($ticker) {
            return [strtoupper((string) $ticker->symbol) => $ticker];
        });

        $baseRateFactor = $this->resolveBybitBaseRateFactor((string) $convert, $tickers);

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

        $directRate = $this->getTickerReferencePrice($tickers, "{$code}USDT");
        if ($directRate !== null) {
            return $directRate;
        }

        $inverseRate = $this->getTickerReferencePrice($tickers, "USDT{$code}");
        if ($inverseRate !== null && $inverseRate > 0) {
            return 1 / $inverseRate;
        }

        foreach (['USDC', 'BTC', 'ETH'] as $quoteCurrency) {
            $crossRate = $this->getTickerReferencePrice($tickers, "{$code}{$quoteCurrency}");
            $inverseCrossRate = $this->getTickerReferencePrice($tickers, "{$quoteCurrency}{$code}");
            $quoteToUsdRate = $this->resolveBybitUsdRate($quoteCurrency, $tickers);

            if ($crossRate !== null && $quoteToUsdRate !== null) {
                return $crossRate * $quoteToUsdRate;
            }

            if ($inverseCrossRate !== null && $inverseCrossRate > 0 && $quoteToUsdRate !== null) {
                return (1 / $inverseCrossRate) * $quoteToUsdRate;
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

    protected function getTickerReferencePrice($tickers, string $symbol): ?float
    {
        $ticker = $tickers->get(strtoupper($symbol));
        if (!$ticker) {
            return null;
        }

        $bidPrice = (float) ($ticker->bid1Price ?? 0);
        $askPrice = (float) ($ticker->ask1Price ?? 0);

        if ($bidPrice > 0 && $askPrice > 0) {
            return ($bidPrice + $askPrice) / 2;
        }

        if ($askPrice > 0) {
            return $askPrice;
        }

        if ($bidPrice > 0) {
            return $bidPrice;
        }

        $lastPrice = (float) ($ticker->lastPrice ?? 0);
        return $lastPrice > 0 ? $lastPrice : null;
    }

    protected function resolveBybitBaseRateFactor(string $convert, $tickers): float
    {
        $convert = strtoupper(trim($convert));

        if ($convert === 'USD' || $convert === 'USDT') {
            return 1.0;
        }

        $assetUsdRate = $this->resolveBybitUsdRate($convert, $tickers);
        if ($assetUsdRate !== null && $assetUsdRate > 0) {
            return 1 / $assetUsdRate;
        }

        $storedBaseRateFactor = $this->resolveStoredBaseRateFactor($convert);
        if ($storedBaseRateFactor !== null && $storedBaseRateFactor > 0) {
            return $storedBaseRateFactor;
        }

        return (float) basicControl()->exchange_rate;
    }

    protected function resolveStoredBaseRateFactor(string $convert): ?float
    {
        $convert = strtoupper(trim($convert));

        $fiatCurrency = FiatCurrency::query()
            ->where('status', 1)
            ->whereRaw('UPPER(code) = ?', [$convert])
            ->first();

        if ($fiatCurrency && (float) $fiatCurrency->usd_rate > 0) {
            return 1 / (float) $fiatCurrency->usd_rate;
        }

        if ($convert === strtoupper((string) basicControl()->base_currency) && (float) basicControl()->exchange_rate > 0) {
            return (float) basicControl()->exchange_rate;
        }

        return null;
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
                    'res' => (array) $result->quotes,
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
