@extends($theme.'layouts.user')
@section('page_title', __('Profile'))

@section('content')
    <div class="section dashboard">
        <div class="row">
            @include($theme.'user.profile.profileNav')

            <form method="post" action="{{ route('user.profile') }}">
                @csrf
                <div class="account-settings-profile-section">
                    <div class="profile-shell">
                        <div class="card profile-identity-card">
                            <div class="card-header border-0">
                                <h5 class="card-title mb-1">@lang('Identity details')</h5>
                                <p class="profile-card-text mb-0">
                                    @if($kycProfileLocked)
                                        @lang('These details are filled automatically from approved KYC verification and cannot be edited manually.')
                                    @else
                                        @lang('These details will appear here automatically after your KYC verification is approved.')
                                    @endif
                                </p>
                            </div>
                            <div class="card-body pt-0">
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label for="firstname" class="form-label">@lang('Firstname')</label>
                                        <input type="text"
                                               class="form-control"
                                               id="firstname"
                                               value="{{ $userProfile->firstname ?: __('Will be filled after KYC verification') }}"
                                               readonly>
                                    </div>
                                    <div class="col-md-6">
                                        <label for="lastname" class="form-label">@lang('Lastname')</label>
                                        <input type="text"
                                               class="form-control"
                                               id="lastname"
                                               value="{{ $userProfile->lastname ?: __('Will be filled after KYC verification') }}"
                                               readonly>
                                    </div>
                                    <div class="col-md-6">
                                        <label for="phone" class="form-label">@lang('Phone')</label>
                                        <input type="text"
                                               class="form-control"
                                               id="phone"
                                               value="{{ trim(($userProfile->phone_code ? $userProfile->phone_code . ' ' : '') . ($userProfile->phone ?: '')) ?: __('Will be filled after KYC verification') }}"
                                               readonly>
                                    </div>
                                    <div class="col-md-6">
                                        <label for="document_number" class="form-label">@lang('Document ID')</label>
                                        <input type="text"
                                               class="form-control"
                                               id="document_number"
                                               value="{{ $userProfile->document_number ?: __('Will be filled after KYC verification') }}"
                                               readonly>
                                    </div>
                                    <div class="col-12">
                                        <label for="address" class="form-label">@lang('Address')</label>
                                        <textarea class="form-control"
                                                  id="address"
                                                  rows="3"
                                                  readonly>{{ trim(collect([$userProfile->address, $userProfile->address_two, $userProfile->city, $userProfile->country, $userProfile->zip_code])->filter()->implode(', ')) ?: __('Will be filled after KYC verification') }}</textarea>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="card">
                            <div class="card-header border-0">
                                <h5 class="card-title">@lang('Profile Details')</h5>
                            </div>
                            <div class="card-body pt-0">
                                <div class="profile-form-section">
                                    <div class="row g-3">
                                        <div class="col-md-6">
                                            <label for="username" class="form-label">@lang('Username')</label>
                                            <input type="text" name="username"
                                                   placeholder="@lang('Username')"
                                                   value="{{ old('username', $userProfile->username) }}"
                                                   class="form-control"
                                                   id="username" required>
                                            <div class="text-danger">@error('username') @lang($message) @enderror</div>
                                        </div>
                                        <div class="col-md-6">
                                            <label for="email" class="form-label">@lang('Email Address')</label>
                                            <input type="text"
                                                   value="{{ old('email', $userProfile->email) }}"
                                                   name="email"
                                                   class="form-control"
                                                   id="email"
                                                   required>
                                            <div class="text-danger">@error('email') @lang($message) @enderror</div>
                                        </div>
                                        <div class="col-md-6">
                                            <label class="form-label">@lang('Language')</label>
                                            <select class="cmn-select2" name="language">
                                                @foreach($languages as $language)
                                                    <option value="{{ $language->id }}" {{ old('language', $userProfile->language_id) == $language->id ? 'selected' : '' }}>
                                                        {{ __($language->name) }}
                                                    </option>
                                                @endforeach
                                            </select>
                                            <div class="text-danger">@error('language') @lang($message) @enderror</div>
                                        </div>
                                        <div class="col-md-6">
                                            <label class="form-label">@lang('Time Zone')</label>
                                            <select class="cmn-select2" name="timezone">
                                                @foreach(timezone_identifiers_list() as $value)
                                                    <option value="{{ $value }}" {{ old('timezone', $userProfile->timezone) == $value ? 'selected' : '' }}>
                                                        {{ __($value) }}
                                                    </option>
                                                @endforeach
                                            </select>
                                            <div class="text-danger">@error('timezone') @lang($message) @enderror</div>
                                        </div>
                                    </div>
                                    <div class="btn-area d-flex g-3">
                                        <button type="submit" class="cmn-btn">@lang('save changes')</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    </div>
@endsection

@push('extra_styles')
    <style>
        .profile-shell {
            display: grid;
            gap: 24px;
        }

        .profile-identity-card {
            border: 1px solid rgba(171, 131, 255, 0.18);
            background:
                radial-gradient(circle at top right, rgba(164, 93, 255, 0.14), transparent 34%),
                linear-gradient(180deg, rgba(27, 15, 53, 0.94), rgba(18, 11, 38, 0.96));
            box-shadow: 0 28px 50px rgba(8, 5, 22, 0.28);
        }

        .profile-card-text {
            color: rgba(255, 255, 255, 0.68);
        }

        .profile-identity-card .form-control[readonly],
        .profile-identity-card textarea[readonly] {
            color: rgba(255, 255, 255, 0.82);
            border-color: rgba(171, 131, 255, 0.18);
            background: rgba(255, 255, 255, 0.04);
            cursor: default;
        }
    </style>
@endpush
