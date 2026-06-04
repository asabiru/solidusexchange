@extends($theme.'layouts.login_register')
@section('title',__('Recover Password'))
@section('content')
    <section class="solidus-auth-page">
        <div class="solidus-auth-shell">
            <a class="solidus-auth-brand solidus-wordmark" href="{{ url('/') }}" aria-label="Solidus">
                <span class="solidus-wordmark__mark"></span>
                <span class="solidus-wordmark__text">SOLIDUS</span>
            </a>

            <div class="solidus-auth-card">
                <div class="solidus-auth-kicker">@lang('Восстановление доступа')</div>
                <h1>@lang('Восстановить пароль')</h1>
                <p>@lang('Укажите e-mail аккаунта — мы отправим ссылку для сброса пароля.')</p>

                <form action="{{ route('password.email') }}" method="post" novalidate>
                    @csrf
                    <div class="solidus-auth-field">
                        <label for="recoverEmail">@lang('E-mail')</label>
                        <input type="text" name="email" value="{{ old('email') }}" class="form-control"
                               id="recoverEmail" autocomplete="email" placeholder="name@example.com">
                        @error('email')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>
                    <button type="submit" class="cmn-btn solidus-auth-submit w-100">@lang('Отправить ссылку')</button>
                </form>
                <div class="solidus-auth-register">
                    <span>@lang('Вспомнили пароль?')</span>
                    <a href="{{ route('login') }}">@lang('Войти')</a>
                </div>
            </div>
        </div>
    </section>
@endsection
