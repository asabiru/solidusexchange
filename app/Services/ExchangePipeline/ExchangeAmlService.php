<?php

namespace App\Services\ExchangePipeline;

use App\Models\AmlScreeningLog;
use App\Models\CustodialDeposit;
use App\Models\ExchangeRequest;
use Illuminate\Support\Facades\Log;

class ExchangeAmlService
{
    // ─── Provider constants ────────────────────────────────────────────────
    private const PROVIDER_AMLBOT   = 'amlbot';
    private const PROVIDER_MANUAL   = 'manual';
    private const PROVIDER_DISABLED = 'disabled';

    // ═══════════════════════════════════════════════════════════════════════
    //  ExchangeRequest screening (called after deposit confirmation)
    // ═══════════════════════════════════════════════════════════════════════

    public function screenConfirmedDeposit(ExchangeRequest $exchange, array $meta = []): array
    {
        $provider = (string) config('exchange_pipeline.aml.provider', self::PROVIDER_MANUAL);

        if (!config('exchange_pipeline.aml.enabled')) {
            $notes = 'Exchange AML screening is disabled. Deposit passed through.';
            $this->applyDecision($exchange, 'approved', self::PROVIDER_DISABLED, 'low', null, $notes);

            return [
                'status'                => 'approved',
                'should_block_processing' => false,
                'notes'                 => $notes,
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
                'status'                => 'rejected',
                'should_block_processing' => true,
                'notes'                 => $notes,
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
                'status'                => 'approved',
                'should_block_processing' => false,
                'notes'                 => $notes,
            ];
        }

        $notes = 'Manual AML review is required before hedge and payout.';
        $this->applyDecision($exchange, 'pending', $provider, 'unknown', null, $notes);

        return [
            'status'                => 'pending',
            'should_block_processing' => (bool) config('exchange_pipeline.aml.auto_block_processing', true),
            'notes'                 => $notes,
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

    // ═══════════════════════════════════════════════════════════════════════
    //  Wallet address screening (called on custodial deposits / send addresses)
    // ═══════════════════════════════════════════════════════════════════════

    public function screenWalletAddress(string $address, string $currencyCode, array $context = []): array
    {
        $provider   = (string) config('exchange_pipeline.aml.provider', self::PROVIDER_MANUAL);
        $screenable = $context['screenable'] ?? null;
        $direction  = $context['direction'] ?? 'wallet';

        if ($override = $this->resolveWalletOverride($screenable, $address)) {
            return $override;
        }

        if (!config('exchange_pipeline.aml.enabled')) {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status'     => 'approved',
                'provider'   => self::PROVIDER_DISABLED,
                'risk_level' => 'low',
                'risk_score' => 0,
                'notes'      => ucfirst($direction) . ' screening is disabled. Auto-approved.',
            ]);
        }

        // ── AMLBot provider ─────────────────────────────────────────────
        if ($provider === self::PROVIDER_AMLBOT) {
            return $this->screenViaAmlBot($address, $currencyCode, $screenable, $direction);
        }

        // ── Manual / fallback ────────────────────────────────────────────
        return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
            'status'     => 'pending',
            'provider'   => self::PROVIDER_MANUAL,
            'risk_level' => 'unknown',
            'risk_score' => null,
            'notes'      => ucfirst($direction) . ' address requires manual AML review.',
        ]);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  CustodialDeposit screening
    // ═══════════════════════════════════════════════════════════════════════

    public function screenCustodialDeposit(CustodialDeposit $deposit): array
    {
        if (!config('exchange_pipeline.aml.enabled')) {
            $deposit->update([
                'aml_status'     => 'aml_approved',
                'aml_provider'   => self::PROVIDER_DISABLED,
                'aml_risk_level' => 'low',
                'aml_risk_score' => 0,
                'aml_notes'      => 'AML screening is disabled.',
            ]);

            return ['status' => 'approved', 'should_block_processing' => false];
        }

        $provider = (string) config('exchange_pipeline.aml.provider', self::PROVIDER_MANUAL);

        if ($provider === self::PROVIDER_AMLBOT) {
            $amlBot   = app(AmlBotService::class);
            $currency = optional($deposit->currency)->code ?? $deposit->currency_code ?? '';
            $result   = $amlBot->screenAddress((string) $deposit->from_address, $currency);

            return $this->applyCustodialDepositResult($deposit, $result, self::PROVIDER_AMLBOT);
        }

        // Manual
        $deposit->update([
            'aml_status'     => 'aml_pending',
            'aml_provider'   => self::PROVIDER_MANUAL,
            'aml_risk_level' => 'unknown',
            'aml_notes'      => 'Awaiting manual AML review.',
        ]);

        return [
            'status'                => 'pending',
            'should_block_processing' => (bool) config('exchange_pipeline.aml.auto_block_processing', true),
        ];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Private helpers
    // ═══════════════════════════════════════════════════════════════════════

    private function screenViaAmlBot(
        string $address,
        string $currencyCode,
        mixed $screenable,
        string $direction
    ): array {
        $amlBot = app(AmlBotService::class);

        if (!$amlBot->isReady()) {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status'     => 'pending',
                'provider'   => self::PROVIDER_AMLBOT,
                'risk_level' => 'unknown',
                'risk_score' => null,
                'notes'      => ucfirst($direction) . ' screening unavailable: AMLBot API key not configured. Manual review required.',
            ]);
        }

        $result = $amlBot->screenAddress($address, $currencyCode);

        $this->logScreeningIfPossible($screenable, $address, $currencyCode, self::PROVIDER_AMLBOT, $result);

        if ($result['result'] === 'error') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status'     => 'pending',
                'provider'   => self::PROVIDER_AMLBOT,
                'risk_level' => 'high',
                'risk_score' => 80,
                'notes'      => ucfirst($direction) . ' AMLBot screening failed. Manual review required. ' . ($result['notes'] ?? ''),
            ]);
        }

        if ($result['result'] === 'blocked') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status'     => 'rejected',
                'provider'   => self::PROVIDER_AMLBOT,
                'risk_level' => 'high',
                'risk_score' => $result['risk_score'] ?? 100,
                'notes'      => ucfirst($direction) . ' address blocked by AMLBot. ' . ($result['notes'] ?? ''),
            ]);
        }

        if ($result['result'] === 'flagged') {
            return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
                'status'     => 'pending',
                'provider'   => self::PROVIDER_AMLBOT,
                'risk_level' => $result['risk_level'] ?? 'medium',
                'risk_score' => $result['risk_score'] ?? 50,
                'notes'      => ucfirst($direction) . ' address flagged for review by AMLBot. ' . ($result['notes'] ?? ''),
            ]);
        }

        return $this->finalizeWalletDecision($screenable, $address, $currencyCode, [
            'status'     => 'approved',
            'provider'   => self::PROVIDER_AMLBOT,
            'risk_level' => $result['risk_level'] ?? 'low',
            'risk_score' => $result['risk_score'] ?? 0,
            'notes'      => ucfirst($direction) . ' address passed AMLBot screening. ' . ($result['notes'] ?? ''),
        ]);
    }

    private function applyCustodialDepositResult(CustodialDeposit $deposit, array $result, string $provider): array
    {
        $amlStatus = match ($result['result'] ?? '') {
            'blocked' => 'aml_rejected',
            'clean'   => 'aml_approved',
            default   => 'aml_pending',
        };

        $deposit->update([
            'aml_status'     => $amlStatus,
            'aml_provider'   => $provider,
            'aml_risk_level' => $result['risk_level'] ?? 'unknown',
            'aml_risk_score' => $result['risk_score'],
            'aml_notes'      => $result['notes'] ?? null,
        ]);

        $blocked = $amlStatus === 'aml_rejected';

        return [
            'status'                => $blocked ? 'rejected' : ($amlStatus === 'aml_approved' ? 'approved' : 'pending'),
            'should_block_processing' => $blocked || ($amlStatus === 'aml_pending' && (bool) config('exchange_pipeline.aml.auto_block_processing', true)),
        ];
    }

    private function resolveWalletOverride(mixed $screenable, string $address): ?array
    {
        if (!$screenable) {
            return null;
        }

        try {
            if (
                isset($screenable->aml_override) &&
                in_array($screenable->aml_override, ['approved', 'rejected'], true)
            ) {
                $status = $screenable->aml_override === 'approved' ? 'approved' : 'rejected';
                $notes  = 'Manual AML override applied by admin.';

                return [
                    'status'                => $status,
                    'provider'              => 'manual_override',
                    'risk_level'            => $status === 'approved' ? 'low' : 'high',
                    'risk_score'            => $status === 'approved' ? 0 : 100,
                    'should_block_processing' => $status === 'rejected',
                    'notes'                 => $notes,
                ];
            }
        } catch (\Throwable) {
            // ignore
        }

        return null;
    }

    private function finalizeWalletDecision(
        mixed $screenable,
        string $address,
        string $currencyCode,
        array $decision
    ): array {
        $status   = $decision['status'] ?? 'pending';
        $provider = $decision['provider'] ?? 'unknown';

        if ($screenable) {
            try {
                $screenable->update([
                    'aml_status'     => match ($status) {
                        'approved' => 'aml_approved',
                        'rejected' => 'aml_rejected',
                        default    => 'aml_pending',
                    },
                    'aml_provider'   => $provider,
                    'aml_risk_level' => $decision['risk_level'] ?? 'unknown',
                    'aml_risk_score' => $decision['risk_score'] ?? null,
                    'aml_notes'      => $decision['notes'] ?? null,
                ]);
            } catch (\Throwable $e) {
                Log::warning('ExchangeAmlService: could not update screenable AML fields', ['error' => $e->getMessage()]);
            }
        }

        return array_merge($decision, [
            'should_block_processing' => $decision['should_block_processing']
                ?? ($status !== 'approved' && (bool) config('exchange_pipeline.aml.auto_block_processing', true)),
        ]);
    }

    private function applyDecision(
        ExchangeRequest $exchange,
        string $status,
        string $provider,
        string $riskLevel,
        ?float $riskScore,
        string $notes
    ): void {
        $exchange->update([
            'aml_status'     => match ($status) {
                'approved' => 'aml_approved',
                'rejected' => 'aml_rejected',
                default    => 'aml_pending',
            },
            'aml_provider'   => $provider,
            'aml_risk_level' => $riskLevel,
            'aml_risk_score' => $riskScore,
            'aml_notes'      => $notes,
        ]);
    }

    private function logScreeningIfPossible(
        mixed $screenable,
        string $address,
        string $currencyCode,
        string $provider,
        array $result
    ): void {
        try {
            AmlScreeningLog::create([
                'screenable_type' => $screenable ? get_class($screenable) : null,
                'screenable_id'   => $screenable?->id,
                'address'         => $address,
                'currency_code'   => $currencyCode,
                'provider'        => $provider,
                'result'          => $result['result'] ?? null,
                'risk_level'      => $result['risk_level'] ?? null,
                'risk_score'      => $result['risk_score'] ?? null,
                'notes'           => $result['notes'] ?? null,
                'raw_response'    => isset($result['_raw']) ? json_encode($result['_raw']) : null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('ExchangeAmlService: could not write AML screening log', ['error' => $e->getMessage()]);
        }
    }

    private function findLinkedCustodialDeposit(ExchangeRequest $exchange, array $meta): ?CustodialDeposit
    {
        $depositId = $meta['custodial_deposit_id'] ?? $exchange->custodial_deposit_id ?? null;

        if ($depositId) {
            return CustodialDeposit::find($depositId);
        }

        return null;
    }
}
