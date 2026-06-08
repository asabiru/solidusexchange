<?php

namespace App\Http\Controllers;

use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Services\Telegram\TelegramMiniAppAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Mail\Message;

class TelegramMiniAppController extends Controller
{
    public function launch(Request $request, TelegramMiniAppAuthService $authService)
    {
        $initData = (string) ($request->input('tgWebAppData') ?: $request->input('initData') ?: $request->header('X-Telegram-Init-Data'));

        if ($initData !== '') {
            try {
                $payload = $authService->validateInitData($initData);
                $user = $authService->syncUser($payload);
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
                    ],
                ]);
            }
        }

        return view('telegram.mini-app', [
            'user' => Auth::user(),
            'cryptoCurrencies' => $this->cryptoCurrencies(),
            'fiatCurrencies' => $this->fiatCurrencies(),
            'rateCards' => $this->rateCards(),
            'defaultFiatCode' => $this->defaultFiatCode(),
        ]);
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
            ->active()
            ->sorted()
            ->limit(4)
            ->get();
    }

    private function rateCards()
    {
        $fiatCurrency = FiatCurrency::query()
            ->active()
            ->where('code', $this->defaultFiatCode())
            ->first() ?: FiatCurrency::query()->active()->sorted()->first();

        if (!$fiatCurrency) {
            return collect();
        }

        $fiatUsdRate = $this->effectiveFiatUsdRate($fiatCurrency);

        if ($fiatUsdRate <= 0) {
            return collect();
        }

        return CryptoCurrency::where('status', 1)
            ->orderBy('sort_by', 'ASC')
            ->limit(6)
            ->get()
            ->filter(fn (CryptoCurrency $currency) => (float) $currency->usd_rate > 0)
            ->map(function (CryptoCurrency $currency) use ($fiatCurrency, $fiatUsdRate) {
                return [
                    'code' => strtoupper((string) $currency->normalized_code),
                    'name' => $currency->name,
                    'fiat_code' => strtoupper((string) $fiatCurrency->code),
                    'buy_rate' => (float) $currency->usd_rate / $fiatUsdRate,
                    'sell_rate' => ((float) $currency->usd_rate / $fiatUsdRate) * 0.992,
                ];
            })
            ->values();
    }

    private function effectiveFiatUsdRate(FiatCurrency $currency): float
    {
        $storedUsdRate = (float) $currency->usd_rate;
        $baseCurrency = strtoupper((string) basicControl()->base_currency);

        if (strtoupper((string) $currency->code) !== $baseCurrency) {
            return $currency->applyRateMarkupToUsdRate($storedUsdRate);
        }

        $referenceUsdt = CryptoCurrency::where('status', 1)
            ->orderBy('sort_by', 'ASC')
            ->get()
            ->first(function (CryptoCurrency $cryptoCurrency) {
                return strtoupper((string) $cryptoCurrency->normalized_code) === 'USDT'
                    && (float) $cryptoCurrency->rate > 0
                    && (float) $cryptoCurrency->usd_rate > 0;
            });

        if (!$referenceUsdt) {
            return $currency->applyRateMarkupToUsdRate($storedUsdRate);
        }

        return $currency->applyRateMarkupToUsdRate((float) $referenceUsdt->usd_rate / (float) $referenceUsdt->rate);
    }

    /**
     * Send 6-digit verification code to the provided email address.
     * Requires valid X-Telegram-Init-Data header (user must be authenticated via Telegram).
     */
    public function sendEmailCode(Request $request, TelegramMiniAppAuthService $authService)
    {
        $request->validate(['email' => 'required|email|max:255']);

        $user = Auth::user();
        if (!$user) {
            return response()->json(['status' => false, 'message' => 'Необходима авторизация через Telegram.'], 401);
        }

        $email = trim($request->input('email'));

        // Check if email is already used by another account
        if (\App\Models\User::where('email', $email)->where('id', '!=', $user->id)->exists()) {
            return response()->json(['status' => false, 'message' => 'Этот email уже используется другим аккаунтом.'], 422);
        }

        $code = str_pad((string) random_int(100000, 999999), 6, '0', STR_PAD_LEFT);
        $cacheKey = 'tma_email_code_' . $user->id;
        Cache::put($cacheKey, ['code' => $code, 'email' => $email], now()->addMinutes(10));

        try {
            Mail::raw(
                "Ваш код подтверждения для SolidChange: {$code}\n\nКод действителен 10 минут.",
                function (Message $message) use ($email) {
                    $message->to($email)
                        ->subject('Код подтверждения email — SolidChange');
                }
            );
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('TMA email send error: ' . $e->getMessage());
            return response()->json(['status' => false, 'message' => 'Не удалось отправить письмо. Проверьте адрес email.'], 500);
        }

        return response()->json(['status' => true, 'message' => 'Код отправлен на ' . $email]);
    }

    /**
     * Verify the email code and bind email to the authenticated user.
     */
    public function verifyEmailCode(Request $request)
    {
        $request->validate(['code' => 'required|string|size:6']);

        $user = Auth::user();
        if (!$user) {
            return response()->json(['status' => false, 'message' => 'Необходима авторизация.'], 401);
        }

        $cacheKey = 'tma_email_code_' . $user->id;
        $stored = Cache::get($cacheKey);

        if (!$stored) {
            return response()->json(['status' => false, 'message' => 'Код истёк или не был отправлен. Запросите новый.'], 422);
        }

        if ((string) $stored['code'] !== trim($request->input('code'))) {
            return response()->json(['status' => false, 'message' => 'Неверный код.'], 422);
        }

        Cache::forget($cacheKey);

        $user->email = $stored['email'];
        $user->email_verified_at = now();
        $user->save();

        return response()->json(['status' => true, 'message' => 'Email успешно привязан!']);
    }

    private function defaultFiatCode(): string
    {
        return strtoupper((string) (basicControl()->base_currency ?: 'RUB'));
    }
}
