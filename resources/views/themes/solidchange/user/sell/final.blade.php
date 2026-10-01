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
                                    <span>@lang("Exchange rate")</span>
                                    <h6>1 {{optional($sellRequest->sendCurrency)->code}}
                                        ~ {{number_format($sellRequest->exchange_rate,2)}} {{optional($sellRequest->getCurrency)->code}}</h6>
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
                        @if(isset($sbpPayment) && $sbpPayment)
                            <div class="sbp-qr-section mt-20" style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 12px; margin-top: 20px;">
                                <h5 style="margin-bottom: 12px;">Оплата через СБП</h5>
                                <p class="text-muted small">Отсканируйте QR-код в приложении банка для оплаты <strong>{{number_format($sbpPayment->amount, 2)}} ₽</strong></p>
                                <div style="display: inline-block; padding: 16px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                                    {!! $sbpPayment->qr_svg ?? '' !!}
                                </div>
                                <div class="mt-3">
                                    <small class="text-muted">QR действует до: {{optional($sbpPayment->expires_at)->format('H:i')}}</small>
                                </div>
                                <div id="sbp-status" class="mt-2">
                                    <span class="badge bg-warning text-dark">Ожидание оплаты...</span>
                                </div>
                            </div>
                        @endif
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
                        <h6 id="tranId">{{$sellRequest->utr}} <i class="fa-regular fa-copy"
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
        var route = "{{route('tracking').'?trx_id='.$sellRequest->utr}}";

        function getStatus() {
            axios.get("{{route('sellGetStatus',$sellRequest->utr)}}")
                .then(function (response) {
                    if (parseInt(response.data.selllRequest.status) === 3 || parseInt(response.data.selllRequest.status) === 5) {
                        window.location.href = route;
                    }
                })
                .catch(function (error) {

                });
        }

        setInterval(getStatus, 10000);

        @if(isset($sbpPayment) && $sbpPayment)
        // SBP payment status polling
        var sbpOrderId = "{{$sbpPayment->order_id}}";
        function checkSbpStatus() {
            axios.get("{{route('sbp.status', $sbpPayment->order_id ?? '')}}")
                .then(function(response) {
                    var status = response.data.status;
                    var el = document.getElementById('sbp-status');
                    if (status === 'paid' || status === 'confirmed') {
                        el.innerHTML = '<span class="badge bg-success text-white">Оплачено ✓</span>';
                        setTimeout(function() { getStatus(); }, 2000);
                    } else if (status === 'rejected') {
                        el.innerHTML = '<span class="badge bg-danger text-white">Отклонено</span>';
                    } else if (status === 'expired') {
                        el.innerHTML = '<span class="badge bg-secondary text-white">QR истёк</span>';
                    }
                })
                .catch(function(error) {});
        }
        setInterval(checkSbpStatus, 5000);
        @endif

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
