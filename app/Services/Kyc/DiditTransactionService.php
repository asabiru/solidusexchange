<?php

namespace App\Services\Kyc;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Didit Transaction Monitoring (KYT) service.
 *
 * Submits inbound crypto deposits to Didit for real-time AML screening.
 * $0.02 per transaction check. Includes automatic wallet screening
 * via Crystal/Merkle Science when crypto address is provided.
 *
 * API: POST /v3/tm/transactions/
 * Docs: https://docs.didit.me/transaction-monitoring/overview
 */
class DiditTransactionService
{
    private const TM_BASE_URL = 'https://tm.didit.me';

    public function __construct(
        private readonly DiditClient $client
    ) {}

    /**
     * Screen an inbound crypto deposit.
     *
     * @param  string  $txId         Blockchain transaction hash
     * @param  string  $fromAddress  Sender wallet address (client's address)
     * @param  string  $toAddress    Recipient address (our wallet)
     * @param  float   $amount       Amount received
     * @param  string  $currency     Currency code (BTC, ETH, USDT, etc.)
     * @param  string  $direction    'inbound' (default) or 'outbound'
     * @param  array   $subject      ['id' => userId, 'type' => 'user']
     * @return array   ['status' => 'APPROVED'|'IN_REVIEW'|'DECLINED', 'risk_score' => float, ...]
     */
    public function screenDeposit(
        string $txId,
        string $fromAddress,
        string $toAddress,
        float  $amount,
        string $currency,
        string $direction = 'inbound',
        array  $subject = []
    ): array {
        $apiKey = basicControl()->didit_api_key ?? '';

        if (empty($apiKey) || !(int)(basicControl()->didit_enabled ?? 0)) {
            return [
                'status'     => 'APPROVED',
                'risk_score' => null,
                'notes'      => 'Didit TM not configured — auto-approved.',
                'blocked'    => false,
            ];
        }

        try {
            $payload = [
                'external_id'          => $txId,
                'transaction_category' => 'finance',
                'transaction_details'  => [
                    'direction'     => $direction,
                    'amount'        => (string) $amount,
                    'currency'      => strtoupper($currency),
                    'currency_kind' => 'crypto',
                    'action_type'   => $direction === 'inbound' ? 'deposit' : 'withdrawal',
                ],
                'subject' => array_merge([
                    'id'   => $toAddress,
                    'type' => 'user',
                ], $subject),
                'counterparty' => [
                    'id'                => $fromAddress,
                    'type'              => 'user',
                    'payment_method'    => [
                        'method'         => 'crypto',
                        'wallet_address' => $fromAddress,
                        'blockchain'     => $this->resolveBlockchain($currency),
                    ],
                ],
                'payment_method' => [
                    'method'         => 'crypto',
                    'wallet_address' => $toAddress,
                    'blockchain'     => $this->resolveBlockchain($currency),
                    'tx_hash'        => $txId,
                ],
            ];

            $response = Http::withHeaders([
                'x-api-key'    => $apiKey,
                'Content-Type' => 'application/json',
            ])->timeout(15)->post(self::TM_BASE_URL . '/v3/tm/transactions/', $payload);

            if (!$response->successful()) {
                Log::warning('Didit TM: API error', [
                    'status' => $response->status(),
                    'body'   => $response->body(),
                    'tx_id'  => $txId,
                ]);
                // Don't block on API errors — allow through
                return [
                    'status'     => 'APPROVED',
                    'risk_score' => null,
                    'notes'      => 'Didit TM API error — auto-approved: ' . $response->status(),
                    'blocked'    => false,
                ];
            }

            $result = $response->json();
            $status     = strtoupper($result['status'] ?? 'APPROVED');
            $riskScore  = $result['risk_score'] ?? null;
            $riskLevel  = $result['risk_level'] ?? 'unknown';

            Log::info('Didit TM: deposit screened', [
                'tx_id'      => $txId,
                'from'       => $fromAddress,
                'currency'   => $currency,
                'amount'     => $amount,
                'status'     => $status,
                'risk_score' => $riskScore,
            ]);

            return [
                'status'     => $status,
                'risk_score' => $riskScore,
                'risk_level' => $riskLevel,
                'notes'      => $result['notes'] ?? null,
                'blocked'    => in_array($status, ['DECLINED', 'BLOCKED'], true),
                'tm_id'      => $result['id'] ?? null,
                'raw'        => $result,
            ];

        } catch (\Throwable $e) {
            Log::error('Didit TM: exception', [
                'tx_id' => $txId,
                'error' => $e->getMessage(),
            ]);
            // Never block on exceptions
            return [
                'status'     => 'APPROVED',
                'risk_score' => null,
                'notes'      => 'Didit TM exception: ' . $e->getMessage(),
                'blocked'    => false,
            ];
        }
    }

    /**
     * Screen an outbound payout (crypto sent to client).
     */
    public function screenPayout(
        string $txId,
        string $fromAddress,
        string $toAddress,
        float  $amount,
        string $currency,
        array  $subject = []
    ): array {
        return $this->screenDeposit(
            $txId, $toAddress, $fromAddress, $amount, $currency, 'outbound', $subject
        );
    }

    /**
     * Map currency code to Didit blockchain identifier.
     */
    private function resolveBlockchain(string $currency): string
    {
        return match (strtoupper($currency)) {
            'BTC'         => 'bitcoin',
            'LTC'         => 'litecoin',
            'ETH', 'USDT', 'USDC', 'SHIB', 'PEPE' => 'ethereum',
            'BNB', 'USDT_BSC', 'USDC_BSC'          => 'bsc',
            'TRX', 'USDT_TRC20'                     => 'tron',
            'SOL', 'USDT_SOL'                       => 'solana',
            'MATIC', 'USDT_MATIC'                   => 'polygon',
            'TON', 'USDT_TON'                       => 'ton',
            'ARB'                                   => 'arbitrum',
            'OP'                                    => 'optimism',
            'BASE'                                  => 'base',
            default                                 => strtolower($currency),
        };
    }
}
