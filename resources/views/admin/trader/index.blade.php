@extends('admin.layouts.app')
@section('page_title', __('Traders'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.dashboard') }}">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Traders')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Traders')</h1>
                </div>
                <div class="col-sm-auto">
                    <a href="{{ route('admin.traders.create') }}" class="btn btn-primary">@lang('Add Trader')</a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h4 class="card-title mb-0">@lang('Manual Deal Team')</h4>
            </div>
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Trader')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Deals')</th>
                        <th>@lang('Last Seen')</th>
                        <th class="text-end">@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($traders as $trader)
                        @php
                            $isConnected = $trader->hasRecentSession();
                            $isReady = $trader->canReceiveManualDeals();
                        @endphp
                        <tr>
                            <td>
                                <div class="d-flex flex-column">
                                    <strong>{{ $trader->name }}</strong>
                                    <span class="text-body">{{ '@' . $trader->username }}</span>
                                    @if($trader->telegram_display)
                                        <small class="text-primary">{{ $trader->telegram_display }}</small>
                                    @endif
                                    <small class="text-body">{{ $trader->email }}</small>
                                </div>
                            </td>
                            <td>
                                @if($trader->status)
                                    <span class="badge bg-soft-success text-success">@lang('Active')</span>
                                @else
                                    <span class="badge bg-soft-danger text-danger">@lang('Inactive')</span>
                                @endif
                                @if($trader->is_trade_online)
                                    <span class="badge bg-soft-info text-info">@lang('Switch On')</span>
                                @else
                                    <span class="badge bg-soft-secondary text-secondary">@lang('Switch Off')</span>
                                @endif
                                @if($isConnected)
                                    <span class="badge bg-soft-primary text-primary">@lang('In Panel')</span>
                                @else
                                    <span class="badge bg-soft-warning text-warning">@lang('Away')</span>
                                @endif
                                @if($isReady)
                                    <span class="badge bg-soft-success text-success">@lang('Ready For Clients')</span>
                                @else
                                    <span class="badge bg-soft-secondary text-secondary">@lang('Not Ready')</span>
                                @endif
                            </td>
                            <td>
                                <div class="d-flex flex-column">
                                    <span>@lang('Assigned'): {{ $trader->assigned_sell_requests_count }}</span>
                                    <span>@lang('Completed'): {{ $trader->completed_sell_requests_count }}</span>
                                    <span>@lang('Canceled'): {{ $trader->cancelled_sell_requests_count }}</span>
                                </div>
                            </td>
                            <td>{{ $trader->last_seen ? dateTime($trader->last_seen, basicControl()->date_time_format) : '-' }}</td>
                            <td class="text-end">
                                <a href="{{ route('admin.traders.edit', $trader->id) }}" class="btn btn-white btn-sm">
                                    <i class="bi-pencil-fill me-1"></i>@lang('Edit')
                                </a>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="5" class="text-center py-5 text-body">@lang('No traders added yet.')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
            @if($traders->hasPages())
                <div class="card-footer">
                    {{ $traders->links() }}
                </div>
            @endif
        </div>
    </div>
@endsection
