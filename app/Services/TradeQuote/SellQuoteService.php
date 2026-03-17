<?php

namespace App\Services\TradeQuote;

use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Traits\CalculateFees;
use RuntimeException;

class SellQuoteService
{
    use CalculateFees;

    public function build(CryptoCurrency $sendCurrency, FiatCurrency $getCurrency, float $sendAmount): array
    {
        if ($sendAmount <= 0) {
            throw new RuntimeException('Send amount must be greater than zero.');
        }

        $exchangeRate = (float) $sendCurrency->usd_rate / (float) $getCurrency->usd_rate;
        $getAmount = $sendAmount * $exchangeRate;
        $fees = $this->getFiatFees($getAmount, $getCurrency);
        $processingFee = (float) $fees['processingFees'];
        $finalAmount = $getAmount - $processingFee;

        if ($finalAmount <= 0) {
            throw new RuntimeException('Amount is too small after fees.');
        }

        return [
            'send_currency_id' => (int) $sendCurrency->id,
            'get_currency_id' => (int) $getCurrency->id,
            'send_amount' => $sendAmount,
            'get_amount' => $getAmount,
            'exchange_rate' => $exchangeRate,
            'processing_fee' => $processingFee,
            'final_amount' => $finalAmount,
            'processing_fee_type' => $getCurrency->processing_fee_type,
            'send_currency_code' => $sendCurrency->code,
            'get_currency_code' => $getCurrency->code,
            'rate_source' => 'auto_sync',
        ];
    }
}
