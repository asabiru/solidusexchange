@extends('admin.layouts.login')
@section('page_title', __('Admin Login'))
@section('content')
    @if(Session::has('error'))
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <span class="fw-semibold">{{ Session::get('error') }}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    @endif

    <div class="admin-logo">
        <img src="{{ getFile(basicControl()->admin_logo_driver, basicControl()->admin_logo, true) }}"
             alt="{{ basicControl()->site_title }}"
             style="width:64px;height:64px;object-fit:contain;border-radius:12px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">
        <h3>{{ basicControl()->site_title }}</h3>
        <p>Admin Panel</p>
    </div>

    <form method="post"
          action="{{ route('admin.login.submit') }}"
          data-auth-transition
          data-submitting-text="@lang('Signing in...')"
          novalidate>
        @csrf
        <div class="form-group">
            <label class="form-label" for="username">@lang('Email or Username')</label>
            <input type="text"
                   class="form-control"
                   name="username"
                   value="{{ old('username', config('demo.IS_DEMO') ? (request()->username ?? 'admin') : '') }}"
                   id="username"
                   autocomplete="off"
                   placeholder="@lang('Enter Email or Username')" required>
            @error('username')
            <div class="text-danger" style="color: var(--admin-danger); font-size: 14px; margin-top: 8px;">{{ $message }}</div>
            @enderror
        </div>

        <div class="form-group">
            <label class="form-label" for="password">@lang("Password")</label>
            <input type="password"
                   class="form-control"
                   name="password"
                   value="{{ old('password', config('demo.IS_DEMO') ? (request()->username ?? 'admin') : '') }}"
                   id="password"
                   placeholder="@lang('Enter Password')" required>
            @error('password')
            <div class="text-danger" style="color: var(--admin-danger); font-size: 14px; margin-top: 8px;">{{ $message }}</div>
            @enderror
            <div style="text-align: right; margin-top: 8px;">
                <a href="{{ route('admin.password.request') }}" style="color: var(--solidus-accent); text-decoration: none; font-size: 14px;">
                    @lang("Forgot Password?")
                </a>
            </div>
        </div>

        @if($basicControl->google_recaptcha === 1 && $basicControl->google_reCapture_admin_login === 1)
            <div class="form-group">
                {!! NoCaptcha::renderJs() !!}
                {!! NoCaptcha::display() !!}
                @error('g-recaptcha-response')
                <div class="text-danger">@lang($message)</div>
                @enderror
            </div>
        @endif

        @if(basicControl()->manual_recaptcha &&  basicControl()->recaptcha_admin_login)
            <div class="form-group">
                <label class="form-label" for="captcha">@lang('Captcha Code')</label>
                <input type="text"
                       class="form-control"
                       name="captcha"
                       id="captcha"
                       autocomplete="off"
                       placeholder="@lang('Enter Captcha')" required>
                @error('captcha')
                <div class="text-danger">{{ $message }}</div>
                @enderror

                <div style="margin-top: 8px;">
                    <img src="{{route('captcha').'?rand='. rand()}}" id='captcha_image' style="border-radius: 8px; border: 1px solid var(--solidus-border);">
                    <a href='javascript: refreshCaptcha();' style="color: var(--solidus-accent); text-decoration: none; margin-left: 8px;">
                        <i class="fa-solid fa-rotate"></i>
                    </a>
                </div>
            </div>
        @endif

        <div class="form-check mb-4">
            <input class="form-check-input" type="checkbox" name="remember_me" value=""
                   id="remember" {{ old('remember') ? 'checked' : '' }}>
            <label class="form-check-label" for="remember">
                @lang('Remember me')
            </label>
        </div>

        <button type="submit" class="btn-admin-login">@lang('Sign in')</button>
    </form>

    <div class="admin-footer">
        <a href="{{ url('/') }}">← @lang('Back to website')</a>
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