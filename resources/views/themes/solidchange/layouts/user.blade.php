<!DOCTYPE html>



<html lang="en" @if(session()->get('rtl') == 1) dir="rtl" @endif />



<head data-base_url="{{url('/')}}" data-theme="dark" data-changeable_mode="0"



      data-light_logo="{{ getFile(basicControl()->logo_driver,basicControl()->logo) }}"



      data-dark_logo="{{ getFile(basicControl()->dark_logo_driver,basicControl()->dark_logo) }}">



    <meta charset="UTF-8"/>



    <meta http-equiv="X-UA-Compatible" content="IE=edge"/>



    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">



    <meta name="csrf-token" content="{{ csrf_token() }}">



    <link href="{{ getFile($basicControl->favicon_driver, $basicControl->favicon) }}" rel="icon">



    <title>@yield('page_title') | {{basicControl()->site_title}}</title>

@include($theme.'partials.user.styles')







    @include($theme.'partials.loader-js')



</head>



<body class="dark-theme">



@include($theme.'partials.loader')



@include($theme.'partials.user.topbar')



@include($theme.'partials.user.mobileNav')



@include($theme.'partials.user.sidebar')







<main id="main" class="main">



    <div class="pagetitle">



        <h3>@yield('page_title')</h3>



    </div>



    @section('content')



    @show



</main>



@include($theme.'partials.user.footer')











@include($theme.'partials.user.scripts')



@include($theme.'partials.user.flash-message')







@include('plugins')



</body>



</html>
