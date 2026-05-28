<?php

namespace App\Console\Commands;

use App\Services\ExchangePipeline\LocalAmlSourceSyncService;
use Illuminate\Console\Command;
use Throwable;

class LocalAmlSourcesSync extends Command
{
    protected $signature = 'aml:sync-local-sources
                            {--path= : Override the local AML sources directory}
                            {--prune : Revoke active entries for processed sources when they are missing from source files}';

    protected $description = 'Sync local self-hosted AML watchlists from JSON/CSV files into sanctioned_addresses';

    public function handle(LocalAmlSourceSyncService $syncService): int
    {
        try {
            $summary = $syncService->sync(
                $this->option('path') ? (string) $this->option('path') : null,
                (bool) $this->option('prune')
            );

            $this->info('Local AML source sync finished.');
            $this->line('Directory: ' . $summary['directory']);
            $this->line('Files: ' . $summary['files']);
            $this->line('Imported: ' . $summary['imported']);
            $this->line('Updated: ' . $summary['updated']);
            $this->line('Unchanged: ' . $summary['unchanged']);
            $this->line('Revoked: ' . $summary['revoked']);
            $this->line('Skipped: ' . $summary['skipped']);

            return self::SUCCESS;
        } catch (Throwable $exception) {
            report($exception);
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
    }
}
