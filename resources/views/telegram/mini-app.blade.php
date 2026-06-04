@php
    $user = $user ?? auth()->user();
    $rateCards = collect($rateCards ?? []);
    $cryptos = $cryptoCurrencies ?? collect();
    $fiats = $fiatCurrencies ?? collect();
    $defaultFiat = $defaultFiatCode ?? 'RUB';
    $telegramAuthUrl = \Illuminate\Support\Facades\Route::has('telegram.miniapp.login')
        ? route('telegram.miniapp.login')
        : (\Illuminate\Support\Facades\Route::has('telegram.mini-app') ? route('telegram.mini-app') : url('/telegram/mini-app'));
    $telegramQuoteUrl = route('telegram.mini-app.quote');
    $telegramRequestUrl = route('telegram.mini-app.request');

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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
            <div class="tma-logo">S</div>
            <div>
                <strong>SolidChange</strong>
                @if($user)
                    <small>UID {{ $user->id }}</small>
                @else
                    <small>обмен в Telegram</small>
                @endif
            </div>
        </div>
        @if($user)
            <button class="tma-badge tma-badge--auto" data-theme-toggle>
                <i class="fas fa-globe"></i> <span id="themeLabel">Авто</span>
            </button>
        @endif
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
                        <small>{{ $rc['name'] }}</small>
                    </div>
                </div>
                <div class="tma-rate-row__prices">
                    <div><span class="tma-label">Покупка</span><span class="tma-value tma-value--buy">{{ number_format($rc['buy_rate'],2,'.',' ') }} ₽</span></div>
                    <div><span class="tma-label">Продажа</span><span class="tma-value tma-value--sell">{{ number_format($rc['sell_rate'],2,'.',' ') }} ₽</span></div>
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
                    <small>UID {{ $user->id }}</small>
                </div>
            </div>
            <button class="tma-badge" id="historyBtn"><i class="fas fa-history"></i> История</button>
        </div>
        @endif

        <div class="tma-calc">
            <div class="tma-calc__field">
                <label>Вы отдаёте</label>
                <div class="tma-calc__input-row">
                    <input type="number" id="sendAmount" placeholder="0" min="0" step="any" inputmode="decimal">
                    <button class="tma-currency-btn" id="sendCurrencyBtn" data-type="send">
                        <span id="sendCurrencyLabel">{{ $defaultFiat }}</span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
            </div>

            <button class="tma-swap-btn" id="swapBtn" type="button">
                <i class="fas fa-arrow-down"></i><i class="fas fa-arrow-up"></i>
            </button>

            <div class="tma-calc__field">
                <label>Вы получаете</label>
                <div class="tma-calc__input-row">
                    <input type="number" id="getAmount" placeholder="0" readonly>
                    <button class="tma-currency-btn" id="getCurrencyBtn" data-type="get">
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
                <small class="tma-uid">UID {{ $user->id }}</small>
            </div>
        </div>

        <div class="tma-menu-group">
            <a class="tma-menu-item" href="javascript:void(0)" id="statsBtn">
                <div class="tma-menu-item__icon tma-menu-item__icon--blue"><i class="fas fa-chart-bar"></i></div>
                <div class="tma-menu-item__body">
                    <strong>Статистика</strong>
                    <small>Пополнения, выводы, обмены</small>
                </div>
                <i class="fas fa-chevron-right"></i>
            </a>
            <a class="tma-menu-item" href="javascript:void(0)" id="kycBtn">
                <div class="tma-menu-item__icon tma-menu-item__icon--green"><i class="fas fa-shield-alt"></i></div>
                <div class="tma-menu-item__body">
                    <strong>Статус</strong>
                    <small>Пройти KYC</small>
                </div>
                <span class="tma-status-dot">● {{ $user->identity_verify ? 'пройден' : 'не начато' }}</span>
            </a>
        </div>

        <div class="tma-menu-group">
            <button class="tma-menu-item" data-theme-toggle>
                <div class="tma-menu-item__icon tma-menu-item__icon--accent"><i class="fas fa-moon"></i></div>
                <div class="tma-menu-item__body">
                    <strong>Тема</strong>
                    <small id="themeLabel2">Авто</small>
                </div>
                <i class="fas fa-sync-alt"></i>
            </button>
        </div>

        <div class="tma-menu-group">
            <a class="tma-menu-item" href="javascript:void(0)">
                <div class="tma-menu-item__icon"><i class="fas fa-file-alt"></i></div>
                <div class="tma-menu-item__body"><strong>Условия использования</strong></div>
                <i class="fas fa-chevron-right"></i>
            </a>
            <a class="tma-menu-item" href="javascript:void(0)">
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
            <h3>Выберите валюту</h3>
            <button class="tma-modal__close" id="modalClose"><i class="fas fa-times"></i></button>
        </div>
        <input class="tma-modal__search" id="currencySearch" placeholder="Поиск..." type="text">
        <div class="tma-modal__list" id="currencyList"></div>
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

    // ---------- Currency data from server ----------
    const cryptos = @json($cryptosJson);
    const fiats = @json($fiatsJson);
    const defaultFiat = @json($defaultFiat);

    // ---------- Exchange state ----------
    let sendType = 'fiat';   // fiat→crypto = buy, crypto→fiat = sell
    let sendCurrency = fiats[0] || {id:0, code: defaultFiat, name:'Рубль'};
    let getCurrency = cryptos[0] || {id:0, code:'USDT', name:'Tether'};
    let debounceTimer = null;

    // ---------- Theme ----------
    const themes = ['auto','light','dark'];
    let themeIdx = 0;
    function applyTheme() {
        const t = themes[themeIdx];
        const resolved = t === 'auto' ? (webApp?.colorScheme || 'dark') : t;
        body.dataset.theme = resolved;
        const labels = {auto:'Авто', light:'Светлая', dark:'Тёмная'};
        const el1 = document.getElementById('themeLabel');
        const el2 = document.getElementById('themeLabel2');
        if (el1) el1.textContent = labels[t];
        if (el2) el2.textContent = labels[t];
    }
    applyTheme();
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', () => { themeIdx = (themeIdx+1) % 3; applyTheme(); webApp?.HapticFeedback?.impactOccurred('light'); });
    });

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
        .then(d => { if(d.authenticated) window.location.reload(); else throw new Error(); })
        .catch(() => {
            overlay.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:32px;color:#ff6b6b"></i><strong>Telegram-вход недоступен</strong><span>Откройте Mini App из Telegram</span>';
        });
    } else if (overlay) {
        overlay.innerHTML = '<i class="fas fa-info-circle" style="font-size:32px;color:var(--accent)"></i><strong>Демо-режим</strong><span>Автовход при открытии из Telegram</span>';
        overlay.classList.add('tma-auth-overlay--inline');
    }

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

    function updateCurrencyLabels() {
        if (sendCurrLabel) sendCurrLabel.textContent = sendCurrency.display_code || sendCurrency.code;
        if (getCurrLabel) getCurrLabel.textContent = getCurrency.display_code || getCurrency.code;
    }
    updateCurrencyLabels();

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
                if (rateDisplay) rateDisplay.textContent = '1 ' + (sendCurrency.display_code||sendCurrency.code) + ' = ' + parseFloat(rate).toFixed(6) + ' ' + (getCurrency.display_code||getCurrency.code);
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
        const items = target === 'send'
            ? (sendType === 'fiat' ? fiats : [...fiats, ...cryptos])
            : (sendType === 'fiat' ? cryptos : [...cryptos, ...fiats]);
        renderPickerItems(items);
        if (modal) modal.hidden = false;
        modalSearch.value = '';
        modalSearch.focus();
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        })[char]);
    }

    function renderPickerItems(items) {
        modalList.innerHTML = items.map(c =>
            `<button class="tma-modal__item" data-id="${Number(c.id)}" data-code="${escapeHtml(c.code)}" data-display="${escapeHtml(c.display_code||c.code)}" data-name="${escapeHtml(c.name)}" data-img="${escapeHtml(c.image_path||'')}">
                <div class="tma-coin-icon tma-coin-icon--sm" data-coin="${escapeHtml(String(c.display_code||c.code).toLowerCase())}">${c.image_path ? `<img src="${escapeHtml(c.image_path)}" alt="${escapeHtml(c.display_code||c.code)}">` : escapeHtml(String(c.display_code||c.code).charAt(0))}</div>
                <div><strong>${escapeHtml(c.display_code||c.code)}</strong><small>${escapeHtml(c.name)}</small></div>
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
        const selected = {id: parseInt(btn.dataset.id), code: btn.dataset.code, display_code: btn.dataset.display || btn.dataset.code, name: btn.dataset.name, image_path: btn.dataset.img || ''};
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
