@extends(template().'layouts.error')
@section('title', 'Контент готовится')
@section('content')
    @php $lang = __(config('languages.langCode')[app()->currentLocale()] ?? 'Unknown Language'); @endphp
    <section class="error-section">
        <div class="container">
            <div class="row justify-content-center">
                <div class="col-12">
                    <div class="error-content">
                        <div class="sc-info-icon" aria-hidden="true">
                            <svg width="78" height="78" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="9"/>
                                <path d="M3.2 9.5h17.6M3.2 14.5h17.6"/>
                                <path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z"/>
                            </svg>
                        </div>

                        <div class="error-info font-30">
                            @lang('Coming Soon Content in') <span class="text-gradient">«{{ $lang }}»</span>
                        </div>

                        <p class="sc-info-text">
                            @lang('If there is no content available in') <span class="text-gradient">«{{ $lang }}»</span>, @lang('our administrators are working diligently to set up relevant content for our') @lang('audience. We appreciate your patience as we strive to provide valuable information in your preferred language.')
                        </p>

                        <div class="btn-area">
                            @if(auth()->guard('admin')->check())
                                <a href="{{ route('admin.page.index', basicControl()->theme??'light') }}" class="cmn-btn">@lang('Go To Settings')</a>
                            @else
                                <a href="{{ url('/') }}" class="cmn-btn">@lang('Back To Home')</a>
                            @endif
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
@endsection
