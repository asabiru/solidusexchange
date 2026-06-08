@if(isset($template['login-register']) && $loginRegister = $template['login-register'][0])
    <style>
        .login-signup-page .login-signup-thums {
            background-image: url({{getFile(@$loginRegister->content->media->verify_page_image->driver,@$loginRegister->content->media->verify_page_image->path)}});
        }
    </style>
@endif
