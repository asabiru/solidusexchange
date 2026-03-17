<?php

namespace App\Services\CryptoMethod\manual;


class Service
{
    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        try {
            $address = $activeMethod->parameters->{$cryptoCode};
            if ($address) {
                if (!empty($context['structured_response'])) {
                    return [
                        'address' => $address,
                        'provider_reference' => $address,
                        'provider_network' => $cryptoCode,
                    ];
                }
                return $address;
            }
            return null;
        } catch (\Exception $e) {
            return null;
        }
    }
}

