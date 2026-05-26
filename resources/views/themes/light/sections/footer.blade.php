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
                <div class="footer-social">
                    <a href="#" class="social-link">
                        <i class="fa-brands fa-telegram"></i>
                    </a>
                    <a href="#" class="social-link">
                        <i class="fa-brands fa-twitter"></i>
                    </a>
                    <a href="#" class="social-link">
                        <i class="fa-brands fa-discord"></i>
                    </a>
                </div>
            </div>
        </div>

        <div class="footer-links">
            <div class="footer-column">
                <h4 class="footer-column-title">Навигация</h4>
                <ul class="footer-column-list">
                    <li><a href="#exchange">Обмен</a></li>
                    <li><a href="#rates">Курсы</a></li>
                    <li><a href="#reserves">Резервы</a></li>
                    <li><a href="#how">Как работает</a></li>
                    <li><a href="#faq">FAQ</a></li>
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
                <div class="contact-item">
                    <i class="fa-solid fa-envelope"></i>
                    <span>support@solidchange.online</span>
                </div>
                <div class="contact-item">
                    <i class="fa-brands fa-telegram"></i>
                    <span>@solidchange</span>
                </div>
            </div>
            <div class="footer-column">
                <h4 class="footer-column-title">Подписка</h4>
                <p class="newsletter-text">Получайте новости о курсах и акциях</p>
                <form class="newsletter-form">
                    <input type="email" class="newsletter-input" placeholder="Ваш email">
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
                        <a href="#" class="language-link">RU</a>
                        <a href="#" class="language-link">EN</a>
                    </div>
                </div>
            </div>
        </div>
    </div>
</footer>