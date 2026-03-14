# Sumsub Local Setup

## Что уже добавлено в проект

- Глобальные настройки Sumsub в админке: `Admin -> Settings -> KYC Provider Settings`
- Режим `manual / sumsub` в настройках каждой KYC-формы
- Выдача SDK-токена для пользовательской KYC-страницы
- Webhook endpoint для Sumsub:

```text
/api/kyc/sumsub/webhook
```

## Что заполнить локально

В `KYC Provider Settings`:

- `Enable Sumsub`
- `App Token`
- `Secret Key`
- `API Base URL`
- `Default Level Name`
- `WebSDK URL`

Рекомендуемые значения:

```text
API Base URL: https://api.sumsub.com
WebSDK URL: https://static.sumsub.com/idensic/static/sns-websdk-builder.js
```

## Как включить Sumsub для конкретной KYC-формы

1. Откройте `Admin -> KYC Setting -> Create` или `Edit`.
2. В поле `Provider` выберите `Sumsub`.
3. При необходимости задайте `Sumsub Level Name`.
4. Сохраните форму.

После этого локальный конструктор полей для этой формы не используется.

## Ограничение локального запуска

Локально вы сможете:

- сохранить ключи;
- открыть KYC-страницу пользователя;
- запросить SDK access token;
- проверить, что форма запускается.

Локально вы не сможете полноценно проверить webhook без публичного HTTPS URL.

## Что сделать уже на сервере

1. Обновить `APP_URL`.
2. В кабинете Sumsub указать webhook URL:

```text
https://ваш-домен/api/kyc/sumsub/webhook
```

3. Проверить allowed origin / domain для WebSDK.
4. Пройти тестовый KYC и сверить обновление `user_kycs` и `users.identity_verify`.
