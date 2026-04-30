<?php

namespace App\Services\ExchangePipeline;

use App\Models\ExchangeRequest;
use App\Models\ExchangeWallet;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ExchangeReservationService
{
    public function releaseForExchange(ExchangeRequest $exchange): int
    {
        return DB::transaction(function () use ($exchange) {
            $wallets = ExchangeWallet::query()
                ->where('exchange_request_id', $exchange->id)
                ->where('allocation_status', 'reserved')
                ->lockForUpdate()
                ->get();

            $released = 0;

            $wallets->each(function (ExchangeWallet $wallet) use (&$released) {
                $wallet->forceFill([
                    'allocation_status' => 'available',
                    'exchange_request_id' => null,
                    'reserved_at' => null,
                ])->save();

                $released++;
            });

            return $released;
        });
    }

    public function releaseExpiredAndCancelledReservations(): array
    {
        $expiredExchangeIds = ExchangeRequest::query()
            ->where('status', 1)
            ->whereNotNull('expire_time')
            ->where('expire_time', '<', now())
            ->pluck('id');

        if ($expiredExchangeIds->isNotEmpty()) {
            ExchangeRequest::query()
                ->whereIn('id', $expiredExchangeIds)
                ->update(['status' => 4]);
        }

        $releaseExchangeIds = ExchangeWallet::query()
            ->where('allocation_status', 'reserved')
            ->where(function ($query) {
                $query->whereDoesntHave('exchangeRequest')
                    ->orWhereHas('exchangeRequest', function ($exchangeQuery) {
                        $exchangeQuery->whereIn('status', [4, 5]);
                    });
            })
            ->pluck('exchange_request_id')
            ->filter()
            ->unique()
            ->values();

        $releasedWallets = 0;

        $releaseExchangeIds->each(function (int $exchangeId) use (&$releasedWallets) {
            $exchange = ExchangeRequest::withTrashed()->find($exchangeId);

            if ($exchange) {
                $releasedWallets += $this->releaseForExchange($exchange);
            }
        });

        $orphanedWallets = ExchangeWallet::query()
            ->where('allocation_status', 'reserved')
            ->whereDoesntHave('exchangeRequest')
            ->get();

        $orphanedWallets->each(function (ExchangeWallet $wallet) use (&$releasedWallets) {
            $wallet->forceFill([
                'allocation_status' => 'available',
                'exchange_request_id' => null,
                'reserved_at' => null,
            ])->save();

            $releasedWallets++;
        });

        return [
            'expired_exchange_count' => $expiredExchangeIds->count(),
            'released_wallet_count' => $releasedWallets,
            'released_exchange_ids' => $releaseExchangeIds->all(),
        ];
    }
}
