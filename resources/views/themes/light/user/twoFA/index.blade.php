@extends($theme.'layouts.user')
@section('page_title',__('2 Step Security'))

@section('content')
    <div class="section dashboard">
        <div class="row">
            <div class="account-settings-profile-section">
                <div class="row">
                    <div class="col-md-6 mt-2">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <h5 class="card-title">@lang('2 Step Security')</h5>
                                <a href="javascript:void(0)"
                                   class="cmn-btn3" data-bs-toggle="modal"
                                   data-bs-target="#re-generateModal">@lang('Re-generate')</a>
                            </div>
                            <div class="card-body pt-0">
                                <div class="profile-form-section">
                                        @if(auth()->user()->two_fa ==1)
                                            <h5>@lang('Two Factor Authenticator')</h5>
                                            <div class="input-box">
                                                <div class="input-group append">
                                                    <input type="text"
                                                           value="{{$secret}}"
                                                           class="form-control"
                                                           id="referralURL"
                                                           readonly>
                                                    <button class="cmn-btn py-0 copytext" type="button"
                                                            id="copyBoard"
                                                            onclick="copyFunction()"><i
                                                            class="fa fa-copy"></i> @lang('Copy')
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="form-group mx-auto text-center my-3">
                                                <img class="mx-auto h-auto"
                                                     src="https://quickchart.io/chart?cht=qr&chs=150x150&chl=myqrcode={{$qrCodeUrl}}">
                                            </div>

                                            <div class="form-group mx-auto text-center mt-3">
                                                <a href="javascript:void(0)" class="cmn-btn3"
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
                                                    <button class="cmn-btn py-0 copytext" type="button"
                                                            id="copyBoard"
                                                            onclick="copyFunction()"><i
                                                            class="fa fa-copy"></i> @lang('Copy')
                                                    </button>
                                                </div>
                                            </div>
                                            <div class="form-group mx-auto text-center mt-5">
                                                <img class="h-auto mx-auto"
                                                     src="https://quickchart.io/chart?cht=qr&chs=150x150&chl=myqrcode={{$qrCodeUrl}}">
                                            </div>

                                            <div class="form-group mx-auto text-center mt-3">
                                                <a href="javascript:void(0)"
                                                   class="cmn-btn3 mt-3" data-bs-toggle="modal"
                                                   data-bs-target="#enableModal">@lang('Enable Two Factor Authenticator')</a>
                                            </div>
                                        @endif

                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6 mt-2">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="card-title">@lang('2 Step Security')
                                </h5>
                            </div>
                            <div class="card-body pt-0">
                                <div class="profile-form-section">
                                    <h5 class="card-title">@lang('Google Authenticator')</h5>
                                    <h6 class="text-uppercase my-3">@lang('Use Google Authenticator to Scan the QR code  or use the code')</h6>
                                    <p class="p-3">@lang('Google Authenticator is a multifactor app for mobile devices. It generates timed codes used during the 2-step verification process. To use Google Authenticator, install the Google Authenticator application on your mobile device.')</p>
                                    <div class="text-end">
                                        <a class="cmn-btn"
                                           href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en"
                                           target="_blank">@lang('Download App')</a>
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
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fal fa-times"></i>
                    </button>
                </div>
                <form action="{{route('user.twoStepEnable')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <div class="row g-4">
                            <input type="hidden" name="key" value="{{$secret}}">
                            <div class="input-box col-12">
                                <input class="form-control" type="text" name="code"
                                       placeholder="@lang('Enter Google Authenticator Code')"/>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="cmn-btn3"
                                data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="cmn-btn">@lang('Verify')</button>
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
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fal fa-times"></i>
                    </button>
                </div>
                <form action="{{route('user.twoStepDisable')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <div class="row g-4">
                            <div class="input-box col-12">
                                <input class="form-control" type="password" name="password"
                                       placeholder="@lang('Enter Your Password')"/>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="cmn-btn3"
                                data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="cmn-btn">@lang('Verify')</button>
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
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fal fa-times"></i>
                    </button>
                </div>
                <form action="{{route('user.twoStepRegenerate')}}" method="POST">
                    @csrf
                    <div class="modal-body">
                        <p>@lang('Are you want to Re-generate Authenticator ?')</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="cmn-btn3"
                                data-bs-dismiss="modal">@lang('Close')</button>
                        <button type="submit" class="cmn-btn">@lang('Yes')</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
@endsection
@push('extra_scripts')
    <script>
        function copyFunction() {
            var copyText = document.getElementById("referralURL");
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            /*For mobile devices*/
            document.execCommand("copy");
            Notiflix.Notify.success(`Copied: ${copyText.value}`);
        }
    </script>
    @if ($errors->any())
        @php
            $collection = collect($errors->all());
            $errors = $collection->unique();
        @endphp
        <script>
            "use strict";
            @foreach ($errors as $error)
            Notiflix.Notify.failure("{{ trans($error) }}");
            @endforeach
        </script>
    @endif
@endpush

