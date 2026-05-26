<div class="row mb-2">
    <div class="col-md-4" id="exchangePerformance">
        <div class="card mt-50">
            <div class="card-header d-flex justify-content-between border-0">
                <h4>@lang('Exchange Crypto Figures')</h4>
            </div>
            <div class="card-body">
                <div id="chart"></div>
            </div>
        </div>
    </div>
    <div class="col-md-4" id="buyPerformance">
        <div class="card mt-50">
            <div class="card-header d-flex justify-content-between border-0">
                <h4>@lang('Buy Crypto Figures')</h4>
            </div>
            <div class="card-body">
                <div id="chart1"></div>
            </div>
        </div>
    </div>

    <div class="col-md-4" id="sellPerformance">
        <div class="card mt-50">
            <div class="card-header d-flex justify-content-between border-0">
                <h4>@lang('Sell Crypto Figures')</h4>
            </div>
            <div class="card-body">
                <div id="chart2"></div>
            </div>
        </div>
    </div>
</div>


@push('script')
    <script>
        const dashboardTheme = window.SolidusDashboardTheme || {
            colors: {
                surface: '#ffffff',
                chartLine: '#377dff',
                textMuted: '#7d8791'
            }
        };

        Notiflix.Block.standard('#exchangePerformance', {
            backgroundColor: dashboardTheme.colors.surface,
        });
        var options = {
            series: [{
                data: [],
            }],
            chart: {
                type: 'bar',
                height: 250
            },
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    horizontal: true,
                }
            },
            dataLabels: {
                enabled: false
            },
            xaxis: {
                categories: ['Total', 'Pending', 'Complete', 'Cancel'
                ],
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            yaxis: {
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            colors: [dashboardTheme.colors.chartLine],
        };
        updateExchangePerformanceGraph();

        async function updateExchangePerformanceGraph() {
            let $url = "{{ route('admin.chartExchangePerformance') }}"
            await axios.get($url)
                .then(function (res) {
                    options.series[0].data = res.data.exchangePerformance.horizontalBarChatExchange;
                    var chart = new ApexCharts(document.querySelector("#chart"), options);
                    chart.render();
                    Notiflix.Block.remove('#exchangePerformance');
                })
                .catch(function (error) {
                });
        }
    </script>

    <script>
        Notiflix.Block.standard('#buyPerformance',{
            backgroundColor: dashboardTheme.colors.surface,
        });
        var options1 = {
            series: [{
                data: [],
            }],
            chart: {
                type: 'bar',
                height: 250
            },
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    horizontal: true,
                }
            },
            dataLabels: {
                enabled: false
            },
            xaxis: {
                categories: ['Total', 'Pending', 'Complete', 'Cancel'
                ],
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            yaxis: {
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            colors: [dashboardTheme.colors.chartLine],
        };

        updateBuyPerformanceGraph();

        async function updateBuyPerformanceGraph() {
            let $url = "{{ route('admin.chartBuyPerformance') }}"
            await axios.get($url)
                .then(function (res) {

                    options1.series[0].data = res.data.buyPerformance.horizontalBarChatBuy;
                    var chart1 = new ApexCharts(document.querySelector("#chart1"), options1);
                    chart1.render();
                    Notiflix.Block.remove('#buyPerformance');
                })
                .catch(function (error) {
                });
        }

    </script>

    <script>
        Notiflix.Block.standard('#sellPerformance',{
            backgroundColor: dashboardTheme.colors.surface,
        });
        var options2 = {
            series: [{
                data: [],
            }],
            chart: {
                type: 'bar',
                height: 250
            },
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    horizontal: true,
                }
            },
            dataLabels: {
                enabled: false
            },
            xaxis: {
                categories: ['Total', 'Pending', 'Complete', 'Cancel'
                ],
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            yaxis: {
                labels: {
                    style: {
                        colors: dashboardTheme.colors.textMuted
                    }
                }
            },
            colors: [dashboardTheme.colors.chartLine],
        };

        updateSellPerformanceGraph();

        async function updateSellPerformanceGraph() {
            let $url = "{{ route('admin.chartSellPerformance') }}"
            await axios.get($url)
                .then(function (res) {

                    options2.series[0].data = res.data.sellPerformance.horizontalBarChatSell;
                    var chart2 = new ApexCharts(document.querySelector("#chart2"), options2);
                    chart2.render();
                    Notiflix.Block.remove('#sellPerformance');
                })
                .catch(function (error) {
                });
        }

    </script>
@endpush
