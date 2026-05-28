@extends('admin.layouts.app')
@section('page_title', __('Add User'))
@section('content')
<div class="content container-fluid">

    {{-- Page header --}}
    <div class="page-header mb-4">
        <div class="row align-items-center">
            <div class="col-sm mb-2 mb-sm-0">
                <nav aria-label="breadcrumb">
                    <ol class="breadcrumb breadcrumb-no-gutter">
                        <li class="breadcrumb-item"><a href="{{ route('admin.users') }}">@lang('Users')</a></li>
                        <li class="breadcrumb-item active" aria-current="page">@lang('Add User')</li>
                    </ol>
                </nav>
                <h1 class="page-header-title">@lang('Add User')</h1>
            </div>
        </div>
    </div>

    {{-- Alerts --}}
    @if(session('error'))
    <div class="alert alert-danger mb-4" role="alert">{{ session('error') }}</div>
    @endif
    @if($errors->any())
    <div class="alert alert-danger mb-4" role="alert">
        <ul class="mb-0 ps-3">
            @foreach($errors->all() as $err)
            <li>{{ $err }}</li>
            @endforeach
        </ul>
    </div>
    @endif

    <form action="{{ route('admin.user.store') }}" method="POST">
        @csrf

        <div class="row">
            {{-- ── Left column: credentials + personal ─────────── --}}
            <div class="col-lg-6 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h5 class="card-header-title">@lang('Account Information')</h5>
                    </div>
                    <div class="card-body">

                        {{-- First Name --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('First Name') <span class="text-danger">*</span></label>
                            <input type="text" name="firstName" class="form-control @error('firstName') is-invalid @enderror"
                                   value="{{ old('firstName') }}" placeholder="@lang('First name')" autocomplete="off">
                            @error('firstName')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Last Name --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Last Name') <span class="text-danger">*</span></label>
                            <input type="text" name="lastName" class="form-control @error('lastName') is-invalid @enderror"
                                   value="{{ old('lastName') }}" placeholder="@lang('Last name')" autocomplete="off">
                            @error('lastName')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Username --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Username') <span class="text-danger">*</span></label>
                            <input type="text" name="username" class="form-control @error('username') is-invalid @enderror"
                                   value="{{ old('username') }}" placeholder="@lang('Username')" autocomplete="off">
                            @error('username')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Email --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Email') <span class="text-danger">*</span></label>
                            <input type="email" name="email" class="form-control @error('email') is-invalid @enderror"
                                   value="{{ old('email') }}" placeholder="@lang('Email address')" autocomplete="off">
                            @error('email')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Password --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Password') <span class="text-danger">*</span></label>
                            <div class="input-group">
                                <input type="password" name="password" id="passwordInput"
                                       class="form-control @error('password') is-invalid @enderror"
                                       placeholder="@lang('Minimum 6 characters')" autocomplete="new-password">
                                <button type="button" class="btn btn-secondary" id="togglePassword" tabindex="-1">
                                    <i class="bi-eye" id="togglePasswordIcon"></i>
                                </button>
                            </div>
                            @error('password')
                            <div class="text-danger small mt-1">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Password Confirmation --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Confirm Password') <span class="text-danger">*</span></label>
                            <div class="input-group">
                                <input type="password" name="password_confirmation" id="passwordConfirmInput"
                                       class="form-control" placeholder="@lang('Repeat password')" autocomplete="new-password">
                                <button type="button" class="btn btn-secondary" id="togglePasswordConfirm" tabindex="-1">
                                    <i class="bi-eye" id="togglePasswordConfirmIcon"></i>
                                </button>
                            </div>
                        </div>

                        {{-- Phone --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Phone')</label>
                            <input type="text" name="phone" class="form-control @error('phone') is-invalid @enderror"
                                   value="{{ old('phone') }}" placeholder="+7 999 123-45-67" autocomplete="off">
                            @error('phone')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Status --}}
                        <div class="mb-0">
                            <label class="form-label d-block">@lang('Status')</label>
                            <div class="form-check form-switch">
                                <input type="hidden" name="status" value="0">
                                <input type="checkbox" class="form-check-input" name="status" id="statusSwitch"
                                       value="1" {{ old('status', '1') == '1' ? 'checked' : '' }}>
                                <label class="form-check-label" for="statusSwitch">@lang('Active')</label>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {{-- ── Right column: address ──────────────────────── --}}
            <div class="col-lg-6 mb-4">
                <div class="card h-100">
                    <div class="card-header">
                        <h5 class="card-header-title">@lang('Address Information')</h5>
                    </div>
                    <div class="card-body">

                        {{-- Country --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Country')</label>
                            <select name="country" class="form-select @error('country') is-invalid @enderror">
                                <option value="">@lang('Select Country')</option>
                                @foreach($allCountry as $country)
                                <option value="{{ $country['name'] }}"
                                    {{ old('country') == $country['name'] ? 'selected' : '' }}>
                                    {{ $country['name'] }}
                                </option>
                                @endforeach
                            </select>
                            @error('country')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- City --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('City')</label>
                            <input type="text" name="city" class="form-control @error('city') is-invalid @enderror"
                                   value="{{ old('city') }}" placeholder="@lang('City')" autocomplete="off">
                            @error('city')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- State --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('State / Region')</label>
                            <input type="text" name="state" class="form-control @error('state') is-invalid @enderror"
                                   value="{{ old('state') }}" placeholder="@lang('State')" autocomplete="off">
                            @error('state')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Zip --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Zip Code')</label>
                            <input type="text" name="zipCode" class="form-control @error('zipCode') is-invalid @enderror"
                                   value="{{ old('zipCode') }}" placeholder="@lang('Zip code')" autocomplete="off">
                            @error('zipCode')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Address 1 --}}
                        <div class="mb-3">
                            <label class="form-label">@lang('Address Line 1')</label>
                            <input type="text" name="addressOne" class="form-control @error('addressOne') is-invalid @enderror"
                                   value="{{ old('addressOne') }}" placeholder="@lang('Street, house, apt')" autocomplete="off">
                            @error('addressOne')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                        {{-- Address 2 --}}
                        <div class="mb-0">
                            <label class="form-label">@lang('Address Line 2') <span class="text-muted small">(@lang('optional'))</span></label>
                            <input type="text" name="addressTwo" class="form-control @error('addressTwo') is-invalid @enderror"
                                   value="{{ old('addressTwo') }}" placeholder="@lang('Additional address info')" autocomplete="off">
                            @error('addressTwo')
                            <div class="invalid-feedback">{{ $message }}</div>
                            @enderror
                        </div>

                    </div>
                </div>
            </div>
        </div>

        {{-- Submit row --}}
        <div class="d-flex gap-3 mb-5">
            <button type="submit" class="btn btn-primary px-4">
                <i class="bi-person-plus me-2"></i>@lang('Create User')
            </button>
            <a href="{{ route('admin.users') }}" class="btn btn-secondary px-4">
                @lang('Cancel')
            </a>
        </div>

    </form>
</div>
@endsection

@push('css-lib')
<link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
@endpush

@push('script')
<script>
    // Toggle password visibility
    function setupToggle(btnId, inputId, iconId) {
        document.getElementById(btnId).addEventListener('click', function () {
            var inp = document.getElementById(inputId);
            var ico = document.getElementById(iconId);
            if (inp.type === 'password') {
                inp.type = 'text';
                ico.classList.replace('bi-eye', 'bi-eye-slash');
            } else {
                inp.type = 'password';
                ico.classList.replace('bi-eye-slash', 'bi-eye');
            }
        });
    }
    setupToggle('togglePassword',        'passwordInput',        'togglePasswordIcon');
    setupToggle('togglePasswordConfirm', 'passwordConfirmInput', 'togglePasswordConfirmIcon');
</script>
@endpush
