<header id="header" class="header fixed-top d-flex align-items-center">
    <div class="d-flex align-items-center justify-content-between">
        <div class="logo-container">
            <a href="{{url('/')}}" class="logo d-flex align-items-center">
                <img src="{{ getFile($basicControl->logo_driver, $basicControl->logo) }}"
                     alt="@lang(basicControl()->site_title)" id="logoSet">
            </a>
        </div>
        <button onclick="toggleSideMenu()" class="toggle-sidebar toggle-sidebar-btn d-none d-lg-block"><i
                class="fa-light fa-list"></i></button>
    </div><!-- End Logo -->

    <div class="search-bar">
        <form class="search-form d-flex align-items-center">
            <input type="search" class="form-control global-search" name="query" placeholder="@lang('Search')"
                   title="@lang('Enter search keyword')">
            <button class="search-btn" type="button" title="Search"><i
                    class="fa-regular fa-magnifying-glass"></i></button>
            <div class="search-backdrop d-none"></div>
            <div class="search-result d-none">
                <div class="search-header">
                    @lang('Result')
                </div>
                <div class="content"></div>
            </div>
        </form>
    </div><!-- End Search Bar -->


    <nav class="header-nav ms-auto">
        @php
            $activeLanguages = \Illuminate\Support\Facades\Cache::remember(
                'active_languages', now()->addHours(2),
                fn() => \App\Models\Language::where('status', 1)
                    ->orderByDesc('default_status')->orderBy('name')->get()
            );
            $currentLanguage = $activeLanguages->firstWhere('short_name', app()->getLocale()) ?: $activeLanguages->first();
        @endphp
        <ul class="d-flex align-items-center">


            <li class="nav-item d-none d-lg-block d-xl-none">
                <a class="nav-link nav-icon search-bar-toggle" href="#">
                    <i class="fa-regular fa-magnifying-glass"></i>
                </a>
            </li>

            <li class="nav-item pe-3">
                <div class="dropdown">
                    <button type="button"
                            class="btn btn-ghost-secondary btn-icon rounded-circle"
                            id="userLanguageDropdown"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                            title="@lang('Language Settings')">
                        <i class="fa-thin fa-globe"></i>
                    </button>

                    <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow profile mt-2"
                         aria-labelledby="userLanguageDropdown">
                        <div class="dropdown-header text-start">
                            <h6>@lang('Language Settings')</h6>
                            @if($currentLanguage)
                                <span>@lang('Current'): {{ __($currentLanguage->name) }}</span>
                            @endif
                        </div>
                        <hr class="dropdown-divider">

                        @forelse($activeLanguages as $language)
                            <a class="dropdown-item d-flex align-items-center justify-content-between"
                               href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}">
                                <span class="d-flex align-items-center">
                                    <img src="{{ getFile($language->flag_driver, $language->flag) }}"
                                         alt="{{ $language->name }}"
                                         class="me-2 rounded-circle"
                                         style="width:20px;height:20px;min-width:20px;object-fit:cover;">
                                    <span>{{ __($language->name) }}</span>
                                </span>
                                @if(app()->getLocale() === $language->short_name)
                                    <i class="bi-check2 text-primary"></i>
                                @endif
                            </a>
                        @empty
                            <span class="dropdown-item-text">@lang('No data to show')</span>
                        @endforelse
                    </div>
                </div>
            </li>

            @include($theme.'partials.pushNotify')

            <li class="nav-item dropdown">
                <a class="nav-link nav-profile d-flex align-items-center pe-0" href="#" data-bs-toggle="dropdown">
                    <span class="d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-semibold"
                          style="width:36px;height:36px;background:linear-gradient(120deg,var(--solidus-accent),var(--solidus-accent-2));">
                        {{ \Illuminate\Support\Str::upper(\Illuminate\Support\Str::substr(auth()->user()->firstname ?? auth()->user()->username ?? 'U', 0, 1)) }}
                    </span>
                    <span class="d-none d-lg-block dropdown-toggle ps-2">{{auth()->user()->fullname}}</span>
                </a><!-- End Profile Iamge Icon -->

                <ul class="dropdown-menu dropdown-menu-end dropdown-menu-arrow profile">
                    <li class="dropdown-header d-flex align-items-center text-start">
                        <div class="profile-thum">
                            <span class="d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-semibold"
                                  style="width:48px;height:48px;background:linear-gradient(120deg,var(--solidus-accent),var(--solidus-accent-2));">
                                {{ \Illuminate\Support\Str::upper(\Illuminate\Support\Str::substr(auth()->user()->firstname ?? auth()->user()->username ?? 'U', 0, 1)) }}
                            </span>
                        </div>
                        <div class="profile-content">
                            <h6>{{auth()->user()->fullname}}</h6>
                            <span>{{auth()->user()->email}}</span>
                        </div>
                    </li>
                    <li>
                        <hr class="dropdown-divider">
                    </li>

                    <li>
                        <a class="dropdown-item d-flex align-items-center" href="{{route('user.profile')}}">
                            <i class="fa-light fa-user"></i>
                            <span>@lang('Account Settings')</span>
                        </a>
                    </li>
                    <li>
                        <hr class="dropdown-divider">
                    </li>

                    <li>
                        <a class="dropdown-item d-flex align-items-center" href="{{route('user.twostep.security')}}">
                            <i class="fa-sharp fa-light fa-gear"></i>
                            <span>@lang('2 FA Security')</span>
                        </a>
                    </li>
                    <li>
                        <hr class="dropdown-divider">
                    </li>

                    <li>
                        <a class="dropdown-item d-flex align-items-center" href="{{route('user.verification.center')}}">
                            <i class="fa-light fa-circle-question"></i>
                            <span>@lang('Verification Center')</span>
                        </a>
                    </li>
                    <li>
                        <hr class="dropdown-divider">
                    </li>

                    <li>
                        <a class="dropdown-item d-flex align-items-center" href="{{ route('logout') }}"
                           onclick="event.preventDefault(); document.getElementById('logout-form').submit();">
                            <i class="fa-regular fa-right-from-bracket"></i>
                            <span>@lang('Sign Out')</span>
                            <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
                                @csrf
                            </form>
                        </a>
                    </li>

                </ul><!-- End Profile Dropdown Items -->
            </li><!-- End Profile Nav -->

        </ul>
    </nav><!-- End Icons Navigation -->

</header>
