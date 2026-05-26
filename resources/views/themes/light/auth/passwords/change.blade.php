@extends($theme.'layouts.login_register')
@section('title',__('Change Password'))
@section('content')
    @if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
        <style>
            .login-signup-page .login-signup-thums {
                background-image: url({{getFile(@$loginRegister->content->media->verify_page_image->driver,@$loginRegister->content->media->verify_page_image->path)}});
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
                                         src="{{getFile(basicControl()->logo_driver,basicControl()->logo)}}" alt="...">
                                </a>
                            </div>
                            <div class="middle-content">
                                <h3 class="section-title">@lang('Change Password')</h3>
                                <p>@lang('Experience the ease and security of our streamlined password change process – regain access to your account in just a few clicks!')</p>
                            </div>

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
                <div class="col-md-6 p-0 d-flex justify-content-center flex-column">
                    <div class="login-signup-form">
                        <form action="{{ route('user.change.password') }}" method="post">
                            @csrf
                            <div class="section-header">
                                <h3>@lang('Change Password')</h3>
                                <div
                                    class="description">@lang('Experience the ease and security of our streamlined password change process – regain access to your account in just a few clicks!')</div>
                            </div>
                            <div class="row g-4">
                                <div class="col-12">
                                    <input type="password" name="currentPassword" value="{{ old('currentPassword') }}"
                                           class="form-control"
                                           id="exampleInputEmail1"
                                           placeholder="@lang('Enter your current password')">
                                    @error('currentPassword')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="password" name="password" value="{{ old('password') }}"
                                           class="form-control"
                                           id="exampleInputEmail1"
                                           placeholder="@lang('Enter new password')">
                                    @error('password')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                                <div class="col-12">
                                    <input type="password" name="password_confirmation" value="{{ old('password_confirmation') }}"
                                           class="form-control"
                                           id="exampleInputEmail1"
                                           placeholder="@lang('Repeat password')">
                                    @error('password_confirmation')
                                    <span class="text-danger">{{$message}}</span>
                                    @enderror
                                </div>
                            </div>
                            <button type="submit" class="cmn-btn mt-30 w-100">@lang('Change Password')</button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection

