#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$HOME/public_html}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
BRANCH="${BRANCH:-main}"
PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"

cd "${APP_DIR}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "APP_DIR is not a git repository: ${APP_DIR}"
  exit 1
fi

mkdir -p \
  bootstrap/cache \
  storage/app/public \
  storage/framework/cache/data \
  storage/framework/sessions \
  storage/framework/testing \
  storage/framework/views \
  storage/logs

chmod -R 775 bootstrap/cache storage || true

git fetch "${REMOTE_NAME}" "${BRANCH}"

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "${REMOTE_NAME}/${BRANCH}")"

if [[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]]; then
  echo "Already up to date."
  exit 0
fi

git pull --ff-only "${REMOTE_NAME}" "${BRANCH}"

if command -v "${COMPOSER_BIN}" >/dev/null 2>&1; then
  "${COMPOSER_BIN}" install --no-dev --prefer-dist --no-interaction --optimize-autoloader
else
  echo "Composer not found. Skipping composer install."
fi

"${PHP_BIN}" artisan migrate --force
"${PHP_BIN}" artisan app:popular-crypto-bootstrap --activate || true
"${PHP_BIN}" artisan app:crypto-currency-update-cron || true
"${PHP_BIN}" artisan optimize:clear
"${PHP_BIN}" artisan storage:link || true
"${PHP_BIN}" artisan config:cache || true
"${PHP_BIN}" artisan route:cache || true
"${PHP_BIN}" artisan view:cache || true
"${PHP_BIN}" artisan queue:restart || true

echo "Deploy complete: ${REMOTE_HEAD}"
