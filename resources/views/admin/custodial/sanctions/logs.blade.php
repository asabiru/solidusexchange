@extends('admin.layouts.app')
@section('page_title',__('AML Screening Logs'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="{{ route('admin.sanctionedIndex') }}">Sanctions</a></li>
                            <li class="breadcrumb-item active" aria-current="page">Screening Logs</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">AML Screening Logs</h1>
                </div>
                <div class="col-sm-auto">
                    <a class="btn btn-outline-primary" href="{{ route('admin.sanctionedIndex') }}">
                        <i class="bi-arrow-left me-1"></i> Back to Sanctions
                    </a>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive datatable-custom">
                <table id="datatable" class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{"ordering": false, "pageLength": 25}'>
                    <thead class="thead-light">
                        <tr>
                            <th>ID</th>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Address</th>
                            <th>Currency</th>
                            <th>Provider</th>
                            <th>Result</th>
                            <th>Entity</th>
                            <th>Risk</th>
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
                ajax: "{{ route('admin.sanctionedLogsList') }}",
                columns: [
                    {data: 'id', name: 'id'},
                    {data: 'checked_at', name: 'checked_at'},
                    {data: 'screenable_type', name: 'screenable_type'},
                    {data: 'address', name: 'address'},
                    {data: 'currency_code', name: 'currency_code'},
                    {data: 'provider', name: 'provider'},
                    {data: 'result_badge', name: 'result_badge'},
                    {data: 'matched_entity', name: 'matched_entity'},
                    {data: 'risk_score', name: 'risk_score'},
                ],
            });
        });
    </script>
@endpush
