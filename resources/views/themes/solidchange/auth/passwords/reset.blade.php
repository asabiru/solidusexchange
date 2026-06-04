@extends($theme.'layouts.login_register')
@section('title', 'Новый пароль')
@section('content')
    @php
        $authLogo = getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo) ?: getFile(basicControl()->logo_driver, basicControl()->logo);
    @endphp

    <section class="auth-clean-page">
        <div class="auth-clean-card">
            <a class="auth-clean-back" href="{{ url('/') }}">
                <i class="far fa-arrow-left"></i>
                <span>На главную</span>
            </a>

            <div class="auth-clean-brand">
                <a href="{{ url('/') }}" class="auth-clean-logo"><img src="{{ $authLogo }}" alt="SolidChange"></a>
                <div>
                    <strong>SolidChange</strong>
                    <small>безопасный обмен криптовалют</small>
                </div>
            </div>

            <div class="auth-clean-header">
                <span class="auth-clean-kicker">Безопасность</span>
                <h1>Создайте новый пароль</h1>
                <p>Укажите новый пароль для входа в аккаунт.</p>
            </div>

            <form action="{{ route('password.update') }}" method="post" class="auth-clean-form">
                @csrf
                <input type="hidden" name="token" value="{{ $token }}">
                <input type="hidden" name="email" value="{{ $email ?? old('email') }}">

                <div class="auth-field">
                    <label for="newPassword">Новый пароль</label>
                    <div class="password-box auth-password-box">
                        <input type="password" name="password" class="form-control password" id="newPassword" placeholder="Введите новый пароль">
                        <i class="password-icon fa-regular fa-eye"></i>
                    </div>
                    @error('password')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <div class="auth-field">
                    <label for="confirmPassword">Повторите пароль</label>
                    <div class="password-box auth-password-box">
                        <input type="password" name="password_confirmation" class="form-control password" id="confirmPassword" placeholder="Повторите новый пароль">
                        <i class="password-icon fa-regular fa-eye"></i>
                    </div>
                    @error('password_confirmation')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <button type="submit" class="cmn-btn auth-primary-btn">Сохранить пароль</button>

                <div class="auth-switch">
                    <span>Вернуться ко входу?</span>
                    <a href="{{ route('login') }}">Войти</a>
                </div>
            </form>
        </div>
    </section>

    @include($theme.'auth.partials.clean-auth-style')
    <script>
        document.querySelectorAll('.password-icon').forEach((icon) => {
            icon.addEventListener('click', () => {
                const input = icon.closest('.password-box')?.querySelector('.password');
                if (!input) return;
                input.type = input.type === 'password' ? 'text' : 'password';
                icon.classList.toggle('fa-eye');
                icon.classList.toggle('fa-eye-slash');
            });
        });
    </script>
@endsection
