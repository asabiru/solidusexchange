<?php

namespace App\Http\Controllers;

use App\Models\CustodialDeposit;
use App\Models\CustodialWallet;
use App\Models\ExchangeRequest;
use App\Models\TatumSubscription;
use App\Services\ExchangePipeline\ExchangeAmlService;
use App\Services\Kyc\DiditTransactionService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Handles incoming Tatum.io webhook notifications.
 *
 * Tatum calls POST /api/tatum/webhook whenever a monitored address
 * receives an incoming transaction.
 *
 * Webhook payload structure:
 * {
 *   "address":        "0xRecipient...",
 *   "counterAddress": "0xSender...",
 *   "txId":           "0xabc...",
 *   "blockNumber":    12345678,
 *   "chain":          "ethereum-mainnet",
 *   "type":           "INCOMING_NATIVE_TX" | "INCOMING_FUNGIBLE_TX",
 *   "amount":         "0.5",
 *   "asset":          "ETH",
 *   "contractAddress":"0xtoken...",  // for fungible tokens
 *   "tokenDecimals":  18
 * }
 */
class TatumWebhookController extends Controller
{
    public function __construct(
        private readonly ExchangeAmlService $amlService,
        private readonly DiditTransactionService $diditTm,
    ) {}

    public function handle(Request $request): JsonResponse
    {
        // 1. Verify HMAC signature
        if (!$this->verifySignature($request)) {
            Log::warning('Tatum webhook: invalid signature from ' . $request->ip());
            return response()->json(['status' => 'unauthorized'], 401);
        }

        $payload = $request->all();
        Log::info('Tatum webhook received', ['payload' => $payload]);

        $address = strtolower($payload['address'] ?? '');
        $txId    = $payload['txId'] ?? null;
        $amount  = $payload['amount'] ?? '0';
        $chain   = $payload['chain'] ?? '';
        $type    = $payload['type'] ?? '';
        $asset   = $payload['asset'] ?? '';
        $contractAddress = strtolower($payload['contractAddress'] ?? '');

        if (!$address || !$txId || !$amount) {
            Log::warning('Tatum webhook: missing required fields', $payload);
            return response()->json(['status' => 'ignored', 'reason' => 'missing fields']);
        }

        try {
            $this->processDeposit($address, $txId, $chain, $amount, $asset, $type, $contractAddress, $payload);
        } catch (\Throwable $e) {
            Log::error('Tatum webhook: processing error', [
                'error'   => $e->getMessage(),
                'payload' => $payload,
            ]);
            // Always return 200 to prevent Tatum retry storm
            return response()->json(['status' => 'error', 'message' => $e->getMessage()]);
        }

        return response()->json(['status' => 'ok']);
    }

    private function processDeposit(
        string $address,
        string $txId,
        string $chain,
        string $amount,
        string $asset,
        string $type,
        string $contractAddress,
        array  $raw
    ): void {
        // Find the custodial wallet by address (case-insensitive)
        $wallet = CustodialWallet::whereRaw('LOWER(address) = ?', [$address])->first();

        if (!$wallet) {
            Log::info("Tatum webhook: no wallet found for address {$address} — ignoring");
            return;
        }

        // Deduplicate
        $existing = CustodialDeposit::where('custodial_wallet_id', $wallet->id)
            ->where('tx_id', $txId)
            ->first();

        if ($existing) {
            Log::info("Tatum webhook: duplicate tx {$txId} — ignored");
            return;
        }

        $amountFloat = (float) $amount;
        if ($amountFloat <= 0) {
            Log::info("Tatum webhook: zero-amount tx {$txId} — ignored");
            return;
        }

        DB::transaction(function () use ($wallet, $txId, $amountFloat, $asset, $chain, $type, $contractAddress, $raw, $address) {
            // Determine confirmed status from block number
            $blockNumber  = $raw['blockNumber'] ?? null;
            $isConfirmed  = $blockNumber !== null;
            $fromAddress  = $raw['counterAddress'] ?? null;

            // ─── Didit AML / Transaction Monitoring ──────────────────────
            $amlStatus   = 'approved';
            $amlBlocked  = false;
            $amlTmId     = null;
            $amlScore    = null;

            if ($isConfirmed && $fromAddress) {
                try {
                    $amlResult  = $this->diditTm->screenDeposit(
                        txId:        $txId,
                        fromAddress: $fromAddress,
                        toAddress:   $address,
                        amount:      $amountFloat,
                        currency:    strtoupper($asset),
                    );
                    $amlStatus  = strtolower($amlResult['status'] ?? 'approved');
                    $amlBlocked = (bool) ($amlResult['blocked'] ?? false);
                    $amlTmId    = $amlResult['tm_id'] ?? null;
                    $amlScore   = $amlResult['risk_score'] ?? null;

                    if ($amlBlocked) {
                        Log::warning("Tatum webhook: Didit AML BLOCKED deposit {$txId}", [
                            'from'   => $fromAddress,
                            'amount' => $amountFloat,
                            'asset'  => $asset,
                            'status' => $amlStatus,
                            'score'  => $amlScore,
                        ]);
                    }
                } catch (\Throwable $e) {
                    Log::error("Tatum webhook: Didit TM error for {$txId}: " . $e->getMessage());
                }
            }
            // ─────────────────────────────────────────────────────────────

            $deposit = CustodialDeposit::create([
                'custodial_wallet_id' => $wallet->id,
                'tx_id'               => $txId,
                'amount'              => $amountFloat,
                'currency_code'       => strtoupper($asset),
                'status'              => $amlBlocked ? 'aml_blocked' : ($isConfirmed ? 'confirmed' : 'pending'),
                'confirmations'       => $isConfirmed ? 1 : 0,
                'block_number'        => $blockNumber,
                'from_address'        => $fromAddress,
                'raw_data'            => json_encode(array_merge($raw, [
                    'aml_status' => $amlStatus,
                    'aml_tm_id'  => $amlTmId,
                    'aml_score'  => $amlScore,
                ])),
            ]);

            Log::info("Tatum webhook: deposit recorded", [
                'wallet'  => $wallet->id,
                'address' => $wallet->address,
                'txId'    => $txId,
                'amount'  => $amountFloat,
                'asset'   => $asset,
            ]);

            // Update wallet balance
            $wallet->increment('balance', $amountFloat);

            // Notify the exchange pipeline (only if AML passed and deposit confirmed)
            if ($wallet->assigned_exchange_id && $isConfirmed && !$amlBlocked) {
                $this->triggerExchangePipeline($wallet, $deposit);
            }
        });
    }

    private function triggerExchangePipeline(CustodialWallet $wallet, CustodialDeposit $deposit): void
    {
        try {
            $exchange = ExchangeRequest::find($wallet->assigned_exchange_id);
            if (!$exchange) return;

            // AML check
            $amlPassed = $this->amlService->screenDeposit($deposit);

            if ($amlPassed) {
                $exchange->update([
                    'deposit_confirmed_at' => now(),
                    'status'               => 3, // Processing
                ]);
                Log::info("Tatum: exchange {$exchange->id} deposit confirmed via webhook");
            } else {
                Log::warning("Tatum: AML check failed for exchange {$exchange->id}");
            }
        } catch (\Throwable $e) {
            Log::error("Tatum: pipeline trigger error: " . $e->getMessage());
        }
    }

    private function verifySignature(Request $request): bool
    {
        $secret = config('tatum.webhook_secret', '');

        // If no secret configured, allow all (not recommended for production)
        if (empty($secret)) {
            return true;
        }

        // Tatum sends HMAC-SHA512 in 'x-payload-hash' header
        $receivedHash = $request->header('x-payload-hash', '');
        if (empty($receivedHash)) {
            return false;
        }

        $body     = $request->getContent();
        $expected = hash_hmac('sha512', $body, $secret);

        return hash_equals($expected, $receivedHash);
    }
}
