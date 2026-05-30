<aside id="sidebar" class="sidebar">
    {{-- Brand --}}
    <div class="sidebar-brand">
        <a href="{{ url('/') }}" class="sidebar-brand-link" title="На главную">
            <img src="{{ getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo) }}" alt="{{ basicControl()->site_title }}" style="width:40px;height:40px;object-fit:contain;border-radius:10px;">
            <span class="sidebar-brand-name">SolidChange</span>
        </a>
    </div>

    <ul class="sidebar-nav" id="sidebar-nav">

        {{-- Обзор --}}
        <li class="sidebar-section-label">@lang('Overview')</li>

        <li class="nav-item">
            <a class="nav-link {{menuActive('user.dashboard')}}" href="{{route('user.dashboard')}}">
                <i class="fa-light fa-grid-2"></i>
                <span>@lang('Dashboard')</span>
            </a>
        </li>

        {{-- Операции --}}
        <li class="sidebar-section-label">@lang('Operations')</li>

        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.exchangeList','user.exchangeDetails'])}}"
               href="{{route('user.exchangeList')}}">
                <i class="fa-light fa-arrow-right-arrow-left"></i>
                <span>@lang('Exchange')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.buyList','user.buyDetails'])}}" href="{{route('user.buyList')}}">
                <i class="fa-light fa-circle-plus"></i>
                <span>@lang('Buy')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.sellList','user.sellDetails'])}}" href="{{route('user.sellList')}}">
                <i class="fa-light fa-circle-minus"></i>
                <span>@lang('Sell')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive('tracking')}}" href="{{route('tracking')}}">
                <i class="fa-light fa-location-dot"></i>
                <span>@lang('Tracking')</span>
            </a>
        </li>

        {{-- Финансы --}}
        <li class="sidebar-section-label">@lang('Finance')</li>

        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.fund.index'])}}"
               href="{{route('user.fund.index')}}">
                <i class="fa-light fa-paper-plane"></i>
                <span>@lang('Payment Request')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.transaction.index'])}}" href="{{route('user.transaction.index')}}">
                <i class="fa-light fa-clock-rotate-left"></i>
                <span>@lang('Transaction')</span>
            </a>
        </li>

        {{-- Поддержка --}}
        <li class="sidebar-section-label">@lang('Support')</li>

        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.ticket.list','user.ticket.create','user.ticket.store','user.ticket.view'])}}"
               href="{{route('user.ticket.list')}}">
                <i class="fa-light fa-headset"></i>
                <span>@lang('Support Ticket')</span>
            </a>
        </li>
        <li class="nav-item">
            <a class="nav-link {{menuActive(['user.verification.center'])}}"
               href="{{route('user.verification.center')}}">
                <i class="fa-light fa-shield-check"></i>
                <span>@lang('Verification')</span>
            </a>
        </li>

    </ul>

    {{-- User info at bottom --}}
    <div class="sidebar-footer">
        <div class="sidebar-user">
            <div class="sidebar-user-avatar">
                {{ strtoupper(substr(auth()->user()->firstname ?? auth()->user()->username ?? 'U', 0, 1)) }}
            </div>
            <div class="sidebar-user-info">
                <span class="sidebar-user-name">{{ auth()->user()->fullname ?? auth()->user()->username }}</span>
                <span class="sidebar-user-email">{{ Str::limit(auth()->user()->email, 22) }}</span>
            </div>
            <a href="{{ route('logout') }}"
               onclick="event.preventDefault(); document.getElementById('sb-logout').submit();"
               class="sidebar-logout-btn" title="Выйти">
                <i class="fa-light fa-right-from-bracket"></i>
            </a>
            <form id="sb-logout" action="{{ route('logout') }}" method="POST" class="d-none">@csrf</form>
        </div>
    </div>
</aside>

<style>
/* Sidebar brand */
.sidebar-brand {
    height: 64px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    border-bottom: 1px solid rgba(232,201,160,0.08);
    flex-shrink: 0;
}

.sidebar-brand-link {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: #f5ede4 !important;
}

.sidebar-brand-badge {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1.5px solid rgba(232,201,160,0.4);
    background: rgba(232,201,160,0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 800;
    color: #e8c9a0;
    flex-shrink: 0;
}

.sidebar-brand-name {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #f5ede4;
}

/* Section labels */
.sidebar-section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #3a2e2a;
    padding: 14px 14px 4px;
    list-style: none;
}

/* Sidebar footer user info */
.sidebar-footer {
    margin-top: auto;
    padding: 12px;
    border-top: 1px solid rgba(232,201,160,0.08);
}

.sidebar-user {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: 10px;
    background: rgba(232,201,160,0.04);
    border: 1px solid rgba(232,201,160,0.08);
}

.sidebar-user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #c9a227, #e8c9a0);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: #0b0608;
    flex-shrink: 0;
}

.sidebar-user-info {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.sidebar-user-name {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #f5ede4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sidebar-user-email {
    display: block;
    font-size: 11px;
    color: #5e534d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.sidebar-logout-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #5e534d;
    text-decoration: none;
    transition: all 0.2s;
    flex-shrink: 0;
}

.sidebar-logout-btn:hover {
    background: rgba(201,120,106,0.12);
    color: #c9786a;
}

/* Ensure sidebar layout uses flex column */
#sidebar.sidebar {
    display: flex !important;
    flex-direction: column !important;
}
</style>

