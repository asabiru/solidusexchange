@extends($theme.'layouts.login_register')
@section('title',trans('Register'))
@section('content')
    <section class="solidus-auth-page">
        <div class="solidus-auth-shell">
            <a class="solidus-auth-brand solidus-wordmark" href="{{ url('/') }}" aria-label="Solidus">
                <span class="solidus-wordmark__mark"></span>
                <span class="solidus-wordmark__text">SOLIDUS</span>
            </a>

            <div class="solidus-auth-card">
                <div class="solidus-auth-kicker">@lang('Личный кабинет')</div>
                <h1>@lang('Создать аккаунт')</h1>
                <p>@lang('Зарегистрируйтесь, чтобы сохранять заявки, проходить KYC и быстрее повторять обмены.')</p>

                <form action="{{ route('register') }}" method="post" class="php-email-form" novalidate>
                    @csrf
                    <div class="solidus-auth-field">
                        <label for="registerEmail">@lang('E-mail')</label>
                        <input type="email" name="email" value="{{ old('email') }}" class="form-control"
                               id="registerEmail" autocomplete="email" placeholder="name@example.com">
                        @error('email')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>

                    <div class="solidus-auth-field">
                        <label for="registerUsername">@lang('Имя пользователя')</label>
                        <input type="text" name="username" value="{{ old('username') }}" class="form-control"
                               id="registerUsername" autocomplete="username" placeholder="@lang('Например: solidus_client')">
                        @error('username')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>

                    <div class="solidus-auth-field">
                        <label for="registerPassword">@lang('Пароль')</label>
                        <div class="password-box">
                            <input type="password" name="password" value="{{ old('password') }}"
                                   class="form-control password" id="registerPassword"
                                   autocomplete="new-password" placeholder="••••••••">
                            <i class="password-icon fa-regular fa-eye"></i>
                        </div>
                        @error('password')
                            <span class="text-danger">{{ $message }}</span>
                        @enderror
                    </div>

                    <div class="solidus-auth-field">
                        <label for="registerPasswordConfirm">@lang('Повторите пароль')</label>
                        <input type="password" name="password_confirmation"
                               value="{{ old('password_confirmation') }}" class="form-control"
                               id="registerPasswordConfirm" autocomplete="new-password" placeholder="••••••••">
                    </div>

                    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration))
                        <div class="solidus-auth-field">
                            {!! NoCaptcha::renderJs() !!}
                            {!! NoCaptcha::display() !!}
                            @error('g-recaptcha-response')
                                <div class="text-danger">@lang($message)</div>
                            @enderror
                        </div>
                    @endif

                    @if(basicControl()->manual_recaptcha &&  basicControl()->reCaptcha_status_registration)
                        <div class="solidus-auth-field">
                            <label for="captcha">@lang('Код с картинки')</label>
                            <input type="text" tabindex="2"
                                   class="form-control @error('captcha') is-invalid @enderror"
                                   name="captcha" id="captcha" autocomplete="off"
                                   placeholder="@lang('Введите капчу')">

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
                    <button type="submit" class="btn cmn-btn solidus-auth-submit w-100">@lang('Создать аккаунт')</button>
                </form>
                <div class="solidus-auth-register">
                    <span>@lang('Уже есть аккаунт?')</span>
                    <a href="{{ route('login') }}">@lang('Войти')</a>
                </div>
            </div>
        </div>
    </section>

@endsection

@push('js-lib')
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration == 1))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
    <script>
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

        $(document).on('click', '.btn-custom', function () {
            $('.text-danger').html('');
            refreshCaptcha();
        })

    </script>
@endpush
