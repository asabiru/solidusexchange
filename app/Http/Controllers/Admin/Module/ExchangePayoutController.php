<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\ExchangePayout;
use App\Models\ExchangeRequest;
use App\Traits\SendNotification;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;

class ExchangePayoutController extends Controller
{
    use SendNotification;

    public function index(Request $request)
    {
        $status = $request->query('status');
        $type = $request->query('type');

        $data['payouts'] = ExchangePayout::with(['exchangeRequest.sendCurrency', 'exchangeRequest.getCurrency', 'user'])
            ->when(in_array($status, ['queued', 'processing', 'sent', 'failed'], true), function ($query) use ($status) {
                $query->where('status', $status);
            })
            ->when($type === 'payout', function ($query) use ($type) {
                $query->where('type', $type);
            })
            ->orderByDesc('id')
            ->paginate(20)
            ->withQueryString();

        $data['currentStatus'] = $status;
        $data['currentType'] = $type;

        return view('admin.exchange-payout.index', $data);
    }

    public function markSent(Request $request, $id)
    {
        $payout = ExchangePayout::with('exchangeRequest.sendCurrency', 'exchangeRequest.getCurrency')->findOrFail($id);

        $validated = $request->validate([
            'tx_id' => 'required|string|max:191',
        ]);

        $payout->status = 'sent';
        $payout->tx_id = $validated['tx_id'];
        $payout->error_message = null;
        $payout->processed_at = now();
        $payout->save();

        $exchange = $payout->exchangeRequest;
        if ($exchange) {
            $exchange->payout_tx_id = $validated['tx_id'];
            $exchange->hedge_status = 'payout_sent';
            $exchange->status = 3;

            $exchange->save();

            $amount = getBaseAmount($exchange->final_amount, optional($exchange->getCurrency)->code, 'crypto');

            BasicService::makeTransaction(
                $amount,
                0,
                '+',
                'Crypto Exchange Complete',
                $exchange->id,
                ExchangeRequest::class,
                $exchange->user_id,
                $exchange->final_amount,
                optional($exchange->getCurrency)->code
            );

            $this->sendUserNotification($exchange, 'userExchange', 'EXCHANGE_COMPLETE');
        }

        return back()->with('success', 'Выплата обмена помечена как успешно отправленная.');
    }

    public function markFailed(Request $request, $id)
    {
        $payout = ExchangePayout::with('exchangeRequest')->findOrFail($id);

        $validated = $request->validate([
            'error_message' => 'required|string|max:1000',
        ]);

        $payout->status = 'failed';
        $payout->error_message = $validated['error_message'];
        $payout->processed_at = now();
        $payout->save();

        if ($payout->exchangeRequest) {
            $payout->exchangeRequest->hedge_status = 'payout_failed';
            $payout->exchangeRequest->hedge_error = $validated['error_message'];
            $payout->exchangeRequest->save();
        }

        return back()->with('warning', 'Выплата обмена помечена как неудачная.');
    }
}
