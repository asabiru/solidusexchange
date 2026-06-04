<script>
    Notiflix.Block.dots('#showLoader', {
        backgroundColor: loaderColor,
    });

    getExchangeCurrency();
    var activeTab = "exchange";
    var activeSendCurrency = "";
    var activeGetCurrency = "";
    var availableSendCurrencies = [];
    var availableGetCurrencies = [];
    var pendingTabSwap = null;
    var exchangeQuoteTimer = null;
    var currentQuote = null;

    $(document).on("keyup", "input[name='exchangeSendAmount']", function () {
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val());
    });

    $(document).on("change", "select[name='exchangeSendCurrency']", function () {
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
    });

    $(document).on("keyup", "input[name='exchangeGetAmount']", function () {
        return;
    });

    $(document).on("change", "select[name='exchangeGetCurrency']", function () {
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
    });

    $(document).on("click", "#swapBtn", function () {
        $("#swapBtn").toggleClass("flipped");
        if (!activeSendCurrency || !activeGetCurrency) {
            return;
        }

        let currentSendAmount = $("input[name='exchangeSendAmount']").val();
        let currentGetAmount = $("input[name='exchangeGetAmount']").val();
        let swappedSendAmount = currentGetAmount || currentSendAmount;

        if (activeTab === 'exchange') {
            let previousSendCurrency = activeSendCurrency;
            activeSendCurrency = activeGetCurrency;
            activeGetCurrency = previousSendCurrency;

            setSendCurrency(activeSendCurrency);
            setGetCurrency(activeGetCurrency);
            showSend(availableSendCurrencies);
            showGet(availableGetCurrencies);

            $("input[name='exchangeSendAmount']").val(formatSendAmount(swappedSendAmount));
            requestQuoteDebounced(swappedSendAmount, 0);
            return;
        }

        pendingTabSwap = {
            sendCurrencyId: activeGetCurrency.id,
            getCurrencyId: activeSendCurrency.id,
            sendAmount: swappedSendAmount,
        };

        if (activeTab === 'buy') {
            $('#pills-Sell-tab').trigger('click');
            return;
        }

        if (activeTab === 'sell') {
            $('#pills-Buy-tab').trigger('click');
        }
    });

    $(document).on("click", ".crypto-button[data-send-currency-id], .exchange-link[data-send-currency-id]", function () {
        const preferredCurrencyId = $(this).data('send-currency-id');

        if (!preferredCurrencyId) {
            return;
        }

        pendingTabSwap = null;
        activeTab = 'exchange';
        $("#submitFormId").attr("action", "{{ route('exchangeRequest', [], false) }}");
        $("#exchangeType").val("exchange");
        $("#formTitle").text("Обмен криптовалют");
        $("#submitBtn").text("Обменять");
        $("#sendLabel").text("Вы отправляете (криптовалюта)");
        $("#receiveLabel").text("Вы получаете (криптовалюта)");
        $(".tab-button").removeClass("active");
        $('.tab-button[data-tab="exchange"]').addClass("active");

        getExchangeCurrency("{{ route('getExchangeCurrency', [], false) }}", preferredCurrencyId);
    });

    $(document).on("click", ".sendModal", function () {
        activeSendCurrency = $(this).data('res');
        if (!isCurrencySelectable('send', activeSendCurrency)) {
            return;
        }
        setSendCurrency(activeSendCurrency);
        $('input[name="payment_method"]').val(activeSendCurrency.gateway_id || '');
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
        $('#calculator-modal').modal('hide');

        $('.sendModal .right-side').empty();
        $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
    });

    $(document).on("click", ".getModal", function () {
        activeGetCurrency = $(this).data('res');
        if (!isCurrencySelectable('get', activeGetCurrency)) {
            return;
        }
        setGetCurrency(activeGetCurrency);
        $('input[name="payment_method"]').val(activeGetCurrency.gateway_id || '');
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
        $('#calculator-modal2').modal('hide');

        $('.getModal .right-side').empty();
        $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
    });

    function getExchangeCurrency(route = "{{ route('getExchangeCurrency', [], false) }}", preferredSendCurrencyId = null, preferredGetCurrencyId = null, preferredSendAmount = null) {
        axios.get(route)
            .then(function (response) {
                Notiflix.Block.remove('#showLoader');
                availableSendCurrencies = response.data.sendCurrencies;
                availableGetCurrencies = response.data.getCurrencies;
                updateSelectorModalTitles();
                activeSendCurrency = getPreferredCurrency(availableSendCurrencies, preferredSendCurrencyId, response.data.selectedSendCurrency);
                activeGetCurrency = getPreferredCurrency(availableGetCurrencies, preferredGetCurrencyId, response.data.selectedGetCurrency);
                setSendCurrency(activeSendCurrency);
                setGetCurrency(activeGetCurrency);
                showSend(availableSendCurrencies);
                showGet(availableGetCurrencies);

                let initialAmount = preferredSendAmount !== null && preferredSendAmount !== undefined
                    ? preferredSendAmount
                    : 0;
                $("input[name='exchangeGetAmount']").prop('readonly', activeTab === 'exchange');

                if (parseFloat(initialAmount || 0) > 0) {
                    $("input[name='exchangeSendAmount']").val(formatSendAmount(initialAmount));
                    requestQuoteDebounced(initialAmount, 0);
                    return;
                }

                currentQuote = null;
                $("input[name='exchangeSendAmount']").val('0');
                $("input[name='exchangeGetAmount']").val('0');
                $("#exchangeMessage").text('');
                $("#submitBtn").attr('disabled', true);
            })
            .catch(function (error) {
                Notiflix.Block.remove('#showLoader');
                $("#exchangeMessage").text(error.response?.data?.message || 'Unable to load exchange methods');
                $("#submitBtn").attr('disabled', true);
            });
    }

    function getCalculation(sendAmount) {
        $("#exchangeMessage").text('');
        $("#submitBtn").attr('disabled', false);

        if (!sendAmount || parseFloat(sendAmount) <= 0) {
            $("input[name='exchangeGetAmount']").val('0');
            currentQuote = null;
            $("#submitBtn").attr('disabled', true);
            return;
        }

        let sendMinLimit = activeSendCurrency.min_send;
        let sendMaxLimit = activeSendCurrency.max_send;
        let sendCode = activeSendCurrency.code;

        if (parseFloat(sendAmount) < parseFloat(sendMinLimit)) {
            $("#submitBtn").attr('disabled', true);
            $("#exchangeMessage").text(`Min is ${sendMinLimit} ${sendCode}`);
            return;
        }

        if (parseFloat(sendAmount) > parseFloat(sendMaxLimit)) {
            $("#submitBtn").attr('disabled', true);
            $("#exchangeMessage").text(`Max is ${sendMaxLimit} ${sendCode}`);
            return;
        }

        requestQuote(sendAmount);
    }

    function requestQuoteDebounced(sendAmount, delay = 250) {
        clearTimeout(exchangeQuoteTimer);
        exchangeQuoteTimer = setTimeout(function () {
            getCalculation(sendAmount);
        }, delay);
    }


    function displayCurrencyCode(currency) {
        const code = String(currency?.code || currency?.display_code || '').toUpperCase();
        return code === 'RUB' ? 'Рубли' : code;
    }

    function isRubMethod(currency) {
        return String(currency?.code || '').toUpperCase() === 'RUB';
    }

    function displaySelectorTitle(currency, side) {
        if (activeTab === 'buy' && side === 'send' && isRubMethod(currency)) {
            return currency.buy_method_name || currency.name || 'Способ оплаты';
        }
        if (activeTab === 'sell' && side === 'get' && isRubMethod(currency)) {
            return currency.sell_method_name || currency.name || 'Способ получения';
        }
        return displayCurrencyCode(currency);
    }

    function displaySelectorSubtitle(currency, side) {
        if (activeTab === 'buy' && side === 'send' && isRubMethod(currency)) {
            return 'Оплата рублями';
        }
        if (activeTab === 'sell' && side === 'get' && isRubMethod(currency)) {
            return 'Получение рублей';
        }
        return currency?.name || '';
    }

    function displaySelectorImage(currency, side) {
        if (activeTab === 'buy' && side === 'send' && isRubMethod(currency)) {
            return currency.buy_method_image_path || currency.image_path || currency.image;
        }
        if (activeTab === 'sell' && side === 'get' && isRubMethod(currency)) {
            return currency.sell_method_image_path || currency.image_path || currency.image;
        }
        return currency?.image_path || currency?.image;
    }

    function updateSelectorModalTitles() {
        $('#calculator-modal .modal-title').text(activeTab === 'buy' ? 'Выберите способ оплаты' : 'Выберите валюту');
        $('#calculator-modal2 .modal-title').text(activeTab === 'sell' ? 'Выберите способ получения' : 'Выберите валюту');
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

    function requestQuote(sendAmount) {
        const routeMap = {
            exchange: "{{ route('exchangeAutoRate', [], false) }}",
            buy: "{{ route('buyAutoRate', [], false) }}",
            sell: "{{ route('sellAutoRate', [], false) }}",
        };

        const payload = {
            sendAmount: sendAmount,
            sendCurrency: activeSendCurrency.id,
            getCurrency: activeGetCurrency.id,
        };
        if (activeSendCurrency && activeSendCurrency.gateway_id) {
            payload.sendGatewayId = activeSendCurrency.gateway_id;
        }
        if (activeGetCurrency && activeGetCurrency.gateway_id) {
            payload.getGatewayId = activeGetCurrency.gateway_id;
        }
        axios.post(routeMap[activeTab], payload)
            .then(function (response) {
                applyQuote(response.data.quote);
            })
            .catch(function (error) {
                $("#submitBtn").attr('disabled', true);
                $("#exchangeMessage").text(error.response?.data?.message || 'Unable to refresh exchange rate');
            });
    }

    function applyQuote(quote) {
        currentQuote = quote;
        $("#exchangeMessage").text('');
        $("#submitBtn").attr('disabled', false);
        $("input[name='exchangeSendAmount']").val(formatSendAmount(quote.sendAmount));
        $("input[name='exchangeGetAmount']").val(formatReceiveAmount(quote.finalAmount));
        $("input[name='exchangeGetAmount']").prop('readonly', activeTab === 'exchange' && !!quote.receiveReadonly);

        const finalReceive = document.getElementById('finalReceive');
        const receiveCurrency = document.getElementById('receiveCurrency');
        if (finalReceive) {
            finalReceive.textContent = formatReceiveAmount(quote.finalAmount);
        }
        if (receiveCurrency) {
            const code = activeGetCurrency ? (activeGetCurrency.code || '') : '';
            receiveCurrency.textContent = code;
        }
    }

    function showSend(currencies) {
        $('#show-send').html(``);
        let options = "";
        for (let i = 0; i < currencies.length; i++) {
            if (!isCurrencySelectable('send', currencies[i])) {
                continue;
            }
            let isChecked = (activeSendCurrency && currencies[i].id === activeSendCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            let networkBadge = getNetworkBadgeLabel(currencies[i].code);
            options += `<div class="item sendModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${displaySelectorImage(currencies[i], 'send')}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${displaySelectorTitle(currencies[i], 'send')}</div>
                                ${networkBadge ? `<div class="network-badge"><span class="currency-network-badge">${networkBadge}</span></div>` : ''}
                                <div class="sub-title">${displaySelectorSubtitle(currencies[i], 'send')}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
        }
        $('#show-send').append(options);
    }

    function showGet(currencies) {
        $('#show-get').html(``);
        let options = "";
        for (let i = 0; i < currencies.length; i++) {
            if (!isCurrencySelectable('get', currencies[i])) {
                continue;
            }
            let isChecked = (activeGetCurrency && currencies[i].id === activeGetCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            let networkBadge = getNetworkBadgeLabel(currencies[i].code);
            options += `<div class="item getModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${displaySelectorImage(currencies[i], 'get')}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${displaySelectorTitle(currencies[i], 'get')}</div>
                                ${networkBadge ? `<div class="network-badge"><span class="currency-network-badge">${networkBadge}</span></div>` : ''}
                                <div class="sub-title">${displaySelectorSubtitle(currencies[i], 'get')}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
        }
        $('#show-get').append(options);
    }

    function setSendCurrency(currency) {
        $('#showSendImage').attr('src', displaySelectorImage(currency, 'send'));
        $('#showSendCode').text(displaySelectorTitle(currency, 'send'));
        const sendNetwork = document.getElementById('showSendNetwork');
        if (sendNetwork) {
            const badge = getNetworkBadgeLabel(currency.code);
            sendNetwork.textContent = badge;
            sendNetwork.style.display = badge ? 'inline-flex' : 'none';
        }
        $('#showSendName').text(displaySelectorSubtitle(currency, 'send'));
        $('input[name="exchangeSendCurrency"]').val(currency.id);
    }

    function setGetCurrency(currency) {
        $('#showGetImage').attr('src', displaySelectorImage(currency, 'get'));
        $('#showGetCode').text(displaySelectorTitle(currency, 'get'));
        const getNetwork = document.getElementById('showGetNetwork');
        if (getNetwork) {
            const badge = getNetworkBadgeLabel(currency.code);
            getNetwork.textContent = badge;
            getNetwork.style.display = badge ? 'inline-flex' : 'none';
        }
        $('#showGetName').text(displaySelectorSubtitle(currency, 'get'));
        $('input[name="exchangeGetCurrency"]').val(currency.id);
    }

    function isCurrencySelectable(side, currency) {
        if (activeTab !== 'exchange' || !currency) {
            return true;
        }

        if (side === 'send' && activeGetCurrency) {
            if (Number(currency.id) !== Number(activeGetCurrency.id)) {
                return true;
            }
            return Number(currency.gateway_id || 0) !== Number(activeGetCurrency.gateway_id || 0);
        }

        if (side === 'get' && activeSendCurrency) {
            if (Number(currency.id) !== Number(activeSendCurrency.id)) {
                return true;
            }
            return Number(currency.gateway_id || 0) !== Number(activeSendCurrency.gateway_id || 0);
        }

        return true;
    }

    $(document).on("click", "#pills-exchange-tab", function () {
        activateCalculatorTab('exchange', "{{ route('getExchangeCurrency', [], false) }}", "{{ route('exchangeRequest', [], false) }}", "Exchange Now");
    });

    $(document).on("click", "#pills-Buy-tab", function () {
        activateCalculatorTab('buy', "{{ route('getBuyCurrency', [], false) }}", "{{ route('buyRequest', [], false) }}", "Buy Now");
    });

    $(document).on("click", "#pills-Sell-tab", function () {
        activateCalculatorTab('sell', "{{ route('getSellCurrency', [], false) }}", "{{ route('sellRequest', [], false) }}", "Sell Now");
    });

    function activateCalculatorTab(tabName, route, formSubmitRoute, buttonText) {
        Notiflix.Block.dots('#showLoader', {
            backgroundColor: loaderColor,
        });

        $("#submitFormId").attr("action", formSubmitRoute);
        activeTab = tabName;
        currentQuote = null;

        let preferredSelection = pendingTabSwap;
        pendingTabSwap = null;

        getExchangeCurrency(
            route,
            preferredSelection ? preferredSelection.sendCurrencyId : null,
            preferredSelection ? preferredSelection.getCurrencyId : null,
            preferredSelection ? preferredSelection.sendAmount : null
        );
        $("#submitBtn").text(buttonText);
        updateSelectorModalTitles();
    }

    function getPreferredCurrency(currencies, preferredId, fallbackCurrency = null) {
        let preferredCurrency = currencies.find(currency => Number(currency.id) === Number(preferredId));
        return preferredCurrency || fallbackCurrency || currencies[0] || null;
    }

    function formatSendAmount(amount) {
        let numericAmount = parseFloat(amount);
        if (Number.isNaN(numericAmount) || numericAmount <= 0) {
            return '0';
        }

        return activeTab === 'buy' ? numericAmount.toFixed(2) : numericAmount.toFixed(8);
    }

    function formatReceiveAmount(amount) {
        let numericAmount = parseFloat(amount);
        if (Number.isNaN(numericAmount) || numericAmount <= 0) {
            return '0';
        }

        return activeTab === 'sell' ? numericAmount.toFixed(2) : numericAmount.toFixed(8);
    }

    $(document).ready(function () {
        $('.autoplay').slick({
            slidesToShow: 1,
            slidesToScroll: 1,
            fade: true,
            autoplay: true,
            arrows: false,
            autoplaySpeed: 2000,
        });
    });

    $(document).on("click", ".announceClass", function () {
        let announceBodyShow = $('#announceBodyShow');
        announceBodyShow.html('');
        let heading = $(this).data('heading');
        let des = $(this).data('des');
        announceBodyShow.html(`<h4>${heading}</h4> ${des}`)
    });

</script>
