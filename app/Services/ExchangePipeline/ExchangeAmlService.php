<?php

namespace App\Services\ExchangePipeline;

use App\Models\ExchangeRequest;

class ExchangeAmlService
{
    public function screenConfirmedDeposit(ExchangeRequest $exchange, array $meta = []): array
    {
        $provider = (string)config('exchange_pipeline.aml.provider', 'manual');

        if (!config('exchange_pipeline.aml.enabled')) {
            $notes = 'Exchange AML screening is disabled. Deposit passed through the legacy flow.';
            $this->applyDecision($exchange, 'approved', $provider ?: 'disabled', 'low', null, $notes);

            return [
                'status' => 'approved',
                'should_block_processing' => false,
                'notes' => $notes,
            ];
        }

        $notes = 'Manual AML review is required before hedge and payout.';
        $this->applyDecision($exchange, 'pending', $provider, 'unknown', null, $notes);

        return [
            'status' => 'pending',
            'should_block_processing' => (bool)config('exchange_pipeline.aml.auto_block_processing', true),
            'notes' => $notes,
        ];
    }

    private function applyDecision(
        ExchangeRequest $exchange,
        string $status,
        string $provider,
        ?string $riskLevel,
        ?float $riskScore,
        ?string $notes
    ): void {
        $exchange->aml_status = $status;
        $exchange->aml_provider = $provider;
        $exchange->aml_risk_level = $riskLevel;
        $exchange->aml_risk_score = $riskScore;
        $exchange->aml_notes = $notes;
        $exchange->aml_checked_at = now();
        $exchange->save();
    }
}
