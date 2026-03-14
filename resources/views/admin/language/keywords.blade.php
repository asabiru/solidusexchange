@extends('admin.layouts.app')
@section('page_title', __("$pageTitle"))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0)">@lang('Dashboard')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Language Setting')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang($language->name. ' Keywords')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-9">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card">
                        <div class="card-header d-flex align-items-center justify-content-between">
                            <h4 class="card-title h3 mt-2">@lang($language->name. ' Keywords')</h4>

                            <div class="dropdown">
                                <button type="button" class="btn btn-ghost-secondary btn-icon btn-sm rounded-circle"
                                        id="reportsOverviewDropdown1" data-bs-toggle="dropdown" aria-expanded="false">
                                    <i class="bi-three-dots-vertical"></i>
                                </button>
                                <div class="dropdown-menu dropdown-menu-end mt-1"
                                     aria-labelledby="reportsOverviewDropdown1">
                                    <span class="dropdown-header">@lang("Settings")</span>
                                    <button type="button" class="dropdown-item" data-bs-target="#addModal"
                                            data-bs-toggle="modal">
                                        <i class="bi bi-file-earmark-plus dropdown-item-icon"></i>@lang("Add Keyword")
                                    </button>
                                    <button type="button" class="dropdown-item" data-bs-toggle="modal"
                                            data-bs-target="#importModal">
                                        <i class="bi-download dropdown-item-icon"></i> @lang("Import Now")
                                    </button>
                                    <button type="button" class="dropdown-item" data-bs-toggle="modal"
                                            data-bs-target="#automatic_translate_modal">
                                        <i class="bi-alt dropdown-item-icon"></i> @lang("Automatic Translate Keyword")
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="row d-flex justify-content-end py-2 px-3">
                            <div class="col-md-4">
                                <div class="input-group input-group-merge navbar-input-group">
                                    <div class="input-group-prepend input-group-text">
                                        <i class="bi-search"></i>
                                    </div>
                                    <input type="search" id="datatableSearch"
                                           class="search form-control form-control-sm"
                                           placeholder="@lang('Search KYC')"
                                           aria-label="@lang('Search KYC')"
                                           autocomplete="off">
                                    <a class="input-group-append input-group-text" href="javascript:void(0)">
                                        <i id="clearSearchResultsIcon" class="bi-x d-none"></i>
                                    </a>
                                </div>
                            </div>
                        </div>

                        <div class="table-responsive datatable-custom">
                            <table
                                class="js-datatable table table-borderless table-nowrap table-align-middle card-table"
                                data-hs-datatables-options='{
                                               "order": [],
                                               "info": {
                                                 "totalQty": "#datatableEntriesInfoTotalQty"
                                               },
                                               "ordering": false,
                                               "search": "#datatableSearch",
                                               "entries": "#datatableEntries",
                                               "isResponsive": false,
                                               "isShowPaging": false,
                                               "pagination": "datatableEntriesPagination"
                                             }'>
                                <thead class="thead-light">
                                <tr>
                                    <th>@lang('Sl.')</th>
                                    <th>@lang('Key')</th>
                                    <th>{{ __($language->name) }}</th>
                                    <th>@lang('Action')</th>
                                </tr>
                                </thead>
                                <tbody>
                                @forelse($keywords as $key => $keyword)
                                    <tr>
                                        <td>{{ $loop->index + 1 }}</td>
                                        <td>{{ __($key) }}</td>
                                        <td>{{ __($keyword) }}</td>
                                        <td>
                                            <div class="btn-group" role="group">
                                                <a class="btn btn-white btn-sm edit-keyword-btn"
                                                   data-key="{{ __($key) }}"
                                                   data-value="{{ $keyword }}"
                                                   data-route="{{ route('admin.update.language.keyword',[$language->short_name, urlencode($key)]) }}"
                                                   data-bs-toggle="modal" data-bs-target="#editKeywordModal">
                                                    <i class="bi-pencil-fill me-1"></i> @lang('Edit')
                                                </a>
                                                <div class="btn-group">
                                                    <button type="button"
                                                            class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty"
                                                            id="keywordEditDropdown" data-bs-toggle="dropdown"
                                                            aria-expanded="false">
                                                    </button>
                                                    <div class="dropdown-menu dropdown-menu-end mt-1"
                                                         aria-labelledby="keywordEditDropdown">
                                                        <a class="dropdown-item deleteKey" href="javascript:void(0)" data-bs-toggle="modal"
                                                           data-keyword="{{ $keyword }}"
                                                           data-bs-target="#deleteModal">
                                                            <i class="bi-trash dropdown-item-icon"></i> @lang('Delete')
                                                        </a>
                                                    </div>

                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                @empty
                                <tr>
                                    <div class="text-center p-4">
                                        <img class="dataTables-image mb-3" src="{{ asset('assets/admin/img/oc-error.svg') }}" alt="Image Description" data-hs-theme-appearance="default">
                                        <img class="dataTables-image mb-3" src="{{ asset('assets/admin/img/oc-error-light.svg') }}" alt="Image Description" data-hs-theme-appearance="dark">
                                        <p class="mb-0">@lang("No data to show")</p>
                                    </div>
                                </tr>
                                @endforelse
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
                                        <span id="datatableEntriesInfoTotalQty"></span>
                                    </div>
                                </div>
                                <div class="col-sm-auto">
                                    <div class="d-flex justify-content-center justify-content-sm-end">
                                        <nav id="datatableEntriesPagination" aria-label="Activity pagination"></nav>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>



    <!-- Add Keyword Modal -->
    <div class="modal fade" id="addModal" tabindex="-1" role="dialog" aria-labelledby="addLabel" data-bs-backdrop="static"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h4 class="modal-title" id="addLabel"><i class="fa-light fa-square-plus"></i> @lang("Add Keyword")</h4>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{ route('admin.add.language.keyword', $language->short_name) }}" method="post"
                      class="add-keyword-form">
                    @csrf
                    <div class="modal-body">
                        <div class="form-group mb-3">
                            <label class="form-label" for="exampleFormControlInput1">@lang('Key')</label>
                            <input type="text" class="form-control input-field" id="key" name="key"
                                   placeholder="@lang('Enter key')"
                                   value="{{ old('key') }}" autocomplete="off">
                            <span class="text-danger value-error"></span>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="exampleFormControlInput1">@lang('Value')</label>
                            <input type="text" class="form-control input-field" id="value" name="value"
                                   placeholder="@lang('Enter value')" value="{{ old('value') }}" autocomplete="off">
                            <span class="text-danger value-error"></span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">Close</button>
                        <button type="submit" class="btn btn-primary"> @lang('Save Changes')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    <!-- End Keyword Modal -->


    <!-- Edit Modal -->
    <div class="modal fade" id="editKeywordModal" tabindex="-1" role="dialog" aria-labelledby="editKeywordModalLabel" data-bs-backdrop="static"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content pulse-loader">
                <div class="modal-header">
                    <h4 class="modal-title" id="editKeywordModalLabel"><i class="fa fa-edit"></i> @lang("Edit Keyword")</h4>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="" method="post" class="edit-keyword-form">
                    @csrf
                    @method('put')
                    <div class="modal-body">
                        <div class="form-group ">
                            <label class="edit-key form-label" for="nameLabel"></label>
                            <div class="input-group">
                                <input type="text" class="form-control edit-value input-field" name="value"
                                       placeholder="Value" aria-label="Value"
                                       aria-describedby="basic-addon2">
                                <button type="button" class="input-group-text translate_btn"
                                        data-route="{{ route('admin.single.keyword.translate') }}"
                                        id="basic-addon2">
                                    <i class="fa-sharp fa-light fa-language"></i>
                                </button>
                            </div>
                            <span class="text-danger value-error"></span>
                        </div>
                        <input type="hidden" name="key">
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-light"
                                data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-sm btn-primary">@lang('Save Changes')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    <!-- End Edit Modal -->

    <!-- Delete Modal -->
    <div class="modal fade" id="deleteModal" tabindex="-1" role="dialog" aria-labelledby="deleteModalLabel" data-bs-backdrop="static"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h4 class="modal-title" id="deleteModalLabel"><i class="bi bi-check2-square"></i> @lang("Confirmation")</h4>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p>@lang('Do you want to delete this') <span class="keyword"></span> @lang("keyword?")</p>
                </div>
                <form action="{{ route('admin.delete.language.keyword',[$language->short_name, urlencode($key??null)]) }}"
                      method="post">
                    @csrf
                    @method('delete')
                    <input type="hidden" name="key">
                    <input type="hidden" name="value">
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-light" data-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-sm btn-primary ">@lang('Confirm')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    <!-- End Delete Modal -->

    <!-- Import Modal -->
    <div class="modal fade" id="importModal" tabindex="-1" role="dialog" aria-labelledby="importModalLabel" data-bs-backdrop="static"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h4 class="modal-title" id="TranslateModalLabel"><i class="fa-light fa-file-import"></i> @lang("Import Keywords")</h4>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{ route('admin.language.import.json') }}" method="post">
                    @csrf
                    <div class="modal-body">
                        <div class="form-group ">
                            <label for="inputName" class="form-label form-title">@lang('Import Keywords')</label>
                            <div class="tom-select-custom">
                                <input type="hidden" name="my_lang" value="{{ $language->id }}">
                                <select class="js-select form-select" autocomplete="off" name="lang_id"
                                        data-hs-tom-select-options='{
                                          "placeholder": "Import Languages",
                                          "hideSearch": true
                                        }'>
                                    @foreach($languages as $data)
                                        @if($data->id != $language->id)
                                            <option value="{{ $data->id }}">{{ __($data->name) }}</option>
                                        @endif
                                    @endforeach
                                </select>
                            </div>
                            <small
                                class="text-info">@lang("If you import keywords from another language, Your present `$language->name` all keywords will remove.")</small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-white"
                                data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-sm btn-primary import-language">@lang('Import')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    <!-- End Import Modal -->


    <!-- Delete Modal -->
    <div class="modal fade" id="automatic_translate_modal" tabindex="-1" role="dialog" data-bs-backdrop="static"
         aria-labelledby="TranslateModalLabel"
         aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h4 class="modal-title" id="TranslateModalLabel"><i class="bi bi-check2-square"></i> @lang("Confirmation")</h4>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{ route('admin.all.keyword.translate', $language->short_name) }}" method="post">
                    @csrf
                    <div class="modal-body">
                        <span>@lang('Do you want to translate all keyword?')</span>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-light" data-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-sm btn-primary ">@lang('Confirm')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    <!-- End Delete Modal -->

@endsection

@push('css-lib')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
@endpush

@push('js-lib')
    <script src="{{ asset('assets/admin/js/jquery.dataTables.min.js') }}"></script>
    <script src="{{ asset('assets/admin/js/tom-select.complete.min.js') }}"></script>
@endpush

@push('script')
    <script>
        'use strict';
        $(document).ready(function () {

            $(document).on('click', '.deleteKey', function () {
                let keyword = $(this).data('keyword');
                $(".keyword").text(keyword);
            });

            var key = "";
            var value = "";
            $(document).on('click', '.edit-keyword-btn', function () {
                key = $(this).data('key');
                value = $(this).data('value');
                let route = $(this).data('route');

                $('.edit-key').text(key);
                $('.edit-value').val(value);
                $('.edit-keyword-form').attr('action', route);
            });

            $(document).on('input', '.input-field', function () {
                let val = $(this).val();
                if (val.length) {
                    $(this).siblings('.text-danger').text('');
                }
            });

            $(document).on('submit', '.add-keyword-form, .edit-keyword-form', function (e) {
                e.preventDefault();
                let formData = new FormData($(this)[0]);
                let url = $(this).attr('action');
                sendRequest(url, formData, $(this)[0]);
            });

            function sendRequest(url, formData, _this) {
                $.ajax({
                    url: url,
                    method: "POST",
                    data: formData,
                    async: false,
                    cache: false,
                    contentType: false,
                    processData: false,
                    beforeSend: function () {
                        $('.value-error').text();
                        Notiflix.Block.pulse('.pulse-loader');
                    },
                    success: function (response) {
                        if (response.url) {
                            location.reload();
                        }
                    },
                    error: function (response) {
                        let errors = response.responseJSON.errors;
                        for (let error in errors) {
                            $(_this).find(`.${error}-error`).text(response.responseJSON.errors[error][0]);
                        }
                    },
                    complete: function () {
                        Notiflix.Block.remove('.pulse-loader');
                    }
                });
            }


            $(document).on('click', '.translate_btn', function () {
                $('.edit-value').val("");
                let shortName = "{{$language->short_name}}";
                let route = $(this).data('route');
                $.ajax({
                    type: "post",
                    url: route,
                    data: {
                        shortName: shortName,
                        key: key,
                        value: value,
                        _token: "{{csrf_token()}}"
                    },
                    success: function (data) {
                        $('.edit-value').val(data.translatedText);
                        Notiflix.Notify.success(data.message);
                    },
                    error: function (res) {

                    }
                });
            })


        });

        (function () {
            HSCore.components.HSTomSelect.init('.js-select')
            HSCore.components.HSDatatables.init($('.js-datatable'), {
                language: {
                    zeroRecords: `<div class="text-center p-4">
                          <img class="dataTables-image mb-3" src="{{ asset("assets/admin/img/oc-error.svg") }}" alt="Image Description" data-hs-theme-appearance="default">
                          <img class="dataTables-image mb-3" src="{{ asset("assets/admin/img/oc-error-light.svg") }}" alt="Image Description" data-hs-theme-appearance="dark">
                        <p class="mb-0">{{ trans("No data to show") }}</p>
                        </div>`
                }
            });

        })()

    </script>
@endpush



