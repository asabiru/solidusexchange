<?php

namespace App\Services\Custodial;

use App\Models\CustodialWallet;
use App\Models\ExchangePayout;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Internal wallet-to-wallet transfer service.
 *
 * Allows moving crypto between custodial wallets:
 *   - deposit  → payout  (sweep collected funds to hot wallet)
 *   - payout   → payout  (rebalance between traders or wallets)
 *   - any      → any     (same currency only)
 *
 * Each transfer is recorded in exchange_payouts as type='internal_transfer'.
 */
class InternalTransferService
{
    public function __construct(
        private readonly HdWalletService $hdWallet
    ) {}

    /**
     * Transfer crypto from one internal wallet to another.
     *
     * @param  CustodialWallet  $from    Source wallet
     * @param  CustodialWallet  $to      Destination wallet
     * @param  float            $amount  Amount to transfer (0 = transfer all available)
     * @return array ['txid' => string, 'amount' => float, 'fee' => float]
     */
    public function transfer(CustodialWallet $from, CustodialWallet $to, float $amount = 0): array
    {
        // Validate same currency
        if (strtoupper($from->currency_code) !== strtoupper($to->currency_code)) {
            throw new RuntimeException(
                "Currency mismatch: cannot transfer {$from->currency_code} to {$to->currency_code} wallet."
            );
        }

        if ($from->id === $to->id) {
            throw new RuntimeException("Cannot transfer to the same wallet.");
        }

        if (empty($from->encrypted_private_key)) {
            throw new RuntimeException("Source wallet has no private key — cannot sign transaction.");
        }

        // Check on-chain balance
        $balInfo   = $this->hdWallet->getBalance($from);
        $available = (float) ($balInfo['balance'] ?? 0);

        if ($available <= 0) {
            throw new RuntimeException(
                "Source wallet {$from->id} has no balance ({$from->currency_code})."
            );
        }

        // If amount=0, sweep all (leave small buffer for gas fees on EVM/TRX/TON)
        if ($amount <= 0) {
            $amount = $this->calcMaxTransferAmount($from->currency_code, $available);
        }

        if ($amount <= 0) {
            throw new RuntimeException(
                "Insufficient balance after estimated network fee ({$from->currency_code})."
            );
        }

        if ($amount > $available) {
            throw new RuntimeException(
                "Requested {$amount} {$from->currency_code} but only {$available} available."
            );
        }

        Log::info("InternalTransfer: initiating", [
            'from'     => $from->id,
            'to'       => $to->id,
            'currency' => $from->currency_code,
            'amount'   => $amount,
        ]);

        // Execute on-chain transfer
        $result = $this->hdWallet->withdraw($from, $to->address, $amount);

        $txid = $result['txid'] ?? null;

        // Record in exchange_payouts for audit trail
        DB::table('exchange_payouts')->insert([
            'exchange_request_id' => null,
            'user_id'             => null,
            'provider'            => 'custodial_internal',
            'currency_code'       => strtoupper($from->currency_code),
            'amount'              => $amount,
            'destination_wallet'  => $to->address,
            'status'              => 'sent',
            'tx_id'               => $txid,
            'external_reference'  => 'internal_' . $from->id . '_to_' . $to->id,
            'type'                => 'internal_transfer',
            'error_message'       => null,
            'requested_at'        => now(),
            'processed_at'        => now(),
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        // Update balances
        $from->decrement('balance', $amount);
        $to->increment('balance', $amount);

        Log::info("InternalTransfer: completed", [
            'txid'     => $txid,
            'from'     => $from->id,
            'to'       => $to->id,
            'currency' => $from->currency_code,
            'amount'   => $amount,
        ]);

        return [
            'txid'     => $txid,
            'amount'   => $amount,
            'currency' => $from->currency_code,
            'from'     => ['id' => $from->id, 'address' => $from->address],
            'to'       => ['id' => $to->id, 'address' => $to->address],
        ];
    }

    /**
     * Calculate max transferable amount (leave buffer for gas fees).
     */
    private function calcMaxTransferAmount(string $currency, float $available): float
    {
        $code = strtoupper($currency);

        // Gas fee buffers (conservative estimates)
        $gasBuffers = [
            'BTC'          => 0.00005,   // ~$5 at current rates
            'LTC'          => 0.001,
            'ETH'          => 0.005,     // ~$15 gas buffer
            'BNB'          => 0.001,
            'TRX'          => 5.0,       // 5 TRX for energy
            'SOL'          => 0.01,
            'TON'          => 0.05,
            'USDT'         => 0.0,       // no native token needed (EVM token)
            'USDT_TRC20'   => 0.0,       // no TRX buffer needed (assume wallet has TRX)
            'USDT_BSC'     => 0.0,
            'USDT_TON'     => 0.0,
        ];

        $buffer = $gasBuffers[$code] ?? 0.001;
        return max(0, $available - $buffer);
    }

    /**
     * Get transfer history (internal transfers).
     */
    public function getHistory(int $limit = 50): array
    {
        return DB::table('exchange_payouts')
            ->where('type', 'internal_transfer')
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get()
            ->map(fn($r) => (array)$r)
            ->toArray();
    }
}
