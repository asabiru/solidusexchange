@extends($theme.'layouts.login_register')
@section('title',trans('Register'))
@section('content')
    @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
        <style>
            .login-signup-page .login-signup-thums {
                background-image: url({{getFile(@$loginRegister->content->media->register_page_image->driver,@$loginRegister->content->media->register_page_image->path)}});
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
                                    <h3 class="section-title">{{@$loginRegister->description->register_heading}}</h3>
                                    <p>{{@$loginRegister->description->register_sub_heading}}</p>
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

                <div class="col-12 p-0 d-flex justify-content-center flex-column auth-redesign-form-column">
                    <div class="login-signup-form auth-redesign-card">
                        {{-- ── Логотип в форме (все экраны) ── --}}
                        <div class="auth-form-logo text-center mb-4">
                            <a href="{{ url('/') }}" class="d-inline-block">
                                <img src="{{ getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo) }}"
                                     alt="{{ basicControl()->site_title }}"
                                     class="auth-logo-img"
                                     width="80" height="80">
                            </a>
                            <div class="auth-logo-name mt-2">{{ basicControl()->site_title }}</div>
                        </div>

                        <form action="{{ route('register') }}" method="post" class="php-email-form">
                            @csrf
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="section-header">
                                    <h3>{{@$loginRegister->description->register_heading}}</h3>
                                    <div class="description">{{@$loginRegister->description->register_sub_heading}}</div>
                                </div>
                            @endif

                            <div class="auth-top-bar">
                                <a href="{{ url('/') }}" class="auth-back-btn">
                                    <i class="fa-solid fa-arrow-left"></i>
                                    <span>Назад</span>
                                </a>
                                <span class="auth-mobile-brand">SolidChange</span>
                            </div>

                            <div class="auth-mobile-intro d-md-none">
                                <div class="auth-mobile-intro-top">
                                    <span class="auth-mobile-intro-badge">SolidChange</span>
                                    <h3>Создать аккаунт</h3>
                                </div>
                                <p>Зарегистрируйтесь, чтобы начать обмен криптовалют. Это займёт меньше минуты.</p>
                            </div>

                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="email" name="email" value="{{old('email')}}" class="form-control"
                                           id="exampleInputEmail4"
                                           placeholder="@lang('Email')">
                                    @error('email')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="text" name="username" value="{{old('username')}}" class="form-control"
                                           id="exampleInputEmail3"
                                           placeholder="@lang('Username')">
                                    @error('username')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <div class="password-box">
                                        <input type="password" name="password" value="{{ old('password') }}"
                                               class="form-control password" id="exampleInputPassword1"
                                               placeholder="@lang('Password')">
                                        <i class="password-icon fa-regular fa-eye"></i>
                                    </div>
                                    @error('password')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <div class="password-box">
                                        <input type="password" name="password_confirmation"
                                               value="{{ old('password_confirmation') }}" class="form-control password"
                                               id="exampleInputPassword2"
                                               placeholder="@lang('Confirm Password')">
                                        <i class="password-icon fa-regular fa-eye"></i>
                                    </div>
                                </div>
                                @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration))

                                    <div class="form-group">
                                        {!! NoCaptcha::renderJs() !!}
                                        {!! NoCaptcha::display() !!}
                                        @error('g-recaptcha-response')
                                        <div class="text-danger">@lang($message)</div>
                                        @enderror
                                    </div>
                                @endif
                                @if(basicControl()->manual_recaptcha &&  basicControl()->reCaptcha_status_registration)
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
                            </div>
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('signup')</button>
                        </form>
                        <div class="pt-20 text-center">
                            @lang("Already have an account?")
                            <p class="mb-0 highlight"><a
                                    href="{{ route('login') }}">@lang('Login here')</a></p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </section>
    <!-- login-signup section end -->
@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
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
            display: none !important;
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
            content: 'SD';
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
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px 16px;
        }

        .auth-redesign-card {
            width: min(580px, 100%);
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
        .auth-redesign-card input[type="password"],
        .auth-redesign-card input[type="email"] {
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

        .auth-top-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 18px;
        }

        .auth-back-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            border-radius: 999px;
            border: 1px solid rgba(232, 201, 160, 0.18);
            background: rgba(11, 6, 8, 0.72);
            color: #f5ede4;
            text-decoration: none;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
        }

        .auth-back-btn i { color: #e8c9a0; }

        .auth-mobile-brand {
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(232, 201, 160, 0.12);
            color: #e8c9a0;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .auth-mobile-intro {
            display: none;
            margin-bottom: 18px;
            padding: 16px;
            border: 1px solid rgba(232, 201, 160, 0.16);
            border-radius: 18px;
            background: linear-gradient(135deg, rgba(232, 201, 160, 0.12), rgba(11, 6, 8, 0.86));
        }

        .auth-mobile-intro-top {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 8px;
        }

        .auth-mobile-intro-badge {
            display: inline-flex;
            width: fit-content;
            padding: 5px 10px;
            border-radius: 999px;
            background: rgba(232, 201, 160, 0.14);
            color: #e8c9a0;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .auth-mobile-intro h3 {
            margin: 0;
            color: #fff6ea;
            font-size: 24px;
            line-height: 1.05;
            letter-spacing: -0.04em;
        }

        .auth-mobile-intro p {
            margin: 0;
            color: #cdbdaf;
            font-size: 13px;
            line-height: 1.55;
        }

        .auth-divider {
            display: none !important;
        }

        @media (max-width: 767px) {
            .auth-mobile-intro {
                display: block;
                margin-bottom: 12px;
                text-align: center;
            }

            .auth-redesign-form-column {
                min-height: 100dvh;
                padding: 14px 12px 24px;
            }

            .auth-redesign-card {
                width: 100%;
                max-width: 520px;
                padding: 20px !important;
                border-radius: 24px;
            }

            .auth-redesign-card .section-header {
                margin-bottom: 16px;
            }

            .auth-redesign-card .section-header h3 {
                font-size: 26px;
            }

            .auth-redesign-card .section-header .description {
                font-size: 14px;
            }

            .auth-redesign-card .cmn-btn {
                height: 52px;
            }
        }

        /* ══════════════════════════════════════════════════
           Beautiful logo block — always visible above form
           ══════════════════════════════════════════════════ */
        .auth-form-logo {
            display: block !important;
            text-align: center;
            margin-bottom: 30px;
            padding: 28px 20px 28px;
            background: radial-gradient(circle at 50% 0%, rgba(232, 201, 160, 0.11), transparent 64%);
            border-bottom: 1px solid rgba(232, 201, 160, 0.13);
            border-radius: 20px 20px 0 0;
        }

        .auth-form-logo a.d-inline-block {
            display: inline-block !important;
        }

        .auth-logo-img {
            width: 86px !important;
            height: 86px !important;
            border-radius: 22px !important;
            border: 1.5px solid rgba(232, 201, 160, 0.42) !important;
            box-shadow:
                0 0 0 6px rgba(232, 201, 160, 0.09),
                0 14px 42px rgba(0, 0, 0, 0.52) !important;
            transition: transform 0.25s ease, box-shadow 0.25s ease;
        }

        .auth-logo-img:hover {
            transform: scale(1.04) translateY(-2px);
            box-shadow:
                0 0 0 9px rgba(232, 201, 160, 0.14),
                0 20px 56px rgba(0, 0, 0, 0.58) !important;
        }

        .auth-logo-name {
            display: block;
            margin-top: 13px !important;
            font-size: 20px !important;
            font-weight: 800 !important;
            letter-spacing: -0.05em !important;
            color: #f7ead8 !important;
            line-height: 1 !important;
        }

        /* Hide redundant brand text in top bar since logo is shown */
        .auth-mobile-brand { display: none !important; }

    </style>

    <script>
        'use strict';
        const passwords = document.querySelectorAll('.password');
        const passwordIcons = document.querySelectorAll('.password-icon');

        passwords.forEach(function(password, index) {
            const icon = passwordIcons[index];
            if (password && icon) {
                icon.addEventListener("click", function () {
                    if (password.type === 'password') {
                        password.type = 'text';
                        icon.classList.add('fa-eye-slash');
                    } else {
                        password.type = 'password';
                        icon.classList.remove('fa-eye-slash');
                    }
                });
            }
        });

        function refreshCaptcha2() {
            let img = document.images['captcha_image2'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }
    </script>

@endpush
