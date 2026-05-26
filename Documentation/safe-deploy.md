# Safe Deploy

## Цель

Безопасный деплой для Linux/VPS с:

- отдельными папками `releases`
- общим `shared/.env`
- общим `shared/storage`
- атомарным переключением `current`
- коротким maintenance mode во время переключения
- быстрым rollback

## Структура на сервере

```text
/var/www/coinectra
  current -> /var/www/coinectra/releases/20260314120000
  previous -> /var/www/coinectra/releases/20260313195500
  releases/
  shared/
    .env
    storage/
    bootstrap/cache/
```

## Важно для этого проекта

У проекта нет стандартной папки `public`. Веб-корень сервера нужно направлять на:

```text
/var/www/coinectra/current
```

а не на `/public`.

## Что уже добавлено

- deploy script: [`deployment/deploy.sh`](/c:/Users/stasb/Desktop/проект/deployment/deploy.sh)
- rollback script: [`deployment/rollback.sh`](/c:/Users/stasb/Desktop/проект/deployment/rollback.sh)
- GitHub Actions template: [`.github/workflows/deploy.yml.example`](/c:/Users/stasb/Desktop/проект/.github/workflows/deploy.yml.example)

## One-time setup на сервере

Создать директории:

```bash
mkdir -p /var/www/coinectra/shared/storage
mkdir -p /var/www/coinectra/shared/bootstrap/cache
mkdir -p /var/www/coinectra/releases
```

Положить production `.env` в:

```bash
/var/www/coinectra/shared/.env
```

Если у вас уже есть рабочий `storage`, перенесите его в:

```bash
/var/www/coinectra/shared/storage
```

## Первый деплой вручную

```bash
export APP_ROOT=/var/www/coinectra
export REPO_URL=git@github.com:YOUR_ACCOUNT/YOUR_REPO.git
export BRANCH=main
export PHP_BIN=php
export COMPOSER_BIN=composer
export KEEP_RELEASES=5

bash /path/to/repo/deployment/deploy.sh
```

## Rollback

```bash
export APP_ROOT=/var/www/coinectra
export PHP_BIN=php

bash /var/www/coinectra/current/deployment/rollback.sh
```

## Что делает deploy script

1. Переводит текущий релиз в maintenance mode.
2. Клонирует новый релиз в `releases/<timestamp>`.
3. Подключает `shared/.env` и `shared/storage`.
4. Выполняет `composer install --no-dev`.
5. Выполняет `artisan migrate --force`.
6. Собирает Laravel caches.
7. Переключает symlink `current`.
8. Выполняет `artisan up` и `queue:restart`.
9. Очищает старые релизы.

## Требования к миграциям

Для безопасного деплоя миграции должны быть backward-compatible:

- сначала добавлять новые поля и таблицы
- не ломать старый код до переключения релиза
- destructive changes выносить в отдельный релиз

## GitHub Actions

Когда проект будет в git-репозитории:

1. Переименуйте `.github/workflows/deploy.yml.example` в `deploy.yml`
2. Добавьте secrets:
   - `DEPLOY_HOST`
   - `DEPLOY_PORT`
   - `DEPLOY_USER`
   - `DEPLOY_SSH_KEY`
   - `DEPLOY_PATH`
   - `DEPLOY_REPO`
   - `DEPLOY_BRANCH`
   - `DEPLOY_PHP_BIN`
   - `DEPLOY_COMPOSER_BIN`
   - `DEPLOY_KEEP_RELEASES`

На первом этапе лучше оставить только `workflow_dispatch`, а автодеплой на `push` включать уже после ручной проверки.

## Очереди и scheduler

После деплоя должны продолжать работать:

```bash
php artisan queue:work
php artisan schedule:work
```

Их лучше держать под `supervisor` или `systemd`, а не в ручных терминалах.

## Безопасность

- Никогда не храните production `.env` в репозитории.
- Не коммитьте приватные ключи и SSH-доступы.
- Для GitHub Actions используйте отдельный deploy key или отдельного deploy user.
- Если в старых файлах-примерах были реальные ключи, их нужно заменить и ротировать.
