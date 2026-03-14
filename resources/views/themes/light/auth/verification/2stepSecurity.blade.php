@extends($theme.'layouts.login_register')
@section('title',$page_title)

@section('content')
    @include($theme.'auth.verifyImage')
    <section class="login-signup-page pt-0 pb-0 min-vh-100 h-100">
        <div class="container-fluid h-100">
            <div class="row min-vh-100">
                <div class="col-md-6 p-0">
                    <div class="login-signup-thums h-100">
                        <div class="content-area">
                            <div class="logo-area mb-30">
                                <a href="{{url('/')}}">
                                    <img class="logo"
                                         src="{{getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo)}}" alt="...">
                                </a>
                            </div>
                            <div class="middle-content">
                                <h3 class="section-title">@lang('Verification here!')</h3>
                                <p>@lang('Please enter the verification code to authenticate your identity and proceed with the verification process.')</p>
                            </div>
                            @include($theme.'auth.socialIcon')
                        </div>
                    </div>
                </div>
                <div class="col-md-6 p-0 d-flex justify-content-center flex-column">
                    <div class="login-signup-form">
                        <form action="{{ route('user.twoFA-Verify') }}" method="post">
                            @csrf
                            <div class="section-header">
                                <h3>@lang('Verification here!')</h3>
                                <div
                                    class="description">@lang('Please enter the verification code to authenticate your identity and proceed with the verification process.')</div>
                            </div>
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="text" name="code" value="{{ old('code') }}" class="form-control"
                                           id="exampleInputEmail1"
                                           placeholder="@lang('2 FA Code')">
                                    @error('code')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                            </div>
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('Submit')</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
