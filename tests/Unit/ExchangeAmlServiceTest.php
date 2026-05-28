<?php

namespace Tests\Unit;

use App\Models\CustodialDeposit;
use App\Models\SanctionedAddress;
use App\Services\ExchangePipeline\ExchangeAmlService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ExchangeAmlServiceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('exchange_pipeline.aml.enabled', true);
        config()->set('exchange_pipeline.aml.provider', 'local_db');
        config()->set('exchange_pipeline.aml.api_key', null);
        config()->set('exchange_pipeline.aml.api_secret', null);
        config()->set('exchange_pipeline.aml.api_url', null);
    }

    public function test_local_wallet_screening_rejects_addresses_from_local_watchlist_without_external_calls(): void
    {
        SanctionedAddress::create([
            'address' => SanctionedAddress::normalizeAddress('0xabc123'),
            'currency_code' => 'ETH',
            'source' => 'manual',
            'entity_name' => 'Test Mixer',
            'reason' => 'Known laundering destination',
            'severity' => 'blocked',
            'status' => 'active',
            'list_date' => now()->toDateString(),
        ]);

        Http::fake();

        $decision = app(ExchangeAmlService::class)->screenWalletAddress('0xAbC123', 'ETH');

        $this->assertSame('rejected', $decision['status']);
        $this->assertSame('internal_db', $decision['provider']);
        $this->assertSame('high', $decision['risk_level']);
        $this->assertSame(100, $decision['risk_score']);
        Http::assertNothingSent();
    }

    public function test_local_wallet_screening_sends_exact_monitor_matches_to_manual_review_without_external_calls(): void
    {
        SanctionedAddress::create([
            'address' => SanctionedAddress::normalizeAddress('TMonitorAddr123'),
            'currency_code' => 'USDT_TRC20',
            'source' => 'russia_cb',
            'entity_name' => 'High Risk Exchange',
            'reason' => 'Monitoring-only local intelligence hit',
            'severity' => 'monitor',
            'status' => 'active',
            'list_date' => now()->toDateString(),
        ]);

        Http::fake();

        $decision = app(ExchangeAmlService::class)->screenWalletAddress('TMonitorAddr123', 'USDT_TRC20');

        $this->assertSame('pending', $decision['status']);
        $this->assertSame('internal_db', $decision['provider']);
        $this->assertSame('medium', $decision['risk_level']);
        $this->assertSame(45, $decision['risk_score']);
        Http::assertNothingSent();
    }

    public function test_local_custodial_deposit_screening_stays_offline_for_clean_addresses(): void
    {
        Http::fake();

        $deposit = CustodialDeposit::create([
            'currency_code' => 'BTC',
            'tx_hash' => 'tx-local-1',
            'amount' => 0.015,
            'status' => 'confirmed',
            'source_address' => 'bc1qtestlocaladdress123',
            'detected_at' => now(),
        ]);

        $decision = app(ExchangeAmlService::class)->screenCustodialDeposit($deposit);

        $this->assertSame('approved', $decision['status']);
        $this->assertSame('local_db', $decision['provider']);
        $this->assertSame('low', $decision['risk_level']);
        Http::assertNothingSent();
    }

    public function test_local_wallet_screening_falls_back_to_manual_review_when_aml_tables_are_missing(): void
    {
        Http::fake();
        Schema::drop('sanctioned_addresses');

        $decision = app(ExchangeAmlService::class)->screenWalletAddress('0xAbC123', 'ETH');

        $this->assertSame('pending', $decision['status']);
        $this->assertSame('internal_db', $decision['provider']);
        $this->assertSame('high', $decision['risk_level']);
        $this->assertSame(80, $decision['risk_score']);
        Http::assertNothingSent();
    }
}
