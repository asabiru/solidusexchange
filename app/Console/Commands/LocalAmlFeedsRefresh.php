<?php

namespace App\Console\Commands;

use App\Services\ExchangePipeline\LocalAmlFeedRefreshService;
use App\Services\ExchangePipeline\LocalAmlSourceSyncService;
use Illuminate\Console\Command;
use Throwable;

class LocalAmlFeedsRefresh extends Command
{
    protected $signature = 'aml:refresh-local-feeds
                            {--manifest= : Override the remote feed manifest path}
                            {--path= : Override the local AML sources directory}
                            {--prune : Revoke active entries for processed sources when they are missing from source files}';

    protected $description = 'Download configured public AML intelligence feeds and sync them into sanctioned_addresses';

    public function handle(
        LocalAmlFeedRefreshService $feedRefreshService,
        LocalAmlSourceSyncService $sourceSyncService
    ): int {
        try {
            $manifestPath = $this->option('manifest') ? (string) $this->option('manifest') : null;
            $sourcesPath = $this->option('path') ? (string) $this->option('path') : null;

            $refreshSummary = $feedRefreshService->refresh($manifestPath, $sourcesPath);
            $syncSummary = $sourceSyncService->sync($sourcesPath, (bool) $this->option('prune'));

            $this->info('Local AML feed refresh finished.');
            $this->line('Manifest: ' . $refreshSummary['manifest']);
            $this->line('Feed directory: ' . $refreshSummary['directory']);
            $this->line('Feeds configured: ' . $refreshSummary['feeds']);
            $this->line('Feeds downloaded: ' . $refreshSummary['downloaded']);
            $this->line('Feed files written: ' . $refreshSummary['written_files']);
            $this->line('Feed entries fetched: ' . $refreshSummary['entries']);
            $this->line('Feed errors: ' . count($refreshSummary['errors']));

            if ($refreshSummary['errors'] !== []) {
                foreach ($refreshSummary['errors'] as $error) {
                    $this->warn(($error['feed'] ?? 'unknown') . ': ' . ($error['message'] ?? 'Unknown error'));
                }
            }

            $this->line('AML records imported: ' . $syncSummary['imported']);
            $this->line('AML records updated: ' . $syncSummary['updated']);
            $this->line('AML records unchanged: ' . $syncSummary['unchanged']);
            $this->line('AML records revoked: ' . $syncSummary['revoked']);
            $this->line('AML records skipped: ' . $syncSummary['skipped']);

            return self::SUCCESS;
        } catch (Throwable $exception) {
            report($exception);
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
    }
}
