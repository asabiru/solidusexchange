@extends('admin.layouts.app')
@section('page_title', __('Telegram Control'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0)">@lang('Dashboard')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Socialite Controls')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Socialite Controls')</h1>
                </div>
            </div>
        </div>
        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.Socialite'), 'suffix' => ''])
            </div>
            <div class="col-lg-7">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card h-100">
                        <div class="card-header card-header-content-between">
                            <h4 class="card-header-title">@lang('Telegram Control')</h4>
                        </div>
                        <div class="card-body">
                            <form action="{{ route('admin.telegram.control') }}" method="post"
                                  enctype="multipart/form-data">
                                @csrf
                                <div class="row mb-4">
                                    <label for="telegram_bot_username"
                                           class="col-sm-3 col-form-label form-label">@lang("Bot Username")</label>
                                    <div class="col-sm-9">
                                        <input type="text"
                                               class="form-control @error('telegram_bot_username') is-invalid @enderror"
                                               name="telegram_bot_username" id="telegram_bot_username"
                                               placeholder="@lang("Bot Username (without @)")"
                                               value="{{ old('telegram_bot_username', env('TELEGRAM_BOT_USERNAME')) }}"
                                               autocomplete="off">
                                        @error('telegram_bot_username')
                                        <span class="invalid-feedback">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="telegram_bot_token"
                                           class="col-sm-3 col-form-label form-label">@lang("Bot Token")</label>
                                    <div class="col-sm-9">
                                        <input type="text"
                                               class="form-control @error('telegram_bot_token') is-invalid @enderror"
                                               name="telegram_bot_token" id="telegram_bot_token"
                                               placeholder="@lang("Bot Token")"
                                               value="{{ old('telegram_bot_token', env('TELEGRAM_BOT_TOKEN')) }}"
                                               autocomplete="off">
                                        @error('telegram_bot_token')
                                        <span class="invalid-feedback">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="telegram_callback_url"
                                           class="col-sm-3 col-form-label form-label">@lang("Callback Url")</label>
                                    <div class="col-sm-9">
                                        <div class="input-group mb-2">
                                            <input type="text"
                                                   class="form-control"
                                                   id="telegram_callback_url"
                                                   value="{{ route('socialiteCallback','telegram') }}"
                                                   autocomplete="off" readonly>
                                            <div class="input-group-append">
                                                <button class="btn btn-outline-secondary" onclick="webhookCopy()"
                                                        type="button">@lang('copy')</button>
                                            </div>
                                        </div>
                                        <small class="text-muted">@lang('Set your website domain in @BotFather using /setdomain.')</small>
                                    </div>
                                </div>

                                <label class="row form-check form-switch mb-4" for="telegram_status">
                                        <span class="col-8 col-sm-9 ms-0">
                                          <span class="d-block text-dark">@lang("Status")</span>
                                          <span
                                              class="d-block fs-5">@lang("Enable status to allow user login using telegram.")</span>
                                        </span>
                                    <span class="col-4 col-sm-3 text-end">
                                        <input type='hidden' value='0' name='telegram_status'>
                                        <input type="checkbox" name="telegram_status" id="telegram_status"
                                               value="1"
                                               {{ config('socialite.telegram_status') == 1 ? 'checked' : ''}} class="form-check-input">
                                    </span>
                                    @error('telegram_status')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </label>

                                <div class="d-flex justify-content-end">
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
@push('script')
    <script>
        'use strict'

        function webhookCopy() {
            const copyText = document.getElementById("telegram_callback_url");
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(copyText.value);
            Notiflix.Notify.success(`${copyText.value} Copied`);
        }
    </script>
    @if ($errors->any())
        @php
            $collection = collect($errors->all());
            $errors = $collection->unique();
        @endphp
        <script>
            "use strict";
            @foreach ($errors as $error)
            Notiflix.Notify.failure("{{trans($error)}}");
            @endforeach
        </script>
    @endif
@endpush
