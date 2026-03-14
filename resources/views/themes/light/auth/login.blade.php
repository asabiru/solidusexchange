@extends($theme.'layouts.login_register')
@section('title',trans('Login'))
@section('content')
    @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
        <style>
            .login-signup-page .login-signup-thums {
                background-image: url({{getFile(@$loginRegister->content->media->login_page_image->driver,@$loginRegister->content->media->login_page_image->path)}});
                background-position: center;
                background-size: cover;
                background-repeat: no-repeat;
            }
        </style>
    @endif
    <!-- login-signup section start -->
    <section class="login-signup-page pt-0 pb-0 min-vh-100 h-100">
        <div class="container-fluid h-100">
            <div class="row min-vh-100">

                <div class="col-md-6 p-0 d-none d-md-block">
                    <div class="login-signup-thums h-100">
                        <div class="content-area">
                            <div class="logo-area mb-30">
                                <a href="{{url('/')}}">
                                    <img class="logo"
                                         src="{{getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo)}}"
                                         alt="...">
                                </a>
                            </div>
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="middle-content">
                                    <h3 class="section-title">{{@$loginRegister->description->login_heading}}</h3>
                                    <p>{{@$loginRegister->description->login_sub_heading}}</p>
                                </div>
                            @endif

                            @if(isset($template['social']) && count($template['social']) > 0)
                                <div class="bottom-content">
                                    <div class="social-area mt-50">
                                        <ul class="d-flex">
                                            @foreach($template['social'] as $social)
                                                <li><a href="{{@$social->content->media->my_link}}"><i
                                                            class="{{@$social->content->media->icon}}"></i></a></li>
                                            @endforeach
                                        </ul>
                                    </div>
                                </div>
                            @endif
                        </div>
                    </div>
                </div>

                <div class="col-md-6 p-0 d-flex justify-content-center flex-column">
                    <div class="login-signup-form">
                        <form action="{{ route('login') }}" method="post">
                            @csrf
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="section-header">
                                    <h3>{{@$loginRegister->description->login_heading}}</h3>
                                    <div class="description">{{@$loginRegister->description->login_sub_heading}}</div>
                                </div>
                            @endif
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="text" name="username" value="{{ old('username', config('demo.IS_DEMO') ? (request()->username ?? 'demouser') : '') }}" class="form-control" id="exampleInputEmail1"
                                           placeholder="@lang("Email or Username")">
                                    @error('username')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <div class="password-box">
                                        <input type="password" name="password"  value="{{ old('password', config('demo.IS_DEMO') ? (request()->password ?? 'demouser') : '') }}"
                                               class="form-control password" id="exampleInputPassword1"
                                               placeholder="@lang('Password')">
                                        <i class="password-icon fa-regular fa-eye"></i>
                                    </div>
                                    @error('password')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login))

                                    <div class="form-group">
                                        {!! NoCaptcha::renderJs() !!}
                                        {!! NoCaptcha::display() !!}
                                        @error('g-recaptcha-response')
                                        <div class="text-danger">@lang($message)</div>
                                        @enderror
                                    </div>
                                @endif
                                @if(basicControl()->manual_recaptcha &&  basicControl()->reCaptcha_status_login)
                                    <div class="input-box mb-4">
                                        <input type="text" tabindex="2"
                                               class="form-control @error('captcha') is-invalid @enderror"
                                               name="captcha" id="captcha" autocomplete="off"
                                               placeholder="@lang('Enter captcha code')">

                                        @error('captcha')
                                        <div class="text-danger">@lang($message)</div>
                                        @enderror
                                    </div>

                                    <div class="mb-4">
                                        <div
                                            class="input-group input-group-merge d-flex justify-content-between"
                                            data-hs-validation-validate-class>
                                            <img src="{{route('captcha').'?rand='. rand()}}"
                                                 id='captcha_image2'>
                                            <a class="input-group-append input-group-text"
                                               href='javascript: refreshCaptcha2();'>
                                                <i class="fal fa-sync"></i>
                                            </a>
                                        </div>
                                    </div>
                                @endif
                                <div class="col-12">
                                    <div class="form-check d-flex justify-content-between">
                                        <div class="check">
                                            <input type="checkbox" name="remember" class="form-check-input"
                                                   id="exampleCheck1" {{ old('remember') ? 'checked' : '' }}>
                                            <label class="form-check-label"
                                                   for="exampleCheck1">@lang('Remember me')</label>
                                        </div>
                                        <div class="forgot highlight">
                                            <a href="{{ route('password.request') }}">@lang('Forgot password?')</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('Log In')</button>

                            @php
                                $hasAnySocialLogin = config('socialite.google_status')
                                    || config('socialite.facebook_status')
                                    || config('socialite.github_status')
                                    || (config('socialite.telegram_status') && config('services.telegram.bot_name'));
                                $telegramWidgetAllowed = !in_array(request()->getHost(), ['127.0.0.1', 'localhost'], true) && request()->isSecure();
                            @endphp

                            @if($hasAnySocialLogin)
                                <hr class="divider">
                            @endif

                            <div class="cmn-btn-group">
                                <div class="row g-2 social-login-grid">
                                    @if(config('socialite.google_status'))
                                        <div class="col-12 col-sm-6">
                                            <a href="{{route('socialiteLogin','google')}}"
                                               class="btn cmn-btn3 w-100 social-btn social-unified-btn"><img
                                                    src="{{$themeTrue.'img/google.png'}}"
                                                    alt="...">@lang('Google')
                                            </a>
                                        </div>
                                    @endif
                                    @if(config('socialite.facebook_status'))
                                        <div class="col-12 col-sm-6">
                                            <a href="{{route('socialiteLogin','facebook')}}"
                                               class="btn cmn-btn3 w-100 social-btn social-unified-btn"><img
                                                    src="{{$themeTrue.'img/facebook.png'}}"
                                                    alt="...">@lang('Facebook')
                                            </a>
                                        </div>
                                    @endif
                                    @if(config('socialite.github_status'))
                                        <div class="col-12 col-sm-6">
                                            <a href="{{route('socialiteLogin','github')}}"
                                               class="btn cmn-btn3 w-100 social-btn social-unified-btn"><img
                                                    src="{{$themeTrue.'img/github.png'}}"
                                                    alt="...">@lang('Github')
                                            </a>
                                        </div>
                                    @endif
                                    @if(config('socialite.telegram_status') && config('services.telegram.bot_name'))
                                        <div class="col-12 col-sm-6">
                                            @if($telegramWidgetAllowed)
                                                <div class="telegram-login-widget text-center">
                                                    <script async src="https://telegram.org/js/telegram-widget.js?22"
                                                            data-telegram-login="{{ config('services.telegram.bot_name') }}"
                                                            data-size="large"
                                                            data-radius="8"
                                                            data-auth-url="{{ route('socialiteCallback','telegram') }}"
                                                            data-request-access="write"></script>
                                                </div>
                                            @else
                                                <a href="https://t.me/{{ config('services.telegram.bot_name') }}?start=web_login"
                                                   target="_blank" rel="noopener"
                                                   class="btn cmn-btn3 w-100 social-btn social-unified-btn d-flex align-items-center justify-content-center gap-2">
                                                    <i class="fab fa-telegram-plane"></i>
                                                    <span>@lang('Telegram')</span>
                                                </a>
                                            @endif
                                        </div>
                                    @endif
                                </div>
                            </div>

                            <div class="pt-20 text-center">
                                @lang("Don't have an account?")
                                <p class="mb-0 highlight"><a
                                        href="{{ route('register') }}">@lang('Create an account')</a></p>
                            </div>
                        </form>
                    </div>
                </div>

            </div>
        </div>
    </section>
    <!-- login-signup section end -->
@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login == 1))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
    <style>
        .social-login-grid .social-unified-btn {
            min-height: 52px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
        }

        .social-login-grid .telegram-login-widget {
            min-height: 52px;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            overflow: hidden;
            background: linear-gradient(120deg, var(--solidus-accent), var(--solidus-accent-2));
        }

        .social-login-grid .telegram-login-widget iframe {
            width: 100% !important;
            min-width: 100% !important;
            border: 0;
        }
    </style>

    <script>
        'use strict';
        // input field show hide password start
        const password = document.querySelector('.password');
        const passwordIcon = document.querySelector('.password-icon');

        passwordIcon.addEventListener("click", function () {
            if (password.type == 'password') {
                password.type = 'text';
                passwordIcon.classList.add('fa-eye-slash');
            } else {
                password.type = 'password';
                passwordIcon.classList.remove('fa-eye-slash');
            }
        })

        function refreshCaptcha() {
            let img = document.images['captcha_image'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }

        function refreshCaptcha2() {
            let img = document.images['captcha_image2'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }
    </script>

@endpush
