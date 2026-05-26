@extends($theme . 'layouts.calculation')
@section('title',trans('Processing'))
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <div class="row g-xl-5 g-4">
                @include($theme.'partials.exchange-module.exchange-leftbar',['progress' => '25','check' => 2])
                <div class="col-lg-6 order-1 order-lg-2">
                    <div class="checkout-section">
                        <div class="checkout-header">
                            <h4 class="mb-0">@lang("Checkout")</h4>
                            <a href="{{route("exchangeProcessing",$exchangeRequest->utr)}}" class="cmn-btn2"><i
                                    class="fa-regular fa-arrow-left"></i>@lang("Back")</a>
                        </div>
                        <div class="checkout-table">
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("You send")</span>
                                    <h6>{{rtrim(rtrim($exchangeRequest->send_amount, 0), '.')}} {{optional($exchangeRequest->sendCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($exchangeRequest->sendCurrency)->currency_name}}</span>
                                </div>
                                <div class="item">
                                    <span>@lang("You get")</span>
                                    <h6>{{$exchangeRequest->rate_type == 'floating' ? '~':''}} {{rtrim(rtrim($exchangeRequest->final_amount, 0), '.')}} {{optional($exchangeRequest->getCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($exchangeRequest->getCurrency)->currency_name}}</span>
                                </div>
                            </div>
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("Service fee")</span>
                                    <h6>{{rtrim(rtrim($exchangeRequest->service_fee, 0), '.')}} {{optional($exchangeRequest->getCurrency)->code}}</h6>
                                    <div
                                        class="small">@lang("The service fee is already included in the displayed amount you’ll get")
                                    </div>
                                </div>
                                <div class="item">
                                    <span>@lang("Network fee")</span>
                                    <h6>{{rtrim(rtrim($exchangeRequest->network_fee, 0), '.')}} {{optional($exchangeRequest->getCurrency)->code}}</h6>
                                    <div
                                        class="small">@lang("The network fee is already included in the displayed amount you’ll get")
                                    </div>
                                </div>
                            </div>
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("Recipient address")</span>
                                    <h6>{{$exchangeRequest->destination_wallet}}</h6>

                                </div>
                                <div class="item">
                                    <span>@lang("Exchange rate")</span>
                                    <h6>
                                        1 {{optional($exchangeRequest->sendCurrency)->code}} {{$exchangeRequest->rate_type == 'floating' ? '~':'='}} {{$exchangeRequest->exchange_rate}} {{optional($exchangeRequest->getCurrency)->code}}</h6>

                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="widget-area">
                        <a href="{{route('exchangeInitPayment',$exchangeRequest->utr)}}"
                           class="cmn-btn w-100">@lang("Confirm & make payment")</a>
                    </div>
                </div>
                <div class="col-md-3 order-3">

                </div>
            </div>
        </div>
    </section>
@endsection
