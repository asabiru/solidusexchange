@extends($theme.'layouts.login_register')
@section('title', 'Вход')
@section('content')
    @php
        $telegramBotName = ltrim((string) config('services.telegram.bot_name'), '@');
        $telegramCallbackPath = route('socialiteCallback', ['socialite' => 'telegram'], false);
        $publicBaseUrl = rtrim((string) config('app.url'), '/');
        $telegramAuthUrl = $publicBaseUrl !== '' ? $publicBaseUrl . $telegramCallbackPath : route('socialiteCallback', 'telegram');
        $telegramBotId = explode(':', (string) config('services.telegram.bot_token'))[0] ?? '';
        $telegramOAuthUrl = $telegramBotId !== ''
            ? 'https://oauth.telegram.org/auth?bot_id=' . $telegramBotId . '&origin=' . urlencode(config('app.url')) . '&embed=0&request_access=write&return_to=' . urlencode($telegramAuthUrl)
            : null;
    @endphp

    <section class="auth-clean-page">
        <div class="auth-clean-card">
            <a class="auth-clean-back" href="{{ url('/') }}">
                <i class="far fa-arrow-left"></i>
                <span>На главную</span>
            </a>

            <div class="auth-clean-brand">
                <a href="{{ url('/') }}" class="auth-clean-logo"><span>SC</span></a>
                <div>
                    <strong>SolidChange</strong>
                    <small>безопасный обмен криптовалют</small>
                </div>
            </div>

            <div class="auth-clean-header">
                <span class="auth-clean-kicker">Личный кабинет</span>
                <h1>Вход в аккаунт</h1>
                <p>Введите логин и пароль или продолжите через Telegram.</p>
            </div>

            <form action="{{ route('login') }}" method="post" class="auth-clean-form">
                @csrf
                <div class="auth-field">
                    <label for="loginUsername">E-mail или имя пользователя</label>
                    <input type="text" name="username" value="{{ old('username', config('demo.IS_DEMO') ? (request()->username ?? 'demouser') : '') }}" class="form-control" id="loginUsername" placeholder="Введите e-mail или логин">
                    @error('username')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <div class="auth-field">
                    <label for="loginPassword">Пароль</label>
                    <div class="password-box auth-password-box">
                        <input type="password" name="password" value="{{ old('password', config('demo.IS_DEMO') ? (request()->password ?? 'demouser') : '') }}" class="form-control password" id="loginPassword" placeholder="Введите пароль">
                        <i class="password-icon fa-regular fa-eye"></i>
                    </div>
                    @error('password')
                    <span class="text-danger">{{ $message }}</span>
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

                @if(basicControl()->manual_recaptcha && basicControl()->reCaptcha_status_login)
                    <div class="auth-field">
                        <label for="captcha">Код с картинки</label>
                        <input type="text" class="form-control @error('captcha') is-invalid @enderror" name="captcha" id="captcha" autocomplete="off" placeholder="Введите код">
                        @error('captcha')
                        <div class="text-danger">@lang($message)</div>
                        @enderror
                    </div>
                    <div class="auth-captcha">
                        <img src="{{ route('captcha').'?rand='. rand() }}" id="captcha_image2" alt="captcha">
                        <a href="javascript: refreshCaptcha2();" aria-label="Обновить код"><i class="fal fa-sync"></i></a>
                    </div>
                @endif

                <div class="auth-row">
                    <label class="auth-check" for="rememberMe">
                        <input type="checkbox" name="remember" id="rememberMe" {{ old('remember') ? 'checked' : '' }}>
                        <span>Запомнить меня</span>
                    </label>
                    <a class="auth-link" href="{{ route('password.request') }}">Забыли пароль?</a>
                </div>

                <button type="submit" class="cmn-btn auth-primary-btn">Войти</button>

                @if(config('socialite.telegram_status') && $telegramBotName !== '' && $telegramOAuthUrl)
                    <div class="auth-divider"><span>или</span></div>
                    <a href="{{ $telegramAuthUrl }}" class="auth-telegram-btn" onclick="event.preventDefault(); window.location.href='{{ $telegramOAuthUrl }}';">
                        <i class="fab fa-telegram-plane"></i>
                        <span>Войти через Telegram</span>
                    </a>
                @endif

                <div class="auth-switch">
                    <span>Нет аккаунта?</span>
                    <a href="{{ route('register') }}">Создать аккаунт</a>
                </div>
            </form>
        </div>
    </section>
@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login == 1))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
    @include($theme.'auth.partials.clean-auth-style')
    <script>
        'use strict';
        const password = document.querySelector('.password');
        const passwordIcon = document.querySelector('.password-icon');

        if (password && passwordIcon) {
            passwordIcon.addEventListener('click', function () {
                if (password.type === 'password') {
                    password.type = 'text';
                    passwordIcon.classList.add('fa-eye-slash');
                } else {
                    password.type = 'password';
                    passwordIcon.classList.remove('fa-eye-slash');
                }
            });
        }

        function refreshCaptcha2() {
            let img = document.images['captcha_image2'];
            if (!img) return;
            img.src = img.src.substring(0, img.src.lastIndexOf('?')) + '?rand=' + Math.random() * 1000;
        }
    </script>
@endpush
