<?php

namespace App\Services\Tatum;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Tatum.io API Service
 *
 * Provides access to Tatum's blockchain infrastructure:
 *  - RPC node proxying (BTC, ETH, TRON, SOL, TON, BSC, etc.)
 *  - Address balance & transaction queries
 *  - Notification subscription management
 *  - Transaction broadcasting
 *
 * API Reference: https://docs.tatum.io/reference
 */
class TatumService
{
    private string $apiUrl;
    private string $apiKey;
    private int $timeout = 30;

    public function __construct()
    {
        $this->apiUrl = rtrim(config('tatum.api_url', 'https://api.tatum.io/v4'), '/');
        $this->apiKey = config('tatum.api_key', '');
    }

    // ─── NOTIFICATIONS (WEBHOOKS) ────────────────────────────────────────────

    /**
     * Subscribe to incoming transaction notifications for an address.
     *
     * @param  string  $address   Blockchain address to monitor
     * @param  string  $chain     Tatum chain identifier (e.g. "ethereum-mainnet")
     * @param  string  $webhookUrl  URL to call when a tx arrives
     * @param  string  $type      Notification type (default: INCOMING_NATIVE_TX)
     * @return array   Tatum subscription object with 'id'
     */
    public function subscribeAddress(
        string $address,
        string $chain,
        string $webhookUrl,
        string $type = 'INCOMING_NATIVE_TX'
    ): array {
        $response = $this->post('/subscription', [
            'type' => $type,
            'attr' => [
                'address'  => $address,
                'chain'    => $chain,
                'url'      => $webhookUrl,
            ],
        ]);

        if (empty($response['id'])) {
            throw new RuntimeException(
                'Tatum: failed to create subscription for ' . $address . ': ' . json_encode($response)
            );
        }

        Log::info("Tatum: subscribed {$chain} address {$address} → id={$response['id']}");
        return $response;
    }

    /**
     * Subscribe to ERC20/TRC20/BEP20 token deposits.
     */
    public function subscribeTokenAddress(
        string $address,
        string $chain,
        string $contractAddress,
        string $webhookUrl
    ): array {
        $response = $this->post('/subscription', [
            'type' => 'INCOMING_FUNGIBLE_TX',
            'attr' => [
                'address'         => $address,
                'chain'           => $chain,
                'url'             => $webhookUrl,
                'contractAddress' => $contractAddress,
            ],
        ]);

        if (empty($response['id'])) {
            throw new RuntimeException(
                'Tatum: failed to create token subscription: ' . json_encode($response)
            );
        }

        Log::info("Tatum: subscribed token {$chain} address {$address} contract {$contractAddress} → id={$response['id']}");
        return $response;
    }

    /**
     * Unsubscribe / delete a notification subscription.
     */
    public function unsubscribe(string $subscriptionId): bool
    {
        try {
            $this->delete("/subscription/{$subscriptionId}");
            Log::info("Tatum: unsubscribed {$subscriptionId}");
            return true;
        } catch (\Throwable $e) {
            Log::warning("Tatum: failed to unsubscribe {$subscriptionId}: " . $e->getMessage());
            return false;
        }
    }

    /**
     * List all active subscriptions.
     */
    public function listSubscriptions(int $pageSize = 50, int $offset = 0): array
    {
        return $this->get('/subscription', ['pageSize' => $pageSize, 'offset' => $offset]);
    }

    // ─── BALANCE & DATA ──────────────────────────────────────────────────────

    /**
     * Get native coin balance for an address via Tatum Data API.
     */
    public function getBalance(string $address, string $chain): array
    {
        return $this->get("/data/balances", [
            'chain'    => $chain,
            'addresses' => $address,
        ]);
    }

    /**
     * Get token balance (ERC20/TRC20/etc).
     */
    public function getTokenBalance(string $address, string $chain, string $contractAddress): array
    {
        return $this->get("/data/balances", [
            'chain'          => $chain,
            'addresses'      => $address,
            'tokenAddress'   => $contractAddress,
        ]);
    }

    /**
     * Get transaction details by txHash.
     */
    public function getTransaction(string $txHash, string $chain): array
    {
        return $this->get("/data/transactions/{$txHash}", ['chain' => $chain]);
    }

    // ─── RPC PROXY (send raw blockchain calls) ───────────────────────────────

    /**
     * Send a raw JSON-RPC call through Tatum's node.
     * Useful for: eth_sendRawTransaction, sendrawtransaction (BTC), etc.
     */
    public function rpcCall(string $chain, string $method, array $params = []): array
    {
        return $this->post("/rpc/{$chain}", [
            'jsonrpc' => '2.0',
            'method'  => $method,
            'params'  => $params,
            'id'      => 1,
        ]);
    }

    /**
     * Broadcast a raw signed transaction.
     *
     * @param  string  $chain  Tatum chain (e.g. "bitcoin-mainnet")
     * @param  string  $rawTx  Hex-encoded signed transaction
     * @return array   ['txId' => '0xabc...']
     */
    public function broadcastTransaction(string $chain, string $rawTx): array
    {
        // For EVM chains
        if ($this->isEvmChain($chain)) {
            $result = $this->rpcCall($chain, 'eth_sendRawTransaction', [$rawTx]);
            $txId = $result['result'] ?? null;
            if (!$txId) {
                throw new RuntimeException("Tatum broadcast failed: " . json_encode($result));
            }
            return ['txId' => $txId];
        }

        // For TRON
        if ($chain === 'tron-mainnet') {
            return $this->post("/tron/broadcast", ['txData' => $rawTx]);
        }

        // For BTC/LTC (UTXO)
        $result = $this->rpcCall($chain, 'sendrawtransaction', [$rawTx]);
        $txId = $result['result'] ?? null;
        if (!$txId) {
            throw new RuntimeException("Tatum UTXO broadcast failed: " . json_encode($result));
        }
        return ['txId' => $txId];
    }

    /**
     * Get fee estimation for a chain.
     */
    public function estimateFee(string $chain, array $params = []): array
    {
        return $this->get("/blockchain/estimate", array_merge(['chain' => $chain], $params));
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────────

    /**
     * Resolve internal currency code → Tatum chain identifier.
     */
    public function resolveChain(string $currencyCode): string
    {
        $isTestnet = (bool) config('tatum.testnet', false);
        $code = strtoupper(trim($currencyCode));

        if ($isTestnet) {
            $testnetChains = config('tatum.chains_testnet', []);
            if (isset($testnetChains[$code])) {
                return $testnetChains[$code];
            }
        }

        $chains = config('tatum.chains', []);
        if (isset($chains[$code])) {
            return $chains[$code];
        }

        throw new RuntimeException("Tatum: no chain mapping for currency '{$currencyCode}'");
    }

    /**
     * Resolve token contract address for a currency code (if it's a token).
     */
    public function resolveContractAddress(string $currencyCode): ?string
    {
        $contracts = config('tatum.contracts', []);
        return $contracts[strtoupper($currencyCode)] ?? null;
    }

    /**
     * Determine if a currency code requires a token subscription (not native).
     */
    public function isToken(string $currencyCode): bool
    {
        return $this->resolveContractAddress($currencyCode) !== null;
    }

    private function isEvmChain(string $chain): bool
    {
        return in_array($chain, [
            'ethereum-mainnet', 'bsc-mainnet', 'polygon-mainnet',
            'arbitrum-one-mainnet', 'optimism-mainnet', 'base-mainnet',
        ], true);
    }

    // ─── HTTP ────────────────────────────────────────────────────────────────

    private function headers(): array
    {
        return [
            'x-api-key'    => $this->apiKey,
            'Content-Type' => 'application/json',
            'Accept'       => 'application/json',
        ];
    }

    private function get(string $path, array $query = []): array
    {
        if (empty($this->apiKey)) {
            throw new RuntimeException('Tatum API key is not configured. Set TATUM_API_KEY in .env');
        }

        $response = Http::timeout($this->timeout)
            ->withHeaders($this->headers())
            ->get($this->apiUrl . $path, $query);

        return $this->handleResponse($response, 'GET', $path);
    }

    private function post(string $path, array $body = []): array
    {
        if (empty($this->apiKey)) {
            throw new RuntimeException('Tatum API key is not configured. Set TATUM_API_KEY in .env');
        }

        $response = Http::timeout($this->timeout)
            ->withHeaders($this->headers())
            ->post($this->apiUrl . $path, $body);

        return $this->handleResponse($response, 'POST', $path);
    }

    private function delete(string $path): array
    {
        if (empty($this->apiKey)) {
            throw new RuntimeException('Tatum API key is not configured.');
        }

        $response = Http::timeout($this->timeout)
            ->withHeaders($this->headers())
            ->delete($this->apiUrl . $path);

        return $this->handleResponse($response, 'DELETE', $path);
    }

    private function handleResponse($response, string $method, string $path): array
    {
        if ($response->failed()) {
            $body = $response->body();
            Log::error("Tatum API error [{$method} {$path}] {$response->status()}: {$body}");
            throw new RuntimeException(
                "Tatum API {$method} {$path} failed [{$response->status()}]: {$body}"
            );
        }

        return $response->json() ?? [];
    }
}
