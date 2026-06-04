@php
    $user = $user ?? auth()->user();
    $rateCards = collect($rateCards ?? []);
    $cryptos = $cryptoCurrencies ?? collect();
    $fiats = $fiatCurrencies ?? collect();
    $defaultFiat = $defaultFiatCode ?? 'RUB';
    $telegramAuthUrl = route('telegram.mini-app');
    $telegramQuoteUrl = route('telegram.mini-app.quote');
    $telegramRequestUrl = route('telegram.mini-app.request');
    $telegramStatsUrl = $statsUrl ?? route('telegram.mini-app.stats');
    $telegramKycUrl = $kycUrl ?? route('telegram.mini-app.kyc');
    $telegramKycSubmitUrl = $kycSubmitUrl ?? route('telegram.mini-app.kyc.submit');
    $telegramEmailSendUrl = route('telegram.mini-app.email.send');
    $telegramEmailVerifyUrl = route('telegram.mini-app.email.verify');
    $telegramPolicyUrl = $policyUrl ?? route('telegram.mini-app.page', ['slug' => 'terms-and-conditions']);
    $telegramPrivacyUrl = $privacyUrl ?? route('telegram.mini-app.page', ['slug' => 'privacy-policy']);
    $logoUrl = $appLogo ?? getFile(basicControl()->dark_logo_driver, basicControl()->dark_logo);
    $needsEmailBind = $user && (!$user->email || str_ends_with((string) $user->email, '@telegram.local'));

    // Pre-build JSON-safe arrays (arrow fns inside @json confuse Blade parser)
    $cryptosJson = $cryptos->map(function($c) {
        return [
            'id' => $c->id,
            'code' => strtoupper($c->code ?? $c->normalized_code ?? ''),
            'display_code' => strtoupper($c->normalized_code ?? $c->code ?? ''),
            'name' => $c->name,
            'image_path' => $c->image_path,
        ];
    })->values()->toArray();

    $fiatsJson = $fiats->map(function($f) {
        return [
            'id' => $f->id,
            'code' => strtoupper($f->code ?? ''),
            'display_code' => strtoupper($f->code ?? ''),
            'name' => $f->name,
            'image_path' => $f->image_path,
            'buy_method_name' => $f->buy_method_name,
            'buy_method_image_path' => $f->buy_method_image_path,
            'sell_method_name' => $f->sell_method_name,
            'sell_method_image_path' => $f->sell_method_image_path,
            'show_in_buy' => (bool) $f->show_in_buy,
            'show_in_sell' => (bool) $f->show_in_sell,
        ];
    })->values()->toArray();
@endphp
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>SolidChange</title>
    <link rel="shortcut icon" href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}" type="image/x-icon">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link rel="stylesheet" href="{{ asset('assets/global/css/tma-app.css') }}">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body class="tma" data-theme="dark">

@unless(Auth::check())
<div class="tma-auth-overlay" id="authOverlay">
    <div class="tma-auth-spinner"></div>
    <strong>Входим через Telegram...</strong>
    <span>Проверяем подпись и создаём профиль</span>
</div>
@endunless

<div class="tma-app" id="app">
    {{-- ===== HEADER ===== --}}
    <header class="tma-header">
        <div class="tma-header__brand">
            <div class="tma-logo"><img src="{{ $logoUrl }}" alt="SolidChange"></div>
            <div>
                <strong>SolidChange</strong>
                <small>обмен в Telegram</small>
            </div>
        </div>

    </header>

    {{-- ===== TAB: КУРСЫ ===== --}}
    <section class="tma-panel" data-panel="rates">
        <div class="tma-panel__head">
            <h2>Курсы</h2>
            <span class="tma-live-dot">Live</span>
        </div>

        <div class="tma-rates" id="ratesContainer">
            @forelse($rateCards as $rc)
            <div class="tma-rate-row">
                <div class="tma-rate-row__coin">
                    <div class="tma-coin-icon" data-coin="{{ strtolower($rc['code']) }}">
                        @if(!empty($rc['image_path']))
                            <img src="{{ $rc['image_path'] }}" alt="{{ $rc['code'] }}">
                        @else
                            {{ mb_substr($rc['code'],0,1) }}
                        @endif
                    </div>
                    <div>
                        <strong>{{ $rc['code'] }}</strong>
                        <small>{{ $rc['pair'] }}</small>
                    </div>
                </div>
                <div class="tma-rate-row__prices">
                    <div>
                        <span class="tma-label">Покупка</span>
                        <span class="tma-value tma-value--buy">{{ $rc['display_buy_rate'] }} {{ $rc['quote_code'] }}</span>
                    </div>
                    <div>
                        <span class="tma-label">Продажа</span>
                        <span class="tma-value tma-value--sell">{{ $rc['display_sell_rate'] }} {{ $rc['quote_code'] }}</span>
                    </div>
                    @if($rc['change_24h'] !== null)
                        <span class="tma-rate-change {{ $rc['change_24h'] >= 0 ? 'is-positive' : 'is-negative' }}">
                            {{ $rc['change_24h'] >= 0 ? '+' : '' }}{{ number_format($rc['change_24h'], 2) }}%
                        </span>
                    @else
                        <span class="tma-rate-change">—</span>
                    @endif
                </div>
            </div>
            @empty
            <div class="tma-empty">
                <i class="fas fa-sync-alt"></i>
                <p>Курсы обновляются...</p>
            </div>
            @endforelse
        </div>
    </section>

    {{-- ===== TAB: ОБМЕН ===== --}}
    <section class="tma-panel" data-panel="exchange" hidden>
        @if($user)
        <div class="tma-exchange-header">
            <div class="tma-user-mini">
                <div class="tma-avatar">{{ mb_substr($user->firstname ?: $user->username ?: 'U', 0, 1) }}</div>
                <div>
                    <strong>{{ $user->firstname ?: $user->username ?: 'Пользователь' }}</strong>
                    <small>обмен внутри Telegram</small>
                </div>
            </div>
            <button class="tma-badge" id="historyBtn"><i class="fas fa-history"></i> История</button>
        </div>
        @endif

        {{-- Exchange mode selector --}}
        <div class="tma-mode-tabs" id="modeTabs">
            <button class="tma-mode-tab is-active" data-exchange-mode="buy">
                <i class="fas fa-ruble-sign"></i><span>Купить</span>
            </button>
            <button class="tma-mode-tab" data-exchange-mode="sell">
                <i class="fas fa-wallet"></i><span>Продать</span>
            </button>
            <button class="tma-mode-tab" data-exchange-mode="exchange">
                <i class="fas fa-repeat"></i><span>Обмен</span>
            </button>
        </div>

        @if($user && !$user->identity_verify)
        <div class="tma-kyc-gate" id="kycGate">
            <i class="fas fa-shield-alt" style="font-size:28px;color:var(--accent)"></i>
            <strong>Пройдите KYC для обмена</strong>
            <small>Для совершения обмена необходимо пройти верификацию личности</small>
            <button class="tma-primary-btn" id="kycGateBtn" type="button" style="margin-top:12px">
                <i class="fas fa-id-card"></i>&nbsp; Пройти KYC
            </button>
        </div>
        @endif

        <div class="tma-calc" id="exchangeCalc" @if($user && !$user->identity_verify) style="display:none" @endif>
            <div class="tma-calc__field">
                <label id="sendFieldLabel">Способ оплаты</label>
                <div class="tma-calc__input-row">
                    <input type="number" id="sendAmount" placeholder="0" min="0" step="any" inputmode="decimal">
                    <button class="tma-currency-btn" id="sendCurrencyBtn" data-type="send">
                        <span class="tma-currency-btn__icon" id="sendCurrencyIcon"></span>
                        <span id="sendCurrencyLabel">Рубли</span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
            </div>

            <button class="tma-swap-btn" id="swapBtn" type="button">
                <i class="fas fa-arrow-down"></i><i class="fas fa-arrow-up"></i>
            </button>

            <div class="tma-calc__field">
                <label id="getFieldLabel">Получаете криптовалюту</label>
                <div class="tma-calc__input-row">
                    <input type="number" id="getAmount" placeholder="0" readonly>
                    <button class="tma-currency-btn" id="getCurrencyBtn" data-type="get">
                        <span class="tma-currency-btn__icon" id="getCurrencyIcon"></span>
                        <span id="getCurrencyLabel">{{ $cryptos->first() ? strtoupper($cryptos->first()->normalized_code ?? $cryptos->first()->code ?? 'USDT') : 'USDT' }}</span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
            </div>

            <div class="tma-calc__info">
                <div class="tma-calc__info-row">
                    <span>Курс</span>
                    <span id="rateDisplay">—</span>
                </div>
                <div class="tma-calc__info-row">
                    <span>Комиссия сервиса</span>
                    <span id="feeDisplay">1%</span>
                </div>
            </div>

            <button class="tma-primary-btn" id="exchangeBtn" type="button" disabled>
                Введите сумму
            </button>

            <div class="tma-calc__note" id="calcNote"></div>
        </div>

        {{-- History panel (hidden by default) --}}
        <div class="tma-history" id="historyPanel" hidden>
            <div class="tma-panel__head">
                <h2>История сделок</h2>
                <button class="tma-badge" id="historyClose"><i class="fas fa-times"></i></button>
            </div>
            <div class="tma-empty">
                <i class="fas fa-receipt"></i>
                <p>Пока нет завершённых сделок</p>
            </div>
        </div>
    </section>

    {{-- ===== TAB: ПРОФИЛЬ ===== --}}
    <section class="tma-panel" data-panel="profile" hidden>
        @if($user)
        <div class="tma-profile-header">
            <div class="tma-avatar tma-avatar--lg">{{ mb_substr($user->firstname ?: $user->username ?: 'U', 0, 1) }}</div>
            <div>
                <strong>{{ $user->firstname ?: $user->username ?: 'Пользователь' }} {{ $user->lastname ?? '' }}</strong>
                <small class="tma-uid">Telegram ID: {{ $user->telegram_id ?: $user->id }}</small>
            </div>
        </div>

        <div class="tma-menu-group">
            <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="stats">
                <div class="tma-menu-item__icon tma-menu-item__icon--blue"><i class="fas fa-chart-bar"></i></div>
                <div class="tma-menu-item__body">
                    <strong>Статистика</strong>
                    <small>Пополнения, выводы, обмены</small>
                </div>
                <i class="fas fa-chevron-right"></i>
            </a>
            <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="kyc">
                <div class="tma-menu-item__icon tma-menu-item__icon--green"><i class="fas fa-shield-alt"></i></div>
                <div class="tma-menu-item__body">
                    <strong>Статус</strong>
                    <small>Пройти KYC</small>
                </div>
                <span class="tma-status-dot">● {{ $user->identity_verify ? 'пройден' : 'не начато' }}</span>
            </a>
        </div>



        <div class="tma-menu-group">
            <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="policy">
                <div class="tma-menu-item__icon"><i class="fas fa-file-alt"></i></div>
                <div class="tma-menu-item__body"><strong>Условия использования</strong></div>
                <i class="fas fa-chevron-right"></i>
            </a>
            <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="privacy">
                <div class="tma-menu-item__icon"><i class="fas fa-lock"></i></div>
                <div class="tma-menu-item__body"><strong>Политика конфиденциальности</strong></div>
                <i class="fas fa-chevron-right"></i>
            </a>
        </div>
        @else
        <div class="tma-empty">
            <i class="fas fa-user-slash"></i>
            <p>Откройте приложение из Telegram для автоматического входа</p>
        </div>
        @endif
    </section>
</div>

{{-- ===== CURRENCY PICKER MODAL ===== --}}
<div class="tma-modal" id="currencyModal" hidden>
    <div class="tma-modal__content">
        <div class="tma-modal__head">
            <h3 id="currencyModalTitle">Выберите валюту</h3>
            <button class="tma-modal__close" id="modalClose"><i class="fas fa-times"></i></button>
        </div>
        <input class="tma-modal__search" id="currencySearch" placeholder="Поиск..." type="text">
        <div class="tma-modal__list" id="currencyList"></div>
    </div>
</div>

{{-- ===== EMAIL BIND MODAL ===== --}}
<div class="tma-modal" id="emailBindModal" hidden>
    <div class="tma-modal__content tma-email-modal">
        <div class="tma-modal__head">
            <h3>Привяжите Email</h3>
            <button class="tma-modal__close" id="emailBindLater" type="button"><i class="fas fa-times"></i></button>
        </div>
        <div class="tma-email-icon"><i class="far fa-envelope"></i></div>
        <p class="tma-email-copy">Привяжите почту, чтобы не потерять доступ к аккаунту и получать уведомления по заявкам.</p>
        <div class="tma-email-form">
            <input class="tma-modal__search" id="emailBindInput" type="email" placeholder="email@example.com" autocomplete="email">
            <button class="tma-primary-btn" id="emailBindSend" type="button">Отправить код</button>
            <div id="emailVerifyStep" hidden>
                <input class="tma-modal__search" id="emailBindCode" type="text" inputmode="numeric" placeholder="Код из письма">
                <button class="tma-primary-btn" id="emailBindVerify" type="button">Подтвердить Email</button>
            </div>
            <button class="tma-secondary-btn" id="emailBindSkip" type="button">Позже</button>
            <small id="emailBindMessage"></small>
        </div>
    </div>
</div>

{{-- ===== PROFILE ACTION MODAL ===== --}}
<div class="tma-modal" id="profileModal" hidden>
    <div class="tma-modal__content tma-modal__content--sheet">
        <div class="tma-modal__head">
            <h3 id="profileModalTitle">Профиль</h3>
            <button class="tma-modal__close" id="profileModalClose"><i class="fas fa-times"></i></button>
        </div>
        <div class="tma-modal__body" id="profileModalBody"></div>
    </div>
</div>

{{-- ===== BOTTOM NAV ===== --}}
<nav class="tma-nav">
    <button class="tma-nav__btn is-active" data-tab="rates">
        <i class="fas fa-chart-line"></i>
        <span>Курсы</span>
    </button>
    <button class="tma-nav__btn" data-tab="exchange">
        <i class="fas fa-exchange-alt"></i>
        <span>Обмен</span>
    </button>
    <button class="tma-nav__btn" data-tab="profile">
        <i class="fas fa-user"></i>
        <span>Профиль</span>
    </button>
</nav>

<script>
(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready();
    webApp?.expand();

    const body = document.body;
    const panels = document.querySelectorAll('[data-panel]');
    const tabs = document.querySelectorAll('[data-tab]');
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
    const overlay = document.getElementById('authOverlay');
    const profileModal = document.getElementById('profileModal');
    const profileModalTitle = document.getElementById('profileModalTitle');
    const profileModalBody = document.getElementById('profileModalBody');
    const profileModalClose = document.getElementById('profileModalClose');
    const apiUrls = {
        stats: @json($telegramStatsUrl),
        kyc: @json($telegramKycUrl),
        kycSubmit: @json($telegramKycSubmitUrl),
        emailSend: @json($telegramEmailSendUrl),
        emailVerify: @json($telegramEmailVerifyUrl),
        policy: @json($telegramPolicyUrl),
        privacy: @json($telegramPrivacyUrl),
    };
    let needsEmailBind = @json($needsEmailBind);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        })[char]);
    }

    // ---------- Currency data from server ----------
    const cryptos = @json($cryptosJson);
    const fiats = @json($fiatsJson);
    const defaultFiat = @json($defaultFiat);

    // ---------- Exchange state ----------
    let sendType = 'fiat';   // fiat→crypto = buy, crypto→fiat = sell
    const buyFiats = fiats.filter(f => f.show_in_buy !== false);
    const sellFiats = fiats.filter(f => f.show_in_sell !== false);
    let sendCurrency = buyFiats[0] || {id:0, code: defaultFiat, name:'Рубль'};
    let getCurrency = cryptos[0] || {id:0, code:'USDT', name:'Tether'};
    let debounceTimer = null;
    let exchangeMode = 'buy'; // buy, sell, exchange

    // ---------- Exchange mode tabs ----------
    const modeTabs = document.querySelectorAll('[data-exchange-mode]');
    modeTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            modeTabs.forEach(function(t) { t.classList.remove('is-active'); });
            tab.classList.add('is-active');
            exchangeMode = tab.dataset.exchangeMode;

            if (exchangeMode === 'buy') {
                sendCurrency = buyFiats[0] || {id:0, code: defaultFiat, name:'Рубль'};
                getCurrency = cryptos[0] || {id:0, code:'USDT', name:'Tether'};
                sendType = 'fiat';
            } else if (exchangeMode === 'sell') {
                sendCurrency = cryptos[0] || {id:0, code:'USDT', name:'Tether'};
                getCurrency = sellFiats[0] || {id:0, code: defaultFiat, name:'Рубль'};
                sendType = 'crypto';
            } else {
                sendCurrency = cryptos[0] || {id:0, code:'USDT', name:'Tether'};
                getCurrency = cryptos[1] || cryptos[0] || {id:0, code:'BTC', name:'Bitcoin'};
                sendType = 'crypto';
            }
            updateCurrencyLabels();
            updateExchangeFieldLabels();
            if (sendAmountEl && sendAmountEl.value) calcRate();
            else {
                if (getAmountEl) getAmountEl.value = '';
                if (rateDisplay) rateDisplay.textContent = '—';
                if (exchangeBtn) { exchangeBtn.disabled = true; exchangeBtn.textContent = 'Введите сумму'; }
            }
            webApp?.HapticFeedback?.impactOccurred('light');
        });
    });

    // KYC gate button
    var kycGateBtn = document.getElementById('kycGateBtn');
    if (kycGateBtn) {
        kycGateBtn.addEventListener('click', function() {
            // Switch to profile tab and open KYC
            tabs.forEach(function(t) { t.classList.remove('is-active'); });
            panels.forEach(function(p) { p.hidden = true; });
            var profileTab = document.querySelector('[data-tab="profile"]');
            var profilePanel = document.querySelector('[data-panel="profile"]');
            if (profileTab) profileTab.classList.add('is-active');
            if (profilePanel) profilePanel.hidden = false;
            // Trigger KYC action
            var kycAction = document.querySelector('[data-profile-action="kyc"]');
            if (kycAction) kycAction.click();
        });
    }

    function hydrateAuthenticatedUser(user) {
        if (!user || !user.id) return;
        needsEmailBind = !!user.needs_email;

        const headerSub = document.querySelector('.tma-header__brand small');
        if (headerSub) headerSub.textContent = 'обмен в Telegram';

        const profile = document.querySelector('[data-panel="profile"]');
        if (!profile) return;

        const name = user.name || user.username || 'Пользователь';
        profile.innerHTML = `
            <div class="tma-profile-header">
                <div class="tma-avatar tma-avatar--lg">${escapeHtml(String(name).charAt(0).toUpperCase() || 'U')}</div>
                <div>
                    <strong>${escapeHtml(name)}</strong>
                    <small class="tma-uid">Telegram ID: ${escapeHtml(user.telegram_id || user.id)}</small>
                </div>
            </div>

            <div class="tma-menu-group">
                <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="stats">
                    <div class="tma-menu-item__icon tma-menu-item__icon--blue"><i class="fas fa-chart-bar"></i></div>
                    <div class="tma-menu-item__body">
                        <strong>Статистика</strong>
                        <small>Пополнения, выводы, обмены</small>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </a>
                <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="kyc">
                    <div class="tma-menu-item__icon tma-menu-item__icon--green"><i class="fas fa-shield-alt"></i></div>
                    <div class="tma-menu-item__body">
                        <strong>Статус</strong>
                        <small>Пройти KYC</small>
                    </div>
                    <span class="tma-status-dot">● не начато</span>
                </a>
            </div>



            <div class="tma-menu-group">
                <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="policy">
                    <div class="tma-menu-item__icon"><i class="fas fa-file-alt"></i></div>
                    <div class="tma-menu-item__body"><strong>Условия использования</strong></div>
                    <i class="fas fa-chevron-right"></i>
                </a>
                <a class="tma-menu-item" href="javascript:void(0)" data-profile-action="privacy">
                    <div class="tma-menu-item__icon"><i class="fas fa-lock"></i></div>
                    <div class="tma-menu-item__body"><strong>Политика конфиденциальности</strong></div>
                    <i class="fas fa-chevron-right"></i>
                </a>
            </div>
        `;
        maybeShowEmailBindModal();
    }

    // ---------- Auth (auto-login via initData) ----------
    function telegramInitData() {
        if (webApp?.initData) return webApp.initData;
        const hash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
        return hash.get('tgWebAppData') || '';
    }

    const initData = telegramInitData();

    if (overlay && initData && csrf) {
        fetch(@json($telegramAuthUrl), {
            method:'POST',
            headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf,'X-Telegram-Init-Data':initData},
            body: JSON.stringify({initData}),
            credentials:'same-origin'
        })
        .then(r => { if(!r.ok) throw new Error(); return r.json(); })
        .then(d => {
            if(!d.authenticated) throw new Error();
            if (overlay) overlay.remove();
            hydrateAuthenticatedUser(d.user);
        })
        .catch(() => {
            overlay.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:32px;color:#ff6b6b"></i><strong>Telegram-вход недоступен</strong><span>Откройте Mini App из Telegram</span>';
        });
    } else if (overlay) {
        overlay.innerHTML = '<i class="fas fa-info-circle" style="font-size:32px;color:var(--accent)"></i><strong>Демо-режим</strong><span>Автовход при открытии из Telegram</span>';
        overlay.classList.add('tma-auth-overlay--inline');
    }

    const emailModal = document.getElementById('emailBindModal');
    const emailInput = document.getElementById('emailBindInput');
    const emailCodeInput = document.getElementById('emailBindCode');
    const emailSendBtn = document.getElementById('emailBindSend');
    const emailVerifyBtn = document.getElementById('emailBindVerify');
    const emailVerifyStep = document.getElementById('emailVerifyStep');
    const emailMessage = document.getElementById('emailBindMessage');

    function setEmailMessage(text, type = '') {
        if (!emailMessage) return;
        emailMessage.textContent = text || '';
        emailMessage.classList.toggle('is-error', type === 'error');
        emailMessage.classList.toggle('is-success', type === 'success');
    }

    function maybeShowEmailBindModal() {
        if (needsEmailBind && emailModal && initData) {
            emailModal.hidden = false;
        }
    }

    function closeEmailBindModal() {
        if (emailModal) emailModal.hidden = true;
    }

    ['emailBindLater', 'emailBindSkip'].forEach((id) => {
        document.getElementById(id)?.addEventListener('click', closeEmailBindModal);
    });

    emailSendBtn?.addEventListener('click', function() {
        const email = emailInput?.value?.trim();
        if (!email) {
            setEmailMessage('Введите email.', 'error');
            return;
        }
        emailSendBtn.disabled = true;
        setEmailMessage('Отправляем код...');
        fetch(apiUrls.emailSend, {
            method:'POST',
            headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf,'X-Telegram-Init-Data':initData},
            body: JSON.stringify({email, initData}),
            credentials:'same-origin'
        })
        .then(r => r.json().then(data => ({ok:r.ok, data})))
        .then(({ok, data}) => {
            if (!ok || data.status === false) throw new Error(data.message || 'Не удалось отправить код.');
            if (emailVerifyStep) emailVerifyStep.hidden = false;
            setEmailMessage(data.message || 'Код отправлен.', 'success');
        })
        .catch((error) => setEmailMessage(error.message, 'error'))
        .finally(() => { emailSendBtn.disabled = false; });
    });

    emailVerifyBtn?.addEventListener('click', function() {
        const code = emailCodeInput?.value?.trim();
        if (!code) {
            setEmailMessage('Введите код из письма.', 'error');
            return;
        }
        emailVerifyBtn.disabled = true;
        setEmailMessage('Проверяем код...');
        fetch(apiUrls.emailVerify, {
            method:'POST',
            headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf,'X-Telegram-Init-Data':initData},
            body: JSON.stringify({code, initData}),
            credentials:'same-origin'
        })
        .then(r => r.json().then(data => ({ok:r.ok, data})))
        .then(({ok, data}) => {
            if (!ok || data.status === false) throw new Error(data.message || 'Код не подошёл.');
            needsEmailBind = false;
            setEmailMessage(data.message || 'Email привязан.', 'success');
            setTimeout(closeEmailBindModal, 700);
        })
        .catch((error) => setEmailMessage(error.message, 'error'))
        .finally(() => { emailVerifyBtn.disabled = false; });
    });

    maybeShowEmailBindModal();

    // ---------- Tab navigation ----------
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle('is-active', t === tab));
            panels.forEach(p => { p.hidden = p.dataset.panel !== target; });
            webApp?.HapticFeedback?.impactOccurred('light');
        });
    });

    // ---------- Exchange calculator ----------
    const sendAmountEl = document.getElementById('sendAmount');
    const getAmountEl = document.getElementById('getAmount');
    const sendCurrLabel = document.getElementById('sendCurrencyLabel');
    const getCurrLabel = document.getElementById('getCurrencyLabel');
    const rateDisplay = document.getElementById('rateDisplay');
    const exchangeBtn = document.getElementById('exchangeBtn');
    const calcNote = document.getElementById('calcNote');

    function displayCurrencyCode(currency) {
        const raw = String(currency?.display_code || currency?.code || '').toUpperCase();
        if (raw === 'RUB') return 'Рубли';
        return raw.replace(/[_-](TRC20|ERC20|BEP20|SOL|POLYGON|AVAX|TON|ARBITRUM|OPTIMISM|BASE)$/i, '');
    }

    function isRubMethod(currency) {
        return String(currency?.code || '').toUpperCase() === 'RUB';
    }

    function isGenericRubLabel(value) {
        const normalized = String(value || '').trim().toLowerCase().replace(/[\s_\-—]+/g, ' ');
        return [
            'rub',
            'rur',
            'russian ruble',
            'russian rouble',
            'рубль',
            'рубли',
            'российский рубль',
            'российские рубли',
            'оплата рублями',
            'получение рублей',
        ].includes(normalized);
    }

    function methodTitle(currency, key, fallback) {
        const title = String(currency?.[key] || '').trim();
        return title && !isGenericRubLabel(title) ? title : fallback;
    }

    function displaySelectorTitle(currency, target) {
        if (exchangeMode === 'buy' && target === 'send' && isRubMethod(currency)) {
            return methodTitle(currency, 'buy_method_name', 'Способ оплаты');
        }
        if (exchangeMode === 'sell' && target === 'get' && isRubMethod(currency)) {
            return methodTitle(currency, 'sell_method_name', 'Способ получения');
        }
        return displayCurrencyCode(currency);
    }

    function displaySelectorSubtitle(currency, target) {
        if (exchangeMode === 'buy' && target === 'send' && isRubMethod(currency)) {
            return 'Оплата рублями';
        }
        if (exchangeMode === 'sell' && target === 'get' && isRubMethod(currency)) {
            return 'Получение рублей';
        }
        return currency?.name || '';
    }

    function displaySelectorImage(currency, target) {
        if (exchangeMode === 'buy' && target === 'send' && isRubMethod(currency)) {
            return currency.buy_method_image_path || '';
        }
        if (exchangeMode === 'sell' && target === 'get' && isRubMethod(currency)) {
            return currency.sell_method_image_path || '';
        }
        return currency?.image_path || '';
    }

    function selectorIconHtml(currency, target, small = false) {
        const title = displaySelectorTitle(currency, target);
        const image = displaySelectorImage(currency, target);
        if (image) {
            return `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">`;
        }

        if (isRubMethod(currency) && ((exchangeMode === 'buy' && target === 'send') || (exchangeMode === 'sell' && target === 'get'))) {
            return '<i class="fas fa-credit-card"></i>';
        }

        return escapeHtml(String(title).charAt(0) || '•');
    }

    function updateCurrencyLabels() {
        if (sendCurrLabel) sendCurrLabel.textContent = displaySelectorTitle(sendCurrency, 'send');
        if (getCurrLabel) getCurrLabel.textContent = displaySelectorTitle(getCurrency, 'get');
        const sendIcon = document.getElementById('sendCurrencyIcon');
        const getIcon = document.getElementById('getCurrencyIcon');
        if (sendIcon) sendIcon.innerHTML = selectorIconHtml(sendCurrency, 'send');
        if (getIcon) getIcon.innerHTML = selectorIconHtml(getCurrency, 'get');
    }

    function updateExchangeFieldLabels() {
        const sendFieldLabel = document.getElementById('sendFieldLabel');
        const getFieldLabel = document.getElementById('getFieldLabel');
        if (!sendFieldLabel || !getFieldLabel) return;
        if (exchangeMode === 'buy') {
            sendFieldLabel.textContent = 'Способ оплаты';
            getFieldLabel.textContent = 'Получаете криптовалюту';
        } else if (exchangeMode === 'sell') {
            sendFieldLabel.textContent = 'Отдаёте криптовалюту';
            getFieldLabel.textContent = 'Способ получения';
        } else {
            sendFieldLabel.textContent = 'Отдаёте криптовалюту';
            getFieldLabel.textContent = 'Получаете криптовалюту';
        }
    }
    updateCurrencyLabels();
    updateExchangeFieldLabels();

    function isFiat(code) {
        return fiats.some(f => f.code === code);
    }

    function detectMode() {
        sendType = isFiat(sendCurrency.code) ? 'fiat' : 'crypto';
    }

    function currentMode() {
        detectMode();
        if (sendType === 'fiat') return 'buy';
        return isFiat(getCurrency.code) ? 'sell' : 'exchange';
    }

    async function calcRate() {
        const amount = parseFloat(sendAmountEl?.value);
        if (!amount || amount <= 0) {
            if (getAmountEl) getAmountEl.value = '';
            if (rateDisplay) rateDisplay.textContent = '—';
            if (exchangeBtn) { exchangeBtn.disabled = true; exchangeBtn.textContent = 'Введите сумму'; }
            if (calcNote) calcNote.textContent = '';
            return;
        }

        detectMode();
        const payload = {
            mode: currentMode(),
            send_amount: amount,
            send_currency_id: sendCurrency.id,
            get_currency_id: getCurrency.id,
        };

        try {
            const res = await fetch(@json($telegramQuoteUrl), {
                method:'POST', headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':csrf},
                body: JSON.stringify(payload), credentials:'same-origin'
            });
            const data = await res.json();
            if (data.status && data.quote) {
                const q = data.quote;
                const getAmt = q.final_amount || q.get_amount || 0;
                if (getAmountEl) getAmountEl.value = parseFloat(getAmt).toFixed(6);
                const rate = q.exchange_rate || 0;
                // Show rate as 1 CRYPTO = X FIAT (inverted for buy mode)
                const mode = currentMode();
                let rateText;
                if (mode === 'buy') {
                    const invRate = rate > 0 ? (1 / rate) : 0;
                    rateText = '1 ' + displayCurrencyCode(getCurrency) + ' = ' + invRate.toFixed(2) + ' ' + displayCurrencyCode(sendCurrency);
                } else if (mode === 'sell') {
                    rateText = '1 ' + displayCurrencyCode(sendCurrency) + ' = ' + parseFloat(rate).toFixed(2) + ' ' + displayCurrencyCode(getCurrency);
                } else {
                    rateText = '1 ' + displayCurrencyCode(sendCurrency) + ' = ' + parseFloat(rate).toFixed(6) + ' ' + displayCurrencyCode(getCurrency);
                }
                if (rateDisplay) rateDisplay.textContent = rateText;
                if (exchangeBtn) { exchangeBtn.disabled = false; exchangeBtn.textContent = 'Обменять'; }
                if (calcNote) calcNote.textContent = '';
            } else {
                if (getAmountEl) getAmountEl.value = '';
                if (calcNote) calcNote.textContent = data.message || 'Невозможно рассчитать';
                if (exchangeBtn) { exchangeBtn.disabled = true; exchangeBtn.textContent = 'Введите сумму'; }
            }
        } catch(e) {
            if (calcNote) calcNote.textContent = 'Ошибка соединения';
        }
    }

    sendAmountEl?.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(calcRate, 400);
    });

    // Swap
    document.getElementById('swapBtn')?.addEventListener('click', () => {
        const tmp = sendCurrency;
        sendCurrency = getCurrency;
        getCurrency = tmp;
        updateCurrencyLabels();
        detectMode();
        if (sendAmountEl?.value) calcRate();
        webApp?.HapticFeedback?.impactOccurred('medium');
    });

    // ---------- Currency picker modal ----------
    const modal = document.getElementById('currencyModal');
    const modalList = document.getElementById('currencyList');
    const modalSearch = document.getElementById('currencySearch');
    let pickerTarget = 'send'; // 'send' or 'get'

    function openPicker(target) {
        pickerTarget = target;
        let items;
        const modalTitle = document.getElementById('currencyModalTitle');
        if (exchangeMode === 'buy') {
            items = target === 'send' ? buyFiats : cryptos;
            if (modalTitle) modalTitle.textContent = target === 'send' ? 'Выберите способ оплаты' : 'Выберите криптовалюту';
        } else if (exchangeMode === 'sell') {
            items = target === 'send' ? cryptos : sellFiats;
            if (modalTitle) modalTitle.textContent = target === 'get' ? 'Выберите способ получения' : 'Выберите криптовалюту';
        } else {
            items = cryptos;
            if (modalTitle) modalTitle.textContent = 'Выберите криптовалюту';
        }
        renderPickerItems(items);
        if (modal) modal.hidden = false;
        modalSearch.value = '';
        modalSearch.focus();
    }

    function renderPickerItems(items) {
        modalList.innerHTML = items.map(c =>
            `<button class="tma-modal__item" data-id="${Number(c.id)}" data-code="${escapeHtml(c.code)}" data-name="${escapeHtml(displaySelectorTitle(c, pickerTarget))}">
                <div class="tma-coin-icon tma-coin-icon--sm tma-coin-icon--picker" data-coin="${escapeHtml(String(c.display_code||c.code).toLowerCase())}">${selectorIconHtml(c, pickerTarget, true)}</div>
                <div><strong>${escapeHtml(displaySelectorTitle(c, pickerTarget))}</strong><small>${escapeHtml(displaySelectorSubtitle(c, pickerTarget))}</small></div>
            </button>`
        ).join('');
    }

    document.getElementById('sendCurrencyBtn')?.addEventListener('click', () => openPicker('send'));
    document.getElementById('getCurrencyBtn')?.addEventListener('click', () => openPicker('get'));
    document.getElementById('modalClose')?.addEventListener('click', () => { if(modal) modal.hidden = true; });

    modalSearch?.addEventListener('input', () => {
        const q = modalSearch.value.toLowerCase();
        modalList?.querySelectorAll('.tma-modal__item').forEach(el => {
            const match = el.dataset.code.toLowerCase().includes(q) || el.dataset.name.toLowerCase().includes(q);
            el.style.display = match ? '' : 'none';
        });
    });

    modalList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.tma-modal__item');
        if (!btn) return;
        const pool = exchangeMode === 'buy'
            ? (pickerTarget === 'send' ? buyFiats : cryptos)
            : (exchangeMode === 'sell' ? (pickerTarget === 'send' ? cryptos : sellFiats) : cryptos);
        const selected = pool.find((currency) => Number(currency.id) === Number(btn.dataset.id));
        if (!selected) return;
        if (pickerTarget === 'send') sendCurrency = selected;
        else getCurrency = selected;
        updateCurrencyLabels();
        detectMode();
        if (modal) modal.hidden = true;
        if (sendAmountEl?.value) calcRate();
        webApp?.HapticFeedback?.selectionChanged();
    });

    // ---------- Exchange submit ----------
    exchangeBtn?.addEventListener('click', async () => {
        const amount = parseFloat(sendAmountEl?.value);
        if (!amount || exchangeBtn.disabled) return;

        exchangeBtn.disabled = true;
        exchangeBtn.textContent = 'Оформляем...';

        try {
            const payload = {
                mode: currentMode(),
                send_amount: amount,
                send_currency_id: sendCurrency.id,
                get_currency_id: getCurrency.id,
                initData: initData,
            };
            const res = await fetch(@json($telegramRequestUrl), {
                method:'POST',
                headers:{'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN': csrf},
                body: JSON.stringify(payload), credentials:'same-origin'
            });
            const data = await res.json();
            if (data.status && data.trade) {
                if (calcNote) { calcNote.className = 'tma-calc__note tma-calc__note--success'; calcNote.textContent = '✓ Заявка создана! UTR: ' + data.trade.utr; }
                exchangeBtn.textContent = 'Заявка отправлена';
                webApp?.HapticFeedback?.notificationOccurred('success');
            } else {
                throw new Error(data.message || 'Ошибка');
            }
        } catch(e) {
            if (calcNote) { calcNote.className = 'tma-calc__note tma-calc__note--error'; calcNote.textContent = e.message || 'Ошибка создания заявки'; }
            exchangeBtn.disabled = false;
            exchangeBtn.textContent = 'Обменять';
            webApp?.HapticFeedback?.notificationOccurred('error');
        }
    });

    // ---------- Profile actions ----------
    function openProfileModal(title, html) {
        if (!profileModal || !profileModalTitle || !profileModalBody) return;
        profileModalTitle.textContent = title;
        profileModalBody.innerHTML = html;
        profileModal.hidden = false;
    }

    function loadingBlock(text = 'Загружаем...') {
        return `<div class="tma-empty tma-empty--compact"><i class="fas fa-spinner fa-spin"></i><p>${escapeHtml(text)}</p></div>`;
    }

    async function tmaJson(url, options = {}) {
        const headers = {
            'Accept': 'application/json',
            'X-Telegram-Init-Data': initData || '',
            ...(options.headers || {}),
        };

        if (csrf) headers['X-CSRF-TOKEN'] = csrf;

        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'same-origin',
        });

        const data = await response.json();
        if (!response.ok || data.status === false) throw new Error(data.message || 'Ошибка запроса');
        return data;
    }

    async function showStats() {
        openProfileModal('Статистика обменов', loadingBlock());
        try {
            const data = await tmaJson(apiUrls.stats, {method: 'POST', body: new URLSearchParams({initData})});
            const s = data.stats || {};
            openProfileModal('Статистика обменов', `
                <div class="tma-stats-grid">
                    <div><span>Всего заявок</span><strong>${Number(s.total || 0)}</strong></div>
                    <div><span>Завершено</span><strong>${Number(s.completed || 0)}</strong></div>
                    <div><span>В работе</span><strong>${Number(s.active || 0)}</strong></div>
                    <div><span>Отменено</span><strong>${Number(s.canceled || 0)}</strong></div>
                </div>
                <div class="tma-stats-list">
                    <p><span>Покупка криптовалюты</span><strong>${Number(s.buy || 0)}</strong></p>
                    <p><span>Продажа криптовалюты</span><strong>${Number(s.sell || 0)}</strong></p>
                    <p><span>Криптообмен</span><strong>${Number(s.exchange || 0)}</strong></p>
                </div>
            `);
        } catch (e) {
            openProfileModal('Статистика обменов', `<div class="tma-empty tma-empty--compact"><i class="fas fa-circle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`);
        }
    }

    async function showPolicy(type) {
        const title = type === 'privacy' ? 'Политика конфиденциальности' : 'Условия использования';
        openProfileModal(title, loadingBlock());
        try {
            const data = await tmaJson(apiUrls[type]);
            const text = String(data.content || '').slice(0, 5000);
            openProfileModal(data.title || title, `
                <div class="tma-doc-text">${escapeHtml(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div>
                <button class="tma-primary-btn tma-primary-btn--compact" type="button" data-close-profile>Понятно</button>
            `);
        } catch (e) {
            openProfileModal(title, `<div class="tma-empty tma-empty--compact"><i class="fas fa-circle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`);
        }
    }

    function renderKycForm(data) {
        if (data.verified) {
            return '<div class="tma-empty tma-empty--compact"><i class="fas fa-shield-check"></i><p>KYC уже пройден.</p></div>';
        }

        if (!data.kyc) {
            return '<div class="tma-empty tma-empty--compact"><i class="fas fa-shield-alt"></i><p>KYC-форма пока не настроена.</p></div>';
        }

        if (data.kyc.provider === 'didit') {
            return `
                <form class="tma-kyc-form" id="tmaKycForm">
                    <input type="hidden" name="kyc_id" value="${Number(data.kyc.id)}">
                    <div class="tma-empty tma-empty--compact">
                        <i class="fas fa-shield-alt"></i>
                        <p>Проверка личности проходит через защищённую форму Didit.</p>
                    </div>
                    <button class="tma-primary-btn" type="submit">Открыть Didit KYC</button>
                    <div class="tma-calc__note" id="kycSubmitNote"></div>
                </form>
            `;
        }

        if (data.kyc.provider !== 'manual') {
            return '<div class="tma-empty tma-empty--compact"><i class="fas fa-shield-alt"></i><p>Этот KYC-провайдер открывается через кабинет.</p></div>';
        }

        const fields = (data.kyc.fields || []).map(field => {
            const required = field.required ? 'required' : '';
            const label = `${escapeHtml(field.label)}${field.required ? ' *' : ''}`;
            if (field.type === 'textarea') {
                return `<label class="tma-form-field"><span>${label}</span><textarea name="${escapeHtml(field.key)}" rows="3" ${required}></textarea></label>`;
            }
            return `<label class="tma-form-field"><span>${label}</span><input name="${escapeHtml(field.key)}" type="${escapeHtml(field.type)}" ${required}></label>`;
        }).join('');

        return `
            <form class="tma-kyc-form" id="tmaKycForm">
                <input type="hidden" name="kyc_id" value="${Number(data.kyc.id)}">
                ${fields || '<p class="tma-doc-text">Заполните форму и отправьте заявку на проверку.</p>'}
                <button class="tma-primary-btn" type="submit">Отправить KYC</button>
                <div class="tma-calc__note" id="kycSubmitNote"></div>
            </form>
        `;
    }

    async function showKyc() {
        openProfileModal('KYC проверка', loadingBlock());
        try {
            const data = await tmaJson(apiUrls.kyc, {method: 'POST', body: new URLSearchParams({initData})});
            openProfileModal('KYC проверка', renderKycForm(data));
        } catch (e) {
            openProfileModal('KYC проверка', `<div class="tma-empty tma-empty--compact"><i class="fas fa-circle-exclamation"></i><p>${escapeHtml(e.message)}</p></div>`);
        }
    }

    document.addEventListener('click', (event) => {
        const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
        if (!action) return;
        event.preventDefault();
        webApp?.HapticFeedback?.impactOccurred('light');
        if (action === 'stats') showStats();
        if (action === 'policy' || action === 'privacy') showPolicy(action);
        if (action === 'kyc') showKyc();
    });

    profileModalClose?.addEventListener('click', () => { if (profileModal) profileModal.hidden = true; });
    profileModal?.addEventListener('click', (event) => {
        if (event.target === profileModal || event.target.closest('[data-close-profile]')) {
            profileModal.hidden = true;
        }
    });

    profileModalBody?.addEventListener('submit', async (event) => {
        if (event.target?.id !== 'tmaKycForm') return;
        event.preventDefault();
        const form = event.target;
        const note = document.getElementById('kycSubmitNote');
        const button = form.querySelector('button[type="submit"]');
        const body = new FormData(form);
        body.append('initData', initData || '');
        if (button) {
            button.disabled = true;
            button.textContent = 'Отправляем...';
        }
        try {
            const data = await tmaJson(apiUrls.kycSubmit, {method: 'POST', body});
            if (data.provider === 'didit' && data.url) {
                if (note) {
                    note.className = 'tma-calc__note tma-calc__note--success';
                    note.textContent = data.message || 'Открываем Didit...';
                }
                if (webApp?.openLink) {
                    webApp.openLink(data.url);
                } else {
                    window.location.href = data.url;
                }
                return;
            }
            if (note) {
                note.className = 'tma-calc__note tma-calc__note--success';
                note.textContent = data.message || 'KYC отправлен на проверку.';
            }
            webApp?.HapticFeedback?.notificationOccurred('success');
        } catch (e) {
            if (note) {
                note.className = 'tma-calc__note tma-calc__note--error';
                note.textContent = e.message;
            }
            if (button) {
                button.disabled = false;
                button.textContent = 'Отправить KYC';
            }
            webApp?.HapticFeedback?.notificationOccurred('error');
        }
    });

    // ---------- History toggle ----------
    document.getElementById('historyBtn')?.addEventListener('click', () => {
        const hp = document.getElementById('historyPanel');
        if (hp) hp.hidden = !hp.hidden;
    });
    document.getElementById('historyClose')?.addEventListener('click', () => {
        const hp = document.getElementById('historyPanel');
        if (hp) hp.hidden = true;
    });
})();
</script>
</body>
</html>
