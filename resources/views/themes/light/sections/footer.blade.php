<!-- Footer Section -->
<footer class="footer-section">
    <div class="container">
        <div class="footer-content">
            <div class="footer-grid">
                <!-- Logo & Description -->
                <div class="footer-brand">
                    <div class="footer-logo">
                        <div class="logo-badge">SC</div>
                        <span class="footer-brand-name">SolidChange</span>
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

                <!-- Quick Links -->
                <div class="footer-links">
                    <h4 class="footer-title">Навигация</h4>
                    <ul class="footer-nav">
                        <li><a href="#exchange">Обмен</a></li>
                        <li><a href="#rates">Курсы</a></li>
                        <li><a href="#reserves">Резервы</a></li>
                        <li><a href="#how">Как работает</a></li>
                        <li><a href="#faq">FAQ</a></li>
                    </ul>
                </div>

                <!-- Support -->
                <div class="footer-links">
                    <h4 class="footer-title">Поддержка</h4>
                    <ul class="footer-nav">
                        <li><a href="{{ url('tracking') }}">Отследить заявку</a></li>
                        <li><a href="{{ route('contact') }}">Контакты</a></li>
                        <li><a href="{{ route('page', ['slug' => 'terms']) }}">Условия использования</a></li>
                        <li><a href="{{ route('page', ['slug' => 'privacy']) }}">Политика конфиденциальности</a></li>
                    </ul>
                </div>

                <!-- Contact -->
                <div class="footer-contact">
                    <h4 class="footer-title">Контакты</h4>
                    <div class="contact-item">
                        <i class="fa-solid fa-envelope"></i>
                        <span>support@solidchange.online</span>
                    </div>
                    <div class="contact-item">
                        <i class="fa-brands fa-telegram"></i>
                        <span>@solidchange</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="footer-bottom">
            <p>&copy; {{ date('Y') }} SolidChange. Все права защищены.</p>
        </div>
    </div>
</footer>

<style>
    .footer-section {
        background: var(--color-bg);
        border-top: 1px solid var(--color-border-subtle);
        padding: 60px 0 20px;
        margin-top: 80px;
    }

    .footer-content {
        margin-bottom: 40px;
    }

    .footer-grid {
        display: grid;
        grid-template-columns: 2fr 1fr 1fr 1fr;
        gap: 40px;
    }

    .footer-brand {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .footer-logo {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .logo-badge {
        display: flex;
        height: 32px;
        width: 32px;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 1px solid var(--color-border-strong);
        font-size: 11px;
        font-weight: bold;
        background: var(--color-accent);
        color: #0b0608;
    }

    .footer-brand-name {
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .footer-description {
        color: var(--color-text-secondary);
        font-size: 14px;
        line-height: 1.6;
        max-width: 300px;
    }

    .footer-social {
        display: flex;
        gap: 12px;
    }

    .social-link {
        display: flex;
        height: 36px;
        width: 36px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        text-decoration: none;
        transition: all 0.2s;
        border: 1px solid var(--color-border-subtle);
    }

    .social-link:hover {
        background: var(--color-accent);
        color: #0b0608;
        border-color: var(--color-accent);
    }

    .footer-links h4,
    .footer-contact h4 {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 16px;
    }

    .footer-nav {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .footer-nav li a {
        color: var(--color-text-secondary);
        text-decoration: none;
        font-size: 14px;
        transition: color 0.2s;
    }

    .footer-nav li a:hover {
        color: var(--color-accent);
    }

    .footer-contact {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .contact-item {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--color-text-secondary);
        font-size: 14px;
    }

    .contact-item i {
        color: var(--color-accent);
    }

    .footer-bottom {
        padding-top: 20px;
        border-top: 1px solid var(--color-border-subtle);
        text-align: center;
        color: var(--color-text-secondary);
        font-size: 13px;
    }

    @media (max-width: 992px) {
        .footer-grid {
            grid-template-columns: 1fr 1fr;
        }
    }

    @media (max-width: 576px) {
        .footer-grid {
            grid-template-columns: 1fr;
        }
    }
</style>