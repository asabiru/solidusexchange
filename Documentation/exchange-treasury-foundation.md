# Exchange Treasury Foundation

## Что Уже Заложено

Первый этап новой `crypto -> crypto` архитектуры уже вынесен в отдельный pipeline:

- `ExchangeSettlementService` отвечает за выдачу входящего deposit address и сохраняет метаданные provider-а в `exchange_requests`
- `ExchangeAmlService` отвечает за AML-gate перед автоматическим hedge/payout
- `WebhookController` теперь умеет искать exchange не только по `utr`, но и по `deposit_provider_ref`

## Новые Поля В `exchange_requests`

- `deposit_provider`
- `deposit_provider_ref`
- `deposit_network`
- `payout_provider`
- `aml_status`
- `aml_provider`
- `aml_risk_level`
- `aml_risk_score`
- `aml_notes`
- `aml_checked_at`

## Новые ENV Параметры

```env
EXCHANGE_PIPELINE_DEPOSIT_PROVIDER=active_crypto_method
EXCHANGE_PIPELINE_PAYOUT_PROVIDER=active_crypto_method
EXCHANGE_AML_ENABLED=false
EXCHANGE_AML_PROVIDER=manual
EXCHANGE_AML_AUTO_BLOCK_PROCESSING=true
```

## Что Это Даёт Сейчас

- текущий продакшен-поток остаётся совместимым с `CryptoCloud`
- можно включить AML-gate без переписывания exchange flow
- можно подключить отдельный wallet/provider слой, не трогая контроллеры и webhook-роутинг

## Что Делать Следом

Следующий этап для low-fee схемы:

1. добавить отдельный inbound wallet provider вместо `active_crypto_method`
2. подключить реальный AML screening provider вместо `manual`
3. вынести payout с `CryptoCloud` в отдельный treasury payout layer
4. оставить `Bybit` только для hedge и рыночной котировки

## Что Уже Можно Сделать

Если хотите начать снижать входящую комиссию без полной переделки payout:

```env
EXCHANGE_PIPELINE_DEPOSIT_PROVIDER=treasury_wallet
EXCHANGE_PIPELINE_PAYOUT_PROVIDER=crypto_cloud
```

Тогда exchange будет:

- брать входящий депозитный адрес из inventory `exchange_wallets`
- оставлять payout на `CryptoCloud`
- ждать ручного подтверждения on-chain депозита админом через карточку exchange

## Что Появилось На Этом Этапе

- `ExchangeWallet` inventory для отдельных депозитных адресов
- `treasury_wallet` provider для exchange deposits
- отдельный admin раздел `Exchange Wallets`
- ручное подтверждение депозита для exchange со статусом `Awaiting Deposit`
