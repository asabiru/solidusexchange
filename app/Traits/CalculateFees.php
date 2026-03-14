<?php

namespace App\Traits;


trait CalculateFees
{
    public function getCryptoFees($amount, $currency)
    {
        if ($currency->service_fee_type == 'percent') {
            $serviceFees = ($amount * $currency->service_fee) / 100;
        } else {
            $serviceFees = $currency->service_fee;
        }

        if ($currency->network_fee_type == 'percent') {
            $networkFees = ($amount * $currency->network_fee) / 100;
        } else {
            $networkFees = $currency->network_fee;
        }

        return [
            'serviceFees' => $serviceFees,
            'networkFees' => $networkFees,
        ];
    }

    public function getFiatFees($amount, $currency)
    {
        if ($currency->processing_fee_type == 'percent') {
            $processingFees = ($amount * $currency->processing_fee) / 100;
        } else {
            $processingFees = $currency->processing_fee;
        }

        return [
            'processingFees' => $processingFees,
        ];
    }

}
