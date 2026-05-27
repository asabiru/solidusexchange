<?php

namespace App\Services\Custodial;

use App\Models\CryptoMethod;
use App\Models\CustodialWallet;
use App\Models\ExchangeRequest;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class CustodialWalletService
{
    /**
     * Reserve a custodial wallet for an exchange request.
     * If no available wallet exists, generate one via the active crypto provider.
     */
    public function reserveForExchange(ExchangeRequest $exchange, string $currencyCode): CustodialWallet
    {
        $existing = CustodialWallet::where('assigned_exchange_id', $exchange->id)->first();
        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($exchange, $currencyCode) {
            // Try to find an available wallet first
            $wallet = CustodialWallet::forCurrency($currencyCode)
                ->available()
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (!$wallet) {
                // Generate a new wallet via the active crypto provider
                $wallet = $this->generateWallet($currencyCode);
            }

            $wallet->assigned_exchange_id = $exchange->id;
            $wallet->assigned_at = now();
            $wallet->save();

            return $wallet;
        });
    }

    /**
     * Reserve a custodial wallet for a sell request (crypto → fiat).
     * The client sends crypto to this address.
     */
    public function reserveForSellRequest($sellRequest, string $currencyCode): CustodialWallet
    {
        $existing = CustodialWallet::where('assigned_exchange_id', $sellRequest->id)
            ->where('purpose', 'deposit')
            ->first();
        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($currencyCode) {
            $wallet = CustodialWallet::forCurrency($currencyCode)
                ->available()
                ->where('purpose', 'deposit')
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (!$wallet) {
                $wallet = $this->generateWallet($currencyCode);
            }

            return $wallet;
        });
    }

    /**
     * Release a wallet back to the available pool.
     */
    public function release(CustodialWallet $wallet): void
    {
        $wallet->update([
            'assigned_exchange_id' => null,
            'assigned_at' => null,
        ]);
    }

    /**
     * Generate a new deposit wallet via the active crypto provider.
     * Uses CryptoCloud (or whatever is active) for address generation.
     * Monitoring and AML are handled by our own services.
     */
    public function generateWallet(string $currencyCode): CustodialWallet
    {
        $cryptoMethod = CryptoMethod::where('status', 1)->first();
        if (!$cryptoMethod) {
            throw new RuntimeException('No active crypto method configured.');
        }

        $serviceClass = 'App\\Services\\CryptoMethod\\' . $cryptoMethod->code . '\\Service';
        if (!class_exists($serviceClass)) {
            throw new RuntimeException("Crypto method service [{$cryptoMethod->code}] is not available.");
        }

        $service = app($serviceClass);
        $result = $service->prepareData($cryptoMethod, $currencyCode, 'exchange', [
            'structured_response' => true,
        ]);

        $address = $result['address'] ?? (is_string($result) ? $result : null);
        if (blank($address)) {
            throw new RuntimeException("Provider [{$cryptoMethod->code}] did not return a wallet address for {$currencyCode}.");
        }

        return CustodialWallet::create([
            'currency_code' => strtoupper(trim($currencyCode)),
            'network' => $result['provider_network'] ?? null,
            'address' => $address,
            'provider' => $cryptoMethod->code,
            'provider_reference' => $result['provider_reference'] ?? null,
            'purpose' => 'deposit',
            'status' => 'active',
        ]);
    }

    /**
     * Get or create a wallet for a given currency.
     */
    public function getOrCreateWallet(string $currencyCode): CustodialWallet
    {
        $wallet = CustodialWallet::forCurrency($currencyCode)
            ->available()
            ->first();

        if ($wallet) {
            return $wallet;
        }

        return $this->generateWallet($currencyCode);
    }
}
