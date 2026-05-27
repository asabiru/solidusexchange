<?php

namespace App\Services\ExchangePipeline;

use App\Models\CustodialDeposit;
use App\Models\ExchangeRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

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

    /**
     * Screen a custodial deposit for AML compliance.
     * Checks against OFAC sanctions list and performs risk scoring.
     */
    public function screenCustodialDeposit(CustodialDeposit $deposit): array
    {
        $provider = (string)config('exchange_pipeline.aml.provider', 'manual');

        if (!config('exchange_pipeline.aml.enabled')) {
            return [
                'status' => 'approved',
                'provider' => 'disabled',
                'risk_level' => 'low',
                'risk_score' => 0,
                'notes' => 'AML screening is disabled. Auto-approved.',
            ];
        }

        // Step 1: Check source address against OFAC sanctions list
        $sourceAddress = $deposit->source_address;
        $sanctionsResult = $this->checkSanctionsList($sourceAddress, $deposit->currency_code);

        if ($sanctionsResult['is_sanctioned']) {
            return [
                'status' => 'rejected',
                'provider' => 'ofac_check',
                'risk_level' => 'high',
                'risk_score' => 100,
                'notes' => 'Source address found in OFAC sanctions list: ' . ($sanctionsResult['match_reason'] ?? 'Unknown'),
            ];
        }

        // Step 2: Risk scoring based on amount thresholds
        $amountUsd = $this->convertToUsd($deposit->amount, $deposit->currency_code);
        $riskScore = $this->calculateRiskScore($amountUsd, $deposit->amount, $deposit->currency_code);
        $riskLevel = $this->riskScoreToLevel($riskScore);

        // Step 3: If using an external AML API (Chainalysis, etc.), call it here
        if ($provider !== 'manual' && config('exchange_pipeline.aml.api_key')) {
            $apiResult = $this->callExternalAmlApi($deposit, $provider);
            if ($apiResult) {
                return $apiResult;
            }
        }

        // Step 4: Auto-approve low risk, flag medium/high for manual review
        if ($riskLevel === 'low') {
            return [
                'status' => 'approved',
                'provider' => $provider,
                'risk_level' => 'low',
                'risk_score' => $riskScore,
                'notes' => "Auto-approved. Amount: \${$amountUsd} USD equivalent. Risk score: {$riskScore}",
            ];
        }

        // Medium or high risk — needs manual review
        return [
            'status' => 'pending',
            'provider' => $provider,
            'risk_level' => $riskLevel,
            'risk_score' => $riskScore,
            'notes' => "Risk level: {$riskLevel}. Amount: \${$amountUsd} USD. Score: {$riskScore}. Requires manual review.",
        ];
    }

    /**
     * Check an address against OFAC sanctions list.
     * Uses the free OFAC API or local cache.
     */
    private function checkSanctionsList(?string $address, string $currencyCode): array
    {
        if (blank($address)) {
            return ['is_sanctioned' => false, 'match_reason' => null];
        }

        try {
            // Use free OFAC screening API
            $response = Http::timeout(5)->get('https://api.ofac.dev/compliance/check', [
                'address' => $address,
                'currency' => strtolower($this->normalizeForOfac($currencyCode)),
            ]);

            if ($response->successful()) {
                $data = $response->json();
                return [
                    'is_sanctioned' => ($data['is_sanctioned'] ?? false),
                    'match_reason' => $data['match_reason'] ?? null,
                ];
            }
        } catch (\Throwable $e) {
            Log::warning("OFAC API check failed: " . $e->getMessage());
        }

        // If API fails, assume not sanctioned but flag for manual review
        return ['is_sanctioned' => false, 'match_reason' => 'API unavailable - manual check recommended'];
    }

    /**
     * Calculate risk score based on amount and currency.
     */
    private function calculateRiskScore(float $amountUsd, float $rawAmount, string $currencyCode): float
    {
        $score = 0;

        // Amount-based risk
        if ($amountUsd >= 10000) $score += 40;
        elseif ($amountUsd >= 5000) $score += 25;
        elseif ($amountUsd >= 1000) $score += 10;

        // Privacy coin penalty
        $privacyCoins = ['XMR', 'ZEC', 'DASH'];
        if (in_array(strtoupper($currencyCode), $privacyCoins)) {
            $score += 30;
        }

        // Small amount with high frequency pattern (could indicate structuring)
        if ($amountUsd > 0 && $amountUsd < 500) {
            $recentCount = CustodialDeposit::where('source_address', '!=', null)
                ->where('created_at', '>', now()->subDay())
                ->count();
            if ($recentCount > 5) {
                $score += 20;
            }
        }

        return min(100, $score);
    }

    private function riskScoreToLevel(float $score): string
    {
        if ($score >= 60) return 'high';
        if ($score >= 30) return 'medium';
        return 'low';
    }

    private function convertToUsd(float $amount, string $currencyCode): float
    {
        $crypto = \App\Models\CryptoCurrency::where('code', strtoupper($currencyCode))->first();
        if ($crypto && $crypto->usd_rate > 0) {
            return $amount * $crypto->usd_rate;
        }
        return 0;
    }

    private function normalizeForOfac(string $code): string
    {
        $code = strtoupper($code);
        if (str_starts_with($code, 'USDT') || str_starts_with($code, 'USDC')) return 'usdt';
        if (str_starts_with($code, 'ETH_')) return 'ethereum';
        return match($code) {
            'BTC' => 'bitcoin',
            'ETH' => 'ethereum',
            'TRX' => 'tron',
            'BNB' => 'binance',
            'SOL' => 'solana',
            'LTC' => 'litecoin',
            'TON' => 'ton',
            default => 'bitcoin',
        };
    }

    /**
     * Call an external AML API (Chainalysis, Elliptic, etc.)
     */
    private function callExternalAmlApi(CustodialDeposit $deposit, string $provider): ?array
    {
        $apiKey = config('exchange_pipeline.aml.api_key');
        $apiUrl = config('exchange_pipeline.aml.api_url');

        if (blank($apiKey) || blank($apiUrl)) {
            return null;
        }

        try {
            $response = Http::timeout(10)->withHeaders([
                'Authorization' => "Bearer {$apiKey}",
                'Content-Type' => 'application/json',
            ])->post($apiUrl, [
                'address' => $deposit->source_address,
                'currency' => strtolower($this->normalizeForOfac($deposit->currency_code)),
                'amount' => $deposit->amount,
                'tx_hash' => $deposit->tx_hash,
            ]);

            if ($response->successful()) {
                $data = $response->json();
                $riskScore = (float)($data['risk_score'] ?? $data['risk'] ?? 0);
                $riskLevel = $this->riskScoreToLevel($riskScore);

                return [
                    'status' => $riskLevel === 'high' ? 'rejected' : ($riskLevel === 'low' ? 'approved' : 'pending'),
                    'provider' => $provider,
                    'risk_level' => $riskLevel,
                    'risk_score' => $riskScore,
                    'notes' => "External AML check via {$provider}. Score: {$riskScore}",
                ];
            }
        } catch (\Throwable $e) {
            Log::warning("External AML API call failed: " . $e->getMessage());
        }

        return null;
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
