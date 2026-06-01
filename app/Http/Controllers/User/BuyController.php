<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\BuyStoreRequest;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Models\Gateway;
use App\Services\TradeQuote\BuyQuoteService;
use App\Traits\CalculateFees;
use App\Traits\PaymentValidationCheck;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Stevebauman\Purify\Facades\Purify;
use RuntimeException;

class BuyController extends Controller
{
    use CalculateFees, PaymentValidationCheck;

    public function __construct(private readonly BuyQuoteService $buyQuoteService)
    {
        $this->theme = template();
    }

    public function getBuyCurrency()
    {
        $fiatCurrencies = FiatCurrency::query()->active()->visibleInBuy()->sorted()->get()
            ->load(['buyGateways.gateway']);

        $sendCurrencies = [];
        foreach ($fiatCurrencies as $currency) {
            $gateways = $currency->buyGateways;
            if ($gateways->isEmpty()) {
                $sendCurrencies[] = [
                    'id' => $currency->id,
                    'code' => $currency->code,
                    'name' => $currency->name,
                    'image' => $currency->image,
                    'image_path' => $currency->image_path,
                    'min_send' => $currency->min_send,
                    'max_send' => $currency->max_send,
                ];
            } else {
                foreach ($gateways as $gw) {
                    $gateway = $gw->gateway;
                    $sendCurrencies[] = [
                        'id' => $currency->id,
                        'gateway_id' => $gateway?->id ?? $gw->gateway_id,
                        'code' => $currency->code,
                        'name' => ($gateway?->name ?? 'Unknown') . ' — ' . $currency->name,
                        'image' => $gateway?->image ?? $currency->image,
                        'image_path' => $gateway?->image_path ?? $currency->image_path,
                        'min_send' => $currency->min_send,
                        'max_send' => $currency->max_send,
                    ];
                }
            }
        }
        $getCurrencies = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();

        return response()->json([
            'sendCurrencies' => $sendCurrencies,
            'getCurrencies' => $getCurrencies,
            'selectedSendCurrency' => $sendCurrencies[0]??null,
            'selectedGetCurrency' => $getCurrencies[0]??null,
            'initialSendAmount' => isset($sendCurrencies[0]) ? (($sendCurrencies[0]['min_send'] + $sendCurrencies[0]['max_send']) / 2) : 1,
        ]);
    }

    public function publicBuyRequest(BuyStoreRequest $request)
    {
        // If user is authenticated, use the normal buyRequest
        if (auth()->check()) {
            return $this->buyRequest($request);
        }

        // For non-authenticated users, create request and redirect to login
        $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($request->exchangeSendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Минимум: ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Максимум: ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        try {
            $quote = $this->buyQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
        } catch (RuntimeException $exception) {
            return back()->withInput()->with('error', $exception->getMessage());
        }

        $buyRequest = BuyRequest::create([
            'user_id' => null,
            'send_currency_id' => $quote['send_currency_id'],
            'get_currency_id' => $quote['get_currency_id'],
            'send_amount' => $quote['send_amount'],
            'get_amount' => $quote['get_amount'],
            'exchange_rate' => $quote['exchange_rate'],
            'service_fee' => $quote['service_fee'],
            'network_fee' => $quote['network_fee'],
            'final_amount' => $quote['final_amount'],
            'utr' => uniqid('B'),
            'gateway_id' => $request->payment_method ?? null,
        ]);

        // Store request data in session and redirect to login
        session(['pending_buy_utr' => $buyRequest->utr]);
        return redirect()->route('login')->with('info', 'Пожалуйста, войдите для продолжения покупки');
    }

    public function buyRequest(BuyStoreRequest $request)
    {
        $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($request->exchangeSendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Минимум: ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Максимум: ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        try {
            $quote = $this->buyQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
        } catch (RuntimeException $exception) {
            return back()->withInput()->with('error', $exception->getMessage());
        }

        $buyRequest = BuyRequest::create([
            'user_id' => auth()->id() ?? null,
            'send_currency_id' => $quote['send_currency_id'],
            'get_currency_id' => $quote['get_currency_id'],
            'send_amount' => $quote['send_amount'],
            'get_amount' => $quote['get_amount'],
            'exchange_rate' => $quote['exchange_rate'],
            'service_fee' => $quote['service_fee'],
            'network_fee' => $quote['network_fee'],
            'final_amount' => $quote['final_amount'],
            'utr' => uniqid('B'),
            'gateway_id' => $request->payment_method ?? null,
        ]);

        return redirect()->route('buyProcessing', $buyRequest->utr);
    }

    public function buyProcessing(BuyStoreRequest $request, $utr)
    {
        $buyRequest = BuyRequest::where(['status' => 0, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {
            return view($this->theme . 'user.buy.processing', compact('buyRequest'));
        } elseif ($request->method() == 'POST') {

            $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($request->exchangeSendCurrency);
            $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

            if ($sendCurrency->min_send > $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Минимум: ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
            }

            if ($sendCurrency->max_send < $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Максимум: ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
            }

            if (!$request->destination_wallet) {
                return back()->withInput()->with('error', 'Требуется адрес кошелька назначения');
            }

            try {
                $quote = $this->buyQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
            } catch (RuntimeException $exception) {
                return back()->withInput()->with('error', $exception->getMessage());
            }

            $walletScreening = app(\App\Services\ExchangePipeline\ExchangeAmlService::class)->screenWalletAddress(
                (string) $request->destination_wallet,
                (string) $getCurrency->code,
                [
                    'screenable' => $buyRequest,
                    'direction' => 'destination',
                    'amount' => (float) ($quote['final_amount'] ?? 0),
                ]
            );

            if (($walletScreening['status'] ?? 'pending') === 'rejected') {
                return back()->withInput()->with('error', $walletScreening['notes'] ?? 'Destination wallet failed AML screening. Please use another address or contact support.');
            }

            $buyRequest->send_currency_id = $quote['send_currency_id'];
            $buyRequest->get_currency_id = $quote['get_currency_id'];
            $buyRequest->send_amount = $quote['send_amount'];
            $buyRequest->get_amount = $quote['get_amount'];
            $buyRequest->exchange_rate = $quote['exchange_rate'];
            $buyRequest->service_fee = $quote['service_fee'];
            $buyRequest->network_fee = $quote['network_fee'];
            $buyRequest->final_amount = $quote['final_amount'];
            $buyRequest->status = 1;
            $buyRequest->destination_wallet = $request->destination_wallet;
            $buyRequest->save();

            if (($walletScreening['status'] ?? null) === 'pending') {
                session()->flash('warning', $walletScreening['notes'] ?? 'Destination wallet requires manual AML review before payout.');
            }

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

            $data['gateways'] = $this->resolveBuyGatewayQuery($buyRequest->sendCurrency)
                ->orderBy('sort_by', 'ASC')
                ->orderBy('name', 'ASC')
                ->get();
            return view($this->theme . 'user.buy.init-payment', $data, compact('buyRequest'));
        } elseif ($request->method() == 'POST') {
            if ($buyRequest->expire_time < Carbon::now()) {
                return redirect('/')->with('error', 'Время оплаты истекло');
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

            $method = $this->resolveBuyGateway($buyRequest->sendCurrency, (int) $methodId);
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
        $request->validate([
            'sendAmount' => 'required|numeric|min:0.01',
            'sendCurrency' => 'required|integer',
            'getCurrency' => 'required|integer',
        ]);

        $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($request->sendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->getCurrency);
        $sendAmount = (float) $request->sendAmount;

        if ($sendCurrency->min_send > $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Минимум: ' . $sendCurrency->min_send . ' ' . $sendCurrency->code], 422);
        }

        if ($sendCurrency->max_send < $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Максимум: ' . $sendCurrency->max_send . ' ' . $sendCurrency->code], 422);
        }

        try {
            $quote = $this->buyQuoteService->build($sendCurrency, $getCurrency, $sendAmount);
        } catch (RuntimeException $exception) {
            return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'status' => true,
            'quote' => $this->formatQuoteResponse($quote),
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

    protected function formatQuoteResponse(array $quote): array
    {
        return [
            'sendAmount' => round((float) $quote['send_amount'], 8),
            'getAmount' => round((float) $quote['get_amount'], 8),
            'exchangeRate' => round((float) $quote['exchange_rate'], 8),
            'serviceFee' => round((float) $quote['service_fee'], 8),
            'networkFee' => round((float) $quote['network_fee'], 8),
            'finalAmount' => round((float) $quote['final_amount'], 8),
            'serviceFeeType' => $quote['service_fee_type'],
            'networkFeeType' => $quote['network_fee_type'],
            'sendCurrencyCode' => $quote['send_currency_code'],
            'getCurrencyCode' => $quote['get_currency_code'],
            'rateSource' => $quote['rate_source'],
        ];
    }

    private function resolveBuyGateway(FiatCurrency $currency, int $gatewayId): Gateway
    {
        return $this->resolveBuyGatewayQuery($currency)->findOrFail($gatewayId);
    }

    private function resolveBuyGatewayQuery(?FiatCurrency $currency)
    {
        $query = Gateway::query()->where('status', 1);

        if ($currency) {
            $buyGatewayIds = $currency->buyGateways()->pluck('gateway_id')->filter()->toArray();
            if (!empty($buyGatewayIds)) {
                return $query->whereIn('id', $buyGatewayIds);
            }

            if ($currency->buy_gateway_id) {
                return $query->where('id', $currency->buy_gateway_id);
            }
        }

        return $query;
    }

}
