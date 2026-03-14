@extends('admin.layouts.app')
@section('page_title', __('Exchange Control'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')
                                </a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Exchange Control')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Exchange Control')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-9" id="basic_control">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title h4">@lang('Exchange Controls')</h2>
                        </div>
                        <div class="card-body">
                            <form action="{{ route('admin.exchange.control') }}" method="post">
                                @csrf
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="row mb-4">
                                            <div class="col-sm-12">
                                                <label for="ExchangeRate" class="form-label">@lang('Exchange Rate') <i
                                                        class="bi-question-circle text-body ms-1"
                                                        data-bs-toggle="tooltip"
                                                        data-bs-placement="top"
                                                        aria-label="@lang("Exchange Rate")"
                                                        data-bs-original-title="@lang("Provide me with the current exchange rate of the base currency in relation to USD for updating the cryptocurrency rates.")"></i></label>
                                                <div class="input-group">
                                                    <span class="input-group-text" id="basic-addon2">1 USD =</span>
                                                    <input type="number" step="0.001"
                                                           class="form-control @error('exchange_rate') is-invalid @enderror"
                                                           name="exchange_rate" id="Exchange"
                                                           placeholder="Exchange" aria-label="Exchange"
                                                           autocomplete="off"
                                                           value="{{ old('exchange_rate',$basicControl->exchange_rate) }}">
                                                    <span class="input-group-text"
                                                          id="basic-addon2">{{basicControl()->base_currency}}</span>
                                                </div>
                                                @error('exchange_rate')
                                                <span class="invalid-feedback">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>

                                        <div class="row mb-4">
                                            <div class="col-sm-12">
                                                <label for="RefundExchangeNote"
                                                       class="form-label">@lang("Refund Exchange Note")</label>
                                                <input type="text"
                                                       class="form-control @error('refund_exchange_note') is-invalid @enderror"
                                                       name="refund_exchange_note" id="RefundExchangeNote"
                                                       placeholder="@lang("Refund Exchange Note")"
                                                       aria-label="@lang("Refund Exchange Note")"
                                                       autocomplete="off"
                                                       value="{{ old('refund_exchange_note', $basicControl->refund_exchange_note) }}">
                                                @error('refund_exchange_note')
                                                <span class="invalid-feedback">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>

                                        <div class="row mb-4">
                                            <div class="col-sm-12">
                                                <label for="ExchangeRate"
                                                       class="form-label">@lang('Floating Rate Update')
                                                    <i
                                                        class="bi-question-circle text-body ms-1"
                                                        data-bs-toggle="tooltip"
                                                        data-bs-placement="top"
                                                        aria-label="@lang("Floating Rate Update")"
                                                        data-bs-original-title="@lang("Specify the refresh interval for updating floating cryptocurrency exchange rates.")"></i></label>
                                                <div class="input-group">
                                                    <input type="number" min="20"
                                                           class="form-control @error('floating_rate_update_time') is-invalid @enderror"
                                                           name="floating_rate_update_time"
                                                           id="floating_rate_update_time"
                                                           placeholder="60" aria-label="floating_rate_update_time"
                                                           autocomplete="off"
                                                           value="{{ old('floating_rate_update_time',$basicControl->floating_rate_update_time/1000) }}">
                                                    <span class="input-group-text"
                                                          id="basic-addon2">@lang("Seconds")</span>
                                                </div>
                                                @error('floating_rate_update_time')
                                                <span class="invalid-feedback">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>

                                        <div class="row mb-4">
                                            <div class="col-sm-12">
                                                <label for="CryptoSendTime"
                                                       class="form-label">@lang('Crypto Send Time')
                                                    <i
                                                        class="bi-question-circle text-body ms-1"
                                                        data-bs-toggle="tooltip"
                                                        data-bs-placement="top"
                                                        aria-label="@lang("Crypto Send Time")"
                                                        data-bs-original-title="@lang("What is the allocated time frame for sending cryptocurrency to the admin wallet?")"></i></label>
                                                <div class="input-group">
                                                    <input type="number" min="5"
                                                           class="form-control @error('crypto_send_time') is-invalid @enderror"
                                                           name="crypto_send_time"
                                                           id="crypto_send_time"
                                                           placeholder="60" aria-label="crypto_send_time"
                                                           autocomplete="off"
                                                           value="{{ old('crypto_send_time',$basicControl->crypto_send_time) }}">
                                                    <span class="input-group-text"
                                                          id="basic-addon2">@lang("Minutes")</span>
                                                </div>
                                                @error('crypto_send_time')
                                                <span class="invalid-feedback">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>

                                        <div class="row mb-4">
                                            <div class="col-sm-12">
                                                <label for="CryptoSendTime"
                                                       class="form-label">@lang('Fiat Send Time')
                                                    <i
                                                        class="bi-question-circle text-body ms-1"
                                                        data-bs-toggle="tooltip"
                                                        data-bs-placement="top"
                                                        aria-label="@lang("Fiat Send Time")"
                                                        data-bs-original-title="@lang("What is the allocated time frame for sending fiat-currency to the admin wallet?")"></i></label>
                                                <div class="input-group">
                                                    <input type="number" min="5"
                                                           class="form-control @error('fiat_send_time') is-invalid @enderror"
                                                           name="fiat_send_time"
                                                           id="fiat_send_time"
                                                           placeholder="60" aria-label="fiat_send_time"
                                                           autocomplete="off"
                                                           value="{{ old('fiat_send_time',$basicControl->fiat_send_time) }}">
                                                    <span class="input-group-text"
                                                          id="basic-addon2">@lang("Minutes")</span>
                                                </div>
                                                @error('fiat_send_time')
                                                <span class="invalid-feedback">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <label class="row form-check form-switch my-4"
                                               for="status">
                                            <span class="col-8 col-sm-9 ms-0">
                                              <span class="d-block text-dark">@lang("Refund Exchange")</span>
                                              <span
                                                  class="d-block fs-5">@lang("To obtain the recipient's refund cryptocurrency wallet address.")</span>
                                            </span>
                                            <span class="col-4 col-sm-3 text-end">
                                                    <input type="hidden" value="0" name="refund_exchange_status"/>
                                                    <input
                                                        class="form-check-input @error('refund_exchange_status') is-invalid @enderror"
                                                        type="checkbox" name="refund_exchange_status"
                                                        id="refund_exchange_status" value="1"
                                                        {{($basicControl->refund_exchange_status == "1") ? 'checked' : ''}}>
                                                </span>
                                            @error('refund_exchange_status')
                                            <span class="invalid-feedback d-block">{{ $message }}</span>
                                            @enderror
                                        </label>

                                        <label class="row form-check form-switch my-4"
                                               for="status">
                                            <span class="col-8 col-sm-9 ms-0">
                                              <span class="d-block text-dark">@lang("Floating Rate Status")</span>
                                              <span
                                                  class="d-block fs-5">@lang("Enable rate updates at specified intervals by checking the corresponding option.")</span>
                                            </span>
                                            <span class="col-4 col-sm-3 text-end">
                                                    <input type="hidden" value="0" name="floating_rate_update_status"/>
                                                    <input
                                                        class="form-check-input @error('floating_rate_update_status') is-invalid @enderror"
                                                        type="checkbox" name="floating_rate_update_status"
                                                        id="floating_rate_update_status" value="1"
                                                        {{($basicControl->floating_rate_update_status == "1") ? 'checked' : ''}}>
                                                </span>
                                            @error('floating_rate_update_status')
                                            <span class="invalid-feedback d-block">{{ $message }}</span>
                                            @enderror
                                        </label>
                                    </div>
                                </div>
                                <div class="d-flex justify-content-start">
                                    <button type="submit" class="btn btn-primary">@lang('Save changes')</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection

@push('css-lib')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
@endpush
@push('js-lib')
    <script src="{{ asset('assets/admin/js/tom-select.complete.min.js') }}"></script>
@endpush

@push('script')
    <script>
        'use strict';
        (function () {
            HSCore.components.HSTomSelect.init('.js-select', {
                maxOptions: 500
            })
        })();

    </script>
@endpush
