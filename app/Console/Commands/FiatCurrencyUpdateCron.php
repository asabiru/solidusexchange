<?php

namespace App\Console\Commands;

use App\Models\FiatCurrency;
use App\Models\BasicControl;
use App\Traits\CurrencyRateUpdate;
use Illuminate\Console\Command;

class FiatCurrencyUpdateCron extends Command
{
    use CurrencyRateUpdate;

    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'app:fiat-currency-update-cron';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Fiat currency rate update command';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $currencies = FiatCurrency::select(['id', 'code', 'rate', 'usd_rate'])->where('status', 1)->get();
        $currencyCodes = $currencies->pluck('code')
            ->push('USD')
            ->unique()
            ->implode(',');

        $response = $this->fiatRateUpdate(basicControl()->base_currency, $currencyCodes);

        if ($response['status']) {
            $baseExchangeRate = $this->resolveBaseExchangeRate($response['res']);
            if ($baseExchangeRate !== null) {
                optional(BasicControl::first())->update([
                    'exchange_rate' => $baseExchangeRate,
                ]);
            }

            foreach ($response['res'] as $key => $apiRes) {
                $apiCode = substr($key, -3);
                $apiRate = 1 / $apiRes;
                $matchingCurrencies = $currencies->where('code', $apiCode);

                if ($matchingCurrencies->isNotEmpty()) {
                    $matchingCurrencies->each(function ($currency) use ($apiRate) {
                        $currency->update([
                            'rate' => $apiRate,
                            'usd_rate' => getUSDRate($apiRate),
                            'last_rate_sync_at' => now(),
                            'last_rate_sync_error' => null,
                        ]);
                    });
                }
            }

            return;
        }

        FiatCurrency::query()
            ->where('status', 1)
            ->update([
                'last_rate_sync_error' => $response['res'],
            ]);
    }

    protected function resolveBaseExchangeRate(array $quotes): ?float
    {
        $baseCurrency = strtoupper((string) basicControl()->base_currency);

        if ($baseCurrency === 'USD') {
            return 1.0;
        }

        $quoteKey = $baseCurrency . 'USD';
        $quote = (float) ($quotes[$quoteKey] ?? 0);

        if ($quote <= 0) {
            return null;
        }

        return 1 / $quote;
    }
}
