<div class="sc-calculator-meta">
    <span>@lang('Быстрый обмен')</span>
    <span><i class="fa-regular fa-clock"></i>@lang('Курс обновляется онлайн')</span>
</div>

<div class="row" id="showLoader">
    <div class="col-12">
        <div class="sc-input-amount-box" id="inputAmountBox">
            <div class="sc-input-amount-wrapper">
                <div class="sc-input-header">
                    <label class="sc-form-label">@lang('You send')</label>
                    <div class="sc-currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal">
                        <div class="sc-currency-icon">
                            <img class="img-flag" id="showSendImage" src="" alt="...">
                        </div>
                        <div class="sc-currency-info">
                            <div class="sc-currency-code" id="showSendCode"></div>
                            <div class="sc-currency-name" id="showSendName"></div>
                        </div>
                        <i class="fa-regular fa-angle-down sc-dropdown-icon"></i>
                    </div>
                </div>
                <div class="sc-input-body">
                    <input type="text" name="exchangeSendAmount" id="send" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                    <input type="hidden" name="exchangeSendCurrency" value="">
                    <div class="sc-error-message" id="exchangeMessage"></div>
                </div>
            </div>
        </div>

        <div class="sc-swap-area">
            <div class="sc-swap-button" id="swapBtn">
                <div class="sc-swap-icon">
                    <i class="fa-regular fa-arrow-up-arrow-down"></i>
                </div>
            </div>
        </div>
    </div>

    <div class="col-12">
        <div class="sc-input-amount-box" id="inputAmountBox2">
            <div class="sc-input-amount-wrapper">
                <div class="sc-input-header">
                    <label class="sc-form-label">@lang("You get")</label>
                    <div class="sc-currency-selector" data-bs-toggle="modal" data-bs-target="#calculator-modal2">
                        <div class="sc-currency-icon">
                            <img class="img-flag" id="showGetImage" src="" alt="...">
                        </div>
                        <div class="sc-currency-info">
                            <div class="sc-currency-code" id="showGetCode"></div>
                            <div class="sc-currency-name" id="showGetName"></div>
                        </div>
                        <i class="fa-regular fa-angle-down sc-dropdown-icon"></i>
                    </div>
                </div>
                <div class="sc-input-body">
                    <input type="text" name="exchangeGetAmount" id="receive" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" readonly required>
                    <input type="hidden" name="exchangeGetCurrency" value="">
                </div>
            </div>
        </div>
    </div>

    <div class="sc-fast-checklist">
        <div class="sc-checklist-item">
            <i class="fa-regular fa-bolt"></i>
            <span>@lang('Заявка за 1 минуту')</span>
        </div>
        <div class="sc-checklist-item">
            <i class="fa-regular fa-shield-check"></i>
            <span>@lang('AML-проверка')</span>
        </div>
        <div class="sc-checklist-item">
            <i class="fa-regular fa-message"></i>
            <span>@lang('Поддержка в Telegram')</span>
        </div>
    </div>

    <div class="sc-btn-area">
        <button type="submit" class="sc-exchange-btn w-100" id="submitBtn">@lang("Начать обмен")</button>
    </div>
</div>

