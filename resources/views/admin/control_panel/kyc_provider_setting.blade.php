@extends('admin.layouts.app')
@section('page_title', __('KYC / AML Provider Settings'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('KYC / AML Provider Settings')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('KYC / AML Provider Settings')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-6">
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title h4">@lang('AMLBot Configuration')</h2>
                    </div>
                    <div class="card-body">
                        <form action="{{ route('admin.kyc.provider.config') }}" method="post">
                            @csrf

                            <label class="row form-check form-switch mb-4" for="amlbot_enabled">
                                <span class="col-8 col-sm-9 ms-0">
                                    <span class="d-block text-dark">@lang('Enable AMLBot')</span>
                                    <span class="d-block fs-5">@lang('Use AMLBot for KYC identity verification and KYT wallet screening.')</span>
                                </span>
                                <span class="col-4 col-sm-3 text-end">
                                    <input type="hidden" name="amlbot_enabled" value="0">
                                    <input class="form-check-input" type="checkbox" name="amlbot_enabled" id="amlbot_enabled" value="1" {{ old('amlbot_enabled', $basicControl->amlbot_enabled ?? 0) ? 'checked' : '' }}>
                                </span>
                            </label>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="amlbot_api_key">@lang('API Key')</label>
                                <div class="col-sm-8">
                                    <input type="text" class="form-control @error('amlbot_api_key') is-invalid @enderror" name="amlbot_api_key" id="amlbot_api_key" value="{{ old('amlbot_api_key', $basicControl->amlbot_api_key ?? '') }}" autocomplete="off" placeholder="Вставьте ваш AMLBot API ключ здесь">
                                    <small class="text-muted">@lang('Obtain your API key from your AMLBot dashboard at amlbot.com.')</small>
                                    @error('amlbot_api_key')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="d-flex justify-content-end mt-4">
                                <button type="submit" class="btn btn-primary">@lang('Save changes')</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
            <div class="col-lg-3">
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title h4 mt-2">@lang('About AMLBot')</h2>
                    </div>
                    <div class="card-body">
                        <p>@lang('AMLBot provides:')</p>
                        <ul class="fs-5">
                            <li><strong>KYT</strong> — @lang('Wallet &amp; transaction screening via API')</li>
                            <li><strong>KYC</strong> — @lang('Identity verification via iFrame')</li>
                            <li><strong>KYB</strong> — @lang('Business verification')</li>
                        </ul>
                        <p>@lang('Register and get your API key at')
                            <a href="https://amlbot.com" target="_blank" rel="noopener">amlbot.com</a>.
                        </p>
                        <p class="text-muted fs-5">@lang('AML provider setting in exchange_pipeline.php must be set to') <code>amlbot</code> @lang('for wallet screening to activate.')
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
