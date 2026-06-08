@extends('admin.layouts.app')
@section('page_title',__('Crypto Method'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0)">@lang("Dashboard")</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Crypto Method")</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Crypto Method")</h1>
                </div>
            </div>
        </div>


        <div class="row">
            <div class="col-lg-12">
                <div class=" alert alert-soft-dark" role="alert">
                    <div class="alert-box d-flex flex-wrap align-items-center">
                        <div class="flex-shrink-0">
                            <img class="avatar avatar-xl"
                                 src="{{ asset('assets/admin/img/oc-megaphone.svg') }}"
                                 alt="Image Description" data-hs-theme-appearance="default">
                            <img class="avatar avatar-xl"
                                 src="{{ asset('assets/admin/img/oc-megaphone-light.svg') }}"
                                 alt="Image Description" data-hs-theme-appearance="dark">
                        </div>

                        <div class="flex-grow-1 ms-3">
                            <h3 class=" mb-1">@lang("Attention!")</h3>
                            <div class="d-flex align-items-center">
                                <p class="mb-0 text-body"> @lang('You can activate only one cryptocurrency method at a time. If you choose the manual method, you must set the wallet address for each respective active cryptocurrency.')
                                </p>

                            </div>

                        </div>
                    </div>
                </div>
            </div>


            <div class="row">
                <div class="col-lg-12">
                    <div class="card">
                        <div class="card-header card-header-content-md-between">
                            <div class="mb-2 mb-md-0">
                                <div class="input-group input-group-merge navbar-input-group">
                                    <div class="input-group-prepend input-group-text">
                                        <i class="bi-search"></i>
                                    </div>
                                    <input type="search" id="datatableSearch"
                                           class="search form-control form-control-sm"
                                           placeholder="@lang('Search Method')"
                                           aria-label="@lang('Search Method')"
                                           autocomplete="off">
                                    <a class="input-group-append input-group-text" href="javascript:void(0)">
                                        <i id="clearSearchResultsIcon" class="bi-x d-none"></i>
                                    </a>
                                </div>
                            </div>
                        </div>
                        <div class=" table-responsive datatable-custom">
                            <table id="datatable"
                                   class="js-datatable table table-borderless table-thead-bordered table-nowrap table-align-middle card-table"
                                   data-hs-datatables-options='{
                                       "columnDefs": [{
                                          "targets": [0, 3],
                                          "orderable": false
                                        }],
                                        "ordering": false,
                                       "order": [],
                                       "info": {
                                         "totalQty": "#datatableWithPaginationInfoTotalQty"
                                       },
                                       "search": "#datatableSearch",
                                       "entries": "#datatableEntries",
                                       "pageLength": 20,
                                       "isResponsive": false,
                                       "isShowPaging": false,
                                       "pagination": "datatablePagination"
                                     }'>
                                <thead class="thead-light">
                                <tr>
                                    <th scope="col">@lang('Name')</th>
                                    <th scope="col">@lang('Status')</th>
                                    <th scope="col">@lang('Type')</th>
                                    <th scope="col">@lang('Action')</th>
                                </tr>
                                </thead>

                                <tbody>

                                </tbody>
                            </table>
                        </div>

                        <div class="card-footer">
                            <div class="row justify-content-center justify-content-sm-between align-items-sm-center">
                                <div class="col-sm mb-2 mb-sm-0">
                                    <div
                                        class="d-flex justify-content-center justify-content-sm-start align-items-center">
                                        <span class="me-2">@lang('Showing:')</span>
                                        <div class="tom-select-custom">
                                            <select id="datatableEntries"
                                                    class="js-select form-select form-select-borderless w-auto"
                                                    autocomplete="off"
                                                    data-hs-tom-select-options='{
                                                        "searchInDropdown": false,
                                                        "hideSearch": true
                                                      }'>
                                                <option value="10">10</option>
                                                <option value="15">15</option>
                                                <option value="20" selected>20</option>
                                                <option value="30">30</option>
                                            </select>
                                        </div>
                                        <span class="text-secondary me-2">@lang('of')</span>
                                        <span id="datatableWithPaginationInfoTotalQty"></span>
                                    </div>
                                </div>
                                <div class="col-sm-auto">
                                    <div class="d-flex  justify-content-center justify-content-sm-end">
                                        <nav id="datatablePagination" aria-label="Activity pagination"></nav>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        @include('admin.delete-modal')
        @endsection




        @push('css-lib')
            <link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
            <link rel="stylesheet" href="{{ asset('assets/admin/css/flatpickr.min.css') }}">
        @endpush


        @push('js-lib')
            <script src="{{ asset('assets/admin/js/tom-select.complete.min.js') }}"></script>
            <script src="{{ asset('assets/admin/js/jquery.dataTables.min.js') }}"></script>
            <script src="{{ asset('assets/admin/js/flatpickr.min.js') }}"></script>
            <script src="{{ asset('assets/admin/js/select.min.js') }}"></script>
        @endpush

        @push('script')
            <script>
                'use strict';
                $(document).on('click', '.delete_btn', function () {
                    let route = $(this).data('route');
                    $('#deleteModalBody').text('Are you sure you want to proceed with the deletion of this coin announce?');
                    $('.deleteModalRoute').attr('action', route);
                });


                $(document).on('ready', function () {

                    HSCore.components.HSFlatpickr.init('.js-flatpickr')
                    HSCore.components.HSTomSelect.init('.js-select', {
                        maxOptions: 250,
                    })

                    HSCore.components.HSDatatables.init($('#datatable'), {
                        processing: true,
                        serverSide: true,
                        ajax: {
                            url: "{{ route("admin.cryptoMethodSearch") }}",
                        },

                        columns: [
                            {data: 'name', name: 'name'},
                            {data: 'status', name: 'status'},
                            {data: 'type', name: 'type'},
                            {data: 'action', name: 'action'},
                        ],
                        language: {
                            zeroRecords: `<div class="text-center p-4">
                    <img class="dataTables-image mb-3" src="{{ asset('assets/admin/img/oc-error.svg') }}" alt="Image Description" data-hs-theme-appearance="default">
                    <img class="dataTables-image mb-3" src="{{ asset('assets/admin/img/oc-error-light.svg') }}" alt="Image Description" data-hs-theme-appearance="dark">
                    <p class="mb-0">No data to show</p>
                    </div>`,
                            processing: `<div><div></div><div></div><div></div><div></div></div>`
                        },

                    })
                });

            </script>
    @endpush
