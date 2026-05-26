<!-- Footer Section - eazy228/design style -->
<footer class="footer-section">
    <div class="container">
        <div class="footer-top">
            <div class="footer-brand">
                <div class="footer-logo">
                    <div class="logo-badge">SC</div>
                    <span class="logo-text">SolidChange</span>
                </div>
                <p class="footer-description">
                    Обменник криптовалют с открытыми резервами, прозрачными комиссиями и AML-проверкой каждой сделки.
                </p>
            </div>

            <div class="footer-newsletter">
                <h4 class="newsletter-title">Подписаться</h4>
                <p class="newsletter-text">Только обновления сервиса. Без спама.</p>
                <form class="newsletter-form">
                    <input type="email" placeholder="Введите email" class="newsletter-input">
                    <button type="submit" class="newsletter-button">Подписаться</button>
                </form>
            </div>
        </div>

        <div class="footer-links">
            <div class="footer-column">
                <h5 class="footer-column-title">Сервис</h5>
                <ul class="footer-column-list">
                    <li><a href="{{ route('home') }}#exchange">Обмен</a></li>
                    <li><a href="{{ route('home') }}#rates">Курсы</a></li>
                    <li><a href="{{ route('home') }}#reserves">Резервы</a></li>
                    <li><a href="#">Статус</a></li>
                </ul>
            </div>

            <div class="footer-column">
                <h5 class="footer-column-title">Поддержка</h5>
                <ul class="footer-column-list">
                    <li><a href="{{ route('home') }}#faq">FAQ</a></li>
                    <li><a href="{{ route('contact') }}">Контакты</a></li>
                    <li><a href="#">Чат</a></li>
                    <li><a href="#">Telegram-канал</a></li>
                </ul>
            </div>

            <div class="footer-column">
                <h5 class="footer-column-title">Юридическое</h5>
                <ul class="footer-column-list">
                    <li><a href="#">Условия использования</a></li>
                    <li><a href="#">Политика конфиденциальности</a></li>
                    <li><a href="#">AML-политика</a></li>
                    <li><a href="#">KYC-политика</a></li>
                    <li><a href="#">Cookies</a></li>
                </ul>
            </div>

            <div class="footer-column">
                <h5 class="footer-column-title">Контакты</h5>
                @if(isset($extraInfo['contact'][0]->description))
                <ul class="footer-column-list">
                    <li class="contact-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                            <circle cx="12" cy="10" r="3"></circle>
                        </svg>
                        {{@$extraInfo['contact'][0]->description->address}}
                    </li>
                    <li class="contact-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                            <polyline points="22,6 12,13 2,6"></polyline>
                        </svg>
                        {{@$extraInfo['contact'][0]->description->email}}
                    </li>
                    <li class="contact-item">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                        {{@$extraInfo['contact'][0]->description->phone}}
                    </li>
                </ul>
                @endif

                @if(isset($extraInfo['social']) && count($extraInfo['social']) > 0)
                <div class="footer-social">
                    @foreach($extraInfo['social'] as $social)
                    <a href="{{@$social->content->media->my_link}}" class="social-link">
                        <i class="{{@$social->content->media->icon}}"></i>
                    </a>
                    @endforeach
                </div>
                @endif
            </div>
        </div>

        <div class="footer-bottom">
            <div class="footer-disclaimer">
                <p><strong>Дисклеймер.</strong> Криптовалюты — высокорисковый актив. Курс может меняться значительно и быстро. Используя сервис, вы подтверждаете, что осознаёте риски и соглашаетесь с условиями использования и AML-политикой.</p>
            </div>

            <div class="footer-copyright">
                <p>© {{ date('Y') }} SolidChange. Все права защищены.</p>
                <div class="footer-meta">
                    <span>Юрисдикция: ЕС</span>
                    <span>Лицензия: SC-2025-0142</span>
                    @if(isset($languages))
                    <div class="footer-language">
                        @foreach($languages as $item)
                        <a href="{{ route('language', ['locale' => $item->short_name, 'redirect' => request()->getRequestUri()]) }}" class="language-link">
                            {{ strtoupper($item->short_name) }}
                        </a>
                        @endforeach
                    </div>
                    @endif
                </div>
            </div>
        </div>
    </div>
</footer>