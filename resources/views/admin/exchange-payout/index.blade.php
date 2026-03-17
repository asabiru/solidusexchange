@extends('admin.layouts.app')
@section('page_title',__('Exchange Payouts'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Exchange Payouts')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Exchange Payouts')</h1>
                </div>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-body">
                <form method="get" class="row g-3">
                    <div class="col-md-3">
                        <label class="form-label">@lang('Status')</label>
                        <select name="status" class="form-select">
                            <option value="">@lang('All')</option>
                            @foreach(['queued' => 'Queued', 'processing' => 'Processing', 'sent' => 'Sent', 'failed' => 'Failed'] as $value => $label)
                                <option value="{{ $value }}" @selected($currentStatus === $value)>@lang($label)</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">@lang('Type')</label>
                        <select name="type" class="form-select">
                            <option value="">@lang('All')</option>
                            <option value="payout" @selected($currentType === 'payout')>@lang('Payout')</option>
                            <option value="refund" @selected($currentType === 'refund')>@lang('Refund')</option>
                        </select>
                    </div>
                    <div class="col-md-3 d-flex align-items-end">
                        <button type="submit" class="btn btn-primary">@lang('Filter')</button>
                    </div>
                </form>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Exchange')</th>
                        <th>@lang('Type')</th>
                        <th>@lang('Amount')</th>
                        <th>@lang('Destination')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Requested')</th>
                        <th>@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($payouts as $payout)
                        <tr>
                            <td>
                                @if($payout->exchangeRequest)
                                    <a href="{{ route('admin.exchangeView', ['id' => $payout->exchange_request_id]) }}">{{ $payout->exchangeRequest->utr }}</a>
                                @else
                                    N/A
                                @endif
                            </td>
                            <td>{{ ucfirst($payout->type) }}</td>
                            <td>{{ rtrim(rtrim(number_format($payout->amount, 8, '.', ''), '0'), '.') }} {{ $payout->currency_code }}</td>
                            <td class="text-wrap" style="max-width: 18rem;">{{ $payout->destination_wallet }}</td>
                            <td>
                                @if($payout->status === 'queued')
                                    <span class="badge bg-soft-warning text-warning">@lang('Queued')</span>
                                @elseif($payout->status === 'sent')
                                    <span class="badge bg-soft-success text-success">@lang('Sent')</span>
                                @elseif($payout->status === 'failed')
                                    <span class="badge bg-soft-danger text-danger">@lang('Failed')</span>
                                @else
                                    <span class="badge bg-soft-secondary text-secondary">{{ ucfirst($payout->status) }}</span>
                                @endif
                                @if($payout->tx_id)
                                    <div class="small text-muted mt-1">{{ $payout->tx_id }}</div>
                                @elseif($payout->error_message)
                                    <div class="small text-muted mt-1">{{ \Illuminate\Support\Str::limit($payout->error_message, 90) }}</div>
                                @endif
                            </td>
                            <td>{{ optional($payout->requested_at)->format('d M Y H:i') ?? 'N/A' }}</td>
                            <td>
                                @if(in_array($payout->status, ['queued', 'processing'], true))
                                    <div class="btn-group" role="group">
                                        <button type="button"
                                                class="btn btn-white btn-sm payout-send-btn"
                                                data-bs-toggle="modal"
                                                data-bs-target="#payoutSentModal"
                                                data-route="{{ route('admin.exchangePayoutMarkSent', $payout->id) }}">
                                            <i class="fal fa-paper-plane me-1"></i> @lang('Mark Sent')
                                        </button>
                                        <button type="button"
                                                class="btn btn-white btn-sm payout-fail-btn"
                                                data-bs-toggle="modal"
                                                data-bs-target="#payoutFailModal"
                                                data-route="{{ route('admin.exchangePayoutMarkFailed', $payout->id) }}">
                                            <i class="fal fa-times me-1"></i> @lang('Fail')
                                        </button>
                                    </div>
                                @else
                                    <span class="text-muted">-</span>
                                @endif
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="7" class="text-center py-5">@lang('No exchange payouts found')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
            <div class="card-footer">
                {{ $payouts->links() }}
            </div>
        </div>
    </div>

    <div class="modal fade" id="payoutSentModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">@lang('Mark Payout As Sent')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form method="post" class="payoutSentForm">
                    @csrf
                    <div class="modal-body">
                        <label class="form-label">@lang('On-chain Tx ID')</label>
                        <input type="text" class="form-control" name="tx_id" required>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-primary">@lang('Confirm')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div class="modal fade" id="payoutFailModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">@lang('Mark Payout As Failed')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form method="post" class="payoutFailForm">
                    @csrf
                    <div class="modal-body">
                        <label class="form-label">@lang('Failure Reason')</label>
                        <textarea class="form-control" name="error_message" rows="4" required></textarea>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-danger">@lang('Mark Failed')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
@endsection

@push('script')
    <script>
        'use strict';

        $(document).on('click', '.payout-send-btn', function () {
            $('.payoutSentForm').attr('action', $(this).data('route'));
        });

        $(document).on('click', '.payout-fail-btn', function () {
            $('.payoutFailForm').attr('action', $(this).data('route'));
        });
    </script>
@endpush
