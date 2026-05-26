@extends($theme.'layouts.login_register')
@section('title',__('Confirm Password'))
@section('content')
    @include($theme.'auth.verifyImage')
    <section class="login-signup-page pt-0 pb-0 min-vh-100 h-100">
        <div class="container-fluid h-100">
            <div class="row min-vh-100">
                <div class="col-md-6 p-0 d-none d-md-block">
                    <div class="login-signup-thums h-100">
                        <div class="content-area">
                            <div class="logo-area mb-30">
                                <a href="{{url('/')}}">
                                    <img class="logo"
                                         src="{{getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo)}}" alt="...">
                                </a>
                            </div>
                            <div class="middle-content">
                                <h3 class="section-title">@lang('Confirm Password!')</h3>
                                <p>@lang('Please enter your new password again to confirm and ensure accuracy.')</p>
                            </div>

                            @include($theme.'auth.socialIcon')
                        </div>
                    </div>
                </div>
                <div class="col-md-6 p-0 d-flex justify-content-center flex-column">
                    <div class="login-signup-form">
                        <form action="{{ route('password.email') }}" method="post">
                            @csrf
                            <div class="section-header">
                                <h3>@lang('Confirm Password!')</h3>
                                <div
                                    class="description">@lang('Please enter your new password again to confirm and ensure accuracy.')</div>
                            </div>
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="password" name="password" value="{{ old('password') }}"
                                           class="form-control"
                                           id="exampleInputEmail1">
                                    @error('password')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                            </div>
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('Confirm Password')</button>
                            @if (Route::has('password.request'))
                                <hr class="divider">
                                <div class="pt-20 text-center">
                                    <p class="mb-0 highlight"><a
                                            href="{{ route('password.request') }}">@lang('Forgot Your Password')?</a>
                                    </p>
                                </div>
                            @endif
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
