<?php

namespace App\Services\Tatum;

use App\Models\TatumSubscription;
use App\Models\CustodialWallet;
use Illuminate\Support\Facades\Log;

/**
 * Manages Tatum notification subscriptions per wallet address.
 *
 * When a custodial wallet is assigned to a deposit:
 *   1. Subscribe native coin monitoring
 *   2. If address can receive tokens (USDT etc.) — subscribe token monitoring too
 *   3. Store subscription IDs in tatum_subscriptions table
 *
 * When a wallet is released / request cancelled:
 *   1. Unsubscribe all subscriptions for that address
 */
class TatumNotificationService
{
    public function __construct(
        private readonly TatumService $tatum
    ) {}

    /**
     * Subscribe an address for deposit notifications.
     * Subscribes both native coin and token (if applicable).
     *
     * @return TatumSubscription[]
     */
    public function subscribeWallet(CustodialWallet $wallet): array
    {
        $currencyCode = strtoupper($wallet->currency_code);
        $address      = $wallet->address;
        $webhookUrl   = $this->webhookUrl();

        if (empty($webhookUrl)) {
            Log::warning("Tatum: TATUM_WEBHOOK_URL not set — skipping subscription for wallet {$wallet->id}");
            return [];
        }

        $subscriptions = [];

        try {
            $chain = $this->tatum->resolveChain($currencyCode);

            if ($chain === null) {
                Log::info("Tatum: {$currencyCode} not supported by Tatum notifications — skipping, will use own polling");
                return [];
            }

            // 1. Native coin subscription (also needed for gas fee detection on token chains)
            $nativeSub = $this->tatum->subscribeAddress($address, $chain, $webhookUrl);
            $subscriptions[] = TatumSubscription::create([
                'tatum_id'       => $nativeSub['id'],
                'wallet_id'      => $wallet->id,
                'address'        => $address,
                'chain'          => $chain,
                'currency_code'  => $currencyCode,
                'type'           => 'INCOMING_NATIVE_TX',
                'contract_address' => null,
                'status'         => 'active',
            ]);

            // 2. Token subscription (for ERC20/TRC20/etc.)
            $contractAddress = $this->tatum->resolveContractAddress($currencyCode);
            if ($contractAddress) {
                $tokenSub = $this->tatum->subscribeTokenAddress(
                    $address,
                    $chain,
                    $contractAddress,
                    $webhookUrl
                );
                $subscriptions[] = TatumSubscription::create([
                    'tatum_id'        => $tokenSub['id'],
                    'wallet_id'       => $wallet->id,
                    'address'         => $address,
                    'chain'           => $chain,
                    'currency_code'   => $currencyCode,
                    'type'            => 'INCOMING_FUNGIBLE_TX',
                    'contract_address'=> $contractAddress,
                    'status'          => 'active',
                ]);
            }
        } catch (\Throwable $e) {
            Log::error("Tatum: failed to subscribe wallet {$wallet->id} ({$currencyCode}): " . $e->getMessage());
        }

        return $subscriptions;
    }

    /**
     * Unsubscribe all Tatum notifications for a wallet address.
     */
    public function unsubscribeWallet(CustodialWallet $wallet): void
    {
        $subs = TatumSubscription::where('wallet_id', $wallet->id)->get();

        foreach ($subs as $sub) {
            $this->tatum->unsubscribe($sub->tatum_id);
            $sub->update(['status' => 'deleted']);
        }
    }

    /**
     * Unsubscribe by Tatum subscription ID.
     */
    public function unsubscribeById(string $tatumId): void
    {
        $this->tatum->unsubscribe($tatumId);
        TatumSubscription::where('tatum_id', $tatumId)->update(['status' => 'deleted']);
    }

    /**
     * Get all active subscriptions for an address.
     */
    public function getByAddress(string $address): \Illuminate\Database\Eloquent\Collection
    {
        return TatumSubscription::where('address', $address)
            ->where('status', 'active')
            ->get();
    }

    private function webhookUrl(): string
    {
        $url = config('tatum.webhook_url', '');
        if (empty($url)) {
            $url = rtrim(config('app.url', ''), '/') . '/api/tatum/webhook';
        }
        return $url;
    }
}
