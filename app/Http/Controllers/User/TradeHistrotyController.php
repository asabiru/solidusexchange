<?php

namespace App\Http\Controllers\User;

use App\Http\Controllers\Controller;
use App\Models\BuyRequest;
use App\Models\CryptoCurrency;
use App\Models\ExchangeRequest;
use App\Models\FiatCurrency;
use App\Models\SellRequest;
use App\Services\ExchangeEngine\ExchangeQuoteService;
use App\Traits\CalculateFees;
use Illuminate\Http\Request;

class TradeHistrotyController extends Controller
{
    use CalculateFees;

    public function __construct()
    {
        $this->middleware(['auth']);
        $this->middleware(function ($request, $next) {
            $this->user = auth()->user();
            return $next($request);
        });
        $this->theme = template();
    }

    public function exchangeList(Request $request)
    {
        $search = $request->all();
        $dateSearch = $request->datetrx;
        $date = preg_match("/^[0-9]{2,4}\-[0-9]{1,2}\-[0-9]{1,2}$/", $dateSearch);

        $data['exchanges'] = ExchangeRequest::with(['sendCurrency', 'getCurrency'])
            ->where('user_id', $this->user->id)
            ->when(@$search['utr'], function ($query) use ($search) {
                return $query->where('utr', 'LIKE', "%{$search['utr']}%");
            })
            ->when(@$search['send_currency'], function ($query) use ($search) {
                return $query->where('send_currency_id', $search['send_currency']);
            })
            ->when(@$search['get_currency'], function ($query) use ($search) {
                return $query->where('get_currency_id', $search['get_currency']);
            })
            ->when($date == 1, function ($query) use ($dateSearch) {
                return $query->whereDate("created_at", $dateSearch);
            })
            ->where(function ($query) use ($search) {
                if (@$search['status']) {
                    return $query->where('status', $search['status']);
                } else {
                    return $query->whereIn('status', ['2', '3', '5']);
                }
            })
            ->orderBy('id', 'desc')
            ->paginate(basicControl()->paginate);

        $data['currencies'] = CryptoCurrency::select(['id', 'code', 'driver', 'image', 'name'])->withTrashed()->get();
        return view($this->theme . 'user.trade-history.exchange-list', $data);
    }

    public function exchangeDetails($utr)
    {
        $data['exchange'] = ExchangeRequest::where('user_id', $this->user->id)->whereIn('status', ['2', '3', '5'])
            ->where('utr', $utr)->firstOrFail();
        return view($this->theme . 'user.trade-history.exchange-details', $data);
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

    public function rateUpdate($exchange)
    {
        return app(ExchangeQuoteService::class)->refreshFloatingExchange($exchange);
    }

    public function buyList(Request $request)
    {
        $search = $request->all();
        $dateSearch = $request->datetrx;
        $date = preg_match("/^[0-9]{2,4}\-[0-9]{1,2}\-[0-9]{1,2}$/", $dateSearch);

        $data['buys'] = BuyRequest::with(['sendCurrency', 'getCurrency'])
            ->where('user_id', $this->user->id)
            ->when(@$search['utr'], function ($query) use ($search) {
                return $query->where('utr', 'LIKE', "%{$search['utr']}%");
            })
            ->when(@$search['send_currency'], function ($query) use ($search) {
                return $query->where('send_currency_id', $search['send_currency']);
            })
            ->when(@$search['get_currency'], function ($query) use ($search) {
                return $query->where('get_currency_id', $search['get_currency']);
            })
            ->when($date == 1, function ($query) use ($dateSearch) {
                return $query->whereDate("created_at", $dateSearch);
            })
            ->where(function ($query) use ($search) {
                if (@$search['status']) {
                    return $query->where('status', $search['status']);
                } else {
                    return $query->whereIn('status', ['2', '3', '5']);
                }
            })
            ->orderBy('id', 'desc')
            ->paginate(basicControl()->paginate);

        $data['sendCurrencies'] = FiatCurrency::select(['id', 'code', 'driver', 'image', 'name'])->withTrashed()->get();
        $data['getCurrencies'] = CryptoCurrency::select(['id', 'code', 'driver', 'image', 'name'])->withTrashed()->get();
        return view($this->theme . 'user.trade-history.buy-list', $data);
    }

    public function buyDetails($utr)
    {
        $data['buy'] = BuyRequest::where('user_id', $this->user->id)->whereIn('status', ['2', '3', '5'])
            ->where('utr', $utr)->firstOrFail();
        return view($this->theme . 'user.trade-history.buy-details', $data);
    }

    public function sellList(Request $request)
    {
        $search = $request->all();
        $dateSearch = $request->datetrx;
        $date = preg_match("/^[0-9]{2,4}\-[0-9]{1,2}\-[0-9]{1,2}$/", $dateSearch);

        $data['sells'] = SellRequest::with(['sendCurrency', 'getCurrency'])
            ->where('user_id', $this->user->id)
            ->when(@$search['utr'], function ($query) use ($search) {
                return $query->where('utr', 'LIKE', "%{$search['utr']}%");
            })
            ->when(@$search['send_currency'], function ($query) use ($search) {
                return $query->where('send_currency_id', $search['send_currency']);
            })
            ->when(@$search['get_currency'], function ($query) use ($search) {
                return $query->where('get_currency_id', $search['get_currency']);
            })
            ->when($date == 1, function ($query) use ($dateSearch) {
                return $query->whereDate("created_at", $dateSearch);
            })
            ->where(function ($query) use ($search) {
                if (@$search['status']) {
                    return $query->where('status', $search['status']);
                } else {
                    return $query->whereIn('status', ['2', '3', '5']);
                }
            })
            ->orderBy('id', 'desc')
            ->paginate(basicControl()->paginate);

        $data['sendCurrencies'] = CryptoCurrency::select(['id', 'code', 'driver', 'image', 'name'])->withTrashed()->get();
        $data['getCurrencies'] = FiatCurrency::select(['id', 'code', 'driver', 'image', 'name'])->withTrashed()->get();
        return view($this->theme . 'user.trade-history.sell-list', $data);
    }

    public function sellDetails($utr)
    {
        $data['sell'] = SellRequest::where('user_id', $this->user->id)->whereIn('status', ['2', '3', '5'])
            ->where('utr', $utr)->firstOrFail();
        return view($this->theme . 'user.trade-history.sell-details', $data);
    }

}
