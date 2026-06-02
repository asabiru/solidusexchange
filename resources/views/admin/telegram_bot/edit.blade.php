@extends('admin.layouts.app')
@section('page_title', __('Edit Telegram Bot'))
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
                    <h1 class="page-header-title">@lang("Edit Telegram Bot")</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-8">
                <div class="card">
                    <div class="card-body">
                        <form action="{{ route('admin.telegram.bots.update', $bot->id) }}" method="post">
                            @csrf
                            @method('PUT')
                            <div class="mb-4">
                                <label class="form-label">@lang('Bot Name')</label>
                                <input type="text" class="form-control @error('name') is-invalid @enderror" name="name" value="{{ old('name', $bot->name) }}" required>
                                @error('name')<span class="invalid-feedback">{{ $message }}</span>@enderror
                            </div>
                            <div class="mb-4">
                                <label class="form-label">@lang('Bot Token')</label>
                                <input type="text" class="form-control" value="{{ Str::limit($bot->bot_token, 20, '...') }}" disabled>
                                <small class="text-muted">@lang('Token cannot be changed for security')</small>
                            </div>
                            <div class="mb-4">
                                <label class="form-label">@lang('Type')</label>
                                <select class="form-select" name="type" required>
                                    <option value="general" {{ $bot->type == 'general' ? 'selected' : '' }}>@lang('General')</option>
                                    <option value="support" {{ $bot->type == 'support' ? 'selected' : '' }}>@lang('Support')</option>
                                    <option value="mini_app" {{ $bot->type == 'mini_app' ? 'selected' : '' }}>@lang('Mini App')</option>
                                </select>
                            </div>
                            <div class="mb-4 form-check">
                                <input type="checkbox" class="form-check-input" name="is_active" value="1" id="is_active" {{ $bot->is_active ? 'checked' : '' }}>
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
