<?php

namespace App\Console\Commands;

use App\Models\SbpPayment;
use App\Services\Sbp\SbpQrService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SbpPaymentResolve extends Command
{
    protected $signature = 'sbp:resolve-payments {--max-age=30 : Max age in minutes for paid payments before auto-confirm}';
    protected $description = 'Resolve stuck SBP payments: auto-confirm paid Tinkoff payments and complete linked sell requests';

    public function handle(SbpQrService $sbpService): int
    {
        $maxAge = (int) $this->option('max-age');

        // 1. Tinkoff payments stuck in "paid" (AUTHORIZED) — try to confirm via API
        $paidPayments = SbpPayment::where('status', 'paid')
            ->where('provider', 'tinkoff')
            ->whereNotNull('provider_payment_id')
            ->where('created_at', '<=', now()->subMinutes($maxAge))
            ->get();

        $confirmed = 0;
        foreach ($paidPayments as $payment) {
            try {
                $ok = $sbpService->confirmPayment($payment->provider_payment_id);
                if ($ok) {
                    $payment->update([
                        'status'       => 'confirmed',
                        'confirmed_at' => now(),
                    ]);
                    $sbpService->completeLinkedSellRequest($payment);
                    $confirmed++;
                    Log::info('SBP cron: auto-confirmed stuck paid payment', [
                        'payment_id' => $payment->id,
                        'order_id'   => $payment->order_id,
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('SBP cron: confirm failed for payment', [
                    'payment_id' => $payment->id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        // 2. Confirmed payments with incomplete SellRequest — complete the sell
        $confirmedIncomplete = SbpPayment::where('status', 'confirmed')
            ->where('payable_type', 'App\\Models\\SellRequest')
            ->whereNotNull('payable_id')
            ->where('created_at', '<=', now()->subMinutes($maxAge))
            ->get()
            ->filter(function ($p) {
                $sell = \App\Models\SellRequest::find($p->payable_id);
                return $sell && (int) $sell->status === 2;
            });

        $completed = 0;
        foreach ($confirmedIncomplete as $payment) {
            try {
                if ($sbpService->completeLinkedSellRequest($payment)) {
                    $completed++;
                }
            } catch (\Throwable $e) {
                Log::warning('SBP cron: sell completion failed', [
                    'payment_id' => $payment->id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        // 3. Expire old pending payments
        $expired = SbpPayment::where('status', 'pending')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->update(['status' => 'expired']);

        $this->info("Confirmed: {$confirmed}, Completed: {$completed}, Expired: {$expired}");

        return self::SUCCESS;
    }
}
