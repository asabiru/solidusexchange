<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Solidus Exchange</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        :root {
            --bg: var(--tg-theme-bg-color, #0b0608);
            --text: var(--tg-theme-text-color, #f5ede4);
            --hint: var(--tg-theme-hint-color, #9a8e86);
            --link: var(--tg-theme-link-color, #c9a227);
            --button: var(--tg-theme-button-color, #c9a227);
            --button-text: var(--tg-theme-button-text-color, #0b0608);
            --secondary-bg: var(--tg-theme-secondary-bg-color, #1a1216);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            overflow-x: hidden;
        }
        .app-header {
            padding: 1rem;
            text-align: center;
            border-bottom: 1px solid rgba(201, 162, 39, 0.15);
        }
        .app-header h1 {
            font-size: 1.25rem;
            color: var(--link);
            margin-bottom: 0.25rem;
        }
        .app-header p {
            font-size: 0.8rem;
            color: var(--hint);
        }
        .rates-section {
            padding: 1rem;
        }
        .rate-card {
            background: var(--secondary-bg);
            border-radius: 0.75rem;
            padding: 0.875rem 1rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border: 1px solid rgba(201, 162, 39, 0.08);
        }
        .rate-pair {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .rate-pair img {
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
        }
        .rate-pair span {
            font-weight: 600;
            font-size: 0.9rem;
        }
        .rate-value {
            font-weight: 700;
            color: var(--link);
            font-size: 0.95rem;
        }
        .rate-change {
            font-size: 0.75rem;
            padding: 0.15rem 0.4rem;
            border-radius: 0.25rem;
            margin-left: 0.5rem;
        }
        .rate-change.up {
            background: rgba(40, 167, 69, 0.15);
            color: #4ade80;
        }
        .rate-change.down {
            background: rgba(220, 53, 69, 0.15);
            color: #f87171;
        }
        .action-buttons {
            padding: 1rem;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
        }
        .btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            border-radius: 0.75rem;
            border: none;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            transition: opacity 0.2s;
        }
        .btn:active { opacity: 0.8; }
        .btn-primary {
            background: var(--button);
            color: var(--button-text);
        }
        .btn-secondary {
            background: var(--secondary-bg);
            color: var(--text);
            border: 1px solid rgba(201, 162, 39, 0.15);
        }
        .btn svg {
            width: 1.5rem;
            height: 1.5rem;
            margin-bottom: 0.35rem;
        }
        .news-section {
            padding: 1rem;
        }
        .news-title {
            font-size: 0.85rem;
            color: var(--hint);
            margin-bottom: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .news-item {
            background: var(--secondary-bg);
            border-radius: 0.75rem;
            padding: 0.875rem 1rem;
            margin-bottom: 0.5rem;
            border: 1px solid rgba(201, 162, 39, 0.08);
        }
        .news-item h4 {
            font-size: 0.85rem;
            margin-bottom: 0.25rem;
        }
        .news-item p {
            font-size: 0.75rem;
            color: var(--hint);
        }
        .footer-note {
            text-align: center;
            padding: 1rem;
            font-size: 0.7rem;
            color: var(--hint);
        }
        .loader {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 200px;
        }
        .spinner {
            width: 2rem;
            height: 2rem;
            border: 2px solid rgba(201, 162, 39, 0.2);
            border-top-color: var(--link);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="app-header">
        <h1>Solidus Exchange</h1>
        <p>Криптообменник №1</p>
    </div>

    <div id="app-content">
        <div class="loader"><div class="spinner"></div></div>
    </div>

    <div class="footer-note">
        Mini App v1.0 | solidchange.online
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        async function loadRates() {
            try {
                const res = await fetch('/api/crypto-rates');
                const data = await res.json();
                renderRates(data.rates || []);
            } catch (e) {
                document.getElementById('app-content').innerHTML = '<div style="padding:2rem;text-align:center;color:var(--hint)">Не удалось загрузить курсы</div>';
            }
        }

        function renderRates(rates) {
            let html = '<div class="rates-section">';
            html += '<div class="news-title">Популярные курсы</div>';

            const popular = ['BTC', 'ETH', 'USDT_TRC20', 'TON'];
            const filtered = rates.filter(r => popular.includes(r.code));

            if (!filtered.length) {
                html += '<div style="color:var(--hint);font-size:0.85rem">Нет данных</div>';
            }

            filtered.forEach(r => {
                const change = r.change_24h || 0;
                const changeClass = change >= 0 ? 'up' : 'down';
                const changeSign = change >= 0 ? '+' : '';
                html += `
                    <div class="rate-card">
                        <div class="rate-pair">
                            <img src="${r.image || '/assets/upload/cryptoCurrency/default.png'}" alt="${r.code}">
                            <span>${r.code}</span>
                        </div>
                        <div>
                            <span class="rate-value">${Number(r.rate || 0).toLocaleString('ru-RU')} ₽</span>
                            <span class="rate-change ${changeClass}">${changeSign}${Number(change).toFixed(2)}%</span>
                        </div>
                    </div>
                `;
            });

            html += '</div>';

            html += `<div class="action-buttons">
                <a href="https://solidchange.online" target="_blank" class="btn btn-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                    Обменять
                </a>
                <a href="https://solidchange.online/user/ticket-create" target="_blank" class="btn btn-secondary">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                    Поддержка
                </a>
            </div>`;

            html += '<div class="news-section"><div class="news-title">Новости</div>';
            html += '<div class="news-item"><h4>Запуск Mini App</h4><p>Теперь обменивать криптовалюту можно прямо в Telegram!</p></div>';
            html += '<div class="news-item"><h4>Новые способы оплаты</h4><p>Добавлены SBP QR и P2P переводы для покупки и продажи.</p></div>';
            html += '</div>';

            document.getElementById('app-content').innerHTML = html;
        }

        loadRates();
    </script>
</body>
</html>
