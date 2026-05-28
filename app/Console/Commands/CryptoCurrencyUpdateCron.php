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
        $currencies = CryptoCurrency::select(['id', 'code', 'rate', 'usd_rate'])->get();
        $currencyCodes = implode(',', $currencies->pluck('code')->toArray());

        $response = $this->cryptoRateUpdate(basicControl()->base_currency, $currencyCodes);
        if ($response['status']) {
            foreach ($response['res'] as $apiRes) {
                $matchingCurrencies = $currencies->where('code', $apiRes['code']);

                if ($matchingCurrencies->isNotEmpty()) {
                    $matchingCurrencies->each(function ($currency) use ($apiRes) {
                        $currency->update([
                            'rate' => $apiRes['rate'],
                            'usd_rate' => $apiRes['usd_rate'],
                            'change_24h' => $apiRes['change_24h'] ?? null,
                            'sparkline_7d' => $apiRes['sparkline_7d'] ?? null,
                            'last_rate_sync_at' => now(),
                            'last_rate_sync_error' => null,
                        ]);
                    });
                }
            }

            if (!empty($response['errors'])) {
                foreach ($response['errors'] as $errorCode => $errorMessage) {
                    CryptoCurrency::query()
                        ->where('code', $errorCode)
                        ->update([
                            'last_rate_sync_error' => $errorMessage,
                        ]);
                }
            }

            return;
        }

        CryptoCurrency::query()
            ->update([
                'last_rate_sync_error' => $response['res'],
            ]);
    }
}
