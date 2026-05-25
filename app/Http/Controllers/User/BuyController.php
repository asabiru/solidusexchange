<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\BuyStoreRequest;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Models\Gateway;
use App\Services\Aml\AmlScreeningService;
use App\Services\Compliance\ConsentService;
use App\Services\Compliance\DealProofService;
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
        $sendCurrencies = FiatCurrency::query()->active()->visibleInBuy()->sorted()->get();
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
        $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($request->exchangeSendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
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
                return back()->withInput()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
            }

            if ($sendCurrency->max_send < $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
            }

            if (!$request->destination_wallet) {
                return back()->withInput()->with('error', 'Destination wallet address is required');
            }

            try {
                $quote = $this->buyQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
            } catch (RuntimeException $exception) {
                return back()->withInput()->with('error', $exception->getMessage());
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
            $buyRequest->sub_status = 'payment_instruction_pending';
            $buyRequest->destination_wallet = $request->destination_wallet;
            $buyRequest->source_channel = app(ConsentService::class)->sourceChannel($request);
            $buyRequest->source_metadata = $this->sourceMetadata($request);
            $buyRequest->fulfillment_method = $this->resolveBuyFulfillmentMethod($request);
            $buyRequest->processing_deadline = now()->addMinutes((int) basicControl()->fiat_send_time ?: 30);
            $buyRequest->save();

            app(ConsentService::class)->record($request, $buyRequest, 'trade_terms');
            app(AmlScreeningService::class)->screen($buyRequest, ['flow' => 'buy', 'fulfillment_method' => $buyRequest->fulfillment_method]);
            app(DealProofService::class)->storeFromRequest($request, $buyRequest);

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
            return response()->json(['status' => false, 'message' => 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code], 422);
        }

        if ($sendCurrency->max_send < $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code], 422);
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

    private function resolveBuyFulfillmentMethod(Request $request): string
    {
        $method = (string) $request->input('fulfillment_method', '');
        return in_array($method, ['sbp_qr_auto', 'bank_transfer_manual', 'p2p_best_rate'], true)
            ? $method
            : 'bank_transfer_manual';
    }

    private function sourceMetadata(Request $request): array
    {
        return array_filter([
            'telegram_init_data_present' => $request->filled('telegram_init_data') || $request->headers->has('X-Telegram-Init-Data'),
            'user_agent' => $request->userAgent(),
        ], fn($value) => $value !== null);
    }

    private function resolveBuyGatewayQuery(?FiatCurrency $currency)
    {
        $query = Gateway::query()->where('status', 1);

        if ($currency && $currency->buy_gateway_id) {
            return $query->where('id', $currency->buy_gateway_id);
        }

        return $query;
    }

}
