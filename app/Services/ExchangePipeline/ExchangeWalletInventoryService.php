<?php

namespace App\Services\ExchangePipeline;

use App\Models\ExchangeRequest;
use App\Models\ExchangeWallet;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ExchangeWalletInventoryService
{
    public function reserveWallet(string $currencyCode, ExchangeRequest $exchange): ExchangeWallet
    {
        $existingWallet = ExchangeWallet::where('exchange_request_id', $exchange->id)->first();
        if ($existingWallet) {
            return $this->ensureWatchSubscription($existingWallet);
        }

        $wallet = DB::transaction(function () use ($currencyCode, $exchange) {
            $wallet = ExchangeWallet::query()
                ->forCurrency($currencyCode)
                ->available()
                ->orderByRaw('COALESCE(reserved_at, created_at) asc')
                ->lockForUpdate()
                ->first();

            if (!$wallet) {
                throw new RuntimeException("No available treasury wallet was found for {$currencyCode}. Add more deposit addresses in the admin panel.");
            }

            $wallet->allocation_status = 'reserved';
            $wallet->exchange_request_id = $exchange->id;
            $wallet->reserved_at = now();
            $wallet->save();

            return $wallet;
        });

        return $this->ensureWatchSubscription($wallet);
    }

    public function markConsumedForExchange(ExchangeRequest $exchange): void
    {
        ExchangeWallet::where('exchange_request_id', $exchange->id)
            ->where('allocation_status', 'reserved')
            ->update([
                'allocation_status' => 'consumed',
                'consumed_at' => now(),
            ]);
    }

    public function releaseReservation(ExchangeWallet $wallet): void
    {
        $wallet->forceFill([
            'allocation_status' => 'available',
            'exchange_request_id' => null,
            'reserved_at' => null,
        ])->save();
    }

    private function ensureWatchSubscription(ExchangeWallet $wallet): ExchangeWallet
    {
        if ((string)config('exchange_pipeline.treasury.watch_provider', 'none') === 'none') {
            return $wallet->fresh();
        }

        try {
            app(ExchangeWalletWatcherService::class)->syncWallet(
                $wallet,
                $wallet->watch_status !== 'subscribed'
            );
        } catch (Throwable $exception) {
            if ((bool)config('exchange_pipeline.treasury.require_watch_subscription', true)) {
                $this->releaseReservation($wallet);

                throw new RuntimeException(
                    'This treasury wallet could not be subscribed for automatic deposit confirmation. Please contact the administration.'
                );
            }
        }

        return $wallet->fresh();
    }
}
