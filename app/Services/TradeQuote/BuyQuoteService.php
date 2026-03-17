<?php

namespace App\Services\TradeQuote;

use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Traits\CalculateFees;
use RuntimeException;

class BuyQuoteService
{
    use CalculateFees;

    public function build(FiatCurrency $sendCurrency, CryptoCurrency $getCurrency, float $sendAmount): array
    {
        if ($sendAmount <= 0) {
            throw new RuntimeException('Send amount must be greater than zero.');
        }

        $exchangeRate = (float) $sendCurrency->usd_rate / (float) $getCurrency->usd_rate;
        $getAmount = $sendAmount * $exchangeRate;
        $fees = $this->getCryptoFees($getAmount, $getCurrency);
        $serviceFee = (float) $fees['serviceFees'];
        $networkFee = (float) $fees['networkFees'];
        $finalAmount = $getAmount - ($serviceFee + $networkFee);

        if ($finalAmount <= 0) {
            throw new RuntimeException('Amount is too small after fees.');
        }

        return [
            'send_currency_id' => (int) $sendCurrency->id,
            'get_currency_id' => (int) $getCurrency->id,
            'send_amount' => $sendAmount,
            'get_amount' => $getAmount,
            'exchange_rate' => $exchangeRate,
            'service_fee' => $serviceFee,
            'network_fee' => $networkFee,
            'final_amount' => $finalAmount,
            'service_fee_type' => $getCurrency->service_fee_type,
            'network_fee_type' => $getCurrency->network_fee_type,
            'send_currency_code' => $sendCurrency->code,
            'get_currency_code' => $getCurrency->code,
            'rate_source' => 'auto_sync',
        ];
    }
}
