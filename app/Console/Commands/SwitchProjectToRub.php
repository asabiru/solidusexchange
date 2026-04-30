<?php

namespace App\Console\Commands;

use App\Models\BasicControl;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use Facades\App\Services\BasicCurl;
use Illuminate\Console\Command;

class SwitchProjectToRub extends Command
{
    protected $signature = 'app:switch-project-to-rub';

    protected $description = 'Set RUB as the project base currency and normalize all base-denominated rates.';

    public function handle(): int
    {
        $basicControl = BasicControl::firstOrCreate();
        $exchangeRate = $this->resolveRubExchangeRate($basicControl);

        if ($exchangeRate === null || $exchangeRate <= 0) {
            $this->error('Unable to resolve a valid USD/RUB exchange rate. Project base currency was not changed.');
            return self::FAILURE;
        }

        $basicControl->fill([
            'base_currency' => 'RUB',
            'currency_symbol' => '₽',
            'exchange_rate' => $exchangeRate,
            'is_currency_position' => 'right',
            'has_space_between_currency_and_amount' => 1,
        ])->save();

        $this->upsertRubFiatCurrency($exchangeRate);
        $this->normalizeFiatRates($exchangeRate);
        $this->normalizeCryptoRates($exchangeRate);

        $this->info(sprintf('Project base currency switched to RUB. 1 USD = %s RUB', rtrim(rtrim(number_format($exchangeRate, 6, '.', ''), '0'), '.')));

        return self::SUCCESS;
    }

    private function resolveRubExchangeRate(BasicControl $basicControl): ?float
    {
        $rubCurrency = FiatCurrency::query()
            ->whereRaw('UPPER(code) = ?', ['RUB'])
            ->first();

        if ($rubCurrency && (float) $rubCurrency->usd_rate > 0) {
            return 1 / (float) $rubCurrency->usd_rate;
        }

        $response = BasicCurl::curlGetRequest('https://www.cbr-xml-daily.ru/daily_json.js');
        $payload = json_decode((string) $response, true);
        $cbrRate = (float) data_get($payload, 'Valute.USD.Value', 0);

        if ($cbrRate > 0) {
            return $cbrRate;
        }

        if (strtoupper((string) $basicControl->base_currency) === 'RUB' && (float) $basicControl->exchange_rate > 0) {
            return (float) $basicControl->exchange_rate;
        }

        return null;
    }

    private function upsertRubFiatCurrency(float $exchangeRate): void
    {
        $rubUsdRate = $exchangeRate > 0 ? 1 / $exchangeRate : 0;

        $rub = FiatCurrency::query()->whereRaw('UPPER(code) = ?', ['RUB'])->first();

        if ($rub) {
            $rub->fill([
                'name' => $rub->name ?: 'Russian Ruble',
                'symbol' => $rub->symbol ?: '₽',
                'rate' => 1,
                'usd_rate' => $rubUsdRate,
                'status' => 1,
                'show_in_buy' => 1,
                'show_in_sell' => 1,
            ])->save();

            return;
        }

        $nextSort = ((int) FiatCurrency::query()->max('sort_by')) + 1;

        FiatCurrency::create([
            'name' => 'Russian Ruble',
            'code' => 'RUB',
            'symbol' => '₽',
            'rate' => 1,
            'usd_rate' => $rubUsdRate,
            'rate_markup_percent' => 0,
            'processing_fee' => 0,
            'processing_fee_type' => 'percent',
            'min_send' => 1000,
            'max_send' => 5000000,
            'driver' => 'local',
            'image' => null,
            'status' => 1,
            'show_in_buy' => 1,
            'show_in_sell' => 1,
            'sort_by' => $nextSort,
            'last_rate_sync_at' => now(),
            'last_rate_sync_error' => null,
        ]);
    }

    private function normalizeFiatRates(float $exchangeRate): void
    {
        FiatCurrency::query()->get()->each(function (FiatCurrency $currency) use ($exchangeRate) {
            $code = strtoupper((string) $currency->code);

            if ($code === 'RUB') {
                $currency->rate = 1;
                $currency->usd_rate = $exchangeRate > 0 ? 1 / $exchangeRate : $currency->usd_rate;
            } elseif ((float) $currency->usd_rate > 0) {
                $currency->rate = (float) $currency->usd_rate * $exchangeRate;
            }

            $currency->save();
        });
    }

    private function normalizeCryptoRates(float $exchangeRate): void
    {
        CryptoCurrency::query()->get()->each(function (CryptoCurrency $currency) use ($exchangeRate) {
            if ((float) $currency->usd_rate <= 0) {
                return;
            }

            $currency->rate = (float) $currency->usd_rate * $exchangeRate;
            $currency->save();
        });
    }
}
