@extends('admin.layouts.app')
@section('page_title', __('Manual Sell Deal'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.trader.dashboard') }}">@lang('Trader Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.trader.sells.index') }}">@lang('My Sell Deals')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">{{ $sell->utr }}</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">{{ $sell->utr }}</h1>
                </div>
            </div>
        </div>

        @if($sell->status == 2)
            <div class="row mx-1 mb-3">
                <div class="d-flex justify-content-end gap-2">
                    <button type="button" class="btn btn-soft-success" id="send" data-bs-target="#confirmation" data-bs-toggle="modal">
                        <i class="fas fa-paper-plane"></i> @lang('Mark Completed')
                    </button>
                    <button type="button" class="btn btn-soft-danger" id="cancel" data-bs-target="#confirmation" data-bs-toggle="modal">
                        <i class="fas fa-times"></i> @lang('Cancel')
                    </button>
                </div>
            </div>
        @endif

        <div class="row justify-content-lg-center">
            <div class="col-lg-4 mb-4">
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between">
                        <h4 class="card-title mt-2">@lang("Deal Summary")</h4>
                        <div>{!! $sell->admin_status !!}</div>
                    </div>
                    <div class="card-body">
                        <ul class="list-checked list-checked-lg list-checked-soft-bg-primary">
                            <li class="list-checked-item">@lang('Client'): <strong>{{ optional($sell->user)->fullname ?: (optional($sell->user)->username ?? __('Anonymous')) }}</strong></li>
                            <li class="list-checked-item">@lang('Telegram'): <strong>{{ $sell->contact_telegram ?? '-' }}</strong></li>
                            @if($sell->contact_telegram_id)
                                <li class="list-checked-item">@lang('Telegram ID'): <strong>{{ $sell->contact_telegram_id }}</strong></li>
                            @endif
                            <li class="list-checked-item">@lang('Gateway'): <strong>{{ optional($sell->fiatSendGateway)->name }}</strong></li>
                            <li class="list-checked-item">@lang('Assigned At'): <strong>{{ $sell->assigned_at ? dateTime($sell->assigned_at, basicControl()->date_time_format) : '-' }}</strong></li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h4 class="card-title mt-2">@lang("Amounts")</h4>
                    </div>
                    <div class="card-body">
                        <ul class="list-checked list-checked-lg list-checked-soft-bg-secondary">
                            <li class="list-checked-item">@lang('Send Amount'): <strong>{{ rtrim(rtrim(getAmount($sell->send_amount, 8), 0), '.') }} {{ optional($sell->sendCurrency)->code }}</strong></li>
                            <li class="list-checked-item">@lang('Receive Amount'): <strong>{{ number_format($sell->get_amount, 2) }} {{ optional($sell->getCurrency)->code }}</strong></li>
                            <li class="list-checked-item">@lang('Processing Fee'): <strong>{{ number_format($sell->processing_fee, 2) }} {{ optional($sell->getCurrency)->code }}</strong></li>
                            <li class="list-checked-item">@lang('Payable Amount'): <strong class="text-danger">{{ number_format($sell->final_amount, 2) }} {{ optional($sell->getCurrency)->code }}</strong></li>
                            <li class="list-checked-item">@lang('Rate'): <strong>1 {{ optional($sell->sendCurrency)->code }} ~ {{ number_format($sell->exchange_rate, 2) }} {{ optional($sell->getCurrency)->code }}</strong></li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="col-lg-4 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h4 class="card-title mt-2">@lang("Transfer Details")</h4>
                    </div>
                    <div class="card-body">
                        <ul class="list-checked list-checked-lg list-checked-soft-bg-warning">
                            <li class="list-checked-item">@lang('Deposit Wallet'): <strong>{{ $sell->admin_wallet }}</strong></li>
                            @foreach(($sell->parameters ?? []) as $param)
                                <li class="list-checked-item">{{ $param->field_label }}: <strong>{{ $param->field_value }}</strong></li>
                            @endforeach
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="confirmation" data-bs-backdrop="static" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="confirmationTitle">@lang('Confirmation')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="@lang('Close')"></button>
                </div>
                <div class="modal-body" id="confirmationText">@lang('Confirm the selected action?')</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <form action="" method="post" class="actionRoute">
                        @csrf
                        <button type="submit" class="btn btn-primary">@lang('Confirm')</button>
                    </form>
                </div>
            </div>
        </div>
    </div>
@endsection

@push('script')
    <script>
        'use strict';

        $(document).on('click', '#send', function () {
            $('.actionRoute').attr('action', "{{ route('admin.trader.sells.send', $sell->utr) }}");
            $('#confirmationTitle').text(@json(__('Complete Deal')));
            $('#confirmationText').text(@json(__('Confirm that you have sent the fiat payment to the client.')));
        });

        $(document).on('click', '#cancel', function () {
            $('.actionRoute').attr('action', "{{ route('admin.trader.sells.cancel', $sell->utr) }}");
            $('#confirmationTitle').text(@json(__('Cancel Deal')));
            $('#confirmationText').text(@json(__('Cancel this deal from your trader cabinet?')));
        });
    </script>
@endpush
