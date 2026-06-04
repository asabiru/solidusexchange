@php
    $rateCards = app(\App\Services\MarketRateCardService::class)->cards(10);
    $lastSync = \App\Models\CryptoCurrency::where('status', 1)->whereNotNull('last_rate_sync_at')->max('last_rate_sync_at');
    $syncAgo = $lastSync ? \Carbon\Carbon::parse($lastSync)->diffInSeconds(now()) : null;
@endphp

<!-- Rates Section - eazy228/design style -->
<section class="rates-section" id="rates">
    <div class="container">
        <div class="rates-header">
            <h2 class="section-title">Онлайн курсы</h2>
        </div>

        <div class="rates-subheader">
            <h3>Курсы в реальном времени</h3>
            <span class="update-time">@if($syncAgo !== null) Обновлено {{ $syncAgo }} с назад @else Курсы загружаются... @endif</span>
        </div>

        <!-- Ticker -->
        <div class="rates-ticker ticker-pause">
            <div class="ticker-track">
                @foreach([1,2] as $duplicate)
                @foreach($rateCards as $rc)
                <div class="ticker-item">
                    @php
                        $change24h = $rc['change_24h'];
                        $isPositive = $change24h !== null && $change24h >= 0;
                    @endphp
                    <span class="ticker-pair">{{ $rc['pair'] }}</span>
                    <span class="ticker-price">Покупка {{ $rc['display_buy_rate'] }}</span>
                    <span class="ticker-price">Продажа {{ $rc['display_sell_rate'] }} {{ $rc['quote_code'] }}</span>
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
                    <div class="table-cell">Покупка</div>
                    <div class="table-cell">Продажа</div>
                    <div class="table-cell">24ч</div>
                    <div class="table-cell">Обменять</div>
                </div>

                @if($rateCards->isEmpty())
                    <div class="table-row">
                        <div class="table-cell" colspan="5" style="text-align: center; padding: 40px; color: var(--color-text-secondary);">
                            Криптовалюты временно недоступны
                        </div>
                    </div>
                @else
                    @foreach($rateCards as $rc)
                    @php
                        $change24h = $rc['change_24h'];
                        $isPositive = $change24h !== null && $change24h >= 0;
                    @endphp
                <div class="table-row">
                    <div class="table-cell" data-label="Пара">
                        <div class="currency-info">
                            <div class="currency-flag">
                                @if(!empty($rc['image_path']))
                                    <img src="{{ $rc['image_path'] }}" alt="{{ $rc['code'] }}">
                                @else
                                    <div class="currency-placeholder">{{ substr($rc['code'], 0, 2) }}</div>
                                @endif
                            </div>
                            <div class="currency-details">
                                <span class="currency-code">{{ $rc['code'] }}</span>
                                <span class="currency-name">{{ $rc['name'] }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="table-cell" data-label="Покупка">
                        <span class="price-value">{{ $rc['display_buy_rate'] }} {{ $rc['quote_code'] }}</span>
                    </div>
                    <div class="table-cell" data-label="Продажа">
                        <span class="price-value">{{ $rc['display_sell_rate'] }} {{ $rc['quote_code'] }}</span>
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
                    <div class="table-cell" data-label="Обменять">
                        <a href="{{ route('home') }}#exchange"
                           class="exchange-link"
                           data-send-currency-id="{{ $rc['id'] }}"
                           data-send-currency-code="{{ $rc['code'] }}">
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
