@extends($theme.'layouts.login_register')
@section('title', 'Регистрация')
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
        <div class="auth-clean-card auth-clean-card--wide">
            <a class="auth-clean-back" href="{{ url('/') }}">
                <i class="far fa-arrow-left"></i>
                <span>На главную</span>
            </a>

            <div class="auth-clean-brand">
                <a href="{{ url('/') }}" class="auth-clean-logo"><span>SC</span></a>
                <div>
                    <strong>SolidChange</strong>
                    <small>обмен и управление заявками</small>
                </div>
            </div>

            <div class="auth-clean-header">
                <span class="auth-clean-kicker">Новый аккаунт</span>
                <h1>Регистрация</h1>
                <p>Создайте аккаунт или используйте Telegram для быстрого входа.</p>
            </div>

            <form action="{{ route('register') }}" method="post" class="auth-clean-form php-email-form">
                @csrf
                <div class="auth-field">
                    <label for="registerEmail">E-mail</label>
                    <input type="email" name="email" value="{{ old('email') }}" class="form-control" id="registerEmail" placeholder="Введите e-mail">
                    @error('email')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <div class="auth-field">
                    <label for="registerUsername">Имя пользователя</label>
                    <input type="text" name="username" value="{{ old('username') }}" class="form-control" id="registerUsername" placeholder="Придумайте логин">
                    @error('username')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <div class="auth-field">
                    <label for="registerPassword">Пароль</label>
                    <div class="password-box auth-password-box">
                        <input type="password" name="password" value="{{ old('password') }}" class="form-control password" id="registerPassword" placeholder="Введите пароль">
                        <i class="password-icon fa-regular fa-eye"></i>
                    </div>
                    @error('password')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <div class="auth-field">
                    <label for="registerPasswordConfirm">Повторите пароль</label>
                    <input type="password" name="password_confirmation" value="{{ old('password_confirmation') }}" class="form-control" id="registerPasswordConfirm" placeholder="Повторите пароль">
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

                @if(basicControl()->manual_recaptcha && basicControl()->reCaptcha_status_registration)
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

                <button type="submit" class="cmn-btn auth-primary-btn">Создать аккаунт</button>

                @if(config('socialite.telegram_status') && $telegramBotName !== '' && $telegramOAuthUrl)
                    <div class="auth-divider"><span>или</span></div>
                    <a href="{{ $telegramAuthUrl }}" class="auth-telegram-btn" onclick="event.preventDefault(); window.location.href='{{ $telegramOAuthUrl }}';">
                        <i class="fab fa-telegram-plane"></i>
                        <span>Зарегистрироваться через Telegram</span>
                    </a>
                @endif

                <div class="auth-switch">
                    <span>Уже есть аккаунт?</span>
                    <a href="{{ route('login') }}">Войти</a>
                </div>
            </form>
        </div>
    </section>
@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration == 1))
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
