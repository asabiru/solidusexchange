@extends('admin.layouts.app')
@section('page_title',__('Buy Crypto Details'))
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
                                                           href="javascript:void(0);">@lang('Buy Crypto Details')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        @if($buy->status == 2)
            <div class="row mx-4">
                <div class="d-flex justify-content-end gap-2">
                    <button type="button" class="btn btn-soft-success" id="send" data-bs-target="#confirmation"
                            data-bs-toggle="modal"><i class="fas fa-paper-plane"></i> @lang("Send")
                    </button>
                    <button type="button" class="btn btn-soft-danger" id="cancel" data-bs-target="#confirmation"
                            data-bs-toggle="modal"><i class="fas fa-times"></i> @lang('Cancel')
                    </button>
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
                                    @if ($buy->status == 2)
                                        <span class="legend-indicator bg-warning"></span>@lang("Awaiting Complete")
                                    @elseif ($buy->status == 3)
                                        <span class="legend-indicator bg-success"></span>@lang("Trade Completed")
                                    @elseif ($buy->status == 5)
                                        <span class="legend-indicator bg-danger"></span>@lang("Trade Cancel")
                                    @endif
                                </div>

                            </div>
                            <div class="card-body mt-2">
                                <div class="col-sm">
                                    <!-- List Checked -->
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-primary">
                                        <li class="list-checked-item">@lang('Trx ID') : <strong
                                                class="text-dark font-weight-bold">{{$buy->utr}}</strong></li>
                                        <li class="list-checked-item">@lang('Exchange Rate') : <strong
                                                class="text-dark font-weight-bold">1 {{optional($buy->getCurrency)->code}}
                                                ~ {{$buy->show_exchange_rate}} {{optional($buy->sendCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Service Fees') : <strong
                                                class="text-dark font-weight-bold"
                                                id="serviceFee">{{rtrim(rtrim(getAmount($buy->service_fee,8),0),'.')}} {{optional($buy->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Network Fees') : <strong
                                                class="text-dark font-weight-bold"
                                                id="networkFee">{{rtrim(rtrim(getAmount($buy->network_fee,8),0),'.')}} {{optional($buy->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payment Method')
                                            : {{optional($buy->gateway)->name}}
                                            @if($buy->gateway_id < 999)
                                                <span
                                                    class="badge bg-soft-success text-success">@lang("Automatic")</span>
                                            @else
                                                <span
                                                    class="badge bg-soft-secondary text-danger">@lang('manual')</span>
                                            @endif
                                        </li>
                                        <li class="list-checked-item">@lang('Requester') : <a
                                                href="{{$buy->user_id ? route('admin.user.edit',$buy->user_id) : 'javascript:void(0)'}}">{{optional($buy->user)->fullname??'Anonymous'}}</a>
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
                                <span>{{dateTime($buy->created_at,basicControl()->date_time_format)}}</span>
                            </div>
                            <div class="card-body mt-2" id="autoRate">
                                <div class="col-sm">
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-secondary">
                                        <li class="list-checked-item">@lang('Send Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($buy->sendCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($buy->getCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Send Amount') : <strong
                                                class="text-dark font-weight-bold">{{number_format($buy->send_amount,2)}} {{optional($buy->sendCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Amount') : <strong
                                                class="text-dark font-weight-bold"
                                                id="receiveAmount">{{rtrim(rtrim(getAmount($buy->get_amount,8),0),'.')}} {{optional($buy->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payable Amount') : <strong
                                                class="text-danger font-weight-bold"
                                                id="payableAmount">{{rtrim(rtrim(getAmount($buy->final_amount,8),0),'.')}} {{optional($buy->getCurrency)->code}}</strong>
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
                                            ({{optional($buy->getCurrency)->code}}) :
                                            <a href="javascript:void(0)"
                                               onclick="copyDestinationAddress()"
                                               data-bs-toggle="tooltip"
                                               data-bs-placement="top"
                                               title="@lang("copy to clipboard")"><i
                                                    class="fas fa-copy"></i></a><strong
                                                class="text-dark font-weight-bold"
                                                id="destinationId">{{$buy->destination_wallet}}</strong>
                                        </li>
                                    </ul>
                                </div>
                                <div class="alert alert-soft-secondary" role="alert">
                                    @lang("You can initiate a cryptocurrency exchange by providing the designated destination address.")
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
                        @if(optional($buy->cryptoMethod)->is_automatic)
                            <button type="submit" name="btnValue" class="btn btn-soft-primary"
                                    value="automatic">@lang('Send Automatic')</button>
                        @endif
                        <button type="submit" name="btnValue" value="manual"
                                class="btn btn-soft-success">@lang('Yes')</button>
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

        $(document).on("click", "#send", function () {
            let route = "{{route("admin.buySend",$buy->utr)}}";
            $("#deleteModalHeader").text(`Send Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with finalizing the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

        $(document).on("click", "#cancel", function () {
            let route = "{{route("admin.buyCancel",$buy->utr)}}";
            $("#deleteModalHeader").text(`Cancel Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with cancel the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

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
