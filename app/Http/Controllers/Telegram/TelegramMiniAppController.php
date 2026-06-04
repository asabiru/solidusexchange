<?php

namespace App\Http\Controllers\Telegram;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Models\FiatCurrency;
use App\Models\SellRequest;
use App\Services\ExchangeEngine\ExchangeQuoteService;
use App\Services\Telegram\TelegramMiniAppAuthService;
use App\Services\TradeQuote\BuyQuoteService;
use App\Services\TradeQuote\SellQuoteService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use RuntimeException;

class TelegramMiniAppController extends Controller
{
    public function index(Request $request, TelegramMiniAppAuthService $authService)
    {
        return $this->launch($request, $authService);
    }

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

    public function storeRequest(Request $request, BuyQuoteService $buyQuoteService, SellQuoteService $sellQuoteService, ExchangeQuoteService $exchangeQuoteService)
    {
        if (!Auth::check()) {
            return response()->json([
                'status' => false,
                'message' => 'Откройте Mini App из Telegram для автоматического входа.',
            ], 401);
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
                    'image_path' => $currency->image_path,
                    'fiat_code' => strtoupper((string) $fiatCurrency->code),
                    'buy_rate' => (float) $currency->usd_rate / $fiatUsdRate,
                    'sell_rate' => ((float) $currency->usd_rate / $fiatUsdRate) * 0.992,
                ];
            })
            ->values();
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
