<?php

namespace App\Services\ExchangePipeline;

use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use RuntimeException;

class ExchangeSettlementService
{
    public function prepareIncomingDeposit(ExchangeRequest $exchange): array
    {
        $exchange->loadMissing(['sendCurrency', 'cryptoMethod']);

        if (filled($exchange->admin_wallet)) {
            return [
                'address' => $exchange->admin_wallet,
                'provider' => $exchange->deposit_provider ?: optional($exchange->cryptoMethod)->code,
                'network' => $exchange->deposit_network,
            ];
        }

        [$providerCode, $cryptoMethod] = $this->resolveDepositProvider();

        $serviceClass = 'App\\Services\\CryptoMethod\\' . $providerCode . '\\Service';
        if (!class_exists($serviceClass)) {
            throw new RuntimeException("Exchange deposit provider [{$providerCode}] is not available.");
        }

        $payload = app($serviceClass)->prepareData($cryptoMethod, $exchange->sendCurrency->code, 'exchange', [
            'identifier' => $exchange->utr,
            'structured_response' => true,
            'exchange_id' => $exchange->id,
        ]);

        if (is_string($payload)) {
            $payload = ['address' => $payload];
        }

        $address = $payload['address'] ?? null;
        if (blank($address)) {
            throw new RuntimeException("Exchange deposit provider [{$providerCode}] did not return a wallet address.");
        }

        $exchange->admin_wallet = $address;
        $exchange->crypto_method_id = $exchange->crypto_method_id ?: $cryptoMethod->id;
        $exchange->deposit_provider = $providerCode;
        $exchange->deposit_provider_ref = $payload['provider_reference'] ?? null;
        $exchange->deposit_network = $payload['provider_network'] ?? null;
        $exchange->payout_provider = $exchange->payout_provider ?: $this->resolvePayoutProvider($providerCode);
        $exchange->save();

        return [
            'address' => $address,
            'provider' => $exchange->deposit_provider,
            'network' => $exchange->deposit_network,
        ];
    }

    private function resolveDepositProvider(): array
    {
        $configuredProvider = (string)config('exchange_pipeline.deposit_provider', 'active_crypto_method');

        if ($configuredProvider === 'active_crypto_method') {
            $cryptoMethod = CryptoMethod::where('status', 1)->first();
            if (!$cryptoMethod) {
                throw new RuntimeException('Active crypto method not found for exchange settlement.');
            }

            return [$cryptoMethod->code, $cryptoMethod];
        }

        $cryptoMethod = CryptoMethod::where('code', $configuredProvider)->first();
        if (!$cryptoMethod) {
            throw new RuntimeException("Configured exchange deposit provider [{$configuredProvider}] is missing.");
        }

        return [$configuredProvider, $cryptoMethod];
    }

    private function resolvePayoutProvider(string $depositProvider): string
    {
        $configuredProvider = (string)config('exchange_pipeline.payout_provider', 'active_crypto_method');

        if ($configuredProvider === 'active_crypto_method') {
            return $depositProvider;
        }

        return $configuredProvider;
    }
}
