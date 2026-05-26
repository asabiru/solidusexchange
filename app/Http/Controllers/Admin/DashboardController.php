<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Models\Deposit;
use App\Models\ExchangeRequest;
use App\Models\SellRequest;
use App\Models\SupportTicket;
use App\Models\Transaction;
use App\Models\User;
use App\Models\UserKyc;
use App\Traits\Notify;
use Carbon\Carbon;
use Illuminate\Http\Request;
use App\Traits\Upload;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    use Upload, Notify;

    public function index()
    {
        if (Auth::guard('admin')->check() && Auth::guard('admin')->user()->isTrader()) {
            return redirect()->route('admin.trader.dashboard');
        }

        $now = Carbon::now();
        $data['firebaseNotify'] = config('firebase');
        $data['basicControl'] = basicControl();
        $data['latestUser'] = User::latest()->limit(5)->get();
        $totalDepositThisMonth = Deposit::whereYear('created_at', $now->year)
            ->whereMonth('created_at', $now->month)
            ->sum('payable_amount');
        $data['dashboardStats'] = [
            'totalUsers' => User::count(),
            'usersToday' => User::whereDate('created_at', $now->toDateString())->count(),
            'pendingTickets' => SupportTicket::where('status', 0)->count(),
            'pendingKyc' => UserKyc::where('status', 0)->count(),
            'transactionsMonth' => Transaction::whereYear('created_at', $now->year)
                ->whereMonth('created_at', $now->month)
                ->count(),
            'depositThisMonth' => $totalDepositThisMonth,
            'buyThisMonth' => BuyRequest::whereYear('created_at', $now->year)
                ->whereMonth('created_at', $now->month)
                ->count(),
            'sellThisMonth' => SellRequest::whereYear('created_at', $now->year)
                ->whereMonth('created_at', $now->month)
                ->count(),
        ];
        $statistics['schedule'] = $this->dayList();
        $statistics['totalDepositThisMonth'] = $totalDepositThisMonth;

        return view('admin.dashboard-alternative', $data, compact("statistics"));
    }


    public function chartUserRecords()
    {
        $currentMonth = Carbon::now()->format('Y-m');
        $userRecord = collect(User::selectRaw('COUNT(id) AS totalUsers')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN id END) AS currentDateUserCount')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = DATE(DATE_SUB(NOW(), INTERVAL 1 DAY)) THEN id END) AS previousDateUserCount')
            ->get()->makeHidden(['last-seen-activity', 'fullname'])
            ->toArray())->collapse();
        $followupGrap = $this->followupGrap($userRecord['currentDateUserCount'], $userRecord['previousDateUserCount']);

        $userRecord->put('followupGrapClass', $followupGrap['class']);
        $userRecord->put('followupGrap', $followupGrap['percentage']);

        $current_month_data = DB::table('users')
            ->select(DB::raw('DATE_FORMAT(created_at,"%e %b") as date'), DB::raw('count(*) as count'))
            ->where(DB::raw('DATE_FORMAT(created_at, "%Y-%m")'), $currentMonth)
            ->orderBy('created_at', 'asc')
            ->groupBy('date')
            ->get();

        $current_month_data_dates = $current_month_data->pluck('date');
        $current_month_datas = $current_month_data->pluck('count');
        $userRecord['chartPercentageIncDec'] = fractionNumber($userRecord['totalUsers'] - $userRecord['currentDateUserCount'], false);
        return response()->json(['userRecord' => $userRecord, 'current_month_data_dates' => $current_month_data_dates, 'current_month_datas' => $current_month_datas]);
    }

    public function chartTicketRecords()
    {
        $currentMonth = Carbon::now()->format('Y-m');
        $ticketRecord = collect(SupportTicket::selectRaw('COUNT(id) AS totalTickets')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN id END) AS currentDateTicketsCount')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = DATE(DATE_SUB(NOW(), INTERVAL 1 DAY)) THEN id END) AS previousDateTicketsCount')
            ->selectRaw('count(CASE WHEN status = 2  THEN status END) AS replied')
            ->selectRaw('count(CASE WHEN status = 1  THEN status END) AS answered')
            ->selectRaw('count(CASE WHEN status = 0  THEN status END) AS pending')
            ->get()
            ->toArray())->collapse();

        $followupGrap = $this->followupGrap($ticketRecord['currentDateTicketsCount'], $ticketRecord['previousDateTicketsCount']);
        $ticketRecord->put('followupGrapClass', $followupGrap['class']);
        $ticketRecord->put('followupGrap', $followupGrap['percentage']);

        $current_month_data = DB::table('support_tickets')
            ->select(DB::raw('DATE_FORMAT(created_at,"%e %b") as date'), DB::raw('count(*) as count'))
            ->where(DB::raw('DATE_FORMAT(created_at, "%Y-%m")'), $currentMonth)
            ->orderBy('created_at', 'asc')
            ->groupBy('date')
            ->get();

        $current_month_data_dates = $current_month_data->pluck('date');
        $current_month_datas = $current_month_data->pluck('count');
        $ticketRecord['chartPercentageIncDec'] = fractionNumber($ticketRecord['totalTickets'] - $ticketRecord['currentDateTicketsCount'], false);
        return response()->json(['ticketRecord' => $ticketRecord, 'current_month_data_dates' => $current_month_data_dates, 'current_month_datas' => $current_month_datas]);
    }

    public function chartKycRecords()
    {
        $currentMonth = Carbon::now()->format('Y-m');
        $kycRecords = collect(UserKyc::selectRaw('COUNT(id) AS totalKYC')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN id END) AS currentDateKYCCount')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = DATE(DATE_SUB(NOW(), INTERVAL 1 DAY)) THEN id END) AS previousDateKYCCount')
            ->selectRaw('count(CASE WHEN status = 0  THEN status END) AS pendingKYC')
            ->get()
            ->toArray())->collapse();
        $followupGrap = $this->followupGrap($kycRecords['currentDateKYCCount'], $kycRecords['previousDateKYCCount']);
        $kycRecords->put('followupGrapClass', $followupGrap['class']);
        $kycRecords->put('followupGrap', $followupGrap['percentage']);


        $current_month_data = DB::table('user_kycs')
            ->select(DB::raw('DATE_FORMAT(created_at,"%e %b") as date'), DB::raw('count(*) as count'))
            ->where(DB::raw('DATE_FORMAT(created_at, "%Y-%m")'), $currentMonth)
            ->orderBy('created_at', 'asc')
            ->groupBy('date')
            ->get();

        $current_month_data_dates = $current_month_data->pluck('date');
        $current_month_datas = $current_month_data->pluck('count');
        $kycRecords['chartPercentageIncDec'] = fractionNumber($kycRecords['totalKYC'] - $kycRecords['currentDateKYCCount'], false);
        return response()->json(['kycRecord' => $kycRecords, 'current_month_data_dates' => $current_month_data_dates, 'current_month_datas' => $current_month_datas]);
    }

    public function chartTransactionRecords()
    {
        $currentMonth = Carbon::now()->format('Y-m');

        $transactionQuery = $this->transactionQuery();
        $transaction = collect((clone $transactionQuery)->selectRaw('COUNT(id) AS totalTransaction')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = CURDATE() THEN id END) AS currentDateTransactionCount')
            ->selectRaw('COUNT(CASE WHEN DATE(created_at) = DATE(DATE_SUB(NOW(), INTERVAL 1 DAY)) THEN id END) AS previousDateTransactionCount')
            ->whereRaw('YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())')
            ->get()
            ->toArray())
            ->collapse();

        $followupGrap = $this->followupGrap($transaction['currentDateTransactionCount'], $transaction['previousDateTransactionCount']);
        $transaction->put('followupGrapClass', $followupGrap['class']);
        $transaction->put('followupGrap', $followupGrap['percentage']);


        $current_month_data = DB::table('transactions')
            ->select(DB::raw('DATE_FORMAT(created_at,"%e %b") as date'), DB::raw('count(*) as count'))
            ->where(DB::raw('DATE_FORMAT(created_at, "%Y-%m")'), $currentMonth)
            ->orderBy('created_at', 'asc')
            ->groupBy('date')
            ->get();

        $current_month_data_dates = $current_month_data->pluck('date');
        $current_month_datas = $current_month_data->pluck('count');
        $transaction['chartPercentageIncDec'] = fractionNumber($transaction['totalTransaction'] - $transaction['currentDateTransactionCount'], false);
        return response()->json(['transactionRecord' => $transaction, 'current_month_data_dates' => $current_month_data_dates, 'current_month_datas' => $current_month_datas]);
    }


    public function chartLoginHistory()
    {
        $userLoginsData = DB::table('user_logins')
            ->whereDate('created_at', '>=', now()->subDays(30))
            ->select('browser', 'os', 'get_device')
            ->get();

        $userLoginsBrowserData = $userLoginsData->groupBy('browser')->map->count();
        $data['browserKeys'] = $userLoginsBrowserData->keys();
        $data['browserValue'] = $userLoginsBrowserData->values();

        $userLoginsOSData = $userLoginsData->groupBy('os')->map->count();
        $data['osKeys'] = $userLoginsOSData->keys();
        $data['osValue'] = $userLoginsOSData->values();

        $userLoginsDeviceData = $userLoginsData->groupBy('get_device')->map->count();
        $data['deviceKeys'] = $userLoginsDeviceData->keys();
        $data['deviceValue'] = $userLoginsDeviceData->values();

        return response()->json(['loginPerformance' => $data]);
    }


    // Function to get data for a given time range
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
                        ->whereIn('status', ['2', '3', '5'])
                        ->where('updated_at', '>=', $hour)
                        ->where('updated_at', '<', $hour->copy()->addHours(2))
                        ->count();
                } elseif ($type == 'buy') {
                    $count = DB::table('buy_requests')
                        ->whereIn('status', ['2', '3', '5'])
                        ->where('updated_at', '>=', $hour)
                        ->where('updated_at', '<', $hour->copy()->addHours(2))
                        ->count();
                } elseif ($type == 'sell') {
                    $count = DB::table('sell_requests')
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

    public function monthlyDepositWithdraw(Request $request)
    {
        $keyDataset = $request->keyDataset;

        $dailyTransaction = $this->dayList();

        $transactionQuery = $this->transactionQuery();

        (clone $transactionQuery)->when($keyDataset == '0', function ($query) {
            $query->whereMonth('created_at', Carbon::now()->month);
        })
            ->when($keyDataset == '1', function ($query) {
                $lastMonth = Carbon::now()->subMonth();
                $query->whereMonth('created_at', $lastMonth->month);
            })
            ->select(
                DB::raw('SUM(amount) as totalTransaction'),
                DB::raw('DATE_FORMAT(created_at,"Day %d") as date')
            )
            ->groupBy(DB::raw("DATE(created_at)"))
            ->get()->map(function ($item) use ($dailyTransaction) {
                $dailyTransaction->put($item['date'], $item['totalTransaction']);
            });

        return response()->json([
            "totalTransaction" => currencyPosition($dailyTransaction->sum()),
            "dailyTransaction" => $dailyTransaction,
        ]);
    }

    public function transactionQuery()
    {
        return Transaction::query();
    }

    public function sellRequestQuery()
    {
        return SellRequest::query();
    }

    public function buyRequestQuery()
    {
        return BuyRequest::query();
    }

    public function exchangeRequestQuery()
    {
        return ExchangeRequest::query();
    }

    public function saveToken(Request $request)
    {
        $admin = Auth::guard('admin')->user()
            ->fireBaseToken()
            ->create([
                'token' => $request->token,
            ]);
        return response()->json([
            'msg' => 'token saved successfully.',
        ]);
    }


    public function dayList()
    {
        $totalDays = Carbon::now()->endOfMonth()->format('d');
        $daysByMonth = [];
        for ($i = 1; $i <= $totalDays; $i++) {
            array_push($daysByMonth, ['Day ' . sprintf("%02d", $i) => 0]);
        }

        return collect($daysByMonth)->collapse();
    }

    protected function followupGrap($todaysRocords, $lasDayRocords = 0)
    {

        if (0 < $lasDayRocords) {
            $percentageIncrease = (($todaysRocords - $lasDayRocords) / $lasDayRocords) * 100;
        } else {
            $percentageIncrease = 0;
        }
        if ($percentageIncrease > 0) {
            $class = "bg-soft-success text-success";
        } elseif ($percentageIncrease < 0) {
            $class = "bg-soft-danger text-danger";
        } else {
            $class = "bg-soft-secondary text-body";
        }

        return [
            'class' => $class,
            'percentage' => round($percentageIncrease, 2)
        ];
    }

    public function chartExchangeRecords()
    {
        $currentTime = Carbon::now();
        $data['exchangeToday'] = $this->getDataForTimeRange($currentTime, $currentTime->copy()->subHours(24), 'exchange')[0] ?? null;
        $data['exchangeYesterday'] = $this->getDataForTimeRange($currentTime->copy()->subHours(24), $currentTime->copy()->subHours(24), 'exchange')[0] ?? null;

        $exchangeRequestQuery = $this->exchangeRequestQuery();
        $data['totalExchange'] = (clone $exchangeRequestQuery)->whereIn('status', ['2', '3', '5'])->count();
        return response()->json(['exchangeRecord' => $data]);
    }

    public function chartBuyRecords()
    {
        $currentTime = Carbon::now();
        $data['buyToday'] = $this->getDataForTimeRange($currentTime, $currentTime->copy()->subHours(24), 'buy')[0] ?? null;
        $data['buyYesterday'] = $this->getDataForTimeRange($currentTime->copy()->subHours(24), $currentTime->copy()->subHours(24), 'buy')[0] ?? null;

        $buyRequestQuery = $this->buyRequestQuery();
        $data['totalBuy'] = (clone $buyRequestQuery)->whereIn('status', ['2', '3', '5'])->count();
        return response()->json(['buyRecord' => $data]);
    }

    public function chartSellRecords()
    {
        $currentTime = Carbon::now();
        $data['sellToday'] = $this->getDataForTimeRange($currentTime, $currentTime->copy()->subHours(24), 'sell')[0] ?? null;
        $data['sellYesterday'] = $this->getDataForTimeRange($currentTime->copy()->subHours(24), $currentTime->copy()->subHours(24), 'sell')[0] ?? null;

        $sellRequestQuery = $this->sellRequestQuery();

        $data['totalSell'] = (clone $sellRequestQuery)->whereIn('status', ['2', '3', '5'])->count();
        return response()->json(['sellRecord' => $data]);
    }

    public function chartExchangePerformance()
    {
        $exchangeRequestQuery = $this->exchangeRequestQuery();
        $exchangeRecord = collect(
            (clone $exchangeRequestQuery)
                ->whereIn('status', ['2', '3', '5'])
                ->selectRaw('COUNT(id) AS totalExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeExchange')
                ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelExchange')
                ->get()
                ->toArray())->collapse();

        $data['horizontalBarChatExchange'] = [$exchangeRecord['totalExchange'], $exchangeRecord['pendingExchange'], $exchangeRecord['completeExchange'],
            $exchangeRecord['cancelExchange']];

        return response()->json(['exchangePerformance' => $data]);
    }

    public function chartBuyPerformance()
    {
        $buyRequestQuery = $this->buyRequestQuery();
        $buyRecord = collect((clone $buyRequestQuery)->whereIn('status', ['2', '3', '5'])
            ->selectRaw('COUNT(id) AS totalBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeBuy')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelBuy')
            ->get()
            ->toArray())->collapse();

        $data['horizontalBarChatBuy'] = [$buyRecord['totalBuy'], $buyRecord['pendingBuy'], $buyRecord['completeBuy'],
            $buyRecord['cancelBuy']];

        return response()->json(['buyPerformance' => $data]);
    }

    public function chartSellPerformance()
    {
        $sellRequestQuery = $this->sellRequestQuery();
        $sellRecord = collect((clone $sellRequestQuery)->whereIn('status', ['2', '3', '5'])
            ->selectRaw('COUNT(id) AS totalSell')
            ->selectRaw('(COUNT(CASE WHEN status = 2 THEN id END)) AS pendingSell')
            ->selectRaw('(COUNT(CASE WHEN status = 3 THEN id END)) AS completeSell')
            ->selectRaw('(COUNT(CASE WHEN status = 5 THEN id END)) AS cancelSell')
            ->get()
            ->toArray())->collapse();

        $data['horizontalBarChatSell'] = [$sellRecord['totalSell'], $sellRecord['pendingSell'], $sellRecord['completeSell'],
            $sellRecord['cancelSell']];

        return response()->json(['sellPerformance' => $data]);
    }

}
