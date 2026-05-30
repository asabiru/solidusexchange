<?php

namespace App\Http\Controllers\Admin\Trader;

use App\Http\Controllers\Controller;
use App\Models\SellRequest;
use App\Services\Sell\TraderAssignmentService;
use App\Traits\SendNotification;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class SellController extends Controller
{
    use SendNotification;

    public function index(Request $request, TraderAssignmentService $assignmentService)
    {
        $assignmentService->assignPendingManualSells();

        $type = $request->get('type', 'all');
        if (!in_array($type, ['all', 'pending', 'complete', 'cancel'], true)) {
            abort(404);
        }

        $trader = Auth::guard('admin')->user();

        $query = SellRequest::query()
            ->with(['sendCurrency', 'getCurrency', 'user', 'fiatSendGateway'])
            ->where('assigned_trader_id', $trader->id)
            ->orderByDesc('id');

        $query = match ($type) {
            'pending' => $query->where('status', 2),
            'complete' => $query->where('status', 3),
            'cancel' => $query->where('status', 5),
            default => $query->whereIn('status', [2, 3, 5]),
        };

        $data['sellType'] = $type;
        $data['sells'] = $query->paginate(15)->withQueryString();
        $data['stats'] = [
            'pending' => SellRequest::query()->where('assigned_trader_id', $trader->id)->where('status', 2)->count(),
            'completed' => SellRequest::query()->where('completed_by_trader_id', $trader->id)->count(),
            'cancelled' => SellRequest::query()->where('cancelled_by_trader_id', $trader->id)->count(),
            'volume' => SellRequest::query()->where('completed_by_trader_id', $trader->id)->sum('final_amount'),
        ];

        return view('admin.trader.sell.index', $data);
    }

    public function show($utr)
    {
        $sell = $this->getAssignedSell($utr);
        return view('admin.trader.sell.details', compact('sell'));
    }

    public function send($utr)
    {
        $trader = Auth::guard('admin')->user();
        $sell = $this->getAssignedSell($utr, 2);

        $sell->status = 3;
        $sell->completed_by_trader_id = $trader->id;
        $sell->completed_at = now();
        $sell->save();

        $amount = getBaseAmount($sell->final_amount, optional($sell->getCurrency)->code, 'fiat');
        BasicService::makeTransaction(
            $amount,
            0,
            '+',
            'Crypto Sell Complete',
            $sell->id,
            SellRequest::class,
            $sell->user_id,
            $sell->final_amount,
            optional($sell->getCurrency)->code
        );

        $this->sendUserNotification($sell, 'userSell', 'SELL_COMPLETE');

        return back()->with('success', 'Продажа успешно завершена.');
    }

    public function cancel($utr)
    {
        $trader = Auth::guard('admin')->user();
        $sell = $this->getAssignedSell($utr, 2);

        $sell->status = 5;
        $sell->cancelled_by_trader_id = $trader->id;
        $sell->cancelled_at = now();
        $sell->save();

        $this->sendUserNotification($sell, 'userSell', 'SELL_CANCEL');

        return back()->with('success', 'Продажа успешно отменена.');
    }

    private function getAssignedSell(string $utr, ?int $status = null): SellRequest
    {
        $query = SellRequest::query()
            ->with(['sendCurrency', 'getCurrency', 'user', 'fiatSendGateway', 'assignedTrader'])
            ->where('utr', $utr)
            ->where('assigned_trader_id', Auth::guard('admin')->id());

        if ($status !== null) {
            $query->where('status', $status);
        }

        return $query->latest()->firstOrFail();
    }
}
