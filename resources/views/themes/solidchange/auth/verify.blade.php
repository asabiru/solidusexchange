@extends('layouts.app')
@section('title',trans('Verify'))
@section('content')
<div class="container">
    <div class="row justify-content-center">
        <div class="col-md-8">
            <div class="card">
                <div class="card-header">{{ __('Verify Your Email Address') }}</div>

                <div class="card-body">
                    <div class="auth-form-logo text-center mb-3">
                        <a href="{{ url('/') }}" class="d-inline-block">
                            <img src="{{ getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo) }}"
                                 alt="{{ basicControl()->site_title }}"
                                 class="auth-logo-img" width="80" height="80">
                        </a>
                        <div class="auth-logo-name mt-2">{{ basicControl()->site_title }}</div>
                    </div>
                    @if (session('resent'))
                        <div class="alert alert-success" role="alert">
                            {{ __('A fresh verification link has been sent to your email address.') }}
                        </div>
                    @endif

                    {{ __('Before proceeding, please check your email for a verification link.') }}
                    {{ __('If you did not receive the email') }},
                    <form class="d-inline" method="POST" action="{{ route('verification.resend') }}">
                        @csrf
                        <button type="submit" class="btn btn-link p-0 m-0 align-baseline">{{ __('click here to request another') }}</button>.
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>
@endsection
