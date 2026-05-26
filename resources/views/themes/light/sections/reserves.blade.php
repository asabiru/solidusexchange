@php
    $cryptoCurrencies = \App\Models\CryptoCurrency::where('status', 1)->orderBy('sort_by', 'asc')->limit(8)->get();
@endphp

<!-- Reserves Section - eazy228/design style -->
<section class="reserves-section" id="reserves">
    <div class="container">
        <div class="reserves-header">
            <span class="section-number">07 /</span>
            <h2 class="section-title">Резервы</h2>
        </div>

        <h3 class="reserves-subtitle">Наши резервы в реальном времени</h3>

        <div class="reserves-grid">
            @foreach($cryptoCurrencies as $crypto)
            <div class="reserve-card">
                <div class="reserve-icon">
                    <div class="icon-placeholder">
                        {{ substr($crypto->code, 0, 2) }}
                    </div>
                </div>
                <div class="reserve-info">
                    <span class="reserve-currency">{{ $crypto->code }}</span>
                    <span class="reserve-amount">{{ number_format(rand(100, 10000), 4) }} {{ $crypto->code }}</span>
                </div>
                <div class="reserve-value">
                    ${{ number_format(rand(1000, 100000), 2) }}
                </div>
            </div>
            @endforeach
        </div>

        <div class="reserves-footer">
            <p class="reserves-note">
                Все резервы подтверждаются on-chain. Данные обновляются в реальном времени.
            </p>
            <a href="#" class="reserves-link">Просмотреть все резервы</a>
        </div>
    </div>
</section>