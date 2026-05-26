<!-- Footer Section -->
<footer class="footer-section">
    <div class="container">
        <div class="footer-top">
            <div class="footer-brand">
                <div class="footer-logo">
                    <div class="logo-badge">SC</div>
                    <span class="logo-text">SolidChange</span>
                </div>
                <p class="footer-description">
                    Надежная криптовалютная биржа для обмена цифровых активов с лучшими курсами и мгновенными транзакциями.
                </p>
                @php
                    $socialLinks = \App\Models\ContentDetails::with('content')
                        ->whereHas('content', fn($q) => $q->where('name', 'social'))
                        ->where('language_id', app()->getLocale() === 'ru' ? 20 : 1)
                        ->get()
                        ->map(fn($d) => json_decode($d->description))
                        ->filter(fn($s) => $s && !empty($s->my_link));
                    if ($socialLinks->isEmpty()) {
                        $socialLinks = \App\Models\ContentDetails::with('content')
                            ->whereHas('content', fn($q) => $q->where('name', 'social'))
                            ->where('language_id', 1)
                            ->get()
                            ->map(fn($d) => json_decode($d->description))
                            ->filter(fn($s) => $s && !empty($s->my_link));
                    }
                @endphp
                <div class="footer-social">
                    @foreach($socialLinks as $social)
                        @php
                            $isEmail = str_starts_with($social->my_link ?? '', 'mailto:');
                        @endphp
                        <a href="{{ $social->my_link }}"
                           class="social-link"
                           {{ $isEmail ? '' : 'target="_blank" rel="noopener"' }}>
                            <i class="{{ $social->icon ?? 'fa-solid fa-link' }}"></i>
                        </a>
                    @endforeach
                </div>
            </div>
        </div>

        <div class="footer-links">
            <div class="footer-column">
                <h4 class="footer-column-title">Навигация</h4>
                <ul class="footer-column-list">
                    <li><a href="{{ url('/#exchange') }}">Обмен</a></li>
                    <li><a href="{{ url('/#rates') }}">Курсы</a></li>
                    <li><a href="{{ url('/#reserves') }}">Резервы</a></li>
                    <li><a href="{{ url('/#how') }}">Как работает</a></li>
                    <li><a href="{{ url('/#faq') }}">FAQ</a></li>
                </ul>
            </div>
            <div class="footer-column">
                <h4 class="footer-column-title">Поддержка</h4>
                <ul class="footer-column-list">
                    <li><a href="{{ url('tracking') }}">Отследить заявку</a></li>
                    <li><a href="{{ route('contact') }}">Контакты</a></li>
                    <li><a href="{{ route('page', ['slug' => 'terms']) }}">Условия использования</a></li>
                    <li><a href="{{ route('page', ['slug' => 'privacy']) }}">Политика конфиденциальности</a></li>
                </ul>
            </div>
            <div class="footer-column">
                <h4 class="footer-column-title">Контакты</h4>
                <a href="mailto:support@solidchange.online" class="contact-item">
                    <i class="fa-solid fa-envelope"></i>
                    <span>support@solidchange.online</span>
                </a>
                <a href="https://t.me/solidchange" class="contact-item" target="_blank" rel="noopener">
                    <i class="fa-brands fa-telegram"></i>
                    <span>@solidchange</span>
                </a>
            </div>
            <div class="footer-column">
                <h4 class="footer-column-title">Подписка</h4>
                <p class="newsletter-text">Получайте новости о курсах и акциях</p>
                <form class="newsletter-form" action="{{ route('subscribe') }}" method="post">
                    @csrf
                    <input type="email" name="email" class="newsletter-input" placeholder="Ваш email" required>
                    <button type="submit" class="newsletter-button">Подписаться</button>
                </form>
            </div>
        </div>

        <div class="footer-bottom">
            <div class="footer-disclaimer">
                <p><strong>Риск-уведомление:</strong> Криптовалюты являются высокорисковым активом. Инвестируйте ответственно.</p>
            </div>
            <div class="footer-copyright">
                <p>&copy; {{ date('Y') }} SolidChange. Все права защищены.</p>
                <div class="footer-meta">
                    <div class="footer-language">
                        <a href="{{ route('language', ['locale' => 'ru', 'redirect' => request()->getRequestUri()]) }}" class="language-link">RU</a>
                        <a href="{{ route('language', ['locale' => 'en', 'redirect' => request()->getRequestUri()]) }}" class="language-link">EN</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
</footer>