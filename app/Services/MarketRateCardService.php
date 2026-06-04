<?php

namespace App\Services;

use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

class MarketRateCardService
{
    public function cards(int $limit = 10): Collection
    {
        $baseCurrency = strtoupper((string) (basicControl()->base_currency ?? 'RUB'));
        $buyFiat = $this->fiatCurrency($baseCurrency, 'buy');
        $sellFiat = $this->fiatCurrency($baseCurrency, 'sell');
        $query = CryptoCurrency::where('status', 1);

        if (Schema::hasColumn('crypto_currencies', 'show_on_homepage')) {
            $query->where('show_on_homepage', 1);
        }

        return $query
            ->orderBy('sort_by', 'ASC')
            ->limit($limit)
            ->get()
            ->map(fn (CryptoCurrency $currency) => $this->card($currency, $baseCurrency, $buyFiat, $sellFiat))
            ->values();
    }

    private function card(CryptoCurrency $currency, string $baseCurrency, ?FiatCurrency $buyFiat, ?FiatCurrency $sellFiat): array
    {
        $buyRate = $this->cryptoFiatRate($currency, $buyFiat);
        $sellRate = $this->cryptoFiatRate($currency, $sellFiat);
        $change = $currency->change_24h;

        return [
            'id' => (int) $currency->id,
            'code' => strtoupper((string) $currency->normalized_code),
            'name' => $currency->name,
            'image_path' => $currency->image_path,
            'quote_code' => $baseCurrency,
            'pair' => strtoupper((string) $currency->normalized_code) . '/' . $baseCurrency,
            'buy_rate' => $buyRate,
            'sell_rate' => $sellRate,
            'display_buy_rate' => $this->formatRate($buyRate),
            'display_sell_rate' => $this->formatRate($sellRate),
            'change_24h' => $change === null ? null : (float) $change,
        ];
    }

    private function fiatCurrency(string $baseCurrency, string $side): ?FiatCurrency
    {
        $query = FiatCurrency::query()
            ->with(['buyGateway', 'fiatSendGateway'])
            ->active()
            ->whereRaw('UPPER(code) = ?', [$baseCurrency])
            ->sorted();

        if ($side === 'buy') {
            return $query->visibleInBuy()->first();
        }

        return $query->visibleInSell()->first();
    }

    private function cryptoFiatRate(CryptoCurrency $currency, ?FiatCurrency $fiatCurrency): ?float
    {
        if (!$fiatCurrency) {
            return null;
        }

        $cryptoUsdRate = $this->cryptoUsdRate($currency);
        $fiatUsdRate = $this->effectiveFiatUsdRate($fiatCurrency);

        if ($cryptoUsdRate <= 0 || $fiatUsdRate <= 0) {
            return null;
        }

        return $cryptoUsdRate / $fiatUsdRate;
    }

    private function cryptoUsdRate(CryptoCurrency $currency): float
    {
        $usdRate = (float) $currency->usd_rate;

        if ($usdRate > 0) {
            return $usdRate;
        }

        return (float) $currency->rate;
    }

    private function effectiveFiatUsdRate(FiatCurrency $currency): float
    {
        $storedUsdRate = (float) $currency->usd_rate;
        $baseCurrency = strtoupper((string) basicControl()->base_currency);

        if (strtoupper((string) $currency->code) !== $baseCurrency) {
            return $currency->applyRateMarkupToUsdRate($storedUsdRate);
        }

        $referenceUsdt = CryptoCurrency::where('status', 1)
            ->orderBy('sort_by', 'ASC')
            ->get()
            ->first(function (CryptoCurrency $cryptoCurrency) {
                return strtoupper((string) $cryptoCurrency->normalized_code) === 'USDT'
                    && (float) $cryptoCurrency->rate > 0
                    && (float) $cryptoCurrency->usd_rate > 0;
            });

        if (!$referenceUsdt) {
            return $currency->applyRateMarkupToUsdRate($storedUsdRate);
        }

        return $currency->applyRateMarkupToUsdRate((float) $referenceUsdt->usd_rate / (float) $referenceUsdt->rate);
    }

    private function formatRate(?float $rate): string
    {
        if ($rate === null || $rate <= 0) {
            return '—';
        }

        if ($rate >= 1) {
            return number_format($rate, 2, '.', ' ');
        }

        return rtrim(rtrim(number_format($rate, 8, '.', ' '), '0'), '.');
    }
}
