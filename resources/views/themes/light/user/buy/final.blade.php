@extends($theme . 'layouts.calculation')
@section('title',trans('Await completion'))
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <div class="row g-xl-5 g-4">
                @include($theme.'partials.exchange-module.exchange-leftbar',['progress' => '75','check' => 4])
                <div class="col-lg-6 order-1 order-lg-2">
                    <div class="checkout-section">
                        <div class="checkout-header">
                            <h4 class="mb-0">@lang("Awaiting complete")</h4>
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
                        <div class="alert-message mt-20">
                            <i class="fa-solid fa-circle-info fa-rotate-180"></i>
                            <span>@lang("Please wait for a moment. "){{basicControl()->site_title}} @lang("is actively processing your trade. You can track the progress of your trade from this location.") <a
                                    href="{{route('tracking')}}" target="_blank"
                                    class="text-primary">@lang("click here")</a></span>
                        </div>
                    </div>
                </div>
                <div class="col-lg-3 order-3 order-lg-3">
                    <div class="deadline-timer-section">
                        <h6 id="tranId">{{$buyRequest->utr}} <i class="fa-regular fa-copy"
                                                                onclick="copyTranId()"></i></h6>
                        <span>@lang("Transaction ID")</span>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
@push('extra_scripts')
    <script>
        'use strict';
        var route = "{{route('tracking').'?trx_id='.$buyRequest->utr}}";

        function getStatus() {
            axios.get("{{route('buyGetStatus',$buyRequest->utr)}}")
                .then(function (response) {
                    if (parseInt(response.data.buyRequest.status) === 3 || parseInt(response.data.buyRequest.status) === 5 || parseInt(response.data.buyRequest.status) === 6) {
                        window.location.href = route;
                    }
                    if (response.data.redirect === true) {
                        window.location.href = response.data.route;
                    }
                })
                .catch(function (error) {

                });
        }

        setInterval(getStatus, 10000);

        function copyTranId() {
            var textToCopy = document.getElementById('tranId').innerText;
            var tempTextArea = document.createElement('textarea');
            tempTextArea.value = textToCopy;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextArea);
            Notiflix.Notify.success('Text copied to clipboard: ' + textToCopy);
        }
    </script>

@endpush
