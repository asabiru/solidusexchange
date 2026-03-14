<?php

namespace App\Traits;

use App\Models\Deposit;
use App\Models\Gateway;
use Mockery\Exception;

trait PaymentValidationCheck
{
    public function validationCheck($amount, $gateway, $currency)
    {

        try {
            $gateway = Gateway::where('id', $gateway)->where('status', 1)->first();

            if (!$gateway) {
                return [
                    'status' => 'error',
                    'msg' => 'Payment method not available for this transaction'
                ];
            }

            $selectedCurrency = array_search($currency, $gateway->supported_currency);
            if ($selectedCurrency !== false) {
                $selectedPayCurrency = $gateway->supported_currency[$selectedCurrency];
            } else {
                return [
                    'status' => 'error',
                    'msg' => "Please choose the currency you'd like to use for payment"
                ];
            }


            if ($gateway) {
                $receivableCurrencies = $gateway->receivable_currencies;
                if (is_array($receivableCurrencies)) {
                    if ($gateway->id < 999) {
                        $currencyInfo = collect($receivableCurrencies)->where('name', $selectedPayCurrency)->first();
                    } else {
                        $currencyInfo = collect($receivableCurrencies)->where('currency', $selectedPayCurrency)->first();
                    }
                } else {
                    return null;
                }
            }

            if (!$currencyInfo) {
                return [
                    'status' => 'error',
                    'msg' => "Please choose the currency you'd like to use for payment"
                ];
            }

            $paymentCurrencyAmount = $amount * $currencyInfo->conversion_rate;
            if ($paymentCurrencyAmount < $currencyInfo->min_limit || $paymentCurrencyAmount > $currencyInfo->max_limit) {
                return [
                    'status' => 'error',
                    'msg' => "minimum payment $currencyInfo->min_limit and maximum payment limit $currencyInfo->max_limit"
                ];
            }

            $currencyType = $gateway->currency_type;
            $limit = $currencyType == 0 ? 8 : 2;

            if ($currencyInfo) {
                $percentage = getAmount($currencyInfo->percentage_charge, $limit);
                $percentage_charge = getAmount(($paymentCurrencyAmount * $percentage) / 100, $limit);
                $fixed_charge = getAmount($currencyInfo->fixed_charge, $limit);
                $min_limit = getAmount($currencyInfo->min_limit, $limit);
                $max_limit = getAmount($currencyInfo->max_limit, $limit);
                $charge = getAmount($percentage_charge + $fixed_charge, $limit);
            }

            $basicControl = basicControl();
            $payable_amount_baseCurrency = getAmount($amount, $limit);
            $payable_amount = getAmount($paymentCurrencyAmount, $limit);

            $data['gateway_id'] = $gateway->id;
            $data['fixed_charge'] = $fixed_charge;
            $data['percentage'] = $percentage;
            $data['percentage_charge'] = $percentage_charge;
            $data['min_limit'] = $min_limit;
            $data['max_limit'] = $max_limit;
            $data['payable_amount'] = $payable_amount;
            $data['charge'] = $charge;
            $data['amount'] = $paymentCurrencyAmount;
            $data['conversion_rate'] = $currencyInfo->conversion_rate ?? 1;
            $data['payable_amount_baseCurrency'] = $payable_amount_baseCurrency;
            $data['currency'] = $currencyInfo->name ?? $currencyInfo->currency;
            $data['base_currency'] = $basicControl->base_currency;
            $data['currency_limit'] = $limit;

            return [
                'status' => 'success',
                'data' => $data
            ];
        } catch (Exception $e) {
            return [
                'status' => 'error',
                'msg' => $e->getMessage()
            ];
        }

    }

    public function makeDeposit($checkAmountValidate, $amount, $depositableType = null, $depositableId = null, $userId = null)
    {
        $deposit = Deposit::create([
            'user_id' => auth()->user()->id ?? $userId ?? null,
            'payment_method_id' => $checkAmountValidate['data']['gateway_id'],
            'payment_method_currency' => $checkAmountValidate['data']['currency'],
            'amount' => $amount,
            'percentage' => $checkAmountValidate['data']['percentage'],
            'charge_percentage' => $checkAmountValidate['data']['percentage_charge'],
            'charge_fixed' => $checkAmountValidate['data']['fixed_charge'],
            'charge' => $checkAmountValidate['data']['charge'],
            'payable_amount' => $checkAmountValidate['data']['payable_amount'],
            'payable_amount_base_currency' => $checkAmountValidate['data']['payable_amount_baseCurrency'],
            'trx_id' => strRandom(),
            'status' => 0,
            'depositable_type' => $depositableType,
            'depositable_id' => $depositableId,
        ]);

        return $deposit;
    }
}
