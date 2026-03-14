@extends('admin.layouts.app')
@section('page_title', __('My Sell Deals'))
@section('content')
    <div class="content container-fluid">
        @php
            $sellTypeLabels = [
                'all' => __('All'),
                'pending' => __('Pending'),
                'complete' => __('Completed'),
                'cancel' => __('Canceled'),
                'refund' => __('Refunded'),
            ];
            $sellTypeLabel = $sellTypeLabels[$sellType] ?? ucfirst($sellType);
        @endphp
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.trader.dashboard') }}">@lang('Trader Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">{{ $sellTypeLabel }} @lang('Sell Deals')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">{{ $sellTypeLabel }} @lang('Sell Deals')</h1>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100"><div class="card-body"><h6 class="card-subtitle mb-2">@lang('Pending')</h6><span class="display-6 text-warning">{{ $stats['pending'] }}</span></div></div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100"><div class="card-body"><h6 class="card-subtitle mb-2">@lang('Completed')</h6><span class="display-6 text-success">{{ $stats['completed'] }}</span></div></div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100"><div class="card-body"><h6 class="card-subtitle mb-2">@lang('Canceled')</h6><span class="display-6 text-danger">{{ $stats['cancelled'] }}</span></div></div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100"><div class="card-body"><h6 class="card-subtitle mb-2">@lang('Completed Volume')</h6><span class="display-6 text-dark">{{ number_format($stats['volume'], 2) }}</span></div></div>
            </div>
        </div>

        <div class="card">
            <div class="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center">
                <h4 class="card-title mb-0">@lang('Assigned Manual Deals')</h4>
                <div class="btn-group" role="group">
                    <a href="{{ route('admin.trader.sells.index', ['type' => 'all']) }}" class="btn btn-sm {{ $sellType === 'all' ? 'btn-primary' : 'btn-white' }}">@lang('All')</a>
                    <a href="{{ route('admin.trader.sells.index', ['type' => 'pending']) }}" class="btn btn-sm {{ $sellType === 'pending' ? 'btn-primary' : 'btn-white' }}">@lang('Pending')</a>
                    <a href="{{ route('admin.trader.sells.index', ['type' => 'complete']) }}" class="btn btn-sm {{ $sellType === 'complete' ? 'btn-primary' : 'btn-white' }}">@lang('Completed')</a>
                    <a href="{{ route('admin.trader.sells.index', ['type' => 'cancel']) }}" class="btn btn-sm {{ $sellType === 'cancel' ? 'btn-primary' : 'btn-white' }}">@lang('Canceled')</a>
                </div>
            </div>
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Trx')</th>
                        <th>@lang('Client')</th>
                        <th>@lang('Send')</th>
                        <th>@lang('Payout')</th>
                        <th>@lang('Telegram')</th>
                        <th>@lang('Status')</th>
                        <th class="text-end">@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($sells as $sell)
                        <tr>
                            <td>{{ $sell->utr }}</td>
                            <td>{{ optional($sell->user)->fullname ?: (optional($sell->user)->username ?? __('Anonymous')) }}</td>
                            <td>{{ rtrim(rtrim(getAmount($sell->send_amount, 8), 0), '.') }} {{ optional($sell->sendCurrency)->code }}</td>
                            <td>{{ number_format($sell->final_amount, 2) }} {{ optional($sell->getCurrency)->code }}</td>
                            <td>{{ $sell->contact_telegram ?? '-' }}</td>
                            <td>{!! $sell->admin_status !!}</td>
                            <td class="text-end">
                                <a href="{{ route('admin.trader.sells.show', $sell->utr) }}" class="btn btn-white btn-sm">
                                    <i class="fal fa-eye me-1"></i>@lang('View')
                                </a>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="7" class="text-center py-5 text-body">@lang('No sell deals found.')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
            @if($sells->hasPages())
                <div class="card-footer">
                    {{ $sells->links() }}
                </div>
            @endif
        </div>
    </div>
@endsection
