<?php

namespace App\Services\CryptoMethod\manual;


class Service
{
    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = [])
    {
        try {
            $address = $activeMethod->parameters->{$cryptoCode};
            if ($address) {
                return $address;
            }
            return null;
        } catch (\Exception $e) {
            return null;
        }
    }
}

