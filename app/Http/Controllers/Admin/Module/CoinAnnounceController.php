<?php

namespace App\Http\Controllers\Admin\Module;

use App\Http\Controllers\Controller;
use App\Http\Requests\CoinAnnounceStoreRequest;
use App\Models\CoinAnnounce;
use App\Traits\Upload;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Yajra\DataTables\Facades\DataTables;

class CoinAnnounceController extends Controller
{
    use Upload;

    public function coinAnnounceList()
    {
        $data['announces'] = collect(CoinAnnounce::selectRaw('COUNT(id) AS totalAnnounce')
            ->selectRaw('COUNT(CASE WHEN status = 1 THEN id END) AS activeAnnounce')
            ->selectRaw('(COUNT(CASE WHEN status = 1 THEN id END) / COUNT(id)) * 100 AS activeAnnouncePercentage')
            ->selectRaw('COUNT(CASE WHEN status = 0 THEN id END) AS inActiveAnnounce')
            ->selectRaw('(COUNT(CASE WHEN status = 0 THEN id END) / COUNT(id)) * 100 AS inActiveAnnouncePercentage')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN id END) AS todayAnnounce')
            ->selectRaw('(COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN id END) / COUNT(id)) * 100 AS todayAnnouncePercentage')
            ->selectRaw('COUNT(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) THEN id END) AS thisMonthAnnounce')
            ->selectRaw('(COUNT(CASE WHEN MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE()) THEN id END) / COUNT(id)) * 100 AS thisMonthAnnouncePercentage')
            ->get()
            ->toArray())->collapse();
        return view('admin.coin-announce.index', $data);
    }

    public function coinAnnounceSearch(Request $request)
    {
        $search = $request->search['value'] ?? null;
        $announces = CoinAnnounce::orderBy('id', 'DESC')
            ->when(!empty($search), function ($query) use ($search) {
                return $query->where(function ($subquery) use ($search) {
                    $subquery->where('heading', 'LIKE', "%$search%")
                        ->orWhere('description', 'LIKE', "%$search%");
                });
            });
        return DataTables::of($announces)
            ->addColumn('checkbox', function ($item) {
                return '<input type="checkbox" id="chk-' . $item->id . '"
                                       class="form-check-input row-tic tic-check" name="check" value="' . $item->id . '"
                                       data-id="' . $item->id . '">';

            })
            ->addColumn('heading', function ($item) {
                return Str::limit($item->heading, 50);
            })
            ->addColumn('description', function ($item) {
                return Str::limit($item->description, 60);
            })
            ->addColumn('image', function ($item) {
                $url = getFile($item->driver, $item->image);
                return '<a class="d-flex align-items-center me-2" href="javascript:void(0)">
                                <div class="flex-shrink-0">
                                  <div class="avatar avatar-sm avatar-circle">
                                    <img class="avatar-img" src="' . $url . '" alt="Image Description">
                                  </div>
                                </div>
                              </a>';

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
                    $statusChange = route('admin.coinAnnounceStatusChange') . '?id=' . $item->id . '&status=in-active';
                } else {
                    $statusBtn = "Active";
                    $statusChange = route('admin.coinAnnounceStatusChange') . '?id=' . $item->id . '&status=active';
                }
                $delete = route('admin.coinAnnounceDelete', $item->id);
                $edit = route('admin.coinAnnounceEdit') . '?id=' . $item->id;

                $html = '<div class="btn-group" role="group">
                      <a href="' . $edit . '" class="btn btn-white btn-sm edit_user_btn">
                        <i class="fal fa-edit me-1"></i> ' . trans('Edit') . '
                      </a>';

                $html .= '<div class="btn-group">
                      <button type="button" class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty" id="userEditDropdown" data-bs-toggle="dropdown" aria-expanded="false"></button>
                      <div class="dropdown-menu dropdown-menu-end mt-1" aria-labelledby="userEditDropdown">
                          <a class="dropdown-item" href="' . $statusChange . '">
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
            ->rawColumns(['checkbox', 'heading', 'description', 'image', 'status', 'created_at', 'action'])
            ->make(true);
    }

    public function coinAnnounceCreate(CoinAnnounceStoreRequest $request)
    {
        if ($request->method() == 'GET') {
            return view('admin.coin-announce.create');
        } elseif ($request->method() == 'POST') {
            $announce = new CoinAnnounce();
            $fillData = $request->only($announce->getFillable());
            if ($request->hasFile('image')) {
                try {
                    $image = $this->fileUpload($request->image, config('filelocation.coinAnnounce.path'), null, config('filelocation.coinAnnounce.size'), 'webp', 60);
                    if ($image) {
                        $fillData['image'] = $image['path'];
                        $fillData['driver'] = $image['driver'];
                    }
                } catch (\Exception $e) {
                    return back()->withInput()->with('error', 'Image could not be uploaded');
                }
            }
            $announce->fill($fillData)->save();
            return back()->with('success', 'Coin Announce Created Successfully');
        }
    }

    public function coinAnnounceEdit(CoinAnnounceStoreRequest $request)
    {
        $announce = CoinAnnounce::findOrFail($request->id);
        if ($request->method() == 'GET') {
            return view('admin.coin-announce.edit', compact('announce'));
        } elseif ($request->method() == 'POST') {
            $fillData = $request->only($announce->getFillable());
            if ($request->hasFile('image')) {
                try {
                    $image = $this->fileUpload($request->image, config('filelocation.coinAnnounce.path'), null, config('filelocation.coinAnnounce.size'), 'webp', 60);
                    if ($image) {
                        $fillData['image'] = $image['path'];
                        $fillData['driver'] = $image['driver'];
                    }
                } catch (\Exception $e) {
                    return back()->withInput()->with('error', 'Image could not be uploaded');
                }
            }
            $announce->fill($fillData)->save();
            return back()->with('success', 'Coin Announce Updated Successfully');
        }
    }

    public function coinAnnounceStatusChange(Request $request)
    {
        $announce = CoinAnnounce::findOrFail($request->id);
        if ($request->status == 'active') {
            $announce->status = 1;
        } else {
            $announce->status = 0;
        }
        $announce->save();
        return back()->with('success', 'Status ' . ucfirst($request->status) . ' Successfully');
    }

    public function coinAnnounceDelete($id)
    {
        try {
            $announce = CoinAnnounce::findOrFail($id)->delete();
            $this->fileDelete($announce->driver, $announce->image);
            return back()->with('success', 'Deleted Successfully');
        } catch (\Exception $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    public function coinAnnounceMultipleDelete(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            CoinAnnounce::whereIn('id', $request->strIds)->get()->map(function ($query) {
                $this->fileDelete($query->driver, $query->image);
                $query->delete();
                return $query;
            });
            session()->flash('success', 'Coin Announce has been deleted successfully');
            return response()->json(['success' => 1]);
        }
    }

    public function coinAnnounceMultipleStatusChange(Request $request)
    {
        if ($request->strIds == null) {
            session()->flash('error', 'You do not select row.');
            return response()->json(['error' => 1]);
        } else {
            CoinAnnounce::whereIn('id', $request->strIds)->get()->map(function ($query) {
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
}
