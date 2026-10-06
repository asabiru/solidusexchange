#!/bin/sh
# Usage: with-dev-material.sh NAME=@file [NAME=@file ...] -- command [args...]
# Exports each NAME from a file in the dev-material volume, then execs command.
set -eu

dir=${SOLIDCHANGE_DEV_MATERIAL_DIR:-/run/solidchange-dev}

while [ "$#" -gt 0 ]; do
  if [ "$1" = "--" ]; then
    shift
    break
  fi
  name=${1%%=*}
  reference=${1#*=}
  file=${reference#@}
  case "$name" in
    "" | *[!A-Z0-9_]*) echo "with-dev-material: invalid variable name" >&2; exit 64 ;;
  esac
  if [ "$reference" = "$file" ]; then
    echo "with-dev-material: expected NAME=@file" >&2
    exit 64
  fi
  case "$file" in
    "" | */* | .*) echo "with-dev-material: invalid material file name" >&2; exit 64 ;;
  esac
  value=$(cat "$dir/$file")
  export "$name=$value"
  shift
done

if [ "$#" -eq 0 ]; then
  echo "with-dev-material: missing command after --" >&2
  exit 64
fi

exec "$@"
