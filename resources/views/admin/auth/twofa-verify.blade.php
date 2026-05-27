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

    <div class="admin-transition-note" style="margin-bottom: 24px; padding: 16px; border: 1px solid var(--solidus-border); border-radius: 14px; background: rgba(18, 9, 13, 0.72);">
        <p style="margin: 0; color: var(--solidus-muted); line-height: 1.55; font-size: 14px;">
            @lang('Enter the 6-digit code from your authenticator app to finish signing in.')
        </p>
    </div>

    <form method="post"
          action="{{ route('admin.twoFaCheck') }}"
          data-auth-transition
          data-submitting-text="@lang('Verifying...')"
          id="admin-twofa-form"
          novalidate>
        @csrf

        <div class="form-group">
            <label class="form-label" for="twofa-code">@lang('Verification code')</label>
            <input type="hidden" name="code" id="twofa-code" value="{{ old('code') }}">

            <div class="auth-otp-grid" id="otpGrid" aria-label="@lang('2FA code inputs')">
                @for($i = 0; $i < 6; $i++)
                    <input type="text"
                           class="form-control auth-otp-digit"
                           inputmode="numeric"
                           pattern="[0-9]*"
                           maxlength="1"
                           autocomplete="one-time-code"
                           aria-label="@lang('2FA digit') {{ $i + 1 }}"
                           data-otp-index="{{ $i }}">
                @endfor
            </div>

            <div class="admin-transition-note">
                @lang('The code will be submitted automatically after the 6th digit.')
            </div>

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

        (function () {
            const form = document.getElementById('admin-twofa-form');
            const hiddenCode = document.getElementById('twofa-code');
            const inputs = Array.from(document.querySelectorAll('.auth-otp-digit'));

            if (!form || !hiddenCode || inputs.length === 0) {
                return;
            }

            const syncHiddenCode = function () {
                const code = inputs.map(function (input) {
                    return (input.value || '').replace(/\D/g, '').slice(-1);
                }).join('');
                hiddenCode.value = code;
                return code;
            };

            const focusInput = function (index) {
                if (index >= 0 && index < inputs.length) {
                    inputs[index].focus();
                    inputs[index].select();
                }
            };

            const submitIfComplete = function () {
                const code = syncHiddenCode();
                if (code.length === inputs.length) {
                    window.setTimeout(function () {
                        if (!document.body.classList.contains('is-exiting')) {
                            form.requestSubmit ? form.requestSubmit() : form.submit();
                        }
                    }, 120);
                }
            };

            inputs.forEach(function (input, index) {
                input.addEventListener('input', function () {
                    let value = (input.value || '').replace(/\D/g, '');
                    if (!value) {
                        input.value = '';
                        syncHiddenCode();
                        return;
                    }

                    if (value.length > 1) {
                        const pasted = value.slice(0, inputs.length - index).split('');
                        pasted.forEach(function (digit, offset) {
                            if (inputs[index + offset]) {
                                inputs[index + offset].value = digit;
                            }
                        });
                        focusInput(Math.min(index + pasted.length, inputs.length - 1));
                        submitIfComplete();
                        return;
                    }

                    input.value = value;
                    syncHiddenCode();
                    if (value && index < inputs.length - 1) {
                        focusInput(index + 1);
                    }
                    submitIfComplete();
                });

                input.addEventListener('keydown', function (event) {
                    if (event.key === 'Backspace' && !input.value && index > 0) {
                        event.preventDefault();
                        inputs[index - 1].value = '';
                        syncHiddenCode();
                        focusInput(index - 1);
                    }
                });

                input.addEventListener('paste', function (event) {
                    event.preventDefault();
                    const pasted = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, inputs.length);
                    if (!pasted) {
                        return;
                    }

                    pasted.split('').forEach(function (digit, offset) {
                        if (inputs[index + offset]) {
                            inputs[index + offset].value = digit;
                        }
                    });
                    syncHiddenCode();
                    focusInput(Math.min(index + pasted.length, inputs.length - 1));
                    submitIfComplete();
                });
            });

            form.addEventListener('submit', function () {
                syncHiddenCode();
            });

            const firstFilled = hiddenCode.value ? hiddenCode.value.replace(/\D/g, '').slice(0, inputs.length) : '';
            if (firstFilled.length) {
                firstFilled.split('').forEach(function (digit, index) {
                    if (inputs[index]) {
                        inputs[index].value = digit;
                    }
                });
                syncHiddenCode();
                if (firstFilled.length < inputs.length) {
                    focusInput(firstFilled.length);
                } else {
                    focusInput(inputs.length - 1);
                }
            } else {
                focusInput(0);
            }
        })();
    </script>
@endpush
