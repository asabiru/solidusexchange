@extends('admin.layouts.app')
@section('page_title', __('Exchange Api Settings'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="{{ route('admin.dashboard')  }}">@lang('Dashboard')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active"
                                aria-current="page">@lang('Exchange Api Setting')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Exchange Api Setting')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-6 seo-setting">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title h4">@lang('Exchange Api Setting')</h2>
                        </div>
                        <div class="card-body">
                            <form action="{{ route('admin.currency.exchange.api.config.update') }}" method="post"
                                  enctype="multipart/form-data">
                                @csrf
                                <h2 class="card-title h5  border-bottom pb-3 ">@lang('Rapira Public Market (Fiat Currency)')</h2>
                                <div class="row mb-4 mt-5">
                                    <label class="col-sm-4 col-form-label form-label">@lang("Rate Source")</label>
                                    <div class="col-sm-8">
                                        <div class="alert alert-soft-primary mb-0">
                                            <div class="d-flex align-items-start gap-2">
                                                <i class="bi bi-info-circle mt-1"></i>
                                                <div>
                                                    <strong>@lang('Rapira public market')</strong>
                                                    <div class="small text-body mt-1">
                                                        @lang('Fiat currency rates are synced from Rapira open market rates. No API key is required for this sync.')
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <input type="hidden" name="currency_layer_access_key" value="">
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="currency_layer_auto_update_at"
                                           class="col-sm-4 col-form-label form-label">@lang("Select Update Time")</label>
                                    <div class="col-sm-8">
                                        <div class="tom-select-custom">
                                            <select class="js-select form-select"
                                                    name="currency_layer_auto_update_at" autocomplete="off"
                                                    data-hs-tom-select-options='{
                                                              "placeholder": "Select a schedule",
                                                              "hideSearch": true
                                                            }'>
                                                @foreach($scheduleList as $key => $schedule)
                                                    <option
                                                        value="{{$key}}" {{ $key == old('currency_layer_auto_update_at',$basicControl->currency_layer_auto_update_at) ? 'selected' : '' }}>@lang($schedule)</option>
                                                @endforeach
                                            </select>
                                        </div>
                                        @error('currency_layer_auto_update_at')
                                        <span class="invalid-feedback">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <label class="row form-check form-switch mb-4" for="currency_layer_auto_update">
                                        <span class="col-8 col-sm-9 ms-0">
                                          <span class="d-block text-dark">@lang("Update Currency Rate")</span>
                                          <span
                                              class="d-block fs-5">@lang("Auto update your site currency rate.")</span>
                                        </span>
                                    <span class="col-4 col-sm-3 text-end">
                                           <input type='hidden' value='0' name='currency_layer_auto_update'>
                                                <input
                                                    class="form-check-input @error('currency_layer_auto_update') is-invalid @enderror"
                                                    type="checkbox"
                                                    name="currency_layer_auto_update"
                                                    id="currency_layer_auto_update"
                                                    value="1" {{ $basicControl->currency_layer_auto_update == 1 ? 'checked' : '' }}>
                                    </span>
                                    @error('currency_layer_auto_update')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </label>

                                <h2 class="card-title h5 my-5 border-top border-bottom pt-4 pb-3 ">@lang('Bybit Spot Sync (Crypto Currency)')</h2>

                                <div class="row mb-4">
                                    <label class="col-sm-4 col-form-label form-label">@lang("Rate Source")</label>
                                    <div class="col-sm-8">
                                        <div class="alert alert-soft-primary mb-0">
                                            <div class="d-flex align-items-start gap-2">
                                                <i class="bi bi-info-circle mt-1"></i>
                                                <div>
                                                    <strong>@lang('Bybit public spot market')</strong>
                                                    <div class="small text-body mt-1">
                                                        @lang('Crypto currency rates are now synced from Bybit public spot tickers. No CoinMarketCap key is required for this sync.')
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <input type="hidden" name="coin_market_cap_app_key" value="{{ old('coin_market_cap_app_key', $basicControl->coin_market_cap_app_key) }}">
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="coin_market_cap_auto_update_at"
                                           class="col-sm-4 col-form-label form-label">@lang("Select Update Time")</label>
                                    <div class="col-sm-8">
                                        <div class="tom-select-custom">
                                            <select class="js-select form-select"
                                                    name="coin_market_cap_auto_update_at" autocomplete="off"
                                                    data-hs-tom-select-options='{
                                                              "placeholder": "Select a schedule",
                                                              "hideSearch": true
                                                            }'>
                                                @foreach($scheduleList as $key => $schedule)
                                                    <option
                                                        value="{{$key}}" {{ $key == old('coin_market_cap_auto_update_at',$basicControl->coin_market_cap_auto_update_at) ? 'selected' : '' }}>@lang($schedule)</option>
                                                @endforeach
                                            </select>
                                        </div>
                                        @error('coin_market_cap_auto_update_at')
                                        <span class="invalid-feedback">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <!-- Form Switch -->
                                <label class="row form-check form-switch mb-4" for="coin_market_cap_auto_update">
                                        <span class="col-8 col-sm-9 ms-0">
                                          <span class="d-block text-dark">@lang("Auto Update Crypto Rate")</span>
                                          <span
                                              class="d-block fs-5">@lang("Auto update your site crypto currency rates from Bybit.")</span>
                                        </span>
                                    <span class="col-4 col-sm-3 text-end">
                                           <input type='hidden' value='0' name='coin_market_cap_auto_update'>

                                               <input
                                                   class="form-check-input @error('coin_market_cap_auto_update') is-invalid @enderror"
                                                   type="checkbox"
                                                   name="coin_market_cap_auto_update"
                                                   id="coin_market_cap_auto_update"
                                                   value="1" {{ $basicControl->coin_market_cap_auto_update == 1 ? 'checked' : '' }}>
                                        </span>
                                    @error('coin_market_cap_auto_update')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </label>

                                <div class="d-flex justify-content-end mt-4">
                                    <button type="submit" class="btn btn-primary">@lang('Save changes')</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-lg-3">
                <div id="emailSection" class="card mb-4">
                    <div class="card-header d-flex align-items-center justify-content-between">
                        <h2 class="card-title h4 mt-2">@lang('Rapira Sync Instructions')</h2>
                    </div>
                    <div class="card-body">
                        <p>@lang('Fiat currency rates are synced from Rapira open market data. The sync uses public market rates and does not require a separate API key.')</p>
                        <p>@lang('The project derives the base currency value directly from Rapira market data, including the live USDT/RUB market used for the Russian audience flow.')</p>
                        <a href="https://rapira.net/"
                           target="_blank">@lang('Open Rapira') <i class="fas fa-external-link-alt"></i></a>
                    </div>
                </div>

                <div id="emailSection" class="card mb-4">
                    <div class="card-header d-flex align-items-center justify-content-between">
                        <h2 class="card-title h4 mt-2">@lang('Bybit Sync Instructions')</h2>
                    </div>
                    <div class="card-body">
                        <p>@lang('Crypto currency rates are synced from Bybit public spot tickers. The update job does not require a CoinMarketCap key anymore.')</p>
                        <p>@lang('Supported currencies are those that have a tradable spot pair on Bybit, primarily against USDT and selected cross pairs.')</p>
                        <a href="https://www.bybit.com/"
                           target="_blank">@lang('Open Bybit') <i class="fas fa-external-link-alt"></i></a>
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
            HSCore.components.HSTomSelect.init('.js-select')
        })();
    </script>
@endpush



