<?php

namespace App\Console\Commands;

use App\Models\CryptoCurrency;
use App\Traits\CurrencyRateUpdate;
use Illuminate\Console\Command;

class CryptoCurrencyUpdateCron extends Command
{
    use CurrencyRateUpdate;

    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'app:crypto-currency-update-cron';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Crypto currency rate update command';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $currencies = CryptoCurrency::select(['id', 'code', 'rate', 'usd_rate'])->where('status', 1)->get();
        $currencyCodes = implode(',', $currencies->pluck('code')->toArray());

        $response = $this->cryptoRateUpdate(basicControl()->base_currency, $currencyCodes);
        if ($response['status']) {
            foreach ($response['res'] as $apiRes) {
                $apiCode = $apiRes[0]->symbol;
                $apiRate = $apiRes[0]->quote->{basicControl()->base_currency}->price;
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

        CryptoCurrency::query()
            ->where('status', 1)
            ->update([
                'last_rate_sync_error' => $response['res'],
            ]);
    }
}
