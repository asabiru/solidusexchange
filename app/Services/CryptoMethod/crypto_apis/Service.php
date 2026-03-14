<?php

namespace App\Services\CryptoMethod\crypto_apis;


use App\Library\CryptoAPIs;
use App\Models\CryptoCurrency;
use App\Traits\CryptoWalletGenerate;

class Service
{
    use CryptoWalletGenerate;

    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        $cp = new CryptoAPIs();
        $cp->Setup($activeMethod->parameters->api_key, $activeMethod->parameters->wallet_id, 'testnet');
        $crypto = CryptoCurrency::where('code', $cryptoCode)->first();
        $callbackUrl = route('depositCallback', [$activeMethod->code, $type]);
        if ($crypto) {
            $result = $cp->GetAddress($crypto->name, $callbackUrl);
            if (($result['status'] ?? null) == 'success') {
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
}

