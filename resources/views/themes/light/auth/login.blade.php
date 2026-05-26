@extends($theme.'layouts.login_register')
@section('title',trans('Login'))
@section('content')
    <section class="solidus-auth-page">
        <div class="solidus-auth-shell">
            <a class="solidus-auth-brand" href="{{ url('/') }}" aria-label="Solidus">
                <span class="solidus-wordmark__mark"></span>
                <span class="solidus-wordmark__text">SOLIDUS</span>
            </a>

            <div class="solidus-auth-card">
                <div class="solidus-auth-kicker">@lang('Личный кабинет')</div>
                <h1>@lang('Вход в аккаунт')</h1>
                <p>@lang('Введите e-mail или имя пользователя и пароль, чтобы продолжить обмен.')</p>

                <form action="{{ route('login') }}" method="post" novalidate>
                    @csrf

                    @if($errors->has('username') || $errors->has('email') || $errors->has('password'))
                        <div class="solidus-auth-alert" role="alert">
                            @lang('Неверный логин или пароль')
                        </div>
                    @endif

                    @if(session('error'))
                        <div class="solidus-auth-alert" role="alert">{{ __(session('error')) }}</div>
                    @endif

                    <div class="solidus-auth-field">
                        <label for="loginUsername">@lang('E-mail или имя пользователя')</label>
                        <input type="text" name="username" value="{{ old('username', config('demo.IS_DEMO') ? (request()->username ?? 'demouser') : '') }}" class="form-control" id="loginUsername" autocomplete="username" placeholder="name@example.com">
                    </div>

                    <div class="solidus-auth-field">
                        <label for="loginPassword">@lang('Пароль')</label>
                        <div class="password-box">
                            <input type="password" name="password" value="{{ old('password', config('demo.IS_DEMO') ? (request()->password ?? 'demouser') : '') }}" class="form-control password" id="loginPassword" autocomplete="current-password" placeholder="••••••••">
                            <i class="password-icon fa-regular fa-eye"></i>
                        </div>
                    </div>

                    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login))
                        <div class="solidus-auth-field">
                            {!! NoCaptcha::renderJs() !!}
                            {!! NoCaptcha::display() !!}
                            @error('g-recaptcha-response')
                                <div class="text-danger">@lang($message)</div>
                            @enderror
                        </div>
                    @endif

                    @if(basicControl()->manual_recaptcha && basicControl()->reCaptcha_status_login)
                        <div class="solidus-auth-field">
                            <label for="captcha">@lang('Код с картинки')</label>
                            <input type="text" tabindex="2" class="form-control @error('captcha') is-invalid @enderror" name="captcha" id="captcha" autocomplete="off" placeholder="@lang('Введите капчу')">
                            @error('captcha')
                                <div class="text-danger">@lang($message)</div>
                            @enderror
                        </div>
                        <div class="solidus-auth-captcha">
                            <img src="{{ route('captcha').'?rand='. rand() }}" id="captcha_image2" alt="captcha">
                            <a class="solidus-auth-captcha__refresh" href="javascript: refreshCaptcha2();">
                                <i class="fal fa-sync"></i>
                            </a>
                        </div>
                    @endif

                    <div class="solidus-auth-row">
                        <label class="solidus-auth-check" for="rememberMe">
                            <input type="checkbox" name="remember" id="rememberMe" {{ old('remember') ? 'checked' : '' }}>
                            <span>@lang('Запомнить меня')</span>
                        </label>
                        <a href="{{ route('password.request') }}">@lang('Забыли пароль?')</a>
                    </div>

                    <button type="submit" class="cmn-btn solidus-auth-submit w-100">@lang('Войти')</button>

                    <div class="solidus-auth-register">
                        <span>@lang('Нет аккаунта?')</span>
                        <a href="{{ route('register') }}">@lang('Создать аккаунт')</a>
                    </div>
                </form>
            </div>
        </div>
    </section>
@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login == 1))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
    <script>
        'use strict';
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
    </script>

@endpush
