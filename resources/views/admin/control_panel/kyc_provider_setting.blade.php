@extends('admin.layouts.app')
@section('page_title', __('KYC Provider Settings'))
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
                            <li class="breadcrumb-item active" aria-current="page">@lang('KYC Provider Settings')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('KYC Provider Settings')</h1>
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
                        <h2 class="card-title h4">@lang('Sumsub Configuration')</h2>
                    </div>
                    <div class="card-body">
                        <form action="{{ route('admin.kyc.provider.config') }}" method="post">
                            @csrf

                            <label class="row form-check form-switch mb-4" for="sumsub_enabled">
                                <span class="col-8 col-sm-9 ms-0">
                                    <span class="d-block text-dark">@lang('Enable Sumsub')</span>
                                    <span class="d-block fs-5">@lang('Use Sumsub as automatic KYC provider for forms configured with Sumsub mode.')</span>
                                </span>
                                <span class="col-4 col-sm-3 text-end">
                                    <input type="hidden" name="sumsub_enabled" value="0">
                                    <input class="form-check-input" type="checkbox" name="sumsub_enabled" id="sumsub_enabled" value="1" {{ old('sumsub_enabled', $basicControl->sumsub_enabled) ? 'checked' : '' }}>
                                </span>
                            </label>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="sumsub_app_token">@lang('App Token')</label>
                                <div class="col-sm-8">
                                    <input type="text" class="form-control @error('sumsub_app_token') is-invalid @enderror" name="sumsub_app_token" id="sumsub_app_token" value="{{ old('sumsub_app_token', $basicControl->sumsub_app_token) }}" autocomplete="off">
                                    @error('sumsub_app_token')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="sumsub_secret_key">@lang('Secret Key')</label>
                                <div class="col-sm-8">
                                    <textarea class="form-control @error('sumsub_secret_key') is-invalid @enderror" name="sumsub_secret_key" id="sumsub_secret_key" rows="3">{{ old('sumsub_secret_key', $basicControl->sumsub_secret_key) }}</textarea>
                                    @error('sumsub_secret_key')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="sumsub_base_url">@lang('API Base URL')</label>
                                <div class="col-sm-8">
                                    <input type="url" class="form-control @error('sumsub_base_url') is-invalid @enderror" name="sumsub_base_url" id="sumsub_base_url" value="{{ old('sumsub_base_url', $basicControl->sumsub_base_url ?: 'https://api.sumsub.com') }}" autocomplete="off">
                                    <small class="text-muted">@lang('Use only the root API URL, for example https://api.sumsub.com. Do not paste /resources or a full endpoint here.')</small>
                                    @error('sumsub_base_url')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="sumsub_level_name">@lang('Default Level Name')</label>
                                <div class="col-sm-8">
                                    <input type="text" class="form-control @error('sumsub_level_name') is-invalid @enderror" name="sumsub_level_name" id="sumsub_level_name" value="{{ old('sumsub_level_name', $basicControl->sumsub_level_name) }}" autocomplete="off">
                                    <small class="text-muted">@lang('This level will be used when the KYC form does not override Sumsub level name.')</small>
                                    @error('sumsub_level_name')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="sumsub_websdk_url">@lang('WebSDK URL')</label>
                                <div class="col-sm-8">
                                    <input type="url" class="form-control @error('sumsub_websdk_url') is-invalid @enderror" name="sumsub_websdk_url" id="sumsub_websdk_url" value="{{ old('sumsub_websdk_url', $basicControl->sumsub_websdk_url ?: 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js') }}" autocomplete="off">
                                    @error('sumsub_websdk_url')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <hr class="my-5">

                            <h2 class="card-title h4 mb-4">@lang('Didit Configuration')</h2>

                            <label class="row form-check form-switch mb-4" for="didit_enabled">
                                <span class="col-8 col-sm-9 ms-0">
                                    <span class="d-block text-dark">@lang('Enable Didit')</span>
                                    <span class="d-block fs-5">@lang('Use Didit.me as automatic KYC/AML provider for forms configured with Didit mode.')</span>
                                </span>
                                <span class="col-4 col-sm-3 text-end">
                                    <input type="hidden" name="didit_enabled" value="0">
                                    <input class="form-check-input" type="checkbox" name="didit_enabled" id="didit_enabled" value="1" {{ old('didit_enabled', $basicControl->didit_enabled) ? 'checked' : '' }}>
                                </span>
                            </label>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="didit_api_key">@lang('API Key')</label>
                                <div class="col-sm-8">
                                    <textarea class="form-control @error('didit_api_key') is-invalid @enderror" name="didit_api_key" id="didit_api_key" rows="3">{{ old('didit_api_key', $basicControl->didit_api_key) }}</textarea>
                                    @error('didit_api_key')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="didit_webhook_secret">@lang('Webhook Secret')</label>
                                <div class="col-sm-8">
                                    <textarea class="form-control @error('didit_webhook_secret') is-invalid @enderror" name="didit_webhook_secret" id="didit_webhook_secret" rows="3">{{ old('didit_webhook_secret', $basicControl->didit_webhook_secret) }}</textarea>
                                    @error('didit_webhook_secret')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="didit_workflow_id">@lang('Default Workflow ID')</label>
                                <div class="col-sm-8">
                                    <input type="text" class="form-control @error('didit_workflow_id') is-invalid @enderror" name="didit_workflow_id" id="didit_workflow_id" value="{{ old('didit_workflow_id', $basicControl->didit_workflow_id) }}" autocomplete="off">
                                    @error('didit_workflow_id')
                                    <span class="invalid-feedback">{{ $message }}</span>
                                    @enderror
                                </div>
                            </div>

                            <div class="row mb-4">
                                <label class="col-sm-4 col-form-label form-label" for="didit_base_url">@lang('API Base URL')</label>
                                <div class="col-sm-8">
                                    <input type="url" class="form-control @error('didit_base_url') is-invalid @enderror" name="didit_base_url" id="didit_base_url" value="{{ old('didit_base_url', $basicControl->didit_base_url ?: 'https://verification.didit.me') }}" autocomplete="off">
                                    <small class="text-muted">@lang('Use https://verification.didit.me unless Didit support gives another URL.')</small>
                                    @error('didit_base_url')
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
                        <h2 class="card-title h4 mt-2">@lang('Local Setup Notes')</h2>
                    </div>
                    <div class="card-body">
                        <p>@lang('For local development you can save all Sumsub credentials here, but webhook callbacks will only work on a public HTTPS URL.')</p>
                        <p>@lang('Current Sumsub webhook endpoint:') <code>{{ route('sumsub.webhook') }}</code></p>
                        <p>@lang('Current Didit webhook endpoint:') <code>{{ route('didit.webhook') }}</code></p>
                        <p>@lang('After moving the project to the server, update provider webhook URLs and allowed origins there.')</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
