<div class="row">
    <div class="col-md-4">
        <div class="card mt-50" id="exchangeRecord">
            <div class="card-body">
                <div id="chart4"></div>
            </div>
        </div>
    </div>
    <div class="col-md-4">
        <div class="card mt-50" id="buyRecord">
            <div class="card-body">
                <div id="chart5"></div>
            </div>
        </div>
    </div>
    <div class="col-md-4">
        <div class="card mt-50" id="sellRecord">
            <div class="card-body">
                <div id="chart6"></div>
            </div>
        </div>
    </div>
</div>
@push('extra_scripts')
    <script>

        Notiflix.Block.standard('#exchangeRecord', {
            backgroundColor: loaderColor,
        });
        var options4 = {
            series: [{
                name: "Exchange Request",
                data: [],
                color: '{{$baseColor}}'
            }],
            chart: {
                height: 250,
                type: 'line',
                zoom: {
                    enabled: false
                },
                background: isDarkMode ? '#1e1e1e' : '#ffffff' // Chart background
            },
            dataLabels: {
                enabled: false
            },
            stroke: {
                curve: 'straight'
            },
            title: {
                text: 'Exchange Request by Month',
                align: 'left',
                style: {
                    color: labelColor, // Set your desired color here
                }
            },
            grid: {
                row: {
                    // colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
                    colors: gridColors, // Adjust grid colors

                    opacity: 0.5
                },
            },
            xaxis: {
                categories: [],
                labels: {
                    style: {
                        colors: ['{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}']
                    }
                }
            }
        };

        updateExchangeMovementGraph();

        async function updateExchangeMovementGraph() {
            let $url = "{{ route('user.chartExchangeRecords') }}"
            await axios.get($url)
                .then(function (res) {
                    options4.series[0].data = Object.values(res.data.exchangeMovements);
                    options4.xaxis.categories = Object.keys(res.data.exchangeMovements);
                    var chart4 = new ApexCharts(document.querySelector("#chart4"), options4);
                    chart4.render();
                    Notiflix.Block.remove('#exchangeRecord');
                })
                .catch(function (error) {
                });
        }
    </script>

    <script>
        Notiflix.Block.standard('#buyRecord', {
            backgroundColor: loaderColor,
        });

        var options5 = {
            series: [{
                name: "Buy Request",
                data: [],
                color: '{{$baseColor}}'
            }],
            chart: {
                height: 250,
                type: 'line',
                zoom: {
                    enabled: false
                },
                background: isDarkMode ? '#1e1e1e' : '#ffffff' // Chart background

            },
            dataLabels: {
                enabled: false
            },
            stroke: {
                curve: 'straight'
            },
            title: {
                text: 'Buy Request by Month',
                align: 'left',
                style: {
                    color: labelColor , // Set your desired color here
                }
            },
            grid: {
                row: {
                    colors: gridColors, // takes an array which will be repeated on columns
                    opacity: 0.5
                },
            },
            xaxis: {
                categories: [],
                labels: {
                    style: {
                        colors: ['{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}']
                    }
                }
            }
        };

        updateBuyMovementGraph();

        async function updateBuyMovementGraph() {
            let $url = "{{ route('user.chartBuyRecords') }}"
            await axios.get($url)
                .then(function (res) {
                    options5.series[0].data = Object.values(res.data.buyMovements);
                    options5.xaxis.categories = Object.keys(res.data.buyMovements);
                    var chart5 = new ApexCharts(document.querySelector("#chart5"), options5);
                    chart5.render();
                    Notiflix.Block.remove('#buyRecord');
                })
                .catch(function (error) {
                });
        }
    </script>

    <script>
        Notiflix.Block.standard('#sellRecord', {
            backgroundColor: loaderColor,
        });



        var options6 = {
            series: [{
                name: "Sell Request",
                data: [],
                color: '{{$baseColor}}'
            }],
            chart: {
                height: 250,
                type: 'line',
                zoom: {
                    enabled: false
                },
                background: isDarkMode ? '#1e1e1e' : '#ffffff' // Chart background

            },
            dataLabels: {
                enabled: false
            },
            stroke: {
                curve: 'straight'
            },
            title: {
                text: 'Sell Request by Month',
                align: 'left',
                style: {
                    color: labelColor // Title color
                }
            },
            grid: {
                row: {
                    colors: gridColors, // Adjust grid colors
                    opacity: 0.5
                },
            },
            xaxis: {
                categories: [],
                labels: {
                    style: {
                        colors: ['{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}','{{$baseColor}}']
                    }
                }
            }
        };

        updateSellMovementGraph();

        async function updateSellMovementGraph() {
            let $url = "{{ route('user.chartSellRecords') }}"
            await axios.get($url)
                .then(function (res) {
                    options6.series[0].data = Object.values(res.data.sellMovements);
                    options6.xaxis.categories = Object.keys(res.data.sellMovements);
                    var chart6 = new ApexCharts(document.querySelector("#chart6"), options6);
                    chart6.render();
                    Notiflix.Block.remove('#sellRecord');
                })
                .catch(function (error) {
                });
        }
    </script>
@endpush
