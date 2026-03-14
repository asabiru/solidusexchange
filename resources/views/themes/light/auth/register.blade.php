@extends($theme.'layouts.login_register')
@section('title',trans('Register'))
@push('css-lib')
    <link rel="stylesheet" href="{{ asset($themeTrue . 'css/intlTelInput.min.css')}}"/>
@endpush
@section('content')
    @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
        <style>
            .login-signup-page .login-signup-thums {
                background-image: url({{getFile(@$loginRegister->content->media->register_page_image->driver,@$loginRegister->content->media->register_page_image->path)}});
            }
        </style>
    @endif
    <section class="login-signup-page pt-0 pb-0 min-vh-100 h-100">
        <div class="container-fluid h-100">
            <div class="row min-vh-100">
                <div class="col-md-6 p-0 d-none d-md-block">
                    <div class="login-signup-thums h-100">
                        <div class="content-area">
                            <div class="logo-area mb-30">
                                <a href="{{url('/')}}">
                                    <img class="logo"
                                         src="{{getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo)}}" alt="...">
                                </a>
                            </div>
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="middle-content">
                                    <h3 class="section-title">{{@$loginRegister->description->register_heading}}</h3>
                                    <p>{{@$loginRegister->description->register_sub_heading}}</p>
                                </div>
                            @endif
                            @if(isset($template['social']) && count($template['social']) > 0)
                                <div class="bottom-content">
                                    <div class="social-area mt-50">
                                        <ul class="d-flex">
                                            @foreach($template['social'] as $social)
                                                <li><a href="{{@$social->content->media->my_link}}"><i
                                                            class="{{@$social->content->media->icon}}"></i></a></li>
                                            @endforeach
                                        </ul>
                                    </div>
                                </div>
                            @endif
                        </div>
                    </div>
                </div>
                <div class="col-md-6 p-0 d-flex align-items-center">
                    <div class="login-signup-form">
                        <form action="{{ route('register') }}" method="post" class="php-email-form">
                            @csrf
                            @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
                                <div class="section-header">
                                    <h3>{{@$loginRegister->description->register_heading}}</h3>
                                    <div
                                        class="description">{{@$loginRegister->description->register_sub_heading}}</div>
                                </div>
                            @endif
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="text" name="first_name" value="{{old('first_name')}}"
                                           class="form-control" id="exampleInputEmail0"
                                           placeholder="@lang('First Name')">
                                    @error('first_name')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="text" name="last_name" value="{{old('last_name')}}"
                                           class="form-control" id="exampleInputEmail2"
                                           placeholder="@lang('Last Name')">
                                    @error('last_name')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="email" name="email" value="{{old('email')}}" class="form-control"
                                           id="exampleInputEmail4"
                                           placeholder="@lang('Email')">
                                    @error('email')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="text" name="username" value="{{old('username')}}" class="form-control"
                                           id="exampleInputEmail3"
                                           placeholder="@lang('Username')">
                                    @error('username')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="hidden" id="country" name="phone_code" value="+1">
                                    <input id="telephone" class="form-control" name="phone" type="tel">
                                    <div class="text-danger">@error('phone') @lang($message) @enderror</div>
                                    <div class="text-danger">@error('phone_code') @lang($message) @enderror</div>
                                </div>
                                <div class="col-12">
                                    <div class="password-box">
                                        <input type="password" name="password" value="{{ old('password') }}"
                                               class="form-control password" id="exampleInputPassword1"
                                               placeholder="@lang('Password')">
                                        <i class="password-icon fa-regular fa-eye"></i>
                                    </div>
                                    @error('password')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="password" name="password_confirmation"
                                           value="{{ old('password_confirmation') }}" class="form-control password"
                                           id="exampleInputPassword2"
                                           placeholder="@lang('Confirm Password')">
                                </div>
                                @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_registration))

                                    <div class="form-group">
                                        {!! NoCaptcha::renderJs() !!}
                                        {!! NoCaptcha::display() !!}
                                        @error('g-recaptcha-response')
                                        <div class="text-danger">@lang($message)</div>
                                        @enderror
                                    </div>
                                @endif
                                @if(basicControl()->manual_recaptcha &&  basicControl()->reCaptcha_status_registration)
                                    <div class="input-box mb-4">
                                        <input type="text" tabindex="2"
                                               class="form-control @error('captcha') is-invalid @enderror"
                                               name="captcha" id="captcha" autocomplete="off"
                                               placeholder="@lang('Enter captcha code')">

                                        @error('captcha')
                                        <div class="text-danger">@lang($message)</div>
                                        @enderror
                                    </div>

                                    <div class="mb-4">
                                        <div
                                            class="input-group input-group-merge d-flex justify-content-between"
                                            data-hs-validation-validate-class>
                                            <img src="{{route('captcha').'?rand='. rand()}}"
                                                 id='captcha_image2'>
                                            <a class="input-group-append input-group-text"
                                               href='javascript: refreshCaptcha2();'>
                                                <i class="fal fa-sync"></i>
                                            </a>
                                        </div>
                                    </div>
                                @endif
                            </div>
                            <button type="submit" class="btn cmn-btn mt-30 w-100">@lang('signup')</button>
                        </form>
                        <div class="pt-20 text-center">
                            @lang("Already have an account?")
                            <p class="mb-0 highlight"><a
                                    href="{{ route('login') }}">@lang('Login here')</a></p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </section>

@endsection

@push('js-lib')
    <script src="{{ asset($themeTrue . 'js/intlTelInput.min.js')}}"></script>
    @if((basicControl()->google_recaptcha == 1) && (basicControl()->google_reCaptcha_status_login == 1))
        <script async src="https://www.google.com/recaptcha/api.js"></script>
    @endif
@endpush

@push('extra_scripts')
    <script>
        const input = document.querySelector("#telephone");
        window.intlTelInput(input, {
            initialCountry: "us",
            separateDialCode: true,
        });

        $('.iti__country-list li').on('click', function () {
            $("#country").val($(this).data('dial-code'));
        })

        const password = document.querySelector('.password');
        const passwordIcon = document.querySelector('.password-icon');

        passwordIcon.addEventListener("click", function () {
            if (password.type == 'password') {
                password.type = 'text';
                passwordIcon.classList.add('fa-eye-slash');
            } else {
                password.type = 'password';
                passwordIcon.classList.remove('fa-eye-slash');
            }
        })

        function refreshCaptcha() {
            let img = document.images['captcha_image'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }

        function refreshCaptcha2() {
            let img = document.images['captcha_image2'];
            img.src = img.src.substring(
                0, img.src.lastIndexOf("?")
            ) + "?rand=" + Math.random() * 1000;
        }

        $(document).on('click', '.btn-custom', function () {
            $('.text-danger').html('');
            refreshCaptcha();
        })

    </script>
@endpush
