<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Models\SellRequest;
use App\Traits\SendNotification;
use Carbon\Carbon;
use Facades\App\Services\BasicService;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class SellController extends Controller
{
    use SendNotification;

    public function sellList(Request $request)
    {
        if (!in_array($request->type, ['all', 'pending', 'complete', 'cancel'])) {
             abort(404);
        }
        $data['sellType'] = $request->type;
        $data['sells'] = collect(SellRequest::selectRaw('COUNT(id) AS totalSell')
            ->selectRaw('COUNT(CASE WHEN status = 2 THEN id END) AS pendingSell')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END) / COUNT(id)) * 100 AS pendingSellPercentage')
            ->selectRaw('COUNT(CASE WHEN status = 3 THEN id END) AS completeSell')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END) / COUNT(id)) * 100 AS completeSellPercentage')
            ->selectRaw('COUNT(CASE WHEN status = 5 THEN id END) AS cancelSell')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END) / COUNT(id)) * 100 AS cancelSellPercentage')
            ->get()
            ->toArray())->collapse();
        return view('admin.sell.index', $data);
    }

    public function sellListSearch(Request $request)
    {
        $sellType = $request->type;
        $search = $request->search['value'] ?? null;
        $filterName = $request->name;
        $filterStatus = $request->filterStatus;
        $filterDate = explode('-', $request->filterDate);
        $startDate = $filterDate[0];
        $endDate = isset($filterDate[1]) ? trim($filterDate[1]) : null;

        $sells = SellRequest::with(['sendCurrency', 'getCurrency', 'user:id,firstname,lastname,username,image,image_driver'])
            ->orderBy('id', 'DESC')
            ->when(isset($sellType), function ($query) use ($sellType) {
                if ($sellType == 'pending') {
                    return $query->where('status', 2);
                } elseif ($sellType == 'complete') {
                    return $query->where('status', 3);
                } elseif ($sellType == 'cancel') {
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
        return DataTables::of($sells)
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
                                  <h5 class="text-hover-primary mb-0">' . number_format($item->final_amount, 2) . ' ' . optional($item->getCurrency)->code . '</h5>
                                  <span class="fs-6 text-body">' . optional($item->getCurrency)->currency_name . '</span>
                                </div>
                              </a>';

            })
            ->addColumn('rate', function ($item) {
                $symbol = '~';
                return '1 ' . optional($item->sendCurrency)->code . ' ' . $symbol . ' ' . number_format($item->exchange_rate, 2) . ' ' . optional($item->getCurrency)->code;
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
                $delete = route('admin.sellDelete', $item->id);
                $view = route('admin.sellView') . '?id=' . $item->id;

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

    public function sellDelete($id)
    {
        SellRequest::findOrFail($id)->delete($id);
        return back()->with('success', 'Sell Crypto Deleted Successfully');
    }

    public function sellMultipleDelete(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            SellRequest::whereIn('id', $request->strIds)->get()->map(function ($query) {
                $query->delete();
                return $query;
            });
            session()->flash('success', 'Sell Crypto has been deleted successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function sellView(Request $request)
    {
        $sell = SellRequest::findOrFail($request->id);
        $hasCustodialTracking = \App\Models\CustodialDeposit::where('sell_request_id', $sell->id)->exists();

        return view('admin.sell.details', compact('sell', 'hasCustodialTracking'));
    }

    public function sellConfirmDeposit($utr)
    {
        $sell = SellRequest::where(['status' => 1, 'utr' => $utr])->latest()->firstOrFail();
        $sell->status = 2;
        $sell->save();

        try {
            app(\App\Services\Sell\TraderAssignmentService::class)->assignForSell($sell->fresh(['fiatSendGateway']));
        } catch (\Throwable $exception) {
            report($exception);
        }

        $amount = getBaseAmount($sell->send_amount, optional($sell->sendCurrency)->code, 'crypto');
        $charge = getBaseAmount($sell->processing_fee, optional($sell->getCurrency)->code, 'fiat');

        BasicService::makeTransaction($amount, $charge, '-', 'Crypto Deposit For Sell',
            $sell->id, SellRequest::class, $sell->user_id, $sell->send_amount, optional($sell->sendCurrency)->code);

        return back()->with('success', 'Sell deposit confirmed successfully.');
    }

    public function sellSend($utr)
    {
        $sell = SellRequest::where(['status' => 2, 'utr' => $utr])->latest()->firstOrFail();
        $sell->status = 3;
        $sell->save();

        $amount = getBaseAmount($sell->final_amount, optional($sell->getCurrency)->code, 'fiat');
        BasicService::makeTransaction($amount, 0, '+', 'Crypto Sell Complete',
            $sell->id, SellRequest::class, $sell->user_id, $sell->final_amount, optional($sell->getCurrency)->code);

        $this->sendUserNotification($sell, 'userSell', 'SELL_COMPLETE');
        return back()->with('success', 'Sell Complete Successfully');
    }

    public function sellCancel($utr)
    {
        $sell = SellRequest::where('utr', $utr)
            ->whereIn('status', [1, 2])
            ->latest()
            ->firstOrFail();
        $sell->status = 5;
        $sell->save();
        $this->sendUserNotification($sell, 'userSell', 'SELL_CANCEL');
        return back()->with('success', 'Sell Cancel Successfully');
    }

}
