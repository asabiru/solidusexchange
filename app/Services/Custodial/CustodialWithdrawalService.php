<?php

namespace App\Services\Custodial;

use App\Models\CustodialWallet;
use App\Models\CustodialWithdrawal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Custodial Withdrawal Service — manages withdrawal requests from custodial wallets.
 *
 * Flow:
 * 1. Admin creates withdrawal request (wallet_id, amount, to_address)
 * 2. System verifies balance and creates CustodialWithdrawal record (status=pending)
 * 3. Admin approves the withdrawal (status=approved)
 * 4. System executes the withdrawal via HdWalletService::withdraw()
 * 5. On success: status=completed, txid recorded, balance updated
 * 6. On failure: status=failed, error recorded
 */
class CustodialWithdrawalService
{
    public function __construct(
        private HdWalletService $hdWallet,
    ) {}

    /**
     * Create a new withdrawal request.
     */
    public function createRequest(int $walletId, string $toAddress, float $amount, ?string $note = null): CustodialWithdrawal
    {
        $wallet = CustodialWallet::findOrFail($walletId);

        // Validate address format
        $this->validateAddress($toAddress, $wallet->currency_code);

        // Check balance
        $balInfo = $this->hdWallet->getBalance($wallet);
        $available = $balInfo['balance'] ?? 0;

        if ($available < $amount) {
            throw new RuntimeException(
                "Insufficient balance: {$available} {$wallet->currency_code} available, {$amount} requested"
            );
        }

        return CustodialWithdrawal::create([
            'custodial_wallet_id' => $wallet->id,
            'currency_code'       => $wallet->currency_code,
            'from_address'        => $wallet->address,
            'to_address'          => $toAddress,
            'amount'              => $amount,
            'status'              => 'pending',
            'note'                => $note,
        ]);
    }

    /**
     * Approve a pending withdrawal request.
     */
    public function approve(int $withdrawalId): CustodialWithdrawal
    {
        $withdrawal = CustodialWithdrawal::findOrFail($withdrawalId);

        if ($withdrawal->status !== 'pending') {
            throw new RuntimeException("Withdrawal #{$withdrawalId} is not pending (status: {$withdrawal->status})");
        }

        $withdrawal->update(['status' => 'approved']);
        Log::info("Withdrawal #{$withdrawalId} approved");

        return $withdrawal;
    }

    /**
     * Execute an approved withdrawal.
     */
    public function execute(int $withdrawalId): CustodialWithdrawal
    {
        $withdrawal = CustodialWithdrawal::findOrFail($withdrawalId);

        if ($withdrawal->status !== 'approved') {
            throw new RuntimeException("Withdrawal #{$withdrawalId} is not approved (status: {$withdrawal->status})");
        }

        $wallet = CustodialWallet::findOrFail($withdrawal->custodial_wallet_id);

        $withdrawal->update(['status' => 'processing']);

        try {
            $result = $this->hdWallet->withdraw(
                $wallet,
                $withdrawal->to_address,
                $withdrawal->amount
            );

            $withdrawal->update([
                'status'    => 'completed',
                'txid'      => $result['txid'],
                'fee'       => $result['fee'] ?? 0,
                'executed_at' => now(),
            ]);

            // Refresh wallet balance
            $this->hdWallet->getBalance($wallet);

            Log::info("Withdrawal #{$withdrawalId} completed", [
                'txid'   => $result['txid'],
                'amount' => $withdrawal->amount,
            ]);

            return $withdrawal;
        } catch (\Throwable $e) {
            $withdrawal->update([
                'status' => 'failed',
                'error'  => $e->getMessage(),
            ]);

            Log::error("Withdrawal #{$withdrawalId} failed: " . $e->getMessage());

            throw $e;
        }
    }

    /**
     * Reject a pending withdrawal request.
     */
    public function reject(int $withdrawalId, ?string $reason = null): CustodialWithdrawal
    {
        $withdrawal = CustodialWithdrawal::findOrFail($withdrawalId);

        if (!in_array($withdrawal->status, ['pending', 'approved'])) {
            throw new RuntimeException("Cannot reject withdrawal #{$withdrawalId} (status: {$withdrawal->status})");
        }

        $withdrawal->update([
            'status' => 'rejected',
            'error'  => $reason,
        ]);

        return $withdrawal;
    }

    /**
     * Execute all approved withdrawals (for cron job).
     */
    public function executeApproved(): array
    {
        $withdrawals = CustodialWithdrawal::where('status', 'approved')->get();
        $results = ['completed' => 0, 'failed' => 0];

        foreach ($withdrawals as $w) {
            try {
                $this->execute($w->id);
                $results['completed']++;
            } catch (\Throwable $e) {
                $results['failed']++;
            }
        }

        return $results;
    }

    /**
     * Validate that the destination address matches the expected format.
     */
    private function validateAddress(string $address, string $currencyCode): void
    {
        $chain = $this->hdWallet->normalizeCode($currencyCode);
        $valid = match ($chain) {
            'BTC' => preg_match('/^(1|3|bc1)[a-zA-Z0-9]{25,62}$/', $address) === 1,
            'LTC' => preg_match('/^(L|M|ltc1)[a-zA-Z0-9]{25,62}$/', $address) === 1,
            'ETH', 'BNB' => preg_match('/^0x[a-fA-F0-9]{40}$/', $address) === 1,
            'TRX' => preg_match('/^T[A-HJ-NP-Za-km-z1-9]{33}$/', $address) === 1,
            'SOL' => preg_match('/^[1-9A-HJ-NP-Za-km-z]{32,44}$/', $address) === 1,
            'TON' => preg_match('/^(EQ|UQ)[a-zA-Z0-9\/_+-]{48}$/', $address) === 1
                     || preg_match('/^[a-f0-9]{64}$/', $address) === 1,
            default => strlen($address) > 10,
        };

        if (!$valid) {
            throw new RuntimeException("Invalid {$chain} address format: {$address}");
        }
    }
}
