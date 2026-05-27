@php
    $cryptoCurrencies = \App\Models\CryptoCurrency::where('status', 1)
        ->where('show_on_homepage', 1)
        ->orderBy('sort_by', 'asc')
        ->limit(10)
        ->get();
    if($cryptoCurrencies->isEmpty()) {
        $cryptoCurrencies = collect();
    }
    $lastSync = \App\Models\CryptoCurrency::where('status', 1)->whereNotNull('last_rate_sync_at')->max('last_rate_sync_at');
    $syncAgo = $lastSync ? \Carbon\Carbon::parse($lastSync)->diffInSeconds(now()) : null;
    $baseCurrency = strtoupper(basicControl()->base_currency ?? 'RUB');
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
            <span class="update-time">@if($syncAgo !== null) Обновлено {{ $syncAgo }} с назад @else Курсы загружаются... @endif</span>
        </div>

        <!-- Ticker -->
        <div class="rates-ticker ticker-pause">
            <div class="ticker-track">
                @foreach($cryptoCurrencies as $currency)
                @foreach([1,2] as $duplicate)
                <div class="ticker-item">
                    @php
                        $isStablecoin = $currency->is_stablecoin;
                        $tickerPrice = $isStablecoin
                            ? number_format((float)($currency->rate ?? $currency->usd_rate), 2, '.', ' ')
                            : formatCryptoRate((float)($currency->usd_rate ?? $currency->rate));
                        $tickerCurrency = $isStablecoin ? $baseCurrency : 'USD';
                        $change24h = $currency->change_24h;
                        $isPositive = $change24h !== null && $change24h >= 0;
                    @endphp
                    <span class="ticker-pair">{{ $currency->code }}/{{ $tickerCurrency }}</span>
                    <span class="ticker-price">{{ $tickerPrice }}</span>
                    <span class="ticker-change {{ $change24h !== null ? ($isPositive ? 'positive' : 'negative') : '' }}">
                        @if($change24h !== null)
                            @if($isPositive)
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
                            {{ number_format(abs($change24h), 2) }}%
                        @else
                            —
                        @endif
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
                    <div class="table-cell">Цена</div>
                    <div class="table-cell">24ч</div>
                    <div class="table-cell">7 дней</div>
                    <div class="table-cell">Обменять</div>
                </div>

                @if($cryptoCurrencies->isEmpty())
                    <div class="table-row">
                        <div class="table-cell" colspan="5" style="text-align: center; padding: 40px; color: var(--color-text-secondary);">
                            Криптовалюты временно недоступны
                        </div>
                    </div>
                @else
                    @foreach($cryptoCurrencies as $currency)
                    @php
                        $isStablecoin = $currency->is_stablecoin;
                        $displayPrice = $isStablecoin
                            ? number_format((float)($currency->rate ?? $currency->usd_rate), 2, '.', ' ')
                            : formatCryptoRate((float)($currency->usd_rate ?? $currency->rate));
                        $priceCurrency = $isStablecoin ? $baseCurrency : 'USD';
                        $change24h = $currency->change_24h;
                        $isPositive = $change24h !== null && $change24h >= 0;
                        $sparkline = $currency->sparkline_7d;
                    @endphp
                <div class="table-row">
                    <div class="table-cell" data-label="Пара">
                        <div class="currency-info">
                            <div class="currency-flag">
                                @if($currency->image)
                                    <img src="{{ getFile($currency->driver, $currency->image) }}" alt="{{ $currency->code }}" onerror="this.src='https://via.placeholder.com/32?text={{ substr($currency->code, 0, 2) }}'">
                                @else
                                    <div class="currency-placeholder">{{ substr($currency->code, 0, 2) }}</div>
                                @endif
                            </div>
                            <div class="currency-details">
                                <span class="currency-code">{{ $currency->code }}</span>
                                <span class="currency-name">{{ $currency->name }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="table-cell" data-label="Цена">
                        <span class="price-value">{{ $displayPrice }} {{ $priceCurrency }}</span>
                    </div>
                    <div class="table-cell" data-label="24ч">
                        @if($change24h !== null)
                        <span class="change-value {{ $isPositive ? 'positive' : 'negative' }}">
                            {{ $isPositive ? '+' : '' }}{{ number_format($change24h, 2) }}%
                        </span>
                        @else
                        <span class="change-value" style="opacity:0.4">—</span>
                        @endif
                    </div>
                    <div class="table-cell" data-label="7 дней">
                        <div class="mini-chart">
                            @if($sparkline && count($sparkline) > 1)
                                @php
                                    $min = min($sparkline);
                                    $max = max($sparkline);
                                    $range = $max - $min ?: 1;
                                    $points = [];
                                    $w = 80;
                                    $h = 30;
                                    $pad = 2;
                                    foreach ($sparkline as $i => $val) {
                                        $x = $pad + ($i / (count($sparkline) - 1)) * ($w - 2 * $pad);
                                        $y = $h - $pad - (($val - $min) / $range) * ($h - 2 * $pad);
                                        $points[] = round($x, 1) . ',' . round($y, 1);
                                    }
                                    $pointStr = implode(' ', $points);
                                    $lastVal = end($sparkline);
                                    $firstVal = reset($sparkline);
                                    $chartColor = $lastVal >= $firstVal ? '#e8c9a0' : '#c9786a';
                                @endphp
                                <svg width="{{ $w }}" height="{{ $h }}" viewBox="0 0 {{ $w }} {{ $h }}">
                                    <polyline
                                        fill="none"
                                        stroke="{{ $chartColor }}"
                                        stroke-width="1.5"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        points="{{ $pointStr }}"
                                    />
                                </svg>
                            @else
                                <svg width="80" height="30" viewBox="0 0 80 30">
                                    <line x1="5" y1="15" x2="75" y2="15" stroke="var(--color-text-secondary)" stroke-width="1" stroke-dasharray="4,4" opacity="0.3"/>
                                </svg>
                            @endif
                        </div>
                    </div>
                    <div class="table-cell" data-label="Обменять">
                        <a href="{{ route('home') }}#exchange"
                           class="exchange-link"
                           data-send-currency-id="{{ $currency->id }}"
                           data-send-currency-code="{{ $currency->code }}">
                            Обменять
                        </a>
                    </div>
                </div>
                    @endforeach
                @endif
            </div>
        </div>
    </div>
</section>
