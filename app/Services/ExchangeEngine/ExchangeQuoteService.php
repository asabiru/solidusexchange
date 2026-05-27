<?php

namespace App\Services\ExchangeEngine;

use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Traits\CalculateFees;
use Illuminate\Support\Carbon;
use RuntimeException;

class ExchangeQuoteService
{
    use CalculateFees;

    public function __construct(private readonly BybitClient $bybitClient)
    {
    }

    public function build(CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency, float $sendAmount): array
    {
        if ($sendAmount <= 0) {
            throw new RuntimeException('Send amount must be greater than zero.');
        }

        if ((int)$sendCurrency->id === (int)$getCurrency->id) {
            throw new RuntimeException('Select two different currencies.');
        }

        if ($this->supportsExchangeEngine($sendCurrency, $getCurrency)) {
            try {
                return $this->buildBybitQuote($sendCurrency, $getCurrency, $sendAmount);
            } catch (\Throwable $exception) {
                report($exception);

                if (!(bool)config('exchange_engine.fallback_to_internal_on_quote_error', true)) {
                    throw $exception;
                }
            }
        }

        return $this->buildInternalQuote($sendCurrency, $getCurrency, $sendAmount);
    }

    public function supportsExchangeEngine(CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency): bool
    {
        if (!config('exchange_engine.enabled')) {
            return false;
        }

        if ((int)$sendCurrency->id === (int)$getCurrency->id) {
            return false;
        }

        return in_array($this->normalizeAssetCode($sendCurrency), config('exchange_engine.supported_send_currencies', []), true);
    }

    public function applyToExchange(ExchangeRequest $exchange, array $quote, ?string $rateType = null): ExchangeRequest
    {
        $exchange->send_currency_id = $quote['send_currency_id'];
        $exchange->get_currency_id = $quote['get_currency_id'];
        $exchange->send_amount = $quote['send_amount'];
        $exchange->get_amount = $quote['get_amount'];
        $exchange->exchange_rate = $quote['exchange_rate'];
        $exchange->service_fee = $quote['service_fee'];
        $exchange->network_fee = $quote['network_fee'];
        $exchange->final_amount = $quote['final_amount'];
        $exchange->quote_provider = $quote['quote_provider'];
        $exchange->quote_symbol = $quote['quote_symbol'];
        $exchange->quote_reference_price = $quote['quote_reference_price'];
        $exchange->quote_price = $quote['quote_price'];
        $exchange->quote_markup_percent = $quote['quote_markup_percent'];
        $exchange->quote_slippage_percent = $quote['quote_slippage_percent'];
        $exchange->quote_trade_fee_percent = $quote['quote_trade_fee_percent'];
        $exchange->quote_expires_at = $quote['quote_expires_at'];

        if ($rateType !== null) {
            $exchange->rate_type = $rateType;
        }

        $exchange->save();

        return $exchange->refresh();
    }

    public function refreshFloatingExchange(ExchangeRequest $exchange): ExchangeRequest
    {
        $exchange->loadMissing(['sendCurrency', 'getCurrency']);
        $quote = $this->build($exchange->sendCurrency, $exchange->getCurrency, (float)$exchange->send_amount);

        return $this->applyToExchange($exchange, $quote, $exchange->rate_type);
    }

    public function canReuseStoredFixedQuote(ExchangeRequest $exchange, CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency, float $sendAmount, string $rateType): bool
    {
        if ($rateType !== 'fixed') {
            return false;
        }

        if (!$exchange->quote_provider || !$exchange->quote_expires_at) {
            return false;
        }

        if (Carbon::now()->greaterThan($exchange->quote_expires_at)) {
            return false;
        }

        return (int)$exchange->send_currency_id === (int)$sendCurrency->id
            && (int)$exchange->get_currency_id === (int)$getCurrency->id
            && abs((float)$exchange->send_amount - $sendAmount) < 0.00000001;
    }

    public function exportStoredQuote(ExchangeRequest $exchange): array
    {
        $exchange->loadMissing(['sendCurrency', 'getCurrency']);

        return [
            'send_currency_id' => (int)$exchange->send_currency_id,
            'get_currency_id' => (int)$exchange->get_currency_id,
            'send_amount' => (float)$exchange->send_amount,
            'get_amount' => (float)$exchange->get_amount,
            'exchange_rate' => (float)$exchange->exchange_rate,
            'service_fee' => (float)$exchange->service_fee,
            'network_fee' => (float)$exchange->network_fee,
            'final_amount' => (float)$exchange->final_amount,
            'service_fee_type' => optional($exchange->getCurrency)->service_fee_type,
            'network_fee_type' => optional($exchange->getCurrency)->network_fee_type,
            'send_currency_code' => optional($exchange->sendCurrency)->code,
            'get_currency_code' => optional($exchange->getCurrency)->code,
            'quote_provider' => $exchange->quote_provider,
            'quote_symbol' => $exchange->quote_symbol,
            'quote_reference_price' => $exchange->quote_reference_price !== null ? (float)$exchange->quote_reference_price : null,
            'quote_price' => $exchange->quote_price !== null ? (float)$exchange->quote_price : null,
            'quote_markup_percent' => $exchange->quote_markup_percent !== null ? (float)$exchange->quote_markup_percent : 0.0,
            'quote_slippage_percent' => $exchange->quote_slippage_percent !== null ? (float)$exchange->quote_slippage_percent : 0.0,
            'quote_trade_fee_percent' => $exchange->quote_trade_fee_percent !== null ? (float)$exchange->quote_trade_fee_percent : 0.0,
            'quote_expires_at' => $exchange->quote_expires_at,
            'receive_readonly' => $exchange->quote_provider === 'bybit',
        ];
    }

    private function buildInternalQuote(CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency, float $sendAmount): array
    {
        $markupPercent = $this->effectiveMarkupPercent();
        $baseRate = (float)$sendCurrency->usd_rate / (float)$getCurrency->usd_rate;
        $exchangeRate = $baseRate / (1 + ($markupPercent / 100));
        $getAmount = $sendAmount * $exchangeRate;
        $fees = $this->getCryptoFees($getAmount, $getCurrency);
        $serviceFee = (float)$fees['serviceFees'];
        $networkFee = (float)$fees['networkFees'];
        $finalAmount = $getAmount - ($serviceFee + $networkFee);

        if ($finalAmount <= 0) {
            throw new RuntimeException('Amount is too small after fees.');
        }

        return [
            'send_currency_id' => (int)$sendCurrency->id,
            'get_currency_id' => (int)$getCurrency->id,
            'send_amount' => $sendAmount,
            'get_amount' => $getAmount,
            'exchange_rate' => $exchangeRate,
            'service_fee' => $serviceFee,
            'network_fee' => $networkFee,
            'final_amount' => $finalAmount,
            'service_fee_type' => $getCurrency->service_fee_type,
            'network_fee_type' => $getCurrency->network_fee_type,
            'send_currency_code' => $sendCurrency->code,
            'get_currency_code' => $getCurrency->code,
            'quote_provider' => 'internal',
            'quote_symbol' => null,
            'quote_reference_price' => null,
            'quote_price' => $exchangeRate > 0 ? (1 / $exchangeRate) : null,
            'quote_markup_percent' => $markupPercent,
            'quote_slippage_percent' => 0.0,
            'quote_trade_fee_percent' => 0.0,
            'quote_expires_at' => Carbon::now()->addSeconds((int)config('exchange_engine.quote_ttl_seconds', 20)),
            'receive_readonly' => false,
        ];
    }

    private function buildBybitQuote(CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency, float $sendAmount): array
    {
        $symbol = $this->normalizeAssetCode($getCurrency) . $this->normalizeAssetCode($sendCurrency);
        $instrument = $this->bybitClient->getInstrumentInfo($symbol);
        $bestAsk = $this->bybitClient->getBestAsk($symbol);
        $lotFilter = $instrument['lotSizeFilter'] ?? [];
        $qtyStep = (string)($lotFilter['basePrecision'] ?? $lotFilter['qtyStep'] ?? '0.00000001');
        $markupPercent = $this->effectiveMarkupPercent();
        $slippagePercent = (float)config('exchange_engine.slippage_percent', 0.2);
        $tradeFeePercent = (float)config('exchange_engine.trade_fee_percent', 0.1);
        $executionBufferPercent = (float)config('exchange_engine.execution_safety_buffer_percent', 0.75);

        $protectedExecutionPrice = $bestAsk * (1 + (($slippagePercent + $tradeFeePercent + $executionBufferPercent) / 100));
        $clientPrice = $protectedExecutionPrice * (1 + ($markupPercent / 100));
        $getAmount = $this->roundDown($sendAmount / $clientPrice, $qtyStep);

        $fees = $this->getCryptoFees($getAmount, $getCurrency);
        $serviceFee = $this->roundDown((float)$fees['serviceFees'], $qtyStep);
        $networkFee = $this->roundDown((float)$fees['networkFees'], $qtyStep);
        $finalAmount = $this->roundDown($getAmount - ($serviceFee + $networkFee), $qtyStep);

        if ($finalAmount <= 0) {
            throw new RuntimeException('Amount is too small after markup and fees.');
        }

        $this->assertMinOrder($bestAsk, $finalAmount, $lotFilter, $sendCurrency, $getCurrency);

        return [
            'send_currency_id' => (int)$sendCurrency->id,
            'get_currency_id' => (int)$getCurrency->id,
            'send_amount' => $sendAmount,
            'get_amount' => $getAmount,
            'exchange_rate' => $sendAmount > 0 ? ($getAmount / $sendAmount) : 0,
            'service_fee' => $serviceFee,
            'network_fee' => $networkFee,
            'final_amount' => $finalAmount,
            'service_fee_type' => $getCurrency->service_fee_type,
            'network_fee_type' => $getCurrency->network_fee_type,
            'send_currency_code' => $sendCurrency->code,
            'get_currency_code' => $getCurrency->code,
            'quote_provider' => 'bybit',
            'quote_symbol' => $symbol,
            'quote_reference_price' => $bestAsk,
            'quote_price' => $clientPrice,
            'quote_markup_percent' => $markupPercent,
            'quote_slippage_percent' => $slippagePercent,
            'quote_trade_fee_percent' => $tradeFeePercent,
            'quote_expires_at' => Carbon::now()->addSeconds((int)config('exchange_engine.quote_ttl_seconds', 20)),
            'receive_readonly' => true,
        ];
    }

    private function effectiveMarkupPercent(): float
    {
        return max(
            (float)config('exchange_engine.markup_percent', 2.0),
            (float)config('exchange_engine.min_profit_percent', 1.5)
        );
    }

    private function assertMinOrder(float $referencePrice, float $finalAmount, array $lotFilter, CryptoCurrency $sendCurrency, CryptoCurrency $getCurrency): void
    {
        $minOrderQty = (float)($lotFilter['minOrderQty'] ?? 0);
        $minOrderAmount = (float)($lotFilter['minOrderAmt'] ?? 0);

        if ($minOrderQty > 0 && $finalAmount < $minOrderQty) {
            throw new RuntimeException("Amount is too small for {$getCurrency->code}. Increase the amount and try again.");
        }

        if ($minOrderAmount > 0 && ($finalAmount * $referencePrice) < $minOrderAmount) {
            throw new RuntimeException("Amount is too small for {$sendCurrency->code}. Increase the amount and try again.");
        }
    }

    private function roundDown(float $value, string $step): float
    {
        $stepValue = (float)$step;
        if ($stepValue <= 0) {
            return $value;
        }

        $precision = $this->stepPrecision($step);
        $rounded = floor(($value / $stepValue) + 0.0000000001) * $stepValue;

        return (float)number_format($rounded, $precision, '.', '');
    }

    private function stepPrecision(string $step): int
    {
        $step = rtrim($step, '0');
        if (!str_contains($step, '.')) {
            return 0;
        }

        return strlen(substr(strrchr($step, '.'), 1));
    }

    private function normalizeAssetCode(CryptoCurrency $currency): string
    {
        return strtoupper((string) ($currency->normalized_code ?? $currency->code));
    }
}
