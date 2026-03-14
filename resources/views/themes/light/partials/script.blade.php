<script src="{{ asset($themeTrue . 'js/jquery-3.6.1.min.js') }}"></script>
<script src="{{ asset('assets/global/js/notiflix-aio-3.2.6.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/bootstrap.bundle.min.js') }}"></script>
<script src="{{ asset('assets/global/js/axios.min.js') }}"></script>

@stack('js-lib')
<script src="{{ asset($themeTrue . 'js/owl.carousel.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/swiper-bundle.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/slick.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/select2.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/nouislider.min.js') }}"></script>
<script src="{{ asset($themeTrue . 'js/parallax-scroll.js') }}"></script>

<script src="{{ asset($themeTrue . 'js/main.js') }}"></script>
@stack('script')

@php
    $routeName = \Illuminate\Support\Facades\Route::currentRouteName();
@endphp
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
