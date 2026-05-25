@php
    $popularAssets = [
        ['symbol' => 'BTC', 'name' => 'Bitcoin', 'price' => 96432.10, 'change' => 1.84],
        ['symbol' => 'ETH', 'name' => 'Ethereum', 'price' => 3284.50, 'change' => -0.62],
        ['symbol' => 'USDT', 'name' => 'Tether', 'price' => 1.00, 'change' => 0.01],
        ['symbol' => 'USDC', 'name' => 'USD Coin', 'price' => 1.00, 'change' => -0.02],
        ['symbol' => 'TON', 'name' => 'Toncoin', 'price' => 5.12, 'change' => 3.45],
        ['symbol' => 'SOL', 'name' => 'Solana', 'price' => 184.27, 'change' => 2.18],
        ['symbol' => 'XRP', 'name' => 'Ripple', 'price' => 2.34, 'change' => -1.12],
        ['symbol' => 'BNB', 'name' => 'BNB', 'price' => 612.40, 'change' => 0.45],
    ];
@endphp
<section class="sc-section sc-popular" id="popular">
    <div class="container">
        <div class="sc-section-head">
            <div>
                <span class="sc-kicker">@lang('03 / Популярные криптовалюты')</span>
                <h2>@lang('Чаще всего обменивают')</h2>
            </div>
        </div>
        <div class="sc-card-grid sc-card-grid-4">
            @foreach($popularAssets as $asset)
                <div class="sc-info-card">
                    <div class="sc-card-top">
                        <span class="sc-coin">{{ substr($asset['symbol'], 0, 2) }}</span>
                        <span class="{{ $asset['change'] >= 0 ? 'is-up' : 'is-down' }}">
                            {{ $asset['change'] >= 0 ? '+' : '' }}{{ number_format($asset['change'], 2) }}%
                        </span>
                    </div>
                    <div>
                        <h3>{{ $asset['symbol'] }}</h3>
                        <p>{{ $asset['name'] }}</p>
                    </div>
                    <strong>{{ number_format($asset['price'] * 90, $asset['price'] < 10 ? 2 : 0, '.', ' ') }} ₽</strong>
                    <a href="#exchange" class="sc-secondary-btn">@lang('Обменять') {{ $asset['symbol'] }}</a>
                </div>
            @endforeach
        </div>
    </div>
</section>

<section class="sc-section sc-security" id="security">
    <div class="container">
        <div class="row g-4 g-lg-5 align-items-start">
            <div class="col-lg-5">
                <span class="sc-kicker">@lang('04 / Безопасность и AML / KYC')</span>
                <h2>@lang('Безопасность как у банка, скорость как у крипты')</h2>
                <p>@lang('Мы делаем доверие проверяемым: партнёры по AML-мониторингу, холодное хранение и понятные пороги KYC.')</p>
            </div>
            <div class="col-lg-7">
                <div class="sc-card-grid sc-card-grid-2">
                    <div class="sc-info-card">
                        <i class="fa-regular fa-shield-check"></i>
                        <h3>@lang('AML-проверка')</h3>
                        <p>@lang('Каждая транзакция проходит проверку через Chainalysis и Elliptic.')</p>
                    </div>
                    <div class="sc-info-card">
                        <i class="fa-regular fa-file-check"></i>
                        <h3>@lang('KYC при необходимости')</h3>
                        <p>@lang('Прозрачные пороги и стандартная процедура идентификации за несколько минут.')</p>
                    </div>
                    <div class="sc-info-card">
                        <i class="fa-regular fa-key"></i>
                        <h3>@lang('Холодное хранение')</h3>
                        <p>@lang('Резервы хранятся на защищённых кошельках, доступных для проверки.')</p>
                    </div>
                    <div class="sc-info-card">
                        <i class="fa-regular fa-eye"></i>
                        <h3>@lang('Двухфакторная аутентификация')</h3>
                        <p>@lang('Поддержка TOTP-приложений и дополнительных проверок для аккаунтов.')</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="sc-partners">
            <span>@lang('Партнёры по AML / KYC')</span>
            <strong>Chainalysis</strong>
            <strong>Elliptic</strong>
            <strong>Sumsub</strong>
            <strong>Crystal</strong>
        </div>
    </div>
</section>
<!-- Popular and security sections end -->
