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
                    <div class="login-signup-thums auth-redesign-visual h-100">
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

                <div class="col-md-6 p-0 d-flex justify-content-center flex-column auth-redesign-form-column">
                    <div class="login-signup-form auth-redesign-card">
                        <form action="{{ route('login') }}" method="post">
                            @csrf
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="section-header">
                                    <h3>{{@$loginRegister->description->login_heading}}</h3>
                                    <div class="description">{{@$loginRegister->description->login_sub_heading}}</div>
                                </div>
                            @endif
                            @php
                                $telegramBotName = ltrim((string) config('services.telegram.bot_name'), '@');
                            @endphp

                            @if(config('socialite.telegram_status') && $telegramBotName !== '')
                                <div class="telegram-miniapp-login-box">
                                    <button type="button" class="telegram-miniapp-login-button" id="telegramMiniAppLogin">
                                        <span class="telegram-miniapp-icon"><i class="fa-brands fa-telegram"></i></span>
                                        <span class="telegram-miniapp-copy">
                                            <strong>Войти через Telegram</strong>
                                            <small>Для Telegram Mini App и быстрого входа</small>
                                        </span>
                                    </button>
                                    <div class="telegram-miniapp-status" id="telegramMiniAppStatus"></div>
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
                                $telegramBotName = ltrim((string) config('services.telegram.bot_name'), '@');
                                $telegramCallbackPath = route('socialiteCallback', ['socialite' => 'telegram'], false);
                                $publicBaseUrl = rtrim((string) config('app.url'), '/');
                                $telegramAuthUrl = $publicBaseUrl !== '' ? $publicBaseUrl . $telegramCallbackPath : route('socialiteCallback', 'telegram');
                                $telegramRequestLooksSecure = request()->isSecure()
                                    || strcasecmp((string) request()->header('X-Forwarded-Proto'), 'https') === 0
                                    || strcasecmp((string) request()->server('HTTP_X_FORWARDED_PROTO'), 'https') === 0
                                    || strcasecmp((string) request()->server('HTTPS'), 'on') === 0
                                    || str_starts_with($publicBaseUrl, 'https://')
                                    || (int) (basicControl()->is_force_ssl ?? 0) === 1;
                                $hasAnySocialLogin = config('socialite.google_status')
                                    || config('socialite.facebook_status')
                                    || config('socialite.github_status')
                                    || (config('socialite.telegram_status') && $telegramBotName !== '');
                                $telegramWidgetAllowed = !in_array(request()->getHost(), ['127.0.0.1', 'localhost'], true) && $telegramRequestLooksSecure;
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
                                    @if(config('socialite.telegram_status') && $telegramBotName !== '')
                                        <div class="col-12 col-sm-6">
                                            @if($telegramWidgetAllowed)
                                                <div class="telegram-login-widget text-center">
                                                    <script async src="https://telegram.org/js/telegram-widget.js?22"
                                                            data-telegram-login="{{ $telegramBotName }}"
                                                            data-size="large"
                                                            data-radius="8"
                                                            data-auth-url="{{ $telegramAuthUrl }}"
                                                            data-request-access="write"></script>
                                                </div>
                                            @else
                                                <a href="https://t.me/{{ $telegramBotName }}?start=web_login"
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
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        .login-signup-page {
            position: relative;
            overflow: hidden;
            background:
                radial-gradient(circle at 14% 16%, rgba(232, 201, 160, 0.18), transparent 30%),
                radial-gradient(circle at 85% 80%, rgba(76, 37, 26, 0.22), transparent 34%),
                linear-gradient(135deg, #0b0608 0%, #160b10 52%, #070405 100%);
        }

        .login-signup-page::before {
            content: '';
            position: absolute;
            inset: 0;
            background-image:
                linear-gradient(rgba(232, 201, 160, 0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(232, 201, 160, 0.04) 1px, transparent 1px);
            background-size: 48px 48px;
            pointer-events: none;
        }

        .auth-redesign-visual {
            background-image: none !important;
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            border-right: 1px solid rgba(232, 201, 160, 0.14);
        }

        .auth-redesign-visual::before {
            content: '';
            position: absolute;
            width: 720px;
            height: 720px;
            left: -260px;
            top: 50%;
            transform: translateY(-50%);
            border-radius: 50%;
            background:
                radial-gradient(circle, rgba(232, 201, 160, 0.20), transparent 58%),
                conic-gradient(from 120deg, transparent, rgba(232, 201, 160, 0.22), transparent 62%);
            filter: blur(1px);
        }

        .auth-redesign-visual::after {
            content: 'SC';
            position: absolute;
            right: 8%;
            bottom: 10%;
            color: rgba(232, 201, 160, 0.08);
            font-size: 190px;
            font-weight: 900;
            letter-spacing: -0.12em;
        }

        .auth-redesign-visual .content-area {
            position: relative;
            z-index: 1;
            max-width: 620px;
            padding: 70px;
        }

        .auth-redesign-visual .middle-content .section-title,
        .auth-redesign-visual .middle-content h3 {
            color: #f7ead8 !important;
            font-size: clamp(42px, 5.5vw, 76px);
            line-height: 0.95;
            letter-spacing: -0.06em;
        }

        .auth-redesign-visual .middle-content p {
            max-width: 520px;
            color: #cdbdaf !important;
            font-size: 18px;
            line-height: 1.6;
        }

        .auth-redesign-form-column {
            position: relative;
            z-index: 1;
            padding: 28px;
        }

        .auth-redesign-card {
            width: min(520px, calc(100% - 32px));
            margin: 0 auto;
            padding: 34px !important;
            border: 1px solid rgba(232, 201, 160, 0.22);
            border-radius: 30px;
            background: rgba(18, 9, 13, 0.92) !important;
            box-shadow: 0 30px 90px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
        }

        .auth-redesign-card .section-header h3 {
            color: #fff6ea;
            font-size: 34px;
            font-weight: 850;
            letter-spacing: -0.04em;
        }

        .auth-redesign-card .section-header .description,
        .auth-redesign-card .form-check-label,
        .auth-redesign-card .pt-20 {
            color: #cdbdaf;
        }

        .auth-redesign-card .form-control,
        .auth-redesign-card input[type="text"],
        .auth-redesign-card input[type="password"] {
            height: 54px;
            border: 1px solid rgba(232, 201, 160, 0.22) !important;
            border-radius: 16px !important;
            background: #0b0608 !important;
            color: #f5ede4 !important;
        }

        .auth-redesign-card .form-control:focus {
            border-color: #e8c9a0 !important;
            box-shadow: 0 0 0 4px rgba(232, 201, 160, 0.08) !important;
        }

        .auth-redesign-card .cmn-btn {
            height: 56px;
            border: none;
            border-radius: 16px;
            background: linear-gradient(135deg, #e8c9a0, #f2d8b4);
            color: #0b0608 !important;
            font-weight: 850;
        }

        .telegram-miniapp-login-box {
            margin-bottom: 22px;
        }

        .telegram-miniapp-login-button {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 14px;
            border: 1px solid rgba(34, 158, 217, 0.48);
            border-radius: 18px;
            background: linear-gradient(135deg, #229ed9, #1787c5);
            color: #fff;
            text-align: left;
            cursor: pointer;
            transition: 0.25s ease;
        }

        .telegram-miniapp-login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 16px 32px rgba(34, 158, 217, 0.22);
        }

        .telegram-miniapp-icon {
            width: 42px;
            height: 42px;
            border-radius: 14px;
            background: rgba(255,255,255,0.16);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            flex-shrink: 0;
        }

        .telegram-miniapp-copy strong,
        .telegram-miniapp-copy small {
            display: block;
        }

        .telegram-miniapp-copy small {
            color: rgba(255,255,255,0.74);
            font-size: 12px;
        }

        .telegram-miniapp-status {
            min-height: 18px;
            margin-top: 8px;
            color: #e8c9a0;
            font-size: 12px;
        }

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

        @media (max-width: 767px) {
            .auth-redesign-form-column {
                padding: 18px;
            }

            .auth-redesign-card {
                width: 100%;
                padding: 24px !important;
                border-radius: 24px;
            }
        }
    </style>

    <script>
        'use strict';
        // input field show hide password start
        const password = document.querySelector('.password');
        const passwordIcon = document.querySelector('.password-icon');

        if (password && passwordIcon) {
            passwordIcon.addEventListener("click", function () {
                if (password.type == 'password') {
                    password.type = 'text';
                    passwordIcon.classList.add('fa-eye-slash');
                } else {
                    password.type = 'password';
                    passwordIcon.classList.remove('fa-eye-slash');
                }
            })
        }

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

        const telegramMiniAppLogin = document.getElementById('telegramMiniAppLogin');
        const telegramMiniAppStatus = document.getElementById('telegramMiniAppStatus');
        if (telegramMiniAppLogin) {
            telegramMiniAppLogin.addEventListener('click', async function () {
                const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
                if (!tg || !tg.initData) {
                    telegramMiniAppStatus.textContent = 'Откройте страницу внутри Telegram Mini App или используйте виджет Telegram ниже.';
                    return;
                }

                telegramMiniAppStatus.textContent = 'Проверяем Telegram...';
                try {
                    const response = await fetch('{{ route('telegram.miniapp.login') }}', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                        },
                        body: JSON.stringify({initData: tg.initData}),
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.message || 'Telegram login failed');
                    }
                    window.location.href = data.redirect || '{{ url('/') }}';
                } catch (error) {
                    telegramMiniAppStatus.textContent = error.message || 'Не удалось войти через Telegram.';
                }
            });
        }
    </script>

@endpush
