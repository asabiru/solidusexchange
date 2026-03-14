@extends('admin.layouts.login')
@section('page_title', __('Admin | Reset Password'))
@section('content')

    <form method="post" action="" class="js-validate needs-validation"
          novalidate>
        @csrf
        <div class="text-center">
            <div class="mb-5">
                <h1 class="display-5">@lang('Reset password')</h1>
                <p>@lang("Enter the email address you used when you joined and we'll send you instructions to reset your password.")</p>
            </div>
        </div>

        <div class="mb-4">
            <label class="form-label" for="resetPasswordSrEmail" tabindex="0">@lang('Your email')</label>
            <input type="email" class="form-control form-control-lg" name="email" id="resetPasswordSrEmail"
                   tabindex="1" placeholder="@lang('Enter your email address')" aria-label="@lang('Enter your email address')"
                   required>
            <span class="invalid-feedback">@lang('Please enter a valid email address.')</span>
            @error('email')
            <p class="text-danger">{{ $message }}</p>
            @enderror
        </div>

        <div class="input-group input-group-merge" data-hs-validation-validate-class>
            <input type="password"
                   class="js-toggle-password form-control form-control-lg @error('password') is-invalid @enderror"
                   name="password" id="signupSrPassword" placeholder="@lang('Enter Password')"
                   data-hs-toggle-password-options='
                               {
                                "target": "#changePassTarget",
                                "defaultClass": "bi-eye-slash",
                                "showClass": "bi-eye",
                                "classChangeTarget": "#changePassIcon"
                                }'>
            <a id="changePassTarget" class="input-group-append input-group-text"
               href="javascript:void(0)">
                <i id="changePassIcon" class="bi-eye"></i>
            </a>
        </div>
        @error('password')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror

        <div class="d-grid gap-2">
            <button type="submit" class="btn btn-primary btn-lg">@lang('Submit')</button>
            <div class="text-center">
                <a class="btn btn-link" href="{{ route('admin.login') }}">
                    <i class="bi-chevron-left"></i> @lang('Back to Sign in')
                </a>
            </div>
        </div>
    </form>
@endsection
