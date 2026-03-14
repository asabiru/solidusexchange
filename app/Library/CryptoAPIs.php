<?php

namespace App\Library;

class CryptoAPIs
{
    private $api_key = '';
    private $wallet_id = '';
    private $network = null;

    public function Setup($api_key, $wallet_id, $mode)
    {
        $this->api_key = $api_key;
        $this->wallet_id = $wallet_id;
        $this->network = $mode ?? 'mainnet';
    }

    public function GetAddress($cryptoName, $callback)
    {
        $cryptoName = strtolower($cryptoName);
        $url = "https://rest.cryptoapis.io/wallet-as-a-service/wallets/$this->wallet_id/$cryptoName/$this->network/addresses?context=crypto";
        $postParam = [
            'data' => [
                'item' => [
                    "label" => basicControl()->site_title,
                ]
            ]
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postParam));

        $headers = array();
        $headers[] = "Content-Type: application/json";
        $headers[] = "X-API-Key: $this->api_key";
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $result = curl_exec($ch);
        curl_close($ch);
        $res = json_decode($result);

        if (isset($res) && isset($res->data) && isset($res->data->item) && isset($res->data->item->address)) {
            $this->setWebhook($cryptoName, $res->data->item->address, $callback);
            return [
                'status' => 'success',
                'address' => $res->data->item->address
            ];
        }

        return [
            'status' => 'error',
            'msg' => @$res->error->message ?? 'Please contact with provider'
        ];
    }

    public function setWebhook($cryptoName, $address, $callback)
    {
        $cryptoName = strtolower($cryptoName);
        $url = "https://rest.cryptoapis.io/blockchain-events/$cryptoName/$this->network/subscriptions/address-coins-transactions-confirmed?context=yourExampleString";
        $postParam = [
            'data' => [
                'item' => [
                    "address" => $address,
                    "callbackUrl" => $callback,
                ]
            ]
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postParam));

        $headers = array();
        $headers[] = "Content-Type: application/json";
        $headers[] = "X-API-Key: $this->api_key";
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        $result = curl_exec($ch);
        curl_close($ch);
        $res = json_decode($result);

        return 'ok';
    }
}
