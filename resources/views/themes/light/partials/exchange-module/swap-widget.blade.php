@php
    $announces = \App\Models\CoinAnnounce::where('status', 1)->get();
@endphp

<div class="swap-card">
    <!-- Modern Tabs -->
    <div class="modern-tabs exchange-method-tabs">
        <button class="tab-button active" data-tab="exchange">
            <span class="method-icon"><i class="fa-solid fa-repeat"></i></span>
            <span class="method-text"><strong>Крипта ↔ крипта</strong><small>обмен монет</small></span>
        </button>
        <button class="tab-button" data-tab="buy">
            <span class="method-icon"><i class="fa-solid fa-ruble-sign"></i></span>
            <span class="method-text"><strong>Купить за RUB</strong><small>рубли → крипта</small></span>
        </button>
        <button class="tab-button" data-tab="sell">
            <span class="method-icon"><i class="fa-solid fa-wallet"></i></span>
            <span class="method-text"><strong>Продать в RUB</strong><small>крипта → рубли</small></span>
        </button>
    </div>

    <!-- Announcements Banner -->
    @if(count($announces) > 0)
    <div class="autoplay" data-bs-toggle="modal" data-bs-target="#exampleModal">
        @foreach($announces as $announce)
        <div class="calculator-banner announceClass"
             data-heading="{{$announce->heading}}"
             data-des="{!! $announce->description !!}">
            <div class="calculator-banner-wrapper">
                <div class="left-side">
                    <div class="image-area">
                        <img src="{{getFile($announce->driver,$announce->image)}}" alt="...">
                    </div>
                    <div class="text-area">
                        <span class="banner-kicker">Горячее предложение</span>
                        <p class="fw-bold mb-0">@lang(\Illuminate\Support\Str::limit($announce->heading,55))</p>
                    </div>
                </div>
                <div class="right-side">
                    <i class="fa-regular fa-angle-right"></i>
                </div>
            </div>
        </div>
        @endforeach
    </div>
    @endif

    <!-- Swap Card Form -->
    <form class="swap-form" action="{{ route('exchangeRequest', [], false) }}" method="POST" id="submitFormId">
        @csrf
        <input type="hidden" name="exchangeType" id="exchangeType" value="exchange">

        <!-- Card Header -->
        <div class="swap-card-header">
            <div class="swap-card-title">
                <h3 id="formTitle">Обмен криптовалют</h3>
                <span class="update-time">Курс обновляется автоматически</span>
            </div>
        </div>

        <!-- Send Section -->
        <div class="swap-section">
            <div class="swap-label" id="sendLabel">Вы отправляете (криптовалюта)</div>
            <div class="swap-reserve">Доступно к обмену: <span id="sendReserve">0.00</span> <span id="sendCurrency"></span></div>
            <div class="swap-input-wrapper">
                <div class="currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal">
                    <div class="currency-icon">
                        <img class="img-flag" id="showSendImage" src="" alt="...">
                    </div>
                    <div class="currency-info">
                        <span class="currency-symbol" id="showSendCode"></span>
                        <span class="currency-network-badge" id="showSendNetwork"></span>
                    </div>
                    <i class="fa-regular fa-angle-down selector-arrow"></i>
                </div>
                <input type="text"
                       name="exchangeSendAmount"
                       id="send"
                       placeholder="0.00"
                       onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')"
                       required>
                <input type="hidden" name="exchangeSendCurrency" value="">
            </div>
            <div class="swap-error-message" id="exchangeMessage"></div>
        </div>

        <!-- Swap Button -->
        <div class="swap-action">
            <button type="button" class="swap-button" id="swapBtn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <polyline points="19 12 12 19 5 12"></polyline>
                </svg>
            </button>
        </div>

        <!-- Receive Section -->
        <div class="swap-section">
            <div class="swap-label" id="receiveLabel">Вы получаете (криптовалюта)</div>
            <div class="swap-input-wrapper">
                <div class="currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal2">
                    <div class="currency-icon">
                        <img class="img-flag" id="showGetImage" src="" alt="...">
                    </div>
                    <div class="currency-info">
                        <span class="currency-symbol" id="showGetCode"></span>
                        <span class="currency-network-badge" id="showGetNetwork"></span>
                    </div>
                    <i class="fa-regular fa-angle-down selector-arrow"></i>
                </div>
                <input type="text"
                       name="exchangeGetAmount"
                       id="receive"
                       placeholder="0.00"
                       readonly
                       required>
                <input type="hidden" name="exchangeGetCurrency" value="">
            </div>
        </div>

        <!-- Rate & Fees Info -->
        <div class="swap-info">
            <div class="info-row">
                <span class="info-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    К получению
                </span>
                <span class="info-value">
                    <span id="finalReceive">0.00</span> <span id="receiveCurrency"></span>
                </span>
            </div>
        </div>

        <!-- Submit Button -->
        <div class="swap-submit">
            <button type="submit" class="submit-button" id="submitBtn">
                Обменять
            </button>
        </div>

        <!-- Features -->
        <div class="swap-features">
            <div class="feature-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                AML-проверка
            </div>
            <div class="feature-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ~7 минут
            </div>
            <div class="feature-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                Лицензия
            </div>
        </div>
    </form>
</div>

@include($theme.'partials.modal')

<script>
// Tab switching functionality
document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-button');
    let currentMode = 'exchange';

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tab = this.getAttribute('data-tab');
            currentMode = tab;

            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));

            // Add active class to clicked button
            this.classList.add('active');

            // Update form action and hidden field
            const form = document.getElementById('submitFormId');
            const exchangeTypeField = document.getElementById('exchangeType');
            const formTitle = document.getElementById('formTitle');
            const submitBtn = document.getElementById('submitBtn');

            if (tab === 'exchange') {
                form.action = "{{ route('exchangeRequest', [], false) }}";
                exchangeTypeField.value = 'exchange';
                formTitle.textContent = 'Обмен криптовалют';
                submitBtn.textContent = 'Обменять';
                document.getElementById('sendLabel').textContent = 'Вы отправляете (криптовалюта)';
                document.getElementById('receiveLabel').textContent = 'Вы получаете (криптовалюта)';
                loadExchangeCurrencies();
            } else if (tab === 'buy') {
                form.action = "{{ route('publicBuyRequest', [], false) }}";
                exchangeTypeField.value = 'buy';
                formTitle.textContent = 'Купить криптовалюту';
                submitBtn.textContent = 'Купить';
                document.getElementById('sendLabel').textContent = 'Вы отправляете (фиат)';
                document.getElementById('receiveLabel').textContent = 'Вы получаете (криптовалюта)';
                loadBuyCurrencies();
            } else if (tab === 'sell') {
                form.action = "{{ route('publicSellRequest', [], false) }}";
                exchangeTypeField.value = 'sell';
                formTitle.textContent = 'Продать криптовалюту';
                submitBtn.textContent = 'Продать';
                document.getElementById('sendLabel').textContent = 'Вы отправляете (криптовалюта)';
                document.getElementById('receiveLabel').textContent = 'Вы получаете (фиат)';
                loadSellCurrencies();
            }
        });
    });

    // Load initial exchange currencies
    loadExchangeCurrencies();
});

// Load currencies for exchange mode (crypto -> crypto)
function loadExchangeCurrencies() {
    if (typeof activeTab !== 'undefined') {
        activeTab = 'exchange';
    }

    if (typeof getExchangeCurrency === 'function') {
        getExchangeCurrency("{{ route('getExchangeCurrency', [], false) }}");
    }
}

// Load currencies for buy mode (fiat -> crypto)
function loadBuyCurrencies() {
    if (typeof activeTab !== 'undefined') {
        activeTab = 'buy';
    }

    if (typeof getExchangeCurrency === 'function') {
        getExchangeCurrency("{{ route('getBuyCurrency', [], false) }}");
    }
}

// Load currencies for sell mode (crypto -> fiat)
function loadSellCurrencies() {
    if (typeof activeTab !== 'undefined') {
        activeTab = 'sell';
    }

    if (typeof getExchangeCurrency === 'function') {
        getExchangeCurrency("{{ route('getSellCurrency', [], false) }}");
    }
}

function displayHeroCurrencyCode(currency) {
    const code = String(currency?.code || currency?.display_code || '').toUpperCase();
    return code === 'RUB' ? 'Рубли' : code;
}

function getNetworkBadgeLabel(code) {
    if (!code || code.indexOf('_') === -1) {
        return '';
    }

    const suffix = code.split('_').pop().toUpperCase();
    const aliases = {
        ERC20: 'ERC20',
        TRC20: 'TRC20',
        BSC: 'BSC',
        SOL: 'SOL',
        ARB: 'ARB',
        BASE: 'BASE',
        OPT: 'OPT',
        TON: 'TON',
    };

    return aliases[suffix] || suffix;
}

// Update send currency selector
function updateSendCurrencySelector(currencies, selected) {
    const modal = document.querySelector('#calculator-modal .modal-body');
    if (!modal || !currencies || currencies.length === 0) return;

    let html = '<div class="currency-list">';
    currencies.forEach(currency => {
        const isSelected = selected && selected.id === currency.id ? 'active' : '';
        const networkBadge = getNetworkBadgeLabel(currency.code);
        html += `
            <div class="item sendModal ${isSelected}" data-res='${JSON.stringify(currency)}'>
                <div class="left-side">
                    <div class="img-area">
                        <img class="img-flag" src="${currency.image_path || currency.image}" alt="${currency.code}">
                    </div>
                    <div class="text-area">
                        <div class="title">${displayHeroCurrencyCode(currency)}</div>
                        ${networkBadge ? `<div class="network-badge"><span class="currency-network-badge">${networkBadge}</span></div>` : ''}
                        <div class="sub-title">${currency.name}</div>
                    </div>
                </div>
                <div class="right-side"></div>
            </div>
        `;
    });
    html += '</div>';

    // Update modal content
    const currencyList = modal.querySelector('.currency-list');
    if (currencyList) {
        currencyList.innerHTML = html;
    }

    // Update selected currency display
    if (selected) {
        document.getElementById('showSendImage').src = selected.image_path || selected.image;
        document.getElementById('showSendCode').textContent = displayHeroCurrencyCode(selected);
        const sendNetwork = document.getElementById('showSendNetwork');
        if (sendNetwork) {
            const badge = getNetworkBadgeLabel(selected.code);
            sendNetwork.textContent = badge;
            sendNetwork.style.display = badge ? 'inline-flex' : 'none';
        }
        document.querySelector('input[name="exchangeSendCurrency"]').value = selected.id;
    }
}

// Update get currency selector
function updateGetCurrencySelector(currencies, selected) {
    const modal = document.querySelector('#calculator-modal2 .modal-body');
    if (!modal || !currencies || currencies.length === 0) return;

    let html = '<div class="currency-list">';
    currencies.forEach(currency => {
        const isSelected = selected && selected.id === currency.id ? 'active' : '';
        const networkBadge = getNetworkBadgeLabel(currency.code);
        html += `
            <div class="item getModal ${isSelected}" data-res='${JSON.stringify(currency)}'>
                <div class="left-side">
                    <div class="img-area">
                        <img class="img-flag" src="${currency.image_path || currency.image}" alt="${currency.code}">
                    </div>
                    <div class="text-area">
                        <div class="title">${displayHeroCurrencyCode(currency)}</div>
                        ${networkBadge ? `<div class="network-badge"><span class="currency-network-badge">${networkBadge}</span></div>` : ''}
                        <div class="sub-title">${currency.name}</div>
                    </div>
                </div>
                <div class="right-side"></div>
            </div>
        `;
    });
    html += '</div>';

    // Update modal content
    const currencyList = modal.querySelector('.currency-list');
    if (currencyList) {
        currencyList.innerHTML = html;
    }

    // Update selected currency display
    if (selected) {
        document.getElementById('showGetImage').src = selected.image_path || selected.image;
        document.getElementById('showGetCode').textContent = displayHeroCurrencyCode(selected);
        const getNetwork = document.getElementById('showGetNetwork');
        if (getNetwork) {
            const badge = getNetworkBadgeLabel(selected.code);
            getNetwork.textContent = badge;
            getNetwork.style.display = badge ? 'inline-flex' : 'none';
        }
        document.querySelector('input[name="exchangeGetCurrency"]').value = selected.id;
    }
}

// Динамическое обновление валют
function updateHeroCurrencyLabels() {
    const sendCode = document.querySelector('#showSendCode');
    const getCode = document.querySelector('#showGetCode');
    const sendCurrency = document.querySelector('#sendCurrency');
    const receiveCurrency = document.querySelector('#receiveCurrency');

    if (sendCode && sendCurrency) {
        sendCurrency.textContent = sendCode.textContent || '';
    }
    if (getCode && receiveCurrency) {
        receiveCurrency.textContent = getCode.textContent || '';
    }
}

// Наблюдение за изменениями
document.addEventListener('DOMContentLoaded', function() {
    updateHeroCurrencyLabels();

    // Наблюдаем за изменениями в селекторах валют
    const observer = new MutationObserver(function(mutations) {
        updateHeroCurrencyLabels();
    });

    const sendCodeEl = document.querySelector('#showSendCode');
    const getCodeEl = document.querySelector('#showGetCode');

    if (sendCodeEl) {
        observer.observe(sendCodeEl, { childList: true, characterData: true, subtree: true });
    }
    if (getCodeEl) {
        observer.observe(getCodeEl, { childList: true, characterData: true, subtree: true });
    }
});
</script>
