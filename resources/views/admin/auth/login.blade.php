@extends('admin.layouts.login')
@section('page_title', __('Admin Login'))
@section('content')
    <div class="card card-lg mt-lg-5">
        <div class="card-body">
            @if(Session::has('error'))
                <div class="alert alert-danger alert-dismissible fade show" role="alert">
                    <span class="fw-semibold">{{ __(Session::get('error')) }}</span>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            @endif
            @if($errors->has('username') || $errors->has('email') || $errors->has('password'))
                <div class="alert alert-danger" role="alert">
                    <span class="fw-semibold">@lang('Неверный логин или пароль')</span>
                </div>
            @endif
            <form method="post" action="{{ route('admin.login.submit') }}" class="js-validate needs-validation"
                  novalidate>
                @csrf
                <div class="text-center">
                    <div class="mb-5">
                        <a class="solidus-auth-brand solidus-wordmark justify-content-center mb-4" href="{{ url('/') }}" aria-label="Solidus">
                            <span class="solidus-wordmark__mark"></span>
                            <span class="solidus-wordmark__text">SOLIDUS</span>
                        </a>
                        <h1 class="display-5">@lang('Вход в админку')</h1>
                        <p class="text-body">@lang('Панель управления заявками, курсами и трейдерами.')</p>
                    </div>
                </div>

                <div class="mb-4">
                    <label class="form-label" for="signinSrEmail">@lang('E-mail или имя пользователя')</label>
                    <input type="text"
                           class="form-control form-control-lg @error('username') is-invalid @enderror @error('email') is-invalid @enderror"
                           name="username"
                           value="{{ old('username', config('demo.IS_DEMO') ? (request()->username ?? 'admin') : '') }}"
                           id="signinSrEmail" autocomplete="off"
                           tabindex="0" placeholder="admin" required>
                    @error('username')
                    <span class="invalid-feedback">{{ $message }}</span>
                    @enderror
                    @error('email')
                    <span class="invalid-feedback">{{ $message }}</span>
                    @enderror
                </div>
                <!-- End Form -->

                <!-- Form -->
                <div class="mb-2">
                    <label class="form-label w-100" for="signupSrPassword">
                        <span>@lang("Пароль")</span>
                    </label>
                    <div class="input-group input-group-merge" data-hs-validation-validate-class>
                        <input type="password"
                               tabindex="1"
                               class="js-toggle-password form-control form-control-lg @error('password') is-invalid @enderror"
                               name="password" value="{{ old('password', config('demo.IS_DEMO') ? (request()->username ?? 'admin') : '') }}"
                               id="signupSrPassword"
                               placeholder="••••••••"
                               data-hs-toggle-password-options='
                               {
                                "target": "#changePassTarget",
                                "defaultClass": "bi-eye-slash",
                                "showClass": "bi-eye",
                                "classChangeTarget": "#changePassIcon"
                                }'>
                        <a id="changePassTarget" class="input-group-append input-group-text"
                           href="javascript:void(0);">
                            <i id="changePassIcon" class="bi-eye"></i>
                        </a>
                    </div>
                    @error('password')
                    <span class="invalid-feedback d-block">{{ $message }}</span>
                    @enderror
                    <span class="d-flex justify-content-end align-items-center">
                    <a class="form-label-link mb-0" href="{{ route('admin.password.request') }}">
                        @lang("Забыли пароль?")</a>
                    </span>
                </div>

                @if($basicControl->google_recaptcha === 1 && $basicControl->google_reCapture_admin_login === 1)
                    <div class="form-group mb-2">
                        {!! NoCaptcha::renderJs() !!}
                        {!! NoCaptcha::display() !!}
                        @error('g-recaptcha-response')
                        <div class="text-danger">@lang($message)</div>
                        @enderror
                    </div>
                @endif

                @if(basicControl()->manual_recaptcha &&  basicControl()->recaptcha_admin_login)
                    <div class="mb-4">
                        <label class="form-label" for="captcha">@lang('Код с картинки')</label>
                        <input type="text" tabindex="2"
                               class="form-control form-control-lg @error('captcha') is-invalid @enderror"
                               name="captcha" id="captcha" autocomplete="off"
                               placeholder="@lang('Введите капчу')" required>
                        @error('captcha')
                        <span class="invalid-feedback">{{ $message }}</span>
                        @enderror
                    </div>

                    <div class="mb-4">
                        <div class="input-group input-group-merge" data-hs-validation-validate-class>
                            <img src="{{route('captcha').'?rand='. rand()}}" id='captcha_image'>
                            <a class="input-group-append input-group-text"
                               href='javascript: refreshCaptcha();'>
                                <i class="bi-arrow-repeat fs-1 text-primary"></i>
                            </a>
                        </div>
                    </div>
                @endif

                <div class="form-check mb-4">
                    <input class="form-check-input" type="checkbox" name="remember_me" value=""
                           id="termsCheckbox" {{ old('remember') ? 'checked' : '' }}>
                    <label class="form-check-label" for="termsCheckbox">
                        @lang('Запомнить меня')
                    </label>
                </div>

                <div class="d-grid">
                    <button type="submit" class="btn btn-primary btn-lg">@lang('Войти')</button>
                </div>
            </form>
        </div>
    </div>

@endsection

@push('script')
    <script>
        'use strict';

        function refreshCaptcha() {
            let img = document.images['captcha_image'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }
    </script>
@endpush
