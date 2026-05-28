<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Services\ExchangePipeline\ExchangeAmlService;
use App\Traits\SendNotification;
use Carbon\Carbon;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class BuyController extends Controller
{
    use SendNotification;

    public function __construct(
        private readonly ExchangeAmlService $amlService,
    ) {
    }

    public function buyList(Request $request)
    {
        if (!in_array($request->type, ['all', 'pending', 'complete', 'cancel'])) {
            return abort(404);
        }
        $data['buyType'] = $request->type;
        $data['buys'] = collect(BuyRequest::selectRaw('COUNT(id) AS totalBuy')
            ->selectRaw('COUNT(CASE WHEN status = 2 THEN id END) AS pendingBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END) / COUNT(id)) * 100 AS pendingBuyPercentage')
            ->selectRaw('COUNT(CASE WHEN status = 3 THEN id END) AS completeBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END) / COUNT(id)) * 100 AS completeBuyPercentage')
            ->selectRaw('COUNT(CASE WHEN status = 5 THEN id END) AS cancelBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END) / COUNT(id)) * 100 AS cancelBuyPercentage')
            ->get()
            ->toArray())->collapse();
        return view('admin.buy.index', $data);
    }

    public function buyListSearch(Request $request)
    {
        $buyType = $request->type;
        $search = $request->search['value'] ?? null;
        $filterName = $request->name;
        $filterStatus = $request->filterStatus;
        $filterDate = explode('-', $request->filterDate);
        $startDate = $filterDate[0];
        $endDate = isset($filterDate[1]) ? trim($filterDate[1]) : null;

        $buys = BuyRequest::with(['sendCurrency', 'getCurrency', 'user:id,firstname,lastname,username,image,image_driver'])
            ->orderBy('id', 'DESC')
            ->when(isset($buyType), function ($query) use ($buyType) {
                if ($buyType == 'pending') {
                    return $query->where('status', 2);
                } elseif ($buyType == 'complete') {
                    return $query->where('status', 3);
                } elseif ($buyType == 'cancel') {
                    return $query->where('status', 5);
                } else {
                    return $query->whereIn('status', ['2', '3', '5']);
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
        return DataTables::of($buys)
            ->addColumn('checkbox', function ($item) {
                return '<input type="checkbox" id="chk-' . $item->id . '"
                                       class="form-check-input row-tic tic-check" name="check" value="' . $item->id . '"
                                       data-id="' . $item->id . '">';

            })
            ->addColumn('trx_id', function ($item) {
                return $item->utr;
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
                                  <h5 class="text-hover-primary mb-0">' . number_format($item->send_amount, 2) . ' ' . optional($item->sendCurrency)->code . '</h5>
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
            ->addColumn('rate', function ($item) {
                $symbol = '~';
                return '1 ' . optional($item->getCurrency)->code . ' ' . $symbol . ' ' . $item->show_exchange_rate . ' ' . optional($item->sendCurrency)->code;
            })
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
                $delete = route('admin.buyDelete', $item->id);
                $view = route('admin.buyView') . '?id=' . $item->id;

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

    public function buyDelete($id)
    {
        BuyRequest::findOrFail($id)->delete($id);
        return back()->with('success', 'Buy Crypto Deleted Successfully');
    }

    public function buyMultipleDelete(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            BuyRequest::whereIn('id', $request->strIds)->get()->map(function ($query) {
                $query->delete();
                return $query;
            });
            session()->flash('success', 'Buy Crypto has been deleted successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function buyView(Request $request)
    {
        $buy = BuyRequest::findOrFail($request->id);
        $walletDecision = $this->amlService->latestWalletDecision($buy, $buy->destination_wallet);
        $walletDecisionState = $this->amlService->walletDecisionState($walletDecision);

        return view('admin.buy.details', compact('buy', 'walletDecision', 'walletDecisionState'));
    }

    public function approveWalletAml($id)
    {
        $buy = BuyRequest::findOrFail($id);
        $this->amlService->approveWalletAddress($buy, (string) $buy->destination_wallet, (string) optional($buy->getCurrency)->code);

        return back()->with('success', 'Destination wallet approved by admin review.');
    }

    public function rejectWalletAml($id)
    {
        $buy = BuyRequest::findOrFail($id);
        $this->amlService->rejectWalletAddress($buy, (string) $buy->destination_wallet, (string) optional($buy->getCurrency)->code);

        return back()->with('success', 'Destination wallet blocked by admin review.');
    }

    public function buySend(Request $request, $utr)
    {
        $buy = BuyRequest::where(['status' => 2, 'utr' => $utr])->latest()->firstOrFail();

        $walletScreening = app(\App\Services\ExchangePipeline\ExchangeAmlService::class)->screenWalletAddress(
            (string) $buy->destination_wallet,
            (string) optional($buy->getCurrency)->code,
            [
                'screenable' => $buy,
                'direction' => 'destination',
                'amount' => (float) $buy->final_amount,
            ]
        );

        if (($walletScreening['status'] ?? 'pending') !== 'approved') {
            return back()->with('error', $walletScreening['notes'] ?? 'Destination wallet failed AML screening.');
        }

        if ($request->btnValue == 'automatic' && optional($buy->cryptoMethod)->is_automatic) {
            $methodObj = 'Facades\\App\\Services\\CryptoMethod\\' . optional($buy->cryptoMethod)->code . '\\Service';
            $data = $methodObj::withdrawCrypto($buy, $buy->final_amount, optional($buy->getCurrency)->code, $buy->destination_wallet, 'exchange');
            if (!$data) {
                return back()->with('error', 'The automatic cryptocurrency send could not be executed.');
            }
        }
        $buy->status = 3;
        $buy->save();

        $amount = getBaseAmount($buy->final_amount, optional($buy->getCurrency)->code, 'crypto');
        BasicService::makeTransaction($amount, 0, '+', 'Crypto Buy Complete',
            $buy->id, BuyRequest::class, $buy->user_id, $buy->final_amount, optional($buy->getCurrency)->code);

        $this->sendUserNotification($buy, 'userBuy', 'BUY_COMPLETE');
        return back()->with('success', 'Exchange Complete Successfully');
    }

    public function buyCancel($utr)
    {
        $buy = BuyRequest::where(['status' => 2, 'utr' => $utr])->latest()->firstOrFail();
        $buy->status = 5;
        $buy->save();
        $this->sendUserNotification($buy, 'userBuy', 'BUY_CANCEL');
        return back()->with('success', 'Exchange Cancel Successfully');
    }

}
