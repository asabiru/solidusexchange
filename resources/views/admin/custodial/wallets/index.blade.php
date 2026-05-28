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
                    <div class="d-inline-flex align-items-center me-3 mb-2 mb-sm-0">
                        <span id="walletLiveStatusDot" class="badge bg-soft-success text-success me-2">Live</span>
                        <small class="text-muted">Last sync: <span id="walletLiveLastSync">—</span></small>
                    </div>
                    <form action="{{ route('admin.custodialCheckAllBalances') }}" method="POST" class="d-inline">
                        @csrf
                        <button type="submit" class="btn btn-outline-primary me-2">
                            <i class="bi-wallet2 me-1"></i> @lang('Check Balances')
                        </button>
                    </form>
                    <form action="{{ route('admin.custodialScanNow') }}" method="POST" class="d-inline">
                        @csrf
                        <button type="submit" class="btn btn-outline-secondary me-2">
                            <i class="bi-search me-1"></i> @lang('Scan Deposits')
                        </button>
                    </form>
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
            const table = $('#datatable').DataTable({
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

            const refreshUrl = "{{ route('admin.custodialWalletBalancesRefresh') }}";
            const csrfToken = $('meta[name="csrf-token"]').attr('content');
            let refreshInFlight = false;
            let lastSyncLabel = null;

            const setLiveBadge = (state, label) => {
                const $badge = $('#walletLiveStatusDot');
                $badge.removeClass('bg-soft-success text-success bg-soft-warning text-warning bg-soft-danger text-danger');

                if (state === 'loading') {
                    $badge.addClass('bg-soft-warning text-warning').text('Syncing');
                } else if (state === 'error') {
                    $badge.addClass('bg-soft-danger text-danger').text('Error');
                } else {
                    $badge.addClass('bg-soft-success text-success').text('Live');
                }

                if (label) {
                    $('#walletLiveLastSync').text(label);
                }
            };

            const refreshBalances = async () => {
                if (refreshInFlight || document.hidden) {
                    return;
                }

                refreshInFlight = true;
                setLiveBadge('loading', lastSyncLabel || 'syncing...');

                try {
                    const response = await $.ajax({
                        method: 'POST',
                        url: refreshUrl,
                        headers: {
                            'X-CSRF-TOKEN': csrfToken,
                            'Accept': 'application/json',
                        },
                    });

                    lastSyncLabel = new Date(response.completed_at).toLocaleTimeString();
                    setLiveBadge('live', lastSyncLabel);
                    table.ajax.reload(null, false);
                } catch (error) {
                    setLiveBadge('error', 'sync failed');
                } finally {
                    refreshInFlight = false;
                }
            };

            refreshBalances();
            setInterval(refreshBalances, 30000);

            document.addEventListener('visibilitychange', function() {
                if (!document.hidden) {
                    refreshBalances();
                }
            });
        });
    </script>
@endpush
