<!-- Hero Section - eazy228/design style -->
<section class="hero-section" id="exchange">
    <div class="hero-grid"></div>
    <div class="container">
        <div class="row align-items-center">
            <!-- Left Content -->
            <div class="col-lg-6">
                <div class="hero-content">
                    <div class="hero-badge">
                        <span class="badge-text">Среднее время обмена — около 7 минут</span>
                    </div>
                    <h1 class="hero-title">
                        Обмен криптовалют<br>
                        <span class="highlight">без скрытых комиссий</span>
                    </h1>
                    <p class="hero-description">
                        Прозрачные курсы, открытые резервы и понятные условия. Видите итог до того, как нажмёте «Обменять» — без сюрпризов.
                    </p>
                    <div class="hero-bullets">
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                                </svg>
                            </div>
                            <span>Прозрачные резервы</span>
                        </div>
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                </svg>
                            </div>
                            <span>Проверка AML</span>
                        </div>
                        <div class="bullet-item">
                            <div class="bullet-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
                                </svg>
                            </div>
                            <span>Поддержка 24/7</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Content - SwapCard -->
            <div class="col-lg-6">
                @include($theme.'partials.exchange-module.swap-widget')
            </div>
        </div>
    </div>
</section>
