# Bybit Exchange Engine

## Что Делает Этот Модуль

- Для `exchange` на поддержанных парах вида `USDT -> coin` котировка теперь может браться не из локального `usd_rate`, а из Bybit spot.
- После подтверждения входящего депозита система может:
  1. купить на Bybit ровно ту сумму монеты, которую нужно отправить клиенту;
  2. оставить разницу в `USDT`;
  3. отправить клиенту монету через активный автоматический `CryptoMethod`.

## Что Нужно Настроить

Добавьте в `.env`:

```env
EXCHANGE_ENGINE_ENABLED=true
EXCHANGE_ENGINE_DRIVER=bybit
EXCHANGE_ENGINE_SUPPORTED_SEND_CURRENCIES=USDT
EXCHANGE_ENGINE_QUOTE_TTL_SECONDS=30
EXCHANGE_ENGINE_MARKUP_PERCENT=1.00
EXCHANGE_ENGINE_SLIPPAGE_PERCENT=0.20
EXCHANGE_ENGINE_TRADE_FEE_PERCENT=0.10
EXCHANGE_ENGINE_AUTO_PROCESS_AFTER_DEPOSIT=true
EXCHANGE_ENGINE_AUTO_PAYOUT_AFTER_HEDGE=true

BYBIT_TESTNET=false
BYBIT_API_KEY=your_bybit_api_key
BYBIT_API_SECRET=your_bybit_api_secret
BYBIT_RECV_WINDOW=5000
BYBIT_TIMEOUT=10
```

Если нужен тестовый контур Bybit:

```env
BYBIT_TESTNET=true
BYBIT_BASE_URL=https://api-testnet.bybit.com
```

## Ограничения Первой Реализации

- Биржевой движок сейчас включается только для пар, где входящая монета входит в `EXCHANGE_ENGINE_SUPPORTED_SEND_CURRENCIES`.
- Основной целевой сценарий: `USDT -> BTC`, `USDT -> ETH` и другие spot-пары Bybit без сетевых суффиксов в коде монеты.
- Выплата клиенту идёт через активный автоматический `CryptoMethod`, а не с Bybit напрямую.
- Для `floating` заявок перед автохеджем делается повторная котировка.
- Если hedge или payout не удались, заявка остаётся в `status = 2`, а ошибка сохраняется в `exchange_requests.hedge_error`.
