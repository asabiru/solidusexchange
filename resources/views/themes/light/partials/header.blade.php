<!-- SolidChange Style Header -->
<style>
    .solidchange-navbar {
        position: sticky;
        top: 0;
        z-index: 40;
        border-bottom: 1px solid var(--color-border-subtle);
        background: rgba(11, 6, 8, 0.85);
        backdrop-filter: blur(16px);
    }



    body:not(.dark-theme) .solidchange-navbar {
        background: rgba(250, 248, 245, 0.92);
    }

    .solidchange-navbar .nav-link {
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 13px;
        color: var(--color-text-secondary) !important;
        transition: all 0.2s;
    }

    .solidchange-navbar .nav-link:hover {
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
    }

    .solidchange-navbar .logo-badge {
        display: flex;
        height: 28px;
        width: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 1px solid var(--color-border-strong);
        font-size: 10px;
        font-weight: bold;
    }

    .solidchange-navbar .utility-btn {
        display: flex;
        height: 36px;
        width: 36px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        color: var(--color-text-secondary) !important;
        transition: all 0.2s;
        background: transparent;
        border: none;
        cursor: pointer;
    }

    .solidchange-navbar .utility-btn:hover {
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
    }

    .solidchange-navbar .btn-primary {
        background: var(--color-accent);
        color: #0b0608 !important;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 700;
        transition: all 0.2s;
    }

    .solidchange-navbar .btn-primary:hover {
        background: var(--color-accent-hover);
    }

    /* Mobile offcanvas fixes */
    #mobileMenu {
        background: #150c10 !important;
        border-left: 1px solid rgba(255,255,255,0.08) !important;
        border-radius: 0 !important;
        color: #f5ede4 !important;
    }

    #mobileMenu .offcanvas-header {
        border-bottom: 1px solid rgba(255,255,255,0.08);
        padding: 16px;
    }

    #mobileMenu .offcanvas-body {
        overflow-y: auto;
        background: #150c10 !important;
    }

    #mobileMenu .nav-link {
        color: #f5ede4 !important;
        font-size: 16px;
        padding: 12px 8px;
        border-radius: 8px;
        display: block;
    }

    #mobileMenu .nav-link:hover,
    #mobileMenu .nav-link:active {
        background: rgba(232,201,160,0.12) !important;
        color: #e8c9a0 !important;
    }

    #mobileMenu .btn-primary {
        background: #e8c9a0 !important;
        color: #0b0608 !important;
        padding: 12px 16px;
        display: block;
        text-align: center;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 700;
    }
</style>

<header class="solidchange-navbar">
    <div class="container" style="max-width: 1280px;">
        <div class="d-flex align-items-center justify-content-between" style="height: 64px; padding: 0 20px;">
            <!-- Logo -->
            <a href="{{ url('/') }}" class="d-flex align-items-center gap-2 text-decoration-none" style="font-size: 15px; font-weight: 600; color: var(--color-text-primary);">
                <div class="logo-badge">SC</div>
                <span>SolidChange</span>
            </a>

            <!-- Desktop Navigation -->
            <nav class="d-none d-lg-flex gap-1">
                <a href="{{ url('/#exchange') }}" class="nav-link text-decoration-none">Обмен</a>
                <a href="{{ url('/#rates') }}" class="nav-link text-decoration-none">Курсы</a>
                <a href="{{ url('/#reserves') }}" class="nav-link text-decoration-none">Резервы</a>
                <a href="{{ url('/#how') }}" class="nav-link text-decoration-none">Как работает</a>
                <a href="{{ url('/#faq') }}" class="nav-link text-decoration-none">FAQ</a>
                <a href="{{ url('tracking') }}" class="nav-link text-decoration-none">Отследить</a>
            </nav>

            <!-- Right Actions -->
            <div class="d-none d-lg-flex align-items-center gap-2">
                <!-- Theme Toggle -->
                @if(basicControl()->changeable_mode == 1)
                <button id="toggle-btn" class="utility-btn" type="button">
                    <i class="fa-solid fa-moon" id="moon"></i>
                    <i class="fa-solid fa-sun" id="sun"></i>
                </button>
                @endif

                <!-- Language Selector -->
                @php
                    $activeLanguages = \Illuminate\Support\Facades\Cache::remember(
                        'active_languages', now()->addHours(2),
                        fn() => \App\Models\Language::where('status', 1)
                            ->orderByDesc('default_status')->orderBy('name')->get()
                        );
                    $currentLanguage = $activeLanguages->firstWhere('short_name', app()->getLocale()) ?: $activeLanguages->first();
                @endphp

                @if($activeLanguages->isNotEmpty())
                    <div class="dropdown">
                        <button class="utility-btn d-flex align-items-center gap-2 px-2" style="width: auto;" type="button" data-bs-toggle="dropdown">
                            <i class="fa-solid fa-globe"></i>
                            <span style="font-size: 12px;">{{ strtoupper($currentLanguage->short_name ?? 'RU') }}</span>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end" style="background: var(--color-bg-elevated); border: 1px solid var(--color-border-subtle);">
                            @foreach($activeLanguages as $language)
                                <li>
                                    <a class="dropdown-item d-flex align-items-center gap-2 text-decoration-none"
        
                                       href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}">
                                        <img src="{{ getFile($language->flag_driver, $language->flag) }}"
                                             alt="{{ $language->name }}"
                                             style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;">
                                        <span>{{ __($language->name) }}</span>
                                    </a>
                                </li>
                            @endforeach
                        </ul>
                    </div>
                @endif

                <!-- Login Button -->
                @guest
                    <a href="{{ route('login') }}" class="btn-primary text-decoration-none">Войти</a>
                @endguest

                @auth
                    <div class="dropdown">
                        <button class="utility-btn" type="button" data-bs-toggle="dropdown"
                                style="width: 36px; height: 36px; border-radius: 50%; padding: 0; background: linear-gradient(135deg, #c9a227, #e8c9a0); color: #0b0608; font-weight: 700; font-size: 14px; overflow: hidden;">
                            {{ strtoupper(substr(auth()->user()->firstname ?? auth()->user()->username ?? 'U', 0, 1)) }}
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end" style="background: var(--color-bg-elevated); border: 1px solid var(--color-border-subtle);">
                            <li>
                                <a class="dropdown-item text-decoration-none" style="color: var(--color-text-secondary);" href="{{route('user.dashboard')}}">
                                    <i class="fa-solid fa-university me-2"></i> @lang('Dashboard')
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item text-decoration-none" style="color: var(--color-text-secondary);" href="{{route('user.ticket.list')}}">
                                    <i class="fa-solid fa-headset me-2"></i> @lang('Support')
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item text-decoration-none" style="color: var(--color-text-secondary);" href="{{route('user.profile')}}">
                                    <i class="fa-solid fa-user-gear me-2"></i> @lang('Account Settings')
                                </a>
                            </li>
                            <li>
                                <hr class="dropdown-divider" style="border-color: var(--color-border-subtle);">
                            </li>
                            <li>
                                <a class="dropdown-item text-decoration-none" style="color: var(--color-text-secondary);" href="{{ route('logout') }}"
                                   onclick="event.preventDefault(); document.getElementById('logout-form').submit();">
                                    <i class="fa-solid fa-right-from-bracket me-2"></i> @lang('Sign Out')
                                </a>
                                <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
                                    @csrf
                                </form>
                            </li>
                        </ul>
                    </div>
                @endauth
            </div>

            <!-- Mobile Menu Button -->
            @if(basicControl()->changeable_mode == 1)
            <button id="toggle-btn-mobile" class="d-lg-none utility-btn" type="button">
                <i class="fa-solid fa-moon" id="moon-mobile"></i>
                <i class="fa-solid fa-sun" id="sun-mobile"></i>
            </button>
            @endif
            <button class="d-lg-none utility-btn" type="button" data-bs-toggle="offcanvas" data-bs-target="#mobileMenu">
                <i class="fa-solid fa-bars"></i>
            </button>
        </div>
    </div>

</header>

<!-- Mobile Menu (outside <header> to avoid fixed-in-sticky iOS Safari bug) -->
<div class="offcanvas offcanvas-end" tabindex="-1" id="mobileMenu">
        <div class="offcanvas-header">
            <a href="{{ url('/') }}" class="d-flex align-items-center gap-2 text-decoration-none" style="font-size: 15px; font-weight: 600; color: var(--color-text-primary);">
                <div class="logo-badge">SC</div>
                <span>SolidChange</span>
            </a>
            <button type="button" class="btn-close" data-bs-dismiss="offcanvas" style="filter: invert(1);"></button>
        </div>
        <div class="offcanvas-body d-flex flex-column gap-2 p-3">
            <a href="{{ url('/#exchange') }}" class="nav-link text-decoration-none">Обмен</a>
            <a href="{{ url('/#rates') }}" class="nav-link text-decoration-none">Курсы</a>
            <a href="{{ url('/#reserves') }}" class="nav-link text-decoration-none">Резервы</a>
            <a href="{{ url('/#how') }}" class="nav-link text-decoration-none">Как работает</a>
            <a href="{{ url('/#faq') }}" class="nav-link text-decoration-none">FAQ</a>
            <a href="{{ url('tracking') }}" class="nav-link text-decoration-none">Отследить</a>

            @if($activeLanguages->isNotEmpty())
                <div class="mt-4 pt-4" style="border-top: 1px solid rgba(255,255,255,0.08);">
                    <div class="fw-semibold mb-3" style="color: var(--color-text-primary);">@lang('Language Settings')</div>
                    <div class="d-flex flex-column gap-2">
                        @foreach($activeLanguages as $language)
                            <a class="nav-link d-flex align-items-center justify-content-between text-decoration-none"

                               href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}"
                               data-bs-dismiss="offcanvas">
                                <span class="d-flex align-items-center gap-2">
                                    <img src="{{ getFile($language->flag_driver, $language->flag) }}"
                                         alt="{{ $language->name }}"
                                         style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover;">
                                    <span>{{ __($language->name) }}</span>
                                </span>
                                @if(app()->getLocale() === $language->short_name)
                                    <i class="fa-solid fa-check" style="color: var(--color-accent);"></i>
                                @endif
                            </a>
                        @endforeach
                    </div>
                </div>
            @endif

            @guest
                <a href="{{ route('login') }}" class="btn-primary text-decoration-none mt-2 w-100 text-center">Войти</a>
            @endguest
        </div>
    </div>

<script>
(function () {
    function initMobileMenu() {
        var menu = document.getElementById('mobileMenu');
        if (!menu) return;

        menu.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function (e) {
                var href = link.getAttribute('href');
                if (!href || href === '#' || href.startsWith('javascript')) return;

                e.preventDefault();

                var bsOffcanvas = (typeof bootstrap !== 'undefined' && bootstrap.Offcanvas)
                    ? bootstrap.Offcanvas.getInstance(menu)
                    : null;

                if (bsOffcanvas) {
                    menu.addEventListener('hidden.bs.offcanvas', function handler() {
                        menu.removeEventListener('hidden.bs.offcanvas', handler);
                        window.location.href = href;
                    });
                    bsOffcanvas.hide();
                } else {
                    window.location.href = href;
                }
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileMenu);
    } else {
        initMobileMenu();
    }
})();
</script>
