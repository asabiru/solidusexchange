<?php

namespace App\Services\CryptoMethod\crypto_apis;


use App\Library\CryptoAPIs;
use App\Models\CryptoCurrency;
use RuntimeException;
use App\Traits\CryptoWalletGenerate;

class Service
{
    use CryptoWalletGenerate;

    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        $cp = new CryptoAPIs();
        $cp->Setup(
            $activeMethod->parameters->api_key,
            $activeMethod->parameters->wallet_id,
            $this->resolveMode($activeMethod)
        );
        $crypto = CryptoCurrency::where('code', $cryptoCode)->first();
        $callbackUrl = route('depositCallback', [$activeMethod->code, $type]);
        if ($crypto) {
            $result = $cp->GetAddress($crypto->name, $callbackUrl);
            if (($result['status'] ?? null) == 'success') {
                if (($context['structured_response'] ?? false) === true) {
                    return [
                        'address' => $result['address'],
                        'provider_reference' => $result['address'],
                    ];
                }

                return $result['address'];
            }
        }
        return null;
    }

    public function webhookUpdate($request, $object, $cryptoMethod, $type)
    {
        if (!$object) {
            return "200 OK";
        }

        if (isset($request->data['event']) && $request->data['event'] == 'ADDRESS_COINS_TRANSACTION_CONFIRMED') {
            $sendAmount = $request->data['item']['amount'];
            if ($sendAmount >= $object->send_amount) {
                $this->walletUpgration($object, $type, [
                    'deposit_amount' => $sendAmount,
                    'deposit_tx_id' => $request->data['item']['transactionId'] ?? null,
                ]);
            }
        }

        return "200 OK";
    }

    public function withdrawCrypto($object, $amount, $currency, $address, $type)
    {
        return false;
    }

    public function subscribeAddressWebhook($activeMethod, string $cryptoCode, string $address, string $type = 'exchange'): array
    {
        $crypto = CryptoCurrency::where('code', strtoupper(trim($cryptoCode)))->first();
        if (!$crypto) {
            throw new RuntimeException("CryptoAPIs currency [{$cryptoCode}] is not configured.");
        }

        $cp = new CryptoAPIs();
        $cp->Setup(
            $activeMethod->parameters->api_key,
            $activeMethod->parameters->wallet_id,
            $this->resolveMode($activeMethod)
        );

        $callbackUrl = route('depositCallback', [$activeMethod->code, $type]);
        $result = $cp->subscribeAddress($crypto->name, $address, $callbackUrl);

        if (($result['status'] ?? null) !== 'success') {
            throw new RuntimeException($result['msg'] ?? 'Unable to subscribe wallet to CryptoAPIs webhook.');
        }

        return $result;
    }

    private function resolveMode($activeMethod): string
    {
        $mode = strtolower((string)($activeMethod->parameters->network ?? $activeMethod->parameters->mode ?? 'mainnet'));

        if ($mode === 'testnet' || $mode === 'sandbox') {
            return 'testnet';
        }

        if (isset($activeMethod->parameters->testnet)) {
            $testnet = filter_var($activeMethod->parameters->testnet, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($testnet === true) {
                return 'testnet';
            }
        }

        return 'mainnet';
    }
}

