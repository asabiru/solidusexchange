@extends('admin.layouts.app')
@section('page_title',__('Google Sheet API Settings'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active"
                                aria-current="page">{{ __(ucwords($method) . ' ' . 'Translate API Configuration') }}</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">{{ __(ucwords($method) . ' ' . 'Translate API Configuration') }}</h1>
                </div>
            </div>
        </div>
        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-6">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title h4">{{ __(ucwords($method) . ' ' . 'Translate API Configuration') }}</h2>
                        </div>
                        <div class="card-body">
                            <form action="{{ route('admin.translate.api.setting.update', $method)}}" method="post"
                                  enctype="multipart/form-data">
                                @csrf
                                <div class="row">
                                    @foreach($translateMethodParameters as $key => $parameter)
                                        @if($key !== "google_credentials")
                                            <div class="col-sm-12 mb-3">
                                                <label for="translateLabel"
                                                       class="form-label">@lang(snake2Title($key))</label>
                                                <div class="input-group input-group-merge"
                                                     data-hs-validation-validate-class>
                                                    <input type="{{ $parameter['is_protected'] ? 'password' : 'text' }}"
                                                           class="js-toggle-password form-control @error($key) is-invalid @enderror"
                                                           name="{{ $key }}" id="translateLabel"
                                                           placeholder="@lang(snake2Title($key))"
                                                           value="{{ old($key ,$parameter['value']) }}"
                                                           data-hs-toggle-password-options='{ "target": "#{{$key.'id'}}", "defaultClass": "bi-eye-slash", "showClass":"bi-eye", "classChangeTarget": "#{{$key}}" }'/>
                                                    @if($parameter['is_protected'])
                                                        <button type="button" id="{{$key.'id'}}"
                                                                class="input-group-append input-group-text clickShowPassword">
                                                            <i id="{{$key}}" class="bi-eye"></i>
                                                        </button>
                                                    @endif
                                                </div>
                                                @error($key)
                                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        @endif
                                    @endforeach
                                </div>
                                <div class="d-flex justify-content-start">
                                    <button type="submit" class="btn btn-primary">@lang('Save changes')</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-lg-3">
                <div id="emailSection" class="card mb-4">
                    <div class="card-header d-flex align-items-center justify-content-between">
                        <h2 class="card-title h4 mt-2">@lang("Instruction")</h2>
                    </div>
                    <div class="card-body">
                        <p>@lang("✓ If you upload it in  public_html folder, then visit http://your-sitename in browser.")</p>
                        <p>@lang("✓ If you upload it in a folder in  public_html folder, then visit http://your-sitename/folder_name in browser.")</p>
                        <p>@lang("✓ If you upload it in your created subdomain folder, then visit http://your-subdomain-name in browser.")</p>
                        <p>@lang("✓ If you upload it in a folder in your created subdomain folder, then visit http://your-subdomain-name/folder_name in browser.")</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- End Content -->
@endsection

@push('script')
    <script>
        'use strict';
        $(document).on('click', '.clickShowPassword', function () {
            let passInput = $(this).closest('.input-group-merge').find('input');
            if (passInput.attr('type') === 'password') {
                $(this).children().removeClass('bi-eye-slash');
                $(this).children().addClass('bi-eye');
                passInput.attr('type', 'text');
            } else {
                $(this).children().removeClass('bi-eye');
                $(this).children().addClass('bi-eye-slash');
                passInput.attr('type', 'password');
            }
        })
    </script>
@endpush


