<?php

namespace App\Console\Commands;

use App\Models\CustodialWallet;
use App\Services\Custodial\HdWalletService;
use Illuminate\Console\Command;

class CustodialBalanceCheck extends Command
{
    protected $signature = 'custodial:balance 
                            {--wallet= : Check specific wallet ID}
                            {--currency= : Filter by currency code}
                            {--save : Save balances to DB}';

    protected $description = 'Check balances of custodial HD wallets';

    public function handle(HdWalletService $hd): int
    {
        $walletId   = $this->option('wallet');
        $currency   = $this->option('currency');
        $save       = $this->option('save') || !$walletId; // always save when checking all

        if ($walletId) {
            $wallet = CustodialWallet::find($walletId);
            if (!$wallet) {
                $this->error("Wallet #{$walletId} not found");
                return 1;
            }
            $result = $hd->getBalance($wallet);
            $this->displayResults([$result]);
            return 0;
        }

        $query = CustodialWallet::where('status', 'active');
        if ($currency) {
            $query->where('currency_code', strtoupper($currency));
        }

        $wallets = $query->get();
        if ($wallets->isEmpty()) {
            $this->warn('No active custodial wallets found.');
            return 0;
        }

        $this->info("Checking balances for {$wallets->count()} wallets...");
        $results = $hd->checkAllBalances();
        $this->displayResults($results);

        return 0;
    }

    private function displayResults(array $results): void
    {
        $rows = [];
        $totalByCurrency = [];

        foreach ($results as $r) {
            $bal = $r['balance'] ?? 0;
            $code = $r['currency_code'] ?? '?';
            $rows[] = [
                $r['wallet_id'] ?? '-',
                $r['address'] ?? '-',
                $code,
                $r['chain'] ?? '-',
                number_format($bal, 8),
                $r['error'] ?? '',
            ];
            $totalByCurrency[$code] = ($totalByCurrency[$code] ?? 0) + $bal;
        }

        $this->table(
            ['ID', 'Address', 'Currency', 'Chain', 'Balance', 'Error'],
            $rows
        );

        if (!empty($totalByCurrency)) {
            $this->newLine();
            $this->info('Totals by currency:');
            foreach ($totalByCurrency as $code => $total) {
                $this->line("  {$code}: " . number_format($total, 8));
            }
        }
    }
}
