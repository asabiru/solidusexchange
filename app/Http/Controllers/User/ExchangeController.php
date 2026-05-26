<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\ExchangeStoreRequest;
use App\Models\CryptoCurrency;
use App\Models\CryptoMethod;
use App\Models\ExchangeRequest;
use App\Services\ExchangeEngine\ExchangeQuoteService;
use App\Services\ExchangePipeline\ExchangeReservationService;
use App\Services\ExchangePipeline\ExchangeSettlementService;
use App\Traits\CalculateFees;
use App\Traits\CryptoWalletGenerate;
use App\Traits\SendNotification;
use Carbon\Carbon;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use RuntimeException;

class ExchangeController extends Controller
{
    use CryptoWalletGenerate, CalculateFees, SendNotification;

    public function __construct()
    {
        $this->theme = template();
    }

    public function getExchangeCurrency()
    {
        $queryClone = CryptoCurrency::query()->where('status', 1)->orderBy('sort_by', 'ASC')->get();
        $sendCurrencies = $queryClone;
        $getCurrencies = $queryClone;
        $secondObject = $getCurrencies->splice(1, 1);
        $getCurrencies = $getCurrencies->sortBy('sort_by');
        $getCurrencies = $secondObject->merge($getCurrencies);


        return response()->json([
            'sendCurrencies' => $sendCurrencies,
            'getCurrencies' => $getCurrencies,
            'selectedSendCurrency' => $sendCurrencies[0]??null,
            'selectedGetCurrency' => $getCurrencies[0]??null,
            'initialSendAmount' => isset($sendCurrencies[0]) ? (($sendCurrencies[0]->min_send + $sendCurrencies[0]->max_send) / 2) : 1,
        ]);
    }

    public function exchangeRequest(ExchangeStoreRequest $request)
    {
        $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);
        $sendAmount = (float)$request->exchangeSendAmount;

        if ($sendCurrency->min_send > $sendAmount) {
            return back()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $sendAmount) {
            return back()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        try {
            $quote = app(ExchangeQuoteService::class)->build($sendCurrency, $getCurrency, $sendAmount);
        } catch (RuntimeException $exception) {
            return back()->withInput()->with('error', $exception->getMessage());
        }

        $exchangeRequest = ExchangeRequest::create([
            'user_id' => auth()->id() ?? null,
            'status' => 0,
            'rate_type' => 'floating',
            'utr' => uniqid('E'),
        ]);

        app(ExchangeQuoteService::class)->applyToExchange($exchangeRequest, $quote, 'floating');

        return redirect()->route('exchangeProcessing', $exchangeRequest->utr);
    }

    public function exchangeProcessing(ExchangeStoreRequest $request, $utr)
    {
        $exchangeRequest = ExchangeRequest::where(['status' => 0, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {
            return view($this->theme . 'user.exchange.processing', compact('exchangeRequest'));
        } elseif ($request->method() == 'POST') {

            $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
            $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeGetCurrency);
            $sendAmount = (float)$request->exchangeSendAmount;
            $rateType = in_array($request->rate_type, ['floating', 'fixed'], true) ? $request->rate_type : 'floating';

            if ($sendCurrency->min_send > $sendAmount) {
                return back()->withInput()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
            }

            if ($sendCurrency->max_send < $sendAmount) {
                return back()->withInput()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
            }

            if (!$request->destination_wallet) {
                return back()->withInput()->with('error', 'Destination wallet address is required');
            }

            $quoteService = app(ExchangeQuoteService::class);

            try {
                $quote = $quoteService->canReuseStoredFixedQuote($exchangeRequest, $sendCurrency, $getCurrency, $sendAmount, $rateType)
                    ? $quoteService->exportStoredQuote($exchangeRequest)
                    : $quoteService->build($sendCurrency, $getCurrency, $sendAmount);
            } catch (RuntimeException $exception) {
                return back()->withInput()->with('error', $exception->getMessage());
            }

            $quoteService->applyToExchange($exchangeRequest, $quote, $rateType);
            $exchangeRequest->status = 1;
            $exchangeRequest->destination_wallet = $request->destination_wallet;
            $exchangeRequest->save();

            return redirect()->route('exchangeProcessingOverview', $exchangeRequest->utr);
        }
    }

    public function exchangeProcessingOverview($utr)
    {
        $exchangeRequest = ExchangeRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        return view($this->theme . 'user.exchange.processing-overview', compact('exchangeRequest'));
    }

    public function exchangeInitPayment(Request $request, $utr)
    {
        $exchangeRequest = ExchangeRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {

            if (!$exchangeRequest->admin_wallet) {
                try {
                    app(ExchangeSettlementService::class)->prepareIncomingDeposit($exchangeRequest);
                    $exchangeRequest = $exchangeRequest->fresh();
                } catch (RuntimeException $exception) {
                    return back()->with('error', 'Unable to generate an address. Please contact the administration for assistance.');
                }
            }

            if (!$exchangeRequest->expire_time) {
                $exchangeRequest->expire_time = Carbon::now()->addMinutes(basicControl()->crypto_send_time);
                $exchangeRequest->save();
            }

            $cryptoMethod = $exchangeRequest->cryptoMethod;

            if (!$cryptoMethod && blank($exchangeRequest->deposit_provider)) {
                $cryptoMethod = CryptoMethod::select(['id', 'code', 'status'])->where('status', 1)->firstOrFail();
            }

            if (!$exchangeRequest->crypto_method_id && $cryptoMethod && blank($exchangeRequest->deposit_provider)) {
                $exchangeRequest->crypto_method_id = $cryptoMethod->id;
                $exchangeRequest->save();
            }

            $data['isButtonShow'] = optional($cryptoMethod)->code == 'manual';
            return view($this->theme . 'user.exchange.init-payment', $data, compact('exchangeRequest'));
        } elseif ($request->method() == 'POST') {
            $exchangeRequest->status = 2;
            $exchangeRequest->save();

            $amount = getBaseAmount($exchangeRequest->send_amount, optional($exchangeRequest->sendCurrency)->code, 'crypto');
            $charge = getBaseAmount($exchangeRequest->service_fee + $exchangeRequest->network_fee, optional($exchangeRequest->getCurrency)->code, 'crypto');

            BasicService::makeTransaction($amount, $charge, '-', 'Manual Crypto Deposit For Exchange',
                $exchangeRequest->id, ExchangeRequest::class, $exchangeRequest->user_id, $exchangeRequest->send_amount, optional($exchangeRequest->sendCurrency)->code);

            $this->sendAdminNotification($exchangeRequest, 'exchange');
            return redirect()->route('exchangeFinal', $exchangeRequest->utr);
        }
    }

    public function exchangeFinal($utr)
    {
        $exchangeRequest = ExchangeRequest::where('utr', $utr)->firstOrFail();
        if (in_array((int)$exchangeRequest->status, [3, 5], true)) {
            return redirect()->route('tracking', ['trx_id' => $exchangeRequest->utr]);
        }

        abort_if((int)$exchangeRequest->status !== 2, 404);

        return view($this->theme . 'user.exchange.final', compact('exchangeRequest'));
    }

    public function exchangeAutoRate(Request $request)
    {
        $request->validate([
            'sendAmount' => 'required|numeric|min:0.00000001',
            'sendCurrency' => 'required|integer',
            'getCurrency' => 'required|integer',
        ]);

        $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->sendCurrency);
        $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->getCurrency);
        $sendAmount = (float)$request->sendAmount;

        if ($sendCurrency->min_send > $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code], 422);
        }

        if ($sendCurrency->max_send < $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code], 422);
        }

        try {
            $quote = app(ExchangeQuoteService::class)->build($sendCurrency, $getCurrency, $sendAmount);
        } catch (RuntimeException $exception) {
            return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'status' => true,
            'quote' => $this->formatQuoteResponse($quote),
        ]);
    }

    public function exchangeGetStatus($utr)
    {
        $exchangeRequest = ExchangeRequest::select(['id', 'utr', 'status', 'expire_time'])->where('utr', $utr)->first();
        $route = $exchangeRequest ? route('exchangeFinal', $exchangeRequest->utr) : url('/');
        if ($exchangeRequest && $exchangeRequest->status == 1) {
            if (Carbon::now() > $exchangeRequest->expire_time) {
                $exchangeRequest->status = 4;
                $exchangeRequest->save();
                app(ExchangeReservationService::class)->releaseForExchange($exchangeRequest);
                $route = url('/');
            }
        }

        if ($exchangeRequest && in_array((int)$exchangeRequest->status, [3, 5], true)) {
            $route = route('tracking', ['trx_id' => $exchangeRequest->utr]);
        }

        return response()->json([
            'exchangeRequest' => $exchangeRequest ?? null,
            'route' => $route
        ]);
    }

    protected function formatQuoteResponse(array $quote): array
    {
        return [
            'sendAmount' => round((float)$quote['send_amount'], 8),
            'getAmount' => round((float)$quote['get_amount'], 8),
            'exchangeRate' => round((float)$quote['exchange_rate'], 8),
            'serviceFee' => round((float)$quote['service_fee'], 8),
            'networkFee' => round((float)$quote['network_fee'], 8),
            'finalAmount' => round((float)$quote['final_amount'], 8),
            'serviceFeeType' => $quote['service_fee_type'],
            'networkFeeType' => $quote['network_fee_type'],
            'sendCurrencyCode' => $quote['send_currency_code'],
            'getCurrencyCode' => $quote['get_currency_code'],
            'provider' => $quote['quote_provider'],
            'symbol' => $quote['quote_symbol'],
            'quotePrice' => $quote['quote_price'],
            'quoteExpiresAt' => optional($quote['quote_expires_at'])->toIso8601String(),
            'receiveReadonly' => (bool)$quote['receive_readonly'],
        ];
    }
}
