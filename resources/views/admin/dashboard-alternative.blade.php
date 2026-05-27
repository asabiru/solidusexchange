@extends('admin.layouts.app')
@section('page_title', __('Dashboard'))
@section('content')
    <!-- Content -->

    <!-- End Content -->
    <div class="content container-fluid dashboard-height">


        <div id="firebase-app">
            <div class=" p-3 mb-5 alert alert-soft-dark mb-4 mb-lg-7" role="alert"
                 v-if="notificationPermission == 'default' && !is_notification_skipped" v-cloak>
                <div class="alert-box d-flex flex-wrap align-items-center">
                    <div class="flex-shrink-0">
                        <img class="avatar avatar-xl"
                             src="{{ asset('assets/admin/img/oc-megaphone.svg') }}"
                             alt="Image Description" data-hs-theme-appearance="default">
                        <img class="avatar avatar-xl"
                             src="{{ asset('assets/admin/img/oc-megaphone-light.svg') }}"
                             alt="Image Description" data-hs-theme-appearance="dark">
                    </div>

                    <div class="flex-grow-1 ms-3">
                        <h3 class=" mb-1">@lang("Attention!")</h3>
                        <div class="d-flex align-items-center">
                            <p class="mb-0 text-body"> @lang('Please allow your browser to get instant push notification. Allow it from notification setting.')</p>
                            <button id="allow-notification" class="btn btn-sm btn-primary mx-2"><i
                                    class="fa fa-check-circle"></i> @lang('Allow me')</button>
                        </div>
                    </div>
                    <button type="button" class="btn-close"
                            @click.prevent="skipNotification" data-bs-dismiss="alert"
                            aria-label="Close">
                    </button>
                </div>
            </div>
            <div class="alert alert-soft-dark mb-4 mb-lg-7" role="alert"
                 v-if="notificationPermission == 'denied' && !is_notification_skipped" v-cloak>
                <div class="d-flex align-items-center mt-4">
                    <div class="flex-shrink-0">
                        <img class="avatar avatar-xl"
                             src="{{ asset('assets/admin/img/oc-megaphone.svg') }}"
                             alt="Image Description" data-hs-theme-appearance="default">
                        <img class="avatar avatar-xl"
                             src="{{ asset('assets/admin/img/oc-megaphone-light.svg') }}"
                             alt="Image Description" data-hs-theme-appearance="dark">
                    </div>

                    <div class="flex-grow-1 ms-3">
                        <h3 class=" mb-1">@lang("Attention!")</h3>
                        <div class="d-flex align-items-center">
                            <p class="mb-0 text-body"> @lang("Please allow your browser to get instant push notification. Allow it from notification setting.")</p>
                        </div>
                    </div>
                    <button type="button" class="btn-close" @click.prevent="skipNotification" data-bs-dismiss="alert"
                            aria-label="Close"></button>
                </div>
            </div>
        </div>
        <div class="row ">
            @include('admin.partials.dashboard.recentTran')
            @include('admin.partials.dashboard.record')
        </div>

        @include('admin.partials.dashboard.exchange-performance')
        @include('admin.partials.dashboard.exchange-figure')

        <div class="card mb-3 mb-lg-5">
            <div class="card-header card-header-content-between">
                <h4 class="card-header-title">@lang("Latest Users")</h4>

                <a class="btn btn-ghost-secondary btn-sm" href="{{ route("admin.users") }}">@lang("View All")</a>
            </div>
            <div class="table-responsive">
                <table class="table table-borderless table-thead-bordered table-align-middle card-table">
                    <thead class="thead-light">
                    <tr>
                        <th>@lang('Full Name')</th>
                        <th>@lang('Email-Phone')</th>
                        <th>@lang('Country')</th>
                        <th>@lang('Status')</th>
                        <th>@lang('Last Login')</th>
                        <th>@lang('Action')</th>
                    </tr>
                    </thead>
                    <tbody>
                    @forelse($latestUser as $user)
                        <tr>
                            <td>

                                <a class="d-flex align-items-center me-2"
                                   href="{{ route("admin.user.view.profile", $user->id) }}">
                                    <div class="flex-shrink-0">
                                        {!! $user->profilePicture() !!}
                                    </div>
                                    <div class="flex-grow-1 ms-3">
                                        <h5 class="text-hover-primary mb-0">{{ $user->firstname . ' ' . $user->lastname }}</h5>
                                        <span class="fs-6 text-body">{{'@'. $user->username }}</span>
                                    </div>
                                </a>
                            </td>
                            <td>
                                <span class="d-block h5 mb-0"> {{ $user->email }}</span>
                                <span class="d-block fs-5">{{ $user->phone }}</span>
                            </td>
                            <td>
                                {{ $user->country ?? 'N/A' }}
                            </td>
                            <td>
                                @if($user->status == 1)
                                    <span class="badge bg-soft-success text-success">
                                        <span class="legend-indicator bg-success"></span>@lang("Active")
                                    </span>
                                @else
                                    <span class="badge bg-soft-danger text-danger">
                                        <span class="legend-indicator bg-danger"></span>@lang("Inactive")
                                    </span>
                                @endif
                            </td>
                            <td>
                                {{ diffForHumans($user->last_login) }}
                            </td>
                            <td>
                                <div class="btn-group" role="group">
                                    <a class="btn btn-white btn-sm" href="{{ route('admin.user.edit', $user->id) }}">
                                        <i class="bi-pencil-fill me-1"></i> @lang("Edit")
                                    </a>
                                    <div class="btn-group">
                                        <button type="button"
                                                class="btn btn-white btn-icon btn-sm dropdown-toggle dropdown-toggle-empty"
                                                id="userEditDropdown" data-bs-toggle="dropdown"
                                                aria-expanded="false"></button>
                                        <div class="dropdown-menu dropdown-menu-end mt-1"
                                             aria-labelledby="userEditDropdown">
                                            <a class="dropdown-item"
                                               href="{{ route('admin.user.view.profile', $user->id) }}">
                                                <i class="bi-eye-fill dropdown-item-icon"></i> @lang("View Profile")
                                            </a>
                                            <a class="dropdown-item" href="{{ route('admin.send.email', $user->id) }}">
                                                <i
                                                    class="bi-envelope dropdown-item-icon"></i> @lang("Send Mail") </a>
                                            <a class="dropdown-item loginAccount" href="javascript:void(0)"
                                               data-route="{{ route('admin.login.as.user', $user->id) }}"
                                               data-bs-toggle="modal" data-bs-target="#loginAsUserModal">
                                                <i class="bi bi-box-arrow-in-right dropdown-item-icon"></i>
                                                @lang("Login As User")
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <div class="text-center p-4">
                                <img class="dataTables-image mb-3" src="{{ asset('assets/admin/img/oc-error.svg') }}"
                                     alt="Image Description" data-hs-theme-appearance="default">
                                <img class="dataTables-image mb-3"
                                     src="{{ asset('assets/admin/img/oc-error-light.svg') }}" alt="Image Description"
                                     data-hs-theme-appearance="dark">
                                <p class="mb-0">@lang("No data to show")</p>
                            </div>
                        </tr>
                    @endforelse
                    </tbody>
                </table>
            </div>
        </div>

        @include('admin.partials.dashboard.browserHistory')

    </div>

    @if($basicControl->is_active_cron_notification)
        <!-- Modal -->
        <div class="modal fade" id="cron-info" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1"
             aria-labelledby="staticBackdropLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="staticBackdropLabel"><i class="fal fa-info-circle"></i>
                            @lang('Cron Job Set Up Instruction')</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-12">
                                <p class="bg-orange text-white p-2">
                                    <i>@lang('**To sending emails and manage records automatically you need to setup cron job in your server. Make sure your job is running properly. We insist to set the cron job time as minimum as possible.**')</i>
                                </p>
                            </div>

                            @php
                                $cronSecret = (string) config('app.scheduler_secret');
                                $queueWorkUrl = $cronSecret !== ''
                                    ? route('queue.work', ['secret' => $cronSecret])
                                    : route('queue.work');
                                $scheduleRunUrl = $cronSecret !== ''
                                    ? route('schedule:run', ['secret' => $cronSecret])
                                    : route('schedule:run');
                            @endphp

                            <div class="col-md-12 form-group">
                                <label><strong>@lang('Command for Email')</strong></label>
                                <div class="input-group mb-3">
                                    <input type="text" class="form-control copyText"
                                           value="curl -fsS '{{ $queueWorkUrl }}'" disabled>
                                    <button class="input-group-text bg-primary btn btn-primary text-white copy-btn"
                                            id="button-addon2">
                                        <i class="fas fa-copy"></i></button>

                                </div>
                            </div>
                            <div class="col-md-12 form-group">
                                <label><strong>@lang('Command for Cron Job')</strong></label>
                                <div class="input-group mb-3">
                                    <input type="text" class="form-control copyText"
                                           value="curl -fsS '{{ $scheduleRunUrl }}'"
                                           disabled>
                                    <button class="input-group-text bg-primary btn btn-primary text-white copy-btn"
                                            id="button-addon2">
                                        <i class="fas fa-copy"></i></button>
                                </div>
                            </div>
                            <div class="col-md-12 text-center">
                                <p class="bg-dark text-white p-2">
                                    @lang('*To turn off this pop up go to ')
                                    <a href="{{route('admin.basic.control')}}"
                                       class="text-danger">@lang('Basic control')</a>
                                    @lang(' and disable `Cron Set Up Pop Up`.*')
                                </p>
                            </div>

                            <div class="col-md-12">
                                <p class="text-muted"><span class="text-secondary font-weight-bold">@lang('N.B'):</span>
                                    @lang('If you are unable to set up cron job, Here is a video tutorial for you')
                                    <a href="https://www.youtube.com/watch?v=wuvTRT2ety0" target="_blank"><i
                                            class="fab fa-youtube"></i> @lang('Click Here') </a>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    @endif

    @include('admin.user_management.components.login_as_user')
    @include('admin.user_management.components.update_balance_modal')

@endsection

@push('js-lib')
    <script src="{{ asset('assets/admin/js/chart.min.js') }}"></script>
    <script src="{{ asset('assets/global/js/apexcharts.min.js') }}"></script>
@endpush

@push("script")
    <script>
        'use strict';

        $(document).on('click', '.loginAccount', function () {
            let route = $(this).data('route');
            $('.loginAccountAction').attr('action', route)
        });

        $(document).on('click', '.addBalance', function () {
            $('.setBalanceRoute').attr('action', $(this).data('route'));
            $('.user-contact-balance').text(new Intl.NumberFormat('en-US').format($(this).data('contacts')));
            $('.user-email-balance').text(new Intl.NumberFormat('en-US').format($(this).data('emails')));
        })


        $(document).ready(function () {
            let isActiveCronNotification = '{{ $basicControl->is_active_cron_notification }}';
            if (isActiveCronNotification == 1)
                $('#cron-info').modal('show');
            $(document).on('click', '.copy-btn', function () {
                var _this = $(this)[0];
                var copyText = $(this).siblings('input');
                $(copyText).prop('disabled', false);
                copyText.select();
                document.execCommand("copy");
                $(copyText).prop('disabled', true);
                $(this).text('Coppied');
                setTimeout(function () {
                    $(_this).text('');
                    $(_this).html('<i class="fas fa-copy"></i>');
                }, 500)
            });
        })


    </script>

@endpush

@if($firebaseNotify)
    @push('script')
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
                                            url: "{{ route('admin.save.token') }}",
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
                    admin_foreground: '',
                    admin_background: '',
                    notificationPermission: Notification.permission,
                    is_notification_skipped: sessionStorage.getItem('is_notification_skipped') == '1'
                },
                mounted() {
                    sessionStorage.clear();
                    this.admin_foreground = "{{$firebaseNotify['admin_foreground']}}";
                    this.admin_background = "{{$firebaseNotify['admin_background']}}";
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













