<?php

namespace App\Console\Commands;

use App\Services\ExchangePipeline\ExchangeWalletWatcherService;
use Illuminate\Console\Command;
use Throwable;

class ExchangeWalletWatcherSync extends Command
{
    protected $signature = 'app:exchange-wallet-watcher-sync
                            {--force : Resubscribe wallets even if they are already marked as subscribed}
                            {--limit=100 : Maximum wallets to process per run}';

    protected $description = 'Synchronize automatic deposit webhooks for treasury exchange wallets';

    public function handle(ExchangeWalletWatcherService $watcherService): int
    {
        try {
            $count = $watcherService->syncEligibleWallets(
                (bool)$this->option('force'),
                max((int)$this->option('limit'), 1)
            );

            $this->info("Exchange wallet watcher sync complete. Processed {$count} wallet(s).");

            return self::SUCCESS;
        } catch (Throwable $exception) {
            report($exception);
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
    }
}
