<link rel="shortcut icon" href="{{ getFile($basicControl->favicon_driver, $basicControl->favicon) }}"
      type="image/x-icon">
<link rel="stylesheet" href="{{ asset($themeTrue . 'css/all.min.css') }}">
<link rel="stylesheet" href="{{ asset($themeTrue . 'css/fontawesome.min.css') }}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/bootstrap.min.css") }}">
@stack('style_lib')

<link rel="stylesheet" href="{{ asset($themeTrue . "css/owl.carousel.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/owl.theme.default.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/swiper-bundle.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "css/select2.min.css")}}">
<link rel="stylesheet" href="{{ asset($themeTrue . "/css/dashboard.css")}}">
<link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}">


@stack('extra_styles')
