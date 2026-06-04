@extends($theme.'layouts.user')
@section('page_title',trans('Dashboard'))
@section('content')
    <div class="section dashboard">
        <div class="row" id="firebase-app">
            <div v-if="user_foreground == '1' || user_background == '1'" class="card-box">
                <div v-if="notificationPermission == 'default' && !is_notification_skipped" v-cloak>
                    <div class="media align-items-center d-flex justify-content-between alert alert-warning mb-4">
                        <div><i
                                class="fas fa-exclamation-triangle"></i> @lang('Do not miss any single important notification! Allow your
                        browser to get instant push notification')
                            <button class="cmn-btn ml-3" id="allow-notification">@lang('Allow me')</button>
                        </div>
                        <button class="close-btn pt-1" @click.prevent="skipNotification"><i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="card-box" v-if="notificationPermission == 'denied' && !is_notification_skipped" v-cloak>
                <div class="media align-items-center d-flex justify-content-between alert alert-warning mb-4">
                    <div><i
                            class="fas fa-exclamation-triangle"></i> @lang('Please allow your browser to get instant push notification.
                        Allow it from
                        notification setting.')
                    </div>
                    <button class="close-btn pt-1" @click.prevent="skipNotification"><i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div class="section dashboard">
        @include($theme.'partials.user.dashboard.mobile')
        @include($theme.'partials.user.dashboard.record')
        @include($theme.'partials.user.dashboard.figures')
        @include($theme.'partials.user.dashboard.movement')
    </div>

@endsection
@push('js_libs')
    <script src="{{ asset('assets/global/js/apexcharts.min.js') }}"></script>
    <script src="{{ asset('assets/admin/js/chart.min.js') }}"></script>
@endpush
@push('extra_scripts')
 <script>
     'use strict';
 </script>
@endpush
@if($firebaseNotify)
    @push('extra_scripts')
        <script type="module">
            import {initializeApp} from "https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js";
            import {
                getMessaging,
                getToken,
                onMessage
            } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-messaging.js";

            const firebaseConfig = {
                apiKey: "{{$firebaseNotify['apiKey']}}",
                authDomain: "{{$firebaseNotify['authDomain']}}",
                projectId: "{{$firebaseNotify['projectId']}}",
                storageBucket: "{{$firebaseNotify['storageBucket']}}",
                messagingSenderId: "{{$firebaseNotify['messagingSenderId']}}",
                appId: "{{$firebaseNotify['appId']}}",
                measurementId: "{{$firebaseNotify['measurementId']}}"
            };

            const app = initializeApp(firebaseConfig);
            const messaging = getMessaging(app);
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('{{ getProjectDirectory() }}' + `/firebase-messaging-sw.js`, {scope: './'}).then(function (registration) {
                        requestPermissionAndGenerateToken(registration);
                    }
                ).catch(function (error) {
                });
            } else {
            }

            onMessage(messaging, (payload) => {
                if (payload.data.foreground || parseInt(payload.data.foreground) == 1) {
                    const title = payload.notification.title;
                    const options = {
                        body: payload.notification.body,
                        icon: payload.notification.icon,
                    };
                    new Notification(title, options);
                }
            });

            function requestPermissionAndGenerateToken(registration) {
                document.addEventListener("click", function (event) {
                    if (event.target.id == 'allow-notification') {
                        Notification.requestPermission().then((permission) => {
                            if (permission === 'granted') {
                                getToken(messaging, {
                                    serviceWorkerRegistration: registration,
                                    vapidKey: "{{$firebaseNotify['vapidKey']}}"
                                })
                                    .then((token) => {
                                        $.ajax({
                                            url: "{{ route('user.save.token') }}",
                                            method: "post",
                                            data: {
                                                token: token,
                                            },
                                            success: function (res) {
                                            }
                                        });
                                        window.newApp.notificationPermission = 'granted';
                                    });
                            } else {
                                window.newApp.notificationPermission = 'denied';
                            }
                        });
                    }
                });
            }
        </script>
        <script>
            window.newApp = new Vue({
                el: "#firebase-app",
                data: {
                    user_foreground: '',
                    user_background: '',
                    notificationPermission: Notification.permission,
                    is_notification_skipped: sessionStorage.getItem('is_notification_skipped') == '1'
                },
                mounted() {
                    sessionStorage.clear();
                    this.user_foreground = "{{$firebaseNotify['user_foreground']}}";
                    this.user_background = "{{$firebaseNotify['user_background']}}";
                },
                methods: {
                    skipNotification() {
                        sessionStorage.setItem('is_notification_skipped', '1');
                        this.is_notification_skipped = true;
                    }
                }
            });
        </script>
    @endpush
@endif

