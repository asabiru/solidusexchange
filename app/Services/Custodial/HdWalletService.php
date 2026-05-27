<?php

namespace App\Services\Custodial;

use App\Models\CustodialWallet;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * HD Wallet Service — generates deposit addresses and monitors deposits
 * using free blockchain APIs (no paid provider required).
 *
 * Supported chains:
 * - BTC: Blockstream API (free)
 * - ETH/EVM: Public RPC nodes (free)
 * - TRX: TronGrid API (free tier)
 * - SOL: Solana RPC (free)
 * - BNB: BSC RPC (free)
 * - TON: TON API (free tier)
 */
class HdWalletService
{
    private const DERIVATION_PATHS = [
        'BTC'     => "m/44'/0'/0'/0",
        'LTC'     => "m/44'/2'/0'/0",
        'ETH'     => "m/44'/60'/0'/0",
        'BNB'     => "m/44'/714'/0'/0",
        'TRX'     => "m/44'/195'/0'/0",
        'SOL'     => "m/44'/501'/0'/0",
        'TON'     => "m/44'/607'/0'/0",
        'USDT'    => "m/44'/60'/0'/0",   // ERC20
        'USDT_TRC20' => "m/44'/195'/0'/0", // TRC20
        'USDT_BSC'   => "m/44'/60'/0'/0",  // BEP20
        'USDC'    => "m/44'/60'/0'/0",
        'ARB'     => "m/44'/60'/0'/0",
        'OP'      => "m/44'/60'/0'/0",
        'SHIB'    => "m/44'/60'/0'/0",
        'PEPE'    => "m/44'/60'/0'/0",
    ];

    /**
     * Get the blockchain API base URL for a given currency.
     */
    public function getApiBaseUrl(string $currencyCode): string
    {
        $code = strtoupper(trim($currencyCode));
        $normalized = $this->normalizeCode($code);

        return match ($normalized) {
            'BTC'     => config('custodial.btc_api', 'https://blockstream.info/api'),
            'LTC'     => config('custodial.ltc_api', 'https://litecoin.space/api'),
            'ETH', 'USDT', 'USDC', 'ARB', 'OP', 'SHIB', 'PEPE'
                      => config('custodial.eth_rpc', 'https://eth.llamarpc.com'),
            'BNB', 'USDT_BSC'
                      => config('custodial.bsc_rpc', 'https://bsc-dataseed.binance.org'),
            'TRX', 'USDT_TRC20'
                      => config('custodial.trx_api', 'https://api.trongrid.io'),
            'SOL'     => config('custodial.sol_rpc', 'https://api.mainnet-beta.solana.com'),
            'TON'     => config('custodial.ton_api', 'https://toncenter.com/api/v2'),
            default   => throw new RuntimeException("No API endpoint configured for {$code}"),
        };
    }

    /**
     * Normalize currency code to base chain.
     * e.g. USDT_TRC20 → TRX, ETH_ARB → ETH, USDT → ETH
     */
    public function normalizeCode(string $code): string
    {
        $code = strtoupper(trim($code));

        // TRC20 tokens → TRX chain
        if (str_ends_with($code, '_TRC20') || $code === 'TRX') {
            return 'TRX';
        }

        // BSC tokens → BNB chain
        if (str_ends_with($code, '_BSC') || $code === 'BNB') {
            return 'BNB';
        }

        // Arbitrum tokens → ETH chain (L2)
        if (str_ends_with($code, '_ARB') || $code === 'ARB') {
            return 'ETH'; // Will use Arb RPC for actual calls
        }

        // Optimism tokens → ETH chain (L2)
        if (str_ends_with($code, '_OPT') || $code === 'OP') {
            return 'ETH'; // Will use Opt RPC
        }

        // Base tokens → ETH chain (L2)
        if (str_ends_with($code, '_BASE')) {
            return 'ETH';
        }

        // ERC20 tokens → ETH chain
        if (in_array($code, ['USDT', 'USDC', 'SHIB', 'PEPE', 'ETH'])) {
            return 'ETH';
        }

        return $code;
    }

    /**
     * Get the derivation path for a currency.
     */
    public function getDerivationPath(string $currencyCode): string
    {
        $code = strtoupper(trim($currencyCode));
        return self::DERIVATION_PATHS[$code] ?? self::DERIVATION_PATHS[$this->normalizeCode($code)] ?? "m/44'/60'/0'/0";
    }

    /**
     * Check for new deposits on a custodial wallet address.
     * Returns array of new deposits found.
     */
    public function checkDeposits(CustodialWallet $wallet): array
    {
        $chain = $this->normalizeCode($wallet->currency_code);
        $newDeposits = [];

        try {
            match ($chain) {
                'BTC'   => $newDeposits = $this->checkBtcDeposits($wallet),
                'LTC'   => $newDeposits = $this->checkLtcDeposits($wallet),
                'ETH'   => $newDeposits = $this->checkEvmDeposits($wallet),
                'BNB'   => $newDeposits = $this->checkEvmDeposits($wallet),
                'TRX'   => $newDeposits = $this->checkTrxDeposits($wallet),
                'SOL'   => $newDeposits = $this->checkSolDeposits($wallet),
                'TON'   => $newDeposits = $this->checkTonDeposits($wallet),
                default => Log::warning("Custodial: no deposit checker for chain {$chain}"),
            };
        } catch (\Throwable $e) {
            Log::error("Custodial deposit check failed for {$wallet->currency_code}: " . $e->getMessage());
        }

        return $newDeposits;
    }

    /**
     * Check BTC deposits via Blockstream API.
     */
    private function checkBtcDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('BTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$wallet->address}/txs");

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json() ?? [];
        $deposits = [];

        foreach ($txs as $tx) {
            // Check if this tx sends to our address
            foreach ($tx['vout'] ?? [] as $vout) {
                $scriptPubKey = $vout['scriptpubkey_address'] ?? '';
                if (strcasecmp($scriptPubKey, $wallet->address) === 0) {
                    $value = ($vout['value'] ?? 0) / 100000000; // satoshis to BTC
                    $txId = $tx['txid'] ?? null;
                    $status = $tx['status']['confirmed'] ?? false;
                    $confirmations = $status ? ($tx['status']['block_height'] ?? 0) : 0;

                    $deposits[] = [
                        'tx_id' => $txId,
                        'amount' => $value,
                        'confirmations' => $confirmations,
                        'confirmed' => $status,
                        'currency_code' => $wallet->currency_code,
                    ];
                }
            }
        }

        return $deposits;
    }

    /**
     * Check LTC deposits via litecoin.space API (same format as Blockstream).
     */
    private function checkLtcDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('LTC');
        $response = Http::timeout(10)->get("{$baseUrl}/address/{$wallet->address}/txs");

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json() ?? [];
        $deposits = [];

        foreach ($txs as $tx) {
            foreach ($tx['vout'] ?? [] as $vout) {
                $scriptPubKey = $vout['scriptpubkey_address'] ?? '';
                if (strcasecmp($scriptPubKey, $wallet->address) === 0) {
                    $value = ($vout['value'] ?? 0) / 100000000;
                    $deposits[] = [
                        'tx_id' => $tx['txid'] ?? null,
                        'amount' => $value,
                        'confirmations' => ($tx['status']['confirmed'] ?? false) ? 6 : 0,
                        'confirmed' => $tx['status']['confirmed'] ?? false,
                        'currency_code' => $wallet->currency_code,
                    ];
                }
            }
        }

        return $deposits;
    }

    /**
     * Check EVM (ETH/BSC/ARB/OPT) deposits via RPC eth_getLogs.
     * For native ETH/BNB: check balance changes.
     * For ERC20/BEP20 tokens: check Transfer events.
     */
    private function checkEvmDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl($wallet->currency_code);
        $deposits = [];

        // Check if this is a native coin or token
        $isNative = in_array(strtoupper($wallet->currency_code), ['ETH', 'BNB']);

        if ($isNative) {
            // For native coins, we check the balance
            $response = Http::timeout(10)->post($baseUrl, [
                'jsonrpc' => '2.0',
                'method' => 'eth_getBalance',
                'params' => [$wallet->address, 'latest'],
                'id' => 1,
            ]);

            if ($response->successful()) {
                $result = $response->json('result', '0x0');
                $balanceWei = hexdec(str_replace('0x', '', $result));
                $balance = $balanceWei / 1e18;

                if ($balance > 0) {
                    $deposits[] = [
                        'tx_id' => null, // Need separate call for tx details
                        'amount' => $balance,
                        'confirmations' => 12,
                        'confirmed' => true,
                        'currency_code' => $wallet->currency_code,
                        'balance_check' => true,
                    ];
                }
            }
        } else {
            // For ERC20/BEP20 tokens, check Transfer events to our address
            // Transfer event topic: 0xddf252ad...
            $transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
            $paddedAddress = '0x' . str_pad(strtolower(str_replace('0x', '', $wallet->address)), 64, '0', STR_PAD_LEFT);

            $response = Http::timeout(10)->post($baseUrl, [
                'jsonrpc' => '2.0',
                'method' => 'eth_getLogs',
                'params' => [[
                    'fromBlock' => '0x' . dechex(max(0, $this->getLatestCheckedBlock($wallet) - 100)),
                    'toBlock' => 'latest',
                    'topics' => [$transferTopic, null, $paddedAddress],
                ]],
                'id' => 1,
            ]);

            if ($response->successful()) {
                $logs = $response->json('result', []);
                foreach ($logs as $log) {
                    $data = $log['data'] ?? '0x0';
                    $tokenAmount = hexdec(str_replace('0x', '', $data));
                    // Most USDT has 6 decimals, most others 18
                    $decimals = $this->getTokenDecimals($wallet->currency_code);
                    $humanAmount = $tokenAmount / (10 ** $decimals);

                    if ($humanAmount > 0) {
                        $deposits[] = [
                            'tx_id' => $log['transactionHash'] ?? null,
                            'amount' => $humanAmount,
                            'confirmations' => 12,
                            'confirmed' => true,
                            'currency_code' => $wallet->currency_code,
                            'log_index' => $log['logIndex'] ?? null,
                        ];
                    }
                }
            }
        }

        return $deposits;
    }

    /**
     * Check TRX deposits via TronGrid API.
     */
    private function checkTrxDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('TRX');
        $apiKey = config('custodial.trongrid_api_key', '');

        $headers = [];
        if ($apiKey) {
            $headers['TRON-PRO-API-KEY'] = $apiKey;
        }

        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/v1/accounts/{$wallet->address}/transactions/trc20", [
                'limit' => 20,
                'contract_address' => $this->getTrc20ContractAddress($wallet->currency_code),
            ]);

        if (!$response->successful()) {
            // Try native TRX check
            return $this->checkTrxNativeDeposits($wallet, $baseUrl, $headers);
        }

        $txs = $response->json('data', []);
        $deposits = [];

        foreach ($txs as $tx) {
            $to = $tx['to'] ?? '';
            if (strcasecmp($to, $wallet->address) === 0) {
                $value = (float)($tx['value'] ?? 0);
                $decimals = (int)($tx['token_info']['decimals'] ?? 6);
                $humanAmount = $value / (10 ** $decimals);

                $deposits[] = [
                    'tx_id' => $tx['transaction_id'] ?? null,
                    'amount' => $humanAmount,
                    'confirmations' => $tx['block_timestamp'] ? 20 : 0,
                    'confirmed' => !empty($tx['block_timestamp']),
                    'currency_code' => $wallet->currency_code,
                ];
            }
        }

        return $deposits;
    }

    private function checkTrxNativeDeposits(CustodialWallet $wallet, string $baseUrl, array $headers): array
    {
        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/v1/accounts/{$wallet->address}/transactions", [
                'limit' => 10,
            ]);

        if (!$response->successful()) {
            return [];
        }

        $txs = $response->json('data', []);
        $deposits = [];

        foreach ($txs as $tx) {
            $rawData = $tx['raw_data']['contract'][0]['parameter']['value'] ?? [];
            $to = $rawData['to_address'] ?? '';
            $amount = ($rawData['amount'] ?? 0) / 1000000; // SUN to TRX

            if (strcasecmp($to, $wallet->address) === 0 && $amount > 0) {
                $deposits[] = [
                    'tx_id' => $tx['txID'] ?? null,
                    'amount' => $amount,
                    'confirmations' => 20,
                    'confirmed' => !empty($tx['block_timestamp']),
                    'currency_code' => 'TRX',
                ];
            }
        }

        return $deposits;
    }

    /**
     * Check SOL deposits via Solana RPC.
     */
    private function checkSolDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('SOL');

        $response = Http::timeout(10)->post($baseUrl, [
            'jsonrpc' => '2.0',
            'method' => 'getSignaturesForAddress',
            'params' => [$wallet->address, ['limit' => 10]],
            'id' => 1,
        ]);

        if (!$response->successful()) {
            return [];
        }

        $signatures = $response->json('result', []);
        $deposits = [];

        foreach ($signatures as $sig) {
            if (empty($sig['err'])) {
                $deposits[] = [
                    'tx_id' => $sig['signature'] ?? null,
                    'amount' => 0, // Need separate call for amount
                    'confirmations' => $sig['confirmationStatus'] === 'finalized' ? 32 : 1,
                    'confirmed' => ($sig['confirmationStatus'] ?? '') === 'finalized',
                    'currency_code' => 'SOL',
                    'needs_amount_fetch' => true,
                ];
            }
        }

        return $deposits;
    }

    /**
     * Check TON deposits via TON API.
     */
    private function checkTonDeposits(CustodialWallet $wallet): array
    {
        $baseUrl = $this->getApiBaseUrl('TON');
        $apiKey = config('custodial.ton_api_key', '');

        $headers = [];
        if ($apiKey) {
            $headers['X-API-Key'] = $apiKey;
        }

        $response = Http::timeout(10)->withHeaders($headers)
            ->get("{$baseUrl}/getTransactions", [
                'address' => $wallet->address,
                'limit' => 10,
            ]);

        if (!$response->successful()) {
            return [];
        }

        $result = $response->json('result', []);
        $deposits = [];

        foreach ($result as $tx) {
            $inMsg = $tx['in_msg'] ?? [];
            $dest = $inMsg['destination'] ?? '';
            $value = (float)($inMsg['value'] ?? 0) / 1e9; // nanotons to TON

            if (strcasecmp($dest, $wallet->address) === 0 && $value > 0) {
                $deposits[] = [
                    'tx_id' => $tx['hash'] ?? null,
                    'amount' => $value,
                    'confirmations' => 1,
                    'confirmed' => true,
                    'currency_code' => 'TON',
                ];
            }
        }

        return $deposits;
    }

    /**
     * Get TRC20 contract address for a token.
     */
    private function getTrc20ContractAddress(string $code): ?string
    {
        $code = strtoupper($code);
        $contracts = config('custodial.trc20_contracts', [
            'USDT_TRC20' => 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            'USDC_TRC20' => 'TEkxiTehnz8SeLqQs3vFq4z7LmYqYR7vRk',
            'USDD_TRC20' => 'TPYyKyniVvFCzqdiBkZvNMQDiYvhxoCnT3',
        ]);

        return $contracts[$code] ?? null;
    }

    /**
     * Get token decimals for a currency.
     */
    private function getTokenDecimals(string $code): int
    {
        $code = strtoupper($code);
        // USDT on most chains = 6 decimals
        if (str_starts_with($code, 'USDT') || str_starts_with($code, 'USDC') || str_starts_with($code, 'USDD')) {
            return 6;
        }
        // Most other ERC20 tokens = 18 decimals
        return 18;
    }

    /**
     * Get the latest block number we've checked for a wallet.
     */
    private function getLatestCheckedBlock(CustodialWallet $wallet): int
    {
        // Default to recent blocks
        return (int)($wallet->provider_reference ?? 0);
    }
}
