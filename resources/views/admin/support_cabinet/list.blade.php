@extends('admin.layouts.app')
@section('page_title',__('Support Tickets'))
@push('css')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/flatpickr.min.css') }}">
@endpush
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link" href="javascript:void(0)">@lang("Dashboard")</a></li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Support Tickets")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Support Tickets")</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <a class="card card-hover-shadow h-100" href="{{ route('admin.support.tickets','all') }}">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("All Tickets")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['totalTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto"><i class="bi-ticket fs-2 text-body"></i></div>
                        </div>
                    </div>
                </a>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <a class="card card-hover-shadow h-100" href="{{ route('admin.support.tickets','answered') }}">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Answered")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['answerTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto"><i class="bi-check-circle fs-2 text-success"></i></div>
                        </div>
                    </div>
                </a>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <a class="card card-hover-shadow h-100" href="{{ route('admin.support.tickets','replied') }}">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Replied")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['repliedTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto"><i class="bi-reply fs-2 text-info"></i></div>
                        </div>
                    </div>
                </a>
            </div>
            <div class="col-sm-6 col-lg-3 mb-3 mb-lg-5">
                <a class="card card-hover-shadow h-100" href="{{ route('admin.support.tickets','closed') }}">
                    <div class="card-body">
                        <h6 class="card-subtitle mb-2">@lang("Closed")</h6>
                        <div class="row align-items-center gx-2">
                            <div class="col">
                                <span class="js-counter display-4 text-dark">{{ $ticketRecord[0]['closedTicket'] ?? 0 }}</span>
                            </div>
                            <div class="col-auto"><i class="bi-x-circle fs-2 text-danger"></i></div>
                        </div>
                    </div>
                </a>
            </div>
        </div>

        <div class="card">
            <div class="card-header card-header-content-md-between">
                <div class="mb-2 mb-md-0">
                    <h4 class="card-header-title">@lang('Ticket List')</h4>
                </div>
                <div class="d-flex gap-2">
                    <div class="input-group input-group-merge input-group-flush">
                        <div class="input-group-prepend input-group-text"><i class="bi-search"></i></div>
                        <input id="datatableSearch" type="search" class="form-control" placeholder="@lang('Search tickets')" aria-label="Search">
                    </div>
                </div>
            </div>
            <div class="table-responsive datatable-custom">
                <table class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                       data-hs-datatables-options='{
                           "order": [],
                           "info": {"totalQty": "#datatableEntriesInfoTotalQty"},
                           "ordering":false,
                           "pageLength": 25,
                           "entries": "#datatableEntries",
                           "isResponsive": false,
                           "isShowPaging": false,
                           "pagination": "datatableWithPaginationPagination"
                         }'>
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('No.')</th>
                        <th>@lang('User')</th>
                        <th>@lang('Subject')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Last Reply')</th>
                        <th>@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    </div>
@endsection
@push('script')
    <script>
        $(document).on('click', '.view-btn', function () {
            var route = $(this).data('route');
            window.location.href = route;
        });
    </script>
@endpush
