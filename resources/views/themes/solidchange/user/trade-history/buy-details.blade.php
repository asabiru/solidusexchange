@extends($theme.'layouts.user')
@section('page_title',__('Crypto Buy Details'))
@section('content')
    <div class="section dashboard">
        <div class="row">
            <div class="account-settings-profile-section">
                <div class="card">
                    <div class="card-body shadow">
                        <div class="d-flex justify-content-between align-items-center">
                            <h4 class="card-title">@lang("Crypto Buy Details")</h4>

                            <div>
                                <a href="{{route('user.buyList')}}"
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
                                                    class="float-end">{!! $buy->user_status !!} </small></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Trx ID") : <span
                                                    class="font-weight-medium">{{$buy->utr}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Exchange Rate") : <span
                                                    class="font-weight-medium" id="exchangeRate">1 {{optional($buy->getCurrency)->code}}
                                                ~ {{$buy->show_exchange_rate}} {{optional($buy->sendCurrency)->code}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Service Fees') : <span
                                                    class="font-weight-bold"
                                                    id="serviceFee">{{rtrim(rtrim(getAmount($buy->service_fee,8),0),'.')}} {{optional($buy->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Network Fees') : <span
                                                    class="font-weight-bold"
                                                    id="networkFee">{{rtrim(rtrim(getAmount($buy->network_fee,8),0),'.')}} {{optional($buy->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Fiat Send Method') : <span
                                                    class="font-weight-bold">{{optional($buy->gateway)->name}}</span>
                                            </span>
                                        </li>
                                    </ul>
                                </div>


                                <div class="col-md-4 border-end" id="autoRate">
                                    <ul class="list-style-none ms-4">
                                        <li class="my-2 border-bottom pb-3">
                                            <span class="font-weight-medium "><i
                                                    class="far fa-coins me-2 text-base"></i> @lang("Currency Information's") <small
                                                    class="float-end">{{dateTime($buy->created_at,basicControl()->date_time_format)}}</small></span>
                                        </li>

                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Currency') : <span
                                                    class="font-weight-bold">{{optional($buy->sendCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receive Currency') : <span
                                                    class="font-weight-bold">{{optional($buy->getCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Amount') : <span
                                                    class="font-weight-bold">{{number_format($buy->send_amount,2)}} {{optional($buy->sendCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Get Amount') : <span
                                                    class="font-weight-bold"
                                                    id="receiveAmount">{{rtrim(rtrim(getAmount($buy->get_amount,8),0),'.')}} {{optional($buy->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receivable Amount') : <span
                                                    class="font-weight-bold text-danger"
                                                    id="payableAmount">{{rtrim(rtrim(getAmount($buy->final_amount,8),0),'.')}} {{optional($buy->getCurrency)->code}}
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
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Destination address') ({{optional($buy->getCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyDestinationAddress()"
                                                   data-bs-toggle="tooltip"
                                                   data-bs-placement="top"
                                                   title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold" id="destinationId">{{$buy->destination_wallet}}</span>
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

        function copyDestinationAddress() {
            var textToCopy = document.getElementById('destinationId').innerText;
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
