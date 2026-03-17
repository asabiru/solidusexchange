<?php

namespace App\Services\ExchangeEngine;

use App\Models\ExchangeRequest;
use App\Traits\SendNotification;
use App\Services\ExchangePipeline\ExchangePayoutService;
use Facades\App\Services\BasicService;
use Throwable;

class ExchangeAutomationService
{
    use SendNotification;

    public function __construct(
        private readonly ExchangeQuoteService $quoteService,
        private readonly BybitClient $bybitClient,
        private readonly ExchangePayoutService $payoutService,
    ) {
    }

    public function handleConfirmedDeposit(ExchangeRequest $exchange): bool
    {
        $exchange->loadMissing(['sendCurrency', 'getCurrency', 'cryptoMethod']);

        if (!config('exchange_engine.auto_process_after_deposit')) {
            return false;
        }

        if (!$this->quoteService->supportsExchangeEngine($exchange->sendCurrency, $exchange->getCurrency)) {
            return false;
        }

        if ((int)$exchange->status !== 2) {
            return false;
        }

        if (!$exchange->isAmlApproved()) {
            return false;
        }

        if (in_array($exchange->hedge_status, ['processing', 'filled', 'payout_sent', 'payout_queued', 'refund_queued'], true)) {
            return in_array((int)$exchange->status, [3, 6], true);
        }

        try {
            if ($exchange->rate_type === 'floating') {
                $exchange = $this->quoteService->refreshFloatingExchange($exchange);
                $exchange->loadMissing(['sendCurrency', 'getCurrency', 'cryptoMethod']);
            }

            $exchange->hedge_status = 'processing';
            $exchange->hedge_error = null;
            $exchange->save();

            $orderLinkId = substr('hedge_' . $exchange->utr, 0, 36);
            $createOrder = $this->bybitClient->createSpotMarketBuyByBaseQty(
                (string)$exchange->quote_symbol,
                (float)$exchange->final_amount,
                $orderLinkId
            );

            $orderId = $createOrder['result']['orderId'] ?? null;
            if (!$orderId) {
                throw new \RuntimeException('Bybit did not return orderId for hedge order.');
            }

            $order = $this->bybitClient->waitForClosedOrder((string)$exchange->quote_symbol, (string)$orderId);
            $avgPrice = (float)($order['avgPrice'] ?? 0);
            $execQty = (float)($order['cumExecQty'] ?? 0);
            $execValue = (float)($order['cumExecValue'] ?? 0);

            if ($execQty <= 0 || $execValue <= 0) {
                throw new \RuntimeException('Bybit hedge order was not filled.');
            }

            $feeDetail = $this->extractFeeDetail($order);
            $feeAmount = (float)($feeDetail['amount'] ?? ($order['cumExecFee'] ?? 0));
            $feeCurrency = $feeDetail['currency'] ?? (optional($exchange->sendCurrency)->code ?? 'USDT');

            $exchange->hedge_status = 'filled';
            $exchange->hedge_order_id = $orderId;
            $exchange->hedge_order_link_id = $orderLinkId;
            $exchange->hedge_avg_price = $avgPrice > 0 ? $avgPrice : ($execValue / $execQty);
            $exchange->hedge_exec_qty = $execQty;
            $exchange->hedge_exec_value = $execValue;
            $exchange->hedge_fee_amount = $feeAmount;
            $exchange->hedge_fee_currency = $feeCurrency;
            $exchange->profit_currency = optional($exchange->sendCurrency)->code ?? 'USDT';
            $exchange->profit_amount = $this->calculateProfit($exchange, $execValue, $feeAmount, $feeCurrency);
            $exchange->hedged_at = now();
            $exchange->save();

            if (!$this->shouldAutoPayout($exchange)) {
                return false;
            }

            $isSent = $this->payoutService->sendExchangePayout($exchange);

            if (!$isSent) {
                $exchange->hedge_error = 'Hedge completed but automatic payout failed.';
                $exchange->save();
                return false;
            }

            if ($this->payoutService->isAsyncPayout($exchange)) {
                $exchange->hedge_status = 'payout_queued';
                $exchange->save();
                $this->sendAdminNotification($exchange->fresh(), 'exchange');

                return true;
            }

            $exchange->status = 3;
            $exchange->hedge_status = 'payout_sent';
            $exchange->save();

            $amount = getBaseAmount($exchange->final_amount, optional($exchange->getCurrency)->code, 'crypto');
            BasicService::makeTransaction(
                $amount,
                0,
                '+',
                'Crypto Exchange Complete',
                $exchange->id,
                ExchangeRequest::class,
                $exchange->user_id,
                $exchange->final_amount,
                optional($exchange->getCurrency)->code
            );

            $this->sendUserNotification($exchange, 'userExchange', 'EXCHANGE_COMPLETE');

            return true;
        } catch (Throwable $exception) {
            report($exception);

            $exchange->hedge_status = 'failed';
            $exchange->hedge_error = $exception->getMessage();
            $exchange->save();

            return false;
        }
    }

    private function shouldAutoPayout(ExchangeRequest $exchange): bool
    {
        return $exchange->isAmlApproved()
            && config('exchange_engine.auto_payout_after_hedge')
            && $this->payoutService->canAutoPayout($exchange)
            && filled($exchange->destination_wallet);
    }

    private function calculateProfit(ExchangeRequest $exchange, float $execValue, float $feeAmount, string $feeCurrency): float
    {
        $depositAmount = (float)($exchange->deposit_amount_confirmed ?: $exchange->send_amount);
        $profit = $depositAmount - $execValue;

        if (strtoupper($feeCurrency) === strtoupper((string)optional($exchange->sendCurrency)->code)) {
            $profit -= $feeAmount;
        }

        return round($profit, 16);
    }

    private function extractFeeDetail(array $order): array
    {
        $detail = $order['cumFeeDetail'] ?? null;

        if (is_string($detail)) {
            $decoded = json_decode($detail, true);
            if (is_array($decoded) && $decoded !== []) {
                $currency = array_key_first($decoded);
                return [
                    'currency' => $currency,
                    'amount' => (float)$decoded[$currency],
                ];
            }
        }

        if (is_array($detail) && $detail !== []) {
            $currency = array_key_first($detail);
            return [
                'currency' => $currency,
                'amount' => (float)$detail[$currency],
            ];
        }

        return [];
    }
}
