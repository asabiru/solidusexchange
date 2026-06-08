<?php

namespace App\Services\Custodial;

use App\Models\Admin;
use App\Models\CustodialWallet;
use App\Services\Tatum\TatumNotificationService;
use Illuminate\Support\Facades\Log;

/**
 * Manages per-trader custodial wallets.
 *
 * Each trader has their own set of wallets (one per currency):
 *   - USDT_TRC20 (primary for RUB↔crypto)
 *   - BTC, ETH, USDT, TON, USDT_TON
 *
 * When a buy/sell request is assigned to a trader:
 *   - Payouts come from that trader's wallet
 *   - Deposits go to that trader's wallet
 *
 * This allows traders to independently manage their crypto balances.
 */
class TraderWalletService
{
    /** Default currencies to create per trader */
    private const DEFAULT_CURRENCIES = [
        'USDT_TRC20',
        'BTC',
        'ETH',
        'USDT',
        'TON',
        'USDT_TON',
    ];

    public function __construct(
        private readonly HdWalletService $hdWallet,
        private readonly ?TatumNotificationService $tatum = null,
    ) {}

    /**
     * Get all wallets for a trader.
     */
    public function getTraderWallets(Admin $trader): \Illuminate\Database\Eloquent\Collection
    {
        return CustodialWallet::forTrader($trader->id)
            ->where('status', 'active')
            ->get();
    }

    /**
     * Get a specific currency wallet for a trader.
     */
    public function getWallet(Admin $trader, string $currencyCode): ?CustodialWallet
    {
        return CustodialWallet::forTrader($trader->id)
            ->forCurrency($currencyCode)
            ->where('status', 'active')
            ->first();
    }

    /**
     * Generate wallets for a newly created trader.
     * Called automatically when a trader is created.
     */
    public function generateForTrader(Admin $trader, array $currencies = null): array
    {
        $currencies = $currencies ?? self::DEFAULT_CURRENCIES;
        $created = [];

        foreach ($currencies as $code) {
            if ($this->getWallet($trader, $code)) {
                Log::info("TraderWallet: {$code} wallet already exists for trader {$trader->id}");
                continue;
            }

            try {
                $wallet = $this->createWallet($trader, $code);
                $created[] = $wallet;
                Log::info("TraderWallet: created {$code} wallet for trader {$trader->id}", [
                    'address' => $wallet->address,
                ]);
            } catch (\Throwable $e) {
                Log::error("TraderWallet: failed to create {$code} wallet for trader {$trader->id}: " . $e->getMessage());
            }
        }

        return $created;
    }

    /**
     * Create a single wallet for a trader.
     * USDT_TON shares address with TON.
     */
    public function createWallet(Admin $trader, string $currencyCode): CustodialWallet
    {
        $code = strtoupper($currencyCode);

        // USDT_TON shares address with TON
        if ($code === 'USDT_TON') {
            $tonWallet = $this->getWallet($trader, 'TON');
            if (!$tonWallet) {
                $tonWallet = $this->createWallet($trader, 'TON');
            }
            return CustodialWallet::create([
                'trader_id'             => $trader->id,
                'currency_code'         => 'USDT_TON',
                'address'               => $tonWallet->address,
                'encrypted_private_key' => $tonWallet->encrypted_private_key,
                'hd_wallet_index'       => $tonWallet->hd_wallet_index,
                'derivation_path'       => $tonWallet->derivation_path,
                'purpose'               => 'both',
                'status'                => 'active',
                'balance'               => 0,
            ]);
        }

        // USDT (ERC20) shares address with ETH
        if ($code === 'USDT') {
            $ethWallet = $this->getWallet($trader, 'ETH');
            if (!$ethWallet) {
                $ethWallet = $this->createWallet($trader, 'ETH');
            }
            return CustodialWallet::create([
                'trader_id'             => $trader->id,
                'currency_code'         => 'USDT',
                'address'               => $ethWallet->address,
                'encrypted_private_key' => $ethWallet->encrypted_private_key,
                'hd_wallet_index'       => $ethWallet->hd_wallet_index,
                'derivation_path'       => $ethWallet->derivation_path,
                'purpose'               => 'both',
                'status'                => 'active',
                'balance'               => 0,
            ]);
        }

        // Generate new address
        $data = $this->hdWallet->generateAddress($code);

        $wallet = CustodialWallet::create([
            'trader_id'             => $trader->id,
            'currency_code'         => $code,
            'address'               => $data['address'],
            'encrypted_private_key' => encrypt($data['private_key']),
            'hd_wallet_index'       => $data['index'],
            'derivation_path'       => $data['derivation_path'],
            'purpose'               => 'both', // trader wallet receives AND sends
            'status'                => 'active',
            'balance'               => 0,
        ]);

        // Subscribe to Tatum notifications
        if ($this->tatum && !empty(config('tatum.api_key'))) {
            try {
                $this->tatum->subscribeWallet($wallet);
            } catch (\Throwable $e) {
                Log::warning("TraderWallet: Tatum subscription failed for {$code}: " . $e->getMessage());
            }
        }

        return $wallet;
    }

    /**
     * Find the best payout wallet for a trader and currency.
     * Used when sending crypto to a client.
     */
    public function findPayoutWallet(Admin $trader, string $currencyCode, float $amount): ?CustodialWallet
    {
        $wallet = $this->getWallet($trader, $currencyCode);
        if (!$wallet) {
            return null;
        }

        // Check on-chain balance
        try {
            $balInfo = $this->hdWallet->getBalance($wallet);
            if (($balInfo['balance'] ?? 0) >= $amount) {
                return $wallet;
            }
            Log::warning("TraderWallet: insufficient balance for trader {$trader->id} {$currencyCode}", [
                'available' => $balInfo['balance'] ?? 0,
                'required'  => $amount,
            ]);
        } catch (\Throwable $e) {
            Log::error("TraderWallet: balance check failed: " . $e->getMessage());
        }

        return null;
    }

    /**
     * Get wallet summary for trader dashboard.
     */
    public function getWalletSummary(Admin $trader): array
    {
        $wallets = $this->getTraderWallets($trader);
        $summary = [];

        foreach ($wallets as $wallet) {
            try {
                $balInfo = $this->hdWallet->getBalance($wallet);
                $summary[] = [
                    'currency'    => $wallet->currency_code,
                    'address'     => $wallet->address,
                    'balance'     => $balInfo['balance'] ?? $wallet->balance,
                    'wallet_id'   => $wallet->id,
                    'purpose'     => $wallet->purpose,
                ];
            } catch (\Throwable $e) {
                $summary[] = [
                    'currency'    => $wallet->currency_code,
                    'address'     => $wallet->address,
                    'balance'     => $wallet->balance,
                    'wallet_id'   => $wallet->id,
                    'purpose'     => $wallet->purpose,
                    'error'       => $e->getMessage(),
                ];
            }
        }

        return $summary;
    }
}
