@extends('admin.layouts.app')
@section('page_title', __('Add Telegram Bot'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Telegram Bots")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Add Telegram Bot")</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-8">
                <div class="card">
                    <div class="card-body">
                        <form action="{{ route('admin.telegram.bots.store') }}" method="post">
                            @csrf
                            <div class="mb-4">
                                <label class="form-label">@lang('Bot Name')</label>
                                <input type="text" class="form-control @error('name') is-invalid @enderror" name="name" value="{{ old('name') }}" required>
                                @error('name')<span class="invalid-feedback">{{ $message }}</span>@enderror
                            </div>
                            <div class="mb-4">
                                <label class="form-label">@lang('Bot Token')</label>
                                <input type="text" class="form-control @error('bot_token') is-invalid @enderror" name="bot_token" value="{{ old('bot_token') }}" required>
                                <small class="text-muted">@lang('Get token from @BotFather')</small>
                                @error('bot_token')<span class="invalid-feedback">{{ $message }}</span>@enderror
                            </div>
                            <div class="mb-4">
                                <label class="form-label">@lang('Type')</label>
                                <select class="form-select" name="type" required>
                                    <option value="general">@lang('General')</option>
                                    <option value="support">@lang('Support')</option>
                                    <option value="mini_app">@lang('Mini App')</option>
                                </select>
                            </div>
                            <div class="mb-4 form-check">
                                <input type="checkbox" class="form-check-input" name="is_active" value="1" id="is_active" checked>
                                <label class="form-check-label" for="is_active">@lang('Active')</label>
                            </div>
                            <div class="d-flex justify-content-end gap-2">
                                <a href="{{ route('admin.telegram.bots') }}" class="btn btn-white">@lang('Cancel')</a>
                                <button type="submit" class="btn btn-primary">@lang('Save')</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
