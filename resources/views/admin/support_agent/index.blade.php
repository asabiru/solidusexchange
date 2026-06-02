@extends('admin.layouts.app')
@section('page_title', __('Support Agents'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Support Agents')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Support Agents')</h1>
                </div>
                <div class="col-sm-auto">
                    <a href="{{ route('admin.support.agents.create') }}" class="btn btn-primary">@lang('Add Agent')</a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h4 class="card-title mb-0">@lang('Support Team')</h4>
            </div>
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Agent')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Last Seen')</th>
                        <th class="text-end">@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($agents as $agent)
                        <tr>
                            <td>
                                <div class="d-flex flex-column">
                                    <strong>{{ $agent->name }}</strong>
                                    <span class="text-body">{{ '@' . $agent->username }}</span>
                                    @if($agent->telegram_username)
                                        <small class="text-primary">{{ $agent->telegram_username }}</small>
                                    @endif
                                    <small class="text-body">{{ $agent->email }}</small>
                                </div>
                            </td>
                            <td>
                                @if($agent->status)
                                    <span class="badge bg-soft-success text-success">@lang('Active')</span>
                                @else
                                    <span class="badge bg-soft-danger text-danger">@lang('Inactive')</span>
                                @endif
                            </td>
                            <td>{{ $agent->last_seen ? dateTime($agent->last_seen, basicControl()->date_time_format) : '-' }}</td>
                            <td class="text-end">
                                <a href="{{ route('admin.support.agents.edit', $agent->id) }}" class="btn btn-white btn-sm me-1">
                                    <i class="bi-pencil-fill me-1"></i>@lang('Edit')
                                </a>
                                <form action="{{ route('admin.support.agents.destroy', $agent->id) }}" method="POST" class="d-inline" onsubmit="return confirm('@lang('Delete this agent?')')">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit" class="btn btn-white btn-sm text-danger">
                                        <i class="bi-trash me-1"></i>@lang('Delete')
                                    </button>
                                </form>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="4" class="text-center py-5 text-body">@lang('No support agents added yet.')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
            @if($agents->hasPages())
                <div class="card-footer">
                    {{ $agents->links() }}
                </div>
            @endif
        </div>
    </div>
@endsection
