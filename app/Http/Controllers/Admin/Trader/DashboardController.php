<?php

namespace App\Http\Controllers\Admin\Trader;

use App\Http\Controllers\Controller;
use App\Models\SellRequest;
use App\Services\Custodial\TraderWalletService;
use App\Services\Sell\TraderAssignmentService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class DashboardController extends Controller
{
    public function index(TraderAssignmentService $assignmentService, TraderWalletService $walletService)
    {
        $assignmentService->assignPendingManualSells();

        $trader = Auth::guard('admin')->user();
        $sellQuery = SellRequest::query()
            ->with(['sendCurrency', 'getCurrency', 'user', 'fiatSendGateway'])
            ->where('assigned_trader_id', $trader->id);

        $data['stats'] = [
            'assigned' => (clone $sellQuery)->count(),
            'pending' => (clone $sellQuery)->where('status', 2)->count(),
            'completed' => (clone $sellQuery)->where('completed_by_trader_id', $trader->id)->count(),
            'cancelled' => (clone $sellQuery)->where('cancelled_by_trader_id', $trader->id)->count(),
            'completedVolume' => (clone $sellQuery)->where('completed_by_trader_id', $trader->id)->sum('final_amount'),
        ];
        $data['trader'] = $trader;
        $data['recentSells'] = (clone $sellQuery)->latest()->limit(10)->get();

        // Load trader's wallets (non-blocking)
        try {
            $data['traderWallets'] = $walletService->getWalletSummary($trader);
        } catch (\Throwable $e) {
            $data['traderWallets'] = [];
        }

        return view('admin.trader.dashboard', $data);
    }

    public function updateAvailability(Request $request, TraderAssignmentService $assignmentService)
    {
        $validated = $request->validate([
            'availability' => ['required', Rule::in(['online', 'offline'])],
        ]);

        $trader = Auth::guard('admin')->user();
        $trader->is_trade_online = $validated['availability'] === 'online';
        $trader->save();

        if ($trader->canReceiveManualDeals()) {
            $assignmentService->assignPendingManualSells();
        }

        return back()->with(
            'success',
            $trader->is_trade_online
                ? 'You are online and can receive new clients.'
                : 'You are offline and will not receive new clients.'
        );
    }
}
