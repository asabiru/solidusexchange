<?php

namespace Tests\Unit;

use App\Services\ExchangePipeline\LocalAmlFeedRefreshService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class LocalAmlFeedRefreshServiceTest extends TestCase
{
    use RefreshDatabase;

    private string $tempDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tempDirectory = storage_path('framework/testing/aml_feeds_' . uniqid());
        File::ensureDirectoryExists($this->tempDirectory);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tempDirectory);

        parent::tearDown();
    }

    public function test_it_downloads_configured_csv_feed_into_local_source_json(): void
    {
        $manifestPath = $this->tempDirectory . '/feeds.json';
        $sourcesPath = $this->tempDirectory . '/sources';

        File::put($manifestPath, json_encode([
            'feeds' => [
                [
                    'name' => 'bitcoin_abuse',
                    'enabled' => true,
                    'url' => 'https://feed.test/bitcoin.csv',
                    'format' => 'csv',
                    'source' => 'bitcoin_abuse',
                    'severity' => 'high_risk',
                    'entity_type' => 'scam',
                    'field_map' => [
                        'address' => 'address',
                        'reason' => 'reason',
                    ],
                ],
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        Http::fake([
            'https://feed.test/bitcoin.csv' => Http::response(
                "address,reason\n1AbcAddr,Community report\n",
                200,
                ['Content-Type' => 'text/csv']
            ),
        ]);

        $summary = app(LocalAmlFeedRefreshService::class)->refresh($manifestPath, $sourcesPath);

        $this->assertSame(1, $summary['feeds']);
        $this->assertSame(1, $summary['downloaded']);
        $this->assertSame(1, $summary['written_files']);
        $this->assertSame(1, $summary['entries']);

        $writtenFile = $sourcesPath . '/bitcoin_abuse.json';
        $this->assertTrue(File::exists($writtenFile));

        $payload = json_decode((string) File::get($writtenFile), true);
        $this->assertSame('bitcoin_abuse', $payload['source']);
        $this->assertSame('1AbcAddr', $payload['entries'][0]['address']);
        $this->assertSame('Community report', $payload['entries'][0]['reason']);
    }

    public function test_it_extracts_nested_wallet_entries_from_ndjson_feeds(): void
    {
        $manifestPath = $this->tempDirectory . '/feeds.ndjson.json';
        $sourcesPath = $this->tempDirectory . '/sources_ndjson';

        File::put($manifestPath, json_encode([
            'feeds' => [
                [
                    'name' => 'opensanctions_us_ofac',
                    'enabled' => true,
                    'url' => 'https://feed.test/ofac.ndjson',
                    'format' => 'ndjson',
                    'entries_path' => 'properties.cryptoWallets',
                    'source' => 'opensanctions_us_ofac',
                    'severity' => 'blocked',
                    'entity_type' => 'sanctioned_wallet',
                    'field_map' => [
                        'address' => 'properties.publicKey.0',
                        'currency_code' => 'properties.currency.0',
                        'entity_name' => '__parent.caption',
                        'reason' => '__parent.properties.sanctions.0.properties.reason.0',
                        'external_id' => 'id',
                        'meta.entity_id' => '__parent.id',
                        'meta.dataset' => '__parent.datasets.0',
                    ],
                ],
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        Http::fake([
            'https://feed.test/ofac.ndjson' => Http::response(implode("\n", [
                json_encode([
                    'id' => 'NK-parent-1',
                    'caption' => 'Example Sanctioned Entity',
                    'datasets' => ['us_ofac_sdn'],
                    'properties' => [
                        'sanctions' => [
                            [
                                'properties' => [
                                    'reason' => ['Executive Order 14059'],
                                ],
                            ],
                        ],
                        'cryptoWallets' => [
                            [
                                'id' => 'wallet-1',
                                'properties' => [
                                    'publicKey' => ['0xABC123'],
                                    'currency' => ['ETH'],
                                ],
                            ],
                            [
                                'id' => 'wallet-2',
                                'properties' => [
                                    'publicKey' => ['bc1wallet'],
                                    'currency' => ['XBT'],
                                ],
                            ],
                        ],
                    ],
                ]),
                json_encode([
                    'id' => 'NK-parent-2',
                    'caption' => 'Entity Without Wallets',
                    'datasets' => ['us_ofac_sdn'],
                    'properties' => [],
                ]),
            ]), 200, ['Content-Type' => 'application/x-ndjson']),
        ]);

        $summary = app(LocalAmlFeedRefreshService::class)->refresh($manifestPath, $sourcesPath);

        $this->assertSame(1, $summary['feeds']);
        $this->assertSame(1, $summary['downloaded']);
        $this->assertSame(1, $summary['written_files']);
        $this->assertSame(2, $summary['entries']);

        $writtenFile = $sourcesPath . '/opensanctions_us_ofac.json';
        $this->assertTrue(File::exists($writtenFile));

        $payload = json_decode((string) File::get($writtenFile), true);
        $this->assertCount(2, $payload['entries']);
        $this->assertSame('0xABC123', $payload['entries'][0]['address']);
        $this->assertSame('ETH', $payload['entries'][0]['currency_code']);
        $this->assertSame('Example Sanctioned Entity', $payload['entries'][0]['entity_name']);
        $this->assertSame('Executive Order 14059', $payload['entries'][0]['reason']);
        $this->assertSame('wallet-1', $payload['entries'][0]['external_id']);
        $this->assertSame('NK-parent-1', $payload['entries'][0]['meta']['entity_id']);
        $this->assertSame('us_ofac_sdn', $payload['entries'][0]['meta']['dataset']);
        $this->assertSame('bc1wallet', $payload['entries'][1]['address']);
    }
}
