@extends('admin.layouts.app')
@section('page_title',__('Add User'))
@section('content')
    <div class="content container-fluid">
        <form class="js-step-form py-md-5" data-hs-step-form-options='{
              "progressSelector": "#addUserStepFormProgress",
              "stepsSelector": "#addUserStepFormContent",
              "endSelector": "#addUserFinishBtn",
              "isValidate": false
            }' action="{{ route('admin.user.store') }}" method="post">
            @csrf
            <div class="row justify-content-lg-center">
                <div class="col-lg-8">
                    <ul id="addUserStepFormProgress"
                        class="js-step-progress step step-sm step-icon-sm step step-inline step-item-between mb-3 mb-md-5">
                        <li class="step-item">
                            <a class="step-content-wrapper " href="javascript:void(0)" data-hs-step-form-next-options='{
                                    "targetSelector": "#addUserStepProfile"
                                  }'>
                                <span class="step-icon step-icon-soft-dark">1</span>
                                <div class="step-content">
                                    <span class="step-title">@lang('Profile')</span>
                                </div>
                            </a>
                        </li>
                        <li class="step-item">
                            <a class="step-content-wrapper" href="javascript:void(0);" data-hs-step-form-next-options='{
                                    "targetSelector": "#addUserStepConfirmation"
                                  }'>
                                <span class="step-icon step-icon-soft-dark">2</span>
                                <div class="step-content">
                                    <span class="step-title">@lang('Confirmation')</span>
                                </div>
                            </a>
                        </li>
                    </ul>

                    <div id="addUserStepFormContent">
                        <div id="addUserStepProfile" class="card card-lg active">
                            <div class="card-body">
                                <!-- Form -->
                                <div class="row mb-4">
                                    <label for="firstNameLabel"
                                           class="col-sm-3 col-form-label form-label">@lang('First name')</label>
                                    <div class="col-sm-9">
                                        <input type="text" class="form-control input-field" name="firstName"
                                               id="firstNameLabel"
                                               placeholder="First name" aria-label="First name"
                                               data-target=".full_name"
                                               value="{{ old('firstName') }}" autocomplete="off">
                                        @error('firstName')
                                        <span class="invalid-feedback d-inline">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="firstNameLabel"
                                           class="col-sm-3 col-form-label form-label">@lang('Last Name')</label>
                                    <div class="col-sm-9">
                                        <div class="input-group input-group-sm-vertical">
                                            <input type="text" class="form-control input-field" name="lastName"
                                                   id="lastNameLabel"
                                                   placeholder="Last name" aria-label="Last name"
                                                   data-target=".full_name"
                                                   value="{{ old('lastName') }}" autocomplete="off">
                                        </div>
                                        @error('lastName')
                                        <span class="invalid-feedback d-inline">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>

                                <div class="row mb-4">
                                    <label for="userNameLabel"
                                           class="col-sm-3 col-form-label form-label">@lang('Username')</label>
                                    <div class="col-sm-9">
                                        <input type="text" class="form-control" name="username" id="userNameLabel"
                                               value="{{ old("username") }}"
                                               placeholder="@lang("Username")" aria-label="@lang("Username")"
                                               autocomplete="off">
                                        @error('username')
                                        <span class="invalid-feedback d-inline">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>
                                <div class="row mb-4">
                                    <label for="emailLabel"
                                           class="col-sm-3 col-form-label form-label">@lang('Email')</label>
                                    <div class="col-sm-9">
                                        <input type="text" class="form-control" name="email" id="emailLabel"
                                               placeholder="@lang("Email")"
                                               aria-label="@lang("Email")"
                                               autocomplete="off" value="{{ old("email") }}" required>
                                        @error('email')
                                        <span class="invalid-feedback">{{ $message }}</span>
                                        @enderror
                                    </div>
                                </div>
                                <label class="row form-check form-switch mb-4" for="userStatusSwitch">
                                    <span class="col-8 col-sm-3 ms-0">
                                      <span class="d-block text-dark">@lang('Status')</span>
                                    </span>
                                    <span class="col-4 col-sm-3">
                                         <input type="hidden" name="status" value="0">
                                      <input type="checkbox" class="form-check-input" name="status"
                                             id="userStatusSwitch" value="1" checked>
                                    </span>
                                </label>
                                @error('status')
                                <span class="invalid-feedback d-block">{{ $message }}</span>
                                @enderror
                            </div>

                            <div class="card-footer d-flex justify-content-end align-items-center">
                                <button type="button" class="btn btn-primary" data-hs-step-form-next-options='{
                                    "targetSelector": "#addUserStepConfirmation"
                                  }'>
                                    @lang('Next') <i class="bi-chevron-right"></i>
                                </button>
                            </div>
                        </div>

                        <div id="addUserStepConfirmation" class="card card-lg">
                            <div class="profile-cover">
                                <div class="profile-cover-img-wrapper">
                                    <img class="profile-cover-img" src="{{ getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo, true) }}"
                                         alt="Image Description">
                                </div>
                            </div>

                            <div class="card-body">
                                <dl class="row">
                                    <dt class="col-sm-6 text-sm-end mb-2">@lang('Full name:')</dt>
                                    <dd class="col-sm-6 full_name">-</dd>

                                    <dt class="col-sm-6 text-sm-end mb-2">@lang('Username:')</dt>
                                    <dd class="col-sm-6 username">-</dd>

                                    <dt class="col-sm-6 text-sm-end mb-2">@lang('Email:')</dt>
                                    <dd class="col-sm-6 email">-</dd>
                                </dl>
                            </div>

                            <div class="card-footer d-sm-flex align-items-sm-center">
                                <button type="button" class="btn btn-ghost-secondary mb-2 mb-sm-0"
                                        data-hs-step-form-prev-options='{
                                           "targetSelector": "#addUserStepProfile"
                                         }'>
                                    <i class="bi-chevron-left"></i> @lang('Previous step')
                                </button>
                                <div class="ms-auto">
                                    <button id="addUserFinishBtn" type="submit"
                                            class="btn btn-primary">@lang('Add user')
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    </div>

@endsection


@push('css-lib')
    <link rel="stylesheet" href="{{ asset('assets/admin/css/tom-select.bootstrap5.css') }}">
@endpush

@push('js-lib')
    <script src="{{ asset('assets/admin/js/hs-step-form.min.js') }}"></script>
    <script src="{{ asset('assets/admin/js/hs-add-field.min.js') }}"></script>
    <script src="{{ asset('assets/admin/js/tom-select.complete.min.js') }}"></script>
@endpush


@push('script')
    <script>
        function updateFullName() {
            let firstName = $('#firstNameLabel').val();
            let lastName = $('#lastNameLabel').val();
            let fullName = firstName + ' ' + lastName;
            $('.full_name').text(fullName);
        }

        $(document).on("input", "#firstNameLabel, #lastNameLabel", updateFullName);
        updateFullName();

        function updateEmailText() {
            let emailValue = $("#emailLabel").val();
            $('.email').text(emailValue);
        }

        $(document).on("input", "#emailLabel", updateEmailText);
        updateEmailText();

        function updateUsernameText() {
            let userNameValue = $("#userNameLabel").val();
            $('.username').text(userNameValue);
        }

        $(document).on("input", "#userNameLabel", updateUsernameText);
        updateUsernameText();

        $(document).ready(function () {
            new HSStepForm('.js-step-form', {
                finish: () => {
                    document.getElementById("addUserStepFormProgress").style.display = 'none'
                    document.getElementById("addUserStepProfile").style.display = 'none'
                    document.getElementById("addUserStepConfirmation").style.display = 'none'
                    scrollToTop('#header');
                    const formContainer = document.getElementById('formContainer')
                },
                onNextStep: function () {
                    scrollToTop()
                },
                onPrevStep: function () {
                    scrollToTop()
                }
            })

            function scrollToTop(el = '.js-step-form') {
                el = document.querySelector(el)
                window.scrollTo({
                    top: (el.getBoundingClientRect().top + window.scrollY) - 30,
                    left: 0,
                    behavior: 'smooth'
                })
            }

            new HSAddField('.js-add-field', {
                addedField: field => {
                    HSCore.components.HSTomSelect.init(field.querySelector('.js-select-dynamic'))
                    HSCore.components.HSMask.init(field.querySelector('.js-input-mask'))
                }
            })

            HSCore.components.HSTomSelect.init('.js-select', {
                render: {
                    'option': function (data, escape) {
                        return data.optionTemplate || `<div>${data.text}</div>>`
                    },
                    'item': function (data, escape) {
                        return data.optionTemplate || `<div>${data.text}</div>>`
                    }
                },
                maxOptions: 250
            })

        });

    </script>

@endpush



