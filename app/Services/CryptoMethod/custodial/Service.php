<?php

namespace App\Services\CryptoMethod\custodial;

use App\Models\CustodialWallet;
use App\Services\Custodial\CustodialWalletService;
use Illuminate\Support\Facades\Log;
use RuntimeException;

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
     * This creates an ExchangePayout record for manual processing by admin.
     * Automatic on-chain withdrawal is not yet implemented.
     */
    public function withdrawCrypto($object, $amount, $currency, $address, $type): bool
    {
        $currency = strtoupper((string)$currency);

        // Find the custodial wallet that has funds for this currency
        $wallet = CustodialWallet::forCurrency($currency)
            ->where('status', 'active')
            ->whereNotNull('encrypted_private_key')
            ->orderByDesc('last_deposit_amount')
            ->first();

        if (!$wallet) {
            Log::warning("Custodial: no wallet with private key found for {$currency} withdrawal");
            return false;
        }

        // Create payout record for admin to process manually
        \App\Models\ExchangePayout::updateOrCreate(
            [
                'exchange_request_id' => $object->id,
                'type'                => 'payout',
            ],
            [
                'user_id'             => $object->user_id,
                'provider'            => 'custodial',
                'currency_code'       => $currency,
                'amount'              => (float)$amount,
                'destination_wallet'  => (string)$address,
                'status'              => 'queued',
                'tx_id'               => null,
                'external_reference'  => 'custodial_' . substr(uniqid('', true), 0, 19),
                'error_message'       => null,
                'requested_at'        => now(),
                'processed_at'        => null,
            ]
        );

        Log::info("Custodial: queued payout of {$amount} {$currency} to {$address}");

        return true;
    }
}
