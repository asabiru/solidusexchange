<!-- ========== HEADER ========== -->
<header id="header"
        class="navbar navbar-expand-lg navbar-fixed navbar-height navbar-container navbar-bordered bg-white">
    <div class="navbar-nav-wrap">
        <a class="navbar-brand" href="{{ route('admin.dashboard') }}" aria-label="{{ $basicControl->site_title }}">
            <img class="navbar-brand-logo"
                 src="{{ getFile($basicControl->dark_logo_driver, $basicControl->dark_logo, true) }}"
                 alt="{{ $basicControl->site_title }} Logo"
                 data-hs-theme-appearance="default">
            <img class="navbar-brand-logo"
                 src="{{ getFile($basicControl->dark_logo_driver, $basicControl->dark_logo, true) }}"
                 alt="{{ $basicControl->site_title }} Logo"
                 data-hs-theme-appearance="dark">
            <img class="navbar-brand-logo-mini"
                 src="{{ getFile($basicControl->dark_logo_driver, $basicControl->dark_logo, true) }}"
                 alt="{{ $basicControl->site_title }} Logo"
                 data-hs-theme-appearance="default">
            <img class="navbar-brand-logo-mini"
                 src="{{ getFile($basicControl->dark_logo_driver, $basicControl->dark_logo, true) }}"
                 alt="Logo"
                 data-hs-theme-appearance="dark">
        </a>

        <div class="navbar-nav-wrap-content-start">
            <button type="button" class="js-navbar-vertical-aside-toggle-invoker navbar-aside-toggler">
                <i class="bi-arrow-bar-left navbar-toggler-short-align"
                   data-bs-template='<div class="tooltip d-none d-md-block" role="tooltip"><div class="arrow"></div><div class="tooltip-inner"></div></div>'
                   data-bs-toggle="tooltip" data-bs-placement="right" title="@lang('Collapse')"></i>
                <i class="bi-arrow-bar-right navbar-toggler-full-align"
                   data-bs-template='<div class="tooltip d-none d-md-block" role="tooltip"><div class="arrow"></div><div class="tooltip-inner"></div></div>'
                   data-bs-toggle="tooltip" data-bs-placement="right" title="@lang('Expand')"></i>
            </button>


            <div class="dropdown ms-2">
                <div class="d-none d-lg-block">
                    <div
                        class="input-group input-group-merge input-group-borderless input-group-hover-light navbar-input-group admin-header-search">
                        <span class="input-group-text">
                            <i class="bi-search"></i>
                        </span>

                        <input type="search" class="js-form-search form-control global-search"
                               placeholder="@lang("Search for a menu")"
                               aria-label="@lang("Search for a menu")" data-hs-form-search-options='{
                               "clearIcon": "#clearSearchResultsIcon",
                               "dropMenuElement": "#searchDropdownMenu",
                               "dropMenuOffset": 20,
                               "toggleIconOnFocus": true,
                               "activeClass": "focus"
                             }'>
                        <button type="button" class="input-group-text navbar-search-clear display-none" aria-label="@lang('Clear search')">
                            <i id="clearSearchResultsIcon" class="bi-x-lg d-none"></i>
                        </button>
                    </div>
                </div>

                <button
                    class="js-form-search js-form-search-mobile-toggle btn btn-ghost-secondary btn-icon rounded-circle d-lg-none"
                    type="button" data-hs-form-search-options='{
                       "clearIcon": "#clearSearchResultsIcon",
                       "dropMenuElement": "#searchDropdownMenu",
                       "dropMenuOffset": 20,
                       "toggleIconOnFocus": true,
                       "activeClass": "focus"
                     }'>
                    <i class="bi-search"></i>
                </button>
                <!-- End Input Group -->

                <!-- Card Search Content -->
                <div id="searchDropdownMenu"
                     class="hs-form-search-menu-content dropdown-menu dropdown-menu-form-search navbar-dropdown-menu-borderless">
                    <div class="card">
                        <!-- Body -->
                        <div class="card-body-height search-result">
                            <div class="d-lg-none">
                                <div class="input-group input-group-merge navbar-input-group admin-header-search-mobile mb-5">
                                    <span class="input-group-text">
                                        <i class="bi-search"></i>
                                    </span>

                                    <input type="search" class="form-control global-search"
                                           placeholder="@lang("Search for a menu")"
                                           aria-label="@lang("Search for a menu")">
                                    <button type="button" class="input-group-text navbar-search-clear-mobile display-none" aria-label="@lang('Clear search')">
                                        <i class="bi-x-lg"></i>
                                    </button>
                                </div>
                            </div>

                            <span class="dropdown-header">@lang("Result")</span>

                            <div class="dropdown-divider"></div>

                            <div class="content">

                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>


        <!-- Notification -->
        <div class="navbar-nav-wrap-content-end" id="pushNotificationArea">
            @php
                $activeLanguages = \App\Models\Language::query()
                    ->where('status', 1)
                    ->orderByDesc('default_status')
                    ->orderBy('name')
                    ->get();
                $currentLanguage = $activeLanguages->firstWhere('short_name', app()->getLocale()) ?: $activeLanguages->first();
            @endphp
            <ul class="navbar-nav">
                <li class="nav-item">
                    <div class="dropdown">
                        <button type="button"
                                class="btn btn-ghost-secondary btn-icon rounded-circle"
                                id="languageDropdown"
                                data-bs-toggle="dropdown"
                                aria-expanded="false"
                                title="@lang('Language Settings')">
                            <i class="fa-thin fa-globe"></i>
                        </button>
                        <div class="dropdown-menu dropdown-menu-end navbar-dropdown-menu navbar-dropdown-menu-borderless mt-2"
                             aria-labelledby="languageDropdown">
                            <div class="dropdown-item-text border-bottom pb-2 mb-1">
                                <span class="d-block fw-semibold">@lang('Language Settings')</span>
                                @if($currentLanguage)
                                    <small class="text-body">@lang('Current'): {{ __($currentLanguage->name) }}</small>
                                @endif
                            </div>
                            @forelse($activeLanguages as $language)
                                <a href="{{ route('language', ['locale' => $language->short_name, 'redirect' => request()->getRequestUri()]) }}"
                                   class="dropdown-item d-flex align-items-center justify-content-between">
                                    <span class="d-flex align-items-center">
                                        <img class="avatar avatar-xss avatar-circle me-2"
                                             src="{{ getFile($language->flag_driver, $language->flag) }}"
                                             alt="{{ $language->name }}">
                                        <span>{{ __($language->name) }}</span>
                                    </span>
                                    @if(app()->getLocale() === $language->short_name)
                                        <i class="bi-check2 text-primary"></i>
                                    @endif
                                </a>
                            @empty
                                <span class="dropdown-item-text text-body">@lang('No data to show')</span>
                            @endforelse
                        </div>
                    </div>
                </li>

                @if(basicControl()->in_app_notification)
                    <li class="nav-item d- d-sm-inline-block">
                        <div class="dropdown">
                            <button type="button" class="btn btn-ghost-secondary btn-icon rounded-circle"
                                    id="navbarNotificationsDropdown" data-bs-toggle="dropdown" aria-expanded="false"
                                    data-bs-auto-close="outside">
                                <i class="bi-bell"></i>
                                <span class="btn-status btn-sm-status btn-status-danger" v-if="items.length > 0"
                                      v-cloak></span>
                            </button>
                            <div
                                class="dropdown-menu dropdown-menu-end dropdown-card navbar-dropdown-menu navbar-dropdown-menu-borderless navbarNotificationsDropdown data-bs-dropdown-animation"
                                aria-labelledby="navbarNotificationsDropdown">
                                <div class="card ">
                                    <div class="card-header card-header-content-between">
                                        <h4 class="card-title mb-0">@lang('Notifications')</h4>
                                    </div>
                                    <div class="card-body-height">
                                        <div id="notificationTabContent">
                                            <ul class="list-group list-group-flush navbar-card-list-group">
                                                <li class="list-group-item form-check-select"
                                                    v-for="(item, index) in items">
                                                    <div class="row">
                                                        <div class="col-auto">
                                                            <div class="avatar avatar-sm avatar-soft-dark avatar-circle">
                                                                <span class="avatar-initials">A</span>
                                                            </div>
                                                        </div>
                                                        <div class="col ms-n2">
                                                            <p class="text-body fs-5">@{{ item.description.text }}</p>
                                                            <small class="col-auto text-muted text-cap" v-cloak>@{{
                                                                item.formatted_date }}</small>
                                                        </div>
                                                    </div>
                                                    <a class="stretched-link" :href="item.description.link"></a>
                                                </li>
                                            </ul>
                                            <div class="text-center p-4" v-if="items.length < 1">
                                                <img class="dataTables-image mb-3"
                                                     src="{{ asset('assets/admin/img/oc-error.svg') }}"
                                                     alt="@lang('Image Description')" data-hs-theme-appearance="default">
                                                <img class="dataTables-image mb-3"
                                                     src="{{ asset('assets/admin/img/oc-error-light.svg') }}"
                                                     alt="@lang('Image Description')" data-hs-theme-appearance="dark">
                                                <p class="mb-0">@lang("No Notifications Found")</p>
                                            </div>
                                        </div>

                                    </div>
                                    <a class="card-footer text-center" href="javascript:void(0)" v-if="items.length > 0"
                                       @click.prevent="readAll">
                                        @lang("Clear all notifications") <i class="bi-chevron-right"></i>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </li>
                @endif


                <li class="nav-item">
                    <div class="dropdown">
                        <a class="navbar-dropdown-account-wrapper" href="javascript:void(0)" id="accountNavbarDropdown"
                           data-bs-toggle="dropdown" aria-expanded="false" data-bs-auto-close="outside"
                           data-bs-dropdown-animation>
                            <div class="avatar avatar-sm avatar-circle">
                                <img class="avatar-img"
                                     src="{{getFile(Auth::guard('admin')->user()->image_driver, Auth::guard('admin')->user()->image)}}"
                                     alt="@lang('Image Description')">
                                <span class="avatar-status avatar-sm-status avatar-status-success"></span>
                            </div>
                        </a>

                        <div
                            class="dropdown-menu dropdown-menu-end navbar-dropdown-menu navbar-dropdown-menu-borderless navbar-dropdown-account admin_dropdown_account"
                            aria-labelledby="accountNavbarDropdown">
                            <div class="dropdown-item-text">
                                <div class="d-flex align-items-center">
                                    <div class="avatar avatar-sm avatar-circle">
                                        <img class="avatar-img"
                                             src="{{getFile(Auth::guard('admin')->user()->image_driver, Auth::guard('admin')->user()->image)}}"
                                             alt="@lang('Image Description')">
                                    </div>
                                    <div class="flex-grow-1 ms-3">
                                        <h5 class="mb-0">{{auth()->user()->name}}</h5>
                                        <p class="card-text text-body">{{auth()->user()->email}}</p>
                                    </div>
                                </div>
                            </div>

                            <div class="dropdown-divider"></div>

                            <a class="dropdown-item"
                               href="{{ route("admin.profile") }}">@lang("Profile &amp; account")</a>

                            <a class="dropdown-item"
                               href="{{ route("admin.twoFa.control") }}">@lang("2FA Settings")</a>


                            <div class="dropdown-divider"></div>

                            <a class="dropdown-item" href="{{ route('admin.logout') }}"
                               onclick="event.preventDefault();document.getElementById('logout-form').submit();">
                                @lang("Sign out")
                            </a>
                            <form id="logout-form" action="{{ route('admin.logout') }}" method="POST" class="d-none">
                                @csrf
                            </form>
                        </div>
                    </div>
                </li>
            </ul>
        </div>
    </div>
</header>
<!-- ========== END HEADER ========== -->


@push('script')
    <script>
        'use strict'

        function toggleAdminHeaderSearchClear(wrapperSelector, inputSelector, buttonSelector) {
            const wrapper = document.querySelector(wrapperSelector);
            if (!wrapper) return;

            const input = wrapper.querySelector(inputSelector);
            const button = wrapper.querySelector(buttonSelector);

            if (!input || !button) return;

            button.classList.toggle('display-none', input.value.trim().length === 0);
        }

        document.addEventListener('input', function (event) {
            if (event.target.closest('.admin-header-search')) {
                toggleAdminHeaderSearchClear('.admin-header-search', '.global-search', '.navbar-search-clear');
            }

            if (event.target.closest('.admin-header-search-mobile')) {
                toggleAdminHeaderSearchClear('.admin-header-search-mobile', '.global-search', '.navbar-search-clear-mobile');
            }
        });

        document.addEventListener('click', function (event) {
            const desktopClear = event.target.closest('.navbar-search-clear');
            const mobileClear = event.target.closest('.navbar-search-clear-mobile');

            if (desktopClear) {
                const wrapper = document.querySelector('.admin-header-search');
                const input = wrapper ? wrapper.querySelector('.global-search') : null;
                if (input) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    input.focus();
                }
            }

            if (mobileClear) {
                const wrapper = document.querySelector('.admin-header-search-mobile');
                const input = wrapper ? wrapper.querySelector('.global-search') : null;
                if (input) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    input.focus();
                }
            }
        });

        let pushNotificationArea = new Vue({
            el: "#pushNotificationArea",
            data: {
                items: [],
            },
            mounted() {
                this.getNotifications();
                this.pushNewItem();
            },
            methods: {
                getNotifications() {
                    let app = this;
                    axios.get("{{ route('admin.push.notification.show') }}")
                        .then(function (res) {
                            app.items = res.data;
                        })
                },
                readAt(id, link) {
                    let app = this;
                    let url = "{{ route('admin.push.notification.readAt', 0) }}";
                    url = url.replace(/.$/, id);
                    axios.get(url)
                        .then(function (res) {
                            if (res.status) {
                                app.getNotifications();
                                if (link !== '#') {
                                    window.location.href = link
                                }
                            }
                        })
                },
                readAll() {
                    let app = this;
                    let url = "{{ route('admin.push.notification.readAll') }}";
                    axios.get(url)
                        .then(function (res) {
                            if (res.status) {
                                app.items = [];
                            }
                        })
                },
                pushNewItem() {
                    let app = this;
                    Pusher.logToConsole = false;
                    let pusher = new Pusher("{{ env('PUSHER_APP_KEY') }}", {
                        encrypted: true,
                        cluster: "{{ env('PUSHER_APP_CLUSTER') }}"
                    });
                    let channel = pusher.subscribe('admin-notification.' + "{{ Auth::id() }}");
                    channel.bind('App\\Events\\AdminNotification', function (data) {
                        app.items.unshift(data.message);
                    });
                    channel.bind('App\\Events\\UpdateAdminNotification', function (data) {
                        app.getNotifications();
                    });
                }
            }
        });
    </script>
@endpush
