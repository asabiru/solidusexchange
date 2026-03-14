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
                            <a href="{{route("buyProcessing",$buyRequest->utr)}}" class="cmn-btn2"><i
                                    class="fa-regular fa-arrow-left"></i>@lang("Back")</a>
                        </div>
                        <div class="checkout-table">
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("You send")</span>
                                    <h6>{{number_format($buyRequest->send_amount,2)}} {{optional($buyRequest->sendCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($buyRequest->sendCurrency)->currency_name}}</span>
                                </div>
                                <div class="item">
                                    <span>@lang("You get")</span>
                                    <h6>
                                        ~ {{rtrim(rtrim($buyRequest->final_amount, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                    <span
                                        class="highlight">{{optional($buyRequest->getCurrency)->currency_name}}</span>
                                </div>
                            </div>
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("Service fee")</span>
                                    <h6>{{rtrim(rtrim($buyRequest->service_fee, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                    <div
                                        class="small">@lang("The service fee is already included in the displayed amount you’ll get")
                                    </div>
                                </div>
                                <div class="item">
                                    <span>@lang("Network fee")</span>
                                    <h6>{{rtrim(rtrim($buyRequest->network_fee, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                    <div
                                        class="small">@lang("The network fee is already included in the displayed amount you’ll get")
                                    </div>
                                </div>
                            </div>
                            <div class="table-row">
                                <div class="item">
                                    <span>@lang("Recipient address")</span>
                                    <h6>{{$buyRequest->destination_wallet}}</h6>

                                </div>
                                <div class="item">
                                    <span>@lang("Exchange rate")</span>
                                    <h6>
                                        1 {{optional($buyRequest->getCurrency)->code}}
                                        ~ {{$buyRequest->show_exchange_rate}} {{optional($buyRequest->sendCurrency)->code}}</h6>

                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="widget-area">
                        <a href="{{route('buyInitPayment',$buyRequest->utr)}}"
                           class="cmn-btn w-100">@lang("Confirm & make payment")</a>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
