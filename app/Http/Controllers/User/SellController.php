<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Http\Requests\SellStoreRequest;
use App\Models\CryptoCurrency;
use App\Models\CryptoMethod;
use App\Models\FiatCurrency;
use App\Models\FiatSendGateway;
use App\Models\SellRequest;
use App\Services\Custodial\CustodialWalletService;
use App\Services\Sell\TraderAssignmentService;
use App\Services\TradeQuote\SellQuoteService;
use App\Traits\CalculateFees;
use App\Traits\CryptoWalletGenerate;
use Carbon\Carbon;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Validator;
use RuntimeException;

class SellController extends Controller
{
    use CryptoWalletGenerate, CalculateFees;

    public function __construct(private readonly SellQuoteService $sellQuoteService)
    {
        $this->theme = template();
    }

    public function getSellCurrency()
    {
        $sendCurrencies = CryptoCurrency::where('status', 1)->orderBy('sort_by', 'ASC')->get();
        $getCurrencies = FiatCurrency::query()->active()->visibleInSell()->sorted()->get();

        return response()->json([
            'sendCurrencies' => $sendCurrencies,
            'getCurrencies' => $getCurrencies,
            'selectedSendCurrency' => $sendCurrencies[0]??null,
            'selectedGetCurrency' => $getCurrencies[0]??null,
            'initialSendAmount' => isset($sendCurrencies[0]) ? (($sendCurrencies[0]->min_send + $sendCurrencies[0]->max_send) / 2) : 1,
        ]);
    }

    public function publicSellRequest(SellStoreRequest $request)
    {
        // If user is authenticated, use the normal sellRequest
        if (auth()->check()) {
            return $this->sellRequest($request);
        }

        // For non-authenticated users, create request and redirect to login
        $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
        $getCurrency = FiatCurrency::query()->active()->visibleInSell()->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        try {
            $quote = $this->sellQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
        } catch (RuntimeException $exception) {
            return back()->withInput()->with('error', $exception->getMessage());
        }

        $sellRequest = SellRequest::create([
            'user_id' => null,
            'send_currency_id' => $quote['send_currency_id'],
            'get_currency_id' => $quote['get_currency_id'],
            'send_amount' => $quote['send_amount'],
            'get_amount' => $quote['get_amount'],
            'exchange_rate' => $quote['exchange_rate'],
            'processing_fee' => $quote['processing_fee'],
            'final_amount' => $quote['final_amount'],
            'utr' => uniqid('S'),
        ]);

        // Store request data in session and redirect to login
        session(['pending_sell_utr' => $sellRequest->utr]);
        return redirect()->route('login')->with('info', 'Пожалуйста, войдите для продолжения продажи');
    }

    public function sellRequest(SellStoreRequest $request)
    {
        $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
        $getCurrency = FiatCurrency::query()->active()->visibleInSell()->findOrFail($request->exchangeGetCurrency);

        if ($sendCurrency->min_send > $request->exchangeSendAmount) {
            return back()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
        }

        if ($sendCurrency->max_send < $request->exchangeSendAmount) {
            return back()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
        }

        try {
            $quote = $this->sellQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
        } catch (RuntimeException $exception) {
            return back()->withInput()->with('error', $exception->getMessage());
        }

        $sellRequest = SellRequest::create([
            'user_id' => auth()->id() ?? null,
            'send_currency_id' => $quote['send_currency_id'],
            'get_currency_id' => $quote['get_currency_id'],
            'send_amount' => $quote['send_amount'],
            'get_amount' => $quote['get_amount'],
            'exchange_rate' => $quote['exchange_rate'],
            'processing_fee' => $quote['processing_fee'],
            'final_amount' => $quote['final_amount'],
            'utr' => uniqid('S'),
        ]);

        return redirect()->route('sellProcessing', $sellRequest->utr);
    }

    public function sellProcessing(SellStoreRequest $request, $utr)
    {
        $sellRequest = SellRequest::where(['status' => 0, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {
            return view($this->theme . 'user.sell.processing', compact('sellRequest'));
        } elseif ($request->method() == 'POST') {
            $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->exchangeSendCurrency);
            $getCurrency = FiatCurrency::query()->active()->visibleInSell()->findOrFail($request->exchangeGetCurrency);

            if ($sendCurrency->min_send > $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code);
            }

            if ($sendCurrency->max_send < $request->exchangeSendAmount) {
                return back()->withInput()->with('error', 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code);
            }

            $fiatSendGateway = $this->resolveSellGateway($getCurrency, (int) $request->payment_method);
            $params = $fiatSendGateway->parameters;

            $rules = [];
            if ($params !== null) {
                foreach ($params as $key => $cus) {
                    $rules[$key] = [$cus->validation == 'required' ? $cus->validation : 'nullable'];
                    if ($cus->type === 'text') {
                        $rules[$key][] = 'max:255';
                    } elseif ($cus->type === 'number') {
                        $rules[$key][] = 'integer';
                    } elseif ($cus->type === 'textarea') {
                        $rules[$key][] = 'min:3';
                        $rules[$key][] = 'max:300';
                    }
                }
            }

            $validator = Validator::make($request->all(), $rules);
            if ($validator->fails()) {
                return back()->withErrors($validator)->withInput();
            }

            [$contactTelegram, $contactTelegramId, $contactTelegramSource] = $this->resolveManualTelegramContact($request, $fiatSendGateway);

            $reqField = [];
            if ($params != null) {
                foreach ($request->all() as $k => $v) {
                    foreach ($params as $inKey => $inVal) {
                        if ($k == $inKey) {
                            $reqField[$inKey] = [
                                'field_label' => $inVal->field_label,
                                'field_name' => $inVal->field_name,
                                'validation' => $inVal->validation,
                                'field_value' => $v,
                                'type' => $inVal->type,
                            ];
                        }
                    }
                }
            }

            try {
                $quote = $this->sellQuoteService->build($sendCurrency, $getCurrency, (float) $request->exchangeSendAmount);
            } catch (RuntimeException $exception) {
                return back()->withInput()->with('error', $exception->getMessage());
            }

            $sellRequest->send_currency_id = $quote['send_currency_id'];
            $sellRequest->get_currency_id = $quote['get_currency_id'];
            $sellRequest->send_amount = $quote['send_amount'];
            $sellRequest->get_amount = $quote['get_amount'];
            $sellRequest->exchange_rate = $quote['exchange_rate'];
            $sellRequest->processing_fee = $quote['processing_fee'];
            $sellRequest->final_amount = $quote['final_amount'];
            $sellRequest->status = 1;
            $sellRequest->fiat_send_gateway_id = $fiatSendGateway->id;
            $sellRequest->contact_telegram = $contactTelegram;
            $sellRequest->contact_telegram_id = $contactTelegramId;
            $sellRequest->contact_telegram_source = $contactTelegramSource;
            $sellRequest->parameters = $reqField;
            $sellRequest->save();

            return redirect()->route('sellProcessingOverview', $sellRequest->utr);
        }
    }

    public function sellProcessingOverview($utr)
    {
        $sellRequest = SellRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        return view($this->theme . 'user.sell.processing-overview', compact('sellRequest'));
    }

    public function sellInitPayment(Request $request, $utr)
    {
        $sellRequest = SellRequest::where(['status' => 1, 'utr' => $utr])->firstOrFail();
        if ($request->method() == 'GET') {
            if (!$sellRequest->admin_wallet) {
                // Try custodial wallet system first
                try {
                    $custodialService = app(CustodialWalletService::class);
                    $custodialWallet = $custodialService->getOrCreateWallet($sellRequest->sendCurrency->code);
                    $sellRequest->admin_wallet = $custodialWallet->address;

                    // Link custodial wallet to this sell request
                    $custodialWallet->update([
                        'assigned_exchange_id' => $sellRequest->id,
                        'assigned_at' => now(),
                    ]);

                    // Create a pending deposit record to track incoming crypto
                    \App\Models\CustodialDeposit::create([
                        'custodial_wallet_id' => $custodialWallet->id,
                        'currency_code' => $sellRequest->sendCurrency->code,
                        'amount' => 0,
                        'status' => 'pending',
                        'sell_request_id' => $sellRequest->id,
                        'detected_at' => null,
                    ]);
                } catch (\Throwable $e) {
                    // Fallback to legacy crypto method
                    $response = $this->getCryptoWallet($sellRequest->sendCurrency->code, 'sell', ['identifier' => $sellRequest->utr]);
                    if (!$response['status']) {
                        return back()->with('error', 'Unable to generate an address. Please contact the administration for assistance.');
                    }
                    $sellRequest->admin_wallet = $response['message'];
                }
                $sellRequest->save();
            }

            if (!$sellRequest->expire_time) {
                $sellRequest->expire_time = Carbon::now()->addMinutes(basicControl()->crypto_send_time);
                $sellRequest->save();
            }

            $cryptoMethod = CryptoMethod::select(['id', 'code', 'status'])->where('status', 1)->firstOrFail();

            if (!$sellRequest->crypto_method_id) {
                $sellRequest->crypto_method_id = $cryptoMethod->id;
                $sellRequest->save();
            }

            $data['isButtonShow'] = $cryptoMethod->code == 'manual';
            return view($this->theme . 'user.sell.init-payment', $data, compact('sellRequest'));
        } elseif ($request->method() == 'POST') {
            $sellRequest->status = 2;
            $sellRequest->save();

            try {
                app(TraderAssignmentService::class)->assignForSell($sellRequest->fresh(['fiatSendGateway']));
            } catch (\Throwable $exception) {
                report($exception);
            }

            $amount = getBaseAmount($sellRequest->send_amount, optional($sellRequest->sendCurrency)->code, 'crypto');
            $charge = getBaseAmount($sellRequest->processing_fee, optional($sellRequest->getCurrency)->code, 'fiat');

            BasicService::makeTransaction($amount, $charge, '-', 'Crypto Deposit For Sell',
                $sellRequest->id, SellRequest::class, $sellRequest->user_id, $sellRequest->send_amount, optional($sellRequest->sendCurrency)->code);

            $this->sendAdminNotification($sellRequest, 'sell');
            return redirect()->route('sellFinal', $sellRequest->utr);
        }
    }

    public function sellFinal($utr)
    {
        $sellRequest = SellRequest::where(['status' => 2, 'utr' => $utr])->firstOrFail();
        return view($this->theme . 'user.sell.final', compact('sellRequest'));
    }

    public function sellAutoRate(Request $request)
    {
        $request->validate([
            'sendAmount' => 'required|numeric|min:0.00000001',
            'sendCurrency' => 'required|integer',
            'getCurrency' => 'required|integer',
        ]);

        $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($request->sendCurrency);
        $getCurrency = FiatCurrency::query()->active()->visibleInSell()->findOrFail($request->getCurrency);
        $sendAmount = (float) $request->sendAmount;

        if ($sendCurrency->min_send > $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Min is ' . $sendCurrency->min_send . ' ' . $sendCurrency->code], 422);
        }

        if ($sendCurrency->max_send < $sendAmount) {
            return response()->json(['status' => false, 'message' => 'Max is ' . $sendCurrency->max_send . ' ' . $sendCurrency->code], 422);
        }

        try {
            $quote = $this->sellQuoteService->build($sendCurrency, $getCurrency, $sendAmount);
        } catch (RuntimeException $exception) {
            return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'status' => true,
            'quote' => $this->formatQuoteResponse($quote),
        ]);
    }

    public function getSellCurrencyMethodInfo(Request $request)
    {
        $getCurrency = null;

        if ($request->filled('getCurrencyId')) {
            $getCurrency = FiatCurrency::query()->active()->visibleInSell()->find($request->getCurrencyId);
        }

        if (!$getCurrency && $request->filled('getCurrencyCode')) {
            $getCurrency = FiatCurrency::query()->active()->visibleInSell()->where('code', $request->getCurrencyCode)->first();
        }

        $getCurrencySendInfo = $this->resolveSellGatewayQuery($getCurrency)->orderBy('name', 'asc')->get();

        return response()->json([
            'getCurrencySendInfo' => $getCurrencySendInfo,
        ]);
    }

    private function resolveSellGateway(FiatCurrency $currency, int $gatewayId): FiatSendGateway
    {
        return $this->resolveSellGatewayQuery($currency)->findOrFail($gatewayId);
    }

    private function resolveSellGatewayQuery(?FiatCurrency $currency)
    {
        $query = FiatSendGateway::query()->where('status', 1);

        if ($currency && $currency->fiat_send_gateway_id) {
            return $query->where('id', $currency->fiat_send_gateway_id);
        }

        if ($currency) {
            return $query->whereJsonContains('supported_currency', $currency->code);
        }

        return $query->whereRaw('1 = 0');
    }

    public function sellGetStatus($utr)
    {
        $sellRequest = SellRequest::select(['id', 'utr', 'status', 'expire_time'])->where('utr', $utr)->first();
        $route = route('sellFinal', $sellRequest->utr);
        if ($sellRequest && $sellRequest->status == 1) {
            if (Carbon::now() > $sellRequest->expire_time) {
                $sellRequest->status = 4;
                $sellRequest->save();
                $route = url('/');
            }
        }

        return response()->json([
            'sellRequest' => $sellRequest ?? null,
            'route' => $route
        ]);
    }

    private function resolveManualTelegramContact(Request $request, FiatSendGateway $fiatSendGateway): array
    {
        if ($fiatSendGateway->processing_mode !== 'manual') {
            return [null, null, null];
        }

        $user = auth()->user();
        if ($user && ($user->provider ?? null) === 'telegram' && !empty($user->provider_id)) {
            return [
                $user->telegram_contact,
                (string) $user->provider_id,
                'telegram_auth',
            ];
        }

        $validator = Validator::make($request->all(), [
            'contact_telegram' => ['required', 'string', 'min:3', 'max:255'],
        ]);

        if ($validator->fails()) {
            throw \Illuminate\Validation\ValidationException::withMessages($validator->errors()->toArray());
        }

        return [
            $this->formatTelegramContact($request->input('contact_telegram')),
            null,
            'manual_input',
        ];
    }

    private function formatTelegramContact(?string $telegram): ?string
    {
        $telegram = trim((string) $telegram);
        if ($telegram === '') {
            return null;
        }

        if (Str::startsWith($telegram, ['@', 'https://t.me/', 'tg://'])) {
            return $telegram;
        }

        if (preg_match('/^[A-Za-z0-9_\.]+$/', $telegram)) {
            return '@' . ltrim($telegram, '@');
        }

        return $telegram;
    }

    protected function formatQuoteResponse(array $quote): array
    {
        return [
            'sendAmount' => round((float) $quote['send_amount'], 8),
            'getAmount' => round((float) $quote['get_amount'], 8),
            'exchangeRate' => round((float) $quote['exchange_rate'], 8),
            'processingFee' => round((float) $quote['processing_fee'], 8),
            'finalAmount' => round((float) $quote['final_amount'], 8),
            'processingFeeType' => $quote['processing_fee_type'],
            'sendCurrencyCode' => $quote['send_currency_code'],
            'getCurrencyCode' => $quote['get_currency_code'],
            'rateSource' => $quote['rate_source'],
        ];
    }
}
