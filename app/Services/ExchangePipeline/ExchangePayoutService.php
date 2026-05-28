<?php

namespace App\Services\ExchangePipeline;

use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use RuntimeException;

class ExchangePayoutService
{
    public function canAutoPayout(ExchangeRequest $exchange): bool
    {
        return $exchange->isAmlApproved()
            && filled($exchange->destination_wallet)
            && (bool) optional($this->resolvePayoutMethod($exchange))->is_automatic;
    }

    public function isAsyncPayout(ExchangeRequest $exchange): bool
    {
        return $this->resolvePayoutMethod($exchange)->code === 'treasury_queue';
    }

    public function sendExchangePayout(ExchangeRequest $exchange): bool
    {
        if (!$exchange->isAmlApproved()) {
            throw new RuntimeException('Exchange payout is blocked until AML review is approved.');
        }

        $walletScreening = app(ExchangeAmlService::class)->screenWalletAddress(
            (string) $exchange->destination_wallet,
            (string) optional($exchange->getCurrency)->code,
            [
                'screenable' => $exchange,
                'direction' => 'destination',
                'amount' => (float) $exchange->final_amount,
            ]
        );

        if (($walletScreening['status'] ?? 'pending') !== 'approved') {
            $exchange->execution_route = 'manual_review';
            $exchange->execution_notes = $walletScreening['notes'] ?? 'Destination wallet failed AML screening.';
            $exchange->routed_at = now();
            $exchange->save();

            throw new RuntimeException($walletScreening['notes'] ?? 'Destination wallet failed AML screening.');
        }

        $method = $this->resolvePayoutMethod($exchange);
        $serviceClass = 'Facades\\App\\Services\\CryptoMethod\\' . $method->code . '\\Service';

        return (bool)$serviceClass::withdrawCrypto(
            $exchange,
            (float)$exchange->final_amount,
            optional($exchange->getCurrency)->code,
            (string)$exchange->destination_wallet,
            'exchange'
        );
    }

    public function resolvePayoutMethod(ExchangeRequest $exchange): CryptoMethod
    {
        $exchange->loadMissing('cryptoMethod');

        $configuredProvider = (string)($exchange->payout_provider ?: config('exchange_pipeline.payout_provider', 'treasury_queue'));

        if ($configuredProvider === 'treasury_queue') {
            $method = new CryptoMethod([
                'code' => 'treasury_queue',
                'name' => 'Treasury Queue',
                'is_automatic' => 1,
            ]);
        } elseif ($configuredProvider === 'custodial') {
            $method = CryptoMethod::where('code', 'custodial')->first();
            if (!$method) {
                $method = new CryptoMethod([
                    'code' => 'custodial',
                    'name' => 'Custodial HD Wallets',
                    'is_automatic' => 1,
                ]);
            }
        } elseif ($configuredProvider === 'active_crypto_method') {
            $method = $exchange->cryptoMethod ?: CryptoMethod::where('status', 1)->first();
        } else {
            $method = CryptoMethod::where('code', $configuredProvider)->first();
        }

        if (!$method) {
            throw new RuntimeException("Exchange payout provider [{$configuredProvider}] is not configured.");
        }

        return $method;
    }
}
