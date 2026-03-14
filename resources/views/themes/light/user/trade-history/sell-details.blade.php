@extends($theme.'layouts.user')
@section('page_title',__('Crypto Sell Details'))
@section('content')
    <div class="section dashboard">
        <div class="row">
            <div class="account-settings-profile-section">
                <div class="card">
                    <div class="card-body shadow">
                        <div class="d-flex justify-content-between align-items-center">
                            <h4 class="card-title">@lang("Crypto Sell Details")</h4>

                            <div>
                                <a href="{{route('user.sellList')}}"
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
                                                    class="float-end">{!! $sell->user_status !!} </small></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Trx ID") : <span
                                                    class="font-weight-medium">{{$sell->utr}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span class="font-weight-bold"><i
                                                    class="fas fa-check-circle me-2 text-base"></i> @lang("Exchange Rate") : <span
                                                    class="font-weight-medium" id="exchangeRate">1 {{optional($sell->sendCurrency)->code}}
                                                ~ {{number_format($sell->exchange_rate,2)}} {{optional($sell->getCurrency)->code}}</span></span>
                                        </li>

                                        <li class="my-3">
                                            <span><i class="fas fa-check-circle me-2 text-base"></i> @lang('Processing Fees') : <span
                                                    class="font-weight-bold"
                                                    id="serviceFee">{{number_format($sell->processing_fee,2)}} {{optional($sell->getCurrency)->code}}
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
                                                    class="float-end">{{dateTime($sell->created_at,basicControl()->date_time_format)}}</small></span>
                                        </li>

                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Currency') : <span
                                                    class="font-weight-bold">{{optional($sell->sendCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receive Currency') : <span
                                                    class="font-weight-bold">{{optional($sell->getCurrency)->currency_name}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send Amount') : <span
                                                    class="font-weight-bold">{{rtrim(rtrim(getAmount($sell->send_amount,8),0),'.')}} {{optional($sell->sendCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Get Amount') : <span
                                                    class="font-weight-bold"
                                                    id="receiveAmount">{{number_format($sell->get_amount,2)}} {{optional($sell->getCurrency)->code}}
                                                </span>
                                            </span>
                                        </li>
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Receivable Amount') : <span
                                                    class="font-weight-bold text-danger"
                                                    id="payableAmount">{{number_format($sell->final_amount,2)}} {{optional($sell->getCurrency)->code}}
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
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Send address') ({{optional($sell->sendCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyDestinationAddress()"
                                                   data-bs-toggle="tooltip"
                                                   data-bs-placement="top"
                                                   title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold"
                                                      id="destinationId">{{$sell->admin_wallet}}</span>
                                            </span>
                                        </li>
                                        @if($sell->refund_wallet)
                                            <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Refund Address') ({{optional($sell->sendCurrency)->code}}) :
                                                <a href="javascript:void(0)"
                                                   onclick="copyRefundAddress()" data-bs-toggle="tooltip"
                                                   data-bs-placement="top" title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a>
                                                <span class="font-weight-bold"
                                                      id="refundId">{{$sell->refund_wallet}}</span>
                                            </span>
                                            </li>
                                        @endif
                                        <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> @lang('Fiat Send Gateway') :<span
                                                    class="font-weight-bold"> {{optional($sell->fiatSendGateway)->name}}
                                                </span>
                                            </span>
                                        </li>
                                        @if($sell->parameters)
                                            @foreach($sell->parameters as $key => $param)
                                                <li class="my-3">
                                            <span>
												<i class="fas fa-check-circle me-2 text-base"></i> {{$param->field_label}} : <span
                                                    class="font-weight-bold">{{$param->field_value}}
                                                </span>
                                            </span>
                                                </li>
                                            @endforeach
                                        @endif
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

        function copyRefundAddress() {
            var textToCopy = document.getElementById('refundId').innerText;
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
