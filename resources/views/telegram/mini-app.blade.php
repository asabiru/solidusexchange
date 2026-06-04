<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Solidus Telegram Mini App</title>
    <link rel="shortcut icon" href="{{ getFile(basicControl()->favicon_driver, basicControl()->favicon) }}" type="image/x-icon">
    <link rel="stylesheet" href="{{ asset('assets/global/css/solidchange-redesign.css') }}">
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body class="solidus-tma-page" data-solidus-site-theme="dark">
    @unless(Auth::check())
        <div class="solidus-tma-auth-state" data-tma-auth-state>
            <strong>Входим через Telegram</strong>
            <span>Проверяем подпись и создаём профиль автоматически</span>
        </div>
    @endunless

    <main class="solidus-tma-shell">
        <header class="solidus-tma-header">
            <a href="{{ route('page') }}" class="solidus-tma-brand" aria-label="Solidus">
                <span class="solidus-tma-brand__mark">S</span>
                <span>
                    <strong>SOLIDUS</strong>
                    <small>обмен в Telegram</small>
                </span>
            </a>
            <button class="solidus-tma-pill" type="button" data-tma-theme-toggle>
                <span data-tma-theme-label>Тёмная</span>
            </button>
        </header>

        <section class="solidus-tma-user-card">
            <div>
                <span class="solidus-tma-eyebrow">Быстрый обмен</span>
                <h1>Курсы и заявки без лишних шагов</h1>
                <p>Показываем актуальные направления, фиксируем курс и сопровождаем сделку в Telegram.</p>
            </div>
            <a href="{{ route('page') }}?source_channel=telegram_mini_app" class="solidus-tma-primary">Создать заявку</a>
        </section>

        <section class="solidus-tma-card" data-tma-panel="wallet">
            <div class="solidus-tma-section-head">
                <div>
                    <span class="solidus-tma-eyebrow">Кошелёк</span>
                    <h2>Наши курсы</h2>
                </div>
                <span class="solidus-tma-status">Live</span>
            </div>

            <div class="solidus-tma-rates">
                @forelse($rateCards as $rateCard)
                    <article class="solidus-tma-rate-card">
                        <div class="solidus-tma-coin">
                            <span>{{ mb_substr($rateCard['code'], 0, 1) }}</span>
                            <div>
                                <strong>{{ $rateCard['code'] }}</strong>
                                <small>{{ $rateCard['name'] }}</small>
                            </div>
                        </div>
                        <dl>
                            <div>
                                <dt>Покупка</dt>
                                <dd>1 {{ $rateCard['code'] }} = {{ number_format($rateCard['buy_rate'], 2, '.', ' ') }} {{ $rateCard['fiat_code'] }}</dd>
                            </div>
                            <div>
                                <dt>Продажа</dt>
                                <dd>1 {{ $rateCard['code'] }} = {{ number_format($rateCard['sell_rate'], 2, '.', ' ') }} {{ $rateCard['fiat_code'] }}</dd>
                            </div>
                        </dl>
                    </article>
                @empty
                    <article class="solidus-tma-rate-card">
                        <div class="solidus-tma-coin">
                            <span>S</span>
                            <div>
                                <strong>Курсы обновляются</strong>
                                <small>Скоро здесь появятся активные пары</small>
                            </div>
                        </div>
                    </article>
                @endforelse
            </div>
        </section>

        <section class="solidus-tma-card" data-tma-panel="exchange" hidden>
            <div class="solidus-tma-section-head">
                <div>
                    <span class="solidus-tma-eyebrow">Обмен</span>
                    <h2>Выберите сценарий</h2>
                </div>
            </div>

            <div class="solidus-tma-action-grid">
                <a href="{{ route('page') }}?mode=buy&source_channel=telegram_mini_app" class="solidus-tma-action">
                    <span>₽ → ₮</span>
                    <strong>Купить криптовалюту</strong>
                    <small>СБП/расчётный счёт/ручной P2P</small>
                </a>
                <a href="{{ route('page') }}?mode=sell&source_channel=telegram_mini_app" class="solidus-tma-action">
                    <span>₮ → ₽</span>
                    <strong>Продать криптовалюту</strong>
                    <small>Трейдер отправит фиат клиенту</small>
                </a>
                <a href="{{ route('page') }}?mode=exchange&source_channel=telegram_mini_app" class="solidus-tma-action">
                    <span>₿ → ₮</span>
                    <strong>Крипта на крипту</strong>
                    <small>Лучший курс со спредом Solidus</small>
                </a>
            </div>
        </section>

        <section class="solidus-tma-card" data-tma-panel="p2p" hidden>
            <div class="solidus-tma-section-head">
                <div>
                    <span class="solidus-tma-eyebrow">P2P</span>
                    <h2>Выгодные ручные сделки</h2>
                </div>
            </div>
            <div class="solidus-tma-steps">
                <div><span>1</span><p>Оператор находит лучший курс на официальных P2P-площадках.</p></div>
                <div><span>2</span><p>Трейдер проверяет реквизиты и подтверждает условия сделки.</p></div>
                <div><span>3</span><p>Клиент получает фиат или криптовалюту после подтверждения оплаты.</p></div>
            </div>
        </section>

        <section class="solidus-tma-card" data-tma-panel="profile" hidden>
            <div class="solidus-tma-section-head">
                <div>
                    <span class="solidus-tma-eyebrow">Профиль</span>
                    <h2>{{ $user ? e($user->firstname ?: $user->username ?: $user->email) : 'Гость Telegram' }}</h2>
                </div>
            </div>
            <div class="solidus-tma-profile-list">
                <a href="{{ Auth::check() ? route('user.verification.center') : route('login') }}">KYC-верификация <span>→</span></a>
                <a href="{{ Auth::check() ? route('user.profile') : route('login') }}">Контакты и Telegram <span>→</span></a>
                <a href="{{ route('page') }}">Условия и согласия <span>→</span></a>
            </div>
        </section>
    </main>

    <nav class="solidus-tma-nav" aria-label="Навигация Telegram Mini App">
        <button type="button" class="is-active" data-tma-tab="wallet">Кошелёк</button>
        <button type="button" data-tma-tab="exchange">Обмен</button>
        <button type="button" data-tma-tab="p2p">P2P</button>
        <button type="button" data-tma-tab="profile">Профиль</button>
    </nav>

    <script>
        (() => {
            const webApp = window.Telegram?.WebApp;
            webApp?.ready();
            webApp?.expand();

            const root = document.body;
            const panels = document.querySelectorAll('[data-tma-panel]');
            const tabs = document.querySelectorAll('[data-tma-tab]');
            const themeButton = document.querySelector('[data-tma-theme-toggle]');
            const themeLabel = document.querySelector('[data-tma-theme-label]');
            const authState = document.querySelector('[data-tma-auth-state]');
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            const applyTheme = (theme) => {
                root.dataset.solidusSiteTheme = theme;
                if (themeLabel) {
                    themeLabel.textContent = theme === 'light' ? 'Светлая' : 'Тёмная';
                }
            };

            applyTheme(webApp?.colorScheme === 'light' ? 'light' : 'dark');

            if (authState && webApp?.initData && csrfToken) {
                fetch(@json(route('telegram.mini-app')), {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': csrfToken,
                        'X-Telegram-Init-Data': webApp.initData,
                    },
                    body: JSON.stringify({ initData: webApp.initData }),
                    credentials: 'same-origin',
                })
                    .then((response) => {
                        if (!response.ok) {
                            throw new Error('telegram-auth-failed');
                        }
                        return response.json();
                    })
                    .then((payload) => {
                        if (payload.authenticated) {
                            window.location.reload();
                            return;
                        }
                        throw new Error('telegram-auth-failed');
                    })
                    .catch(() => {
                        authState.classList.add('is-error');
                        authState.querySelector('strong').textContent = 'Telegram-вход недоступен';
                        authState.querySelector('span').textContent = 'Откройте Mini App из Telegram или попробуйте ещё раз.';
                    });
            } else if (authState) {
                authState.classList.add('is-muted');
                authState.querySelector('strong').textContent = 'Демо-режим';
                authState.querySelector('span').textContent = 'Автоматический вход включится при открытии из Telegram.';
            }

            tabs.forEach((tab) => {
                tab.addEventListener('click', () => {
                    const target = tab.dataset.tmaTab;
                    tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
                    panels.forEach((panel) => {
                        panel.hidden = panel.dataset.tmaPanel !== target;
                    });
                    webApp?.HapticFeedback?.impactOccurred('light');
                });
            });

            themeButton?.addEventListener('click', () => {
                applyTheme(root.dataset.solidusSiteTheme === 'light' ? 'dark' : 'light');
            });
        })();
    </script>
</body>
</html>
