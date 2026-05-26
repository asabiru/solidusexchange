@extends('admin.layouts.app')
@section('page_title',__('Announcement'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Dashboard')</a></li>
                            <li class="breadcrumb-item"><a class="breadcrumb-link"
                                                           href="javascript:void(0);">@lang('Announcement')</a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@yield('page_title')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@yield('page_title')</h1>
                </div>
            </div>
        </div>
        <div class="content container-fluid">
            <div class="row justify-content-lg-center">
                <div class="col-lg-12">
                    <div class="d-grid gap-3 gap-lg-5">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between">
                                <h4 class="card-title mt-2">@lang("Announcement")</h4>
                            </div>
                            <div class="card-body mt-2">
                                <form action="{{ route('admin.announcement') }}" method="post">
                                    @csrf
                                    <div class="row">
                                        <div class="mb-3">
                                            <label class="form-label"
                                                   for="Announcement Text">@lang('Announcement Text')</label>
                                            <textarea class="form-control"
                                                      name="announcement_text"
                                                      id="summernote">{{$announcement->announcement_text}}</textarea>
                                            @error('announcement_text')
                                            <span class="invalid-feedback d-block">{{ $message }}</span>
                                            @enderror
                                        </div>
                                    </div>
                                    <div class="row">
                                        <div class="col-md-6">
                                            <div class="mb-3">
                                                <label class="form-label"
                                                       for="subjectLabel">@lang('Button Name')</label>
                                                <input type="text" class="form-control" name="btn_name"
                                                       value="{{$announcement->btn_name}}"
                                                       id="title"
                                                       placeholder="@lang('Button Name')"
                                                       aria-label="@lang('Button Name')"
                                                       autocomplete="off">
                                                @error('btn_name')
                                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                                @enderror
                                            </div>

                                            <div class="mb-3">
                                                <label class="form-label"
                                                       for="subjectLabel">@lang('Button Link')</label>
                                                <input type="text" class="form-control" name="btn_link"
                                                       value="{{$announcement->btn_link}}"
                                                       id="title"
                                                       placeholder="@lang('Button Link')"
                                                       aria-label="@lang('Button Link')"
                                                       autocomplete="off">
                                                @error('btn_link')
                                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                                @enderror
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <label class="row form-check form-switch my-4"
                                                   for="btn_display">
                                            <span class="col-8 col-sm-9 ms-0">
                                              <span class="d-block text-dark">@lang("Button Display")</span>
                                              <span
                                                  class="d-block fs-5">@lang("Display the status of the button show on the front page.")</span>
                                            </span>
                                                <span class="col-4 col-sm-3 text-end">
                                                    <input type="hidden" value="0" name="btn_display"/>
                                                    <input
                                                        class="form-check-input @error('btn_display') is-invalid @enderror"
                                                        type="checkbox" name="btn_display"
                                                        id="status" value="1"
                                                        {{$announcement->btn_display == '1' ? 'checked':''}}>
                                                </span>
                                                @error('btn_display')
                                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                                @enderror
                                            </label>

                                            <label class="row form-check form-switch my-4"
                                                   for="status">
                                            <span class="col-8 col-sm-9 ms-0">
                                              <span class="d-block text-dark">@lang("Status")</span>
                                              <span
                                                  class="d-block fs-5">@lang("Display the status of the announcement show on the front page.")</span>
                                            </span>
                                                <span class="col-4 col-sm-3 text-end">
                                                    <input type="hidden" value="0" name="status"/>
                                                    <input
                                                        class="form-check-input @error('status') is-invalid @enderror"
                                                        type="checkbox" name="status"
                                                        id="status" value="1"
                                                        {{$announcement->status == '1' ? 'checked':''}}>
                                                </span>
                                                @error('status')
                                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                                @enderror
                                            </label>
                                        </div>
                                    </div>
                                    <div class="d-flex justify-content-start">
                                        <button type="submit" class="btn btn-primary">@lang('Save Changes')</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
@endsection


@push('css-lib')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/summernote-bs5.min.css') }}">
@endpush

@push('js-lib')
    <script src="{{ asset('assets/admin/js/summernote-bs5.min.js') }}"></script>
@endpush

@push('script')
    <script>
        'use strict';
        $(document).ready(function () {
            $('#summernote').summernote({
                height: 250,
                dialogsInBody: true,
                callbacks: {
                    onBlurCodeview: function () {
                        let codeviewHtml = $(this).siblings('div.note-editor').find('.note-codable').val();
                        $(this).val(codeviewHtml);
                    }
                }
            });
        });
    </script>
@endpush










