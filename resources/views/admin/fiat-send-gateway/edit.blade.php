@extends('admin.layouts.app')
@section('page_title', __('Edit Fiat Send Gateway'))
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
                            <li class="breadcrumb-item active" aria-current="page">@lang("Fiat Send Gateway")</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang("Edit " . $method->name)</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang("Edit " . $method->name)</h1>
                </div>
            </div>
        </div>

        <div class="row payment_method">
            <div class="col-lg-12">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between">
                            <h3 class="card-title mt-2">@lang("Edit " . $method->name)</h3>
                        </div>
                        <div class="card-body mt-2">
                            <form action="{{route('admin.fiatSendGatewayUpdate',$method)}}" method="post"
                                  enctype="multipart/form-data" id="myForm">
                                @csrf
                                @method('put')
                                <div class="row mb-4 d-flex align-items-center">
                                    <div class="col-sm-6">
                                        <label for="nameLabel" class="form-label">@lang('Name')</label>
                                        <input type="text" class="form-control"
                                               name="name" id="nameLabel"
                                               placeholder="Name" aria-label="Name" autocomplete="off"
                                               value="{{ old('name', $method->name ?? '') }}">
                                        @error('name')
                                        <span class="invalid-feedback d-block">{{ $message }}</span>
                                        @enderror
                                    </div>
                                    <div class="col-md-6">
                                        <label class="form-label">@lang('Processing Mode')</label>
                                        <div class="tom-select-custom">
                                            <select class="js-select form-select" name="processing_mode"
                                                    data-hs-tom-select-options='{"searchInDropdown": false, "hideSearch": true}'>
                                                <option value="manual" {{ old('processing_mode', $method->processing_mode ?? 'manual') === 'manual' ? 'selected' : '' }}>@lang('Manual')</option>
                                                <option value="automatic" {{ old('processing_mode', $method->processing_mode) === 'automatic' ? 'selected' : '' }}>@lang('Automatic')</option>
                                            </select>
                                        </div>
                                        <small class="text-body">@lang('Manual methods are routed to online traders.')</small>
                                        @error('processing_mode')
                                        <span class="invalid-feedback d-block">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-4 d-flex align-items-center">
                                    <div class="col-md-6">
                                        <label class="row form-check form-switch mt-3" for="manual_gateway_status">
                                        <span class="col-4 col-sm-9 ms-0 ">
                                          <span class="d-block text-dark">@lang("Fiat Send Gateway Status")</span>
                                          <span
                                              class="d-block fs-5">@lang("Enable gateway status as active for the crypto sell transaction.")</span>
                                        </span>
                                            <span class="col-2 col-sm-3 text-end">
                                         <input type='hidden' value='0' name='status'>
                                            <input
                                                class="form-check-input"
                                                type="checkbox" name="status" id="manualGatewayStatus"
                                                value="1" {{ $method->status == 1 ? 'checked' : '' }}>
                                            <label class="form-check-label text-center"
                                                   for="manualGatewayStatus"></label>
                                        </span>
                                            @error('status')
                                            <span class="invalid-feedback d-block">{{ $message }}</span>
                                            @enderror
                                        </label>
                                    </div>
                                </div>

                                <div class="row mb-5">
                                    <div class="col-md-12">
                                        <label for="Currency" class="form-label">@lang('Supported Currency')</label>
                                        <div class="tom-select-custom tom-select-custom-with-tags">
                                            <select class="js-select form-select" name="supported_currency[]"
                                                    autocomplete="off" multiple
                                                    data-hs-tom-select-options='{
                                                    "placeholder": "Select supported currency..."
                                                  }'>
                                                @if(count($fiatCurrencies) > 0)
                                                    @foreach($fiatCurrencies as $fiatCurrency)
                                                        <option
                                                            value="{{$fiatCurrency->code}}" {{in_array($fiatCurrency->code,$method->supported_currency??[]) ? 'selected':''}}>{{$fiatCurrency->code}}</option>
                                                    @endforeach
                                                @endif
                                            </select>
                                        </div>
                                        @error('supported_currency')
                                        <span class="invalid-feedback d-block">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-5">
                                    <div class="col-md-3">
                                        <label class="form-check form-check-dashed" for="logoUploader">
                                            <img id="logoImg"
                                                 class="avatar avatar-xl avatar-4x3 avatar-centered h-100 mb-2"
                                                 src="{{ getFile($method->driver, $method->image, true) }}"
                                                 alt="Image Description" data-hs-theme-appearance="default">
                                            <img id="logoImg"
                                                 class="avatar avatar-xl avatar-4x3 avatar-centered h-100 mb-2"
                                                 src="{{ getFile($method->driver, $method->image, true) }}"
                                                 alt="Image Description" data-hs-theme-appearance="dark">
                                            <span class="d-block">@lang("Browse your file here")</span>
                                            <input type="file" class="js-file-attach form-check-input" name="image"
                                                   id="logoUploader" data-hs-file-attach-options='{
                                                      "textTarget": "#logoImg",
                                                      "mode": "image",
                                                      "targetAttr": "src",
                                                      "allowTypes": [".png", ".jpeg", ".jpg"]
                                                   }'>
                                            @error("image")
                                            <span
                                                class="invalid-feedback d-block">{{ $message }}</span>
                                            @enderror
                                        </label>
                                    </div>
                                    <div class="col-md-9 mb-5">
                                        <label class="form-label"
                                               for="descriptionArea">@lang("Description")</label>
                                        <textarea id="descriptionArea" class="form-control" name="description"
                                                  placeholder="Description">{{ old('description', $method->description) }}</textarea>
                                        <span class="invalid-feedback d-block">
                                            @error('description') @lang($message) @enderror
                                        </span>
                                    </div>
                                </div>

                                <div class="card mb-3 mb-lg-5">
                                    <div class="card-header card-header-content-sm-between">
                                        <h4 class="card-header-title mb-2 mb-sm-0">@lang("Payment Information")</h4>
                                        <div class="d-sm-flex align-items-center gap-2">
                                            <a class="js-create-field btn btn-outline-info btn-sm add_field_btn"
                                               href="javascript:void(0);">
                                                <i class="bi-plus"></i> @lang("Add Field")
                                            </a>
                                        </div>
                                    </div>

                                    <div class="table-responsive datatable-custom dynamic-feild-table">
                                        <table id="datatable"
                                               class="table table-borderless table-thead-bordered table-nowrap table-align-middle card-table overflow-visible">
                                            <thead class="thead-light">
                                            <tr>
                                                <th>@lang("Field Name")</th>
                                                <th>@lang("Input Type")</th>
                                                <th>@lang("Validation Type")</th>
                                                <th></th>
                                            </tr>
                                            </thead>

                                            @php
                                                $oldKycInputFormCount = old('field_name', $method->parameters) ? count( old('field_name', (array) $method->parameters)) : 0;
                                            @endphp
                                            <tbody id="addFieldContainer">
                                            @if( 0 < $oldKycInputFormCount)
                                                @php
                                                    $oldKycInputForm = collect(old('field_name', (array)$method->parameters))->values();
                                                @endphp

                                                @for($i = 0; $i < $oldKycInputFormCount; $i++)
                                                    <tr>
                                                        <td>
                                                            <input type="text" name="field_name[]" class="form-control"
                                                                   value="{{ old("field_name.$i", $oldKycInputForm[$i]->field_label ?? '') }}"
                                                                   placeholder="@lang("Field Name")" autocomplete="off">
                                                            @error("field_name.$i")
                                                            <span class="invalid-feedback d-block">{{ $message }}</span>
                                                            @enderror
                                                        </td>

                                                        <td>
                                                            <div class="tom-select-custom">
                                                                <select class="js-select form-select"
                                                                        name="input_type[]"
                                                                        data-hs-tom-select-options='{
                                                                        "searchInDropdown": false,
                                                                        "hideSearch": true
                                                                      }'>
                                                                    <option
                                                                        value="text" {{ old("input_type.$i", $oldKycInputForm[$i]->type ?? '') == 'text' ? 'selected' : '' }}>@lang('Text')</option>
                                                                    <option
                                                                        value="number" {{ old("input_type.$i", $oldKycInputForm[$i]->type ?? '') == 'number' ? 'selected' : '' }}>@lang('Number')</option>
                                                                    <option
                                                                        value="date" {{ old("input_type.$i", $oldKycInputForm[$i]->type ?? '') == 'date' ? 'selected' : '' }}>@lang('Date')</option>
                                                                </select>
                                                                @error("input_type.$i")
                                                                <span
                                                                    class="invalid-feedback d-block">{{ $message }}</span>
                                                                @enderror
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <div class="tom-select-custom">
                                                                <select class="js-select form-select"
                                                                        name="is_required[]"
                                                                        data-hs-tom-select-options='{
                                                                        "searchInDropdown": false,
                                                                        "hideSearch": true
                                                                      }'>
                                                                    <option
                                                                        value="required" {{ old("is_required.$i", $oldKycInputForm[$i]->validation ?? '') == 'required' ? 'selected' : '' }}>@lang('Required')</option>
                                                                    <option
                                                                        value="optional" {{ old("is_required.$i", $oldKycInputForm[$i]->validation ?? '') == 'optional' ? 'selected' : '' }}>@lang('Optional')</option>
                                                                </select>
                                                                @error("is_required.$i")
                                                                <span
                                                                    class="invalid-feedback d-block">{{ $message }}</span>
                                                                @enderror
                                                            </div>
                                                        </td>
                                                        <td class="table-column-ps-0">
                                                            <button type="button" class="btn btn-white remove-row">
                                                                <i class="bi-trash"></i>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                @endfor
                                            @endif

                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div class="d-flex justify-content-start mt-4">
                                    <button type="submit" class="btn btn-primary">@lang('Save changes')</button>
                                </div>

                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

@endsection

@push('css-lib')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
@endpush

@push('js-lib')
    <script src="{{ asset('assets/admin/js/hs-file-attach.min.js') }}"></script>
    <script src="{{ asset('assets/admin/js/tom-select.complete.min.js') }}"></script>
@endpush

@push('script')
    <script>
        'use strict';
        $(document).ready(function () {
            $(document).on('click', '.add_field_btn', function () {
                let rowCount = $('#addFieldContainer tr').length;
                let markUp = `
                            <tr id="addVariantsTemplate">
                                <td>
                                    <input type="text" class="form-control" name="field_name[]" placeholder="@lang("Field Name")" autocomplete="off">
                                </td>
                                <td>
                                    <div class="tom-select-custom">
                                        <select class="js-select-dynamic-input-type${rowCount} form-select" name="input_type[]"
                                                data-hs-tom-select-options='{"searchInDropdown": false, "hideSearch": true}'>
                                            <option value="text">@lang('Text')</option>
                                            <option value="number">@lang('Number')</option>
                                            <option value="date">@lang('Date')</option>
                                        </select>
                                    </div>
                                </td>
                                <td>
                                    <div class="tom-select-custom">
                                        <select class="js-select-dynamic-validation-type${rowCount} form-select" name="is_required[]"
                                                data-hs-tom-select-options='{"searchInDropdown": false, "hideSearch": true}'>
                                            <option value="required">@lang('Required')</option>
                                            <option value="optional">@lang('Optional')</option>
                                        </select>
                                    </div>
                                </td>
                                <td class="table-column-ps-0">
                                    <button type="button" class="btn btn-white remove-row">
                                                            <i class="bi-trash"></i>
                                                        </button>
                                </td>
                            </tr>`;

                $("#addFieldContainer").append(markUp);

                const selectClass = `.js-select-dynamic-input-type${rowCount}, .js-select-dynamic-validation-type${rowCount}`;

                $("#addFieldContainer").find(selectClass).each(function () {
                    HSCore.components.HSTomSelect.init($(this));
                });
            });

            $(document).on('click', '.remove-row', function (e) {
                e.preventDefault();
                $(this).closest('tr').remove();
            });


            new HSFileAttach('.js-file-attach')
            HSCore.components.HSTomSelect.init('.js-select')
        });

    </script>
@endpush


