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

        // Step 1: Fetch Rapira rates for prices + 24h change
        $rapiraRates = $this->fetchRapiraCryptoRates();
        if ($rapiraRates === null) {
            return [
                'status' => false,
                'res' => 'Rapira market rates are unavailable',
            ];
        }

        // Get USDT/RUB rate from Rapira for base currency conversion
        $usdtRubRate = $rapiraRates->get('USDT/RUB');
        $baseRateFactor = $this->resolveRapiraBaseRateFactor((string) $convert, $usdtRubRate);

        // Step 2: Fetch Bybit tickers as fallback (for currencies not on Rapira, e.g. BTC)
        $bybitBaseUrl = rtrim((string) config('exchange_engine.bybit.base_url', 'https://api.bybit.com'), '/');
        $bybitTickers = $this->fetchBybitSpotTickers($bybitBaseUrl);

        $results = [];
        $errors = [];

        foreach ($codes as $code) {
            $normalizedCode = $this->normalizeBybitCurrencyCode($code);

            // Resolve USD rate: try Rapira first, fall back to Bybit
            $usdRate = $this->resolveRapiraUsdRate($normalizedCode, $rapiraRates);

            if ($usdRate === null && $bybitTickers !== null) {
                $usdRate = $this->resolveBybitUsdRate($normalizedCode, $bybitTickers);
            }

            if ($usdRate === null) {
                $errors[$code] = "Rate for {$code} not found on Rapira or Bybit";
                continue;
            }

            // Resolve 24h change: try Rapira first, fall back to Bybit
            $change24h = $this->resolveRapira24hChange($normalizedCode, $rapiraRates);
            if ($change24h === null && $bybitTickers !== null) {
                $change24h = $this->resolveBybit24hChange($normalizedCode, $bybitTickers);
            }

            // Resolve sparkline from Bybit (only for non-stablecoins)
            $sparkline7d = null;
            if (!in_array($normalizedCode, ['USD', 'USDT', 'USDC'], true)) {
                $sparkline7d = $this->resolveBybitSparkline($normalizedCode, $bybitBaseUrl);
            }

            $results[] = [
                'code' => $code,
                'usd_rate' => $usdRate,
                'rate' => $usdRate * $baseRateFactor,
                'change_24h' => $change24h,
                'sparkline_7d' => $sparkline7d,
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

    protected function fetchBybitSpotTickers(string $baseUrl): ?\Illuminate\Support\Collection
    {
        try {
            $url = "{$baseUrl}/v5/market/tickers?category=spot";
            $response = json_decode(BasicCurl::curlGetRequest($url));

            if (($response->retCode ?? 1) !== 0 || !isset($response->result->list) || !is_array($response->result->list)) {
                return null;
            }

            return collect($response->result->list)->mapWithKeys(function ($ticker) {
                return [strtoupper((string) ($ticker->symbol ?? '')) => $ticker];
            })->filter(fn($_, $key) => $key !== '');
        } catch (\Exception $e) {
            return null;
        }
    }

    protected function fetchRapiraCryptoRates(): ?\Illuminate\Support\Collection
    {
        $marketRatesUrl = (string) config('services.rapira.market_rates_url', 'https://api.rapira.net/open/market/rates');
        $response = json_decode(BasicCurl::curlGetRequest($marketRatesUrl));

        if (!isset($response->data) || !is_array($response->data)) {
            return null;
        }

        return collect($response->data)->mapWithKeys(function ($item) {
            return [strtoupper((string) $item->symbol) => $item];
        });
    }

    protected function resolveRapiraUsdRate(string $code, $rapiraRates): ?float
    {
        $code = strtoupper(trim($code));

        if (in_array($code, ['USD', 'USDT'], true)) {
            return 1.0;
        }

        // Try direct pair CODE/USDT
        $ticker = $rapiraRates->get("{$code}/USDT");
        if ($ticker) {
            $usdRate = (float) ($ticker->usdRate ?? 0);
            if ($usdRate > 0) {
                return $usdRate;
            }
            $close = (float) ($ticker->close ?? 0);
            if ($close > 0) {
                return $close;
            }
        }

        // Try inverse pair USDT/CODE
        $inverseTicker = $rapiraRates->get("USDT/{$code}");
        if ($inverseTicker) {
            $close = (float) ($inverseTicker->close ?? 0);
            if ($close > 0) {
                return 1 / $close;
            }
        }

        // Try cross-rate via BTC or ETH
        foreach (['BTC', 'ETH'] as $bridge) {
            $crossTicker = $rapiraRates->get("{$code}/{$bridge}");
            if ($crossTicker) {
                $crossRate = (float) ($crossTicker->usdRate ?? 0);
                if ($crossRate > 0) {
                    return $crossRate;
                }
            }

            $inverseCrossTicker = $rapiraRates->get("{$bridge}/{$code}");
            if ($inverseCrossTicker) {
                $inverseRate = (float) ($inverseCrossTicker->close ?? 0);
                $bridgeUsdRate = $this->resolveRapiraUsdRate($bridge, $rapiraRates);
                if ($inverseRate > 0 && $bridgeUsdRate !== null) {
                    return (1 / $inverseRate) * $bridgeUsdRate;
                }
            }
        }

        return null;
    }

    protected function resolveRapira24hChange(string $code, $rapiraRates): ?float
    {
        if (in_array($code, ['USD', 'USDT'], true)) {
            // USDT/RUB pair has its own chg
            $rubTicker = $rapiraRates->get("USDT/RUB");
            if ($rubTicker && isset($rubTicker->chg)) {
                return round((float) $rubTicker->chg * 100, 2);
            }
            return 0.0;
        }

        $ticker = $rapiraRates->get("{$code}/USDT");
        if ($ticker && isset($ticker->chg)) {
            return round((float) $ticker->chg * 100, 2);
        }

        return null;
    }

    protected function resolveRapiraBaseRateFactor(string $convert, $usdtRubTicker): float
    {
        $convert = strtoupper(trim($convert));

        if ($convert === 'USD' || $convert === 'USDT') {
            return 1.0;
        }

        // If base currency is RUB, use USDT/RUB from Rapira
        if ($convert === 'RUB' && $usdtRubTicker) {
            $rate = (float) ($usdtRubTicker->close ?? 0);
            if ($rate > 0) {
                return $rate; // 1 USDT = X RUB, so rate = X RUB per USDT
            }
        }

        // Fallback to stored rate
        $storedBaseRateFactor = $this->resolveStoredBaseRateFactor($convert);
        if ($storedBaseRateFactor !== null && $storedBaseRateFactor > 0) {
            return 1 / $storedBaseRateFactor;
        }

        return (float) basicControl()->exchange_rate;
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

    protected function resolveBybit24hChange(string $code, $tickers): ?float
    {
        if (in_array($code, ['USD', 'USDT'], true)) {
            return 0.0;
        }

        $ticker = $tickers->get(strtoupper("{$code}USDT"));
        if ($ticker && isset($ticker->price24hPcnt)) {
            return round((float) $ticker->price24hPcnt * 100, 2);
        }

        return null;
    }

    protected function resolveBybitSparkline(string $code, string $baseUrl): ?array
    {
        if (in_array($code, ['USD', 'USDT'], true)) {
            return null;
        }

        try {
            $symbol = strtoupper("{$code}USDT");
            $url = "{$baseUrl}/v5/market/kline?category=spot&symbol={$symbol}&interval=240&limit=42";
            $response = json_decode(BasicCurl::curlGetRequest($url));

            if (($response->retCode ?? 1) !== 0 || !isset($response->result->list) || !is_array($response->result->list)) {
                return null;
            }

            $prices = array_map(function ($kline) {
                return (float) $kline[4]; // close price
            }, $response->result->list);

            // API returns newest first, reverse to chronological order
            return array_reverse($prices);
        } catch (\Exception $e) {
            return null;
        }
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
        $source = strtoupper(trim((string) $source));
        $targetCurrencies = collect(is_array($currencies) ? $currencies : explode(',', (string) $currencies))
            ->map(fn($currency) => strtoupper(trim((string) $currency)))
            ->filter()
            ->unique()
            ->values();

        if ($source === '') {
            return [
                'status' => false,
                'res' => 'Base currency is not configured',
            ];
        }

        if ($targetCurrencies->isEmpty()) {
            return [
                'status' => false,
                'res' => 'No fiat currencies selected for sync',
            ];
        }

        $marketRatesUrl = (string) config('services.rapira.market_rates_url', 'https://api.rapira.net/open/market/rates');
        $marketRatesResponse = json_decode(BasicCurl::curlGetRequest($marketRatesUrl));

        if (($marketRatesResponse->code ?? 1) !== 0 || !isset($marketRatesResponse->data) || !is_array($marketRatesResponse->data)) {
            return [
                'status' => false,
                'res' => $marketRatesResponse->message ?? $marketRatesResponse->error ?? 'Rapira market rates are unavailable',
            ];
        }

        $usdPerUnit = $this->extractRapiraUsdPerUnit($marketRatesResponse->data);
        $sourceUsdRate = $usdPerUnit[$source] ?? null;

        if ($sourceUsdRate === null || $sourceUsdRate <= 0) {
            return [
                'status' => false,
                'res' => "Rapira market rate is unavailable for {$source}",
            ];
        }

        $quotes = [];
        $errors = [];

        foreach ($targetCurrencies as $targetCurrency) {
            if ($targetCurrency === $source) {
                $quotes[$source . $targetCurrency] = 1.0;
                continue;
            }

            $targetUsdRate = $usdPerUnit[$targetCurrency] ?? null;
            if ($targetUsdRate === null || $targetUsdRate <= 0) {
                $errors[$targetCurrency] = "Rapira market rate is unavailable for {$targetCurrency}";
                continue;
            }

            $quotes[$source . $targetCurrency] = $sourceUsdRate / $targetUsdRate;
        }

        if (empty($quotes)) {
            return [
                'status' => false,
                'res' => collect($errors)->values()->implode(', '),
            ];
        }

        return [
            'status' => true,
            'res' => $quotes,
            'errors' => $errors,
        ];
    }

    protected function extractRapiraUsdPerUnit(array $markets): array
    {
        $usdPerUnit = [
            'USD' => 1.0,
            'USDT' => 1.0,
        ];

        foreach ($markets as $market) {
            $quoteCurrency = strtoupper((string) ($market->quoteCurrency ?? ''));
            $baseCurrency = strtoupper((string) ($market->baseCurrency ?? ''));
            $quoteUsdRate = (float) ($market->usdRate ?? 0);
            $baseUsdRate = (float) ($market->baseUsdRate ?? 0);

            if ($quoteCurrency !== '' && $quoteUsdRate > 0) {
                $usdPerUnit[$quoteCurrency] = $quoteUsdRate;
            }

            if ($baseCurrency !== '' && $baseUsdRate > 0) {
                $usdPerUnit[$baseCurrency] = $baseUsdRate;
            }
        }

        return $usdPerUnit;
    }
}
