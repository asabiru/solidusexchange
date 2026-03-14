<?php

namespace App\Services\CryptoMethod\coin_payment;


use App\Library\CoinPaymentHosted;
use App\Models\CryptoMethod;
use App\Traits\CryptoWalletGenerate;

class Service
{
    use CryptoWalletGenerate;

    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        $cps = new CoinPaymentHosted();
        $cps->Setup($activeMethod->parameters->private_key, $activeMethod->parameters->public_key);
        $callbackUrl = route('depositCallback', [$activeMethod->code, $type]);
        $result = $cps->GetCallbackAddress($cryptoCode, $callbackUrl);
        if ($result['error'] == 'ok') {
            return $result['result']['address'];
        }

        return null;
    }

    public function webhookUpdate($request, $object, $cryptoMethod, $type)
    {
        if (!$object) {
            return "ok";
        }

        if ($cryptoMethod->parameters->mercent_id == $request->merchant) {
            $sendAmount = $request->amount ?? $request['amount'];
            if ($sendAmount >= $object->send_amount) {
                $this->walletUpgration($object, $type, [
                    'deposit_amount' => $sendAmount,
                    'deposit_tx_id' => $request->txn_id ?? $request['txn_id'] ?? null,
                ]);
            }
        }

        return "ok";
    }

    public function withdrawCrypto($object, $amount, $currency, $address, $type)
    {
        $method = CryptoMethod::where('code', 'coin_payment')->firstOrFail();
        $cps = new CoinPaymentHosted();
        $cps->Setup($method->parameters->private_key, $method->parameters->public_key);
        $callbackUrl = route('depositCallback', [$method->code, $object->utr, $type]);
        $result = $cps->CreateWithdrawal($amount, $currency, $address, true, $callbackUrl);
        if ($result['error'] == 'ok') {
            return true;
        }
        return false;
    }

}

