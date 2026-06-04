@php
    $popularCryptos = \App\Models\CryptoCurrency::where('status', 1)
        ->where('show_on_homepage', 1)
        ->orderBy('sort_by', 'asc')
        ->limit(6)
        ->get();
    if($popularCryptos->isEmpty()) {
        $popularCryptos = collect();
    }
    $baseCurrency = strtoupper(basicControl()->base_currency ?? 'RUB');
    $networkBadgeLabel = function (?string $code): string {
        if (!$code || !str_contains($code, '_')) {
            return '';
        }

        $parts = explode('_', $code);
        $suffix = strtoupper(end($parts));
        $aliases = [
            'ERC20' => 'ERC20',
            'TRC20' => 'TRC20',
            'BSC' => 'BSC',
            'SOL' => 'SOL',
            'ARB' => 'ARB',
            'BASE' => 'BASE',
            'OPT' => 'OPT',
            'TON' => 'TON',
        ];

        return $aliases[$suffix] ?? $suffix;
    };
@endphp

<!-- PopularCryptos Section - eazy228/design style -->
<section class="popular-cryptos-section" id="popular">
    <div class="container">
        <div class="popular-header">
            <h2 class="section-title">Популярные криптовалюты</h2>
        </div>

        <h3 class="popular-subtitle">Чаще всего обменивают</h3>

        <div class="popular-grid">
            @if($popularCryptos->isEmpty())
                <div class="no-data-message">
                    <p>Криптовалюты временно недоступны</p>
                </div>
            @else
                @foreach($popularCryptos as $crypto)
                @php
                    $isStablecoin = $crypto->is_stablecoin;
                    $displayPrice = $isStablecoin
                        ? number_format((float)($crypto->rate ?? $crypto->usd_rate), 2, '.', ' ')
                        : number_format((float)($crypto->usd_rate ?? $crypto->rate), 2, '.', ' ');
                    $priceCurrency = $isStablecoin ? $baseCurrency : 'USD';
                    $change24h = $crypto->change_24h;
                    $isPositive = $change24h !== null && $change24h >= 0;
                    $sparkline = $crypto->sparkline_7d;
                @endphp
            <div class="crypto-card">
                <div class="crypto-header">
                    <div class="crypto-icon">
                        @if($crypto->image)
                            <img src="{{ getFile($crypto->driver, $crypto->image) }}" alt="{{ $crypto->code }}">
                        @else
                            <div class="icon-placeholder">{{ substr($crypto->code, 0, 2) }}</div>
                        @endif
                    </div>
                    @if($change24h !== null)
                    <div class="crypto-change {{ $isPositive ? 'positive' : 'negative' }}">
                        @if($isPositive)
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                            <polyline points="17 6 23 6 23 12"></polyline>
                        </svg>
                        @else
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
                            <polyline points="17 18 23 18 23 12"></polyline>
                        </svg>
                        @endif
                        {{ $isPositive ? '+' : '' }}{{ number_format($change24h, 2) }}%
                    </div>
                    @endif
                </div>

                <div class="crypto-body">
                    <h4 class="crypto-symbol">{{ $crypto->code }}</h4>
                    @php $badge = $networkBadgeLabel($crypto->code); @endphp
                    @if($badge)
                        <span class="currency-network-badge crypto-network-badge">{{ $badge }}</span>
                    @endif
                    <p class="crypto-name">{{ $crypto->name }}</p>
                    <div class="crypto-price">
                        {{ $displayPrice }} {{ $priceCurrency }}
                    </div>
                    @if($sparkline && count($sparkline) > 1)
                    @php
                        $min = min($sparkline);
                        $max = max($sparkline);
                        $range = $max - $min ?: 1;
                        $points = [];
                        $w = 120;
                        $h = 40;
                        $pad = 3;
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
                    <div class="crypto-sparkline" style="margin-top:8px;">
                        <svg width="{{ $w }}" height="{{ $h }}" viewBox="0 0 {{ $w }} {{ $h }}" style="width:100%;height:auto;">
                            <polyline
                                fill="none"
                                stroke="{{ $chartColor }}"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                points="{{ $pointStr }}"
                            />
                        </svg>
                    </div>
                    @endif
                </div>

                <a href="{{ route('home') }}#exchange"
                   class="crypto-button"
                   data-send-currency-id="{{ $crypto->id }}"
                   data-send-currency-code="{{ $crypto->code }}">
                    Обменять {{ $crypto->code }}
                </a>
            </div>
                @endforeach
            @endif
        </div>
    </div>
</section>
