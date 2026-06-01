@php
    $reserveCurrencies = \App\Models\CryptoCurrency::where('status', 1)
        ->where('show_in_reserves', 1)
        ->orderBy('sort_by', 'asc')
        ->get();

    // Get USDT rate in base currency for USD value conversion
    $baseCurrency = basicControl()->base_currency ?? 'RUB';
    $usdtRate = \App\Models\CryptoCurrency::where('code', 'USDT')->where('status', 1)->value('rate') ?? 75;
@endphp

<!-- Reserves Section -->
<section class="reserves-section" id="reserves">
    <div class="container">
        <div class="reserves-header">
            <h2 class="section-title">Резервы</h2>
        </div>

        <h3 class="reserves-subtitle">Наши резервы в реальном времени</h3>

        @if($reserveCurrencies->count() > 0)
        <div class="reserves-grid">
            @foreach($reserveCurrencies as $crypto)
            @php
                $amount = $crypto->reserve_amount ?? 0;
                $usdValue = $amount * ($crypto->usd_rate ?? 0);
                $displayValue = $usdValue * $usdtRate;

                // Format amounts nicely
                $formattedAmount = $amount >= 1
                    ? number_format($amount, 2)
                    : rtrim(rtrim(number_format($amount, 8), '0'), '.');
                $formattedValue = $displayValue >= 1000
                    ? number_format($displayValue, 0, ',', ' ')
                    : number_format($displayValue, 2, ',', ' ');
            @endphp
            <div class="reserve-card">
                <div class="reserve-icon">
                    @if($crypto->image)
                        <img src="{{ getFile($crypto->driver, $crypto->image) }}"
                             alt="{{ $crypto->code }}"
                             class="reserve-icon-img">
                    @else
                        <span class="icon-placeholder">{{ substr($crypto->code, 0, 2) }}</span>
                    @endif
                </div>
                <div class="reserve-info">
                    <span class="reserve-currency">{{ $crypto->code }}</span>
                    <span class="reserve-amount">{{ $formattedAmount }} {{ $crypto->code }}</span>
                </div>
                <div class="reserve-value">
                    ≈ {{ $formattedValue }} {{ $baseCurrency }}
                </div>
            </div>
            @endforeach
        </div>
        @else
        <div class="reserves-empty">
            <p>Резервы временно недоступны</p>
        </div>
        @endif

        <div class="reserves-footer">
            <p class="reserves-note">
                Все резервы подтверждаются on-chain. Данные обновляются регулярно.
            </p>
            <a href="#" class="reserves-link">Просмотреть все резервы</a>
        </div>
    </div>
</section>
