<?php

namespace Tests\Feature;

use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Models\User;
use App\Services\ExchangeRouting\ExchangeExecutionRoutingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class ExchangeRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('exchange_pipeline.routing.internal_matching_enabled', true);
        config()->set('exchange_pipeline.routing.netting_window_minutes', 15);
    }

    public function test_it_routes_to_internal_match_within_netting_window(): void
    {
        $user = User::factory()->create();
        [$btc, $eth] = $this->makeCurrencies();

        $first = ExchangeRequest::create([
            'user_id' => $user->id,
            'send_currency_id' => $btc->id,
            'get_currency_id' => $eth->id,
            'send_amount' => 1.00000000,
            'get_amount' => 10.00000000,
            'final_amount' => 10.00000000,
            'status' => 2,
            'utr' => 'E_FIRST',
            'destination_wallet' => 'eth-destination',
            'deposit_amount_confirmed' => 1.00000000,
            'deposit_confirmed_at' => now()->subMinutes(2),
            'aml_status' => 'approved',
        ]);

        $second = ExchangeRequest::create([
            'user_id' => $user->id,
            'send_currency_id' => $eth->id,
            'get_currency_id' => $btc->id,
            'send_amount' => 11.00000000,
            'get_amount' => 0.90000000,
            'final_amount' => 0.90000000,
            'status' => 2,
            'utr' => 'E_SECOND',
            'destination_wallet' => 'btc-destination',
            'deposit_amount_confirmed' => 11.00000000,
            'deposit_confirmed_at' => now()->subMinutes(1),
            'aml_status' => 'approved',
        ]);

        $routed = app(ExchangeExecutionRoutingService::class)->routeConfirmedDeposit($second);

        $this->assertSame('internal_match', $routed->execution_route);
        $this->assertSame($first->id, $routed->matched_exchange_request_id);

        $first->refresh();
        $this->assertSame('internal_match', $first->execution_route);
        $this->assertSame($second->id, $first->matched_exchange_request_id);
    }

    public function test_it_falls_back_to_external_hedge_outside_netting_window(): void
    {
        $user = User::factory()->create();
        [$btc, $eth] = $this->makeCurrencies();

        ExchangeRequest::create([
            'user_id' => $user->id,
            'send_currency_id' => $eth->id,
            'get_currency_id' => $btc->id,
            'send_amount' => 11.00000000,
            'get_amount' => 0.90000000,
            'final_amount' => 0.90000000,
            'status' => 2,
            'utr' => 'E_OLD_MATCH',
            'destination_wallet' => 'btc-destination',
            'deposit_amount_confirmed' => 11.00000000,
            'deposit_confirmed_at' => now()->subMinutes(30),
            'aml_status' => 'approved',
        ]);

        $exchange = ExchangeRequest::create([
            'user_id' => $user->id,
            'send_currency_id' => $btc->id,
            'get_currency_id' => $eth->id,
            'send_amount' => 1.00000000,
            'get_amount' => 10.00000000,
            'final_amount' => 10.00000000,
            'status' => 2,
            'utr' => 'E_ACTIVE',
            'destination_wallet' => 'eth-destination',
            'deposit_amount_confirmed' => 1.00000000,
            'deposit_confirmed_at' => now()->subMinutes(20),
            'aml_status' => 'approved',
        ]);

        $routed = app(ExchangeExecutionRoutingService::class)->routeConfirmedDeposit($exchange);

        $this->assertSame('external_hedge', $routed->execution_route);
        $this->assertNull($routed->matched_exchange_request_id);
        $this->assertStringContainsString('netting window has expired', (string) $routed->execution_notes);
    }

    private function makeCurrencies(): array
    {
        $btc = CryptoCurrency::create([
            'name' => 'Bitcoin',
            'code' => 'BTC',
            'symbol' => 'BTC',
            'rate' => 85000,
            'usd_rate' => 85000,
            'service_fee' => 0,
            'service_fee_type' => 'flat',
            'network_fee' => 0,
            'network_fee_type' => 'flat',
            'min_send' => 0.0001,
            'max_send' => 100,
            'status' => 1,
            'sort_by' => 1,
        ]);

        $eth = CryptoCurrency::create([
            'name' => 'Ethereum',
            'code' => 'ETH',
            'symbol' => 'ETH',
            'rate' => 3500,
            'usd_rate' => 3500,
            'service_fee' => 0,
            'service_fee_type' => 'flat',
            'network_fee' => 0,
            'network_fee_type' => 'flat',
            'min_send' => 0.001,
            'max_send' => 1000,
            'status' => 1,
            'sort_by' => 2,
        ]);

        return [$btc, $eth];
    }
}
