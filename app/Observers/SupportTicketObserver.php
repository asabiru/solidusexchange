<?php

namespace App\Observers;

use App\Models\SupportTicket;
use App\Services\Telegram\TelegramNotificationService;
use Illuminate\Support\Facades\Log;

class SupportTicketObserver
{
    public function created(SupportTicket $ticket): void
    {
        try {
            $service = app(TelegramNotificationService::class);
            $service->notifyNewTicket($ticket);
        } catch (\Exception $e) {
            Log::error('Telegram notify error on ticket created: ' . $e->getMessage());
        }
    }
}
