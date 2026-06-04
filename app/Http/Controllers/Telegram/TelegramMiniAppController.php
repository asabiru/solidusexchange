<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Services\Telegram\TelegramMiniAppAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class TelegramMiniAppController extends Controller
{
    public function launch(Request $request, TelegramMiniAppAuthService $authService)
    {
        $initData = (string) ($request->input('tgWebAppData') ?: $request->input('initData') ?: $request->header('X-Telegram-Init-Data'));

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

    private function defaultFiatCode(): string
    {
        return strtoupper((string) (basicControl()->base_currency ?: 'RUB'));
    }
}
