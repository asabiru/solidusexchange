<div class="card mb-3 mb-lg-5">
    <div class="row col-lg-divider">
        <div class="col-lg-4" id="exchangeRecord">
            <div class="card-body">
                <h4>@lang('Total Crypto Exchange')
                </h4>
                <div class="row align-items-sm-center mt-4 mt-sm-0 mb-5">
                    <div class="col-sm mb-3 mb-sm-0">
                        <span class="display-5 text-dark me-2 totalExchangeCount"></span>
                    </div>
                </div>
                <div class="chartjs-custom mb-4 bar-chart-height">
                    <canvas class="" id="chartExchangeRecordsGraph">
                    </canvas>
                </div>
                <div class="row justify-content-center">
                    <div class="col-auto">
                        <span class="legend-indicator"></span> @lang('Yesterday')
                    </div>
                    <div class="col-auto">
                        <span class="legend-indicator bg-primary"></span> @lang('Today')
                    </div>
                </div>
            </div>
        </div>

        <div class="col-lg-4" id="buyRecord">
            <div class="card-body">
                <h4>@lang('Total Crypto Buy')</h4>

                <div class="row align-items-sm-center mt-4 mt-sm-0 mb-5">
                    <div class="col-sm mb-3 mb-sm-0">
                        <span class="display-5 text-dark me-2 totalBuyCount"></span>
                    </div>
                </div>
                <div class="chartjs-custom mb-4 bar-chart-height">
                    <canvas class="" id="chartBuyRecordsGraph">
                    </canvas>
                </div>
                <div class="row justify-content-center">
                    <div class="col-auto">
                        <span class="legend-indicator"></span> @lang('Yesterday')
                    </div>
                    <div class="col-auto">
                        <span class="legend-indicator bg-primary"></span> @lang('Today')
                    </div>
                </div>
            </div>
        </div>
        <div class="col-lg-4" id="sellRecord">
            <div class="card-body">
                <h4>@lang('Total Crypto Sell')</h4>

                <div class="row align-items-sm-center mt-4 mt-sm-0 mb-5">
                    <div class="col-sm mb-3 mb-sm-0">
                        <span class="display-5 text-dark me-2 totalSellCount"></span>
                    </div>
                </div>
                <div class="chartjs-custom mb-4 bar-chart-height">
                    <canvas class="" id="chartSellRecordsGraph">
                    </canvas>
                </div>
                <div class="row justify-content-center">
                    <div class="col-auto">
                        <span class="legend-indicator"></span> @lang('Yesterday')
                    </div>
                    <div class="col-auto">
                        <span class="legend-indicator bg-primary"></span> @lang('Today')
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

@push('script')
    <script>
        Notiflix.Block.standard('#exchangeRecord',{
            backgroundColor: loaderColor,
        });
        HSCore.components.HSChartJS.init(document.querySelector('#chartExchangeRecordsGraph'), {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: "transparent",
                    borderColor: "#377dff",
                    borderWidth: 2,
                    pointRadius: 0,
                    hoverBorderColor: "#377dff",
                    pointBackgroundColor: "#377dff",
                    pointBorderColor: "#fff",
                    pointHoverRadius: 0,
                    tension: 0.4
                },
                    {
                        data: [],
                        backgroundColor: "transparent",
                        borderColor: "#e7eaf3",
                        borderWidth: 2,
                        pointRadius: 0,
                        hoverBorderColor: "#e7eaf3",
                        pointBackgroundColor: "#e7eaf3",
                        pointBorderColor: "#fff",
                        pointHoverRadius: 0,
                        tension: 0.4
                    }]
            },
            options: {
                scales: {
                    y: {
                        grid: {
                            color: "#e7eaf3",
                            drawBorder: false,
                            zeroLineColor: "#e7eaf3"
                        },
                        ticks: {
                            beginAtZero: true,
                            stepSize: 100,
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 10,
                            prefix: "$",
                            postfix: "k"
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 5
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        prefix: "",
                        postfix: "",
                        hasIndicator: true,
                        mode: "index",
                        intersect: false,
                        lineMode: true,
                        lineWithLineColor: "rgba(19, 33, 68, 0.075)"
                    }
                },
                hover: {
                    mode: "nearest",
                    intersect: true
                }
            }
        });
        const chartExchangeRecordsGraph = HSCore.components.HSChartJS.getItem('chartExchangeRecordsGraph');

        updateChartExchangeRecordsGraph();

        async function updateChartExchangeRecordsGraph() {
            let $url = "{{ route('admin.chartExchangeRecords') }}"
            await axios.get($url)
                .then(function (res) {

                    $('.totalExchangeCount').text(res.data.exchangeRecord.totalExchange);

                    chartExchangeRecordsGraph.data.labels = res.data.exchangeRecord.exchangeToday.hours;
                    chartExchangeRecordsGraph.data.datasets[0].data = res.data.exchangeRecord.exchangeToday.counts;
                    chartExchangeRecordsGraph.data.datasets[1].data = res.data.exchangeRecord.exchangeYesterday.counts;
                    chartExchangeRecordsGraph.update();
                    Notiflix.Block.remove('#exchangeRecord');
                })
                .catch(function (error) {
                });
        }
    </script>

    <script>
        Notiflix.Block.standard('#buyRecord',{
            backgroundColor: loaderColor,
        });
        HSCore.components.HSChartJS.init(document.querySelector('#chartBuyRecordsGraph'), {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: "transparent",
                    borderColor: "#377dff",
                    borderWidth: 2,
                    pointRadius: 0,
                    hoverBorderColor: "#377dff",
                    pointBackgroundColor: "#377dff",
                    pointBorderColor: "#fff",
                    pointHoverRadius: 0,
                    tension: 0.4
                },
                    {
                        data: [],
                        backgroundColor: "transparent",
                        borderColor: "#e7eaf3",
                        borderWidth: 2,
                        pointRadius: 0,
                        hoverBorderColor: "#e7eaf3",
                        pointBackgroundColor: "#e7eaf3",
                        pointBorderColor: "#fff",
                        pointHoverRadius: 0,
                        tension: 0.4
                    }]
            },
            options: {
                scales: {
                    y: {
                        grid: {
                            color: "#e7eaf3",
                            drawBorder: false,
                            zeroLineColor: "#e7eaf3"
                        },
                        ticks: {
                            beginAtZero: true,
                            stepSize: 100,
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 10,
                            prefix: "$",
                            postfix: "k"
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 5
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        prefix: "",
                        postfix: "",
                        hasIndicator: true,
                        mode: "index",
                        intersect: false,
                        lineMode: true,
                        lineWithLineColor: "rgba(19, 33, 68, 0.075)"
                    }
                },
                hover: {
                    mode: "nearest",
                    intersect: true
                }
            }
        });
        const chartBuyRecordsGraph = HSCore.components.HSChartJS.getItem('chartBuyRecordsGraph');

        updateChartBuyRecordsGraph();

        async function updateChartBuyRecordsGraph() {
            let $url = "{{ route('admin.chartBuyRecords') }}"
            await axios.get($url)
                .then(function (res) {

                    $('.totalBuyCount').text(res.data.buyRecord.totalBuy);

                    chartBuyRecordsGraph.data.labels = res.data.buyRecord.buyToday.hours;
                    chartBuyRecordsGraph.data.datasets[0].data = res.data.buyRecord.buyToday.counts;
                    chartBuyRecordsGraph.data.datasets[1].data = res.data.buyRecord.buyYesterday.counts;
                    chartBuyRecordsGraph.update();
                    Notiflix.Block.remove('#buyRecord');
                })
                .catch(function (error) {

                });
        }
    </script>

    <script>
        Notiflix.Block.standard('#sellRecord',{
            backgroundColor: loaderColor,
        });
        HSCore.components.HSChartJS.init(document.querySelector('#chartSellRecordsGraph'), {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: "transparent",
                    borderColor: "#377dff",
                    borderWidth: 2,
                    pointRadius: 0,
                    hoverBorderColor: "#377dff",
                    pointBackgroundColor: "#377dff",
                    pointBorderColor: "#fff",
                    pointHoverRadius: 0,
                    tension: 0.4
                },
                    {
                        data: [],
                        backgroundColor: "transparent",
                        borderColor: "#e7eaf3",
                        borderWidth: 2,
                        pointRadius: 0,
                        hoverBorderColor: "#e7eaf3",
                        pointBackgroundColor: "#e7eaf3",
                        pointBorderColor: "#fff",
                        pointHoverRadius: 0,
                        tension: 0.4
                    }]
            },
            options: {
                scales: {
                    y: {
                        grid: {
                            color: "#e7eaf3",
                            drawBorder: false,
                            zeroLineColor: "#e7eaf3"
                        },
                        ticks: {
                            beginAtZero: true,
                            stepSize: 100,
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 10,
                            prefix: "$",
                            postfix: "k"
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: "#97a4af",
                            font: {
                                size: 12,
                                family: "Open Sans, sans-serif"
                            },
                            padding: 5
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        prefix: "",
                        postfix: "",
                        hasIndicator: true,
                        mode: "index",
                        intersect: false,
                        lineMode: true,
                        lineWithLineColor: "rgba(19, 33, 68, 0.075)"
                    }
                },
                hover: {
                    mode: "nearest",
                    intersect: true
                }
            }
        });
        const chartSellRecordsGraph = HSCore.components.HSChartJS.getItem('chartSellRecordsGraph');

        updateChartSellRecordsGraph();

        async function updateChartSellRecordsGraph() {
            let $url = "{{ route('admin.chartSellRecords') }}"
            await axios.get($url)
                .then(function (res) {

                    $('.totalSellCount').text(res.data.sellRecord.totalSell);

                    chartSellRecordsGraph.data.labels = res.data.sellRecord.sellToday.hours;
                    chartSellRecordsGraph.data.datasets[0].data = res.data.sellRecord.sellToday.counts;
                    chartSellRecordsGraph.data.datasets[1].data = res.data.sellRecord.sellYesterday.counts;
                    chartSellRecordsGraph.update();
                    Notiflix.Block.remove('#sellRecord');
                })
                .catch(function (error) {

                });
        }
    </script>
@endpush
