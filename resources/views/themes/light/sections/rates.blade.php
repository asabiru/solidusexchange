@php
    $cryptoCurrencies = \App\Models\CryptoCurrency::where('status', 1)->orderBy('sort_by', 'asc')->limit(10)->get();
@endphp

<!-- Rates Section - eazy228/design style -->
<section class="rates-section" id="rates">
    <div class="container">
        <div class="rates-header">
            <span class="section-number">02 /</span>
            <h2 class="section-title">Онлайн курсы</h2>
        </div>

        <div class="rates-subheader">
            <h3>Курсы в реальном времени</h3>
            <span class="update-time">Обновлено 12 c назад</span>
        </div>

        <!-- Ticker -->
        <div class="rates-ticker ticker-pause">
            <div class="ticker-track">
                @foreach($cryptoCurrencies as $currency)
                @foreach([1,2] as $duplicate)
                <div class="ticker-item">
                    <span class="ticker-pair">{{ $currency->code }}/USD</span>
                    <span class="ticker-price">{{ number_format($currency->usd_rate ?? $currency->rate, $currency->rate < 10 ? 4 : 2) }}</span>
                    <span class="ticker-change {{ rand(0,1) ? 'positive' : 'negative' }}">
                        @if(rand(0,1))
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                            <polyline points="17 6 23 6 23 12"></polyline>
                        </svg>
                        @else
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
                            <polyline points="17 18 23 18 23 12"></polyline>
                        </svg>
                        @endif
                        {{ number_format((rand(-5, 5) / 100), 2) }}%
                    </span>
                </div>
                @endforeach
                @endforeach
            </div>
        </div>

        <!-- Rates Table -->
        <div class="rates-table-container">
            <div class="rates-table">
                <div class="table-header">
                    <div class="table-cell">Пара</div>
                    <div class="table-cell">Цена, USD</div>
                    <div class="table-cell">24ч</div>
                    <div class="table-cell">График</div>
                    <div class="table-cell">Обменять</div>
                </div>

                @foreach($cryptoCurrencies as $currency)
                <div class="table-row">
                    <div class="table-cell">
                        <div class="currency-info">
                            <div class="currency-flag">
                                <img src="{{ getFile($currency->driver, $currency->image) }}" alt="{{ $currency->code }}">
                            </div>
                            <div class="currency-details">
                                <span class="currency-code">{{ $currency->code }}</span>
                                <span class="currency-name">{{ $currency->name }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="table-cell">
                        <span class="price-value">{{ number_format($currency->usd_rate ?? $currency->rate, $currency->rate < 10 ? 4 : 2) }}</span>
                    </div>
                    <div class="table-cell">
                        <span class="change-value {{ rand(0,1) ? 'positive' : 'negative' }}">
                            {{ number_format((rand(-5, 5) / 100), 2) }}%
                        </span>
                    </div>
                    <div class="table-cell">
                        <div class="mini-chart">
                            <svg width="80" height="30" viewBox="0 0 80 30">
                                <polyline
                                    fill="none"
                                    stroke="{{ rand(0,1) ? 'var(--color-success)' : 'var(--color-danger)' }}"
                                    stroke-width="2"
                                    points="0,15 8,10 16,20 24,12 32,18 40,8 48,15 56,22 64,12 72,18 80,14"
                                />
                            </svg>
                        </div>
                    </div>
                    <div class="table-cell">
                        <a href="{{ route('home') }}#exchange" class="exchange-link">
                            Обменять
                        </a>
                    </div>
                </div>
                @endforeach
            </div>
        </div>
    </div>
</section>