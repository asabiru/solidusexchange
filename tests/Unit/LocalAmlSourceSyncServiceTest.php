<?php

namespace Tests\Unit;

use App\Models\SanctionedAddress;
use App\Services\ExchangePipeline\LocalAmlSourceSyncService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LocalAmlSourceSyncServiceTest extends TestCase
{
    use RefreshDatabase;

    private string $tempDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tempDirectory = storage_path('framework/testing/aml_sources_' . uniqid());
        File::ensureDirectoryExists($this->tempDirectory);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tempDirectory);

        parent::tearDown();
    }

    public function test_it_imports_local_json_and_csv_watchlists_and_can_prune_missing_records(): void
    {
        File::put($this->tempDirectory . '/watchlist.json', json_encode([
            'source' => 'local_osint',
            'severity' => 'blocked',
            'entries' => [
                [
                    'address' => '0xabc123',
                    'currency_code' => 'ETH',
                    'entity_name' => 'Mixer A',
                    'entity_type' => 'mixer',
                    'reason' => 'JSON import',
                    'tags' => ['mixer', 'sanctions'],
                ],
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        File::put($this->tempDirectory . '/monitoring.csv', implode("\n", [
            'address,currency_code,source,entity_name,entity_type,severity,reason',
            'TWatch123,USDT_TRC20,russia_cb,High Risk Exchange,exchange,monitor,CSV import',
        ]));

        $summary = app(LocalAmlSourceSyncService::class)->sync($this->tempDirectory, false);

        $this->assertSame(2, $summary['files']);
        $this->assertSame(2, $summary['imported']);
        $this->assertDatabaseHas('sanctioned_addresses', [
            'address' => SanctionedAddress::normalizeAddress('0xabc123'),
            'source' => 'local_osint',
            'severity' => 'blocked',
        ]);
        $this->assertDatabaseHas('sanctioned_addresses', [
            'address' => SanctionedAddress::normalizeAddress('TWatch123'),
            'source' => 'russia_cb',
            'severity' => 'monitor',
        ]);

        File::put($this->tempDirectory . '/watchlist.json', json_encode([
            'source' => 'local_osint',
            'severity' => 'high_risk',
            'entries' => [],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $prunedSummary = app(LocalAmlSourceSyncService::class)->sync($this->tempDirectory, true);

        $this->assertGreaterThanOrEqual(1, $prunedSummary['revoked']);
        $this->assertDatabaseHas('sanctioned_addresses', [
            'address' => SanctionedAddress::normalizeAddress('0xabc123'),
            'source' => 'local_osint',
            'status' => 'revoked',
        ]);
    }
}
