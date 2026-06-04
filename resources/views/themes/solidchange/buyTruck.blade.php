<div class="row mt-2">
    <div class="col-xl-7 col-lg-8 mx-auto text-center">
        <div class="checkout-section">
            <div class="checkout-header">
                <div class="d-flex justify-content-end">
                    {!! $object->tracking_status !!}
                </div>
            </div>
            <div class="checkout-table">
                <div class="table-row">
                    <div class="item">
                        <span>@lang("You send")</span>
                        <h6>{{number_format($object->send_amount,2)}} {{optional($object->sendCurrency)->code}}</h6>
                        <span
                            class="highlight">{{optional($object->sendCurrency)->currency_name}}</span>
                    </div>
                    <div class="item">
                        <span>@lang("You get")</span>
                        <h6>
                            ~ {{rtrim(rtrim($object->final_amount, 0), '.')}} {{optional($object->getCurrency)->code}}</h6>
                        <span
                            class="highlight">{{optional($object->getCurrency)->currency_name}}</span>
                    </div>
                </div>
                <div class="table-row">
                    <div class="item">
                        <span>@lang("Transaction Id")</span>
                        <h6>{{$object->utr}}</h6>

                    </div>
                    <div class="item">
                        <span>@lang("Exchange rate")</span>
                        <h6>
                            1 {{optional($object->getCurrency)->code}}
                            ~ {{$object->show_exchange_rate}} {{optional($object->sendCurrency)->code}}</h6>

                    </div>
                </div>
                <div class="table-row">
                    <div class="item">
                        <span>@lang("Service fee")</span>
                        <h6>{{rtrim(rtrim($object->service_fee, 0), '.')}} {{optional($object->getCurrency)->code}}</h6>
                        <div
                            class="small">@lang("The service fee is already included in the displayed amount you’ll get")
                        </div>
                    </div>
                    <div class="item">
                        <span>@lang("Network fee")</span>
                        <h6>{{rtrim(rtrim($object->network_fee, 0), '.')}} {{optional($object->getCurrency)->code}}</h6>
                        <div
                            class="small">@lang("The network fee is already included in the displayed amount you’ll get")
                        </div>
                    </div>
                </div>
                <div class="table-row">
                    <div class="item">
                        <span>@lang("Recipient address")</span>
                        <h6>{{$object->destination_wallet}}</h6>
                    </div>
                    <div class="item">
                        <span>@lang("Payment By")</span>
                        <h6>{{optional($object->gateway)->name}}</h6>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>



