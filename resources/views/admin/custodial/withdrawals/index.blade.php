@extends('admin.layouts.app')
@section('page_title',__('Custodial Withdrawals'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.custodialWalletIndex') }}">Custodial Wallets</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Withdrawals")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Custodial Withdrawals")</h1>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-outline-primary" href="{{ route('admin.custodialWalletIndex') }}">
                        <i class="bi-wallet2 me-1"></i> @lang('Wallets')
                    </a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive datatable-custom">
                <table id="datatable" class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{
                           "columnDefs": [{"targets": [0, 8], "orderable": false}],
                           "ordering": false,
                           "order": [],
                           "pageLength": 20
                       }'>
                    <thead class="thead-light">
                        <tr>
                            <th>ID</th>
                            <th>From</th>
                            <th>To</th>
                            <th>Currency</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Status</th>
                            <th>TXID</th>
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
                ajax: "{{ route('admin.custodialWithdrawalList') }}",
                columns: [
                    {data: 'id', name: 'id'},
                    {data: 'wallet_address', name: 'wallet_address'},
                    {data: 'to_short', name: 'to_short'},
                    {data: 'currency_code', name: 'currency_code'},
                    {data: 'amount', name: 'amount'},
                    {data: 'fee', name: 'fee'},
                    {data: 'status_badge', name: 'status_badge'},
                    {data: 'tx_link', name: 'tx_link'},
                    {data: 'action', name: 'action', orderable: false},
                ],
            });
        });
    </script>
@endpush
