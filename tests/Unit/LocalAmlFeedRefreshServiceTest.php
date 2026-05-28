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
}
