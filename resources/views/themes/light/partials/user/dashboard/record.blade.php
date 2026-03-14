<div class="col-12 d-none d-lg-block">
    <h5 class="mb-10 mt-4"> @lang('Exchange Crypto Statistics')</h5>
    <div class="row g-4">

        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-custom-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-spinner"></i>@lang('Pending Exchange')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"><span class="pendingExchange"></span>
                        <sub><small>@lang('from') <span
                                    class="totalExchange"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysPendingPercentage"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-blue-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-check"></i>@lang('Complete Exchange')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"><span class="completeExchange"></span>
                        <sub><small>@lang('from') <span
                                    class="totalExchange"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysCompletePercentage"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-green-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fa-exclamation-triangle"></i>@lang('Cancel Exchange')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"><span class="cancelExchange"></span>
                        <sub><small>@lang('from') <span
                                    class="totalExchange"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth down"><i
                                class="fa-light fa-chart-line-down"></i><span
                                class="last30DaysCancelPercentage"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card strong-orange-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-undo-alt"></i>@lang('Refund Exchange')</h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"><span class="refundExchange"></span>
                        <sub><small>@lang('from') <span
                                    class="totalExchange"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysRefundPercentage"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="col-12 d-none d-lg-block mt-30">
    <h5 class="mb-10"> @lang('Buy Crypto Statistics')</h5>
    <div class="row g-4">
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card strong-orange-card  exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-spinner"></i>@lang('Pending Buy')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"><span class="pendingBuy"></span>
                        <sub><small>@lang('from') <span
                                    class="totalBuy"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysPendingPercentageBuy"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-green-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-check"></i>@lang('Complete Buy')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="completeBuy"></span>
                        <sub><small>@lang('from') <span
                                    class="totalBuy"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysCompletePercentageBuy"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-blue-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fa-exclamation-triangle"></i>@lang('Cancel Buy')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="cancelBuy"></span>
                        <sub><small>@lang('from') <span
                                    class="totalBuy"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth down"><i
                                class="fa-light fa-chart-line-down"></i><span
                                class="last30DaysCancelPercentageBuy"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-custom-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-undo-alt"></i>@lang('Refund Buy')</h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="refundBuy"></span>
                        <sub><small>@lang('from') <span
                                    class="totalBuy"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysRefundPercentageBuy"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="col-12 d-none d-lg-block mt-30">
    <h5 class="mb-10"> @lang('Sell Crypto Statistics')</h5>
    <div class="row g-4">
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-custom-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-spinner"></i>@lang('Pending Sell')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="pendingSell"></span>
                        <sub><small>@lang('from') <span
                                    class="totalSell"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysPendingPercentageSell"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-blue-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-check"></i>@lang('Complete Sell')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="completeSell"></span>
                        <sub><small>@lang('from') <span
                                    class="totalSell"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysCompletePercentageSell"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card strong-orange-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fa-exclamation-triangle"></i>@lang('Cancel Sell')
                    </h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="cancelSell"></span>
                        <sub><small>@lang('from') <span
                                    class="totalSell"></span></small></sub>
                    </h4>
                    <div class="statistics">
                        <p class="growth down"><i
                                class="fa-light fa-chart-line-down"></i><span class="last30DaysCancelPercentageSell"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
        <div class="col-xxl-3 col-sm-6 box-item">
            <div class="box-card grayish-green-card exchangeRecord">
                <div class="box-card-header">
                    <h5 class="box-card-title"><i
                            class="fa-light fas fa-undo-alt"></i>@lang('Refund Sell')</h5>
                </div>
                <div class="box-card-body">
                    <h4 class="mb-0"> <span class="refundSell"></span>
                        <sub><small>@lang('from') <span
                                    class="totalSell"></span>
                            </small></sub></h4>
                    <div class="statistics">
                        <p class="growth"><i
                                class="fa-light fa-chart-line-up"></i><span
                                class="last30DaysRefundPercentageSell"></span>
                            %</p>
                        <div class="time">@lang('last 30 days')</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
@push('extra_scripts')
    <script>
        'use strict';
        Notiflix.Block.standard('.exchangeRecord', {
            backgroundColor: loaderColor,
        });

        axios.get("{{route('user.getRecords')}}")
            .then(function (res) {
                $('.totalExchange').text(res.data.totalExchange);
                $('.pendingExchange').text(res.data.pendingExchange);
                $('.last30DaysPendingPercentage').text(res.data.last30DaysPendingPercentage);
                $('.completeExchange').text(res.data.completeExchange);
                $('.last30DaysCompletePercentage').text(res.data.last30DaysCompletePercentage);
                $('.cancelExchange').text(res.data.cancelExchange);
                $('.last30DaysCancelPercentage').text(res.data.last30DaysCancelPercentage);
                $('.refundExchange').text(res.data.refundExchange);
                $('.last30DaysRefundPercentage').text(res.data.last30DaysRefundPercentage);
                $('.totalBuy').text(res.data.totalBuy);
                $('.pendingBuy').text(res.data.pendingBuy);
                $('.last30DaysPendingPercentageBuy').text(res.data.last30DaysPendingPercentageBuy);
                $('.completeBuy').text(res.data.completeBuy);
                $('.last30DaysCompletePercentageBuy').text(res.data.last30DaysCompletePercentageBuy);
                $('.cancelBuy').text(res.data.cancelBuy);
                $('.last30DaysCancelPercentageBuy').text(res.data.last30DaysCancelPercentageBuy);
                $('.refundBuy').text(res.data.refundBuy);
                $('.last30DaysRefundPercentageBuy').text(res.data.last30DaysRefundPercentageBuy);
                $('.totalSell').text(res.data.totalSell);
                $('.pendingSell').text(res.data.pendingSell);
                $('.last30DaysPendingPercentageSell').text(res.data.last30DaysPendingPercentageSell);
                $('.completeSell').text(res.data.completeSell);
                $('.last30DaysCompletePercentageSell').text(res.data.last30DaysCompletePercentageSell);
                $('.cancelSell').text(res.data.cancelSell);
                $('.last30DaysCancelPercentageSell').text(res.data.last30DaysCancelPercentageSell);
                $('.refundSell').text(res.data.refundSell);
                $('.last30DaysRefundPercentageSell').text(res.data.last30DaysRefundPercentageSell);

                Notiflix.Block.remove('.exchangeRecord');
            })
            .catch(function (error) {

            });
    </script>
@endpush
