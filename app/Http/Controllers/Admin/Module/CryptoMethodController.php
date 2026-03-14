<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Http\Requests\CryptoMethodRequest;
use App\Models\CryptoCurrency;
use App\Models\CryptoMethod;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Yajra\DataTables\Facades\DataTables;

class CryptoMethodController extends Controller
{
    public function cryptoMethodList()
    {
        return view('admin.crypto-method.index');
    }

    public function cryptoMethodSearch(Request $request)
    {
        $search = $request->search['value'] ?? null;
        $methods = CryptoMethod::
        when(!empty($search), function ($query) use ($search) {
            return $query->where(function ($subquery) use ($search) {
                $subquery->where('name', 'LIKE', "%$search%");
            });
        });
        return DataTables::of($methods)
            ->addColumn('name', function ($item) {
                return $item->name;
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
            ->addColumn('type', function ($item) {
                if ($item->is_automatic == 1) {
                    return '<span class="badge bg-soft-success text-primary">
                    <span class="legend-indicator bg-primary"></span>' . trans('Automatic') . '
                  </span>';

                } else {
                    return '<span class="badge bg-soft-danger text-dark">
                    <span class="legend-indicator bg-dark"></span>' . trans('Manual') . '
                  </span>';
                }
            })
            ->addColumn('action', function ($item) {
                if ($item->status) {
                    $statusBtn = "In-Active";
                } else {
                    $statusBtn = "Active";
                }
                $statusChange = route('admin.cryptoMethodStatusChange') . '?id=' . $item->id . '&status=active';
                if ($item->is_automatic) {
                    $btn = "Edit";
                    $btnHref = route('admin.cryptoMethodEdit') . '?id=' . $item->id;
                    $hrefClass = "fal fa-edit";
                } else {
                    $btn = "Set Crypto Addresses";
                    $btnHref = route('admin.cryptoMethodSetAddress') . '?code=manual';
                    $hrefClass = "fas fa-tools";
                }

                $html = '<div class="btn-group" role="group">
                      <a href="' . $btnHref . '" class="btn btn-white btn-sm edit_user_btn">
                        <i class="' . $hrefClass . ' me-1"></i> ' . trans($btn) . '
                      </a>';

                $html .= '<div class="btn-group">
                      <button type="button" class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty" id="userEditDropdown" data-bs-toggle="dropdown" aria-expanded="false"></button>
                      <div class="dropdown-menu dropdown-menu-end mt-1" aria-labelledby="userEditDropdown">
                          <a class="dropdown-item edit_user_btn" href="' . $statusChange . '">
                              <i class="fal fa-badge me-1"></i> ' . trans($statusBtn)  . '
                          </a>
                      </div>
                    </div>';

                $html .= '</div>';
                return $html;
            })
            ->rawColumns(['name', 'status', 'type', 'action'])
            ->make(true);
    }

    public function cryptoMethodEdit(CryptoMethodRequest $request)
    {
        $method = CryptoMethod::findOrFail($request->id);
        if ($request->method() == 'GET') {
            return view('admin.crypto-method.edit', compact('method'));
        } elseif ($request->method() == 'POST') {
            $fillData = $request->only($method->getFillable());
            $rules = [];
            $parameters = [];
            foreach ($request->except('_token', '_method', 'image') as $k => $v) {
                foreach ($method->parameters as $key => $cus) {
                    if ($k != $key) {
                        continue;
                    } else {
                        $rules[$key] = $key === 'currency_map' ? 'required|max:5000' : 'required|max:255';
                        $parameters[$key] = $v;
                    }
                }
            }
            $validator = Validator::make($request->all(), $rules);
            if ($validator->fails()) {
                return back()->withInput()->withErrors($validator);
            }
            $fillData['parameters'] = $parameters;
            $method->fill($fillData)->save();
            return back()->with('success', 'Crypto Method Updated Successfully');
        }
    }

    public function cryptoMethodStatusChange(Request $request)
    {
        $method = CryptoMethod::findOrFail($request->id);
        CryptoMethod::get()->each(function ($query) {
            $query->update(['status' => 0]);
        });
        $method->status = 1;
        $method->save();
        return back()->with('success', $method->name . ' Method Activated Successfully');
    }

    public function cryptoMethodSetAddress(Request $request)
    {
        $method = CryptoMethod::where('code', 'manual')->firstOrFail();
        $cryptoCurrencies = CryptoCurrency::orderBy('sort_by', 'ASC')->get(['id', 'name', 'code', 'status', 'symbol','sort_by']);
        $inputFieldSpecification = [];
        if ($request->method() == 'GET') {
            return view('admin.crypto-method.set-address', compact('method', 'cryptoCurrencies'));
        } elseif ($request->method() == 'POST') {
            $rules = [];
            $parameters = [];
            foreach ($request->except('_token', '_method', 'image') as $k => $v) {
                foreach ($cryptoCurrencies as $currency) {
                    if ($k != $currency->code) {
                        continue;
                    } else {
                        if ($currency->status) {
                            $rules[$currency->code] = 'required|max:255';
                            $inputFieldSpecification[$currency->code . '.' . 'required'] = "The $currency->code field is required.";
                        }
                        $parameters[$currency->code] = $v;
                    }
                }
            }
            $validator = Validator::make($request->all(), $rules, $inputFieldSpecification);
            if ($validator->fails()) {
                return back()->withInput()->withErrors($validator);
            }
            $method->parameters = $parameters;
            $method->save();
            return back()->with('success', 'Crypto Address Set Successfully');
        }
    }
}
