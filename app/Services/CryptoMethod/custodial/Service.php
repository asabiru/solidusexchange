<?php

namespace App\Services\CryptoMethod\custodial;

use App\Models\Admin;
use App\Models\CustodialWallet;
use App\Models\ExchangePayout;
use App\Services\ExchangeEngine\BybitClient;
use App\Services\Custodial\CustodialWalletService;
use App\Services\Custodial\HdWalletService;
use App\Services\Custodial\TraderWalletService;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * Custodial HD Wallet deposit provider.
 *
 * Generates unique deposit addresses for each exchange/sell request
 * using HD wallet derivation. Deposits are monitored by the
 * custodial:monitor-deposits cron job.
 */
class Service
{
    public function __construct(
        private readonly CustodialWalletService $walletService,
        private readonly HdWalletService $hdWallet,
        private readonly BybitClient $bybitClient,
    ) {}

    /**
     * Prepare deposit data: reserve a custodial wallet for the request.
     *
     * @param  mixed  $activeMethod  CryptoMethod model (unused, kept for interface)
     * @param  string  $cryptoCode  Currency code (e.g. BTC, USDT_TRC20, USDT_TON)
     * @param  string  $type  'exchange' or 'sell'
     * @param  array  $context  Must contain 'exchange_id' for exchange, or 'sell_request_id' for sell
     * @return array Structured deposit data
     */
    public function prepareData($activeMethod, $cryptoCode, $type = 'exchange', array $context = []): array
    {
        $code = strtoupper(trim($cryptoCode));

        if ($type === 'exchange') {
            $exchangeId = $context['exchange_id'] ?? null;
            if (!$exchangeId) {
                throw new RuntimeException('Exchange request ID is required for custodial deposit.');
            }

            $exchange = \App\Models\ExchangeRequest::find($exchangeId);
            if (!$exchange) {
                throw new RuntimeException("Exchange request {$exchangeId} not found.");
            }

            $wallet = $this->walletService->reserveForExchange($exchange, $code);
        } elseif ($type === 'sell') {
            $sellRequestId = $context['sell_request_id'] ?? $context['identifier'] ?? null;
            if (!$sellRequestId) {
                throw new RuntimeException('Sell request ID is required for custodial deposit.');
            }

            $sellRequest = \App\Models\SellRequest::find($sellRequestId);
            if (!$sellRequest) {
                throw new RuntimeException("Sell request {$sellRequestId} not found.");
            }

            $wallet = $this->walletService->reserveForSellRequest($sellRequest, $code);
        } else {
            throw new RuntimeException("Custodial deposit provider does not support type [{$type}].");
        }

        Log::info("Custodial: reserved wallet {$wallet->address} for {$type} (currency={$code})");

        return [
            'address'            => $wallet->address,
            'provider_reference' => (string)$wallet->id,
            'provider_network'   => $wallet->network ?: $code,
            'wallet_id'          => $wallet->id,
        ];
    }

    /**
     * Handle webhook/update notifications (not used for custodial — deposits
     * are detected by the cron scan, not webhooks).
     */
    public function webhookUpdate($request, $object, $cryptoMethod, $type): string
    {
        return 'ok';
    }

    /**
     * Withdraw crypto from a custodial wallet to a destination address.
     *
     * This executes an on-chain transfer directly from a custodial wallet.
     */
    public function withdrawCrypto($object, $amount, $currency, $address, $type): bool
    {
        $currency = strtoupper((string)$currency);
        $amount = (float)$amount;

        $existing = ExchangePayout::where('exchange_request_id', $object->id)
            ->where('type', 'payout')
            ->latest()
            ->first();

        if ($existing && in_array($existing->status, ['processing', 'sent'], true)) {
            Log::info("Custodial: payout already in progress or completed", [
                'exchange_id' => $object->id,
                'status' => $existing->status,
                'tx_id' => $existing->tx_id,
            ]);
            return true;
        }

        $payout = ExchangePayout::updateOrCreate(
            [
                'exchange_request_id' => $object->id,
                'type' => 'payout',
            ],
            [
                'user_id'            => $object->user_id,
                'provider'           => 'custodial',
                'currency_code'      => $currency,
                'amount'             => $amount,
                'destination_wallet' => (string)$address,
                'status'             => 'processing',
                'tx_id'              => null,
                'external_reference' => 'custodial_' . substr(uniqid('', true), 0, 19),
                'error_message'      => null,
                'requested_at'       => now(),
                'processed_at'       => null,
            ]
        );

        $wallet = $this->findFundingWallet($currency, $amount, $object);
        if ($wallet) {
            try {
                $result = $this->hdWallet->withdraw($wallet, (string)$address, $amount);

                $payout->update([
                    'status' => 'sent',
                    'tx_id' => $result['txid'] ?? null,
                    'error_message' => null,
                    'processed_at' => now(),
                ]);

                $object->payout_tx_id = $result['txid'] ?? null;
                $object->payout_provider = 'custodial';
                if (method_exists($object, 'save')) {
                    $object->save();
                }

                Log::info("Custodial: payout sent on-chain", [
                    'exchange_id' => $object->id,
                    'wallet_id' => $wallet->id,
                    'currency' => $currency,
                    'amount' => $amount,
                    'tx_id' => $result['txid'] ?? null,
                ]);

                return true;
            } catch (Throwable $e) {
                $payout->update([
                    'status' => 'failed',
                    'error_message' => $e->getMessage(),
                    'processed_at' => now(),
                ]);

                Log::error("Custodial: payout failed", [
                    'exchange_id' => $object->id,
                    'currency' => $currency,
                    'amount' => $amount,
                    'error' => $e->getMessage(),
                ]);

                return false;
            }
        }

        if (
            (bool) config('exchange_engine.auto_rebalance_with_bybit', true)
            && filled(config('exchange_engine.bybit.api_key'))
            && filled(config('exchange_engine.bybit.api_secret'))
        ) {
            try {
                $chain = $this->resolveBybitWithdrawChain($currency);
                $result = $this->bybitClient->withdrawAsset($currency, $chain, (string)$address, $amount);

                $withdrawId = $result['result']['id'] ?? $result['result']['withdrawId'] ?? null;
                $payout->update([
                    'status' => 'sent',
                    'tx_id' => $withdrawId ? (string)$withdrawId : null,
                    'error_message' => null,
                    'processed_at' => now(),
                ]);

                $object->payout_tx_id = $withdrawId ? (string)$withdrawId : null;
                $object->payout_provider = 'custodial';
                if (method_exists($object, 'save')) {
                    $object->save();
                }

                Log::info("Custodial: payout sent via Bybit withdrawal fallback", [
                    'exchange_id' => $object->id,
                    'currency' => $currency,
                    'amount' => $amount,
                    'chain' => $chain,
                    'withdraw_id' => $withdrawId,
                ]);

                return true;
            } catch (Throwable $e) {
                Log::error("Custodial: Bybit withdrawal fallback failed", [
                    'exchange_id' => $object->id,
                    'currency' => $currency,
                    'amount' => $amount,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $message = "Custodial: no active wallet with enough balance found for {$currency} payout";
        Log::warning($message, ['exchange_id' => $object->id, 'amount' => $amount]);
        $payout->update([
            'status' => 'failed',
            'error_message' => $message,
            'processed_at' => now(),
        ]);
        return false;
    }

    /**
     * Find a funding wallet for payout.
     *
     * Priority:
     *   1. Assigned trader's own wallet (if $object has assigned_trader_id)
     *   2. Any active wallet with sufficient balance (fallback)
     */
    private function findFundingWallet(string $currency, float $amount, $object = null): ?CustodialWallet
    {
        // 1. Try trader's personal wallet first
        if ($object && !empty($object->assigned_trader_id)) {
            $trader = Admin::find($object->assigned_trader_id);
            if ($trader) {
                $traderService = app(TraderWalletService::class);
                $traderWallet = $traderService->findPayoutWallet($trader, $currency, $amount);
                if ($traderWallet) {
                    Log::info("Custodial: using trader #{$trader->id} wallet for payout", [
                        'wallet_id' => $traderWallet->id,
                        'currency'  => $currency,
                        'amount'    => $amount,
                    ]);
                    return $traderWallet;
                }
                Log::warning("Custodial: trader #{$trader->id} has no {$currency} wallet or insufficient balance — falling back to shared wallet");
            }
        }

        // 2. Fallback: any active wallet with enough balance
        $wallets = CustodialWallet::forCurrency($currency)
            ->where('status', 'active')
            ->whereNotNull('encrypted_private_key')
            ->whereNull('trader_id') // only shared/system wallets in fallback
            ->orderByDesc('balance')
            ->orderBy('id')
            ->get();

        foreach ($wallets as $wallet) {
            try {
                $balanceInfo = $this->hdWallet->getBalance($wallet);
                if (($balanceInfo['balance'] ?? 0) >= $amount) {
                    return $wallet;
                }
            } catch (Throwable $e) {
                Log::warning("Custodial: balance check failed for payout wallet {$wallet->id}", [
                    'currency' => $currency,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return null;
    }

    private function resolveBybitWithdrawChain(string $currency): string
    {
        $currency = strtoupper($currency);
        return match ($currency) {
            'BTC' => 'BTC',
            'LTC' => 'LTC',
            'ETH', 'USDT', 'USDC', 'ARB', 'OP', 'PEPE', 'SHIB' => 'ETH',
            'BNB' => 'BSC',
            'TRX', 'USDT_TRC20', 'USDC_TRC20', 'USDD_TRC20' => 'TRX',
            'SOL', 'USDT_SOL', 'USDC_SOL', 'PYUSD_SOL', 'TRUMP_SOL' => 'SOL',
            'TON', 'USDT_TON' => 'TON',
            default => $currency,
        };
    }
}
