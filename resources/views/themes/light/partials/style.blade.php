@php
    $routeName = \Illuminate\Support\Facades\Route::currentRouteName();
    $isLightweightAuthPage = in_array($routeName, [
        'login',
        'register',
        'password.confirm',
        'password.email',
        'password.request',
        'password.reset',
    ], true);

    $themeAssetVersion = (string) (config('app.asset_version') ?? env('APP_VERSION', ''));
    if ($themeAssetVersion === '') {
        $themeStylePath = public_path($themeTrue . 'css/style.css');
        $themeMobilePolishPath = public_path($themeTrue . 'css/mobile-polish.css');
        $styleMtime = file_exists($themeStylePath) ? filemtime($themeStylePath) : 0;
        $mobileMtime = file_exists($themeMobilePolishPath) ? filemtime($themeMobilePolishPath) : 0;
        $themeAssetVersion = (string) max($styleMtime, $mobileMtime, 1);
    }
@endphp

<link rel="stylesheet" href="{{ asset($themeTrue.'css/all.min.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/bootstrap.min.css') }}?v={{ $themeAssetVersion }}">
@unless($isLightweightAuthPage)
<link rel="stylesheet" href="{{ asset($themeTrue.'css/owl.carousel.min.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/owl.theme.default.min.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/slick.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/slick-theme.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/select2.min.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/nouislider.min.css') }}?v={{ $themeAssetVersion }}">
@endunless
@stack('css-lib')
<link rel="stylesheet" href="{{ asset($themeTrue.'css/style.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset('assets/global/css/solidus-theme.css') }}?v={{ $themeAssetVersion }}">
@unless($isLightweightAuthPage)
<link rel="stylesheet" href="{{ asset($themeTrue.'css/hero-section.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/rates-section.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/popular-cryptos.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/security-aml.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/how-it-works.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/advantages.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/reserves.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/reviews.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/faq-section.css') }}?v={{ $themeAssetVersion }}">
<link rel="stylesheet" href="{{ asset($themeTrue.'css/footer.css') }}?v={{ $themeAssetVersion }}">
@endunless
<link rel="stylesheet" href="{{ asset($themeTrue.'css/mobile-polish.css') }}?v={{ $themeAssetVersion }}">
@stack('style')
