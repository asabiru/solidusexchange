<?php

namespace App\Services\ExchangePipeline;

use App\Models\ExchangeRequest;
use App\Models\ExchangeWallet;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class ExchangeWalletInventoryService
{
    public function reserveWallet(string $currencyCode, ExchangeRequest $exchange): ExchangeWallet
    {
        $existingWallet = ExchangeWallet::where('exchange_request_id', $exchange->id)->first();
        if ($existingWallet) {
            return $existingWallet;
        }

        return DB::transaction(function () use ($currencyCode, $exchange) {
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
}
