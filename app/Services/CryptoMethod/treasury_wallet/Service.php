<?php

namespace App\Services\CryptoMethod\treasury_wallet;

use App\Models\ExchangeRequest;
use App\Services\ExchangePipeline\ExchangeWalletInventoryService;
use RuntimeException;

class Service
{
    public function __construct(
        private readonly ExchangeWalletInventoryService $walletInventoryService,
    ) {
    }

    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        if ($type !== 'exchange') {
            throw new RuntimeException('Treasury wallet provider currently supports exchange deposits only.');
        }

        $exchangeId = $context['exchange_id'] ?? null;
        $exchange = $exchangeId ? ExchangeRequest::find($exchangeId) : null;

        if (!$exchange) {
            throw new RuntimeException('Exchange request is required to reserve a treasury wallet.');
        }

        $wallet = $this->walletInventoryService->reserveWallet($cryptoCode, $exchange);

        return [
            'address' => $wallet->address,
            'provider_reference' => (string)$wallet->id,
            'provider_network' => $wallet->network ?: $wallet->currency_code,
        ];
    }

    public function webhookUpdate($request, $object, $cryptoMethod, $type)
    {
        return 'ok';
    }

    public function withdrawCrypto($object, $amount, $currency, $address, $type)
    {
        return false;
    }
}
