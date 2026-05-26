<?php

namespace App\Services\ExchangeEngine;

use App\Models\ExchangeRequest;
use App\Services\ExchangeRouting\ExchangeExecutionRoutingService;
use App\Traits\SendNotification;
use App\Services\ExchangePipeline\ExchangePayoutService;
use Facades\App\Services\BasicService;
use Illuminate\Support\Facades\DB;
use Throwable;

class ExchangeAutomationService
{
    use SendNotification;

    public function __construct(
        private readonly ExchangeQuoteService $quoteService,
        private readonly BybitClient $bybitClient,
        private readonly ExchangePayoutService $payoutService,
        private readonly ExchangeExecutionRoutingService $routingService,
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

        $exchange = $this->routingService->routeConfirmedDeposit($exchange);

        if ($exchange->execution_route === 'internal_match') {
            return $this->handleInternalMatch($exchange);
        }

        if ($exchange->execution_route === 'manual_review') {
            return false;
        }

        if (in_array($exchange->hedge_status, ['processing', 'filled', 'payout_sent', 'payout_queued'], true)) {
            return (int)$exchange->status === 3;
        }

        if (!$this->quoteService->supportsExchangeEngine($exchange->sendCurrency, $exchange->getCurrency)) {
            $this->routingService->markManualReview(
                $exchange,
                'No internal match was found and the external hedge engine does not support this pair yet.'
            );

            return false;
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

    private function handleInternalMatch(ExchangeRequest $exchange): bool
    {
        $matchedExchangeId = (int) $exchange->matched_exchange_request_id;
        if ($matchedExchangeId <= 0) {
            return false;
        }

        try {
            return DB::transaction(function () use ($exchange, $matchedExchangeId) {
                $pair = ExchangeRequest::query()
                    ->with(['sendCurrency', 'getCurrency', 'cryptoMethod', 'matchedExchange.sendCurrency', 'matchedExchange.getCurrency', 'matchedExchange.cryptoMethod'])
                    ->whereIn('id', [$exchange->id, $matchedExchangeId])
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');

                /** @var ExchangeRequest|null $primary */
                $primary = $pair->get($exchange->id);
                /** @var ExchangeRequest|null $matched */
                $matched = $pair->get($matchedExchangeId);

                if (!$primary || !$matched) {
                    return false;
                }

                if (in_array($primary->hedge_status, ['payout_queued', 'payout_sent'], true)) {
                    return true;
                }

                if (
                    (int) $primary->status !== 2
                    || (int) $matched->status !== 2
                    || !$primary->isAmlApproved()
                    || !$matched->isAmlApproved()
                ) {
                    return false;
                }

                if (
                    blank($primary->destination_wallet)
                    || blank($matched->destination_wallet)
                    || (int) $primary->send_currency_id !== (int) $matched->get_currency_id
                    || (int) $primary->get_currency_id !== (int) $matched->send_currency_id
                ) {
                    return false;
                }

                if (
                    $this->payoutService->canAutoPayout($primary) !== true
                    || $this->payoutService->canAutoPayout($matched) !== true
                ) {
                    return false;
                }

                if (
                    (bool) config('exchange_pipeline.routing.require_async_payout_for_auto_match', true)
                    && (
                        !$this->payoutService->isAsyncPayout($primary)
                        || !$this->payoutService->isAsyncPayout($matched)
                    )
                ) {
                    $this->routingService->markManualReview(
                        $primary,
                        'Internal match found, but automatic completion requires an async treasury payout provider.'
                    );
                    $this->routingService->markManualReview(
                        $matched,
                        'Internal match found, but automatic completion requires an async treasury payout provider.'
                    );

                    return false;
                }

                $primary->hedge_status = 'internal_match_processing';
                $matched->hedge_status = 'internal_match_processing';
                $primary->save();
                $matched->save();

                $primarySent = $this->payoutService->sendExchangePayout($primary);
                $matchedSent = $this->payoutService->sendExchangePayout($matched);

                if (!$primarySent || !$matchedSent) {
                    $primary->hedge_status = 'failed';
                    $matched->hedge_status = 'failed';
                    $primary->hedge_error = 'Internal match was found, but one of the payouts could not be queued.';
                    $matched->hedge_error = 'Internal match was found, but one of the payouts could not be queued.';
                    $primary->save();
                    $matched->save();

                    return false;
                }

                $primary->profit_currency = optional($primary->sendCurrency)->code;
                $primary->profit_amount = round(
                    (float) ($primary->deposit_amount_confirmed ?: $primary->send_amount) - (float) $matched->final_amount,
                    16
                );
                $matched->profit_currency = optional($matched->sendCurrency)->code;
                $matched->profit_amount = round(
                    (float) ($matched->deposit_amount_confirmed ?: $matched->send_amount) - (float) $primary->final_amount,
                    16
                );
                $primary->hedged_at = now();
                $matched->hedged_at = now();

                $primary->hedge_status = 'payout_queued';
                $matched->hedge_status = 'payout_queued';
                $primary->save();
                $matched->save();

                $this->sendAdminNotification($primary->fresh(), 'exchange');
                $this->sendAdminNotification($matched->fresh(), 'exchange');

                return true;
            });
        } catch (Throwable $exception) {
            report($exception);

            $exchange->hedge_status = 'failed';
            $exchange->hedge_error = $exception->getMessage();
            $exchange->save();

            return false;
        }
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
