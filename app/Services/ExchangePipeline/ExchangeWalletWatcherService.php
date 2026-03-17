<?php

namespace App\Services\ExchangePipeline;

use App\Models\CryptoMethod;
use App\Models\ExchangeWallet;
use RuntimeException;
use Throwable;

class ExchangeWalletWatcherService
{
    public function syncWallet(ExchangeWallet $wallet, bool $force = false): ExchangeWallet
    {
        $provider = (string)config('exchange_pipeline.treasury.watch_provider', 'none');

        if ($provider === 'none') {
            $wallet->forceFill([
                'watch_provider' => null,
                'watch_status' => 'manual',
                'watch_reference' => null,
                'webhook_subscribed_at' => null,
                'watch_error' => null,
            ])->save();

            return $wallet->fresh();
        }

        if (!$wallet->status) {
            $wallet->forceFill([
                'watch_provider' => $provider,
                'watch_status' => 'inactive',
                'watch_error' => null,
            ])->save();

            return $wallet->fresh();
        }

        if (
            !$force
            && $wallet->watch_provider === $provider
            && $wallet->watch_status === 'subscribed'
            && filled($wallet->webhook_subscribed_at)
        ) {
            return $wallet;
        }

        try {
            $reference = $this->subscribeViaProvider($wallet, $provider);

            $wallet->forceFill([
                'watch_provider' => $provider,
                'watch_status' => 'subscribed',
                'watch_reference' => $reference,
                'webhook_subscribed_at' => now(),
                'watch_error' => null,
            ])->save();

            return $wallet->fresh();
        } catch (Throwable $exception) {
            $wallet->forceFill([
                'watch_provider' => $provider,
                'watch_status' => 'failed',
                'watch_reference' => null,
                'webhook_subscribed_at' => null,
                'watch_error' => $exception->getMessage(),
            ])->save();

            throw $exception instanceof RuntimeException
                ? $exception
                : new RuntimeException($exception->getMessage(), previous: $exception);
        }
    }

    public function syncEligibleWallets(bool $force = false, int $limit = 100): int
    {
        $provider = (string)config('exchange_pipeline.treasury.watch_provider', 'none');
        if ($provider === 'none') {
            return 0;
        }

        $query = ExchangeWallet::query()
            ->where('status', true)
            ->whereIn('allocation_status', ['available', 'reserved'])
            ->orderBy('id');

        if (!$force) {
            $query->where(function ($builder) use ($provider) {
                $builder->whereNull('watch_provider')
                    ->orWhere('watch_provider', '!=', $provider)
                    ->orWhereNull('webhook_subscribed_at')
                    ->orWhereIn('watch_status', ['failed', 'not_configured', 'inactive']);
            });
        }

        $processed = 0;

        $query->limit($limit)->get()->each(function (ExchangeWallet $wallet) use ($force, &$processed) {
            $this->syncWallet($wallet, $force);
            $processed++;
        });

        return $processed;
    }

    private function subscribeViaProvider(ExchangeWallet $wallet, string $provider): ?string
    {
        if ($provider !== 'crypto_apis') {
            throw new RuntimeException("Treasury watch provider [{$provider}] is not supported.");
        }

        $method = CryptoMethod::where('code', 'crypto_apis')->first();
        if (!$method) {
            throw new RuntimeException('CryptoAPIs crypto method is not configured.');
        }

        $serviceClass = 'App\\Services\\CryptoMethod\\crypto_apis\\Service';
        if (!class_exists($serviceClass)) {
            throw new RuntimeException('CryptoAPIs service class is missing.');
        }

        $result = app($serviceClass)->subscribeAddressWebhook($method, $wallet->currency_code, $wallet->address, 'exchange');

        return $result['reference'] ?? null;
    }
}
