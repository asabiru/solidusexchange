<!-- Header top section start -->

<style>
    .offer-banner-seciton .offer-overlay {
        background: linear-gradient({{hex2rgba(basicControl()->primary_color, 0.8)}}, {{hex2rgba(basicControl()->primary_color, 0.8)}});
    }
</style>

@if(announcement()->status && session()->get('isCLoseAnnouncement') == null)

    <div class="offer-banner-seciton d-none d-lg-block">
        <button type="button" onclick="closeAnnouncement()" class="offer-close-btn">
            <i class="fa-regular fa-xmark"></i>
        </button>
        <div class="container h-100">
            <div class="row h-100">
                <div class="col-12 gap-3 justify-content-center align-items-center d-flex">
                    {!! announcement()->announcement_text !!}
                    @if(announcement()->btn_display)
                        <a href="{{announcement()->btn_link}}" class="offer-btn">{{announcement()->btn_name}}</a>
                    @endif
                </div>
            </div>
        </div>
        <div class="offer-overlay"></div>
    </div>
@endif

{{--Mobile Version--}}
@if(announcement()->status && session()->get('isCLoseAnnouncement') == null)
    <div class="mobile-offer-banner d-lg-none">
        <button type="button" onclick="closeAnnouncement()" class="offer-close-btn">
            <i class="fa-regular fa-xmark"></i>
        </button>
        <div class="gap-3 justify-content-center align-items-center d-flex flex-column">
            {!! announcement()->announcement_text !!}
            @if(announcement()->btn_display)
                <a href="{{announcement()->btn_link}}" class="offer-btn">{{announcement()->btn_name}}</a>
            @endif
        </div>
        <div class="mobile-offer-banner-inner">
        </div>
    </div>
@endif
<!-- Header top section end -->

<!-- Nav section start -->
<nav class="navbar public-navbar sticky-top navbar-expand-lg transparent">
    @php
        $activeLanguages = \App\Models\Language::query()
            ->where('status', 1)
            ->orderByDesc('default_status')
            ->orderBy('name')
            ->get();
        $currentLanguage = $activeLanguages->firstWhere('short_name', app()->getLocale()) ?: $activeLanguages->first();
    @endphp
    <div class="container public-navbar__inner">
        <a class="navbar-brand solidus-wordmark" href="{{url('/')}}" aria-label="Solidus">
            <span class="solidus-wordmark__mark"></span>
            <span class="solidus-wordmark__text">SOLIDUS</span>
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="offcanvas" data-bs-target="#offcanvasNavbar"
                aria-controls="offcanvasNavbar">
            <i class="fa-light fa-list"></i>
        </button>
        <div class="offcanvas offcanvas-end" tabindex="-1" id="offcanvasNavbar"
             aria-labelledby="offcanvasNavbar" data-bs-scroll="true" data-bs-backdrop="true">
            <div class="offcanvas-header">
                <a class="navbar-brand solidus-wordmark" href="{{url('/')}}" aria-label="Solidus">
                    <span class="solidus-wordmark__mark"></span>
                    <span class="solidus-wordmark__text">SOLIDUS</span>
                </a>
                <button type="button" class="cmn-btn-close btn-close" data-bs-dismiss="offcanvas"
                        aria-label="Close"><i class="fa-light fa-arrow-right"></i></button>
            </div>
            <div class="offcanvas-body align-items-center justify-content-between">
                <ul class="navbar-nav ms-auto public-navbar__menu">
                    {!! renderHeaderMenu(getHeaderMenuData()) !!}
                </ul>

                @if($activeLanguages->isNotEmpty())
                    <div class="d-lg-none mt-4 pt-4 border-top">
                        <div class="fw-semibold mb-3">@lang('Язык')</div>
                        <div class="d-flex flex-column gap-2">
                            @foreach($activeLanguages as $language)
                                <a class="nav-link d-flex align-items-center justify-content-between px-0"
                                   href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}">
                                    <span class="d-flex align-items-center">
                                        <img src="{{ getFile($language->flag_driver, $language->flag) }}"
                                             alt="{{ $language->name }}"
                                             class="me-2 rounded-circle"
                                             style="width:20px;height:20px;object-fit:cover;">
                                        <span>{{ __($language->name) }}</span>
                                    </span>
                                    @if(app()->getLocale() === $language->short_name)
                                        <i class="bi-check2 text-primary"></i>
                                    @endif
                                </a>
                            @endforeach
                        </div>
                    </div>
                @endif
            </div>
        </div>
        <div class="nav-right public-navbar__actions">
            <ul class="custom-nav header-action-list">
                @guest
                    <li class="nav-item header-action-item">
                        <a class="nav-link login-btn header-login-btn" href="{{ route('login') }}"><i
                                class="login-icon fa-light fa-right-to-bracket"></i><span
                                class="d-none d-md-block">@lang('Войти')</span></a>
                    </li>
                @endguest
                @auth
                    <li class="nav-item header-action-item">
                        <div class="profile-box header-profile-box">
                            <div class="profile header-profile-trigger">
                                <span class="header-avatar-badge">
                                    {{ \Illuminate\Support\Str::upper(\Illuminate\Support\Str::substr(auth()->user()->firstname ?? auth()->user()->username ?? 'U', 0, 1)) }}
                                </span>
                            </div>
                            <ul class="user-dropdown">
                                <li>
                                    <a href="{{route('user.dashboard')}}"> <i
                                            class="fal fa-university"></i> @lang('Dashboard') </a>
                                </li>
                                <li>
                                    <a href="{{route('user.ticket.list')}}"> <i
                                            class="fal fa-user-headset"></i> @lang('Support')
                                    </a>
                                </li>
                                <li>
                                    <a href="{{route('user.profile')}}"> <i
                                            class="fal fa-user-cog"></i> @lang('Account Settings')
                                    </a>
                                </li>
                                <li>
                                    <a class="dropdown-item d-flex align-items-center" href="{{ route('logout') }}"
                                       onclick="event.preventDefault(); document.getElementById('logout-form').submit();">
                                        <i class="fal fa-sign-out-alt"></i>
                                        <span>@lang('Sign Out')</span>
                                        <form id="logout-form" action="{{ route('logout') }}" method="POST"
                                              class="d-none">
                                            @csrf
                                        </form>
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </li>
                @endauth

                @if(basicControl()->changeable_mode == 1 )
                    <li class="header-action-item">
                        <a id="toggle-btn" class="nav-link d-flex align-items-center justify-content-center toggle-btn nav-utility-btn"
                           title="@lang('Toggle theme')">
                            <i class="fa-regular fa-moon" id="moon"></i>
                            <i class="fa-regular fa-sun-bright" id="sun"></i>
                        </a>
                    </li>
                @endif

                <li class="dropdown header-action-item">
                    <button type="button"
                            class="nav-link nav-utility-btn language-trigger"
                            id="publicLanguageDropdown"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                            title="@lang('Language Settings')">
                        @if($currentLanguage)
                            <span class="language-trigger__flag">
                                <img src="{{ getFile($currentLanguage->flag_driver, $currentLanguage->flag) }}"
                                     alt="{{ $currentLanguage->name }}">
                            </span>
                            <span class="language-trigger__label d-none d-xl-inline">
                                {{ \Illuminate\Support\Str::upper($currentLanguage->short_name) }}
                            </span>
                        @else
                            <i class="fa-thin fa-globe"></i>
                        @endif
                    </button>

                    <div class="dropdown-menu dropdown-menu-end mt-2 language-dropdown-menu">
                        <div class="dropdown-item-text border-bottom pb-2 mb-1">
                            <span class="d-block fw-semibold">@lang('Язык')</span>
                            @if($currentLanguage)
                                <small class="text-body">@lang('Текущий'): {{ __($currentLanguage->name) }}</small>
                            @endif
                        </div>

                        @forelse($activeLanguages as $language)
                            <a class="dropdown-item d-flex align-items-center justify-content-between"
                               href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}">
                                <span class="d-flex align-items-center">
                                    <img src="{{ getFile($language->flag_driver, $language->flag) }}"
                                         alt="{{ $language->name }}"
                                         class="me-2 rounded-circle"
                                         style="width:20px;height:20px;object-fit:cover;">
                                    <span>{{ __($language->name) }}</span>
                                </span>
                                @if(app()->getLocale() === $language->short_name)
                                    <i class="bi-check2 text-primary"></i>
                                @endif
                            </a>
                        @empty
                            <span class="dropdown-item-text">@lang('Нет данных')</span>
                        @endforelse
                    </div>
                </li>

            </ul>
        </div>
    </div>
</nav>
<script>
    'use strict'

    let isAnnouncementClosing = false;

    function hideAnnouncementBanners() {
        $('.offer-banner-seciton, .mobile-offer-banner').stop(true, true).fadeOut(160, function () {
            $(this).remove();
        });
    }

    function closeAnnouncement() {
        if (isAnnouncementClosing) return;
        isAnnouncementClosing = true;

        // Hide immediately without page reload.
        hideAnnouncementBanners();

        $.ajax({
            type: 'GET',
            url: "{{route('closeAnnouncement')}}",
            success: function () {
            },
            error: function () {
                // Keep UI closed for current page even if request fails.
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        const mobileMenu = document.getElementById('offcanvasNavbar');
        if (!mobileMenu) return;

        const fixBodyOffset = function () {
            document.body.style.paddingRight = '0px';
            document.body.style.marginRight = '0px';
            document.documentElement.style.paddingRight = '0px';
            document.documentElement.style.marginRight = '0px';
        };

        const clearBodyOffset = function () {
            document.body.style.paddingRight = '';
            document.body.style.marginRight = '';
            document.documentElement.style.paddingRight = '';
            document.documentElement.style.marginRight = '';
            document.body.style.overflow = '';
        };

        mobileMenu.addEventListener('show.bs.offcanvas', function () {
            fixBodyOffset();
            requestAnimationFrame(fixBodyOffset);
        });

        mobileMenu.addEventListener('shown.bs.offcanvas', function () {
            fixBodyOffset();
        });

        mobileMenu.addEventListener('hidden.bs.offcanvas', function () {
            clearBodyOffset();
        });
    });
</script>
<!-- Nav section end -->
