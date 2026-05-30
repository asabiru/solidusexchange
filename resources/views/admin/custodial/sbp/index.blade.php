@extends('admin.layouts.app')
@section('page_title',__('SBP QR платежи'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.custodialWalletIndex') }}">Custodial</a></li>
                            <li class="breadcrumb-item active" aria-current="page">SBP QR платежи</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">SBP QR платежи</h1>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-outline-secondary me-2" href="{{ route('admin.sbpSettings') }}">
                        <i class="bi-gear me-1"></i> Settings
                    </a>
                </div>
            </div>
        </div>

        {{-- Stats cards --}}
        <div class="row mb-4">
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-body">{{ $stats['total'] }}</h5>
                        <p class="card-text small text-muted">Total</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-warning">{{ $stats['pending'] }}</h5>
                        <p class="card-text small text-muted">Pending</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-success">{{ $stats['paid'] }}</h5>
                        <p class="card-text small text-muted">Оплачено / Подтверждено</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-secondary">{{ $stats['expired'] }}</h5>
                        <p class="card-text small text-muted">Expired</p>
                    </div>
                </div>
            </div>
        </div>

        {{-- Table --}}
        <div class="card">
            <div class="table-responsive datatable-custom">
                <table id="datatable" class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{"ordering": false, "pageLength": 25}'>
                    <thead class="thead-light">
                        <tr>
                            <th>ID</th>
                            <th>Order</th>
                            <th>Amount</th>
                            <th>Provider</th>
                            <th>Status</th>
                            <th>Привязан к</th>
                            <th>Created</th>
                            <th>Оплачено</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>
@endsection

@push('js-lib')
    <script src="{{ asset('assets/admin/js/jquery.dataTables.min.js') }}"></script>
@endpush

@push('script')
    <script>
        $(document).ready(function() {
            $('#datatable').DataTable({
                processing: true,
                serverSide: true,
                ajax: "{{ route('admin.sbpList') }}",
                columns: [
                    {data: 'id', name: 'id'},
                    {data: 'order_id', name: 'order_id'},
                    {data: 'amount', name: 'amount'},
                    {data: 'provider_badge', name: 'provider_badge'},
                    {data: 'status_badge', name: 'status_badge'},
                    {data: 'payable_link', name: 'payable_link'},
                    {data: 'created_at', name: 'created_at'},
                    {data: 'paid_at', name: 'paid_at'},
                    {data: 'action', name: 'action', orderable: false},
                ],
            });
        });
    </script>
@endpush
