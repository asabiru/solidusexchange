#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/coinectra}"
PHP_BIN="${PHP_BIN:-php}"

CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_LINK="${APP_ROOT}/previous"

if [[ ! -L "${PREVIOUS_LINK}" ]]; then
  echo "Missing ${PREVIOUS_LINK}"
  exit 1
fi

PREVIOUS_RELEASE="$(readlink -f "${PREVIOUS_LINK}")"

if [[ ! -f "${PREVIOUS_RELEASE}/artisan" ]]; then
  echo "Previous release is invalid: ${PREVIOUS_RELEASE}"
  exit 1
fi

if [[ -L "${CURRENT_LINK}" && -f "${CURRENT_LINK}/artisan" ]]; then
  (
    cd "${CURRENT_LINK}"
    "${PHP_BIN}" artisan down --retry=60 || true
  )
fi

ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"

(
  cd "${CURRENT_LINK}"
  "${PHP_BIN}" artisan optimize:clear
  "${PHP_BIN}" artisan up || true
  "${PHP_BIN}" artisan queue:restart || true
)

echo "Rollback complete: ${PREVIOUS_RELEASE}"
