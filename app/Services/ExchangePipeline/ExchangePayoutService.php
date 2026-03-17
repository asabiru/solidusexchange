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

    public function sendExchangeRefund(ExchangeRequest $exchange): bool
    {
        $method = $this->resolvePayoutMethod($exchange);
        $serviceClass = 'Facades\\App\\Services\\CryptoMethod\\' . $method->code . '\\Service';

        return (bool)$serviceClass::withdrawCrypto(
            $exchange,
            (float)$exchange->send_amount,
            optional($exchange->sendCurrency)->code,
            (string)$exchange->refund_wallet,
            'refund'
        );
    }

    public function resolvePayoutMethod(ExchangeRequest $exchange): CryptoMethod
    {
        $exchange->loadMissing('cryptoMethod');

        $configuredProvider = (string)($exchange->payout_provider ?: config('exchange_pipeline.payout_provider', 'active_crypto_method'));

        if ($configuredProvider === 'active_crypto_method') {
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
