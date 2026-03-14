<aside id="sidebar" class="sidebar">
    <ul class="sidebar-nav" id="sidebar-nav">
        <li class="nav-item">
            <a class="nav-link {{menuActive('user.dashboard')}}" href="{{route('user.dashboard')}}">
                <i class="fa-light fa-grid"></i>
                <span>@lang('Dashboard')</span>
            </a>
        </li>

        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.exchangeList','user.exchangeDetails'])}}"
               href="{{route('user.exchangeList')}}">
                <i class="fa-light fal fa-exchange"></i>
                <span>@lang('Exchange')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.buyList','user.buyDetails'])}}" href="{{route('user.buyList')}}">
                <i class="fa-light fal fa-wallet"></i>
                <span>@lang('Buy')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.sellList','user.sellDetails'])}}" href="{{route('user.sellList')}}">
                <i class="fa-light fal fa-tags"></i>
                <span>@lang('Sell')</span>
            </a>
        </li>

        <li class="nav-item">
            <a class="nav-link {{menuActive('tracking')}}" href="{{route('tracking')}}">
                <i class="fa-light fal fa-location-check"></i>
                <span>@lang('Tracking')</span>
            </a>
        </li>



        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.fund.index'])}}"
               href="{{route('user.fund.index')}}">
                <i class="fa-light fal fa-spinner"></i>
                <span>@lang('Payment Request')</span>
            </a>
        </li>

        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.transaction.index'])}}" href="{{route('user.transaction.index')}}">
                <i class="fa-light fal fa-stream"></i>
                <span>@lang('Transaction')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.ticket.list','user.ticket.create','user.ticket.store','user.ticket.view'])}}"
               href="{{route('user.ticket.list')}}">
                <i class="fa-light fal fa-user-headset"></i>
                <span>@lang('Support Ticket')</span>
            </a>
        </li>
    </ul>

</aside>
