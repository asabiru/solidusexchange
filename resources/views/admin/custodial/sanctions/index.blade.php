@extends('admin.layouts.app')
@section('page_title',__('Sanctions List'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.custodialWalletIndex') }}">Custodial</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Sanctions List")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Sanctions List")</h1>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-outline-info me-2" href="{{ route('admin.sanctionedLogs') }}">
                        <i class="bi-journal me-1"></i> Screening Logs
                    </a>
                    <button class="btn btn-outline-primary me-2" data-bs-toggle="modal" data-bs-target="#importModal">
                        <i class="bi-upload me-1"></i> Import
                    </button>
                    <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addModal">
                        <i class="bi-plus me-1"></i> Add Address
                    </button>
                </div>
            </div>
        </div>

        {{-- Stats cards --}}
        <div class="row mb-4">
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-danger">{{ $stats['blocked'] }}</h5>
                        <p class="card-text small text-muted">Blocked</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-warning">{{ $stats['high_risk'] }}</h5>
                        <p class="card-text small text-muted">High Risk</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-info">{{ $stats['monitor'] }}</h5>
                        <p class="card-text small text-muted">Monitor</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-body">{{ $stats['sources'] }}</h5>
                        <p class="card-text small text-muted">Sources</p>
                    </div>
                </div>
            </div>
        </div>

        {{-- Filters --}}
        <div class="card mb-3">
            <div class="card-body">
                <form method="GET" class="row g-2 align-items-end">
                    <div class="col-md-3">
                        <label class="form-label small">Source</label>
                        <select name="source" class="form-select form-select-sm">
                            <option value="">All</option>
                            <option value="ofac">OFAC (US)</option>
                            <option value="eu">EU</option>
                            <option value="uk">UK OFSI</option>
                            <option value="un">UN</option>
                            <option value="russia_cb">ЦБ РФ</option>
                            <option value="russia_min">Минфин РФ</option>
                            <option value="manual">Manual</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small">Severity</label>
                        <select name="severity" class="form-select form-select-sm">
                            <option value="">All</option>
                            <option value="blocked">Blocked</option>
                            <option value="high_risk">High Risk</option>
                            <option value="monitor">Monitor</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small">Status</label>
                        <select name="status" class="form-select form-select-sm">
                            <option value="">All</option>
                            <option value="active">Active</option>
                            <option value="expired">Expired</option>
                            <option value="revoked">Revoked</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <button type="submit" class="btn btn-sm btn-outline-primary"><i class="bi-funnel"></i> Filter</button>
                    </div>
                </form>
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
                            <th>Address</th>
                            <th>Currency</th>
                            <th>Source</th>
                            <th>Entity</th>
                            <th>Type</th>
                            <th>Severity</th>
                            <th>Status</th>
                            <th>List Date</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>

    {{-- Add Address Modal --}}
    <div class="modal fade" id="addModal" tabindex="-1">
        <div class="modal-dialog">
            <form action="{{ route('admin.sanctionedAddressStore') }}" method="POST">
                @csrf
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Add Sanctioned Address</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Address <span class="text-danger">*</span></label>
                            <input type="text" name="address" class="form-control" required placeholder="0x... or bc1... or T...">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Currency</label>
                            <select name="currency_code" class="form-select">
                                <option value="">All chains</option>
                                <option value="BTC">BTC</option>
                                <option value="ETH">ETH</option>
                                <option value="USDT_TRC20">USDT (TRC20)</option>
                                <option value="TRX">TRX</option>
                                <option value="BNB">BNB</option>
                                <option value="SOL">SOL</option>
                                <option value="TON">TON</option>
                                <option value="LTC">LTC</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Source <span class="text-danger">*</span></label>
                            <select name="source" class="form-select" required>
                                <option value="ofac">OFAC (US Treasury)</option>
                                <option value="eu">EU Sanctions</option>
                                <option value="uk">UK OFSI</option>
                                <option value="un">UN Security Council</option>
                                <option value="russia_cb">ЦБ РФ</option>
                                <option value="russia_min">Минфин РФ</option>
                                <option value="manual">Manual (Admin)</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Entity Name</label>
                            <input type="text" name="entity_name" class="form-control" placeholder="e.g. Garantex, Tornado Cash">
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Entity Type</label>
                            <select name="entity_type" class="form-select">
                                <option value="exchange">Exchange</option>
                                <option value="mixer">Mixer</option>
                                <option value="darknet">Darknet</option>
                                <option value="individual">Individual</option>
                                <option value="terrorist">Terrorist Org</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Severity <span class="text-danger">*</span></label>
                            <select name="severity" class="form-select" required>
                                <option value="blocked">Blocked (auto-reject)</option>
                                <option value="high_risk">High Risk (manual review)</option>
                                <option value="monitor">Monitor (log only)</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Reason</label>
                            <textarea name="reason" class="form-control" rows="2" placeholder="Why is this address sanctioned?"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-danger">Add to Sanctions List</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    {{-- Import Modal --}}
    <div class="modal fade" id="importModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <form action="{{ route('admin.sanctionedAddressImport') }}" method="POST">
                @csrf
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Bulk Import Sanctioned Addresses</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Addresses <span class="text-danger">*</span></label>
                            <textarea name="import_data" class="form-control font-monospace" rows="10" required
                                placeholder="One address per line. Format: address,currency_code&#10;Example:&#10;0x1234...,ETH&#10;bc1qabcd...,BTC&#10;TAbcd123...,TRX"></textarea>
                            <small class="text-muted">One address per line. Optional: address,CURRENCY_CODE. Lines starting with # are ignored.</small>
                        </div>
                        <div class="row">
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Source <span class="text-danger">*</span></label>
                                <select name="source" class="form-select" required>
                                    <option value="ofac">OFAC (US)</option>
                                    <option value="eu">EU</option>
                                    <option value="uk">UK OFSI</option>
                                    <option value="un">UN</option>
                                    <option value="russia_cb">ЦБ РФ</option>
                                    <option value="russia_min">Минфин РФ</option>
                                    <option value="manual">Manual</option>
                                </select>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Severity <span class="text-danger">*</span></label>
                                <select name="severity" class="form-select" required>
                                    <option value="blocked">Blocked</option>
                                    <option value="high_risk">High Risk</option>
                                    <option value="monitor">Monitor</option>
                                </select>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Entity Name</label>
                                <input type="text" name="entity_name" class="form-control" placeholder="e.g. Garantex">
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Reason</label>
                            <textarea name="reason" class="form-control" rows="2" placeholder="Reason for all imported addresses"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Import</button>
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
                ajax: {
                    url: "{{ route('admin.sanctionedAddressList') }}",
                    data: function(d) {
                        d.source = $('[name=source]').val();
                        d.severity = $('[name=severity]').val();
                        d.status = $('[name=status]').val();
                    }
                },
                columns: [
                    {data: 'id', name: 'id'},
                    {data: 'address_short', name: 'address_short'},
                    {data: 'currency_code', name: 'currency_code', defaultContent: 'All'},
                    {data: 'source_badge', name: 'source_badge'},
                    {data: 'entity_name', name: 'entity_name'},
                    {data: 'entity_type', name: 'entity_type'},
                    {data: 'severity_badge', name: 'severity_badge'},
                    {data: 'status_badge', name: 'status_badge'},
                    {data: 'list_date', name: 'list_date'},
                    {data: 'action', name: 'action', orderable: false},
                ],
            });
        });
    </script>
@endpush
