<?php

namespace App\Services\Custodial;

use App\Models\CustodialDeposit;
use App\Models\CustodialWallet;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use App\Services\ExchangePipeline\ExchangeAmlService;
use Illuminate\Support\Facades\Log;

class CustodialDepositService
{
    public function __construct(
        private readonly HdWalletService $walletService,
        private readonly ExchangeAmlService $amlService,
    ) {}

    /**
     * Scan all active custodial wallets for new deposits.
     * Called by cron job.
     */
    public function scanAllWallets(): array
    {
        $wallets = CustodialWallet::where('status', 'active')->get();
        $results = ['scanned' => 0, 'new_deposits' => 0, 'errors' => 0];

        foreach ($wallets as $wallet) {
            try {
                $deposits = $this->walletService->checkDeposits($wallet);
                $results['scanned']++;

                foreach ($deposits as $depositData) {
                    $created = $this->recordDeposit($wallet, $depositData);
                    if ($created) {
                        $results['new_deposits']++;
                    }
                }
            } catch (\Throwable $e) {
                Log::error("Custodial scan error for wallet {$wallet->id}: " . $e->getMessage());
                $results['errors']++;
            }
        }

        return $results;
    }

    /**
     * Record a new deposit if it doesn't already exist.
     */
    public function recordDeposit(CustodialWallet $wallet, array $data): ?CustodialDeposit
    {
        $txId = $data['tx_id'] ?? null;

        // Deduplicate by tx_id + wallet
        if ($txId) {
            $existing = CustodialDeposit::where('custodial_wallet_id', $wallet->id)
                ->where('tx_id', $txId)
                ->first();

            if ($existing) {
                // Update confirmations if needed
                if ($data['confirmed'] && $existing->status === 'pending') {
                    $existing->update([
                        'status' => 'confirmed',
                        'confirmations' => $data['confirmations'] ?? 0,
                        'confirmed_at' => now(),
                    ]);

                    // Trigger AML check for confirmed deposits
                    $this->triggerAmlCheck($existing);
                }

                return null;
            }
        }

        // Link deposit to the exchange/sell request that reserved this wallet
        $exchangeRequestId = null;
        $sellRequestId = null;
        if ($wallet->assigned_exchange_id) {
            // Determine if this is an ExchangeRequest or SellRequest
            // Check by looking at the assignedExchange relationship
            $assignedExchange = ExchangeRequest::find($wallet->assigned_exchange_id);
            if ($assignedExchange) {
                $exchangeRequestId = $assignedExchange->id;
            } else {
                // Try SellRequest
                $sellRequest = SellRequest::find($wallet->assigned_exchange_id);
                if ($sellRequest) {
                    $sellRequestId = $sellRequest->id;
                }
            }
        }

        $deposit = CustodialDeposit::create([
            'custodial_wallet_id' => $wallet->id,
            'currency_code' => $data['currency_code'] ?? $wallet->currency_code,
            'tx_id' => $txId,
            'tx_hash' => $data['tx_hash'] ?? $txId,
            'amount' => $data['amount'] ?? 0,
            'confirmations' => $data['confirmations'] ?? 0,
            'status' => $data['confirmed'] ? 'confirmed' : 'pending',
            'source_address' => $data['source_address'] ?? null,
            'exchange_request_id' => $exchangeRequestId,
            'sell_request_id' => $sellRequestId,
            'detected_at' => now(),
            'confirmed_at' => $data['confirmed'] ? now() : null,
        ]);

        // Update wallet last deposit info
        $wallet->update([
            'last_deposit_at' => now(),
            'last_deposit_tx_id' => $txId,
            'last_deposit_amount' => $data['amount'] ?? 0,
        ]);

        // If confirmed, trigger AML check
        if ($data['confirmed']) {
            $this->triggerAmlCheck($deposit);
        }

        Log::info("Custodial: new deposit recorded", [
            'wallet' => $wallet->address,
            'amount' => $data['amount'],
            'currency' => $wallet->currency_code,
            'tx_id' => $txId,
        ]);

        return $deposit;
    }

    /**
     * Run AML check on a confirmed deposit.
     */
    public function triggerAmlCheck(CustodialDeposit $deposit): void
    {
        if (!config('exchange_pipeline.aml.enabled')) {
            // AML disabled — auto-approve
            $deposit->update([
                'status' => 'aml_approved',
                'aml_checked_at' => now(),
                'aml_provider' => 'disabled',
                'aml_risk_level' => 'low',
                'aml_notes' => 'AML screening is disabled. Auto-approved.',
            ]);

            $this->processApprovedDeposit($deposit);
            return;
        }

        $deposit->update(['status' => 'aml_check']);

        // Run AML screening
        $result = $this->amlService->screenCustodialDeposit($deposit);

        if ($result['status'] === 'approved') {
            $deposit->update([
                'status' => 'aml_approved',
                'aml_checked_at' => now(),
                'aml_provider' => $result['provider'] ?? 'manual',
                'aml_risk_level' => $result['risk_level'] ?? 'low',
                'aml_risk_score' => $result['risk_score'] ?? null,
                'aml_notes' => $result['notes'] ?? 'AML approved.',
            ]);

            $this->processApprovedDeposit($deposit);
        } elseif ($result['status'] === 'rejected') {
            $deposit->update([
                'status' => 'aml_rejected',
                'aml_checked_at' => now(),
                'aml_provider' => $result['provider'] ?? 'manual',
                'aml_risk_level' => 'high',
                'aml_risk_score' => $result['risk_score'] ?? 100,
                'aml_notes' => $result['notes'] ?? 'AML rejected: high risk.',
            ]);

            Log::warning("Custodial: deposit AML rejected", [
                'deposit_id' => $deposit->id,
                'amount' => $deposit->amount,
                'currency' => $deposit->currency_code,
            ]);
        } else {
            // Pending — needs manual review
            $deposit->update([
                'aml_provider' => $result['provider'] ?? 'manual',
                'aml_risk_level' => $result['risk_level'] ?? 'unknown',
                'aml_notes' => $result['notes'] ?? 'Awaiting manual AML review.',
            ]);
        }
    }

    /**
     * Process an AML-approved deposit — link it to the exchange/sell request
     * and trigger the exchange pipeline (status update, payout, notifications).
     */
    public function processApprovedDeposit(CustodialDeposit $deposit): void
    {
        $deposit->update(['status' => 'processed']);

        // If this deposit is linked to an exchange request, trigger the pipeline
        if ($deposit->exchange_request_id) {
            $exchange = $deposit->exchangeRequest;
            if ($exchange) {
                // Use the walletUpgration trait method which handles the full pipeline:
                // status update → transaction → AML → automation → notification
                app(CustodialWalletService::class)->confirmDepositForExchange(
                    $exchange,
                    (float)$deposit->amount,
                    $deposit->tx_id
                );
            }
        }

        // If this deposit is linked to a sell request
        if ($deposit->sell_request_id) {
            $sell = $deposit->sellRequest;
            if ($sell) {
                app(CustodialWalletService::class)->confirmDepositForSell(
                    $sell,
                    (float)$deposit->amount,
                    $deposit->tx_id
                );
            }
        }

        // Release the wallet back to pool (only after exchange is fully processed)
        $wallet = $deposit->custodialWallet;
        if ($wallet && $wallet->assigned_exchange_id) {
            // Don't release immediately — the exchange may still need the wallet reference
            // Wallet will be released when the exchange completes or is cancelled
        }

        Log::info("Custodial: deposit processed successfully", [
            'deposit_id' => $deposit->id,
            'amount' => $deposit->amount,
            'currency' => $deposit->currency_code,
        ]);
    }

    /**
     * Manually approve a deposit (admin action).
     */
    public function manualApprove(CustodialDeposit $deposit): void
    {
        $deposit->update([
            'status' => 'aml_approved',
            'aml_checked_at' => now(),
            'aml_provider' => 'manual_admin',
            'aml_risk_level' => 'low',
            'aml_notes' => 'Manually approved by admin.',
        ]);

        $this->processApprovedDeposit($deposit);
    }

    /**
     * Manually reject a deposit (admin action).
     */
    public function manualReject(CustodialDeposit $deposit, string $reason = ''): void
    {
        $deposit->update([
            'status' => 'aml_rejected',
            'aml_checked_at' => now(),
            'aml_provider' => 'manual_admin',
            'aml_risk_level' => 'high',
            'aml_notes' => 'Manually rejected by admin. ' . $reason,
        ]);
    }
}
