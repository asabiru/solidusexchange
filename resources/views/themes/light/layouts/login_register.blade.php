<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@lang(basicControl()->site_title) | @if(isset($pageSeo['page_title']))
            @lang($pageSeo['page_title'])
        @else
            @yield('title')
        @endif
    </title>
    @include('seo')
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <!-- Favicon-link -->
    <link rel="shortcut icon" href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}"
          type="image/x-icon">
    @include($theme.'partials.style')

    @include($theme.'partials.loader-js')
</head>

<body  class="">
@include($theme.'partials.loader')
@yield('content')

@include($theme.'partials.script')

@stack('extra_scripts')
@include($theme.'partials.flash-message')

@include('plugins')


</body>

</html>
