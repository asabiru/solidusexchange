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
                        <h6>{{rtrim(rtrim($object->send_amount, 0), '.')}} {{optional($object->sendCurrency)->code}}</h6>
                        <span
                            class="highlight">{{optional($object->sendCurrency)->currency_name}}</span>
                    </div>
                    <div class="item">
                        <span>@lang("You get")</span>
                        <h6>
                            ~ {{number_format($object->final_amount,2)}} {{optional($object->getCurrency)->code}}</h6>
                        <span
                            class="highlight">{{optional($object->getCurrency)->currency_name}}</span>
                    </div>
                </div>
                <div class="table-row">
                    <div class="item">
                        <span>@lang("Processing fee")</span>
                        <h6>{{number_format($object->processing_fee,2)}} {{optional($object->getCurrency)->code}}</h6>
                        <div
                            class="small">@lang("The processing fee is already included in the displayed amount you’ll get")
                        </div>
                    </div>
                    <div class="item">
                        <span>@lang("Exchange rate")</span>
                        <h6>1 {{optional($object->sendCurrency)->code}}
                            ~ {{number_format($object->exchange_rate,2)}} {{optional($object->getCurrency)->code}}</h6>
                    </div>
                </div>
                @if($object->parameters)
                    <div class="table-row">
                        <div class="item">
                            <span>@lang('Get Currency Method')</span>
                            <h6>{{optional($object->fiatSendGateway)->name}}</h6>
                        </div>
                        @foreach($object->parameters as $key => $param)
                            <div class="item">
                                <span>{{$param->field_label}}</span>
                                <h6>{{$param->field_value}}</h6>
                            </div>
                        @endforeach
                    </div>
                @endif
            </div>
        </div>
    </div>
</div>



