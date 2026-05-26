<?php

namespace App\Services\ExchangePipeline;

use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use RuntimeException;

class ExchangePayoutService
{
    public function canAutoPayout(ExchangeRequest $exchange): bool
    {
        return filled($exchange->destination_wallet) && (bool)optional($this->resolvePayoutMethod($exchange))->is_automatic;
    }

    public function isAsyncPayout(ExchangeRequest $exchange): bool
    {
        return $this->resolvePayoutMethod($exchange)->code === 'treasury_queue';
    }

    public function sendExchangePayout(ExchangeRequest $exchange): bool
    {
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

        $configuredProvider = (string)($exchange->payout_provider ?: config('exchange_pipeline.payout_provider', 'active_crypto_method'));

        if ($configuredProvider === 'treasury_queue') {
            $method = new CryptoMethod([
                'code' => 'treasury_queue',
                'name' => 'Treasury Queue',
                'is_automatic' => 1,
            ]);
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
