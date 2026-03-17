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
        if (activeTab === 'exchange' && $("input[name='exchangeGetAmount']").prop('readonly')) {
            return;
        }

        if (!currentQuote || !currentQuote.exchangeRate || parseFloat(currentQuote.exchangeRate) <= 0) {
            return;
        }

        let getAmount = parseFloat($("input[name='exchangeGetAmount']").val() || 0);
        let sendAmount = getAmount / parseFloat(currentQuote.exchangeRate);
        $("input[name='exchangeSendAmount']").val(sendAmount);
        requestQuoteDebounced(sendAmount, 0);
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
        activeSendCurrency = $(this).data('res');
        setSendCurrency(activeSendCurrency);
        requestQuoteDebounced($("input[name='exchangeSendAmount']").val(), 0);
        $('#calculator-modal').modal('hide');

        $('.sendModal .right-side').empty();
        $(this).find('.right-side').html('<i class="fa-sharp fa-solid fa-circle-check"></i>');
    });

    $(document).on("click", ".getModal", function () {
        activeGetCurrency = $(this).data('res');
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
                    : response.data.initialSendAmount;
                $("input[name='exchangeSendAmount']").val(formatSendAmount(initialAmount));
                $("input[name='exchangeGetAmount']").prop('readonly', activeTab === 'exchange');
                requestQuoteDebounced(initialAmount, 0);
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
            $("input[name='exchangeGetAmount']").val('');
            currentQuote = null;
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
                $("#exchangeMessage").text(error.response?.data?.message || 'Unable to refresh exchange rate');
            });
    }

    function applyQuote(quote) {
        currentQuote = quote;
        $("#exchangeMessage").text('');
        $("#submitBtn").attr('disabled', false);
        $("input[name='exchangeSendAmount']").val(formatSendAmount(quote.sendAmount));
        $("input[name='exchangeGetAmount']").val(formatReceiveAmount(quote.getAmount));
        $("input[name='exchangeGetAmount']").prop('readonly', activeTab === 'exchange' && !!quote.receiveReadonly);
    }

    function showSend(currencies) {
        $('#show-send').html(``);
        let options = "";
        for (let i = 0; i < currencies.length; i++) {
            let isChecked = (activeSendCurrency && currencies[i].id === activeSendCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            options += `<div class="item sendModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${currencies[i].image_path}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${currencies[i].code}</div>
                                <div class="sub-title">${currencies[i].name}</div>
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
            let isChecked = (activeGetCurrency && currencies[i].id === activeGetCurrency.id) ? '<i class="fa-sharp fa-solid fa-circle-check"></i>' : '';
            options += `<div class="item getModal" data-res='${JSON.stringify(currencies[i])}'>
                        <div class="left-side">
                            <div class="img-area">
                                <img class="img-flag" src="${currencies[i].image_path}" alt="...">
                            </div>
                            <div class="text-area">
                                <div class="title">${currencies[i].code}</div>
                                <div class="sub-title">${currencies[i].name}</div>
                            </div>
                        </div>
                        <div class="right-side">${isChecked}</div>
                    </div>`;
        }
        $('#show-get').append(options);
    }

    function setSendCurrency(currency) {
        $('#showSendImage').attr('src', currency.image_path);
        $('#showSendCode').text(currency.code);
        $('#showSendName').text(currency.name);
        $('input[name="exchangeSendCurrency"]').val(currency.id);
    }

    function setGetCurrency(currency) {
        $('#showGetImage').attr('src', currency.image_path);
        $('#showGetCode').text(currency.code);
        $('#showGetName').text(currency.name);
        $('input[name="exchangeGetCurrency"]').val(currency.id);
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
    }

    function getPreferredCurrency(currencies, preferredId, fallbackCurrency = null) {
        let preferredCurrency = currencies.find(currency => Number(currency.id) === Number(preferredId));
        return preferredCurrency || fallbackCurrency || currencies[0] || null;
    }

    function formatSendAmount(amount) {
        let numericAmount = parseFloat(amount);
        if (Number.isNaN(numericAmount)) {
            return '';
        }

        return activeTab === 'buy' ? numericAmount.toFixed(2) : numericAmount.toFixed(8);
    }

    function formatReceiveAmount(amount) {
        let numericAmount = parseFloat(amount);
        if (Number.isNaN(numericAmount)) {
            return '';
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
