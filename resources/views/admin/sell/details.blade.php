@extends('admin.layouts.app')
@section('page_title',__('Sell Crypto Details'))
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
                                                           href="javascript:void(0);">@lang('Sell Crypto Details')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        @if(in_array($sell->status, [1, 2]))
            <div class="row mx-4">
                <div class="d-flex justify-content-end gap-2">
                    @if($sell->status == 1 && !$hasCustodialTracking)
                        <button type="button" class="btn btn-soft-primary" id="confirmDeposit" data-bs-target="#confirmation"
                                data-bs-toggle="modal"><i class="fas fa-coins"></i> @lang("Confirm Deposit")
                        </button>
                        <button type="button" class="btn btn-soft-danger" id="cancel" data-bs-target="#confirmation"
                                data-bs-toggle="modal"><i class="fas fa-times"></i> @lang('Cancel')
                        </button>
                    @elseif($sell->status == 2)
                        <button type="button" class="btn btn-soft-success" id="send" data-bs-target="#confirmation"
                                data-bs-toggle="modal"><i class="fas fa-paper-plane"></i> @lang("Send")
                        </button>
                        <button type="button" class="btn btn-soft-danger" id="cancel" data-bs-target="#confirmation"
                                data-bs-toggle="modal"><i class="fas fa-times"></i> @lang('Cancel')
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
                                    @if ($sell->status == 1)
                                        <span class="legend-indicator bg-info"></span>@lang("Awaiting Deposit")
                                    @elseif ($sell->status == 2)
                                        <span class="legend-indicator bg-warning"></span>@lang("Awaiting Complete")
                                    @elseif ($sell->status == 3)
                                        <span class="legend-indicator bg-success"></span>@lang("Trade Completed")
                                    @elseif ($sell->status == 5)
                                        <span class="legend-indicator bg-danger"></span>@lang("Trade Cancel")
                                    @endif
                                </div>

                            </div>
                            <div class="card-body mt-2">
                                <div class="col-sm">
                                    <!-- List Checked -->
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-primary">
                                        <li class="list-checked-item">@lang('Trx ID') : <strong
                                                class="text-dark font-weight-bold">{{$sell->utr}}</strong></li>
                                        <li class="list-checked-item">@lang('Exchange Rate') : <strong
                                                class="text-dark font-weight-bold">1 {{optional($sell->sendCurrency)->code}}
                                                ~ {{number_format($sell->exchange_rate,2)}} {{optional($sell->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Processing Fees') : <strong
                                                class="text-dark font-weight-bold"
                                                id="serviceFee">{{number_format($sell->processing_fee,2)}} {{optional($sell->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payment Method')
                                            : {{optional($sell->cryptoMethod)->name}}
                                            @if(optional($sell->cryptoMethod)->is_automatic)
                                                <span
                                                    class="badge bg-soft-success text-success">@lang("Automatic")</span>
                                            @else
                                                <span
                                                    class="badge bg-soft-secondary text-danger">@lang('manual')</span>
                                            @endif
                                        </li>
                                        <li class="list-checked-item">@lang('Fiat Processing Mode')
                                            :
                                            @if(optional($sell->fiatSendGateway)->processing_mode === 'automatic')
                                                <span class="badge bg-soft-primary text-primary">@lang('Automatic')</span>
                                            @else
                                                <span class="badge bg-soft-warning text-warning">@lang('Manual')</span>
                                            @endif
                                        </li>
                                        <li class="list-checked-item">@lang('Assigned Trader') :
                                            <strong class="text-dark font-weight-bold">
                                                {{ optional($sell->assignedTrader)->name ?? 'Not assigned' }}
                                            </strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Requester') : <a
                                                href="{{$sell->user_id ? route('admin.user.edit',$sell->user_id) : 'javascript:void(0)'}}">{{optional($sell->user)->fullname??'Anonymous'}}</a>
                                        </li>
                                    </ul>
                                    <div class="alert alert-soft-secondary" role="alert">
                                        @if($sell->status == 1 && !$hasCustodialTracking)
                                            @lang("Legacy manual sell flow: confirm the crypto deposit only after you have manually verified the transaction and completed AML review outside the system.")
                                        @elseif($sell->status == 1)
                                            @lang("This sell is waiting for blockchain confirmation and AML screening from the custodial pipeline.")
                                        @else
                                            @lang("Please ensure that you have received the cryptocurrency before finalizing the exchange.")
                                        @endif
                                    </div>
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
                                <span>{{dateTime($sell->created_at,basicControl()->date_time_format)}}</span>
                            </div>
                            <div class="card-body mt-2" id="autoRate">
                                <div class="col-sm">
                                    <ul class="list-checked list-checked-lg list-checked-soft-bg-secondary">
                                        <li class="list-checked-item">@lang('Send Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($sell->sendCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Currency') : <strong
                                                class="text-dark font-weight-bold">{{optional($sell->getCurrency)->currency_name}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Send Amount') : <strong
                                                class="text-dark font-weight-bold">{{rtrim(rtrim(getAmount($sell->send_amount,8),0),'.')}} {{optional($sell->sendCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Receive Amount') : <strong
                                                class="text-dark font-weight-bold"
                                                id="receiveAmount">{{number_format($sell->get_amount,2)}} {{optional($sell->getCurrency)->code}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Payable Amount') : <strong
                                                class="text-danger font-weight-bold"
                                                id="payableAmount">{{number_format($sell->final_amount,2)}} {{optional($sell->getCurrency)->code}}</strong>
                                        </li>
                                    </ul>
                                </div>
                                <div class="alert alert-soft-secondary" role="alert">
                                    @lang("The processing fee are already included in the displayed payable amount.")
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
                                        <li class="list-checked-item">@lang('Admin Receive Address')
                                            ({{optional($sell->sendCurrency)->code}}):
                                            <a href="javascript:void(0)"
                                               onclick="copyReceiveAddress()"
                                               data-bs-toggle="tooltip"
                                               data-bs-placement="top"
                                               title="@lang("copy to clipboard")"><i
                                                    class="fas fa-copy"></i></a>
                                            <strong class="text-dark font-weight-bold"
                                                    id="receiveId">{{$sell->admin_wallet}}</strong>
                                        </li>
                                        <li class="list-checked-item">@lang('Fiat Send Gateway') : <strong
                                                class="text-dark font-weight-bold">{{optional($sell->fiatSendGateway)->name}}</strong>
                                        </li>
                                        @if($sell->contact_telegram)
                                            <li class="list-checked-item">@lang('Telegram Contact') : <strong
                                                    class="text-dark font-weight-bold">{{ $sell->contact_telegram }}</strong>
                                            </li>
                                        @endif
                                        @if($sell->contact_telegram_id)
                                            <li class="list-checked-item">@lang('Telegram ID') : <strong
                                                    class="text-dark font-weight-bold">{{ $sell->contact_telegram_id }}</strong>
                                            </li>
                                        @endif
                                        @if($sell->parameters)
                                            @foreach($sell->parameters as $key => $param)
                                                <li class="list-checked-item">{{$param->field_label}} : <strong
                                                        class="text-dark font-weight-bold">{{$param->field_value}}</strong>
                                                </li>
                                            @endforeach
                                        @endif
                                    </ul>
                                </div>
                                <div class="alert alert-soft-secondary" role="alert">
                                    @lang("You can commence the transfer of fiat currency by furnishing the necessary information details.")
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
                        @if(optional($sell->cryptoMethod)->is_automatic)
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
            let route = "{{route("admin.sellSend",$sell->utr)}}";
            $("#deleteModalHeader").text(`Send Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with finalizing the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

        $(document).on("click", "#confirmDeposit", function () {
            let route = "{{route("admin.sellConfirmDeposit",$sell->utr)}}";
            $("#deleteModalHeader").text(`Deposit Confirmation`);
            $("#deleteModalBody").text(`Confirm that the crypto deposit has been received and manually reviewed.`);
            $(".deleteModalRoute").attr('action', route);
        });

        $(document).on("click", "#cancel", function () {
            let route = "{{route("admin.sellCancel",$sell->utr)}}";
            $("#deleteModalHeader").text(`Cancel Confirmation`);
            $("#deleteModalBody").text(`Do you wish to proceed with cancel the exchange?`);
            $(".deleteModalRoute").attr('action', route);
        });

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
