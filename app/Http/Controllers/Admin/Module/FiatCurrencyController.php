<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Http\Requests\FiatStoreRequest;
use App\Models\BasicControl;
use App\Models\CryptoCurrency;
use App\Models\FiatCurrency;
use App\Traits\CurrencyRateUpdate;
use App\Traits\Upload;
use Carbon\Carbon;
use Facades\App\Services\BasicCurl;
use Illuminate\Http\Request;
use Yajra\DataTables\Facades\DataTables;

class FiatCurrencyController extends Controller
{
    use Upload, CurrencyRateUpdate;

    public function fiatList()
    {
        $data['currency'] = collect(FiatCurrency::selectRaw('COUNT(id) AS totalCurrency')
            ->selectRaw('COUNT(CASE WHEN status = 1 THEN id END) AS activeCurrency')
            ->selectRaw('(COUNT(CASE WHEN status = 1 THEN id END) / COUNT(id)) * 100 AS activeCurrencyPercentage')
            ->selectRaw('COUNT(CASE WHEN status = 0 THEN id END) AS inActiveCurrency')
            ->selectRaw('(COUNT(CASE WHEN status = 0 THEN id END) / COUNT(id)) * 100 AS inActiveCurrencyPercentage')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN id END) AS todayCurrency')
            ->selectRaw('(COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN id END) / COUNT(id)) * 100 AS todayCurrencyPercentage')
            ->selectRaw('COUNT(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) THEN id END) AS thisMonthCurrency')
            ->selectRaw('(COUNT(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) THEN id END) / COUNT(id)) * 100 AS thisMonthCurrencyPercentage')
            ->get()
            ->toArray())->collapse();
        return view('admin.currency.fiat.index', $data);
    }

    public function fiatSort(Request $request)
    {
        $sortItems = $request->sort;
        foreach ($sortItems as $key => $value) {
            FiatCurrency::where('code', $value)->update(['sort_by' => $key + 1]);
        }
    }

    public function fiatListSearch(Request $request)
    {
        $search = $request->search['value'] ?? null;
        $filterName = $request->name;
        $filterStatus = $request->filterStatus;
        $filterDate = explode('-', $request->filterDate);
        $startDate = $filterDate[0];
        $endDate = isset($filterDate[1]) ? trim($filterDate[1]) : null;
        $referenceUsdtCurrency = CryptoCurrency::where('status', 1)
            ->orderBy('sort_by', 'ASC')
            ->get()
            ->first(fn($currency) => strtoupper((string) $currency->normalized_code) === 'USDT');
        $referenceUsdtUsdRate = optional($referenceUsdtCurrency)->usd_rate ?: 1;

        $currencies = FiatCurrency::orderBy('sort_by', 'ASC')
            ->when(isset($filterName), function ($query) use ($filterName) {
                return $query->where('name', 'LIKE', '%' . $filterName . '%');
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
                    $subquery->where('name', 'LIKE', "%$search%")
                        ->orWhere('code', 'LIKE', "%$search%")
                        ->orWhere('symbol', 'LIKE', "%$search%")
                        ->orWhere('rate', 'LIKE', "%$search%")
                        ->orWhere('usd_rate', 'LIKE', "%$search%");
                });
            });
        return DataTables::of($currencies)
            ->addColumn('checkbox', function ($item) {
                return '<input type="checkbox" id="chk-' . $item->id . '"
                                       class="form-check-input row-tic tic-check" name="check" value="' . $item->id . '"
                                       data-id="' . $item->id . '">';

            })
            ->addColumn('name', function ($item) {
                $url = getFile($item->driver, $item->image);
                return '<a class="d-flex align-items-center me-2">
                                <div class="list-group-item">
                                  <i class="sortablejs-custom-handle bi-grip-horizontal list-group-icon"></i>
                                </div>
                                <div class="flex-shrink-0">
                                  <div class="avatar avatar-sm avatar-circle">
                                    <img class="avatar-img" src="' . $url . '" alt="Image Description">
                                  </div>
                                </div>
                                <div class="flex-grow-1 ms-3">
                                  <h5 class="text-hover-primary mb-0">' . $item->name . '</h5>
                                  <span class="fs-6 text-body">' . $item->symbol . ' - ' . $item->code . '</span>
                                </div>
                              </a>';

            })
            ->addColumn('rate', function ($item) use ($referenceUsdtCurrency, $referenceUsdtUsdRate) {
                $displayRate = $this->formatDisplayRate($item, $referenceUsdtCurrency, $referenceUsdtUsdRate);

                return '<div class="flex-grow-1 ms-3">
                                  <h5 class="text-hover-primary mb-0">1 ' . $displayRate['left_currency'] . ' = ' . $displayRate['value'] . ' ' . $displayRate['right_currency'] . '</h5>
                                  <span class="fs-6 text-body">1 USD = ' . $displayRate['usd_value'] . ' ' . $item->code . '</span>
                                </div>';
            })
            ->addColumn('rate_indicator', function ($item) use ($referenceUsdtCurrency) {
                [$effectiveSyncAt, $effectiveSyncError] = $this->resolveSyncMeta($item, $referenceUsdtCurrency);

                if ($effectiveSyncAt && blank($effectiveSyncError)) {
                    return '<div class="d-flex flex-column gap-1">
                                <span class="badge bg-soft-success text-success"><span class="legend-indicator bg-success"></span>' . trans('Live') . '</span>
                                <small class="text-body">' . dateTime($effectiveSyncAt, basicControl()->date_time_format) . '</small>
                            </div>';
                }

                if ($effectiveSyncAt && filled($effectiveSyncError)) {
                    return '<div class="d-flex flex-column gap-1">
                                <span class="badge bg-soft-warning text-warning"><span class="legend-indicator bg-warning"></span>' . trans('Fallback') . '</span>
                                <small class="text-body">' . dateTime($effectiveSyncAt, basicControl()->date_time_format) . '</small>
                            </div>';
                }

                if ($this->hasConfiguredFallbackRate($item)) {
                    return '<div class="d-flex flex-column gap-1">
                                <span class="badge bg-soft-secondary text-body"><span class="legend-indicator bg-secondary"></span>' . trans('Fallback Only') . '</span>
                                <small class="text-body">' . trans('Configured manually or before live sync was enabled') . '</small>
                            </div>';
                }

                return '<div class="d-flex flex-column gap-1">
                            <span class="badge bg-soft-danger text-danger"><span class="legend-indicator bg-danger"></span>' . trans('No Sync') . '</span>
                            <small class="text-body">' . trans('Waiting for first sync') . '</small>
                        </div>';
            })
            ->addColumn('processing_fee', function ($item) {
                if ($item->service_fee_type == 'flat') {
                    return $item->code . ' ' . getAmount($item->processing_fee);
                } else {
                    return $item->code . ' ' . getAmount($item->processing_fee) . '% ';
                }
            })
            ->addColumn('min_max_send', function ($item) {
                return number_format($item->min_send) . ' ' . $item->code . ' - ' . number_format($item->max_send) . ' ' . $item->code;
            })
            ->addColumn('status', function ($item) {
                if ($item->status == 1) {
                    return '<span class="badge bg-soft-success text-success">
                    <span class="legend-indicator bg-success"></span>' . trans('Active') . '
                  </span>';

                } else {
                    return '<span class="badge bg-soft-danger text-danger">
                    <span class="legend-indicator bg-danger"></span>' . trans('In Active') . '
                  </span>';
                }
            })
            ->addColumn('created_at', function ($item) {
                return dateTime($item->created_at, basicControl()->date_time_format);
            })
            ->addColumn('action', function ($item) {
                if ($item->status) {
                    $statusBtn = "In-Active";
                    $statusChange = route('admin.fiatStatusChange') . '?id=' . $item->id . '&status=in-active';
                } else {
                    $statusBtn = "Active";
                    $statusChange = route('admin.fiatStatusChange') . '?id=' . $item->id . '&status=active';
                }
                $delete = route('admin.fiatDelete', $item->id);
                $edit = route('admin.fiatEdit') . '?id=' . $item->id;

                $html = '<div class="btn-group sortable" role="group" data-code ="' . $item->code . '">
                      <a href="' . $edit . '" class="btn btn-white btn-icon btn-sm" title="' . trans("Edit") . '">
                        <i class="fal fa-edit"></i>
                      </a>';

                $html .= '<div class="btn-group">
                      <button type="button" class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty" id="userEditDropdown" data-bs-toggle="dropdown" aria-expanded="false"></button>
                      <div class="dropdown-menu dropdown-menu-end mt-1" aria-labelledby="userEditDropdown">
                        <a href="' . $edit . '" class="dropdown-item">
                            <i class="fal fa-edit dropdown-item-icon"></i> ' . trans("Edit") . '
                        </a>
                        <a href="' . $statusChange . '" class="dropdown-item edit_user_btn">
                            <i class="fal fa-badge dropdown-item-icon"></i> ' . trans($statusBtn) . '
                        </a>
                        <a class="dropdown-item delete_btn" href="javascript:void(0)" data-bs-target="#delete"
                           data-bs-toggle="modal" data-route="' . $delete . '">
                          <i class="fal fa-trash dropdown-item-icon"></i> ' . trans("Delete") . '
                       </a>
                      </div>
                    </div>';

                $html .= '</div>';
                return $html;
            })
            ->rawColumns(['checkbox', 'name', 'rate', 'rate_indicator', 'processing_fee', 'min_max_send', 'status', 'created_at', 'action'])
            ->make(true);
    }

    public function fiatCreate(FiatStoreRequest $request)
    {
        if ($request->method() == 'GET') {
            return view('admin.currency.fiat.create');
        } elseif ($request->method() == 'POST') {
            $currency = new FiatCurrency();
            $fillData = $request->only($currency->getFillable());
            $fillData['usd_rate'] = getUSDRate($fillData['rate']);
            if ($request->hasFile('image')) {
                try {
                    $image = $this->fileUpload($request->image, config('filelocation.fiatCurrency.path'), null, config('filelocation.fiatCurrency.size'), 'webp', 60);
                    if ($image) {
                        $fillData['image'] = $image['path'];
                        $fillData['driver'] = $image['driver'];
                    }
                } catch (\Exception $e) {
                    return back()->withInput()->with('error', 'Image could not be uploaded');
                }
            }
            $currency->fill($fillData)->save();
            return back()->with('success', 'Fiat Currency Created Successfully');
        }
    }

    public function fiatEdit(FiatStoreRequest $request)
    {
        $currency = FiatCurrency::findOrFail($request->id);
        if ($request->method() == 'GET') {
            return view('admin.currency.fiat.edit', compact('currency'));
        } elseif ($request->method() == 'POST') {
            $fillData = $request->only($currency->getFillable());
            $fillData['usd_rate'] = getUSDRate($fillData['rate']);
            if ($request->hasFile('image')) {
                try {
                    $image = $this->fileUpload($request->image, config('filelocation.fiatCurrency.path'), null, config('filelocation.fiatCurrency.size'), 'webp', 60);
                    if ($image) {
                        $fillData['image'] = $image['path'];
                        $fillData['driver'] = $image['driver'];
                    }
                } catch (\Exception $e) {
                    return back()->withInput()->with('error', 'Image could not be uploaded');
                }
            }
            $currency->fill($fillData)->save();
            return back()->with('success', 'Fiat Currency Updated Successfully');
        }
    }

    public function fiatStatusChange(Request $request)
    {
        $currency = FiatCurrency::findOrFail($request->id);
        if ($request->status == 'active') {
            $currency->status = 1;
        } else {
            $currency->status = 0;
        }
        $currency->save();
        return back()->with('success', 'Status ' . ucfirst($request->status) . ' Successfully');
    }

    public function fiatDelete($id)
    {
        try {
            $currency = FiatCurrency::findOrFail($id)->delete();
            $this->fileDelete($currency->driver, $currency->image);
            return back()->with('success', 'Deleted Successfully');
        } catch (\Exception $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    public function fiatMultipleDelete(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            FiatCurrency::whereIn('id', $request->strIds)->get()->map(function ($query) {
                $this->fileDelete($query->driver, $query->image);
                $query->delete();
                return $query;
            });
            session()->flash('success', 'Fiat Currency has been deleted successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function fiatMultipleStatusChange(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            FiatCurrency::whereIn('id', $request->strIds)->get()->map(function ($query) {
                if ($query->status) {
                    $query->status = 0;
                } else {
                    $query->status = 1;
                }
                $query->save();
                return $query;
            });
            session()->flash('success', 'Status Change successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function fiatMultipleRateUpdate(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            $currencies = FiatCurrency::select(['id', 'code', 'rate', 'usd_rate'])->whereIn('id', $request->strIds)->get();
            $currencyCodes = $currencies->pluck('code')
                ->push('USD')
                ->unique()
                ->implode(',');

            $response = $this->fiatRateUpdate(basicControl()->base_currency, $currencyCodes);

            if ($response['status']) {
                $quotes = $this->normalizeQuotes($response['res']);

                $baseExchangeRate = $this->resolveBaseExchangeRate($quotes);
                if ($baseExchangeRate !== null) {
                    optional(BasicControl::first())->update([
                        'exchange_rate' => $baseExchangeRate,
                    ]);
                }

                foreach ($quotes as $key => $apiRes) {
                    $apiCode = substr($key, -3);
                    $apiRate = 1 / $apiRes;
                    $matchingCurrencies = $currencies->where('code', $apiCode);

                    if ($matchingCurrencies->isNotEmpty()) {
                        $matchingCurrencies->each(function ($currency) use ($apiRate) {
                            $currency->update([
                                'rate' => $apiRate,
                                'usd_rate' => getUSDRate($apiRate),
                                'last_rate_sync_at' => now(),
                                'last_rate_sync_error' => null,
                            ]);
                        });
                    }
                }
            } else {
                FiatCurrency::query()
                    ->whereIn('id', $request->strIds)
                    ->update([
                        'last_rate_sync_error' => $response['res'],
                    ]);
                session()->flash('error', $response['res']);
            }

            session()->flash('success', 'Rate Updated successfully');
            return response()->json(['success' => 1]);
        }
    }

    protected function resolveBaseExchangeRate($quotes): ?float
    {
        $quotes = $this->normalizeQuotes($quotes);
        $baseCurrency = strtoupper((string) basicControl()->base_currency);

        if ($baseCurrency === 'USD') {
            return 1.0;
        }

        $quoteKey = $baseCurrency . 'USD';
        $quote = (float) ($quotes[$quoteKey] ?? 0);

        if ($quote <= 0) {
            return null;
        }

        return 1 / $quote;
    }

    protected function normalizeQuotes($quotes): array
    {
        if (is_array($quotes)) {
            return $quotes;
        }

        if ($quotes instanceof \stdClass) {
            return (array) $quotes;
        }

        return [];
    }

    protected function hasConfiguredFallbackRate(FiatCurrency $currency): bool
    {
        return (float) $currency->rate > 0 || (float) $currency->usd_rate > 0;
    }

    protected function formatDisplayRate(FiatCurrency $currency, ?CryptoCurrency $referenceUsdtCurrency, float $referenceUsdtUsdRate): array
    {
        if ($this->shouldMirrorBaseCurrencyFromUsdt($currency, $referenceUsdtCurrency)) {
            $baseValue = (float) $referenceUsdtCurrency->rate;

            return [
                'left_currency' => 'USDT',
                'right_currency' => $currency->code,
                'value' => rtrim(rtrim(number_format($baseValue, 8, '.', ''), '0'), '.'),
                'usd_value' => rtrim(rtrim(number_format($baseValue, 8, '.', ''), '0'), '.'),
            ];
        }

        $usdValue = (float) $currency->usd_rate > 0
            ? (1 / (float) $currency->usd_rate)
            : 0;

        $usdtValue = $referenceUsdtUsdRate > 0
            ? ($usdValue * $referenceUsdtUsdRate)
            : $usdValue;

        return [
            'left_currency' => 'USDT',
            'right_currency' => $currency->code,
            'value' => rtrim(rtrim(number_format($usdtValue, 8, '.', ''), '0'), '.'),
            'usd_value' => rtrim(rtrim(number_format($usdValue, 8, '.', ''), '0'), '.'),
        ];
    }

    protected function resolveSyncMeta(FiatCurrency $currency, ?CryptoCurrency $referenceUsdtCurrency): array
    {
        if ($this->shouldMirrorBaseCurrencyFromUsdt($currency, $referenceUsdtCurrency)) {
            return [
                $referenceUsdtCurrency->last_rate_sync_at,
                $referenceUsdtCurrency->last_rate_sync_error,
            ];
        }

        return [
            $currency->last_rate_sync_at,
            $currency->last_rate_sync_error,
        ];
    }

    protected function shouldMirrorBaseCurrencyFromUsdt(FiatCurrency $currency, ?CryptoCurrency $referenceUsdtCurrency): bool
    {
        return $referenceUsdtCurrency !== null
            && strtoupper((string) $currency->code) === strtoupper((string) basicControl()->base_currency);
    }
}
