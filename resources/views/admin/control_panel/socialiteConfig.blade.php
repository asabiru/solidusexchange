@extends('admin.layouts.app')
@section('page_title', __('Telegram Login'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Telegram Login')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Telegram Login')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.Socialite'), 'suffix' => ''])
            </div>
            <div class="col-lg-7">
                <div class="card">
                    <div class="card-header">
                        <h4 class="card-title mb-0">@lang('Telegram Login')</h4>
                    </div>
                    <div class="card-body">
                        <div class="alert alert-info mb-4" role="alert">
                            @lang('Only Telegram login is enabled in this project. All other social login providers have been removed from the public interface and admin menu.')
                        </div>

                        <div class="d-flex flex-column flex-sm-row gap-3 align-items-sm-center justify-content-between">
                            <div>
                                <h4 class="mb-1">@lang('Telegram settings')</h4>
                                <p class="mb-0 text-body">@lang('Open the Telegram control page to update bot username, bot token and status.')</p>
                            </div>
                            <a class="btn btn-primary" href="{{ route('admin.telegram.control') }}">
                                <i class="bi bi-telegram me-1"></i> @lang('Open Telegram settings')
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
