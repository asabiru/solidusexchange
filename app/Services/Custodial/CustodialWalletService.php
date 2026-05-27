<?php

namespace App\Services\Custodial;

use App\Models\CustodialWallet;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use App\Traits\CryptoWalletGenerate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class CustodialWalletService
{
    private HdWalletService $hdWallet;

    public function __construct(HdWalletService $hdWallet)
    {
        $this->hdWallet = $hdWallet;
    }

    /**
     * Reserve a custodial wallet for an exchange request.
     * If no available wallet exists, generate one via HD derivation.
     */
    public function reserveForExchange(ExchangeRequest $exchange, string $currencyCode): CustodialWallet
    {
        $existing = CustodialWallet::where('assigned_exchange_id', $exchange->id)->first();
        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($exchange, $currencyCode) {
            $wallet = CustodialWallet::forCurrency($currencyCode)
                ->available()
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (!$wallet) {
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

        return DB::transaction(function () use ($sellRequest, $currencyCode) {
            $wallet = CustodialWallet::forCurrency($currencyCode)
                ->available()
                ->where('purpose', 'deposit')
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (!$wallet) {
                $wallet = $this->generateWallet($currencyCode);
            }

            $wallet->assigned_exchange_id = $sellRequest->id;
            $wallet->assigned_at = now();
            $wallet->save();

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
     * Generate a new deposit wallet using HD derivation from our mnemonic.
     * The private key is encrypted and stored for future withdrawals.
     */
    public function generateWallet(string $currencyCode): CustodialWallet
    {
        $code = strtoupper(trim($currencyCode));

        try {
            $result = $this->hdWallet->generateAddress($code);
        } catch (\Throwable $e) {
            Log::error("HD wallet generation failed for {$code}: " . $e->getMessage());
            throw new RuntimeException("Failed to generate HD wallet for {$code}: " . $e->getMessage());
        }

        $address = $result['address'];
        if (blank($address)) {
            throw new RuntimeException("HD derivation did not produce an address for {$code}");
        }

        // Encrypt private key with app key
        $encryptedKey = $this->encryptPrivateKey($result['private_key']);

        return CustodialWallet::create([
            'currency_code'         => $code,
            'network'               => $this->hdWallet->normalizeCode($code),
            'address'               => $address,
            'derivation_path'       => $result['derivation_path'],
            'hd_wallet_index'       => $result['index'],
            'encrypted_private_key' => $encryptedKey,
            'provider'              => 'hd_wallet',
            'provider_reference'    => null,
            'purpose'               => 'deposit',
            'status'                => 'active',
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

    /**
     * Decrypt the private key for a wallet (needed for withdrawals).
     */
    public function decryptPrivateKey(CustodialWallet $wallet): string
    {
        if (empty($wallet->encrypted_private_key)) {
            throw new RuntimeException("Wallet {$wallet->id} has no encrypted private key");
        }

        return $this->decryptKey($wallet->encrypted_private_key);
    }

    /**
     * Encrypt a private key using AES-256-CBC with the app key.
     */
    private function encryptPrivateKey(string $privateKey): string
    {
        $appKey = config('app.key');
        if (empty($appKey)) {
            throw new RuntimeException('APP_KEY is not set');
        }

        // Remove "base64:" prefix if present
        $key = str_starts_with($appKey, 'base64:')
            ? base64_decode(substr($appKey, 7))
            : substr($appKey, 0, 32);

        $iv = random_bytes(16);
        $encrypted = openssl_encrypt($privateKey, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);

        if ($encrypted === false) {
            throw new RuntimeException('Failed to encrypt private key: ' . openssl_error_string());
        }

        return base64_encode($iv . $encrypted);
    }

    /**
     * Decrypt a private key.
     */
    private function decryptKey(string $encryptedData): string
    {
        $appKey = config('app.key');
        $key = str_starts_with($appKey, 'base64:')
            ? base64_decode(substr($appKey, 7))
            : substr($appKey, 0, 32);

        $data = base64_decode($encryptedData);
        $iv = substr($data, 0, 16);
        $encrypted = substr($data, 16);

        $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);

        if ($decrypted === false) {
            throw new RuntimeException('Failed to decrypt private key: ' . openssl_error_string());
        }

        return $decrypted;
    }

    /**
     * Confirm a deposit for an exchange request — triggers the full pipeline.
     * Uses the CryptoWalletGenerate::walletUpgration() method which handles
     * status update, transaction creation, AML, automation, and notifications.
     */
    public function confirmDepositForExchange(ExchangeRequest $exchange, float $amount, string $txId): void
    {
        $walletUpgration = new class {
            use CryptoWalletGenerate;
        };

        $walletUpgration->walletUpgration($exchange, 'exchange', [
            'deposit_amount' => $amount,
            'deposit_tx_id' => $txId,
        ]);

        Log::info("Custodial: exchange deposit confirmed via pipeline", [
            'exchange_id' => $exchange->id,
            'utr' => $exchange->utr,
            'amount' => $amount,
            'tx_id' => $txId,
        ]);
    }

    /**
     * Confirm a deposit for a sell request — triggers the sell pipeline.
     */
    public function confirmDepositForSell(SellRequest $sell, float $amount, string $txId): void
    {
        $walletUpgration = new class {
            use CryptoWalletGenerate;
        };

        $walletUpgration->walletUpgration($sell, 'sell', [
            'deposit_amount' => $amount,
            'deposit_tx_id' => $txId,
        ]);

        Log::info("Custodial: sell deposit confirmed via pipeline", [
            'sell_id' => $sell->id,
            'utr' => $sell->utr,
            'amount' => $amount,
            'tx_id' => $txId,
        ]);
    }
}
