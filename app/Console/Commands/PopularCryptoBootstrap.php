<?php

namespace App\Console\Commands;

use App\Models\CryptoCurrency;
use App\Models\CryptoMethod;
use App\Traits\CurrencyRateUpdate;
use Illuminate\Console\Command;

class PopularCryptoBootstrap extends Command
{
    use CurrencyRateUpdate;

    protected $signature = 'app:popular-crypto-bootstrap {--activate : Activate currencies with successful live market sync}';

    protected $description = 'Bootstrap curated popular crypto currencies and sync their live market rates.';

    public function handle(): int
    {
        $configuredCurrencies = collect(config('popular_crypto_currencies.currencies', []));
        if ($configuredCurrencies->isEmpty()) {
            $this->warn('No popular crypto currencies are configured.');
            return self::SUCCESS;
        }

        $codes = $configuredCurrencies->pluck('code')->filter()->unique()->values();
        $currencies = CryptoCurrency::query()
            ->whereIn('code', $codes)
            ->get()
            ->keyBy('code');

        if ($currencies->isEmpty()) {
            $this->warn('Popular crypto currencies are not present in the database yet. Run migrations first.');
            return self::SUCCESS;
        }

        $response = $this->cryptoRateUpdate((string) basicControl()->base_currency, $codes->implode(','));

        if (!$response['status']) {
            $this->error((string) ($response['res'] ?? 'Unable to sync popular crypto currencies.'));
            $this->markUnsupportedCurrencies($currencies);
            return self::SUCCESS;
        }

        $activate = (bool) $this->option('activate');
        $successfulCodes = collect($response['res'] ?? [])->pluck('code')->all();

        foreach ($response['res'] as $rate) {
            $currency = $currencies->get($rate['code']);
            if (!$currency) {
                continue;
            }

            $currency->rate = (float) $rate['rate'];
            $currency->usd_rate = (float) $rate['usd_rate'];
            $currency->last_rate_sync_at = now();
            $currency->last_rate_sync_error = null;

            if ($activate && $this->canActivateCurrency($currency->code)) {
                $currency->status = 1;
            }

            $currency->save();
        }

        $failedCodes = array_keys($response['errors'] ?? []);
        if ($failedCodes !== []) {
            CryptoCurrency::query()
                ->whereIn('code', $failedCodes)
                ->update([
                    'status' => 0,
                    'last_rate_sync_error' => 'Popular coin bootstrap sync failed: Bybit spot pair not found for this currency',
                ]);
        }

        $this->markUnsupportedCurrencies($currencies->only(array_diff($codes->all(), $successfulCodes))->all());

        $activatedCount = $activate
            ? CryptoCurrency::query()->whereIn('code', $successfulCodes)->where('status', 1)->count()
            : 0;

        $this->info(sprintf(
            'Popular currencies synced: %d success, %d failed, %d activated.',
            count($successfulCodes),
            count($failedCodes),
            $activatedCount
        ));

        return self::SUCCESS;
    }

    private function canActivateCurrency(string $code): bool
    {
        $code = strtoupper(trim($code));
        $depositProvider = (string) config('exchange_pipeline.deposit_provider', 'active_crypto_method');

        if ($depositProvider !== 'active_crypto_method') {
            return true;
        }

        $activeMethod = CryptoMethod::query()->where('status', 1)->first();
        if (!$activeMethod || $activeMethod->code !== 'crypto_cloud') {
            return true;
        }

        return !in_array($code, ['TON', 'USDT_TON'], true);
    }

    private function markUnsupportedCurrencies($currencies): void
    {
        foreach ($currencies as $currency) {
            if (!$currency instanceof CryptoCurrency) {
                continue;
            }

            if ($this->canActivateCurrency($currency->code)) {
                continue;
            }

            $currency->status = 0;
            $currency->last_rate_sync_error = 'Inserted but left inactive because CryptoCloud static wallets do not support this network for auto deposits.';
            $currency->save();
        }
    }
}
