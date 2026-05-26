<?php

namespace Tests\Feature;

use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Models\ExchangeWallet;
use App\Models\User;
use App\Services\ExchangePipeline\ExchangeReservationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExchangeReservationCleanupTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_releases_reserved_wallet_for_expired_exchange(): void
    {
        $user = User::factory()->create();
        $currency = CryptoCurrency::create([
            'name' => 'Tether',
            'code' => 'USDT',
            'symbol' => 'USDT',
            'rate' => 1,
            'usd_rate' => 1,
            'service_fee' => 0,
            'service_fee_type' => 'flat',
            'network_fee' => 0,
            'network_fee_type' => 'flat',
            'min_send' => 1,
            'max_send' => 100000,
            'status' => 1,
            'sort_by' => 1,
        ]);

        $exchange = ExchangeRequest::create([
            'user_id' => $user->id,
            'send_currency_id' => $currency->id,
            'get_currency_id' => $currency->id,
            'send_amount' => 100,
            'get_amount' => 100,
            'final_amount' => 100,
            'status' => 1,
            'utr' => 'E_EXPIRED',
            'expire_time' => now()->subMinute(),
        ]);

        $wallet = ExchangeWallet::create([
            'currency_code' => 'USDT',
            'address' => 'T_reserved_wallet',
            'network' => 'TRC20',
            'status' => true,
            'allocation_status' => 'reserved',
            'exchange_request_id' => $exchange->id,
            'reserved_at' => now()->subMinutes(10),
        ]);

        $result = app(ExchangeReservationService::class)->releaseExpiredAndCancelledReservations();

        $exchange->refresh();
        $wallet->refresh();

        $this->assertSame(4, (int) $exchange->status);
        $this->assertSame('available', $wallet->allocation_status);
        $this->assertNull($wallet->exchange_request_id);
        $this->assertSame(1, $result['expired_exchange_count']);
        $this->assertSame(1, $result['released_wallet_count']);
    }
}
