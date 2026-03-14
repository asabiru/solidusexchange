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
                                <h3 class="section-title">@lang('Phone Number Verify Here!')</h3>
                                <p>@lang('Validate your phone number effortlessly for enhanced account protection. Verification made simple, security assured.')</p>
                            </div>

                            @include($theme.'auth.socialIcon')
                        </div>
                    </div>
                </div>
                <div class="col-md-6 p-0 d-flex justify-content-center flex-column">
                    <div class="login-signup-form">
                        <form action="{{ route('user.smsVerify') }}" method="post">
                            @csrf
                            <div class="section-header">
                                <h3>@lang('Phone Number Verify Here!')</h3>
                                <div
                                    class="description">@lang('Validate your phone number effortlessly for enhanced account protection. Verification made simple, security assured.')</div>
                            </div>
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="text" name="code" class="form-control"
                                           id="exampleInputEmail1"
                                           placeholder="@lang('Code')">
                                    @error('code')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                            </div>
                            @if (Route::has('user.resendCode'))
                                <div class="text-end mt-1 me-2">
                                    <p class="mb-0 highlight"><a
                                            href="{{route('user.resendCode')}}?type=phone">@lang('Resend code')?</a></p>
                                    @error('resend')
                                    <p class="text-danger mt-1">@lang($message)</p>
                                    @enderror
                                </div>
                            @endif
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('Submit')</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
