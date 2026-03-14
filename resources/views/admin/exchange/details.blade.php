@extends('admin.layouts.app')
@section('page_title',__('Exchange Details'))
@section('content')

    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Exchange')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        @if($exchange->status == 2)
            <div class="row mx-4">
                <div class="d-flex justify-content-end gap-2">
                    <button type="button" class="btn btn-soft-success" id="send" data-bs-target="#confirmation"
                            data-bs-toggle="modal"><i class="fas fa-paper-plane"></i> @lang("Send")
                    </button>
                    <button type="button" class="btn btn-soft-danger" id="cancel" data-bs-target="#confirmation"
                            data-bs-toggle="modal"><i class="fas fa-times"></i> @lang('Cancel')
                    </button>
                    @if($exchange->refund_wallet)
                        <button type="button" class="btn btn-soft-secondary" id="refund" data-bs-target="#confirmation"
                                data-bs-toggle="modal"><i
                                class="fas fa-arrow-rotate-left"></i> @lang('Refund')
                        </button>
                    @endif
                </div>
            </div>
        @endif

        <div class="content container-fluid">
            <div class="row justify-content-lg-center">
                <div class="col-lg-4">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang("Trade Information's")</h4>
                                <div>
                                    @if ($exchange->status == 2)
                                        <span class="legend-indicator bg-warning"></span>@lang("Awaiting Complete")
                                    @elseif ($exchange->status == 3)
                                        <span class="legend-indicator bg-success"></span>@lang("Trade Completed")
                                    @elseif ($exchange->status == 5)
                                        <span class="legend-indicator bg-danger"></span>@lang("Trade Cancel")
                                    @elseif ($exchange->status == 6)
                                        <span class="legend-indicator bg-primary"></span>@lang("Trade Refunded")
                                    @endif
                                </div>

                            </div>
                            <div class="card-body mt-2" id="autoRate">
                                <div class="col-sm">
                                    <!-- List Checked -->
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-primary">
                                        <li class="list-checked-item">@lang('Trx ID') : <strong
                                                class="text-dark font-weight-bold">{{$exchange->utr}}</strong></li>
                                        <li class="list-checked-item">@lang('Exchange Rate') : <strong
                                                class="text-dark font-weight-bold"
                                                id="exchangeRate">1 {{optional($exchange->sendCurrency)->code}}
                                                {{$exchange->rate_type == 'floating' ? '~':'='}} {{rtrim(rtrim(getAmount($exchange->exchange_rate,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Exchange Type') : <strong
                                                class="text-dark font-weight-bold">{{ucfirst($exchange->rate_type)}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Service Fees') : <strong
                                                class="text-dark font-weight-bold"
                                                id="serviceFee">{{rtrim(rtrim(getAmount($exchange->service_fee,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Network Fees') : <strong
                                                class="text-dark font-weight-bold"
                                                id="networkFee">{{rtrim(rtrim(getAmount($exchange->network_fee,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payment Method')
                                            : {{optional($exchange->cryptoMethod)->name}}
                                            @if(optional($exchange->cryptoMethod)->is_automatic)
                                                <span
                                                    class="badge bg-soft-success text-success">@lang("Automatic")</span>
                                            @else
                                                <span
                                                    class="badge bg-soft-secondary text-danger">@lang('manual')</span>
                                            @endif
                                        </li>
                                        <li class="list-checked-item">@lang('Requester') : <a
                                                href="{{$exchange->user_id ? route('admin.user.edit',$exchange->user_id) : 'javascript:void(0)'}}">{{optional($exchange->user)->fullname??'Anonymous'}}</a>
                                        </li>
                                    </ul>
                                    <!-- End List Checked -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang("Currency Information's")</h4>
                                <span>{{dateTime($exchange->created_at,basicControl()->date_time_format)}}</span>
                            </div>
                            <div class="card-body mt-2" id="autoRate">
                                <div class="col-sm">
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-secondary">
                                        <li class="list-checked-item">@lang('Send Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($exchange->sendCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($exchange->getCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Send Amount') : <strong
                                                class="text-dark font-weight-bold">{{rtrim(rtrim($exchange->send_amount,0),'.')}} {{optional($exchange->sendCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Amount') : <strong
                                                class="text-dark font-weight-bold"
                                                id="receiveAmount">{{rtrim(rtrim(getAmount($exchange->get_amount,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payable Amount') : <strong
                                                class="text-danger font-weight-bold"
                                                id="payableAmount">{{rtrim(rtrim(getAmount($exchange->final_amount,8),0),'.')}} {{optional($exchange->getCurrency)->code}}</strong>
                                        </li>
                                    </ul>
                                </div>
                                <div class="alert alert-soft-secondary" role="alert">
                                    @lang("The service fee and network fee are already included in the displayed payable amount.")
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang("Address Information's")</h4>
                            </div>
                            <div class="card-body mt-2">
                                <div class="col-sm">
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-warning">
                                        <li class="list-checked-item">@lang('Destination address')
                                            ({{optional($exchange->getCurrency)->code}}) :
                                            <a href="javascript:void(0)"
                                               onclick="copyDestinationAddress()"
                                               data-bs-toggle="tooltip"
                                               data-bs-placement="top"
                                               title="@lang("copy to clipboard")"><i
                                                    class="fas fa-copy"></i></a><strong
                                                class="text-dark font-weight-bold"
                                                id="destinationId">{{$exchange->destination_wallet}} </strong>
                                        </li>
                                        @if($exchange->refund_wallet)
                                            <li class="list-checked-item">@lang('Refund address')
                                                ({{optional($exchange->sendCurrency)->code}}): <a
                                                    href="javascript:void(0)"
                                                    onclick="copyRefundAddress()" data-bs-toggle="tooltip"
                                                    data-bs-placement="top" title="@lang("copy to clipboard")"><i
                                                        class="fas fa-copy"></i></a><strong
                                                    class="text-dark font-weight-bold"
                                                    id="refundId">{{$exchange->refund_wallet}}</strong>
                                            </li>
                                        @endif
                                        <li class="list-checked-item">@lang('Admin Receive address')
                                            ({{optional($exchange->sendCurrency)->code}}) :
                                            <a href="javascript:void(0)"
                                               onclick="copyReceiveAddress()"
                                               data-bs-toggle="tooltip"
                                               data-bs-placement="top"
                                               title="@lang("copy to clipboard")"><i
                                                    class="fas fa-copy"></i></a><strong
                                                class="text-dark font-weight-bold"
                                                id="receiveId">{{$exchange->admin_wallet}}</strong>
                                        </li>
                                    </ul>
                                </div>
                                <div class="alert alert-soft-secondary" role="alert">
                                    @lang("You can initiate a cryptocurrency refund by providing the designated refund address.")
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="confirmation" data-bs-backdrop="static" tabindex="-1" role="dialog"
         aria-labelledby="staticBackdropLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="deleteModalHeader">@lang('Confirmation!')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p id="deleteModalBody">@lang('Are you certain you want to proceed with the action?')</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <form action="" method="post" class="deleteModalRoute">
                        @csrf
                        @if(optional($exchange->cryptoMethod)->is_automatic)
                            <button type="submit" name="btnValue" class="btn btn-soft-primary"
                                    value="automatic">@lang('Send Automatic')</button>
                        @endif
                        <button type="submit" name="btnValue" class="btn btn-soft-success"
                                value="manual">@lang('Yes')</button>
                    </form>
                </div>
            </div>
        </div>
    </div>

@endsection


@push('css-lib')
@endpush

@push('js-lib')
@endpush

@push('script')
    <script>
        'use strict';
        var type = "{{$exchange->rate_type}}";
        var isSet = "{{$exchange->status}}";

        $(document).on("click", "#send", function () {
            let route = "{{route("admin.exchangeSend",$exchange->utr)}}";
            $("#deleteModalHeader").text(`Send Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with finalizing the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

        $(document).on("click", "#cancel", function () {
            let route = "{{route("admin.exchangeCancel",$exchange->utr)}}";
            $("#deleteModalHeader").text(`Cancel Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with cancel the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

        $(document).on("click", "#refund", function () {
            let route = "{{route("admin.exchangeRefund",$exchange->utr)}}";
            $("#deleteModalHeader").text(`Refund Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with refund the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

        function getRate() {
            Notiflix.Block.dots('#autoRate', {
                backgroundColor: loaderColor,
            });
            axios.get("{{route('admin.exchangeRateFloating',$exchange->utr)}}")
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
