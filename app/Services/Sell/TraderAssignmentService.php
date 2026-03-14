<?php

namespace App\Services\Sell;

use App\Models\Admin;
use App\Models\SellRequest;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class TraderAssignmentService
{
    public function assignForSell(SellRequest $sell): ?Admin
    {
        $sell->loadMissing('fiatSendGateway');

        if ((int) $sell->status < 2 || $sell->assigned_trader_id || optional($sell->fiatSendGateway)->processing_mode !== 'manual') {
            return null;
        }

        $trader = $this->getOnlineTraders()->shuffle()->first();
        if (!$trader) {
            return null;
        }

        $updated = SellRequest::query()
            ->whereKey($sell->id)
            ->whereNull('assigned_trader_id')
            ->update([
                'assigned_trader_id' => $trader->id,
                'assigned_at' => now(),
            ]);

        if ($updated < 1) {
            return null;
        }

        $sell->refresh();

        return $trader;
    }

    public function assignPendingManualSells(): int
    {
        $traders = $this->getOnlineTraders()->shuffle()->values();
        if ($traders->isEmpty()) {
            return 0;
        }

        $pendingSells = SellRequest::query()
            ->manual()
            ->where('status', 2)
            ->whereNull('assigned_trader_id')
            ->orderBy('id')
            ->get(['id']);

        if ($pendingSells->isEmpty()) {
            return 0;
        }

        $assignedCount = 0;
        $traderCount = $traders->count();

        foreach ($pendingSells as $index => $sell) {
            $trader = $traders[$index % $traderCount];
            $updated = SellRequest::query()
                ->whereKey($sell->id)
                ->whereNull('assigned_trader_id')
                ->update([
                    'assigned_trader_id' => $trader->id,
                    'assigned_at' => now(),
                ]);

            $assignedCount += $updated;
        }

        return $assignedCount;
    }

    public function getOnlineTraders(): Collection
    {
        return Admin::query()
            ->where('role', 'trader')
            ->where('status', 1)
            ->where('is_trade_online', true)
            ->get()
            ->filter(function (Admin $admin) {
                return $admin->hasRecentSession();
            })
            ->values();
    }
}
