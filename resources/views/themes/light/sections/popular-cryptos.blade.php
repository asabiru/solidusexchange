@php
    $popularCryptos = \App\Models\CryptoCurrency::where('status', 1)->orderBy('sort_by', 'asc')->limit(6)->get();
    // If no cryptos found, use empty collection to avoid errors
    if($popularCryptos->isEmpty()) {
        $popularCryptos = collect();
    }
@endphp

<!-- PopularCryptos Section - eazy228/design style -->
<section class="popular-cryptos-section" id="popular">
    <div class="container">
        <div class="popular-header">
            <span class="section-number">03 /</span>
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
            <div class="crypto-card">
                <div class="crypto-header">
                    <div class="crypto-icon">
                        <div class="icon-placeholder">
                            {{ substr($crypto->code, 0, 2) }}
                        </div>
                    </div>
                    <div class="crypto-change {{ rand(0,1) ? 'positive' : 'negative' }}">
                        @if(rand(0,1))
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
                        {{ number_format((rand(-5, 5) / 100), 2) }}%
                    </div>
                </div>

                <div class="crypto-body">
                    <h4 class="crypto-symbol">{{ $crypto->code }}</h4>
                    <p class="crypto-name">{{ $crypto->name }}</p>
                    <div class="crypto-price">
                        ${{ number_format($crypto->usd_rate ?? $crypto->rate, $crypto->rate < 10 ? 4 : 2) }}
                    </div>
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