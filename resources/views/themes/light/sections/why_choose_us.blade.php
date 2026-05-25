<!-- Reserves section start -->
@php
    $reserveAssets = [
        ['symbol' => 'BTC', 'name' => 'Bitcoin', 'network' => 'Bitcoin', 'reserve' => 12.4, 'usd' => 1195758],
        ['symbol' => 'ETH', 'name' => 'Ethereum', 'network' => 'Ethereum', 'reserve' => 184.7, 'usd' => 606667],
        ['symbol' => 'USDT', 'name' => 'Tether', 'network' => 'TRC-20', 'reserve' => 482300, 'usd' => 482300],
        ['symbol' => 'USDC', 'name' => 'USD Coin', 'network' => 'Ethereum', 'reserve' => 218400, 'usd' => 218400],
        ['symbol' => 'TON', 'name' => 'Toncoin', 'network' => 'TON', 'reserve' => 28500, 'usd' => 145920],
        ['symbol' => 'SOL', 'name' => 'Solana', 'network' => 'Solana', 'reserve' => 612, 'usd' => 112773],
    ];
    $totalReserve = array_sum(array_column($reserveAssets, 'usd'));
@endphp
<section class="sc-section sc-reserves" id="reserves">
    <div class="container">
        <div class="sc-section-head">
            <div>
                <span class="sc-kicker">@lang('07 / Резервы и доверие')</span>
                <h2>@lang('Резервы 1:1, проверяйте сами')</h2>
            </div>
            <div class="sc-reserve-total">
                <span>@lang('Общий резерв')</span>
                <strong>{{ number_format(($totalReserve * 90) / 1000000, 1) }}M ₽</strong>
            </div>
        </div>
        <div class="sc-table-card">
            <table>
                <thead>
                    <tr>
                        <th>@lang('Актив')</th>
                        <th>@lang('Сеть')</th>
                        <th class="text-end">@lang('Резерв')</th>
                        <th class="text-end">@lang('RUB')</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($reserveAssets as $asset)
                        <tr>
                            <td>
                                <span class="sc-coin">{{ substr($asset['symbol'], 0, 2) }}</span>
                                <strong>{{ $asset['symbol'] }}</strong>
                                <small>{{ $asset['name'] }}</small>
                            </td>
                            <td>{{ $asset['network'] }}</td>
                            <td class="text-end">{{ number_format($asset['reserve'], $asset['reserve'] < 100 ? 4 : 0) }} {{ $asset['symbol'] }}</td>
                            <td class="text-end">{{ number_format($asset['usd'] * 90, 0, '.', ' ') }} ₽</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>
        <div class="sc-kpi-grid">
            <div class="sc-info-card">
                <span>@lang('Объём за 30 дней')</span>
                <strong>1.65B ₽</strong>
            </div>
            <div class="sc-info-card">
                <span>@lang('Завершено обменов')</span>
                <strong>142 817</strong>
            </div>
            <div class="sc-info-card">
                <span>@lang('Аптайм')</span>
                <strong>99.97%</strong>
            </div>
        </div>
    </div>
</section>
<!-- Reserves section end -->
