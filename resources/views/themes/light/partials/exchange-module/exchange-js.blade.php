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

    $(document).on("click", ".sendModal", function () {
        activeSendCurrency = findCurrencyById(availableSendCurrencies, $(this).data('currency-id'));
        if (!activeSendCurrency || !isCurrencySelectable('send', activeSendCurrency)) {
            return;
        }
        setSendCurrency(activeSendCurrency);
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
        $('#calculator-modal').modal('hide');

        $('.sendModal .right-side').empty();
        $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
    });

    $(document).on("click", ".getModal", function () {
        activeGetCurrency = findCurrencyById(availableGetCurrencies, $(this).data('currency-id'));
        if (!activeGetCurrency || !isCurrencySelectable('get', activeGetCurrency)) {
            return;
        }
        setGetCurrency(activeGetCurrency);
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
                $("#exchangeMessage").text(error.response?.data?.message || 'Не удалось загрузить направления обмена');
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
            $("#exchangeMessage").text(`Минимум ${sendMinLimit} ${sendCode}`);
            return;
        }

        if (parseFloat(sendAmount) > parseFloat(sendMaxLimit)) {
            $("#submitBtn").attr('disabled', true);
            $("#exchangeMessage").text(`Максимум ${sendMaxLimit} ${sendCode}`);
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

    function requestQuote(sendAmount) {
        const routeMap = {
            exchange: "{{ route('exchangeAutoRate', [], false) }}",
            buy: "{{ route('buyAutoRate', [], false) }}",
            sell: "{{ route('sellAutoRate', [], false) }}",
        };

        axios.post(routeMap[activeTab], {
            sendAmount: sendAmount,
            sendCurrency: activeSendCurrency.id,
            getCurrency: activeGetCurrency.id,
        })
            .then(function (response) {
                applyQuote(response.data.quote);
            })
            .catch(function (error) {
                $("#submitBtn").attr('disabled', true);
                $("#exchangeMessage").text(error.response?.data?.message || 'Не удалось обновить курс');
            });
    }

    function applyQuote(quote) {
        currentQuote = quote;
        $("#exchangeMessage").text('');
        $("#submitBtn").attr('disabled', false);
        $("input[name='exchangeSendAmount']").val(formatSendAmount(quote.sendAmount));
        $("input[name='exchangeGetAmount']").val(formatReceiveAmount(quote.finalAmount));
        $("input[name='exchangeGetAmount']").prop('readonly', activeTab === 'exchange' && !!quote.receiveReadonly);
    }

    function showSend(currencies) {
        $('#show-send').empty();
        let options = "";
        for (let i = 0; i < currencies.length; i++) {
            if (!isCurrencySelectable('send', currencies[i])) {
                continue;
            }
            let isChecked = (activeSendCurrency && currencies[i].id === activeSendCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            options += `<div class="item sendModal" data-currency-id="${Number(currencies[i].id)}">
                        <div class="left-side">
                            <div class="img-area">
                                <span class="sc-currency-badge">${currencyBadge(currencies[i])}</span>
                            </div>
                            <div class="text-area">
                                <div class="title">${escapeHtml(currencies[i].code)}</div>
                                <div class="sub-title">${escapeHtml(currencies[i].name)}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
        }
        $('#show-send').append(options);
    }

    function showGet(currencies) {
        $('#show-get').empty();
        let options = "";
        for (let i = 0; i < currencies.length; i++) {
            if (!isCurrencySelectable('get', currencies[i])) {
                continue;
            }
            let isChecked = (activeGetCurrency && currencies[i].id === activeGetCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            options += `<div class="item getModal" data-currency-id="${Number(currencies[i].id)}">
                        <div class="left-side">
                            <div class="img-area">
                                <span class="sc-currency-badge">${currencyBadge(currencies[i])}</span>
                            </div>
                            <div class="text-area">
                                <div class="title">${escapeHtml(currencies[i].code)}</div>
                                <div class="sub-title">${escapeHtml(currencies[i].name)}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
        }
        $('#show-get').append(options);
    }

    function setSendCurrency(currency) {
        $('#showSendIcon').text(currencyBadge(currency));
        $('#showSendCode').text(currency.code);
        $('#showSendName').text(currency.name);
        $('input[name="exchangeSendCurrency"]').val(currency.id);
    }

    function setGetCurrency(currency) {
        $('#showGetIcon').text(currencyBadge(currency));
        $('#showGetCode').text(currency.code);
        $('#showGetName').text(currency.name);
        $('input[name="exchangeGetCurrency"]').val(currency.id);
    }

    function isCurrencySelectable(side, currency) {
        if (activeTab !== 'exchange' || !currency) {
            return true;
        }

        if (side === 'send' && activeGetCurrency) {
            return Number(currency.id) !== Number(activeGetCurrency.id);
        }

        if (side === 'get' && activeSendCurrency) {
            return Number(currency.id) !== Number(activeSendCurrency.id);
        }

        return true;
    }

    $(document).on("click", "#pills-exchange-tab", function () {
        activateCalculatorTab('exchange', "{{ route('getExchangeCurrency', [], false) }}", "{{ route('exchangeRequest', [], false) }}", "Обменять");
    });

    $(document).on("click", "#pills-Buy-tab", function () {
        activateCalculatorTab('buy', "{{ route('getBuyCurrency', [], false) }}", "{{ route('buyRequest', [], false) }}", "Купить");
    });

    $(document).on("click", "#pills-Sell-tab", function () {
        activateCalculatorTab('sell', "{{ route('getSellCurrency', [], false) }}", "{{ route('sellRequest', [], false) }}", "Продать");
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
    }

    function getPreferredCurrency(currencies, preferredId, fallbackCurrency = null) {
        let preferredCurrency = currencies.find(currency => Number(currency.id) === Number(preferredId));
        return preferredCurrency || fallbackCurrency || currencies[0] || null;
    }

    function findCurrencyById(currencies, id) {
        return currencies.find(currency => Number(currency.id) === Number(id)) || null;
    }

    function escapeHtml(value) {
        return $('<div>').text(value ?? '').html();
    }

    function currencyBadge(currency) {
        const code = String(currency?.code || currency?.symbol || '--').replace(/[^A-Za-z0-9]/g, '');
        return escapeHtml((code || '--').slice(0, 2).toUpperCase());
    }

    function plainText(value) {
        return new DOMParser().parseFromString(String(value || ''), 'text/html').body.textContent || '';
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
        announceBodyShow.empty();
        let heading = $(this).data('heading');
        let des = $(this).data('des');
        $('<h4>').text(heading || '').appendTo(announceBodyShow);
        $('<div>').text(plainText(des)).appendTo(announceBodyShow);
    });

</script>
