<!-- Rates section start -->
@php
    $scAssets = [
        ['symbol' => 'BTC', 'name' => 'Bitcoin', 'network' => 'Bitcoin', 'price' => 96432.10, 'change' => 1.84],
        ['symbol' => 'ETH', 'name' => 'Ethereum', 'network' => 'Ethereum', 'price' => 3284.50, 'change' => -0.62],
        ['symbol' => 'USDT', 'name' => 'Tether', 'network' => 'TRC-20', 'price' => 1.00, 'change' => 0.01],
        ['symbol' => 'USDC', 'name' => 'USD Coin', 'network' => 'Ethereum', 'price' => 1.00, 'change' => -0.02],
        ['symbol' => 'TON', 'name' => 'Toncoin', 'network' => 'TON', 'price' => 5.12, 'change' => 3.45],
        ['symbol' => 'SOL', 'name' => 'Solana', 'network' => 'Solana', 'price' => 184.27, 'change' => 2.18],
        ['symbol' => 'XRP', 'name' => 'Ripple', 'network' => 'XRP Ledger', 'price' => 2.34, 'change' => -1.12],
        ['symbol' => 'BNB', 'name' => 'BNB', 'network' => 'BNB Smart Chain', 'price' => 612.40, 'change' => 0.45],
    ];
@endphp
<section class="sc-section sc-rates" id="rates">
    <div class="container">
        <div class="sc-section-head">
            <div>
                <span class="sc-kicker">@lang('02 / Онлайн курсы')</span>
                <h2>@lang('Курсы в реальном времени')</h2>
            </div>
            <span class="sc-refresh"><i class="fa-regular fa-arrows-rotate"></i>@lang('Обновляется онлайн')</span>
        </div>
        <div class="sc-ticker">
            <div class="sc-ticker-track">
                @foreach(array_merge($scAssets, $scAssets) as $asset)
                    <span>
                        <strong>{{ $asset['symbol'] }}/RUB</strong>
                        <em>{{ number_format($asset['price'] * 90, $asset['price'] < 10 ? 2 : 0, '.', ' ') }} ₽</em>
                        <b class="{{ $asset['change'] >= 0 ? 'is-up' : 'is-down' }}">
                            {{ $asset['change'] >= 0 ? '+' : '' }}{{ number_format($asset['change'], 2) }}%
                        </b>
                    </span>
                @endforeach
            </div>
        </div>
        <div class="sc-table-card">
            <table>
                <thead>
                    <tr>
                        <th>@lang('Пара')</th>
                        <th>@lang('Сеть')</th>
                        <th class="text-end">@lang('Цена, RUB')</th>
                        <th class="text-end">@lang('24ч')</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($scAssets as $asset)
                        <tr>
                            <td>
                                <span class="sc-coin">{{ substr($asset['symbol'], 0, 2) }}</span>
                                <strong>{{ $asset['symbol'] }}</strong>
                                <small>{{ $asset['name'] }}</small>
                            </td>
                            <td>{{ $asset['network'] }}</td>
                            <td class="text-end">{{ number_format($asset['price'] * 90, $asset['price'] < 10 ? 2 : 0, '.', ' ') }} ₽</td>
                            <td class="text-end {{ $asset['change'] >= 0 ? 'is-up' : 'is-down' }}">
                                {{ $asset['change'] >= 0 ? '+' : '' }}{{ number_format($asset['change'], 2) }}%
                            </td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
    </div>
</section>
<!-- Rates section end -->
