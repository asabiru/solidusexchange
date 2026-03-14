@extends($theme.'layouts.user')
@section('page_title',__('Exchange Details'))
@section('content')
    <div class="section dashboard">
        <div class="row">
            <div class="account-settings-profile-section">
                <div class="card">
                    <div class="card-body shadow">
                        <div class="d-flex justify-content-between align-items-center">
                            <h4 class="card-title">@lang("Exchange Details")</h4>

                            <div>
                                <a href="{{route('user.exchangeList')}}"
                                   class="cmn-btn3 me-2">
                                    <span><i class="fas fa-arrow-left"></i> @lang('Back')</span>
                                </a>
                            </div>
                        </div>
                        <hr>
                        <div class="p-4 card-body shadow">
                            <div class="row">
                                <div class="col-md-4 border-end" id="autoRate">
                                    <ul class="list-style-none ms-4">
                                        <li class="my-2 border-bottom pb-3">
                                            <span class="font-weight-medium "><i
                                                    class="fas fa-exchange-alt me-2 text-base"></i> @lang("Trade Information's"): <small
                                                    class="float-end">{!! $exchange->user_status !!} </small></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Trx ID") : <span
                                                    class="font-weight-medium">{{$exchange->utr}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Exchange Rate") : <span
                                                    class="font-weight-medium" id="exchangeRate">1 {{optional($exchange->sendCurrency)->code}}
                                                    {{$exchange->rate_type == 'floating' ? '~':'='}} {{rtrim(rtrim(getAmount($exchange->exchange_rate,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang('Exchange Type') : <span
                                                    class="font-weight-medium">{{ucfirst($exchange->rate_type)}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Service Fees') : <span
                                                    class="font-weight-bold"
                                                    id="serviceFee">{{rtrim(rtrim(getAmount($exchange->service_fee,8),0),'.')}} {{optional($exchange->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Network Fees') : <span
                                                    class="font-weight-bold"
                                                    id="networkFee">{{rtrim(rtrim(getAmount($exchange->network_fee,8),0),'.')}} {{optional($exchange->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                    </ul>
                                </div>


                                <div class="col-md-4 border-end" id="autoRate">
                                    <ul class="list-style-none ms-4">
                                        <li class="my-2 border-bottom pb-3">
                                            <span class="font-weight-medium "><i
                                                    class="far fa-coins me-2 text-base"></i> @lang("Currency Information's") <small
                                                    class="float-end">{{dateTime($exchange->created_at,basicControl()->date_time_format)}}</small></span>
                                        </li>

                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Currency') : <span
                                                    class="font-weight-bold">{{optional($exchange->sendCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receive Currency') : <span
                                                    class="font-weight-bold">{{optional($exchange->getCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Amount') : <span
                                                    class="font-weight-bold">{{rtrim(rtrim($exchange->send_amount,0),'.')}} {{optional($exchange->sendCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Get Amount') : <span
                                                    class="font-weight-bold"
                                                    id="receiveAmount">{{rtrim(rtrim(getAmount($exchange->get_amount,8),0),'.')}} {{optional($exchange->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receivable Amount') : <span
                                                    class="font-weight-bold text-danger"
                                                    id="payableAmount">{{rtrim(rtrim(getAmount($exchange->final_amount,8),0),'.')}} {{optional($exchange->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                    </ul>
                                </div>
                                <div class="col-md-4">
                                    <ul class="list-style-none ms-4">
                                        <li class="my-2 border-bottom pb-3">
                                            <span class="font-weight-medium "><i
                                                    class="fal fa-address-card me-2 text-base"></i> @lang("Address Information's") </span>
                                        </li>

                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Destination address') ({{optional($exchange->getCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyDestinationAddress()"
                                                   data-bs-toggle="tooltip"
                                                   data-bs-placement="top"
                                                   title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold"
                                                      id="destinationId">{{$exchange->destination_wallet}}</span>
                                            </span>
                                        </li>
                                        @if($exchange->refund_wallet)
                                            <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Refund address') ({{optional($exchange->sendCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyRefundAddress()" data-bs-toggle="tooltip"
                                                   data-bs-placement="top" title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold"
                                                      id="refundId">{{$exchange->refund_wallet}}</span>
                                            </span>
                                            </li>
                                        @endif
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Admin Receive address') ({{optional($exchange->sendCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyReceiveAddress()"
                                                   data-bs-toggle="tooltip"
                                                   data-bs-placement="top"
                                                   title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold"
                                                      id="receiveId">{{$exchange->admin_wallet}}</span>
                                            </span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection

@push('extra_scripts')
    <script>
        'use strict';

        var type = "{{$exchange->rate_type}}";
        var isSet = "{{$exchange->status}}";

        function getRate() {
            Notiflix.Block.dots('#autoRate', {
                backgroundColor: loaderColor,
            });
            axios.get("{{route('user.exchangeRateFloating',$exchange->utr)}}")
                .then(function (response) {
                    Notiflix.Block.remove('#autoRate');
                    let object = response.data;
                    showTrade(object);
                })
                .catch(function (error) {

                });
        }

        function showTrade(object) {

            $("#exchangeRate").html(`1 ${object.sendCurrencyCode} ~ ${parseFloat(object.exchange_rate).toFixed(8)} ${object.getCurrencyCode}`);
            $("#serviceFee").html(`${parseFloat(object.service_fee).toFixed(8)} ${object.getCurrencyCode}`)
            $("#networkFee").html(`${parseFloat(object.network_fee).toFixed(8)} ${object.getCurrencyCode}`)
            $("#receiveAmount").html(`${parseFloat(object.get_amount).toFixed(8)} ${object.getCurrencyCode}`)
            $("#payableAmount").html(`${parseFloat(object.final_amount).toFixed(8)} ${object.getCurrencyCode}`)
        }

        if (type == 'floating' && isSet == '2') {
            setInterval(getRate, 30000);
        }

        function copyDestinationAddress() {
            var textToCopy = document.getElementById('destinationId').innerText;
            copyExe(textToCopy);
        }

        function copyRefundAddress() {
            var textToCopy = document.getElementById('refundId').innerText;
            copyExe(textToCopy);
        }

        function copyReceiveAddress() {
            var textToCopy = document.getElementById('receiveId').innerText;
            copyExe(textToCopy);
        }

        function copyExe(textToCopy) {
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
