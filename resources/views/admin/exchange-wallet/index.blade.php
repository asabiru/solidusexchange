@extends('admin.layouts.app')
@section('page_title',__('Exchange Wallets'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Exchange Wallets')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('Exchange Wallets')</h1>
                </div>
                <div class="col-sm-auto">
                    <a href="{{ route('admin.exchangeWalletCreate') }}" class="btn btn-primary">
                        <i class="bi-plus-circle me-1"></i> @lang('Add Wallet')
                    </a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h4 class="card-title">@lang('Deposit Wallet Inventory')</h4>
            </div>
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Currency')</th>
                        <th>@lang('Address')</th>
                        <th>@lang('Network')</th>
                        <th>@lang('Label')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Allocation')</th>
                        <th>@lang('Auto Confirm')</th>
                        <th>@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($wallets as $wallet)
                        <tr>
                            <td>{{ $wallet->currency_code }}</td>
                            <td class="text-wrap" style="max-width: 24rem;">{{ $wallet->address }}</td>
                            <td>{{ $wallet->network ?: 'N/A' }}</td>
                            <td>{{ $wallet->label ?: 'N/A' }}</td>
                            <td>
                                @if($wallet->status)
                                    <span class="badge bg-soft-success text-success">@lang('Active')</span>
                                @else
                                    <span class="badge bg-soft-danger text-danger">@lang('Inactive')</span>
                                @endif
                            </td>
                            <td>
                                <span class="badge bg-soft-secondary text-secondary">{{ ucfirst($wallet->allocation_status) }}</span>
                            </td>
                            <td>
                                @php($watchStatus = $wallet->watch_status ?? 'not_configured')

                                @if($watchStatus === 'subscribed')
                                    <span class="badge bg-soft-success text-success">@lang('Webhook Active')</span>
                                @elseif($watchStatus === 'failed')
                                    <span class="badge bg-soft-danger text-danger">@lang('Webhook Failed')</span>
                                    @if($wallet->watch_error)
                                        <div class="small text-muted mt-1">{{ \Illuminate\Support\Str::limit($wallet->watch_error, 90) }}</div>
                                    @endif
                                @elseif($watchStatus === 'manual')
                                    <span class="badge bg-soft-warning text-warning">@lang('Manual Confirmation')</span>
                                @elseif($watchStatus === 'inactive')
                                    <span class="badge bg-soft-dark text-dark">@lang('Wallet Inactive')</span>
                                @else
                                    <span class="badge bg-soft-secondary text-secondary">@lang('Not Configured')</span>
                                @endif
                            </td>
                            <td>
                                <div class="btn-group" role="group">
                                    <form action="{{ route('admin.exchangeWalletSync', $wallet->id) }}" method="post">
                                        @csrf
                                        <button type="submit" class="btn btn-white btn-sm">
                                            <i class="fal fa-sync-alt me-1"></i> @lang('Sync')
                                        </button>
                                    </form>
                                    <a href="{{ route('admin.exchangeWalletEdit', $wallet->id) }}" class="btn btn-white btn-sm">
                                        <i class="fal fa-edit me-1"></i> @lang('Edit')
                                    </a>
                                    @if($wallet->allocation_status === 'available')
                                        <button type="button" class="btn btn-white btn-sm delete_btn"
                                                data-bs-toggle="modal"
                                                data-bs-target="#delete"
                                                data-route="{{ route('admin.exchangeWalletDelete', $wallet->id) }}">
                                            <i class="fal fa-trash"></i>
                                        </button>
                                    @endif
                                </div>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="8" class="text-center py-5">@lang('No exchange wallets found')</td>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
            <div class="card-footer">
                {{ $wallets->links() }}
            </div>
        </div>
    </div>
    @include('admin.delete-modal')
@endsection

@push('script')
    <script>
        'use strict';
        $(document).on('click', '.delete_btn', function () {
            $('#deleteModalBody').text('Are you sure you want to delete this exchange wallet?');
            $('.deleteModalRoute').attr('action', $(this).data('route'));
        });
    </script>
@endpush
