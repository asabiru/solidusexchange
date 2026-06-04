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

    $themeScriptVersion = (string) (config('app.asset_version') ?? env('APP_VERSION', ''));
    if ($themeScriptVersion === '') {
        $themeScriptPath = public_path($themeTrue . 'js/main.js');
        $themeScriptVersion = file_exists($themeScriptPath) ? (string) filemtime($themeScriptPath) : '1';
    }
@endphp

<script src="{{ asset($themeTrue . 'js/jquery-3.6.1.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset('assets/global/js/notiflix-aio-3.2.6.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/bootstrap.bundle.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset('assets/global/js/axios.min.js') }}?v={{ $themeScriptVersion }}"></script>

@stack('js-lib')
@unless($isLightweightAuthPage)
<script src="{{ asset($themeTrue . 'js/owl.carousel.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/swiper-bundle.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/slick.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/select2.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/nouislider.min.js') }}?v={{ $themeScriptVersion }}"></script>
<script src="{{ asset($themeTrue . 'js/parallax-scroll.js') }}?v={{ $themeScriptVersion }}"></script>
@endunless

<script src="{{ asset($themeTrue . 'js/main.js') }}?v={{ $themeScriptVersion }}"></script>
@stack('script')

@if (
    !in_array($routeName, [
        'login',
        'register',
        'password.confirm',
        'password.email',
        'password.request',
        'password.reset',
    ]))
    @if ($errors->any())
        @php
            $collection = collect($errors->all());
            $errors = $collection->unique();
        @endphp
        <script>
            "use strict";
            @foreach ($errors as $error)
                Notiflix.Notify.failure("{{ trans($error) }}");
            @endforeach
        </script>
    @endif
@endif
