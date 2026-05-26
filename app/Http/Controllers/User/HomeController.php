<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Models\Deposit;
use App\Models\ExchangeRequest;
use App\Models\Gateway;
use App\Models\Kyc;
use App\Models\SellRequest;
use App\Models\Transaction;
use App\Models\UserKyc;
use App\Services\Kyc\SumsubKycService;
use App\Services\Kyc\UserKycManager;
use App\Traits\Upload;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;


class HomeController extends Controller
{
    use Upload;

    public function __construct()
    {
        $this->middleware(['auth']);
        $this->middleware(function ($request, $next) {
            $this->user = auth()->user();
            return $next($request);
        });
        $this->theme = template();
    }

    public function saveToken(Request $request)
    {
        Auth::user()
            ->fireBaseToken()
            ->create([
                'token' => $request->token,
            ]);
        return response()->json([
            'msg' => 'token saved successfully.',
        ]);
    }

    public function index()
    {
        $data['user'] = Auth::user();
        $data['baseColor'] = basicControl()->primary_color;
        $data['firebaseNotify'] = config('firebase');
        return view($this->theme . 'user.dashboard', $data);
    }

    public function getRecords()
    {
        $thirtyDaysAgo = Carbon::now()->subDays(30);

        $exchangeRequestQuery = $this->exchangeRequestQuery()->where('user_id', auth()->id());


        $exchangeRecord = collect((clone $exchangeRequestQuery)
                ->whereIn('status', ['2', '3', '5'])
                ->selectRaw('COUNT(id) AS totalExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 2 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysPendingPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
                ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 3 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCompletePercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
                ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 5 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCancelPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
                ->get()
                ->makeHidden(['tracking_status', 'admin_status', 'user_status'])
                ->toArray())->collapse();

        $buyRequestQuery = $this->buyRequestQuery();

        $buyRecord = collect((clone $buyRequestQuery)->where('user_id', auth()->id())->whereIn('status', [2, 3, 5])->selectRaw('COUNT(id) AS totalBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 2 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysPendingPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 3 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCompletePercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 5 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCancelPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->get()
            ->makeHidden(['tracking_status', 'admin_status', 'user_status'])
            ->toArray())->collapse();

        $sellRequestQuery = $this->sellRequestQuery();

        $sellRecord = collect((clone $sellRequestQuery)
            ->where('user_id', auth()->id())
            ->whereIn('status', ['2', '3', '5'])
            ->selectRaw('COUNT(id) AS totalSell')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingSell')
            ->selectRaw('(COUNT(CASE WHEN status = 2 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysPendingPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeSell')
            ->selectRaw('(COUNT(CASE WHEN status = 3 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCompletePercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelSell')
            ->selectRaw('(COUNT(CASE WHEN status = 5 AND created_at >= ? THEN id END) / COUNT(CASE WHEN created_at >= ? THEN id END)) * 100 AS last30DaysCancelPercentage', [$thirtyDaysAgo, $thirtyDaysAgo])
            ->get()
            ->makeHidden(['tracking_status', 'admin_status', 'user_status'])
            ->toArray())->collapse();

        return response()->json([
            'totalExchange' => fractionNumber($exchangeRecord['totalExchange'], false),
            'pendingExchange' => fractionNumber($exchangeRecord['pendingExchange'], false),
            'last30DaysPendingPercentage' => fractionNumber($exchangeRecord['last30DaysPendingPercentage']),
            'completeExchange' => fractionNumber($exchangeRecord['completeExchange'], false),
            'last30DaysCompletePercentage' => fractionNumber($exchangeRecord['last30DaysCompletePercentage']),
            'cancelExchange' => fractionNumber($exchangeRecord['cancelExchange'], false),
            'last30DaysCancelPercentage' => fractionNumber($exchangeRecord['last30DaysCancelPercentage']),

            'totalBuy' => fractionNumber($buyRecord['totalBuy'], false, false),
            'pendingBuy' => fractionNumber($buyRecord['pendingBuy'], false),
            'last30DaysPendingPercentageBuy' => fractionNumber($buyRecord['last30DaysPendingPercentage']),
            'completeBuy' => fractionNumber($buyRecord['completeBuy'], false),
            'last30DaysCompletePercentageBuy' => fractionNumber($buyRecord['last30DaysCompletePercentage']),
            'cancelBuy' => fractionNumber($buyRecord['cancelBuy'], false),
            'last30DaysCancelPercentageBuy' => fractionNumber($buyRecord['last30DaysCancelPercentage']),

            'totalSell' => fractionNumber($sellRecord['totalSell'], false),
            'pendingSell' => fractionNumber($sellRecord['pendingSell'], false),
            'last30DaysPendingPercentageSell' => fractionNumber($sellRecord['last30DaysPendingPercentage']),
            'completeSell' => fractionNumber($sellRecord['completeSell'], false),
            'last30DaysCompletePercentageSell' => fractionNumber($sellRecord['last30DaysCompletePercentage']),
            'cancelSell' => fractionNumber($sellRecord['cancelSell'], false),
            'last30DaysCancelPercentageSell' => fractionNumber($sellRecord['last30DaysCancelPercentage']),
        ]);
    }

    public function chartExchangeFigures()
    {
        $exchangeRequestQuery = $this->exchangeRequestQuery()->where('user_id', auth()->id());

        $exchangeRecord = collect((clone $exchangeRequestQuery)
            ->whereIn('status', [2, 3, 5])
            ->selectRaw('COUNT(id) AS totalExchange')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingExchange')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeExchange')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelExchange')
            ->get()
            ->toArray())->collapse();

        $data['horizontalBarChatExchange'] = [$exchangeRecord['totalExchange'], $exchangeRecord['pendingExchange'], $exchangeRecord['completeExchange'],
            $exchangeRecord['cancelExchange']];

        return response()->json(['exchangeFigures' => $data]);
    }

    public function chartBuyFigures()
    {
        $buyRequestQuery = $this->buyRequestQuery();

        $buyRecord = collect((clone $buyRequestQuery)->where('user_id', auth()->id())
            ->whereIn('status', ['2', '3', '5'])
            ->selectRaw('COUNT(id) AS totalBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelBuy')
            ->get()
            ->toArray())->collapse();

        $data['horizontalBarChatBuy'] = [$buyRecord['totalBuy'], $buyRecord['pendingBuy'], $buyRecord['completeBuy'],
            $buyRecord['cancelBuy']];

        return response()->json(['buyFigures' => $data]);
    }

    public function chartSellFigures()
    {
        $sellRequestQuery = $this->sellRequestQuery();
        $sellRecord = collect((clone $sellRequestQuery)->where('user_id', auth()->id())
            ->whereIn('status', ['2', '3', '5'])
            ->selectRaw('COUNT(id) AS totalSell')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingSell')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeSell')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelSell')
            ->get()
            ->toArray())->collapse();

        $data['horizontalBarChatSell'] = [$sellRecord['totalSell'], $sellRecord['pendingSell'], $sellRecord['completeSell'],
            $sellRecord['cancelSell']];

        return response()->json(['sellFigures' => $data]);
    }

    public function chartExchangeMovements()
    {
        $currentYear = date('Y');
        $currentMonth = date('m');

        $exchangeRequestQuery = $this->exchangeRequestQuery();

        $exchangeRequests = (clone $exchangeRequestQuery)->where('user_id', auth()->id())->selectRaw('MONTH(created_at) as month, COUNT(*) as total')
            ->whereYear('created_at', $currentYear)

            ->whereIn('status', [2, 3, 5])
            ->whereMonth('created_at', '<=', $currentMonth)
            ->groupBy(DB::raw('MONTH(created_at)'))
            ->get();

        $exchangeMovements = [];

        foreach ($exchangeRequests as $exchangeRequest) {
            $month = date("M", mktime(0, 0, 0, $exchangeRequest->month, 1)); // Convert month number to month name
            $exchangeMovements[$month] = $exchangeRequest->total; // Store month-wise total exchanges
        }
        return response()->json(['exchangeMovements' => $exchangeMovements]);
    }

    public function exchangeRequestQuery()
    {
        return ExchangeRequest::query();
    }
    public function buyRequestQuery()
    {
        return BuyRequest::query();
    }
    public function sellRequestQuery()
    {
        return SellRequest::query();
    }

    public function chartBuyMovements()
    {
        $currentYear = date('Y');
        $currentMonth = date('m');

        $buyRequestQuery = $this->buyRequestQuery();
        $buyRequests = (clone $buyRequestQuery)->where('user_id', auth()->id())->selectRaw('MONTH(created_at) as month, COUNT(*) as total')
            ->whereYear('created_at', $currentYear)
            ->whereIn('status', ['2', '3', '5'])

            ->whereMonth('created_at', '<=', $currentMonth)
            ->groupBy(DB::raw('MONTH(created_at)'))
            ->get();

        $buyMovements = [];

        foreach ($buyRequests as $buyRequest) {
            $month = date("M", mktime(0, 0, 0, $buyRequest->month, 1)); // Convert month number to month name
            $buyMovements[$month] = $buyRequest->total; // Store month-wise total exchanges
        }
        return response()->json(['buyMovements' => $buyMovements]);
    }

    public function chartSellMovements()
    {
        $currentYear = date('Y');
        $currentMonth = date('m');

        $sellRequestBaseQuery = $this->sellRequestQuery();
        $sellRequests = (clone $sellRequestBaseQuery)
            ->whereYear('created_at', $currentYear)
            ->selectRaw('MONTH(created_at) as month, COUNT(*) as total')
            ->whereIn('status', ['2', '3', '5'])
            ->where('user_id', auth()->id())
            ->whereMonth('created_at', '<=', $currentMonth)
            ->groupBy(DB::raw('MONTH(created_at)'))
            ->get();

        $sellMovements = [];

        foreach ($sellRequests as $sellRequest) {
            $month = date("M", mktime(0, 0, 0, $sellRequest->month, 1)); // Convert month number to month name
            $sellMovements[$month] = $sellRequest->total; // Store month-wise total exchanges
        }
        return response()->json(['sellMovements' => $sellMovements]);
    }

    function getDataForTimeRange($start, $end, $type)
    {
        $hours = [];
        $counts = [];

        for ($i = 0; $i < 24; $i++) {
            if ($i % 2 == 0) {
                $hour = $start->copy()->subHours($i + 1);
                $formattedHour = $hour->format('hA');
                $hours[] = $formattedHour;

                if ($type == 'exchange') {
                    $count = DB::table('exchange_requests')
                        ->where('user_id', auth()->id())
                        ->whereIn('status', ['2', '3', '5'])
                        ->where('updated_at', '>=', $hour)
                        ->where('updated_at', '<', $hour->copy()->addHours(2))
                        ->count();
                } elseif ($type == 'buy') {
                    $count = DB::table('buy_requests')
                        ->where('user_id', auth()->id())
                        ->whereIn('status', ['2', '3', '5'])
                        ->where('updated_at', '>=', $hour)
                        ->where('updated_at', '<', $hour->copy()->addHours(2))
                        ->count();
                } elseif ($type == 'sell') {
                    $count = DB::table('sell_requests')
                        ->where('user_id', auth()->id())
                        ->whereIn('status', ['2', '3', '5'])
                        ->where('updated_at', '>=', $hour)
                        ->where('updated_at', '<', $hour->copy()->addHours(2))
                        ->count();
                }
                $counts[] = $count;
            }
        }
        $hours = array_reverse($hours);
        $counts = array_reverse($counts);

        $data[] = [
            'hours' => $hours,
            'counts' => $counts,
        ];
        return $data;
    }

    public function kycShow($slug, $id)
    {
        $data['kycs'] = Kyc::where('status', 1)->get();
        $data['kyc'] = Kyc::where('status', 1)->findOrFail($id);
        $data['latestUserKyc'] = UserKyc::query()
            ->where('user_id', auth()->id())
            ->where('kyc_id', $id)
            ->latest()
            ->first();
        return view($this->theme . 'user.kyc.show', $data);
    }

    public function kycVerificationSubmit(Request $request, $id, UserKycManager $userKycManager)
    {
        $kyc = Kyc::where('status', 1)->findOrFail($id);
        if (($kyc->provider ?? 'manual') === 'sumsub') {
            return back()->with('error', 'This verification method is started through Sumsub widget.');
        }
        try {
            $params = $kyc->input_form;
            $reqData = $request->except('_token', '_method');
            $rules = [];
            if ($params !== null) {
                foreach ($params as $key => $cus) {
                    $rules[$key] = [$cus->validation == 'required' ? $cus->validation : 'nullable'];
                    if ($cus->type == 'file') {
                        $rules[$key][] = 'image';
                        $rules[$key][] = 'mimes:jpeg,jpg,png';
                        $rules[$key][] = 'max:2048';
                    } elseif ($cus->type == 'text') {
                        $rules[$key][] = 'max:191';
                    } elseif ($cus->type == 'number') {
                        $rules[$key][] = 'integer';
                    } elseif ($cus->type == 'textarea') {
                        $rules[$key][] = 'min:3';
                        $rules[$key][] = 'max:300';
                    }
                }
            }

            $validator = Validator::make($reqData, $rules);
            if ($validator->fails()) {
                return back()->withErrors($validator)->withInput();
            }
            $reqField = [];
            foreach ($request->except('_token', '_method', 'type') as $k => $v) {
                foreach ($params as $inKey => $inVal) {
                    if ($k == $inKey) {
                        if ($inVal->type == 'file' && $request->hasFile($inKey)) {
                            try {
                                $file = $this->fileUpload($request[$inKey], config('filelocation.kyc.path'), null, null, 'webp', 60);
                                $reqField[$inKey] = [
                                    'field_name' => $inVal->field_name,
                                    'field_value' => $file['path'],
                                    'field_driver' => $file['driver'],
                                    'validation' => $inVal->validation,
                                    'type' => $inVal->type,
                                ];
                            } catch (\Exception $exp) {
                                session()->flash('error', 'Could not upload your ' . $inKey);
                                return back()->withInput();
                            }
                        } else {
                            $reqField[$inKey] = [
                                'field_name' => $inVal->field_name,
                                'validation' => $inVal->validation,
                                'field_value' => $v,
                                'type' => $inVal->type,
                            ];
                        }
                    }
                }
            }

            UserKyc::create([
                'user_id' => auth()->id(),
                'kyc_id' => $kyc->id,
                'kyc_type' => $kyc->name,
                'kyc_info' => $reqField
            ]);

            if (auth()->user()) {
                $userKycManager->refreshUserVerificationStatus(auth()->user()->fresh());
            }

            return back()->with('success', 'KYC Sent Successfully');
        } catch (\Exception $e) {
            return back()->with('error', $e->getMessage());
        }
    }

    public function verificationCenter()
    {
        $data['kycs'] = Kyc::where('status', 1)->get();
        $data['userKycs'] = UserKyc::own()->latest()->get();
        return view($this->theme . 'user.kyc.verification-center', $data);
    }

    public function kycSumsubAccessToken(Request $request, $id, SumsubKycService $sumsubKycService)
    {
        $kyc = Kyc::where('status', 1)->findOrFail($id);

        try {
            $session = $sumsubKycService->startSession(auth()->user(), $kyc);

            return response()->json([
                'status' => 'ok',
                'token' => $session['token'],
                'websdk_url' => $session['websdk_url'],
                'applicant_id' => $session['applicant_id'],
            ]);
        } catch (\Throwable $exception) {
            return response()->json([
                'status' => 'error',
                'message' => $exception->getMessage(),
            ], 422);
        }
    }


    public function addFund()
    {
        $data['basic'] = basicControl();
        $data['gateways'] = Gateway::where('status', 1)->orderBy('sort_by', 'ASC')->get();
        return view($this->theme . 'user.fund.add_fund', $data);
    }


    public function fund(Request $request)
    {
        $basic = basicControl();
        $userId = Auth::id();
        $funds = Deposit::with(['depositable', 'gateway'])
            ->where('user_id', $userId)
            ->where('payment_method_id', '>', 999)
            ->orderBy('id', 'desc')
            ->latest()->paginate($basic->paginate);
        return view($this->theme . 'user.fund.index', compact('funds'));

    }


    public function transaction(Request $request)
    {
        $search = $request->all();
        $dateSearch = $request->datetrx;
        $date = preg_match("/^[0-9]{2,4}\-[0-9]{1,2}\-[0-9]{1,2}$/", $dateSearch);
        $userId = Auth::id();
        $transactions = Transaction::where('user_id', $userId)
            ->when(@$search['transaction_id'], function ($query) use ($search) {
                return $query->where('trx_id', 'LIKE', "%{$search['transaction_id']}%");
            })
            ->when(@$search['remark'], function ($query) use ($search) {
                return $query->where('remarks', 'LIKE', "%{$search['remark']}%");
            })
            ->when($date == 1, function ($query) use ($dateSearch) {
                return $query->whereDate("created_at", $dateSearch);
            })
            ->orderBy('id', 'desc')
            ->paginate(basicControl()->paginate);
        return view($this->theme . 'user.transaction.index', compact('transactions'));
    }

}
