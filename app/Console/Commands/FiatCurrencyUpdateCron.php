<?php

namespace App\Console\Commands;

use App\Models\FiatCurrency;
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
        $currencyCodes = implode(',', $currencies->pluck('code')->toArray());

        $response = $this->fiatRateUpdate(basicControl()->base_currency, $currencyCodes);

        if ($response['status']) {
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
}
