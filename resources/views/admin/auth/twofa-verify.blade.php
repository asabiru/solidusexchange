@extends('admin.layouts.login')
@section('page_title', __('Admin 2FA'))
@section('content')
    <div class="card card-lg mt-lg-5">
        <div class="card-body">
            @if(Session::has('error'))
                <div class="alert alert-danger alert-dismissible fade show" role="alert">
                    <span class="fw-semibold">{{ Session::get('error') }}</span>
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            @endif
            <form method="post" action="{{ route('admin.twoFaCheck') }}" class="js-validate needs-validation"
                  novalidate>
                @csrf
                <div class="text-center">
                    <div class="mb-5">
                        <h1 class="display-5">@lang('Verification here!')</h1>
                    </div>
                </div>

                <div class="mb-4">
                    <label class="form-label" for="signinSrEmail">@lang('Email or Username')</label>
                    <input type="text" name="code" value="{{ old('code') }}" class="form-control"
                           id="exampleInputEmail1"
                           placeholder="@lang('2 FA Code')" required>
                    @error('code')
                    <span class="text-danger">{{$message}}</span>
                    @enderror
                </div>
                <div class="d-grid">
                    <button type="submit" class="btn btn-primary btn-lg">@lang('Submit')</button>
                </div>
            </form>
        </div>
    </div>

@endsection

@push('script')
    <script>
        'use strict';

    </script>
@endpush

