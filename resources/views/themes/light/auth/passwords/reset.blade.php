@extends($theme.'layouts.login_register')
@section('title',__('Reset Password'))

@section('content')
    <section class="solidus-auth-page">
        <div class="solidus-auth-shell">
            <a class="solidus-auth-brand solidus-wordmark" href="{{ url('/') }}" aria-label="Solidus">
                <span class="solidus-wordmark__mark"></span>
                <span class="solidus-wordmark__text">SOLIDUS</span>
            </a>

            <div class="solidus-auth-card">
                <div class="solidus-auth-kicker">@lang('Безопасность')</div>
                <h1>@lang('Новый пароль')</h1>
                <p>@lang('Создайте новый пароль для входа в личный кабинет Solidus.')</p>

                <form action="{{ route('password.update') }}" method="post" novalidate>
                    @csrf
                    <input type="hidden" name="token" value="{{ $token }}">
                    <input type="hidden" name="email" value="{{ $email ?? old('email') }}">
                    <div class="solidus-auth-field">
                        <label for="resetPassword">@lang('Новый пароль')</label>
                        <input type="password" name="password" value="{{ old('password') }}"
                               class="form-control" id="resetPassword" autocomplete="new-password" placeholder="••••••••">
                        @error('password')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="solidus-auth-field">
                        <label for="resetPasswordConfirm">@lang('Повторите пароль')</label>
                        <input type="password" name="password_confirmation"
                               class="form-control" id="resetPasswordConfirm" autocomplete="new-password" placeholder="••••••••">
                        @error('password_confirmation')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>
                    <button type="submit" class="cmn-btn solidus-auth-submit w-100">@lang('Сохранить пароль')</button>
                </form>
            </div>
        </div>
    </section>
@endsection
