@extends('admin.layouts.app')
@section('page_title', __('Add Support Agent'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.support.agents.index') }}">@lang('Support Agents')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Add Agent')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Add Support Agent')</h1>
                </div>
            </div>
        </div>

        <form action="{{ route('admin.support.agents.store') }}" method="post">
            @csrf
            <div class="row">
                <div class="col-lg-8">
                    <div class="card mb-4">
                        <div class="card-header">
                            <h4 class="card-title mb-0">@lang('Agent Profile')</h4>
                        </div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Name')</label>
                                    <input type="text" name="name" class="form-control" value="{{ old('name') }}">
                                    @error('name')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Username')</label>
                                    <input type="text" name="username" class="form-control" value="{{ old('username') }}">
                                    @error('username')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Email')</label>
                                    <input type="email" name="email" class="form-control" value="{{ old('email') }}">
                                    @error('email')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Telegram Username')</label>
                                    <input type="text" name="telegram_username" class="form-control"
                                           placeholder="@username"
                                           value="{{ old('telegram_username') }}">
                                    <small class="text-body">@lang('Enter Telegram nickname starting with @.')</small>
                                    @error('telegram_username')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Password')</label>
                                    <input type="password" name="password" class="form-control">
                                    @error('password')
                                    <span class="invalid-feedback d-block">{{ $message }}</span>
                                    @enderror
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">@lang('Confirm Password')</label>
                                    <input type="password" name="password_confirmation" class="form-control">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="card mb-4">
                        <div class="card-header">
                            <h4 class="card-title mb-0">@lang('Status')</h4>
                        </div>
                        <div class="card-body">
                            <div class="form-check form-switch mb-3">
                                <input type="hidden" name="status" value="0">
                                <input class="form-check-input" type="checkbox" id="agentStatus" name="status" value="1"
                                       {{ (string) old('status', '1') === '1' ? 'checked' : '' }}>
                                <label class="form-check-label" for="agentStatus">@lang('Agent is active')</label>
                            </div>
                            <p class="text-body mb-0">@lang('Active agents can log in and process support tickets.')</p>
                        </div>
                    </div>
                    <div class="d-flex justify-content-start gap-2">
                        <a href="{{ route('admin.support.agents.index') }}" class="btn btn-white">@lang('Cancel')</a>
                        <button type="submit" class="btn btn-primary">@lang('Create Agent')</button>
                    </div>
                </div>
            </div>
        </form>
    </div>
@endsection
