<?php

namespace App\Console;

use App\Console\Commands\CryptoCurrencyUpdateCron;
use App\Console\Commands\FiatCurrencyUpdateCron;
use App\Models\BuyRequest;
use App\Models\Deposit;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected $commands = [
        CryptoCurrencyUpdateCron::class,
        FiatCurrencyUpdateCron::class,
    ];

    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        $basicControl = basicControl();
        if ($basicControl->coin_market_cap_auto_update) {
            $schedule->command('app:crypto-currency-update-cron')->{basicControl()->coin_market_cap_auto_update_at}();
        }
        if ($basicControl->currency_layer_auto_update) {
            $schedule->command('app:fiat-currency-update-cron')->{basicControl()->currency_layer_auto_update_at}();
        }

        $schedule->command('model:prune', [
            '--model' => [
                Deposit::class,
                ExchangeRequest::class,
                BuyRequest::class,
                SellRequest::class,
            ],
        ])->daily();
    }

    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');

        require base_path('routes/console.php');
    }
}
