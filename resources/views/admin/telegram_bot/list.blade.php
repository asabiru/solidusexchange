@extends('admin.layouts.app')
@section('page_title', __('Telegram Bots'))
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
                    <h1 class="page-header-title">@lang("Telegram Bots")</h1>
                </div>
                <div class="col-sm-auto">
                    <a href="{{ route('admin.telegram.bots.create') }}" class="btn btn-primary">@lang('Add Bot')</a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive">
                <table class="table table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('ID')</th>
                        <th>@lang('Name')</th>
                        <th>@lang('Type')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Webhook')</th>
                        <th>@lang('Created')</th>
                        <th>@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($bots as $bot)
                        <tr>
                            <td>{{ $bot->id }}</td>
                            <td>{{ $bot->name }}</td>
                            <td>
                                @if($bot->type == 'support')
                                    <span class="badge bg-soft-info text-info">@lang('Support')</span>
                                @elseif($bot->type == 'mini_app')
                                    <span class="badge bg-soft-warning text-warning">@lang('Mini App')</span>
                                @else
                                    <span class="badge bg-soft-primary text-primary">@lang('General')</span>
                                @endif
                            </td>
                            <td>
                                @if($bot->is_active)
                                    <span class="badge bg-soft-success text-success">@lang('Active')</span>
                                @else
                                    <span class="badge bg-soft-danger text-danger">@lang('Inactive')</span>
                                @endif
                            </td>
                            <td>
                                <code class="text-muted" style="font-size:0.75rem">{{ Str::limit($bot->webhook_url, 40) }}</code>
                            </td>
                            <td>{{ $bot->created_at->format('d.m.Y') }}</td>
                            <td>
                                <div class="btn-group" role="group">
                                    <a href="{{ route('admin.telegram.bots.edit', $bot->id) }}" class="btn btn-white btn-sm">
                                        <i class="bi-pencil-fill me-1"></i> @lang('Edit')
                                    </a>
                                    <a href="{{ route('admin.telegram.bots.webhook', $bot->id) }}" class="btn btn-white btn-sm">
                                        <i class="bi-link me-1"></i> @lang('Webhook')
                                    </a>
                                    <form action="{{ route('admin.telegram.bots.destroy', $bot->id) }}" method="POST" class="d-inline" onsubmit="return confirm('Удалить бота?')">
                                        @csrf
                                        @method('DELETE')
                                        <button type="submit" class="btn btn-white btn-sm text-danger">
                                            <i class="bi-trash me-1"></i> @lang('Delete')
                                        </button>
                                    </form>
                                </div>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="7" class="text-center">@lang('No bots found')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
        </div>
    </div>
@endsection
