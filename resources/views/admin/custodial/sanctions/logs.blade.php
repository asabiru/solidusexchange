@extends('admin.layouts.app')
@section('page_title',__('AML Review Queue'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.sanctionedIndex') }}">Sanctions</a></li>
                            <li class="breadcrumb-item active" aria-current="page">AML Review Queue</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">AML Review Queue</h1>
                    <p class="page-header-text text-muted mb-0">Filter flagged deposits and destination wallet checks, then jump straight into the related admin card.</p>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-white me-2" href="{{ route('admin.sanctionedLogs', ['needs_review' => 1]) }}">
                        <i class="bi-exclamation-triangle me-1"></i> Needs Review
                    </a>
                    <a class="btn btn-outline-primary" href="{{ route('admin.sanctionedIndex') }}">
                        <i class="bi-arrow-left me-1"></i> Back to Sanctions
                    </a>
                </div>
            </div>
        </div>

        <div class="row mb-4">
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-body mb-1">{{ $stats['total'] }}</h5>
                        <p class="card-text small text-muted mb-0">Latest AML cases</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-warning mb-1">{{ $stats['flagged'] }}</h5>
                        <p class="card-text small text-muted mb-0">Non-clean latest cases</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3 mb-3 mb-md-0">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-success mb-1">{{ $stats['resolved'] }}</h5>
                        <p class="card-text small text-muted mb-0">Resolved cases</p>
                    </div>
                </div>
            </div>
            <div class="col-sm-6 col-md-3">
                <div class="card">
                    <div class="card-body text-center">
                        <h5 class="card-title text-info mb-1">{{ $stats['wallet_reviews'] }}</h5>
                        <p class="card-text small text-muted mb-0">Wallet review cases</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="card mb-3">
            <div class="card-body">
                <form id="logFiltersForm" class="row g-2 align-items-end">
                    <div class="col-md-3">
                        <label class="form-label small">Result</label>
                        <select id="resultFilter" class="form-select form-select-sm">
                            <option value="">All</option>
                            <option value="clean" @selected(request('result') === 'clean')>Clean</option>
                            <option value="partial_match" @selected(request('result') === 'partial_match')>Partial match</option>
                            <option value="match" @selected(request('result') === 'match')>Match</option>
                            <option value="error" @selected(request('result') === 'error')>Error</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small">Provider</label>
                        <select id="providerFilter" class="form-select form-select-sm">
                            <option value="">All</option>
                            @foreach($providerOptions as $providerValue => $providerLabel)
                                <option value="{{ $providerValue }}" @selected(request('provider') === $providerValue)>{{ $providerLabel }}</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small">Flow</label>
                        <select id="screenableTypeFilter" class="form-select form-select-sm">
                            <option value="">All</option>
                            @foreach($screenableTypes as $class => $label)
                                <option value="{{ $class }}" @selected(request('screenable_type') === $class)>{{ $label }}</option>
                            @endforeach
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label small">Search</label>
                        <input id="queryFilter" type="text" class="form-control form-control-sm"
                               value="{{ request('query') }}" placeholder="Address, entity, provider">
                    </div>
                    <div class="col-md-6">
                        <div class="form-check mt-2">
                            <input id="needsReviewFilter" type="checkbox" class="form-check-input" @checked(request()->boolean('needs_review'))>
                            <label class="form-check-label" for="needsReviewFilter">Show only latest non-clean cases</label>
                        </div>
                        <div class="form-check mt-2">
                            <input id="latestOnlyFilter" type="checkbox" class="form-check-input" @checked(request()->boolean('latest_only', true))>
                            <label class="form-check-label" for="latestOnlyFilter">Collapse audit trail into latest case per record + address</label>
                        </div>
                    </div>
                    <div class="col-md-6 text-md-end">
                        <button type="submit" class="btn btn-sm btn-outline-primary me-2">
                            <i class="bi-funnel me-1"></i> Apply
                        </button>
                        <button type="button" id="resetFiltersBtn" class="btn btn-sm btn-white">
                            <i class="bi-arrow-counterclockwise me-1"></i> Reset
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive datatable-custom">
                <table id="datatable" class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{"ordering": false, "pageLength": 25}'>
                    <thead class="thead-light">
                        <tr>
                            <th>Time</th>
                            <th>Flow</th>
                            <th>Record</th>
                            <th>Address</th>
                            <th>Currency</th>
                            <th>Provider</th>
                            <th>Result</th>
                            <th>Review</th>
                            <th>Risk</th>
                            <th>Notes</th>
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
            const table = $('#datatable').DataTable({
                processing: true,
                serverSide: true,
                ajax: {
                    url: "{{ route('admin.sanctionedLogsList') }}",
                    data: function(data) {
                        data.result = $('#resultFilter').val();
                        data.provider = $('#providerFilter').val();
                        data.screenable_type = $('#screenableTypeFilter').val();
                        data.query = $('#queryFilter').val();
                        data.needs_review = $('#needsReviewFilter').is(':checked') ? 1 : 0;
                        data.latest_only = $('#latestOnlyFilter').is(':checked') ? 1 : 0;
                    }
                },
                columns: [
                    {data: 'checked_at', name: 'checked_at'},
                    {data: 'screenable_badge', name: 'screenable_type', orderable: false, searchable: false},
                    {data: 'screenable_ref', name: 'screenable_id', orderable: false, searchable: false},
                    {data: 'address_short', name: 'address', orderable: false, searchable: false},
                    {data: 'currency_code', name: 'currency_code'},
                    {data: 'provider_badge', name: 'provider', orderable: false, searchable: false},
                    {data: 'result_badge', name: 'result', orderable: false, searchable: false},
                    {data: 'review_status_badge', name: 'review_status_badge', orderable: false, searchable: false},
                    {data: 'risk_summary', name: 'risk_score', orderable: false, searchable: false},
                    {data: 'notes_preview', name: 'matched_entity', orderable: false, searchable: false},
                    {data: 'action', name: 'action', orderable: false, searchable: false},
                ]
            });

            $('#logFiltersForm').on('submit', function(event) {
                event.preventDefault();
                table.ajax.reload();
            });

            $('#resetFiltersBtn').on('click', function() {
                $('#resultFilter').val('');
                $('#providerFilter').val('');
                $('#screenableTypeFilter').val('');
                $('#queryFilter').val('');
                $('#needsReviewFilter').prop('checked', false);
                $('#latestOnlyFilter').prop('checked', true);
                table.ajax.reload();
            });
        });
    </script>
@endpush
