<?php

namespace App\Services\ExchangePipeline;

use App\Models\AmlScreeningLog;
use App\Models\CustodialDeposit;
use App\Models\ExchangeRequest;
use App\Models\SanctionedAddress;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ExchangeAmlService
{
    private const WALLET_SUMMARY_PROVIDER = 'wallet_screening';
    private const WALLET_OVERRIDE_PROVIDER = 'manual_wallet_review';

    // ─── Sources of sanctions lists ────────────────────────────────────────
    public const SOURCE_OFAC       = 'ofac';        // US Treasury OFAC SDN
    public const SOURCE_EU         = 'eu';          // EU sanctions
    public const SOURCE_UK         = 'uk';          // UK OFSI
    public const SOURCE_UN         = 'un';          // UN Security Council
    public const SOURCE_RUSSIA_CB  = 'russia_cb';   // ЦБ РФ перечень
    public const SOURCE_RUSSIA_MIN = 'russia_min';  // Минфин РФ
    public const SOURCE_MANUAL     = 'manual';      // Admin-added

    // ─── Known sanctioned exchange entity names ────────────────────────────
    private const SANCTIONED_EXCHANGES = [
        'Garantex', 'Suex', 'Chatex', 'Bitzlato', 'Nobitex',
        'Hydra', 'Blender.io', 'Tornado Cash', 'Sinve',
    ];

    // ═══════════════════════════════════════════════════════════════════════
    //  LEGACY: ExchangeRequest screening
    // ═══════════════════════════════════════════════════════════════════════

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

        $linkedDeposit = $this->findLinkedCustodialDeposit($exchange, $meta);

        if ($linkedDeposit && $linkedDeposit->isAmlRejected()) {
            $notes = 'Linked custodial deposit was rejected by AML review. Exchange is blocked until manually resolved.';
            $this->applyDecision(
                $exchange,
                'rejected',
                $linkedDeposit->aml_provider ?: 'custodial_deposit',
                'high',
                $linkedDeposit->aml_risk_score !== null ? (float) $linkedDeposit->aml_risk_score : 100.0,
                $notes
            );

            return [
                'status' => 'rejected',
                'should_block_processing' => true,
                'notes' => $notes,
            ];
        }

        if ($linkedDeposit && ($linkedDeposit->isAmlApproved() || in_array($linkedDeposit->status, ['aml_approved', 'processed'], true))) {
            $notes = $linkedDeposit->aml_notes ?: 'Approved via linked custodial deposit AML screening.';
            $this->applyDecision(
                $exchange,
                'approved',
                $linkedDeposit->aml_provider ?: 'custodial_deposit',
                $linkedDeposit->aml_risk_level ?: 'low',
                $linkedDeposit->aml_risk_score !== null ? (float) $linkedDeposit->aml_risk_score : null,
                $notes
            );

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

    public function approveExchange(ExchangeRequest $exchange, string $notes = ''): void
    {
        $riskLevel = in_array($exchange->aml_risk_level, ['low', 'medium'], true)
            ? $exchange->aml_risk_level
            : 'medium';

        $message = trim(implode(' ', array_filter([
            'Manually approved by admin.',
            trim($notes),
        ])));

        $this->applyDecision(
            $exchange,
            'approved',
            'manual_admin',
            $riskLevel,
            $exchange->aml_risk_score !== null ? (float) $exchange->aml_risk_score : null,
            $message
        );
    }

    public function rejectExchange(ExchangeRequest $exchange, string $notes = ''): void
    {
        $message = trim(implode(' ', array_filter([
            'Manually rejected by admin.',
            trim($notes),
        ])));

        $this->applyDecision(
            $exchange,
            'rejected',
            'manual_admin',
            'high',
            $exchange->aml_risk_score !== null ? max((float) $exchange->aml_risk_score, 80.0) : 100.0,
            $message
        );
    }

    public function screenWalletAddress(string $address, string $currencyCode, array $context = []): array
    {
        $provider = (string) config('exchange_pipeline.aml.provider', 'manual');
        $screenable = $context['screenable'] ?? null;
        $direction = $context['direction'] ?? 'wallet';
        $amount = isset($context['amount']) ? (float) $context['amount'] : null;

        if ($override = $this->resolveWalletOverride($screenable, $address)) {
            return $override;
        }

        if (!config('exchange_pipeline.aml.enabled')) {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status' => 'approved',
                'provider' => 'disabled',
                'risk_level' => 'low',
                'risk_score' => 0,
                'notes' => ucfirst($direction) . ' screening is disabled. Auto-approved.',
            ]);
        }

        $localResult = $this->checkLocalSanctionsDb($address, $currencyCode);
        $this->logScreeningIfPossible($screenable, $address, $currencyCode, 'internal_db', $localResult);

        if ($localResult['result'] === 'match' && $localResult['severity'] === 'blocked') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status' => 'rejected',
                'provider' => 'internal_db',
                'risk_level' => 'high',
                'risk_score' => 100,
                'notes' => ucfirst($direction) . ' address is listed in the sanctions database. '
                    . ($localResult['entity_name'] ?? 'Unknown entity') . '. '
                    . ($localResult['reason'] ?? ''),
            ]);
        }

        if ($localResult['result'] === 'partial_match' || $localResult['severity'] === 'high_risk') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status' => 'pending',
                'provider' => 'internal_db',
                'risk_level' => 'high',
                'risk_score' => 75,
                'notes' => ucfirst($direction) . ' address is flagged for enhanced AML review. '
                    . ($localResult['reason'] ?? ''),
            ]);
        }

        $ofacResult = $this->checkOfacApi($address, $currencyCode);
        $this->logScreeningIfPossible($screenable, $address, $currencyCode, 'ofac_api', $ofacResult);

        if (($ofacResult['result'] ?? null) === 'match') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status' => 'rejected',
                'provider' => 'ofac_check',
                'risk_level' => 'high',
                'risk_score' => 100,
                'notes' => ucfirst($direction) . ' address is listed in OFAC sanctions data. '
                    . ($ofacResult['reason'] ?? ''),
            ]);
        }

        if ($provider !== 'manual' && config('exchange_pipeline.aml.api_key')) {
            $apiResult = $this->callExternalAddressAmlApi($address, $currencyCode, $provider, $amount, $screenable);
            if ($apiResult) {
                return $this->finalizeWalletDecision($screenable, $address, $currencyCode, $apiResult);
            }
        }

        return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
            'status' => 'approved',
            'provider' => $provider,
            'risk_level' => 'low',
            'risk_score' => 0,
            'notes' => ucfirst($direction) . ' address passed the available AML checks.',
        ]);
    }

    public function latestWalletDecision($screenable, ?string $address): ?AmlScreeningLog
    {
        if (!$screenable || !isset($screenable->id) || blank($address)) {
            return null;
        }

        return AmlScreeningLog::query()
            ->where('screenable_type', get_class($screenable))
            ->where('screenable_id', $screenable->id)
            ->where('address', $address)
            ->whereIn('provider', [self::WALLET_SUMMARY_PROVIDER, self::WALLET_OVERRIDE_PROVIDER])
            ->latest('id')
            ->first();
    }

    public function approveWalletAddress($screenable, string $address, string $currencyCode, string $notes = ''): void
    {
        $this->recordWalletOverride($screenable, $address, $currencyCode, 'approved', $notes);
    }

    public function rejectWalletAddress($screenable, string $address, string $currencyCode, string $notes = ''): void
    {
        $this->recordWalletOverride($screenable, $address, $currencyCode, 'rejected', $notes);
    }

    public function walletDecisionState(?AmlScreeningLog $decision): string
    {
        if (!$decision) {
            return 'not_checked';
        }

        if ($decision->result === 'clean') {
            return 'approved';
        }

        if ($decision->result === 'match') {
            return 'rejected';
        }

        return 'pending';
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CUSTODIAL DEPOSIT SCREENING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Screen a custodial deposit for AML compliance.
     * Multi-layer check: local DB → OFAC API → risk scoring → external API.
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

        $sourceAddress = $deposit->source_address;
        $currencyCode = $deposit->currency_code;

        // ─── Step 1: Check local sanctions database ────────────────────────
        $localResult = $this->checkLocalSanctionsDb($sourceAddress, $currencyCode);
        $this->logScreening($deposit, $sourceAddress, $currencyCode, 'internal_db', $localResult);

        if ($localResult['result'] === 'match' && $localResult['severity'] === 'blocked') {
            return [
                'status' => 'rejected',
                'provider' => 'internal_db',
                'risk_level' => 'high',
                'risk_score' => 100,
                'notes' => 'BLOCKED: Source address found in sanctions list — '
                    . ($localResult['entity_name'] ?? 'Unknown entity')
                    . ' (' . ($localResult['source'] ?? 'unknown source') . '). '
                    . ($localResult['reason'] ?? ''),
            ];
        }

        // ─── Step 2: Check OFAC API (if available) ──────────────────────────
        $ofacResult = $this->checkOfacApi($sourceAddress, $currencyCode);
        $this->logScreening($deposit, $sourceAddress, $currencyCode, 'ofac_api', $ofacResult);

        if ($ofacResult['result'] === 'match') {
            // Auto-add to local DB for future fast checks
            $this->autoAddSanctionedAddress($sourceAddress, $currencyCode, self::SOURCE_OFAC,
                $ofacResult['entity_name'] ?? null, $ofacResult['reason'] ?? null);

            return [
                'status' => 'rejected',
                'provider' => 'ofac_check',
                'risk_level' => 'high',
                'risk_score' => 100,
                'notes' => 'BLOCKED: Address found in OFAC SDN list — '
                    . ($ofacResult['entity_name'] ?? 'Unknown') . '. '
                    . ($ofacResult['reason'] ?? ''),
            ];
        }

        // If OFAC API was unreachable, bump risk score slightly
        $ofacApiPenalty = 0;
        if (($ofacResult['result'] ?? '') === 'error') {
            $ofacApiPenalty = 5; // Small penalty for inability to verify externally
        }

        // ─── Step 3: Partial match from local DB → high risk ────────────────
        if ($localResult['result'] === 'partial_match' || $localResult['severity'] === 'high_risk') {
            return [
                'status' => 'pending',
                'provider' => 'internal_db',
                'risk_level' => 'high',
                'risk_score' => 75,
                'notes' => 'HIGH RISK: Address flagged — '
                    . ($localResult['entity_name'] ?? 'Unknown') . '. '
                    . ($localResult['reason'] ?? 'Requires manual review.'),
            ];
        }

        // ─── Step 4: Risk scoring based on amount and patterns ──────────────
        $amountUsd = $this->convertToUsd($deposit->amount, $currencyCode);
        $riskScore = $this->calculateRiskScore($amountUsd, $deposit->amount, $currencyCode, $sourceAddress);
        $riskScore += $ofacApiPenalty;
        $riskLevel = $this->riskScoreToLevel($riskScore);

        // ─── Step 5: External AML API (Chainalysis, Elliptic, etc.) ─────────
        if ($provider !== 'manual' && config('exchange_pipeline.aml.api_key')) {
            $apiResult = $this->callExternalAmlApi($deposit, $provider);
            if ($apiResult) {
                return $apiResult;
            }
        }

        // ─── Step 6: Auto-approve low risk, flag medium/high ────────────────
        if ($riskLevel === 'low') {
            return [
                'status' => 'approved',
                'provider' => $provider,
                'risk_level' => 'low',
                'risk_score' => $riskScore,
                'notes' => "Auto-approved. Amount: \${$amountUsd} USD equivalent. Risk score: {$riskScore}",
            ];
        }

        return [
            'status' => 'pending',
            'provider' => $provider,
            'risk_level' => $riskLevel,
            'risk_score' => $riskScore,
            'notes' => "Risk level: {$riskLevel}. Amount: \${$amountUsd} USD. Score: {$riskScore}. Requires manual review.",
        ];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LOCAL SANCTIONS DATABASE CHECK
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Check address against the local sanctioned_addresses table.
     * This covers: OFAC, EU, UK, UN, ЦБ РФ, Минфин РФ, and admin-added entries.
     */
    private function checkLocalSanctionsDb(?string $address, string $currencyCode): array
    {
        if (blank($address)) {
            return ['result' => 'clean', 'severity' => null, 'entity_name' => null, 'source' => null, 'reason' => null];
        }

        $normalized = SanctionedAddress::normalizeAddress($address);

        // Check for exact match
        $match = SanctionedAddress::active()
            ->where('address', $normalized)
            ->forCurrency($currencyCode)
            ->orderByRaw("
                CASE severity
                    WHEN 'blocked' THEN 3
                    WHEN 'high_risk' THEN 2
                    WHEN 'monitor' THEN 1
                    ELSE 0
                END DESC
            ")
            ->first();

        if ($match) {
            return [
                'result'      => 'match',
                'severity'    => $match->severity,
                'entity_name' => $match->entity_name,
                'source'      => $match->source,
                'reason'      => $match->reason,
                'sanctioned_id' => $match->id,
            ];
        }

        // Check for partial match (prefix match for HD wallet groups)
        // e.g. if we know a range of addresses belongs to a sanctioned entity
        $prefix = substr($normalized, 0, 8);
        $partialMatch = SanctionedAddress::active()
            ->where('address', 'LIKE', $prefix . '%')
            ->where('severity', 'monitor')
            ->forCurrency($currencyCode)
            ->first();

        if ($partialMatch) {
            return [
                'result'      => 'partial_match',
                'severity'    => $partialMatch->severity,
                'entity_name' => $partialMatch->entity_name,
                'source'      => $partialMatch->source,
                'reason'      => $partialMatch->reason,
            ];
        }

        return ['result' => 'clean', 'severity' => null, 'entity_name' => null, 'source' => null, 'reason' => null];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  OFAC API CHECK
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Check address against OFAC SDN list via API.
     */
    private function checkOfacApi(?string $address, string $currencyCode): array
    {
        if (blank($address)) {
            return ['result' => 'clean', 'entity_name' => null, 'reason' => null];
        }

        try {
            $response = Http::timeout(5)->get('https://api.ofac.dev/compliance/check', [
                'address'  => $address,
                'currency' => strtolower($this->normalizeForOfac($currencyCode)),
            ]);

            if ($response->successful()) {
                $data = $response->json();
                $isSanctioned = $data['is_sanctioned'] ?? false;

                if ($isSanctioned) {
                    return [
                        'result'      => 'match',
                        'entity_name' => $data['entity_name'] ?? $data['match_reason'] ?? null,
                        'reason'      => $data['match_reason'] ?? 'Found in OFAC SDN list',
                    ];
                }
            }
        } catch (\Throwable $e) {
            Log::warning("OFAC API check failed: " . $e->getMessage());
        }

        // If API fails, return error status (not clean — we couldn't verify)
        return ['result' => 'error', 'entity_name' => null, 'reason' => 'OFAC API unavailable'];
    }

    /**
     * Auto-add a sanctioned address found via API to local DB for faster future checks.
     */
    private function autoAddSanctionedAddress(string $address, string $currencyCode, string $source, ?string $entityName, ?string $reason): void
    {
        try {
            $normalized = SanctionedAddress::normalizeAddress($address);

            SanctionedAddress::firstOrCreate(
                ['address' => $normalized, 'source' => $source],
                [
                    'currency_code' => strtoupper($currencyCode),
                    'entity_name'   => $entityName,
                    'entity_type'   => 'exchange',
                    'reason'        => $reason ?? 'Auto-imported from ' . $source,
                    'severity'      => 'blocked',
                    'status'        => 'active',
                    'list_date'     => now()->toDateString(),
                ]
            );
        } catch (\Throwable $e) {
            Log::warning("Failed to auto-add sanctioned address: " . $e->getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RISK SCORING
    // ═══════════════════════════════════════════════════════════════════════

    private function calculateRiskScore(float $amountUsd, float $rawAmount, string $currencyCode, ?string $sourceAddress): float
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

        // Structuring pattern: many small deposits from same address
        if ($sourceAddress && $amountUsd > 0 && $amountUsd < 500) {
            $recentCount = CustodialDeposit::where('source_address', $sourceAddress)
                ->where('created_at', '>', now()->subDay())
                ->count();
            if ($recentCount > 5) {
                $score += 20;
            }
        }

        // First-time address (no history) — slight risk bump
        if ($sourceAddress) {
            $historyCount = CustodialDeposit::where('source_address', $sourceAddress)->count();
            if ($historyCount <= 1) {
                $score += 5;
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

    // ═══════════════════════════════════════════════════════════════════════
    //  SCREENING LOG
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Log a screening check result.
     */
    private function logScreening($screenable, string $address, string $currencyCode, string $provider, array $result): AmlScreeningLog
    {
        return AmlScreeningLog::create([
            'screenable_type' => get_class($screenable),
            'screenable_id'   => $screenable->id,
            'address'         => $address,
            'currency_code'   => $currencyCode,
            'provider'        => $provider,
            'result'          => $result['result'] ?? 'error',
            'matched_entity'  => $result['entity_name'] ?? null,
            'matched_source'  => $result['source'] ?? null,
            'risk_score'      => ($result['result'] ?? '') === 'match' ? 100 : ($result['risk_score'] ?? 0),
            'details'         => json_encode($result),
            'checked_at'      => now(),
        ]);
    }

    private function logScreeningIfPossible($screenable, string $address, string $currencyCode, string $provider, array $result): void
    {
        if (!$screenable || !isset($screenable->id)) {
            return;
        }

        $this->logScreening($screenable, $address, $currencyCode, $provider, $result);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  EXTERNAL AML API
    // ═══════════════════════════════════════════════════════════════════════

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
                'address'  => $deposit->source_address,
                'currency' => strtolower($this->normalizeForOfac($deposit->currency_code)),
                'amount'   => $deposit->amount,
                'tx_hash'  => $deposit->tx_hash,
            ]);

            if ($response->successful()) {
                $data = $response->json();
                $riskScore = (float)($data['risk_score'] ?? $data['risk'] ?? 0);
                $riskLevel = $this->riskScoreToLevel($riskScore);

                $this->logScreening($deposit, $deposit->source_address, $deposit->currency_code, $provider, [
                    'result'      => $riskLevel === 'high' ? 'match' : 'clean',
                    'entity_name' => $data['entity'] ?? null,
                    'risk_score'  => $riskScore,
                ]);

                return [
                    'status'     => $riskLevel === 'high' ? 'rejected' : ($riskLevel === 'low' ? 'approved' : 'pending'),
                    'provider'   => $provider,
                    'risk_level' => $riskLevel,
                    'risk_score' => $riskScore,
                    'notes'      => "External AML check via {$provider}. Score: {$riskScore}",
                ];
            }
        } catch (\Throwable $e) {
            Log::warning("External AML API call failed: " . $e->getMessage());
        }

        return null;
    }

    private function finalizeWalletDecision($screenable, string $address, string $currencyCode, array $decision): array
    {
        $summaryResult = match ($decision['status'] ?? 'pending') {
            'approved' => 'clean',
            'rejected' => 'match',
            default => 'partial_match',
        };

        $this->logScreeningIfPossible($screenable, $address, $currencyCode, self::WALLET_SUMMARY_PROVIDER, [
            'result' => $summaryResult,
            'entity_name' => $decision['provider'] ?? null,
            'source' => $decision['provider'] ?? null,
            'risk_score' => $decision['risk_score'] ?? null,
            'status' => $decision['status'] ?? 'pending',
            'notes' => $decision['notes'] ?? null,
        ]);

        return $decision;
    }

    private function resolveWalletOverride($screenable, string $address): ?array
    {
        if (!$screenable || !isset($screenable->id) || blank($address)) {
            return null;
        }

        $override = AmlScreeningLog::query()
            ->where('screenable_type', get_class($screenable))
            ->where('screenable_id', $screenable->id)
            ->where('address', $address)
            ->where('provider', self::WALLET_OVERRIDE_PROVIDER)
            ->latest('id')
            ->first();

        if (!$override) {
            return null;
        }

        $details = json_decode((string) $override->details, true) ?: [];
        $status = $details['status'] ?? ($override->result === 'clean' ? 'approved' : 'rejected');
        $riskLevel = $status === 'approved' ? 'low' : 'high';

        return [
            'status' => $status,
            'provider' => self::WALLET_OVERRIDE_PROVIDER,
            'risk_level' => $riskLevel,
            'risk_score' => $status === 'approved' ? 0 : 100,
            'notes' => $details['notes'] ?? ($status === 'approved'
                ? 'Destination wallet approved by admin review.'
                : 'Destination wallet rejected by admin review.'),
        ];
    }

    private function recordWalletOverride($screenable, string $address, string $currencyCode, string $status, string $notes = ''): void
    {
        if (!$screenable || !isset($screenable->id)) {
            return;
        }

        $result = $status === 'approved' ? 'clean' : 'match';

        $this->logScreening(
            $screenable,
            $address,
            $currencyCode,
            self::WALLET_OVERRIDE_PROVIDER,
            [
                'result' => $result,
                'entity_name' => 'Admin review',
                'source' => self::WALLET_OVERRIDE_PROVIDER,
                'risk_score' => $status === 'approved' ? 0 : 100,
                'status' => $status,
                'notes' => trim($notes) ?: ($status === 'approved'
                    ? 'Destination wallet approved by admin.'
                    : 'Destination wallet rejected by admin.'),
            ]
        );
    }

    private function callExternalAddressAmlApi(
        string $address,
        string $currencyCode,
        string $provider,
        ?float $amount = null,
        $screenable = null
    ): ?array {
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
                'address' => $address,
                'currency' => strtolower($this->normalizeForOfac($currencyCode)),
                'amount' => $amount,
            ]);

            if (!$response->successful()) {
                return null;
            }

            $data = $response->json();
            $riskScore = (float) ($data['risk_score'] ?? $data['risk'] ?? 0);
            $riskLevel = $this->riskScoreToLevel($riskScore);
            $result = [
                'result' => $riskLevel === 'high' ? 'match' : ($riskLevel === 'medium' ? 'partial_match' : 'clean'),
                'entity_name' => $data['entity'] ?? null,
                'risk_score' => $riskScore,
                'source' => $provider,
            ];

            $this->logScreeningIfPossible($screenable, $address, $currencyCode, $provider, $result);

            if ($riskLevel === 'low') {
                return [
                    'status' => 'approved',
                    'provider' => $provider,
                    'risk_level' => 'low',
                    'risk_score' => $riskScore,
                    'notes' => "External AML screening via {$provider} marked the wallet as low risk.",
                ];
            }

            return [
                'status' => 'pending',
                'provider' => $provider,
                'risk_level' => $riskLevel,
                'risk_score' => $riskScore,
                'notes' => "External AML screening via {$provider} flagged the wallet for manual review.",
            ];
        } catch (\Throwable $e) {
            Log::warning("External AML wallet screening failed: " . $e->getMessage());
        }

        return null;
    }

    private function findLinkedCustodialDeposit(ExchangeRequest $exchange, array $meta = []): ?CustodialDeposit
    {
        $query = CustodialDeposit::query()
            ->where('exchange_request_id', $exchange->id)
            ->latest('id');

        $depositTxId = $meta['deposit_tx_id'] ?? null;
        if (filled($depositTxId)) {
            $query->where(function ($depositQuery) use ($depositTxId) {
                $depositQuery->where('tx_id', $depositTxId)
                    ->orWhere('tx_hash', $depositTxId);
            });
        }

        return $query->first();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  LEGACY: ExchangeRequest decision
    // ═══════════════════════════════════════════════════════════════════════

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
