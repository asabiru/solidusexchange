@php
    $announces = \App\Models\CoinAnnounce::where('status',1)->get();
@endphp

<!-- Hero Section - eazy228/design style -->
<section class="hero-section" id="exchange">
    <div class="hero-grid"></div>
    <div class="container">
        <div class="row align-items-center">
            <!-- Left Content -->
            <div class="col-lg-6">
                <div class="hero-content">
                    <div class="hero-badge">
                        <span class="badge-text">Среднее время обмена ~7 минут</span>
                    </div>
                    <h1 class="hero-title">
                        Обмен криптовалют<br>
                        <span class="highlight">без скрытых комиссий</span>
                    </h1>
                    <p class="hero-description">
                        Прозрачные курсы, открытые резервы и понятные условия. Видите итог до того, как нажмёте «Обменять» — без сюрпризов.
                    </p>
                    <div class="hero-bullets">
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                </svg>
                            </div>
                            <span>Резервы on-chain</span>
                        </div>
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                            </div>
                            <span>AML-проверка Chainalysis</span>
                        </div>
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
                                </svg>
                            </div>
                            <span>Поддержка 24/7</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Content - SwapCard -->
            <div class="col-lg-6">
                <div class="swap-card">
                    <!-- Modern Tabs -->
                    <div class="modern-tabs">
                        <button class="tab-button active" data-tab="exchange">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="17 1 21 5 12 5 12 5"></polyline>
                                <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"></path>
                            </svg>
                            <span>Обмен</span>
                        </button>
                        <button class="tab-button" data-tab="buy">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4-1 1-5.5-5.5a2.121 2.121 0 0 1 3-3"></path>
                            </svg>
                            <span>Купить</span>
                        </button>
                        <button class="tab-button" data-tab="sell">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6"></path>
                                <path d="M9 9l3 3-3 3"></path>
                                <path d="M9 15h6"></path>
                            </svg>
                            <span>Продать</span>
                        </button>
                    </div>

                    <!-- Announcements Banner -->
                    @if(count($announces)>0)
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

                        <!-- Card Header -->
                        <div class="swap-card-header">
                            <div class="swap-card-title">
                                <h3>Обмен криптовалют</h3>
                                <span class="update-time">Курс обновлён 12 c назад</span>
                            </div>
                        </div>

                        <!-- Send Section -->
                        <div class="swap-section">
                            <div class="swap-label">Вы отправляете</div>
                            <div class="swap-reserve">Доступно к обмену: <span id="sendReserve">0.00</span> <span id="sendCurrency"></span></div>
                            <div class="swap-input-wrapper">
                                <div class="currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal">
                                    <div class="currency-icon">
                                        <img class="img-flag" id="showSendImage" src="" alt="...">
                                    </div>
                                    <div class="currency-info">
                                        <span class="currency-symbol" id="showSendCode"></span>
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
                            <div class="swap-label">Вы получаете</div>
                            <div class="swap-input-wrapper">
                                <div class="currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal2">
                                    <div class="currency-icon">
                                        <img class="img-flag" id="showGetImage" src="" alt="...">
                                    </div>
                                    <div class="currency-info">
                                        <span class="currency-symbol" id="showGetCode"></span>
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
            </div>
        </div>
    </div>
</section>

@include($theme.'partials.modal')

<script>
// Tab switching functionality
document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-button');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tab = this.getAttribute('data-tab');

            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));

            // Add active class to clicked button
            this.classList.add('active');

            // Here you can add logic to switch between different forms
            // For example, change the form action based on tab
            if (tab === 'exchange') {
                document.getElementById('submitFormId').action = "{{ route('exchangeRequest', [], false) }}";
            } else if (tab === 'buy') {
                document.getElementById('submitFormId').action = "{{ route('buyRequest', [], false) }}";
            } else if (tab === 'sell') {
                document.getElementById('submitFormId').action = "{{ route('sellRequest', [], false) }}";
            }
        });
    });
});

// Динамическое обновление валют в Hero секции
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