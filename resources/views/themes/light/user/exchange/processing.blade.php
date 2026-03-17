@extends($theme . 'layouts.calculation')
@section('title',trans('Processing'))
@section('content')
    <section class="calculator-details-section">
        <div class="container">
            <form action="{{route('exchangeProcessing',$exchangeRequest->utr)}}" method="POST">
                @csrf
                <div class="row g-xl-5 g-4">
                    @include($theme.'partials.exchange-module.exchange-leftbar',['progress' => '25','check' => 2])
                    <div class="col-lg-6 order-1 order-lg-2">
                        <div class="calculator-section">
                            <div class="calculator p25 mw-100">
                                <h3>@lang("Exchange Crypto")</h3>
                                <div class="row">
                                    <div class="col-12" id="calLoader">
                                        <div class="input-amount-box" id="inputAmountBox">
                                            <span class="linear-gradient"></span>
                                            <div class="input-amount-wrapper">
                                                <label class="form-label mb-2">@lang('You send')</label>
                                                <div class="input-amount-box-inner"
                                                     id="inputAmountBoxInner">
                                                    <a href="#" class="icon-area" data-bs-toggle="modal"
                                                       data-bs-target="#calculator-modal">
                                                        <img class="img-flag" id="showSendImage"
                                                             src=""
                                                             alt="...">
                                                    </a>
                                                    <div class="text-area w-100">
                                                        <div
                                                            class="d-flex gap-3 justify-content-between">
                                                            <a href="#"
                                                               class="d-flex align-items-center gap-1"
                                                               data-bs-toggle="modal"
                                                               data-bs-target="#calculator-modal">
                                                                <div class="title" id="showSendCode"></div>
                                                                <i class="fa-regular fa-angle-down"></i>
                                                            </a>
                                                            <input type="text"
                                                                   name="exchangeSendAmount" id="send" placeholder="@lang('You send')"
                                                                   onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                                                            <input type="hidden" name="exchangeSendCurrency" value="">
                                                        </div>
                                                        <div class="d-flex justify-content-between">
                                                            <div class="sub-title" id="showSendName"></div>
                                                            <div class="fw-500 text-danger" id="exchangeMessage"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="swap-area">
                                            <div class="swap-icon" id="swapBtn">
                                                <i class="fa-regular fa-arrow-up-arrow-down"></i>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-12">
                                        <div id="autoRate">
                                            <div class="input-amount-box" id="inputAmountBox2">
                                                <span class="linear-gradient"></span>
                                                <div class="input-amount-wrapper">
                                                    <label class="form-label mb-2">@lang("You get")</label>
                                                    <div class="input-amount-box-inner"
                                                         id="inputAmountBoxInner2">
                                                        <a href="#" class="icon-area" data-bs-toggle="modal"
                                                           data-bs-target="#calculator-modal2">
                                                            <img class="img-flag" id="showGetImage"
                                                                 src=""
                                                                 alt="...">
                                                        </a>
                                                        <div class="text-area w-100">
                                                            <div
                                                                class="d-flex gap-3 justify-content-between">
                                                                <a href="#"
                                                                   class="d-flex align-items-center gap-1"
                                                                   data-bs-toggle="modal"
                                                                   data-bs-target="#calculator-modal2">
                                                                    <div class="title" id="showGetCode"></div>
                                                                    <i class="fa-regular fa-angle-down"></i>
                                                                </a>
                                                                <input type="text"
                                                                       name="exchangeGetAmount" id="receive" placeholder="@lang('You get')"
                                                                       onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                                                                <input type="hidden" name="exchangeGetCurrency" value="">
                                                            </div>
                                                            <div class="d-flex justify-content-between">
                                                                <div class="sub-title" id="showGetName"></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="rate-btn-area">
                            <div id="autoRate">
                                <input type="radio" name="rate_type" value="floating" class="btn-check"
                                       id="Floating-rate" autocomplete="off"
                                       {{$exchangeRequest->rate_type !== 'fixed' ? 'checked' : ''}}>
                                <label class="btn rate-btn" for="Floating-rate"><span><i
                                            class="fa-light fa-unlock"></i>@lang("Floating rate")</span>
                                    <span class="showFloatingRate"></span></label>
                            </div>
                            <div id="autoRate">
                                <input type="radio" name="rate_type" value="fixed" class="btn-check" id="Fixed-rate"
                                       autocomplete="off" {{$exchangeRequest->rate_type === 'fixed' ? 'checked' : ''}}>
                                <label class="btn rate-btn" for="Fixed-rate"><span><i class="fa-light fa-lock"></i>@lang("Fixed rate")</span>
                                    <span class="showFixedRate"></span></label>
                            </div>
                        </div>
                        <div class="notice-area">
                            <div class="icon-area"><i class="fa-solid fa-circle-info"></i></div>
                            <small
                                class="content-area"
                                id="messageArea">@lang("The floating rate is subject to change based on market conditions, leading to the possibility of receiving more or less cryptocurrency than initially anticipated.")</small>
                        </div>
                        <div class="wallet-address-section">
                            <div class="item">
                                <h4>@lang("Destination wallet address")</h4>
                                <div class="form-floating">
                                    <input type="text" name="destination_wallet" class="form-control"
                                           id="floatingInputValue" value="{{old('destination_wallet')}}"
                                           placeholder="" required>
                                    <label for="floatingInputValue"
                                           id="destinationMsg">@lang('Enter your') {{optional($exchangeRequest->getCurrency)->currency_name}} @lang("recipient address")</label>
                                </div>
                            </div>
                            <div class="check">
                                <input type="checkbox" class="form-check-input" id="exampleCheck1" required>
                                <label class="form-check-label"
                                       for="exampleCheck1">@lang("I agree with Terms of Use and Privacy Policy")</label>
                            </div>
                            <div class="btn-are">
                                <button type="submit" class="cmn-btn w-100" id="submitBtn">@lang("Next step")</button>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-3 order-3 order-lg-3">
                        <div class="transaction-summery" id="autoRate">
                            <h4 class="title">@lang("Trade details")</h4>
                            <div class="transaction-item-container">
                                <div class="item">
                                    <span>@lang("You send")</span>
                                    <h6 id="showSendAmount"></h6>
                                </div>
                                <div class="item">
                                    <span>@lang("Exchange rate")</span>
                                    <h6 id="showExchangeRate"></h6>
                                </div>
                                <div class="item">
                                    <span id="showServiceType"></span>
                                    <h6 id="showServiceFee"></h6>
                                </div>
                                <div class="item">
                                    <span id="showNetworkType"></span>
                                    <h6 id="showNetworkFee"></h6>
                                </div>

                                <div class="item">
                                    <span>@lang("You get")</span>
                                    <h6 class="showFinalAmount"></h6>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    </section>
    @include($theme.'partials.modal')
@endsection
@push('extra_scripts')
    <script>
        "use strict";
        Notiflix.Block.dots('#calLoader', {
            backgroundColor: loaderColor,
        });
        var initialSendAmount = "{{$exchangeRequest->send_amount}}";
        var initialSendCurrency = "{{$exchangeRequest->send_currency_id}}";
        var initialGetCurrency = "{{$exchangeRequest->get_currency_id}}";
        var intervalStatus = "{{basicControl()->floating_rate_update_status}}";
        var intervalTime = "{{basicControl()->floating_rate_update_time}}";
        var isFixed = "{{ $exchangeRequest->rate_type }}" === 'fixed';
        var finalAmount = 0;
        var activeSendCurrency = @json($exchangeRequest->sendCurrency);
        var activeGetCurrency = @json($exchangeRequest->getCurrency);
        var quoteTimer = null;
        getExchangeCurrency();
        setSendCurrency(activeSendCurrency);
        setGetCurrency(activeGetCurrency);

        $(document).on("keyup", "input[name='exchangeSendAmount']", function () {
            requestQuoteDebounced($("input[name='exchangeSendAmount']").val());
        });


        $(document).on("keyup", "input[name='exchangeGetAmount']", function () {
            if ($("input[name='exchangeGetAmount']").prop('readonly')) {
                return;
            }

            let getAmount = $("input[name='exchangeGetAmount']").val();
            sendCalculation(getAmount);
        });


        $(document).on("click", "#swapBtn", function () {
            let previousSendCurrency = activeSendCurrency;
            let sendAmount = $("input[name='exchangeGetAmount']").val() || $("input[name='exchangeSendAmount']").val();

            activeSendCurrency = activeGetCurrency;
            activeGetCurrency = previousSendCurrency;

            setSendCurrency(activeSendCurrency);
            setGetCurrency(activeGetCurrency);
            showSend(window.availableSendCurrencies || []);
            showGet(window.availableGetCurrencies || []);

            $("input[name='exchangeSendAmount']").val(formatAmount(sendAmount));
            requestQuoteDebounced(sendAmount, 0);
        });

        $(document).on("click", ".sendModal", function () {
            activeSendCurrency = $(this).data('res');
            setSendCurrency(activeSendCurrency);
            let sendAmount = $("input[name='exchangeSendAmount']").val();
            requestQuoteDebounced(sendAmount, 0);
            $('#calculator-modal').modal('hide');

            $('.sendModal .right-side').empty();
            $(this).find('.right-side').html('');
            $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
        });

        $(document).on("click", ".getModal", function () {
            activeGetCurrency = $(this).data('res');
            setGetCurrency(activeGetCurrency);
            let sendAmount = $("input[name='exchangeSendAmount']").val();
            requestQuoteDebounced(sendAmount, 0);
            $('#calculator-modal2').modal('hide');

            $('.getModal .right-side').empty();
            $(this).find('.right-side').html('');
            $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
        });

        function getCalculation(sendAmount) {
            $("#exchangeMessage").text('');
            $("#submitBtn").attr('disabled', false);

            let sendMinLimit = activeSendCurrency.min_send;
            let sendMaxLimit = activeSendCurrency.max_send;
            let sendCode = activeSendCurrency.code;

            if (!sendAmount || parseFloat(sendAmount) <= 0) {
                $("input[name='exchangeGetAmount']").val('');
                clearTradeDetails();
                return;
            }

            if (parseFloat(sendAmount) < parseFloat(sendMinLimit)) {
                $("#submitBtn").attr('disabled', true);
                $("#exchangeMessage").text(`Min is ${sendMinLimit} ${sendCode}`);
                return;
            }

            if (parseFloat(sendAmount) > parseFloat(sendMaxLimit)) {
                $("#submitBtn").attr('disabled', true);
                $("#exchangeMessage").text(`Max is ${sendMaxLimit} ${sendCode}`);
                return;
            }

            requestQuote(sendAmount);
        }

        function sendCalculation(getAmount) {
            $("#exchangeMessage").text('');
            $("#submitBtn").attr('disabled', false);

            let sendMinLimit = activeSendCurrency.min_send;
            let sendMaxLimit = activeSendCurrency.max_send;
            let sendCode = activeSendCurrency.code;
            let sendUsdRate = activeSendCurrency.usd_rate
            let getUsdRate = activeGetCurrency.usd_rate;
            let sendAmount = sendAmountCal(getAmount, sendUsdRate, getUsdRate);
            $("input[name='exchangeSendAmount']").val(sendAmount);
            getCalculation(sendAmount);
        }

        function getAmountCal(sendAmount, sendUsdRate, getUsdRate) {
            return (sendAmount * sendUsdRate / getUsdRate).toFixed(8);
        }

        function sendAmountCal(getAmount, sendUsdRate, getUsdRate) {
            return (getAmount * getUsdRate / sendUsdRate).toFixed(8);
        }

        function getExchangeCurrency(route = "{{route("getExchangeCurrency")}}") {
            axios.get(route)
                .then(function (response) {
                    Notiflix.Block.remove('#calLoader');
                    window.availableSendCurrencies = response.data.sendCurrencies;
                    window.availableGetCurrencies = response.data.getCurrencies;
                    showSend(response.data.sendCurrencies);
                    showGet(response.data.getCurrencies);
                    $("input[name='exchangeSendAmount']").val(formatAmount(initialSendAmount));
                    requestQuoteDebounced(initialSendAmount, 0);
                })
                .catch(function (error) {

                });
        }

        function showSend(currencies) {
            $('#show-send').html(``);
            let options = "";
            for (let i = 0; i < currencies.length; i++) {
                let isChecked = (currencies[i].id === activeSendCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
                options += `<div class="item sendModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${currencies[i].image_path}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${currencies[i].code}</div>
                                <div class="sub-title">${currencies[i].name}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
            }
            $('#show-send').append(options);
        }

        function showGet(currencies) {
            $('#show-get').html(``);
            let options = "";
            for (let i = 0; i < currencies.length; i++) {
                let isChecked = (currencies[i].id === activeGetCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
                options += `<div class="item getModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${currencies[i].image_path}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${currencies[i].code}</div>
                                <div class="sub-title">${currencies[i].name}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
            }
            $('#show-get').append(options);
        }

        function setSendCurrency(currency) {
            $('#showSendImage').attr('src', currency.image_path);
            $('#showSendCode').text(currency.code);
            $('#showSendName').text(currency.name);

            $('input[name="exchangeSendCurrency"]').val(currency.id);
        }

        function setGetCurrency(currency) {
            $('#showGetImage').attr('src', currency.image_path);
            $('#showGetCode').text(currency.code);
            $('#showGetName').text(currency.name);

            $('input[name="exchangeGetCurrency"]').val(currency.id);
        }

        $(document).on("click", "#Floating-rate", function () {
            isFixed = false;
            showFinalRate();
            $("#messageArea").text(`The floating rate is subject to change based on market conditions, leading to the possibility of receiving more or less cryptocurrency than initially anticipated.`);
        });
        $(document).on("click", "#Fixed-rate", function () {
            isFixed = true;
            showFinalRate();
            $("#messageArea").text(`With the fixed rate, you will receive the exact amount of crypto you see on this screen.`);
        });

        function tradeDetails() {
            if (isFixed) {
                return;
            }

            requestQuote($("input[name='exchangeSendAmount']").val());
        }

        function tradeShow(quote) {
            let sendAmount = parseFloat(quote.sendAmount || 0).toFixed(8);
            let getAmount = parseFloat(quote.getAmount || 0).toFixed(8);
            let exchangeRate = parseFloat(quote.exchangeRate || 0).toFixed(8);
            let serviceFee = parseFloat(quote.serviceFee || 0).toFixed(8);
            let networkFee = parseFloat(quote.networkFee || 0).toFixed(8);
            let serviceFeeType = quote.serviceFeeType;
            let networkFeeType = quote.networkFeeType;
            let sendCurrencyCode = quote.sendCurrencyCode;
            let getCurrencyCode = quote.getCurrencyCode;

            $("#showSendAmount").text(`${sendAmount} ${sendCurrencyCode}`);
            $("#showExchangeRate").text(`1 ${sendCurrencyCode} ~ ${exchangeRate} ${getCurrencyCode}`);
            if (serviceFeeType === 'percent') {
                let stringServiceFee = parseFloat(serviceFee).toString();
                $("#showServiceType").text(`Service fee ${stringServiceFee}%`);
                serviceFee = ((parseFloat(getAmount) * parseFloat(serviceFee)) / 100).toFixed(8);
            } else {
                $("#showServiceType").text(`Service fee`);
            }
            $("#showServiceFee").text(`${serviceFee} ${getCurrencyCode}`);

            if (networkFeeType === 'percent') {
                let stringNetworkFee = parseFloat(networkFee).toString();
                $("#showNetworkType").text(`Network fee ${stringNetworkFee}%`);
                networkFee = ((parseFloat(getAmount) * parseFloat(networkFee)) / 100).toFixed(8);
            } else {
                $("#showNetworkType").text(`Network fee`);
            }
            $("#showNetworkFee").text(`${networkFee} ${getCurrencyCode}`);

            finalAmount = parseFloat(quote.finalAmount || 0).toFixed(8);

            $(".showFloatingRate").text(`~ ${finalAmount} ${getCurrencyCode}`);
            $(".showFixedRate").text(`${finalAmount} ${getCurrencyCode}`);
            showFinalRate();
        }

        function showFinalRate() {
            let getCurrencyCode = activeGetCurrency.code;
            if (isFixed) {
                $(".showFinalAmount").text(`${finalAmount} ${getCurrencyCode}`);
            } else {
                $(".showFinalAmount").text(`~ ${finalAmount} ${getCurrencyCode}`);
            }
        }

        function requestQuoteDebounced(sendAmount, delay = 250) {
            clearTimeout(quoteTimer);
            quoteTimer = setTimeout(function () {
                getCalculation(sendAmount);
            }, delay);
        }

        function requestQuote(sendAmount) {
            Notiflix.Block.dots('#autoRate', {
                backgroundColor: loaderColor,
            });

            axios.post("{{route('exchangeAutoRate')}}", {
                sendAmount: sendAmount,
                sendCurrency: activeSendCurrency.id,
                getCurrency: activeGetCurrency.id,
            })
                .then(function (response) {
                    Notiflix.Block.remove('#autoRate');
                    applyQuote(response.data.quote);
                })
                .catch(function (error) {
                    Notiflix.Block.remove('#autoRate');
                    $("#submitBtn").attr('disabled', true);
                    $("#exchangeMessage").text(error.response?.data?.message || 'Unable to refresh exchange rate');
                });
        }

        function applyQuote(quote) {
            $("#exchangeMessage").text('');
            $("#submitBtn").attr('disabled', false);
            $("input[name='exchangeSendAmount']").val(formatAmount(quote.sendAmount));
            $("input[name='exchangeGetAmount']").val(formatAmount(quote.getAmount));
            $("input[name='exchangeGetAmount']").prop('readonly', !!quote.receiveReadonly);
            tradeShow(quote);
        }

        function clearTradeDetails() {
            $("#showSendAmount").text('');
            $("#showExchangeRate").text('');
            $("#showServiceType").text('');
            $("#showServiceFee").text('');
            $("#showNetworkType").text('');
            $("#showNetworkFee").text('');
            $(".showFloatingRate").text('');
            $(".showFixedRate").text('');
            $(".showFinalAmount").text('');
        }

        function formatAmount(amount) {
            let numericAmount = parseFloat(amount);
            if (Number.isNaN(numericAmount)) {
                return '';
            }

            return numericAmount.toFixed(8);
        }

        if (parseInt(intervalStatus) === 1) {
            setInterval(tradeDetails, intervalTime);
        }
    </script>
@endpush
