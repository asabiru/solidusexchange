@extends($theme.'layouts.user')
@section('page_title',__('Transaction'))
@section('content')
    <!-- main -->
    <div class="card">
        <div class="card-body">
            <form action="{{route('user.transaction.index')}}" method="get">
                <div class="row g-3 align-items-end">
                    <div class="col-md-3">
                        <input placeholder="@lang('Transaction ID')" name="transaction_id"
                               value="{{@request()->transaction_id}}"
                               type="text"
                               class="form-control form-control-sm">
                    </div>
                    <div class="col-md-3">
                        <input placeholder="@lang('Remarks')" name="remark" value="{{@request()->remark}}"
                               type="text"
                               class="form-control form-control-sm">
                    </div>
                    <div class="col-md-3">
                        <input name="datetrx" value="{{@request()->datetrx}}"
                               type="date"
                               class="form-control form-control-sm">
                    </div>
                    <div class="col-md-3">
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
                            <th scope="col">@lang('Transaction ID')</th>
                            <th scope="col">@lang('Amount')</th>
                            <th scope="col">@lang('Charge')</th>
                            <th scope="col">@lang('Remarks')</th>
                            <th scope="col">@lang('Created time')</th>
                        </tr>
                        </thead>
                        <tbody>
                        @if(count($transactions) > 0)
                            @foreach($transactions as $key => $value)
                                <tr>
                                    <td data-label="@lang('Transaction ID')">{{ $value->trx_id }}</td>
                                    <td data-label="@lang('Amount')">@if($value->transactional_type == \App\Models\BuyRequest::class)
                                            <h6 class="mb-0 {{ $value->trx_type == '+' ? 'text-success' : 'text-danger' }}">{{ $value->trx_type . currencyPosition($value->amount) }}
                                                | <sup
                                                    class="baseColor">{{number_format($value->transaction_amount, 2)}} {{$value->transaction_currency}}</sup>
                                            </h6>
                                        @else
                                            <h6 class="mb-0 {{ $value->trx_type == '+' ? 'text-success' : 'text-danger' }}">{{ $value->trx_type . currencyPosition($value->amount) }}
                                                | <sup
                                                    class="baseColor">{{rtrim(rtrim($value->transaction_amount, 0), '.')}} {{$value->transaction_currency}}</sup>
                                            </h6>
                                        @endif</td>
                                    <td data-label="@lang('Charge')"><span
                                            class="text-danger">{{ currencyPosition(number_format($value->charge,2)) }}</span>
                                    </td>
                                    <td data-label="@lang('Remarks')">{{ $value->remarks}}</td>
                                    <td data-label="@lang('Created time')"> {{ dateTime($value->created_at,basicControl()->date_time_format)}} </td>
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
    {{ $transactions->appends($_GET)->links($theme.'partials.user.pagination') }}
@endsection

