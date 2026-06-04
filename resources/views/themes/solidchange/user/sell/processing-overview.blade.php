@extends($theme . 'layouts.calculation')
@section('title',trans('Processing'))
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <div class="row g-xl-5 g-4">
                @include($theme.'user.buy.buy-leftbar',['progress' => '25','check' => 2])
                <div class="col-lg-6 order-1 order-lg-2">
                    <div class="checkout-section">
                        <div class="checkout-header">
                            <h4 class="mb-0">@lang("Overview")</h4>
                            <a href="{{route("sellProcessing",$sellRequest->utr)}}" class="cmn-btn2"><i
                                    class="fa-regular fa-arrow-left"></i>@lang("Back")</a>
                        </div>
                        <div class="checkout-table">
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("You send")</span>
                                    <h6>{{rtrim(rtrim($sellRequest->send_amount, 0), '.')}} {{optional($sellRequest->sendCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($sellRequest->sendCurrency)->currency_name}}</span>
                                </div>
                                <div class="item">
                                    <span>@lang("You get")</span>
                                    <h6>
                                        ~ {{number_format($sellRequest->final_amount,2)}} {{optional($sellRequest->getCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($sellRequest->getCurrency)->currency_name}}</span>
                                </div>
                            </div>
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("Processing fee")</span>
                                    <h6>{{number_format($sellRequest->processing_fee,2)}} {{optional($sellRequest->getCurrency)->code}}</h6>
                                    <div
                                        class="small">@lang("The processing fee is already included in the displayed amount you’ll get")
                                    </div>
                                </div>
                                <div class="item">
                                    <span>@lang("Exchange Rate")</span>
                                    <h6>
                                        1 {{optional($sellRequest->sendCurrency)->code}}
                                        ~ {{$sellRequest->exchange_rate}} {{optional($sellRequest->getCurrency)->code}}</h6>
                                </div>
                            </div>
                            @if($sellRequest->parameters)
                                <div class="table-row">
                                    <div class="item">
                                        <span>@lang('Get Currency Method')</span>
                                        <h6>{{optional($sellRequest->fiatSendGateway)->name}}</h6>
                                    </div>
                                    @foreach($sellRequest->parameters as $key => $param)
                                        <div class="item">
                                            <span>{{$param->field_label}}</span>
                                            <h6>{{$param->field_value}}</h6>
                                        </div>
                                    @endforeach
                                </div>
                            @endif
                        </div>
                    </div>
                    <div class="widget-area">
                        <a href="{{route('sellInitPayment',$sellRequest->utr)}}"
                           class="cmn-btn w-100">@lang("Confirm & make payment")</a>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
