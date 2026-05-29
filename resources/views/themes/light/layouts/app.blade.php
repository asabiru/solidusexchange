<!DOCTYPE html>
<html lang="en">

<head data-base_url="{{url('/')}}" data-theme="{{basicControl()->default_mode??'dark'}}" data-changeable_mode="{{basicControl()->changeable_mode??0}}"
      data-light_logo="{{ getFile(basicControl()->logo_driver,basicControl()->logo) }}"
      data-dark_logo="{{ getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo) }}">
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>@lang(basicControl()->site_title) | @if(isset($pageSeo['page_title']))
            @lang($pageSeo['page_title'])
        @else
            @yield('title')
        @endif
    </title>

    @include('seo')

    <meta name="csrf-token" content="{{ csrf_token() }}">
    <!-- Favicon-link -->
    <link rel="icon" type="image/x-icon"  href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}">
    <link rel="icon" type="image/svg+xml" href="{{ asset('assets/upload/logo/favicon.svg') }}">
    <link rel="apple-touch-icon" sizes="64x64" href="{{ asset('assets/upload/logo/favicon-64.png') }}">
        <!-- Fonts Non-Blocking Loading -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@200;300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
    <noscript>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@200;300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    </noscript>
    @include($theme.'partials.style')


    @include($theme.'partials.loader-js')


</head>

<body class="">

@include($theme.'partials.loader')

@include($theme.'partials.header')
@include($theme.'partials.breadcrumb')
@yield('content')

@unless(request()->routeIs('home'))
    @include($theme.'partials.footer')
@endunless


@include($theme.'partials.script')
@stack('extra_scripts')
@yield('scripts')
@include($theme.'partials.flash-message')


@include('plugins')
@if(request()->routeIs('home') || (request()->routeIs('page') && blank(request()->route('slug'))))
    @include($theme.'partials.exchange-module.exchange-js')
@endif

</body>

</html>