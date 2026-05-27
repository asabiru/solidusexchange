@extends('admin.layouts.login')
@section('page_title', __('Admin 2FA'))
@section('content')
    @if(Session::has('error'))
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <span class="fw-semibold">{{ Session::get('error') }}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    @endif

    <div class="admin-logo">
        <div class="logo-badge">SC</div>
        <h3>SolidChange</h3>
        <p>Admin 2FA Verification</p>
    </div>

    <div style="margin-bottom: 24px; padding: 16px; border: 1px solid var(--solidus-border); border-radius: 14px; background: rgba(18, 9, 13, 0.72);">
        <p style="margin: 0; color: var(--solidus-muted); line-height: 1.55; font-size: 14px;">
            @lang('Enter the 6-digit code from your authenticator app to finish signing in.')
        </p>
    </div>

    <form method="post" action="{{ route('admin.twoFaCheck') }}" novalidate>
        @csrf

        <div class="form-group">
            <label class="form-label" for="twofa-code">@lang('Verification code')</label>
            <input type="text"
                   class="form-control"
                   name="code"
                   value="{{ old('code') }}"
                   id="twofa-code"
                   autocomplete="one-time-code"
                   inputmode="numeric"
                   pattern="[0-9]*"
                   placeholder="@lang('Enter 2FA code')"
                   autofocus
                   required>
            @error('code')
            <div class="text-danger" style="color: var(--admin-danger); font-size: 14px; margin-top: 8px;">{{ $message }}</div>
            @enderror
        </div>

        <button type="submit" class="btn-admin-login">@lang('Verify and continue')</button>
    </form>

    <div class="admin-footer">
        <a href="{{ route('admin.logout') }}"
           onclick="event.preventDefault(); document.getElementById('admin-logout-form').submit();">
            ← @lang('Use another account')
        </a>
        <form id="admin-logout-form" action="{{ route('admin.logout') }}" method="post" style="display:none;">
            @csrf
        </form>
    </div>
@endsection

@push('script')
    <script>
        'use strict';
    </script>
@endpush
