<div class="sc-calculator-compact">
    <div class="row" id="showLoader">
        <div class="col-12">
            <div class="sc-compact-input-box" id="inputAmountBox">
                <label class="sc-compact-label">@lang('You send')</label>
                <div class="sc-compact-input-wrapper">
                    <div class="sc-currency-select" data-bs-toggle="modal" data-bs-target="#calculator-modal">
                        <img class="img-flag" id="showSendImage" src="" alt="...">
                        <span id="showSendCode"></span>
                        <i class="fa-regular fa-angle-down"></i>
                    </div>
                    <input type="text" name="exchangeSendAmount" id="send" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                    <input type="hidden" name="exchangeSendCurrency" value="">
                </div>
                <div class="sc-error-message" id="exchangeMessage"></div>
            </div>

            <div class="sc-compact-swap">
                <div class="sc-swap-icon" id="swapBtn">
                    <i class="fa-regular fa-arrow-up-arrow-down"></i>
                </div>
            </div>
        </div>

        <div class="col-12">
            <div class="sc-compact-input-box" id="inputAmountBox2">
                <label class="sc-compact-label">@lang("You get")</label>
                <div class="sc-compact-input-wrapper">
                    <div class="sc-currency-select" data-bs-toggle="modal" data-bs-target="#calculator-modal2">
                        <img class="img-flag" id="showGetImage" src="" alt="...">
                        <span id="showGetCode"></span>
                        <i class="fa-regular fa-angle-down"></i>
                    </div>
                    <input type="text" name="exchangeGetAmount" id="receive" placeholder="0.00" onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" readonly required>
                    <input type="hidden" name="exchangeGetCurrency" value="">
                </div>
            </div>
        </div>
    </div>

    <div class="sc-compact-features">
        <span><i class="fa-regular fa-bolt"></i>@lang('Быстро')</span>
        <span><i class="fa-regular fa-shield-check"></i>@lang('Безопасно')</span>
        <span><i class="fa-regular fa-headset"></i>@lang('Поддержка')</span>
    </div>

    <div class="sc-compact-btn">
        <button type="submit" class="sc-exchange-btn w-100" id="submitBtn">@lang("Exchange now")</button>
    </div>
</div>

