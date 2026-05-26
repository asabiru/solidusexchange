<?php

namespace App\Console\Commands;

use App\Services\ExchangePipeline\ExchangeReservationService;
use Illuminate\Console\Command;

class ExchangeReservationCleanup extends Command
{
    protected $signature = 'app:exchange-reservation-cleanup';

    protected $description = 'Release expired or cancelled exchange wallet reservations';

    public function handle(ExchangeReservationService $reservationService): int
    {
        $result = $reservationService->releaseExpiredAndCancelledReservations();

        $this->info(
            "Exchange reservation cleanup complete. Expired exchanges: {$result['expired_exchange_count']}, released wallets: {$result['released_wallet_count']}."
        );

        return self::SUCCESS;
    }
}
