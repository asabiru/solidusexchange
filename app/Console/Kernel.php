<?php

namespace App\Console;

use App\Console\Commands\CryptoCurrencyUpdateCron;
use App\Console\Commands\CustodialDepositMonitor;
use App\Console\Commands\ExchangeReservationCleanup;
use App\Console\Commands\SbpPaymentResolve;
use App\Console\Commands\ExchangeWalletWatcherSync;
use App\Console\Commands\FiatCurrencyUpdateCron;
use App\Console\Commands\LocalAmlFeedsRefresh;
use App\Console\Commands\LocalAmlSourcesSync;
use App\Console\Commands\PopularCryptoBootstrap;
use App\Console\Commands\SwitchProjectToRub;
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
        LocalAmlFeedsRefresh::class,
        LocalAmlSourcesSync::class,
        PopularCryptoBootstrap::class,
        SwitchProjectToRub::class,
        ExchangeReservationCleanup::class,
        ExchangeWalletWatcherSync::class,
        CustodialDepositMonitor::class,
        SbpPaymentResolve::class,
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

        if (config('exchange_pipeline.treasury.watch_provider') !== 'none') {
            $schedule->command('app:exchange-wallet-watcher-sync')->everyFifteenMinutes();
        }

        $schedule->command('app:exchange-reservation-cleanup')->everyFiveMinutes();

        $schedule->command('aml:refresh-local-feeds --prune')->twiceDaily(1, 13);
        $schedule->command('aml:sync-local-sources')->dailyAt('02:10');

        // Custodial deposit monitoring — scan wallets for new deposits
        $schedule->command('custodial:monitor-deposits')->everyMinute();

        // SBP payment resolution — auto-confirm stuck paid payments, expire old pending
        $schedule->command('sbp:resolve-payments')->everyFiveMinutes();

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
