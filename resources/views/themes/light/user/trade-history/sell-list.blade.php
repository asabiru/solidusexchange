@extends($theme.'layouts.user')
@section('page_title',__('Sell Crypto'))
@section('content')
    <!-- main -->
    <div class="card">
        <div class="card-body">
            <form action="{{route('user.sellList')}}" method="get">
                <div class="row g-3 align-items-end">
                    <div class="col-md-2">
                        <input placeholder="@lang('Trx ID')" name="utr"
                               value="{{@request()->utr}}"
                               type="text"
                               class="form-control form-control-sm">
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2-image" name="send_currency">
                            <option value="">@lang('All Send Currency')</option>
                            @if($sendCurrencies)
                                @foreach($sendCurrencies as $sendCurrency)
                                    <option value="{{$sendCurrency->id}}" data-img="{{$sendCurrency->image_path}}"
                                        {{@request()->send_currency == $sendCurrency->id ? 'selected':''}}>{{$sendCurrency->currency_name}}</option>
                                @endforeach
                            @endif
                        </select>
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2-image" name="get_currency">
                            <option value="">@lang('All Get Currency')</option>
                            @if($getCurrencies)
                                @foreach($getCurrencies as $getCurrency)
                                    <option value="{{$getCurrency->id}}"
                                            data-img="{{$getCurrency->image_path}}"
                                        {{@request()->get_currency == $getCurrency->id ? 'selected':''}}>{{$getCurrency->currency_name}}</option>
                                @endforeach
                            @endif
                        </select>
                    </div>
                    <div class="col-md-2">
                        <select class="cmn-select2" name="status">
                            <option value="">@lang('All Status')</option>
                            <option
                                value="2" {{@request()->status == '2' ? 'selected':''}}>@lang('Awaiting Complete')</option>
                            <option
                                value="3" {{@request()->status == '3' ? 'selected':''}}>@lang('Trade Completed')</option>
                            <option
                                value="5" {{@request()->status == '5' ? 'selected':''}}>@lang('Trade Cancel')</option>
                            <option
                                value="6" {{@request()->status == '6' ? 'selected':''}}>@lang('Trade Refunded')</option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <input name="datetrx" value="{{@request()->datetrx}}"
                               type="date"
                               class="form-control form-control-sm">
                    </div>
                    <div class="col-md-2">
                        <button type="submit" class="cmn-btn w-100"><i class="fal fa-search"></i> @lang('Filter')
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>
    <div class="card mt-50">
        <div class="card-body">
            <div class="cmn-table">
                <div class="table-responsive overflow-visible">
                    <table class="table align-middle table-striped">
                        <thead>
                        <tr>
                            <th scope="col">@lang('Trx ID')</th>
                            <th scope="col">@lang('Send Amount')</th>
                            <th scope="col">@lang('Get Amount')</th>
                            <th scope="col">@lang('Rate')</th>
                            <th scope="col">@lang('Status')</th>
                            <th scope="col">@lang('Requested At')</th>
                            <th scope="col">@lang('Action')</th>
                        </tr>
                        </thead>
                        <tbody>
                        @if(count($sells) > 0)
                            @foreach($sells as $key => $value)
                                <tr>
                                    <td data-label="@lang('Trx ID')">{{ $value->utr }}</td>
                                    <td data-label="@lang('Send Amount')"><a class="d-flex align-items-center me-2"
                                                                             href="javascript:void(0)">
                                            <div class="flex-shrink-0">
                                                <div class="avatar avatar-sm avatar-circle">
                                                    <img class="avatar-img"
                                                         src="{{getFile(optional($value->sendCurrency)->driver,optional($value->sendCurrency)->image)}}"
                                                         alt="Image Description">
                                                </div>
                                            </div>
                                            <div class="flex-grow-1 ms-3">
                                                <h5 class="text-hover-primary mb-0">{{rtrim(rtrim($value->send_amount,
                                                    0), '.')}} {{optional($value->sendCurrency)->code}}</h5>
                                                <span
                                                    class="baseColor">{{optional($value->sendCurrency)->currency_name}}</span>
                                            </div>
                                        </a>
                                    </td>
                                    <td data-label="@lang('Get Amount')">
                                        <a class="d-flex align-items-center me-2"
                                           href="javascript:void(0)">
                                            <div class="flex-shrink-0">
                                                <div class="avatar avatar-sm avatar-circle">
                                                    <img class="avatar-img"
                                                         src="{{getFile(optional($value->getCurrency)->driver,optional($value->getCurrency)->image)}}"
                                                         alt="Image Description">
                                                </div>
                                            </div>
                                            <div class="flex-grow-1 ms-3">
                                                <h5 class="text-hover-primary mb-0">{{number_format($value->final_amount,2)}} {{optional($value->getCurrency)->code}}</h5>
                                                <span
                                                    class="baseColor">{{optional($value->getCurrency)->currency_name}}</span>
                                            </div>
                                        </a>
                                    </td>
                                    <td data-label="@lang('Rate')">
                                        1 {{optional($value->sendCurrency)->code}} ~
                                        {{$value->exchange_rate}} {{optional($value->getCurrency)->code}}
                                    </td>
                                    <td data-label="@lang('Status')">{!! $value->user_status !!}</td>
                                    <td data-label="@lang('Requested At')"> {{ dateTime($value->created_at,basicControl()->date_time_format)}}</td>
                                    <td data-label="@lang('Action')">
                                        <a href="{{route('user.sellDetails',$value->utr)}}"
                                           class="action-btn-primary"><i
                                                class="fa-regular fa-pen-to-square"></i></a>
                                    </td>
                                </tr>
                            @endforeach
                        @else
                            @include('empty')
                        @endif
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    </div>
    {{ $sells->appends($_GET)->links($theme.'partials.user.pagination') }}
@endsection

