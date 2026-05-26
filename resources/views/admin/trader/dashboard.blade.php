@extends('admin.layouts.app')
@section('page_title', __('Trader Dashboard'))
@push('css')
    <style>
        .trade-availability-card {
            display: inline-flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem 1.25rem;
            border-radius: 1rem;
            background: linear-gradient(135deg, rgba(232, 201, 160, 0.12), rgba(232, 201, 160, 0.04));
            border: 1px solid rgba(232, 201, 160, 0.22);
            box-shadow: 0 4px 16px rgba(11, 6, 8, 0.3);
        }

        .trade-availability-copy {
            display: flex;
            flex-direction: column;
            gap: .15rem;
            text-align: left;
        }

        .trade-availability-title {
            font-size: .875rem;
            font-weight: 600;
            color: #f5ede4;
        }

        .trade-availability-meta {
            font-size: .75rem;
            color: #9a8e86;
        }

        .trade-availability-switch {
            position: relative;
            display: inline-block;
            width: 64px;
            height: 36px;
            flex: 0 0 auto;
        }

        .trade-availability-switch input {
            opacity: 0;
            width: 0;
            height: 0;
            position: absolute;
        }

        .trade-availability-slider {
            position: absolute;
            inset: 0;
            cursor: pointer;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.08);
            transition: .25s ease;
        }

        .trade-availability-slider::before {
            content: "";
            position: absolute;
            left: 4px;
            top: 4px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #9a8e86;
            box-shadow: 0 4px 12px rgba(11, 6, 8, 0.4);
            transition: .25s ease;
        }

        .trade-availability-switch input:checked + .trade-availability-slider {
            background: linear-gradient(135deg, #c9a227, #e8c9a0);
            border-color: rgba(232, 201, 160, 0.4);
            box-shadow: 0 0 0 3px rgba(232, 201, 160, 0.15);
        }

        .trade-availability-switch input:checked + .trade-availability-slider::before {
            transform: translateX(28px);
            background: #0b0608;
            box-shadow: 0 4px 12px rgba(232, 201, 160, 0.3);
        }

        .trade-availability-switch input:focus-visible + .trade-availability-slider {
            outline: 3px solid rgba(232, 201, 160, 0.3);
            outline-offset: 3px;
        }
    </style>
@endpush
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <h1 class="page-header-title">@lang('Trader Dashboard')</h1>
                    <p class="text-body mb-0">@lang('Your assigned manual RUB deals and personal performance.')</p>
                </div>
                <div class="col-sm-auto">
                    <form action="{{ route('admin.trader.availability.update') }}" method="post" id="tradeAvailabilityForm">
                        @csrf
                        <input type="hidden" name="availability" id="tradeAvailabilityValue" value="{{ $trader->is_trade_online ? 'online' : 'offline' }}">
                        <div class="trade-availability-card">
                            <label class="trade-availability-switch mb-0" for="tradeAvailabilityToggle">
                                <input type="checkbox"
                                       id="tradeAvailabilityToggle"
                                       {{ $trader->is_trade_online ? 'checked' : '' }}
                                       aria-label="@lang('Trader availability')">
                                <span class="trade-availability-slider"></span>
                            </label>
                            <div class="trade-availability-copy">
                                <span class="trade-availability-title">
                                    {{ $trader->is_trade_online ? __('Online') : __('Offline') }}
                                </span>
                                <span class="trade-availability-meta">
                                    {{ $trader->hasRecentSession() ? __('In Panel') : __('Disconnected') }}
                                </span>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang('Assigned')</h6>
                        <span class="display-5 text-dark">{{ $stats['assigned'] }}</span>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang('Pending')</h6>
                        <span class="display-5 text-warning">{{ $stats['pending'] }}</span>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang('Completed By You')</h6>
                        <span class="display-5 text-success">{{ $stats['completed'] }}</span>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3">
                <div class="card h-100">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang('Canceled By You')</h6>
                        <span class="display-5 text-danger">{{ $stats['cancelled'] }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-4 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h4 class="card-title mb-0">@lang('Completed Volume')</h4>
                    </div>
                    <div class="card-body">
                        <span class="display-5 text-dark">{{ number_format($stats['completedVolume'], 2) }}</span>
                        <span class="text-body">@lang('total payout amount')</span>
                    </div>
                </div>
            </div>
            <div class="col-lg-8 mb-4">
                <div class="card h-100">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h4 class="card-title mb-0">@lang('Recent Assigned Deals')</h4>
                        <a href="{{ route('admin.trader.sells.index') }}" class="btn btn-white btn-sm">@lang('View All')</a>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-borderless table-nowrap table-align-middle card-table mb-0">
                            <thead class="thead-light">
                            <tr>
                                <th>@lang('Trx')</th>
                                <th>@lang('Pair')</th>
                                <th>@lang('Client')</th>
                                <th>@lang('Status')</th>
                            </tr>
                            </thead>
                            <tbody>
                            @forelse($recentSells as $sell)
                                <tr>
                                    <td><a href="{{ route('admin.trader.sells.show', $sell->utr) }}">{{ $sell->utr }}</a></td>
                                    <td>{{ optional($sell->sendCurrency)->code }} -> {{ optional($sell->getCurrency)->code }}</td>
                                    <td>{{ optional($sell->user)->fullname ?: (optional($sell->user)->username ?? __('Anonymous')) }}</td>
                                    <td>{!! $sell->admin_status !!}</td>
                                </tr>
                            @empty
                                <tr>
                                    <td colspan="4" class="text-center py-4 text-body">@lang('No deals assigned yet.')</td>
                                </tr>
                            @endforelse
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection
@push('script')
    <script>
        document.addEventListener('DOMContentLoaded', function () {
            const toggle = document.getElementById('tradeAvailabilityToggle');
            const availability = document.getElementById('tradeAvailabilityValue');
            const form = document.getElementById('tradeAvailabilityForm');

            if (!toggle || !availability || !form) {
                return;
            }

            toggle.addEventListener('change', function () {
                availability.value = toggle.checked ? 'online' : 'offline';
                form.requestSubmit();
            });
        });
    </script>
@endpush
