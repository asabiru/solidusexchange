@extends('admin.layouts.app')
@section('page_title', __('2 Step Security'))
@section('content')
    <div class="content container-fluid">
        <div class="page-header">
            <div class="row align-items-end">
                <div class="col-sm mb-2 mb-sm-0">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb breadcrumb-no-gutter">
                            <li class="breadcrumb-item">
                                <a class="breadcrumb-link" href="javascript:void(0)">@lang('Dashboard')
                                </a>
                            </li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('Settings')</li>
                            <li class="breadcrumb-item active" aria-current="page">@lang('2 Step Security')</li>
                        </ol>
                    </nav>
                    <h1 class="page-header-title">@lang('2 Step Security')</h1>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col-lg-3">
                @include('admin.control_panel.components.sidebar', ['settings' => config('generalsettings.settings'), 'suffix' => 'Settings'])
            </div>
            <div class="col-lg-9" id="basic_control">
                <div class="d-grid gap-3 gap-lg-5">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="card">
                                <div class="card-header d-flex justify-content-between align-items-center">
                                    <h2 class="card-title h4">@lang('2 Step Security')</h2>
                                    <a href="javascript:void(0)" class="btn btn-primary"
                                       data-bs-toggle="modal"
                                       data-bs-target="#re-generateModal"><i class="fas fa-recycle"></i> @lang('Re-generate')</a>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        @if(auth()->user()->two_fa ==1)
                                            <h5>@lang('Two Factor Authenticator')</h5>
                                            <div class="input-box">
                                                <div class="input-group append">
                                                    <input type="text"
                                                           value="{{$secret}}"
                                                           class="form-control"
                                                           id="referralURL"
                                                           readonly>
                                                    <button class="btn btn-primary py-0 copytext" type="button"
                                                            id="copyBoard"
                                                            onclick="copyFunction()"><i
                                                            class="fa fa-copy"></i> @lang('Copy')
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="form-group mx-auto text-center my-3">
                                                <img class="mx-auto h-auto"
                                                     src="https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl={{$qrCodeUrl}}">
                                            </div>

                                            <div class="form-group mx-auto text-center mt-3">
                                                <a href="javascript:void(0)" class="btn btn-primary"
                                                   data-bs-toggle="modal"
                                                   data-bs-target="#disableModal">@lang('Disable Two Factor Authenticator')</a>
                                            </div>
                                        @else
                                            <h5>@lang('Two Factor Authenticator')</h5>
                                            <div class="input-box">
                                                <div class="input-group append">
                                                    <input type="text"
                                                           value="{{$secret}}"
                                                           class="form-control"
                                                           id="referralURL"
                                                           readonly>
                                                    <button class="btn btn-primary py-0 copytext" type="button"
                                                            id="copyBoard"
                                                            onclick="copyFunction()"><i
                                                            class="fa fa-copy"></i> @lang('Copy')
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="form-group mx-auto text-center mt-5">
                                                <img class="h-auto mx-auto"
                                                     src="https://chart.googleapis.com/chart?chs=200x200&chld=M|0&cht=qr&chl={{$qrCodeUrl}}">
                                            </div>

                                            <div class="form-group mx-auto text-center mt-3">
                                                <a href="javascript:void(0)"
                                                   class="btn btn-primary mt-3" data-bs-toggle="modal"
                                                   data-bs-target="#enableModal">@lang('Enable Two Factor Authenticator')</a>
                                            </div>
                                        @endif
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="card">
                                <div class="card-header">
                                    <h2 class="card-title h4">@lang('2 Step Security')</h2>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        <h5 class="card-title">@lang('Google Authenticator')</h5>
                                        <h6 class="text-uppercase my-3">@lang('Use Google Authenticator to Scan the QR code  or use the code')</h6>
                                        <p class="p-3">@lang('Google Authenticator is a multifactor app for mobile devices. It generates timed codes used during the 2-step verification process. To use Google Authenticator, install the Google Authenticator application on your mobile device.')</p>
                                        <div class="text-end">
                                            <a class="btn btn-primary"
                                               href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en"
                                               target="_blank"><i class="fas fa-download"></i> @lang('Download App')</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="modal fade" id="enableModal" tabindex="-1" aria-labelledby="editModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-md">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="editModalLabel">@lang('Verify Your OTP')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{route('admin.twoFa.Enable')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <div class="row g-4">
                            <input type="hidden" name="key" value="{{$secret}}">
                            <div class="input-box col-12">
                                <input class="form-control" type="text" name="code"
                                       placeholder="@lang('Enter Google Authenticator Code')" required/>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-soft-primary">@lang('Verify')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div class="modal fade" id="disableModal" tabindex="-1" aria-labelledby="editModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-md">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="editModalLabel">@lang('Verify Your OTP to Disable')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{route('admin.twoFa.Disable')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <div class="row g-4">
                            <div class="input-box col-12">
                                <input class="form-control" type="password" name="password"
                                       placeholder="@lang('Enter Your Password')" required/>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-soft-primary">@lang('Submit')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div class="modal fade" id="re-generateModal" tabindex="-1" aria-labelledby="editModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-md">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="editModalLabel">@lang('Re-generate Confirmation')</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <form action="{{route('admin.twoFaRegenerate')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <p>@lang('Are you want to Re-generate the Authenticator?')</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="btn btn-soft-primary">@lang('Yes')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
@endsection

@push('css-lib')

@endpush
@push('js-lib')

@endpush

@push('script')
    <script>
        'use strict';
        function copyFunction() {
            var copyText = document.getElementById("referralURL");
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            /*For mobile devices*/
            document.execCommand("copy");
            Notiflix.Notify.success(`Copied: ${copyText.value}`);
        }

    </script>
@endpush
