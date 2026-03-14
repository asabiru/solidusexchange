@if(basicControl()->in_app_notification)
    <li class="nav-item dropdown" id="pushNotificationArea" v-cloak>
        <a class="nav-link nav-icon" href="#" data-bs-toggle="dropdown">
            <i class="fa-light fa-bell"></i>
            <span v-if="items.length > 0" class="badge badge-number" v-cloak>@{{items.length}}</span>
        </a>

        <ul class="dropdown-menu dropdown-menu-end dropdown-menu-arrow notifications">
            <li class="notification-item" v-for="(item, index) in items"
                @click.prevent="readAt(item.id, item.description.link)">
                <a href="javascript:void(0)">
                    <i class="fa-regular fa-circle-check text-success"></i>
                    <div>
                        <p>@{{item.description.text}}</p>
                        <p>@{{ item.formatted_date }}</p>
                    </div>
                </a>
            </li>

            <li class="dropdown-footer">
                <a href="javascript:void(0)" v-if="items.length > 0" @click.prevent="readAll">@lang('Clear all')</a>
                <a href="javascript:void(0)" v-if="items.length == 0"
                   @click.prevent="readAll">@lang('You have no notifications')</a>
            </li>
        </ul>
    </li>


    @push('extra_scripts')

        <script>
            'use strict';
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
                        axios.get("{{ route('user.push.notification.show') }}")
                            .then(function (res) {
                                app.items = res.data;
                            })
                    },
                    readAt(id, link) {
                        let app = this;
                        let url = "{{ route('user.push.notification.readAt', 0) }}";
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
                        let url = "{{ route('user.push.notification.readAll') }}";
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
                        let channel = pusher.subscribe('user-notification.' + "{{ Auth::id() }}");
                        channel.bind('App\\Events\\UserNotification', function (data) {
                            app.items.unshift(data.message);
                        });
                        channel.bind('App\\Events\\UpdateUserNotification', function (data) {
                            app.getNotifications();
                        });
                    }
                }
            });
        </script>

    @endpush

@endif
