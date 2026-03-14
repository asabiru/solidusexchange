<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\BuyStoreRequest;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Models\Gateway;
use App\Traits\CalculateFees;
use App\Traits\PaymentValidationCheck;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Stevebauman\Purify\Facades\Purify;

class BuyController extends Controller
{
    use CalculateFees, PaymentValidationCheck;

    public function __construct()
    {
        $this->theme = template();
    }

    public function getBuyCurrency()
    {
        $sendCurrencies = FiatCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();
        $getCurrencies = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();

        return response()->json([
            'sendCurrencies' => $sendCurrencies,
            'getCurrencies' => $getCurrencies,
            'selectedSendCurrency' => $sendCurrencies[0]??null,
            'selectedGetCurrency' => $getCurrencies[0]??null,
            'initialSendAmount' => isset($sendCurrencies[0]) ? (($sendCurrencies[0]->min_send + $sendCurrencies[0]->max_send) / 2) : 1,
        ]);
    }

    public function buyRequest(BuyStoreRequest $request)
    {
        $sendCurrency = FiatCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        $sendAmount = $request->exchangeSendAmount;
        $exchangeRate = $sendCurrency->usd_rate / $getCurrency->usd_rate;
        $getAmount = $sendAmount * $exchangeRate;
        $service_fee = $this->getCryptoFees($getAmount, $getCurrency)['serviceFees'];
        $network_fee = $this->getCryptoFees($getAmount, $getCurrency)['networkFees'];
        $finalAmount = $getAmount - ($service_fee + $network_fee);

        $buyRequest = BuyRequest::create([
            'user_id' => auth()->id() ?? null,
            'send_currency_id' => $sendCurrency->id,
            'get_currency_id' => $getCurrency->id,
            'send_amount' => $sendAmount,
            'get_amount' => $getAmount,
            'exchange_rate' => $exchangeRate,
            'service_fee' => $service_fee,
            'network_fee' => $network_fee,
            'final_amount' => $finalAmount,
            'utr' => uniqid('B'),
        ]);

        return redirect()->route('buyProcessing', $buyRequest->utr);
    }

    public function buyProcessing(BuyStoreRequest $request, $utr)
    {
        $buyRequest = BuyRequest::where(['status' => 0, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {
            return view($this->theme . 'user.buy.processing', compact('buyRequest'));
        } elseif ($request->method() == 'POST') {

            $sendCurrency = FiatCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
            $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

            if ($sendCurrency->min_send > $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
            }

            if ($sendCurrency->max_send < $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
            }

            if (!$request->destination_wallet) {
                return back()->withInput()->with('error', 'Destination wallet address is required');
            }

            $sendAmount = $request->exchangeSendAmount;
            $exchangeRate = $sendCurrency->usd_rate / $getCurrency->usd_rate;
            $getAmount = $sendAmount * $exchangeRate;
            $service_fee = $this->getCryptoFees($getAmount, $getCurrency)['serviceFees'];
            $network_fee = $this->getCryptoFees($getAmount, $getCurrency)['networkFees'];
            $finalAmount = $getAmount - ($service_fee + $network_fee);

            $buyRequest->send_currency_id = $sendCurrency->id;
            $buyRequest->get_currency_id = $getCurrency->id;
            $buyRequest->send_amount = $sendAmount;
            $buyRequest->get_amount = $getAmount;
            $buyRequest->exchange_rate = $exchangeRate;
            $buyRequest->service_fee = $service_fee;
            $buyRequest->network_fee = $network_fee;
            $buyRequest->final_amount = $finalAmount;
            $buyRequest->status = 1;
            $buyRequest->destination_wallet = $request->destination_wallet;
            $buyRequest->save();

            return redirect()->route('buyProcessingOverview', $buyRequest->utr);
        }
    }

    public function buyProcessingOverview($utr)
    {
        $buyRequest = BuyRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        return view($this->theme . 'user.buy.processing-overview', compact('buyRequest'));
    }

    public function buyInitPayment(Request $request, $utr)
    {
        $buyRequest = BuyRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {

            if (!$buyRequest->expire_time) {
                $buyRequest->expire_time = Carbon::now()->addMinutes(basicControl()->fiat_send_time);
                $buyRequest->save();
            }

            $data['gateways'] = Gateway::where('status', 1)->orderBy('sort_by', 'ASC')->get();
            return view($this->theme . 'user.buy.init-payment', $data, compact('buyRequest'));
        } elseif ($request->method() == 'POST') {
            if ($buyRequest->expire_time < Carbon::now()) {
                return redirect('/')->with('error', 'Payment time expired');
            }
            $purifiedData = $request->all();
            $validator = Validator::make($purifiedData, [
                'payment_method' => 'required|numeric|min:1',
                'supported_currency' => 'required',
            ]);

            if ($validator->fails()) {
                return back()->withErrors($validator)->withInput();
            }
            $purifiedData = (object)$purifiedData;
            $amount = $buyRequest->send_amount * optional($buyRequest->sendCurrency)->rate;
            $methodId = $purifiedData->payment_method;
            $currency = $purifiedData->supported_currency;

            $checkAmountValidate = $this->validationCheck($amount, $methodId, $currency);
            if ($checkAmountValidate['status'] == 'error') {
                return back()->with('error', $checkAmountValidate['msg']);
            }

            $method = Gateway::where('status', 1)->findOrFail($methodId);
            $deposit = $this->makeDeposit($checkAmountValidate, $amount, BuyRequest::class, $buyRequest->id);
            $buyRequest->gateway_id = $method->id;
            $buyRequest->save();

            return redirect(route('payment.process', $deposit->trx_id));
        }
    }

    public function buyFinal($utr)
    {
        $buyRequest = BuyRequest::where('utr', $utr)->where(function ($qq) {
            $qq->where(function ($query) {
                $query->where('gateway_id', '<', 999)
                    ->where('status', 2);
            })->orWhere(function ($query) {
                $query->where('gateway_id', '>=', 999)
                    ->whereIn('status', [1, 2]);
            });
        })->firstOrFail();

        return view($this->theme . 'user.buy.final', compact('buyRequest'));
    }

    public function buyAutoRate(Request $request)
    {
        $sendCurrencies = FiatCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();
        $getCurrencies = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();

        return response()->json([
            'sendCurrencies' => $sendCurrencies,
            'getCurrencies' => $getCurrencies,
            'initialSendAmount' => $request->sendAmount,
        ]);
    }

    public function buyGetStatus($utr)
    {
        $buyRequest = BuyRequest::select(['id', 'utr', 'status', 'exchange_rate', 'gateway_id'])->where('utr', $utr)->first();
        $redirect = false;
        $route = route('buyFinal', $buyRequest->utr);
        if ($buyRequest->gateway_id > 999 && $buyRequest->deposit->status == 3) {
            $redirect = true;
            $route = url('/');
        }

        if ($buyRequest && $buyRequest->status == 1 && !$buyRequest->deposit) {
            if (Carbon::now() > $buyRequest->expire_time) {
                $buyRequest->status = 4;
                $buyRequest->save();
                $route = url('/');
            }
        }

        return response()->json([
            'redirect' => $redirect,
            'buyRequest' => $buyRequest ?? null,
            'route' => $route
        ]);
    }

}
