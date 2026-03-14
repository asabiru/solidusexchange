@extends($theme . 'layouts.calculation')
@section('title',trans('Initiate Payment'))
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <form action="{{route('buyInitPayment',$buyRequest->utr)}}" method="POST">
                @csrf
                <div class="row g-xl-5 g-4">
                    @include($theme.'user.buy.buy-leftbar',['progress' => '50','check' => 3])
                    <div class="col-lg-6 order-1 order-lg-2">
                        <div class="transaction-card">
                            <h3 class="title">@lang("Please Make a Payment")</h3>
                            <div class="transaction-table">
                                <div class="table-row">
                                    <div class="item"><span>@lang("Payment Method")</span></div>
                                    <div class="item">
                                        <div class="payment-method-section">
                                            <select class="cmn-select2-image" name="payment_method" id="paymentMethod">
                                                @foreach($gateways as $gateway)
                                                    <option value="{{$gateway->id}}"
                                                            data-img="{{getFile($gateway->driver,$gateway->image)}}">{{$gateway->name}}</option>
                                                @endforeach
                                            </select>
                                            @error('payment_method')
                                            <span class="text-danger">{{$message}}</span>
                                            @enderror
                                        </div>
                                    </div>
                                </div>
                                <div class="table-row mt-3">
                                    <div class="item"><span>@lang("Payment Currency")</span></div>
                                    <div class="item">
                                        <div class="payment-method-section">
                                            <select class="cmn-select2" name="supported_currency"
                                                    id="supported_currency">

                                            </select>
                                        </div>
                                        @error('supported_currency')
                                        <span class="text-danger">{{$message}}</span>
                                        @enderror
                                    </div>
                                </div>
                                <div class="table-row">
                                    <div class="item"><span>@lang("Gateway Charge")</span></div>
                                    <div class="item">
                                        <h6 class="text-danger" id="gatewayCharge">0</h6>
                                    </div>
                                </div>
                                <div class="table-row">
                                    <div class="item"><span>@lang("Exchange Rate")</span></div>
                                    <div class="item">
                                        <h6 id="exchangeId">0</h6>
                                    </div>
                                </div>
                                <div class="table-row">
                                    <div class="item"><span>@lang("Minimum Limit")</span></div>
                                    <div class="item">
                                        <h6 id="minLimit">0</h6>
                                    </div>
                                </div>
                                <div class="table-row">
                                    <div class="item"><span>@lang("Maximum Limit")</span></div>
                                    <div class="item">
                                        <h6 id="maxLimit">0</h6>
                                    </div>
                                </div>
                                <div class="table-row">
                                    <div class="item"><span>@lang("You Will Pay")</span></div>
                                    <div class="item">
                                        <h6 id="willPay">0</h6>
                                    </div>
                                </div>
                                <div class="alert-message mt-20 d-none" id="msgShow">
                                    <i class="fa-solid fa-circle-info fa-rotate-180"></i>
                                    <span>@lang('Your payable amount is not required to fall within the minimum and maximum limits.')</span>
                                </div>
                                <button type="submit" class="cmn-btn w-100"
                                        id="submitBtn">@lang("Confirm & continue")</button>
                            </div>
                        </div>
                    </div>

                    <div class="col-lg-3 order-3 order-lg-3">
                        <div class="deadline-timer-section">
                            <div class="countdown-area">
                                <h6><i class="fa-light fa-clock"></i></h6>
                                <h6 id="countdown1"></h6>
                            </div>
                            <span>@lang("Time left to send") {{number_format($buyRequest->send_amount,2)}} {{optional($buyRequest->sendCurrency)->code}}</span>
                            <hr>
                            <h6 id="tranId">{{$buyRequest->utr}} <i class="fa-regular fa-copy"
                                                                    onclick="copyTranId()"></i></h6>
                            <span>@lang("Transaction ID")</span>
                        </div>
                        <div class="transaction-summery">
                            <h4 class="title">@lang("Trade details")</h4>
                            <div class="transaction-item-container">
                                <div class="item">
                                    <span>@lang("You send")</span>
                                    <h6>{{number_format($buyRequest->send_amount,2)}} {{optional($buyRequest->sendCurrency)->code}}</h6>
                                </div>
                                <div class="item">
                                    <span>@lang("Exchange rate")</span>
                                    <h6>
                                        1 {{optional($buyRequest->getCurrency)->code}}
                                        ~ {{$buyRequest->show_exchange_rate}} {{optional($buyRequest->sendCurrency)->code}}</h6>
                                </div>
                                <div class="item">
                                    <span>@lang("Service fee") {{rtrim(rtrim(optional($buyRequest->getCurrency)->service_fee, 0), '.')}}{{optional($buyRequest->getCurrency)->service_fee_type == 'percent' ?'%':''}}</span>
                                    <h6>{{rtrim(rtrim($buyRequest->service_fee, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                </div>
                                <div class="item">
                                    <span>@lang("Network fee") {{rtrim(rtrim(optional($buyRequest->getCurrency)->network_fee, 0), '.')}}{{optional($buyRequest->getCurrency)->network_fee_type == 'percent' ?'%':''}}</span>
                                    <h6>{{rtrim(rtrim($buyRequest->network_fee, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                </div>

                                <div class="item">
                                    <span>@lang("You get")</span>
                                    <h6>
                                        ~ {{rtrim(rtrim($buyRequest->final_amount, 0), '.')}} {{optional($buyRequest->getCurrency)->code}}</h6>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    </section>
    <input type="hidden" id="amount" value="{{$buyRequest->send_amount * optional($buyRequest->sendCurrency)->rate}}">
@endsection

@push('js-lib')
    <script src="{{asset($themeTrue.'js/jquery.countdown.min.js')}}"></script>
    <script src="{{asset($themeTrue.'js/moment.min.js')}}"></script>
    <script src="{{asset($themeTrue.'js/moment-timezone-with-data.min.js')}}"></script>
@endpush

@push('extra_scripts')
    <script>
        'use strict';
        let amountField = $('#amount');
        $('#submitBtn').attr('disabled', true);
        let selectedGateway = "{{$gateways[0]->id}}";
        supportCurrency(selectedGateway);

        function clearMessage(fieldId) {
            $(fieldId).removeClass('is-valid')
            $(fieldId).removeClass('is-invalid')
            $(fieldId).closest('div').find(".invalid-feedback").html('');
            $(fieldId).closest('div').find(".is-valid").html('');
        }

        $(document).on('change', '#paymentMethod', function () {
            selectedGateway = $(this).val();
            supportCurrency(selectedGateway);
        });

        function supportCurrency(selectedGateway) {
            if (!selectedGateway) {
                console.error('Selected Gateway is undefined or null.');
                return;
            }

            $('#supported_currency').empty();

            $.ajaxSetup({
                headers: {
                    'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
                }
            });

            $.ajax({
                url: "{{ route('supported.currency') }}",
                data: {gateway: selectedGateway},
                type: "GET",
                success: function (data) {
                    
                    if (data === "") {
                        let markup = `<option value="USD">USD</option>`;
                        $('#supported_currency').append(markup);
                    }

                    let markup = '<option value="">Selected Currency</option>';
                    $('#supported_currency').append(markup);

                    $(data).each(function (index, value) {
                        let markup = `<option value="${value}">${value}</option>`;
                        $('#supported_currency').append(markup);
                    });
                },
                error: function (error) {
                    console.error('AJAX Error:', error);
                }
            });
        }

        $(document).on("change", "#supported_currency", function () {
            let amount = amountField.val();
            let selectedCurrency = $('#supported_currency').val();
            let currency_type = 1;
            if (!isNaN(amount) && amount > 0) {
                let fraction = amount.split('.')[1];
                let limit = currency_type == 0 ? 8 : 2;
                if (fraction && fraction.length > limit) {
                    amount = (Math.floor(amount * Math.pow(10, limit)) / Math.pow(10, limit)).toFixed(limit);
                    amountField.val(amount);
                }

                checkAmount(amount, selectedCurrency, selectedGateway)

                if (selectedCurrency != null) {

                }
            } else {
                clearMessage(amountField)
            }
        });

        function checkAmount(amount, selectedCurrency, selectGateway) {

            $.ajax({
                method: "GET",
                url: "{{ route('deposit.checkAmount') }}",
                dataType: "json",
                data: {
                    'amount': amount,
                    'selected_currency': selectedCurrency,
                    'select_gateway': selectGateway,
                }
            }).done(function (response) {
                let amountField = $('#amount');
                
                if (response.status) {
                    clearMessage(amountField);
                    $('#msgShow').addClass('d-none');
                    $('#submitBtn').attr('disabled', false);
                    showCharge(response);
                } else {
                    $('#msgShow').removeClass('d-none');
                    $('#submitBtn').attr('disabled', true);
                    showCharge(response)
                    clearMessage(amountField);
                }
            });
        }

        function showCharge(response) {
            $('#gatewayCharge').text(`${response.charge} ${response.currency}`);
            $('#exchangeId').html(`1 ${response.base_currency} <i class="fas fa-exchange-alt"></i> ${response.conversion_rate} ${response.currency}`);
            $('#minLimit').text(`${response.min_limit} ${response.currency}`);
            $('#maxLimit').text(`${response.max_limit} ${response.currency}`);
            $('#willPay').text(`${response.payable_amount} ${response.currency}`);
        }

        var expireTime = moment.tz("{{ $buyRequest->expire_time }}", "{{ config('app.timezone') }}");
        $('#countdown1').countdown(expireTime.toDate(), function (event) { // Year/month/date
            $(this).html(event.strftime('<div class="single-coundown"><h5>%H :</h5></div><div class="single-coundown"><h5>%M :</h5></div><div class="single-coundown"><h5>%S</h5></div>'));
        });

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
