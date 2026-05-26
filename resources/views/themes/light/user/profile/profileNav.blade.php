<div class="account-settings-navbar">
    <ul class="nav">
        <li class="nav-item">
            <a class="nav-link {{menuActive('user.profile')}}" aria-current="page" href="{{route('user.profile')}}"><i
                    class="fa-light fa-user"></i>@lang('profile')</a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive('user.change.password')}}" aria-current="page"
               href="{{route('user.change.password')}}"><i
                    class="fa-light fa-lock"></i>@lang('password')</a>
        </li>
        @if(basicControl()->email_notification || basicControl()->sms_notification || basicControl()->push_notification || basicControl()->in_app_notification)
            <li class="nav-item">
                <a class="nav-link {{menuActive('user.notification')}}" href="{{route('user.notification')}}"><i
                        class="fa-light fa-link"></i>@lang('Notification')</a>
            </li>
        @endif
        @isset($kycs)
            @foreach($kycs as $item)
                <li class="nav-item">
                    <a class="nav-link {{request()->segment(count(request()->segments())) == $item->id ? 'active':''}}"
                       href="{{route('user.kyc',[$item->slug,$item->id])}}"><i
                            class="fa-light fa-id-card"></i> {{$item->name}}</a>
                </li>
            @endforeach
        @endisset
    </ul>
</div>
