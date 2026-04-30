<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\ExchangePayout;
use App\Models\ExchangeRequest;
use App\Services\ExchangeEngine\ExchangeQuoteService;
use App\Services\ExchangePipeline\ExchangePayoutService;
use App\Services\ExchangePipeline\ExchangeReservationService;
use App\Traits\CalculateFees;
use App\Traits\CryptoWalletGenerate;
use App\Traits\SendNotification;
use Carbon\Carbon;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use Throwable;
use Yajra\DataTables\Facades\DataTables;

class ExchangeController extends Controller
{
    use CalculateFees, SendNotification, CryptoWalletGenerate;

    public function __construct(
        private readonly ExchangePayoutService $payoutService,
        private readonly ExchangeReservationService $reservationService,
    ) {
    }

    public function exchangeList(Request $request)
    {
        if (!in_array($request->type, ['all', 'pending', 'complete', 'cancel'])) {
            abort(404);
        }
        $data['exchangeType'] = $request->type;
        $data['exchanges'] = collect(ExchangeRequest::selectRaw('COUNT(id) AS totalExchange')
            ->selectRaw('COUNT(CASE WHEN status IN (1, 2) THEN id END) AS pendingExchange')
            ->selectRaw('(COUNT(CASE WHEN status IN (1, 2) THEN id END) / COUNT(id)) * 100 AS pendingExchangePercentage')
            ->selectRaw('COUNT(CASE WHEN status = 3 THEN id END) AS completeExchange')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END) / COUNT(id)) * 100 AS completeExchangePercentage')
            ->selectRaw('COUNT(CASE WHEN status = 5 THEN id END) AS cancelExchange')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END) / COUNT(id)) * 100 AS cancelExchangePercentage')
            ->get()
            ->toArray())->collapse();
        return view('admin.exchange.index', $data);
    }

    public function exchangeListSearch(Request $request)
    {
        $exchangeType = $request->type;
        $search = $request->search['value'] ?? null;
        $filterName = $request->name;
        $filterStatus = $request->filterStatus;
        $filterDate = explode('-', $request->filterDate);
        $startDate = $filterDate[0];
        $endDate = isset($filterDate[1]) ? trim($filterDate[1]) : null;

        $exchanges = ExchangeRequest::with(['sendCurrency', 'getCurrency', 'user:id,firstname,lastname,username,image,image_driver', 'matchedExchange'])
            ->orderBy('id', 'DESC')
            ->when(isset($exchangeType), function ($query) use ($exchangeType) {
                if ($exchangeType == 'pending') {
                    return $query->whereIn('status', [1, 2]);
                } elseif ($exchangeType == 'complete') {
                    return $query->where('status', 3);
                } elseif ($exchangeType == 'cancel') {
                    return $query->where('status', 5);
                } else {
                    return $query->whereIn('status', ['1', '2', '3', '5']);
                }
            })
            ->when(isset($filterName), function ($query) use ($filterName) {
                return $query->where('utr', 'LIKE', '%' . $filterName . '%');
            })
            ->when(isset($filterStatus), function ($query) use ($filterStatus) {
                if ($filterStatus != "all") {
                    return $query->where('status', $filterStatus);
                }
            })
            ->when(!empty($request->filterDate) && $endDate == null, function ($query) use ($startDate) {
                $startDate = Carbon::createFromFormat('d/m/Y', trim($startDate));
                $query->whereDate('created_at', $startDate);
            })
            ->when(!empty($request->filterDate) && $endDate != null, function ($query) use ($startDate, $endDate) {
                $startDate = Carbon::createFromFormat('d/m/Y', trim($startDate));
                $endDate = Carbon::createFromFormat('d/m/Y', trim($endDate));
                $query->whereBetween('created_at', [$startDate, $endDate]);
            })
            ->when(!empty($search), function ($query) use ($search) {
                return $query->where(function ($subquery) use ($search) {
                    $subquery->where('utr', 'LIKE', "%$search%")
                        ->orWhere('send_amount', 'LIKE', "%$search%")
                        ->orWhere('final_amount', 'LIKE', "%$search%");
                });
            });
        return DataTables::of($exchanges)
            ->addColumn('checkbox', function ($item) {
                return '<input type="checkbox" id="chk-' . $item->id . '"
                                       class="form-check-input row-tic tic-check" name="check" value="' . $item->id . '"
                                       data-id="' . $item->id . '">';

            })
            ->addColumn('trx_id', function ($item) {
                $routeBadge = '';
                if (filled($item->execution_route)) {
                    $label = ucfirst(str_replace('_', ' ', $item->execution_route));
                    $class = $item->execution_route === 'internal_match'
                        ? 'bg-soft-success text-success'
                        : ($item->execution_route === 'manual_review' ? 'bg-soft-warning text-warning' : 'bg-soft-secondary text-body');

                    $routeBadge = '<div class="mt-1"><span class="badge ' . $class . '">' . e($label) . '</span></div>';
                }

                $matchedLink = '';
                if (optional($item->matchedExchange)->id) {
                    $matchedLink = '<div class="fs-6 text-body mt-1">' . trans('Matched with') . ': <a href="' . route('admin.exchangeView', ['id' => $item->matchedExchange->id]) . '">' . e($item->matchedExchange->utr) . '</a></div>';
                }

                return '<div><strong>' . e($item->utr) . '</strong>' . $routeBadge . $matchedLink . '</div>';
            })
            ->addColumn('send_amount', function ($item) {
                $url = getFile(optional($item->sendCurrency)->driver, optional($item->sendCurrency)->image);
                return '<a class="d-flex align-items-center me-2">
                                <div class="flex-shrink-0">
                                  <div class="avatar avatar-sm avatar-circle">
                                    <img class="avatar-img" src="' . $url . '" alt="Image Description">
                                  </div>
                                </div>
                                <div class="flex-grow-1 ms-3">
                                  <h5 class="text-hover-primary mb-0">' . rtrim(rtrim($item->send_amount, 0), '.') . ' ' . optional($item->sendCurrency)->code . '</h5>
                                  <span class="fs-6 text-body">' . optional($item->sendCurrency)->currency_name . '</span>
                                </div>
                              </a>';

            })
            ->addColumn('receive_amount', function ($item) {
                $url = getFile(optional($item->getCurrency)->driver, optional($item->getCurrency)->image);
                return '<a class="d-flex align-items-center me-2">
                                <div class="flex-shrink-0">
                                  <div class="avatar avatar-sm avatar-circle">
                                    <img class="avatar-img" src="' . $url . '" alt="Image Description">
                                  </div>
                                </div>
                                <div class="flex-grow-1 ms-3">
                                  <h5 class="text-hover-primary mb-0">' . rtrim(rtrim($item->final_amount, 0), '.') . ' ' . optional($item->getCurrency)->code . '</h5>
                                  <span class="fs-6 text-body">' . optional($item->getCurrency)->currency_name . '</span>
                                </div>
                              </a>';

            })
//            ->addColumn('rate', function ($item) {
//                $symbol = $item->rate_type == 'floating' ? '~' : '=';
//                return '1 ' . optional($item->sendCurrency)->code . ' ' . $symbol . ' ' . rtrim(rtrim($item->exchange_rate, 0), '.') . ' ' . optional($item->getCurrency)->code;
//            })
            ->addColumn('status', function ($item) {
                return $item->admin_status;
            })
            ->addColumn('requester', function ($item) {
                $fullname = optional($item->user)->fullname ?? 'Anonymous';
                return '<a class="d-flex align-items-center me-2" href="javascript:void(0)">
                                <div class="flex-shrink-0">
                                  ' . (optional($item->user)->profilePicture() ?? '<span class="badge bg-soft-secondary text-secondary rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 2.25rem; height: 2.25rem;">A</span>') . '
                                </div>
                                <div class="flex-grow-1 ms-3">
                                  <h5 class="text-hover-primary mb-0">' . $fullname . '</h5>
                                  <span class="fs-6 text-body">' . optional($item->user)->username . '</span>
                                </div>
                              </a>';

            })
            ->addColumn('created_at', function ($item) {
                return dateTime($item->created_at, basicControl()->date_time_format);
            })
            ->addColumn('action', function ($item) {
                $delete = route('admin.exchangeDelete', $item->id);
                $view = route('admin.exchangeView') . '?id=' . $item->id;

                $html = '<div class="btn-group" role="group">
                      <a href="' . $view . '" class="btn btn-white btn-sm">
                        <i class="fal fa-eye me-1"></i> ' . trans('View') . '
                      </a>';

                $html .= '<div class="btn-group">
                      <button type="button" class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty" id="userEditDropdown" data-bs-toggle="dropdown" aria-expanded="false"></button>
                      <div class="dropdown-menu dropdown-menu-end mt-1" aria-labelledby="userEditDropdown">
                        <a class="dropdown-item delete_btn" href="javascript:void(0)" data-bs-target="#delete"
                           data-bs-toggle="modal" data-route="' . $delete . '">
                          <i class="fal fa-trash dropdown-item-icon"></i> ' . trans("Delete") . '
                       </a>
                      </div>
                    </div>';

                $html .= '</div>';
                return $html;
            })
            ->rawColumns(['checkbox', 'trx_id', 'send_amount', 'receive_amount', 'status', 'requester', 'created_at', 'action'])
            ->make(true);
    }

    public function exchangeDelete($id)
    {
        $exchange = ExchangeRequest::findOrFail($id);
        $this->reservationService->releaseForExchange($exchange);
        $exchange->delete($id);
        return back()->with('success', 'Exchange Deleted Successfully');
    }

    public function exchangeMultipleDelete(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            ExchangeRequest::whereIn('id', $request->strIds)->get()->map(function ($query) {
                $this->reservationService->releaseForExchange($query);
                $query->delete();
                return $query;
            });
            session()->flash('success', 'Exchange has been deleted successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function exchangeView(Request $request)
    {
        $exchange = ExchangeRequest::with(['payouts', 'matchedExchange.sendCurrency', 'matchedExchange.getCurrency', 'matchedExchange.user'])->findOrFail($request->id);
        if ($exchange->status == 2 && $exchange->rate_type == 'floating') {
            $exchange = $this->rateUpdate($exchange);
        }

        $autoPayoutMethod = null;
        $canAutoPayout = false;

        try {
            $autoPayoutMethod = $this->payoutService->resolvePayoutMethod($exchange);
            $canAutoPayout = $this->payoutService->canAutoPayout($exchange);
        } catch (Throwable $exception) {
            report($exception);
        }

        $latestExchangePayout = $exchange->payouts()->latest()->first();
        $hasPendingTreasuryPayout = $latestExchangePayout && in_array($latestExchangePayout->status, ['queued', 'processing'], true);

        return view('admin.exchange.details', compact('exchange', 'autoPayoutMethod', 'canAutoPayout', 'latestExchangePayout', 'hasPendingTreasuryPayout'));
    }

    public function exchangeConfirmDeposit(Request $request, $utr)
    {
        $exchange = ExchangeRequest::where(['status' => 1, 'utr' => $utr])->latest()->firstOrFail();

        $validated = $request->validate([
            'deposit_amount' => 'nullable|numeric|min:0.00000001',
            'deposit_tx_id' => 'required|string|max:191',
        ]);

        $depositAmount = isset($validated['deposit_amount']) && $validated['deposit_amount'] !== null
            ? (float)$validated['deposit_amount']
            : (float)$exchange->send_amount;

        $this->walletUpgration($exchange, 'exchange', [
            'deposit_amount' => $depositAmount,
            'deposit_tx_id' => $validated['deposit_tx_id'],
        ]);

        return back()->with('success', 'Deposit confirmed and the exchange moved to processing.');
    }

    public function rateUpdate($exchange)
    {
        return app(ExchangeQuoteService::class)->refreshFloatingExchange($exchange);
    }

    public function exchangeRateFloating($utr)
    {

        $exchange = ExchangeRequest::where(['status' => 2, 'rate_type' => 'floating', 'utr' => $utr])->latest()->first();

        if ($exchange) {
            $exchange = $this->rateUpdate($exchange);
            return response()->json([
                'status' => true,
                'sendCurrencyCode' => optional($exchange->sendCurrency)->code,
                'getCurrencyCode' => optional($exchange->getCurrency)->code,
                'get_amount' => rtrim(rtrim($exchange->get_amount, 0), '.'),
                'exchange_rate' => rtrim(rtrim($exchange->exchange_rate, 0), '.'),
                'service_fee' => rtrim(rtrim($exchange->service_fee, 0), '.'),
                'network_fee' => rtrim(rtrim($exchange->network_fee, 0), '.'),
                'final_amount' => rtrim(rtrim($exchange->final_amount, 0), '.'),
            ]);
        }
        return response()->json([
            'status' => false
        ]);
    }

    public function exchangeSend(Request $request, $utr)
    {
        $exchange = ExchangeRequest::where(['status' => 2, 'utr' => $utr])->latest()->firstOrFail();

        $existingQueuedPayout = ExchangePayout::where('exchange_request_id', $exchange->id)
            ->where('type', 'payout')
            ->whereIn('status', ['queued', 'processing'])
            ->latest()
            ->first();

        if ($existingQueuedPayout) {
            return back()->with('warning', 'A treasury payout is already queued for this exchange.');
        }

        if ($request->btnValue == 'automatic' && $this->payoutService->canAutoPayout($exchange)) {
            $data = $this->payoutService->sendExchangePayout($exchange);
            if (!$data) {
                return back()->with('error', 'The automatic cryptocurrency exchange could not be executed.');
            }

            if ($this->payoutService->isAsyncPayout($exchange)) {
                $exchange->hedge_status = 'payout_queued';
                $exchange->save();

                return back()->with('success', 'Treasury payout queued successfully. Mark it as sent after the on-chain transfer is broadcast.');
            }
        }
        $exchange->status = 3;
        $exchange->hedge_status = 'payout_sent';
        $exchange->save();

        $amount = getBaseAmount($exchange->final_amount, optional($exchange->getCurrency)->code, 'crypto');

        BasicService::makeTransaction($amount, 0, '+', 'Crypto Exchange Complete',
            $exchange->id, ExchangeRequest::class, $exchange->user_id, $exchange->final_amount, optional($exchange->getCurrency)->code);

        $this->sendUserNotification($exchange, 'userExchange', 'EXCHANGE_COMPLETE');
        return back()->with('success', 'Exchange Complete Successfully');
    }

    public function exchangeCancel($utr)
    {
        $exchange = ExchangeRequest::where(['status' => 2, 'utr' => $utr])->latest()->firstOrFail();
        $exchange->status = 5;
        $exchange->save();
        $this->reservationService->releaseForExchange($exchange);
        $this->sendUserNotification($exchange, 'userExchange', 'EXCHANGE_CANCEL');
        return back()->with('success', 'Exchange Cancel Successfully');
    }

}
