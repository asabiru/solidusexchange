<?php

namespace App\Services\ExchangeRouting;

use App\Models\ExchangeRequest;
use Illuminate\Support\Collection;

class ExchangeExecutionRoutingService
{
    public function routeConfirmedDeposit(ExchangeRequest $exchange): ExchangeRequest
    {
        $exchange->loadMissing(['sendCurrency', 'getCurrency']);

        if ($exchange->execution_route === 'internal_match' && (int) $exchange->matched_exchange_request_id > 0) {
            return $exchange;
        }

        if (!$exchange->isAmlApproved()) {
            return $this->applyRoute($exchange, 'manual_review', null, 'Exchange is waiting for AML approval.');
        }

        if (!$this->isWithinNettingWindow($exchange)) {
            return $this->applyRoute($exchange, 'external_hedge', null, 'Internal netting window has expired for this exchange.');
        }

        if (!(bool) config('exchange_pipeline.routing.internal_matching_enabled', true)) {
            return $this->applyRoute($exchange, 'external_hedge', null, 'Internal matching is disabled.');
        }

        $matchedExchange = $this->findInternalMatch($exchange);

        if (!$matchedExchange) {
            return $this->applyRoute($exchange, 'external_hedge', null, 'No internal counter-flow was available for this exchange.');
        }

        $note = "Matched internally with exchange {$matchedExchange->utr}.";

        $this->applyRoute($matchedExchange, 'internal_match', $exchange->id, "Matched internally with exchange {$exchange->utr}.");

        return $this->applyRoute($exchange, 'internal_match', $matchedExchange->id, $note);
    }

    public function markManualReview(ExchangeRequest $exchange, string $notes): ExchangeRequest
    {
        return $this->applyRoute($exchange, 'manual_review', $exchange->matched_exchange_request_id, $notes);
    }

    private function findInternalMatch(ExchangeRequest $exchange): ?ExchangeRequest
    {
        return $this->candidateMatches($exchange)->first(function (ExchangeRequest $candidate) use ($exchange) {
            return $this->canInternallyMatch($exchange, $candidate);
        });
    }

    private function candidateMatches(ExchangeRequest $exchange): Collection
    {
        return ExchangeRequest::query()
            ->with(['sendCurrency', 'getCurrency', 'cryptoMethod'])
            ->where('id', '!=', $exchange->id)
            ->where('status', 2)
            ->whereNotNull('destination_wallet')
            ->where('send_currency_id', $exchange->get_currency_id)
            ->where('get_currency_id', $exchange->send_currency_id)
            ->where(function ($query) {
                $query->whereNull('matched_exchange_request_id')
                    ->orWhere('matched_exchange_request_id', 0);
            })
            ->where(function ($query) {
                $query->whereNull('hedge_status')
                    ->orWhereIn('hedge_status', ['failed']);
            })
            ->where(function ($query) {
                $query->whereNull('aml_status')
                    ->orWhere('aml_status', 'approved');
            })
            ->whereNotNull('deposit_confirmed_at')
            ->where('deposit_confirmed_at', '>=', now()->subMinutes($this->nettingWindowMinutes()))
            ->orderBy('created_at')
            ->get();
    }

    private function canInternallyMatch(ExchangeRequest $exchange, ExchangeRequest $candidate): bool
    {
        if (!$candidate->isAmlApproved()) {
            return false;
        }

        if ((int) $candidate->status !== 2 || blank($candidate->destination_wallet)) {
            return false;
        }

        $exchangeDepositAmount = (float) ($exchange->deposit_amount_confirmed ?: $exchange->send_amount);
        $candidateDepositAmount = (float) ($candidate->deposit_amount_confirmed ?: $candidate->send_amount);

        return $exchangeDepositAmount + 0.00000001 >= (float) $candidate->final_amount
            && $candidateDepositAmount + 0.00000001 >= (float) $exchange->final_amount;
    }

    private function isWithinNettingWindow(ExchangeRequest $exchange): bool
    {
        $confirmedAt = $exchange->deposit_confirmed_at;

        if (!$confirmedAt) {
            return false;
        }

        return $confirmedAt->greaterThanOrEqualTo(now()->subMinutes($this->nettingWindowMinutes()));
    }

    private function nettingWindowMinutes(): int
    {
        return max(1, (int) config('exchange_pipeline.routing.netting_window_minutes', 15));
    }

    private function applyRoute(
        ExchangeRequest $exchange,
        string $route,
        ?int $matchedExchangeId,
        ?string $notes
    ): ExchangeRequest {
        $exchange->execution_route = $route;
        $exchange->matched_exchange_request_id = $matchedExchangeId;
        $exchange->execution_notes = $notes;
        $exchange->routed_at = now();
        $exchange->save();

        return $exchange->fresh(['sendCurrency', 'getCurrency', 'cryptoMethod']);
    }
}
