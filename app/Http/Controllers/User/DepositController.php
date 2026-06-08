<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Models\Deposit;
use App\Models\Fund;
use App\Models\Gateway;
use Illuminate\Http\Request;
use App\Traits\PaymentValidationCheck;
use Illuminate\Support\Facades\Auth;

class DepositController extends Controller
{

    use PaymentValidationCheck;

    public function supportedCurrency(Request $request)
    {
        $gateway = Gateway::where('id', $request->gateway)->firstOrFail();
        return $gateway->supported_currency;
    }

    public function checkAmount(Request $request)
    {
        if ($request->ajax()) {
            $amount = $request->amount;
            $selectedCurrency = $request->selected_currency;
            $selectGateway = $request->select_gateway;
            $data = $this->checkAmountValidate($amount, $selectedCurrency, $selectGateway);
            return response()->json($data);
        }
        return response()->json(['error' => 'Invalid request'], 400);
    }

    public function checkAmountValidate($amount, $selectedCurrency, $selectGateway)
    {

        $selectGateway = Gateway::where('id', $selectGateway)->where('status', 1)->first();
        if (!$selectGateway) {
            return ['status' => false, 'message' => "Payment method not available for this transaction"];
        }

        $selectedCurrency = array_search($selectedCurrency, $selectGateway->supported_currency);
        if ($selectedCurrency !== false) {
            $selectedPayCurrency = $selectGateway->supported_currency[$selectedCurrency];
        } else {
            return ['status' => false, 'message' => "Please choose the currency you'd like to use for payment"];
        }

        if ($selectGateway) {
            $receivableCurrencies = $selectGateway->receivable_currencies;
            if (is_array($receivableCurrencies)) {
                if ($selectGateway->id < 999) {
                    $currencyInfo = collect($receivableCurrencies)->where('name', $selectedPayCurrency)->first();
                } else {
                    $currencyInfo = collect($receivableCurrencies)->where('currency', $selectedPayCurrency)->first();
                }
            } else {
                return null;
            }
        }


        $currencyType = $selectGateway->currency_type;
        $limit = $currencyType == 0 ? 8 : 2;
        $amount = getAmount($amount, $limit);
        $status = false;

        $paymentCurrencyAmount = $amount * $currencyInfo->conversion_rate;
        if ($currencyInfo) {
            $percentage = getAmount($currencyInfo->percentage_charge, $limit);
            $percentage_charge = getAmount(($paymentCurrencyAmount * $percentage) / 100, $limit);
            $fixed_charge = getAmount($currencyInfo->fixed_charge, $limit);
            $min_limit = getAmount($currencyInfo->min_limit, $limit);
            $max_limit = getAmount($currencyInfo->max_limit, $limit);
            $charge = getAmount($percentage_charge + $fixed_charge, $limit);
        }

        $basicControl = basicControl();
        $payable_amount_baseCurrency =  getAmount($amount, $limit);
        $payable_amount = getAmount($paymentCurrencyAmount, $limit);

        if ($payable_amount < $min_limit || $payable_amount > $max_limit) {
            $message = "minimum payment $min_limit and maximum payment limit $max_limit";
        } else {
            $status = true;
            $message = "Amount : $amount" . " " . $basicControl->base_currency;
        }

        $data['status'] = $status;
        $data['message'] = $message;
        $data['gatewayName'] = $selectGateway->name;
        $data['fixed_charge'] = $fixed_charge;
        $data['percentage'] = $percentage;
        $data['percentage_charge'] = $percentage_charge;
        $data['min_limit'] = $min_limit;
        $data['max_limit'] = $max_limit;
        $data['payable_amount'] = $payable_amount;
        $data['charge'] = $charge;
        $data['amount'] = $amount;
        $data['conversion_rate'] = $currencyInfo->conversion_rate ?? 1;
        $data['payable_amount_baseCurrency'] = $payable_amount_baseCurrency;
        $data['currency'] = $currencyInfo->name ?? $currencyInfo->currency;
        $data['base_currency'] = $basicControl->base_currency;
        $data['currency_limit'] = $limit;

        return $data;
    }


    public function paymentRequest(Request $request)
    {
        $amount = $request->amount;
        $gateway = $request->gateway_id;
        $currency = $request->supported_currency;

        try {
            $checkAmountValidate = $this->validationCheck($amount, $gateway, $currency);


            if ($checkAmountValidate['status'] == 'error') {
                return back()->with('error', $checkAmountValidate['msg']);
            }

            $deposit = Deposit::create([
                'user_id' => Auth::user()->id,
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
                'depositable_type' => Fund::class,
            ]);

            return redirect(route('payment.process', $deposit->trx_id));

        } catch (\Exception $e) {
            return back()->with('error', $e->getMessage());
        }

    }


}
