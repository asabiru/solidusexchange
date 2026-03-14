#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/coinectra}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
PHP_BIN="${PHP_BIN:-php}"
COMPOSER_BIN="${COMPOSER_BIN:-composer}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [[ -z "${REPO_URL}" ]]; then
  echo "REPO_URL is required."
  exit 1
fi

SHARED_DIR="${APP_ROOT}/shared"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_LINK="${APP_ROOT}/previous"
RELEASE_ID="$(date +%Y%m%d%H%M%S)"
NEW_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"

mkdir -p "${SHARED_DIR}" "${RELEASES_DIR}" "${SHARED_DIR}/storage" "${SHARED_DIR}/bootstrap/cache"

if [[ ! -f "${SHARED_DIR}/.env" ]]; then
  echo "Missing ${SHARED_DIR}/.env"
  exit 1
fi

if [[ -L "${CURRENT_LINK}" && -f "${CURRENT_LINK}/artisan" ]]; then
  (
    cd "${CURRENT_LINK}"
    "${PHP_BIN}" artisan down --retry=60 || true
  )
fi

cleanup_on_error() {
  if [[ -L "${CURRENT_LINK}" && -f "${CURRENT_LINK}/artisan" ]]; then
    (
      cd "${CURRENT_LINK}"
      "${PHP_BIN}" artisan up || true
    )
  fi
}

trap cleanup_on_error ERR

git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${NEW_RELEASE}"

cd "${NEW_RELEASE}"

rm -rf storage
ln -sfn "${SHARED_DIR}/storage" storage
ln -sfn "${SHARED_DIR}/.env" .env
mkdir -p bootstrap/cache

"${COMPOSER_BIN}" install --no-dev --prefer-dist --no-interaction --optimize-autoloader

"${PHP_BIN}" artisan optimize:clear
"${PHP_BIN}" artisan migrate --force
"${PHP_BIN}" artisan storage:link || true
"${PHP_BIN}" artisan config:cache
"${PHP_BIN}" artisan route:cache
"${PHP_BIN}" artisan view:cache

if [[ -L "${CURRENT_LINK}" ]]; then
  ln -sfn "$(readlink -f "${CURRENT_LINK}")" "${PREVIOUS_LINK}"
fi

ln -sfn "${NEW_RELEASE}" "${CURRENT_LINK}"

(
  cd "${CURRENT_LINK}"
  "${PHP_BIN}" artisan up || true
  "${PHP_BIN}" artisan queue:restart || true
)

ls -1dt "${RELEASES_DIR}"/* 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf

echo "Deploy complete: ${NEW_RELEASE}"
