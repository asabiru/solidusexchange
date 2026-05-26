<div class="sc-calculator-compact">
    <div class="row" id="showLoader">
        <div class="col-12">
            <!-- SEND -->
            <div class="sc-compact-input-box" id="inputAmountBox">
                <div class="swap-label-row">
                    <label class="sc-compact-label">@lang('You send')</label>
                    <span class="swap-reserve">Доступно к обмену: <span id="sendReserve">0.00</span> <span id="sendCurrency">BTC</span></span>
                </div>
                <div class="sc-compact-input-wrapper">
                    <div class="sc-currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal">
                        <div class="currency-icon">
                            <img class="img-flag" id="showSendImage" src="" alt="...">
                        </div>
                        <div class="currency-info">
                            <span class="currency-symbol" id="showSendCode">BTC</span>
                        </div>
                        <i class="fa-regular fa-angle-down selector-arrow"></i>
                    </div>
                    <input type="text" name="exchangeSendAmount" id="send" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                    <input type="hidden" name="exchangeSendCurrency" value="">
                </div>
                <div class="sc-error-message" id="exchangeMessage"></div>
            </div>

            <!-- FLIP -->
            <div class="sc-compact-swap">
                <div class="sc-swap-icon" id="swapBtn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <polyline points="19 12 12 19 5 12"></polyline>
                    </svg>
                </div>
            </div>

            <!-- RECEIVE -->
            <div class="sc-compact-input-box" id="inputAmountBox2">
                <label class="sc-compact-label">@lang("You get")</label>
                <div class="sc-compact-input-wrapper">
                    <div class="sc-currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal2">
                        <div class="currency-icon">
                            <img class="img-flag" id="showGetImage" src="" alt="...">
                        </div>
                        <div class="currency-info">
                            <span class="currency-symbol" id="showGetCode">ETH</span>
                        </div>
                        <i class="fa-regular fa-angle-down selector-arrow"></i>
                    </div>
                    <input type="text" name="exchangeGetAmount" id="receive" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" readonly required>
                    <input type="hidden" name="exchangeGetCurrency" value="">
                </div>
            </div>
        </div>
    </div>

    <!-- Rate & Fees Info -->
    <div class="sc-compact-info">
        <div class="info-row">
            <span class="info-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                К получению
            </span>
            <span class="info-value">
                <span id="finalReceive">0.00</span> <span id="receiveCurrency">ETH</span>
            </span>
        </div>
    </div>

    <!-- Features -->
    <div class="sc-compact-features">
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

    <div class="sc-compact-btn">
        <button type="submit" class="sc-exchange-btn w-100" id="submitBtn">@lang("Exchange now")</button>
    </div>
</div>