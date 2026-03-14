<div class="row" id="showLoader">
    <div class="col-12">
        <div class="input-amount-box" id="inputAmountBox">
            <span class="linear-gradient"></span>
            <div class="input-amount-wrapper">
                <label class="form-label mb-2">@lang('You send')</label>
                <div class="input-amount-box-inner"
                     id="inputAmountBoxInner">
                    <a href="#" class="icon-area" data-bs-toggle="modal"
                       data-bs-target="#calculator-modal">
                        <img class="img-flag" id="showSendImage"
                             src=""
                             alt="...">
                    </a>
                    <div class="text-area w-100">
                        <div
                            class="d-flex gap-3 justify-content-between">
                            <a href="#"
                               class="d-flex align-items-center gap-1"
                               data-bs-toggle="modal"
                               data-bs-target="#calculator-modal">
                                <div class="title" id="showSendCode"></div>
                                <i class="fa-regular fa-angle-down"></i>
                            </a>
                            <input type="text"
                                   name="exchangeSendAmount" id="send" placeholder="@lang('You send')"
                                   onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                            <input type="hidden" name="exchangeSendCurrency" value="">
                        </div>
                        <div class="d-flex justify-content-between">
                            <div class="sub-title" id="showSendName"></div>
                            <div class="fw-500 text-danger" id="exchangeMessage"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="swap-area">
            <div class="swap-icon" id="swapBtn">
                <i class="fa-regular fa-arrow-up-arrow-down"></i>
            </div>
        </div>

    </div>
    <div class="col-12">
        <div class="input-amount-box" id="inputAmountBox2">
            <span class="linear-gradient"></span>
            <div class="input-amount-wrapper">
                <label class="form-label mb-2">@lang("You get")</label>
                <div class="input-amount-box-inner"
                     id="inputAmountBoxInner2">
                    <a href="#" class="icon-area" data-bs-toggle="modal"
                       data-bs-target="#calculator-modal2">
                        <img class="img-flag" id="showGetImage"
                             src=""
                             alt="...">
                    </a>
                    <div class="text-area w-100">
                        <div
                            class="d-flex gap-3 justify-content-between">
                            <a href="#"
                               class="d-flex align-items-center gap-1"
                               data-bs-toggle="modal"
                               data-bs-target="#calculator-modal2">
                                <div class="title" id="showGetCode"></div>
                                <i class="fa-regular fa-angle-down"></i>
                            </a>
                            <input type="text"
                                   name="exchangeGetAmount" id="receive" placeholder="@lang('You get')"
                                   onkeyup="this.value = this.value.replace (/^\.|[^\d\.]/g, '')" required>
                            <input type="hidden" name="exchangeGetCurrency" value="">
                        </div>
                        <div class="d-flex justify-content-between">
                            <div class="sub-title" id="showGetName"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="btn-area">
        <button type="submit" class="cmn-btn w-100" id="submitBtn">@lang("Exchange now")</button>
    </div>
</div>

