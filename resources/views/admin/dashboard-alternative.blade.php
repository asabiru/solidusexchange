@extends('admin.layouts.app')
@section('page_title', __('Dashboard'))
@section('content')
    @push('script')
        <script>
            window.SolidusDashboardTheme = (function () {
                const root = document.documentElement;
                const theme = root.getAttribute('data-solidus-admin-theme') || 'default';
                const styles = getComputedStyle(root);
                const pick = function (name, fallback) {
                    const value = styles.getPropertyValue(name).trim();
                    return value !== '' ? value : fallback;
                };

                return {
                    theme: theme,
                    isDark: theme === 'dark',
                    colors: {
                        surface: pick('--admin-card-bg', 'rgba(255, 255, 255, 0.88)'),
                        surfaceElevated: pick('--admin-bg-elevated', '#ffffff'),
                        surfaceTertiary: pick('--admin-bg-tertiary', '#f4eee7'),
                        textPrimary: pick('--admin-text-primary', '#14110f'),
                        textSecondary: pick('--admin-text-secondary', '#6b625b'),
                        textMuted: pick('--admin-text-muted', '#9a8e86'),
                        accent: pick('--admin-accent', '#c9a227'),
                        accentSoft: pick('--admin-accent-soft', 'rgba(201, 162, 39, 0.12)'),
                        borderSubtle: pick('--admin-border-subtle', 'rgba(20, 17, 15, 0.08)'),
                        borderStrong: pick('--admin-border-strong', 'rgba(20, 17, 15, 0.14)'),
                        chartLine: pick('--admin-accent', '#c9a227'),
                        chartMuted: theme === 'dark' ? '#6f655f' : '#c4b7ac',
                        chartGrid: theme === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(20, 17, 15, 0.08)',
                        shadow: theme === 'dark' ? '0 24px 70px rgba(0, 0, 0, 0.42)' : '0 24px 70px rgba(27, 18, 13, 0.12)'
                    }
                };
            })();

            window.loaderColor = window.SolidusDashboardTheme.isDark
                ? 'rgba(19, 10, 14, 0.96)'
                : 'rgba(255, 255, 255, 0.96)';
        </script>
    @endpush

    <div class="content container-fluid solidus-admin-dashboard dashboard-height-auto">
        <div class="admin-dashboard-shell">
            <div class="admin-dashboard-hero">
                <div class="admin-dashboard-hero-copy">
                    <div class="admin-dashboard-hero-topline">
                        <span class="admin-dashboard-kicker">@lang('Admin overview')</span>
                        <div class="admin-theme-switcher" aria-hidden="true">
                            <span class="admin-theme-chip admin-theme-chip-dark">@lang('Dark theme')</span>
                            <span class="admin-theme-chip admin-theme-chip-light">@lang('Light theme')</span>
                        </div>
                    </div>

                    <h1>@lang('Exchange control room')</h1>
                    <p>@lang('A clean, theme-aware dashboard for day-to-day exchange operations. Monitor users, support, KYC and volume without losing the visual rhythm of the main site.')</p>

                    <div class="admin-dashboard-actions">
                        <a class="btn btn-primary btn-with-icon" href="{{ route('admin.users') }}">
                            <i class="bi bi-people"></i>
                            <span>@lang('Users')</span>
                        </a>
                        <a class="btn btn-secondary btn-with-icon" href="{{ route('admin.transaction') }}">
                            <i class="bi bi-arrow-left-right"></i>
                            <span>@lang('Transactions')</span>
                        </a>
                        <a class="btn btn-secondary btn-with-icon" href="{{ route('admin.telegram.control') }}">
                            <i class="bi bi-telegram"></i>
                            <span>@lang('Telegram')</span>
                        </a>
                    </div>

                    <div class="admin-dashboard-hero-meta">
                        <span><i class="bi bi-stars"></i> @lang('Theme-aware layout')</span>
                        <span><i class="bi bi-calendar3"></i> {{ now()->format('d M Y, H:i') }}</span>
                    </div>
                </div>

                <div class="admin-dashboard-hero-aside">
                    <div class="admin-hero-metric admin-hero-metric-accent">
                        <span>@lang('Monthly volume')</span>
                        <strong>{{ currencyPosition(fractionNumber($dashboardStats['depositThisMonth'])) }}</strong>
                        <small>@lang('Deposits received this month')</small>
                    </div>
                    <div class="admin-hero-metric">
                        <span>@lang('Open queues')</span>
                        <strong>{{ $dashboardStats['pendingTickets'] + $dashboardStats['pendingKyc'] }}</strong>
                        <small>@lang('Tickets and KYC awaiting review')</small>
                    </div>
                    <div class="admin-hero-metric">
                        <span>@lang('Today registrations')</span>
                        <strong>{{ $dashboardStats['usersToday'] }}</strong>
                        <small>@lang('Fresh users joined today')</small>
                    </div>
                </div>
            </div>

            <div class="admin-kpi-grid">
                <a class="admin-kpi-card" href="{{ route('admin.users') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-people"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Total users')</span>
                        <strong>{{ $dashboardStats['totalUsers'] }}</strong>
                        <small>@lang('All registered accounts in the platform')</small>
                    </div>
                </a>

                <a class="admin-kpi-card" href="{{ route('admin.transaction') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-receipt"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Transactions this month')</span>
                        <strong>{{ $dashboardStats['transactionsMonth'] }}</strong>
                        <small>@lang('All transaction records created this month')</small>
                    </div>
                </a>

                <a class="admin-kpi-card" href="{{ route('admin.ticket', 'tickets') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-chat-square-dots"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Pending tickets')</span>
                        <strong>{{ $dashboardStats['pendingTickets'] }}</strong>
                        <small>@lang('Support requests waiting for action')</small>
                    </div>
                </a>

                <a class="admin-kpi-card" href="{{ route('admin.kyc.list') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-shield-check"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Pending KYC')</span>
                        <strong>{{ $dashboardStats['pendingKyc'] }}</strong>
                        <small>@lang('Verification cases to process')</small>
                    </div>
                </a>

                <a class="admin-kpi-card" href="{{ route('admin.buy.index') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-bag-plus"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Buy orders')</span>
                        <strong>{{ $dashboardStats['buyThisMonth'] }}</strong>
                        <small>@lang('Orders opened this month')</small>
                    </div>
                </a>

                <a class="admin-kpi-card" href="{{ route('admin.sell.index') }}">
                    <div class="admin-kpi-icon"><i class="bi bi-bag-dash"></i></div>
                    <div class="admin-kpi-copy">
                        <span>@lang('Sell orders')</span>
                        <strong>{{ $dashboardStats['sellThisMonth'] }}</strong>
                        <small>@lang('Sell requests opened this month')</small>
                    </div>
                </a>
            </div>

            <div class="admin-dashboard-grid admin-dashboard-grid-two">
                <section class="admin-panel admin-panel-wide">
                    <div class="admin-panel-header">
                        <div>
                            <span class="admin-panel-kicker">@lang('Live feed')</span>
                            <h2>@lang('Recent transactions')</h2>
                        </div>
                    </div>
                    @include('admin.partials.dashboard.recentTran')
                </section>

                <section class="admin-panel">
                    <div class="admin-panel-header">
                        <div>
                            <span class="admin-panel-kicker">@lang('Snapshot')</span>
                            <h2>@lang('Key records')</h2>
                        </div>
                    </div>
                    @include('admin.partials.dashboard.record')
                </section>
            </div>

            <div class="admin-dashboard-grid admin-dashboard-grid-three">
                <section class="admin-panel admin-panel-wide">
                    <div class="admin-panel-header">
                        <div>
                            <span class="admin-panel-kicker">@lang('Graphs')</span>
                            <h2>@lang('Exchange movement')</h2>
                        </div>
                    </div>
                    @include('admin.partials.dashboard.exchange-performance')
                </section>

                <section class="admin-panel">
                    <div class="admin-panel-header">
                        <div>
                            <span class="admin-panel-kicker">@lang('Figures')</span>
                            <h2>@lang('Buy and sell overview')</h2>
                        </div>
                    </div>
                    @include('admin.partials.dashboard.exchange-figure')
                </section>
            </div>

            <section class="admin-panel admin-latest-users-panel">
                <div class="admin-panel-header admin-panel-header-space">
                    <div>
                        <span class="admin-panel-kicker">@lang('People')</span>
                        <h2>@lang('Latest users')</h2>
                    </div>
                    <a class="btn btn-secondary btn-sm" href="{{ route('admin.users') }}">@lang('View all')</a>
                </div>
                <div class="table-responsive">
                    <table class="table admin-modern-table align-middle mb-0">
                        <thead>
                        <tr>
                            <th>@lang('User')</th>
                            <th>@lang('Contact')</th>
                            <th>@lang('Country')</th>
                            <th>@lang('Status')</th>
                            <th>@lang('Last login')</th>
                            <th>@lang('Action')</th>
                        </tr>
                        </thead>
                        <tbody>
                        @forelse($latestUser as $user)
                            <tr>
                                <td>
                                    <a class="admin-user-cell" href="{{ route('admin.user.view.profile', $user->id) }}">
                                        <div class="admin-user-avatar">{!! $user->profilePicture() !!}</div>
                                        <div>
                                            <strong>{{ $user->firstname . ' ' . $user->lastname }}</strong>
                                            <span>{{ '@' . $user->username }}</span>
                                        </div>
                                    </a>
                                </td>
                                <td>
                                    <strong class="d-block">{{ $user->email }}</strong>
                                    <span class="text-body">{{ $user->phone ?: '—' }}</span>
                                </td>
                                <td>{{ $user->country ?? 'N/A' }}</td>
                                <td>\n+                                    @if($user->status == 1)\n+                                        <span class=\"badge bg-soft-success text-success\">\n+                                            <span class=\"legend-indicator bg-success\"></span>@lang('Active')\n+                                        </span>\n+                                    @else\n+                                        <span class=\"badge bg-soft-danger text-danger\">\n+                                            <span class=\"legend-indicator bg-danger\"></span>@lang('Inactive')\n+                                        </span>\n+                                    @endif\n+                                </td>\n+                                <td>{{ diffForHumans($user->last_login) }}</td>\n+                                <td>\n+                                    <div class=\"btn-group\" role=\"group\">\n+                                        <a class=\"btn btn-white btn-sm\" href=\"{{ route('admin.user.edit', $user->id) }}\">\n+                                            <i class=\"bi-pencil-fill me-1\"></i> @lang('Edit')\n+                                        </a>\n+                                        <button type=\"button\" class=\"btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty\" data-bs-toggle=\"dropdown\" aria-expanded=\"false\"></button>\n+                                        <div class=\"dropdown-menu dropdown-menu-end mt-1\">\n+                                            <a class=\"dropdown-item\" href=\"{{ route('admin.user.view.profile', $user->id) }}\">\n+                                                <i class=\"bi-eye-fill dropdown-item-icon\"></i> @lang('View profile')\n+                                            </a>\n+                                            <a class=\"dropdown-item\" href=\"{{ route('admin.send.email', $user->id) }}\">\n+                                                <i class=\"bi-envelope dropdown-item-icon\"></i> @lang('Send mail')\n+                                            </a>\n+                                            <a class=\"dropdown-item loginAccount\" href=\"javascript:void(0)\" data-route=\"{{ route('admin.login.as.user', $user->id) }}\" data-bs-toggle=\"modal\" data-bs-target=\"#loginAsUserModal\">\n+                                                <i class=\"bi bi-box-arrow-in-right dropdown-item-icon\"></i> @lang('Login as user')\n+                                            </a>\n+                                        </div>\n+                                    </div>\n+                                </td>\n+                            </tr>\n+                        @empty\n+                            <tr>\n+                                <td colspan=\"6\" class=\"text-center py-5 text-body\">@lang('No users yet.')</td>\n+                            </tr>\n+                        @endforelse\n+                        </tbody>\n+                    </table>\n+                </div>\n+            </section>\n+        </div>\n+\n+        <div id=\"firebase-app\">\n+            <div class=\"p-3 mb-5 alert alert-soft-dark admin-notification-banner\" role=\"alert\" v-if=\"notificationPermission == 'default' && !is_notification_skipped\" v-cloak>\n+                <div class=\"alert-box d-flex flex-wrap align-items-center\">\n+                    <div class=\"flex-shrink-0\">\n+                        <img class=\"avatar avatar-xl\" src=\"{{ asset('assets/admin/img/oc-megaphone.svg') }}\" alt=\"Image Description\" data-hs-theme-appearance=\"default\">\n+                        <img class=\"avatar avatar-xl\" src=\"{{ asset('assets/admin/img/oc-megaphone-light.svg') }}\" alt=\"Image Description\" data-hs-theme-appearance=\"dark\">\n+                    </div>\n+                    <div class=\"flex-grow-1 ms-3\">\n+                        <h3 class=\"mb-1\">@lang('Attention!')</h3>\n+                        <div class=\"d-flex align-items-center gap-2 flex-wrap\">\n+                            <p class=\"mb-0 text-body\">@lang('Please allow your browser to get instant push notification. Allow it from notification setting.')</p>\n+                            <button id=\"allow-notification\" class=\"btn btn-sm btn-primary\"><i class=\"fa fa-check-circle\"></i> @lang('Allow me')</button>\n+                        </div>\n+                    </div>\n+                    <button type=\"button\" class=\"btn-close\" @click.prevent=\"skipNotification\" data-bs-dismiss=\"alert\" aria-label=\"Close\"></button>\n+                </div>\n+            </div>\n+            <div class=\"alert alert-soft-dark admin-notification-banner\" role=\"alert\" v-if=\"notificationPermission == 'denied' && !is_notification_skipped\" v-cloak>\n+                <div class=\"d-flex align-items-center mt-4\">\n+                    <div class=\"flex-shrink-0\">\n+                        <img class=\"avatar avatar-xl\" src=\"{{ asset('assets/admin/img/oc-megaphone.svg') }}\" alt=\"Image Description\" data-hs-theme-appearance=\"default\">\n+                        <img class=\"avatar avatar-xl\" src=\"{{ asset('assets/admin/img/oc-megaphone-light.svg') }}\" alt=\"Image Description\" data-hs-theme-appearance=\"dark\">\n+                    </div>\n+                    <div class=\"flex-grow-1 ms-3\">\n+                        <h3 class=\"mb-1\">@lang('Attention!')</h3>\n+                        <p class=\"mb-0 text-body\">@lang('Please allow your browser to get instant push notification. Allow it from notification setting.')</p>\n+                    </div>\n+                    <button type=\"button\" class=\"btn-close\" @click.prevent=\"skipNotification\" data-bs-dismiss=\"alert\" aria-label=\"Close\"></button>\n+                </div>\n+            </div>\n+        </div>\n+    </div>\n+@endsection\n+\n+@if($firebaseNotify)\n+    @push('script')\n+        <script type=\"module\">\n+            import {initializeApp} from \"https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js\";\n+            import {getMessaging, getToken, onMessage} from \"https://www.gstatic.com/firebasejs/9.17.1/firebase-messaging.js\";\n+\n+            const firebaseConfig = {\n+                apiKey: \"{{$firebaseNotify['apiKey']}}\",\n+                authDomain: \"{{$firebaseNotify['authDomain']}}\",\n+                projectId: \"{{$firebaseNotify['projectId']}}\",\n+                storageBucket: \"{{$firebaseNotify['storageBucket']}}\",\n+                messagingSenderId: \"{{$firebaseNotify['messagingSenderId']}}\",\n+                appId: \"{{$firebaseNotify['appId']}}\",\n+                measurementId: \"{{$firebaseNotify['measurementId']}}\"\n+            };\n+\n+            const app = initializeApp(firebaseConfig);\n+            const messaging = getMessaging(app);\n+            if ('serviceWorker' in navigator) {\n+                navigator.serviceWorker.register('{{ getProjectDirectory() }}' + `/firebase-messaging-sw.js`, {scope: './'}).then(function (registration) {\n+                        requestPermissionAndGenerateToken(registration);\n+                    }\n+                ).catch(function (error) {\n+                });\n+            }\n+\n+            onMessage(messaging, (payload) => {\n+                if (payload.data.foreground || parseInt(payload.data.foreground) == 1) {\n+                    const title = payload.notification.title;\n+                    const options = {\n+                        body: payload.notification.body,\n+                        icon: payload.notification.icon,\n+                    };\n+                    new Notification(title, options);\n+                }\n+            });\n+\n+            function requestPermissionAndGenerateToken(registration) {\n+                document.addEventListener(\"click\", function (event) {\n+                    if (event.target.id == 'allow-notification') {\n+                        Notification.requestPermission().then((permission) => {\n+                            if (permission === 'granted') {\n+                                getToken(messaging, {\n+                                    serviceWorkerRegistration: registration,\n+                                    vapidKey: \"{{$firebaseNotify['vapidKey']}}\"\n+                                })\n+                                    .then((token) => {\n+                                        $.ajax({\n+                                            url: \"{{ route('admin.save.token') }}\",\n+                                            method: \"post\",\n+                                            data: {\n+                                                token: token,\n+                                            },\n+                                            success: function (res) {\n+                                            }\n+                                        });\n+                                        window.newApp.notificationPermission = 'granted';\n+                                    });\n+                            } else {\n+                                window.newApp.notificationPermission = 'denied';\n+                            }\n+                        });\n+                    }\n+                });\n+            }\n+        </script>\n+        <script>\n+            window.newApp = new Vue({\n+                el: \"#firebase-app\",\n+                data: {\n+                    admin_foreground: '',\n+                    admin_background: '',\n+                    notificationPermission: Notification.permission,\n+                    is_notification_skipped: sessionStorage.getItem('is_notification_skipped') == '1'\n+                },\n+                mounted() {\n+                    sessionStorage.clear();\n+                    this.admin_foreground = \"{{$firebaseNotify['admin_foreground']}}\";\n+                    this.admin_background = \"{{$firebaseNotify['admin_background']}}\";\n+                },\n+                methods: {\n+                    skipNotification() {\n+                        sessionStorage.setItem('is_notification_skipped', '1');\n+                        this.is_notification_skipped = true;\n+                    }\n+                }\n+            });\n+        </script>\n+    @endpush\n+@endif\n*** End Patch
