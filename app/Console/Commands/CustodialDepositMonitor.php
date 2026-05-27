<?php

namespace App\Console\Commands;

use App\Services\Custodial\CustodialDepositService;
use Illuminate\Console\Command;

class CustodialDepositMonitor extends Command
{
    protected $signature = 'custodial:monitor-deposits {--wallet_id= : Scan specific wallet}';
    protected $description = 'Scan custodial wallets for new deposits and process them through AML';

    public function handle(CustodialDepositService $depositService): int
    {
        $this->info('Scanning custodial wallets for deposits...');

        $results = $depositService->scanAllWallets();

        $this->info("Scanned: {$results['scanned']} wallets");
        $this->info("New deposits: {$results['new_deposits']}");

        if ($results['errors'] > 0) {
            $this->warn("Errors: {$results['errors']}");
        }

        return self::SUCCESS;
    }
}
