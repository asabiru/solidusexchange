<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Models\FiatCurrency;
use App\Models\Kyc;
use App\Models\PageDetail;
use App\Models\SellRequest;
use App\Models\UserKyc;
use App\Services\ExchangeEngine\ExchangeQuoteService;
use App\Services\Kyc\DiditKycService;
use App\Services\Kyc\UserKycManager;
use App\Services\MarketRateCardService;
use App\Services\Telegram\TelegramMiniAppAuthService;
use App\Services\TradeQuote\BuyQuoteService;
use App\Services\TradeQuote\SellQuoteService;
use App\Traits\Notify;
use App\Traits\Upload;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use RuntimeException;

class TelegramMiniAppController extends Controller
{
    use Notify, Upload;

    public function index(Request $request, TelegramMiniAppAuthService $authService)
    {
        return $this->launch($request, $authService);
    }

    public function launch(Request $request, TelegramMiniAppAuthService $authService)
    {
        $initData = (string) ($request->header('X-Telegram-Init-Data') ?: $request->input('tgWebAppData') ?: $request->input('initData'));

        if ($initData !== '') {
            try {
                $payload = $authService->validateInitData($initData);
                $user = $authService->syncUser($payload, Auth::user());
                Auth::login($user);
            } catch (\RuntimeException $exception) {
                if ($request->expectsJson() || $request->ajax()) {
                    return response()->json([
                        'authenticated' => false,
                        'message' => __('Не удалось подтвердить Telegram-вход. Откройте приложение из Telegram.'),
                    ], 422);
                }

                throw $exception;
            }

            if ($request->expectsJson() || $request->ajax()) {
                return response()->json([
                    'authenticated' => true,
                    'user' => [
                        'id' => $user->id,
                        'name' => $user->firstname ?: $user->username ?: $user->email,
                        'email' => $user->email,
                        'needs_email' => $this->needsEmailBind($user),
                        'telegram_id' => $user->telegram_id,
                    ],
                ]);
            }
        }

        return view('telegram.mini-app', [
            'user' => Auth::user(),
            'cryptoCurrencies' => $this->cryptoCurrencies(),
            'fiatCurrencies' => $this->fiatCurrencies(),
            'rateCards' => app(MarketRateCardService::class)->cards(),
            'defaultFiatCode' => $this->defaultFiatCode(),
            'appLogo' => $this->appLogo(),
            'statsUrl' => route('telegram.mini-app.stats'),
            'kycUrl' => route('telegram.mini-app.kyc'),
            'kycSubmitUrl' => route('telegram.mini-app.kyc.submit'),
            'policyUrl' => route('telegram.mini-app.page', ['slug' => 'terms-and-conditions']),
            'privacyUrl' => route('telegram.mini-app.page', ['slug' => 'privacy-policy']),
        ]);
    }

    public function stats(Request $request, TelegramMiniAppAuthService $authService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json(['status' => false, 'message' => 'Откройте Mini App из Telegram.'], 401);
        }

        $userId = Auth::id();
        $buy = BuyRequest::where('user_id', $userId);
        $sell = SellRequest::where('user_id', $userId);
        $exchange = ExchangeRequest::where('user_id', $userId);

        return response()->json([
            'status' => true,
            'stats' => [
                'total' => (clone $buy)->count() + (clone $sell)->count() + (clone $exchange)->count(),
                'completed' => (clone $buy)->where('status', 3)->count()
                    + (clone $sell)->where('status', 3)->count()
                    + (clone $exchange)->where('status', 3)->count(),
                'active' => (clone $buy)->whereIn('status', [1, 2])->count()
                    + (clone $sell)->whereIn('status', [1, 2])->count()
                    + (clone $exchange)->whereIn('status', [1, 2])->count(),
                'canceled' => (clone $buy)->where('status', 5)->count()
                    + (clone $sell)->where('status', 5)->count()
                    + (clone $exchange)->where('status', 5)->count(),
                'buy' => (clone $buy)->count(),
                'sell' => (clone $sell)->count(),
                'exchange' => (clone $exchange)->count(),
            ],
        ]);
    }

    public function sendEmailCode(Request $request, TelegramMiniAppAuthService $authService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json(['status' => false, 'message' => 'Откройте Mini App из Telegram.'], 401);
        }

        $validated = $request->validate([
            'email' => 'required|email:rfc,dns|unique:users,email,' . Auth::id(),
        ]);

        $user = Auth::user();
        $user->email = strtolower($validated['email']);
        $user->email_verification = 0;
        $user->verify_code = code(6);
        $user->sent_at = Carbon::now();
        $user->save();

        $this->verifyToMail($user, 'VERIFICATION_CODE', [
            'code' => $user->verify_code,
        ]);

        return response()->json([
            'status' => true,
            'message' => 'Код подтверждения отправлен на email.',
        ]);
    }

    public function verifyEmailCode(Request $request, TelegramMiniAppAuthService $authService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json(['status' => false, 'message' => 'Откройте Mini App из Telegram.'], 401);
        }

        $validated = $request->validate([
            'code' => 'required|string',
        ]);

        $user = Auth::user();
        if (!$this->emailCodeIsValid($user, $validated['code'])) {
            return response()->json(['status' => false, 'message' => 'Код подтверждения не совпал.'], 422);
        }

        $user->email_verification = 1;
        $user->verify_code = null;
        $user->sent_at = null;
        $user->save();

        return response()->json([
            'status' => true,
            'message' => 'Email успешно привязан.',
        ]);
    }

    public function pageContent(string $slug)
    {
        $detail = PageDetail::query()
            ->whereHas('page', fn ($query) => $query->where('slug', $slug))
            ->with('page')
            ->orderByDesc('id')
            ->first();

        return response()->json([
            'status' => true,
            'title' => $slug === 'privacy-policy' ? 'Политика конфиденциальности' : 'Условия использования',
            'content' => trim(strip_tags((string) ($detail?->content ?? 'Документ обновляется.'))),
            'url' => url($slug),
        ]);
    }

    public function kyc(Request $request, TelegramMiniAppAuthService $authService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json(['status' => false, 'message' => 'Откройте Mini App из Telegram.'], 401);
        }

        $kyc = Kyc::where('status', 1)->first();
        $latest = $kyc ? UserKyc::where('user_id', Auth::id())->where('kyc_id', $kyc->id)->latest()->first() : null;

        return response()->json([
            'status' => true,
            'verified' => (int) Auth::user()->identity_verify === 2,
            'kyc' => $kyc ? [
                'id' => $kyc->id,
                'name' => $kyc->name,
                'provider' => $kyc->provider ?? 'manual',
                'latest_status' => $latest?->status,
                'fields' => collect((array) $kyc->input_form)->map(function ($field, $key) {
                    return [
                        'key' => (string) $key,
                        'label' => (string) ($field->field_label ?? $field->field_name ?? $key),
                        'type' => in_array($field->type ?? 'text', ['text', 'number', 'date', 'textarea', 'file'], true) ? $field->type : 'text',
                        'required' => ($field->validation ?? null) === 'required',
                    ];
                })->values(),
            ] : null,
        ]);
    }

    public function submitKyc(Request $request, TelegramMiniAppAuthService $authService, UserKycManager $userKycManager, DiditKycService $diditKycService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json(['status' => false, 'message' => 'Откройте Mini App из Telegram.'], 401);
        }

        $kyc = Kyc::where('status', 1)->findOrFail((int) $request->input('kyc_id'));

        if (($kyc->provider ?? 'manual') === 'didit') {
            try {
                $session = $diditKycService->startSession(Auth::user(), $kyc, route('telegram.mini-app'));

                return response()->json([
                    'status' => true,
                    'provider' => 'didit',
                    'url' => $session['url'],
                    'message' => 'Откройте Didit и завершите проверку.',
                ]);
            } catch (\Throwable $exception) {
                return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
            }
        }

        if (($kyc->provider ?? 'manual') !== 'manual') {
            return response()->json(['status' => false, 'message' => 'Этот KYC-провайдер пока открывается через кабинет.'], 422);
        }

        $params = $kyc->input_form;
        $rules = [];
        foreach ((array) $params as $key => $field) {
            $rules[$key] = [($field->validation ?? null) === 'required' ? 'required' : 'nullable'];
            if (($field->type ?? null) === 'file') {
                $rules[$key][] = 'image';
                $rules[$key][] = 'mimes:jpeg,jpg,png';
                $rules[$key][] = 'max:2048';
            } elseif (($field->type ?? null) === 'number') {
                $rules[$key][] = 'integer';
            } elseif (($field->type ?? null) === 'textarea') {
                $rules[$key][] = 'min:3';
                $rules[$key][] = 'max:300';
            } else {
                $rules[$key][] = 'max:191';
            }
        }

        $validator = Validator::make($request->except('kyc_id', 'initData'), $rules);
        if ($validator->fails()) {
            return response()->json(['status' => false, 'message' => $validator->errors()->first()], 422);
        }

        $fields = [];
        foreach ((array) $params as $key => $field) {
            if (($field->type ?? null) === 'file' && $request->hasFile($key)) {
                $file = $this->fileUpload($request->file($key), config('filelocation.kyc.path'), null, null, 'webp', 60);
                $fields[$key] = [
                    'field_name' => $field->field_name ?? $field->field_label ?? $key,
                    'field_value' => $file['path'],
                    'field_driver' => $file['driver'],
                    'validation' => $field->validation ?? 'nullable',
                    'type' => 'file',
                ];
            } elseif (($field->type ?? null) !== 'file') {
                $fields[$key] = [
                    'field_name' => $field->field_name ?? $field->field_label ?? $key,
                    'validation' => $field->validation ?? 'nullable',
                    'field_value' => $request->input($key),
                    'type' => $field->type ?? 'text',
                ];
            }
        }

        UserKyc::create([
            'user_id' => Auth::id(),
            'kyc_id' => $kyc->id,
            'kyc_type' => $kyc->name,
            'kyc_info' => $fields,
        ]);

        $userKycManager->refreshUserVerificationStatus(Auth::user()->fresh());

        return response()->json(['status' => true, 'message' => 'KYC отправлен на проверку.']);
    }

    public function quote(Request $request, BuyQuoteService $buyQuoteService, SellQuoteService $sellQuoteService, ExchangeQuoteService $exchangeQuoteService)
    {
        $validated = $request->validate([
            'mode' => 'required|in:buy,sell,exchange',
            'send_amount' => 'required|numeric|min:0.00000001',
            'send_currency_id' => 'required|integer',
            'get_currency_id' => 'required|integer',
        ]);

        try {
            $quote = match ($validated['mode']) {
                'buy' => $buyQuoteService->build(
                    FiatCurrency::query()->active()->visibleInBuy()->findOrFail($validated['send_currency_id']),
                    CryptoCurrency::where('status', 1)->findOrFail($validated['get_currency_id']),
                    (float) $validated['send_amount']
                ),
                'sell' => $sellQuoteService->build(
                    CryptoCurrency::where('status', 1)->findOrFail($validated['send_currency_id']),
                    FiatCurrency::query()->active()->visibleInSell()->findOrFail($validated['get_currency_id']),
                    (float) $validated['send_amount']
                ),
                default => $exchangeQuoteService->build(
                    CryptoCurrency::where('status', 1)->findOrFail($validated['send_currency_id']),
                    CryptoCurrency::where('status', 1)->findOrFail($validated['get_currency_id']),
                    (float) $validated['send_amount']
                ),
            };
        } catch (RuntimeException $exception) {
            return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'status' => true,
            'quote' => $this->formatQuote($quote),
        ]);
    }

    public function storeRequest(Request $request, TelegramMiniAppAuthService $authService, BuyQuoteService $buyQuoteService, SellQuoteService $sellQuoteService, ExchangeQuoteService $exchangeQuoteService)
    {
        $this->authenticateTelegramRequest($request, $authService);

        if (!Auth::check()) {
            return response()->json([
                'status' => false,
                'message' => 'Откройте Mini App из Telegram для автоматического входа.',
            ], 401);
        }

        $user = Auth::user();
        if (!$user->identity_verify) {
            return response()->json([
                'status' => false,
                'message' => 'Для совершения обмена необходимо пройти KYC верификацию.',
            ], 403);
        }

        $validated = $request->validate([
            'mode' => 'required|in:buy,sell,exchange',
            'send_amount' => 'required|numeric|min:0.00000001',
            'send_currency_id' => 'required|integer',
            'get_currency_id' => 'required|integer',
        ]);

        try {
            if ($validated['mode'] === 'buy') {
                $sendCurrency = FiatCurrency::query()->active()->visibleInBuy()->findOrFail($validated['send_currency_id']);
                $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($validated['get_currency_id']);
                $quote = $buyQuoteService->build($sendCurrency, $getCurrency, (float) $validated['send_amount']);
                $trade = BuyRequest::create([
                    'user_id' => Auth::id(),
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
            } elseif ($validated['mode'] === 'sell') {
                $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($validated['send_currency_id']);
                $getCurrency = FiatCurrency::query()->active()->visibleInSell()->findOrFail($validated['get_currency_id']);
                $quote = $sellQuoteService->build($sendCurrency, $getCurrency, (float) $validated['send_amount']);
                $trade = SellRequest::create([
                    'user_id' => Auth::id(),
                    'send_currency_id' => $quote['send_currency_id'],
                    'get_currency_id' => $quote['get_currency_id'],
                    'send_amount' => $quote['send_amount'],
                    'get_amount' => $quote['get_amount'],
                    'exchange_rate' => $quote['exchange_rate'],
                    'processing_fee' => $quote['processing_fee'],
                    'final_amount' => $quote['final_amount'],
                    'utr' => uniqid('S'),
                ]);
            } else {
                $sendCurrency = CryptoCurrency::where('status', 1)->findOrFail($validated['send_currency_id']);
                $getCurrency = CryptoCurrency::where('status', 1)->findOrFail($validated['get_currency_id']);
                $quote = $exchangeQuoteService->build($sendCurrency, $getCurrency, (float) $validated['send_amount']);
                $trade = ExchangeRequest::create([
                    'user_id' => Auth::id(),
                    'status' => 0,
                    'rate_type' => 'floating',
                    'utr' => uniqid('E'),
                ]);
                $exchangeQuoteService->applyToExchange($trade, $quote, 'floating');
            }
        } catch (RuntimeException $exception) {
            return response()->json(['status' => false, 'message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'status' => true,
            'message' => 'Заявка создана внутри Telegram Mini App.',
            'trade' => [
                'utr' => $trade->utr,
                'mode' => $validated['mode'],
                'send_amount' => (float) $trade->send_amount,
                'get_amount' => (float) $trade->get_amount,
                'final_amount' => (float) $trade->final_amount,
            ],
        ]);
    }

    private function authenticateTelegramRequest(Request $request, TelegramMiniAppAuthService $authService): void
    {
        if (Auth::check()) {
            return;
        }

        $initData = (string) ($request->header('X-Telegram-Init-Data') ?: $request->input('initData'));

        if ($initData === '') {
            return;
        }

        try {
            $payload = $authService->validateInitData($initData);
            Auth::login($authService->syncUser($payload));
        } catch (RuntimeException) {
            // The JSON response below handles unauthenticated Telegram requests.
        }
    }

    private function cryptoCurrencies()
    {
        return CryptoCurrency::where('status', 1)
            ->orderBy('sort_by', 'ASC')
            ->limit(8)
            ->get();
    }

    private function fiatCurrencies()
    {
        return FiatCurrency::query()
            ->with(['buyGateway', 'fiatSendGateway'])
            ->active()
            ->where('code', $this->defaultFiatCode())
            ->sorted()
            ->get();
    }

    private function appLogo(): string
    {
        $darkLogo = getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo);
        return $darkLogo ?: getFile(basicControl()->logo_driver, basicControl()->logo);
    }

    private function formatQuote(array $quote): array
    {
        return [
            'send_amount' => (float) ($quote['send_amount'] ?? 0),
            'get_amount' => (float) ($quote['get_amount'] ?? 0),
            'final_amount' => (float) ($quote['final_amount'] ?? 0),
            'exchange_rate' => (float) ($quote['exchange_rate'] ?? 0),
            'service_fee' => (float) ($quote['service_fee'] ?? $quote['processing_fee'] ?? 0),
            'network_fee' => (float) ($quote['network_fee'] ?? 0),
            'send_currency_code' => (string) ($quote['send_currency_code'] ?? ''),
            'get_currency_code' => (string) ($quote['get_currency_code'] ?? ''),
        ];
    }

    private function needsEmailBind($user): bool
    {
        $email = strtolower((string) ($user->email ?? ''));

        return $email === '' || str_ends_with($email, '@telegram.local');
    }

    private function emailCodeIsValid($user, string $code): bool
    {
        if (!$user->verify_code || !$user->sent_at) {
            return false;
        }

        if ($user->sent_at->copy()->addMinutes(30)->lt(Carbon::now())) {
            return false;
        }

        return hash_equals((string) $user->verify_code, trim($code));
    }

    private function defaultFiatCode(): string
    {
        return strtoupper((string) (basicControl()->base_currency ?: 'RUB'));
    }
}
