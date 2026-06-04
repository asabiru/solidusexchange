@extends($theme.'layouts.login_register')
@section('title', 'Восстановление пароля')
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
                <span class="auth-clean-kicker">Доступ к аккаунту</span>
                <h1>Восстановление пароля</h1>
                <p>Введите e-mail, и мы отправим ссылку для сброса пароля.</p>
            </div>

            <form action="{{ route('password.email') }}" method="post" class="auth-clean-form">
                @csrf

                @if (session('status'))
                    <div class="auth-clean-alert auth-clean-alert--success">{{ session('status') }}</div>
                @endif

                <div class="auth-field">
                    <label for="resetEmail">E-mail</label>
                    <input type="email" name="email" value="{{ old('email') }}" class="form-control" id="resetEmail" placeholder="Введите e-mail">
                    @error('email')
                    <span class="text-danger">{{ $message }}</span>
                    @enderror
                </div>

                <button type="submit" class="cmn-btn auth-primary-btn">Отправить ссылку</button>

                <div class="auth-switch">
                    <span>Вспомнили пароль?</span>
                    <a href="{{ route('login') }}">Войти</a>
                </div>
            </form>
        </div>
    </section>

    @include($theme.'auth.partials.clean-auth-style')
@endsection
