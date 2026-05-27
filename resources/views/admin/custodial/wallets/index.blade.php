@extends('admin.layouts.app')
@section('page_title',__('Custodial Wallets'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Custodial Wallets")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Custodial Wallets")</h1>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-outline-primary me-2" href="{{ route('admin.custodialCheckAllBalances') }}">
                        <i class="bi-wallet2 me-1"></i> @lang('Check Balances')
                    </a>
                    <a class="btn btn-outline-secondary me-2" href="{{ route('admin.custodialScanNow') }}">
                        <i class="bi-search me-1"></i> @lang('Scan Deposits')
                    </a>
                    <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#generateWalletModal">
                        <i class="bi-plus me-1"></i> @lang('Generate Wallet')
                    </button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive datatable-custom">
                <table id="datatable" class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{
                           "columnDefs": [{"targets": [0, 7], "orderable": false}],
                           "ordering": false,
                           "order": [],
                           "pageLength": 20
                       }'>
                    <thead class="thead-light">
                        <tr>
                            <th>ID</th>
                            <th>Currency</th>
                            <th>Address</th>
                            <th>Provider</th>
                            <th>Derivation</th>
                            <th>Status</th>
                            <th>Assignment</th>
                            <th>Balance</th>
                            <th>Last Deposit</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Generate Wallet Modal -->
    <div class="modal fade" id="generateWalletModal" tabindex="-1">
        <div class="modal-dialog">
            <form action="{{ route('admin.custodialWalletGenerate') }}" method="POST">
                @csrf
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Generate HD Wallet</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Currency Code</label>
                            <select name="currency_code" class="form-select" required>
                                <option value="USDT_TRC20">USDT (TRC20)</option>
                                <option value="USDT">USDT (ERC20)</option>
                                <option value="BTC">BTC</option>
                                <option value="ETH">ETH</option>
                                <option value="BNB">BNB (BEP20)</option>
                                <option value="SOL">SOL</option>
                                <option value="TRX">TRX</option>
                                <option value="TON">TON</option>
                                <option value="LTC">LTC</option>
                            </select>
                        </div>
                        <div class="alert alert-soft-info small">
                            <i class="bi-info-circle me-1"></i>
                            Wallet will be generated using HD derivation from the master mnemonic.
                            Private keys are encrypted and stored securely.
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Generate</button>
                    </div>
                </div>
            </form>
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
                ajax: "{{ route('admin.custodialWalletList') }}",
                columns: [
                    {data: 'id', name: 'id'},
                    {data: 'currency_code', name: 'currency_code'},
                    {data: 'address_short', name: 'address_short'},
                    {data: 'provider_badge', name: 'provider_badge'},
                    {data: 'derivation', name: 'derivation'},
                    {data: 'status_badge', name: 'status_badge'},
                    {data: 'assignment', name: 'assignment'},
                    {data: 'balance_info', name: 'balance_info'},
                    {data: 'last_deposit', name: 'last_deposit'},
                    {data: 'action', name: 'action', orderable: false},
                ],
            });
        });
    </script>
@endpush
