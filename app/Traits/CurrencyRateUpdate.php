<?php

namespace App\Traits;


use Facades\App\Services\BasicCurl;

trait CurrencyRateUpdate
{
    public function cryptoRateUpdate($convert, $symbols)
    {
        if (basicControl()->coin_market_cap_app_key) {
            $url = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest';
            $parameters = [
                'symbol' => $symbols,
                'convert' => $convert
            ];

            $headers = [
                'Accepts: application/json',
                'X-CMC_PRO_API_KEY: ' . basicControl()->coin_market_cap_app_key
            ];
            $qs = http_build_query($parameters);
            $request = "{$url}?{$qs}";


            $curl = curl_init();

            curl_setopt_array($curl, array(
                CURLOPT_URL => $request,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => 1
            ));

            $response = curl_exec($curl);
            $result = json_decode($response);
            curl_close($curl);

            if (isset($result->status) && isset($result->data)) {
                return [
                    'status' => true,
                    'res' => $result->data,
                ];
            }

            return [
                'status' => false,
                'res' => $result->status->error_message ?? 'something went wrong',
            ];
        }

        return [
            'status' => false,
            'res' => 'Please set coinmarketcap api key',
        ];
    }

    public function fiatRateUpdate($source, $currencies)
    {
        if (basicControl()->currency_layer_access_key) {
            $endpoint = 'live';
            $currency_layer_url = "http://api.currencylayer.com";
            $currency_layer_access_key = basicControl()->currency_layer_access_key;

            $baseCurrencyAPIUrl = "$currency_layer_url/$endpoint?access_key=$currency_layer_access_key&source=$source&currencies=$currencies";
            $baseCurrencyConvert = BasicCurl::curlGetRequest($baseCurrencyAPIUrl);
            $result = json_decode($baseCurrencyConvert);

            if (isset($result->success) && isset($result->quotes)) {
                return [
                    'status' => true,
                    'res' => $result->quotes,
                ];
            }

            return [
                'status' => false,
                'res' => 'something went wrong',
            ];
        }
        return [
            'status' => false,
            'res' => 'Please set currencylayer api key',
        ];
    }
}
