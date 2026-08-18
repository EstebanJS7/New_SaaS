#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

HOST="${PREFLIGHT_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"

echo "Checking local services on ${HOST}..."

CLI_DIST="${ROOT_DIR}/packages/preflight/dist/cli.js"
if [ ! -f "${CLI_DIST}" ]; then
  echo "Preflight CLI not built. Run 'pnpm build' first."
  exit 1
fi

NODE_ARGS=()
if [ -f "${ROOT_DIR}/.env" ]; then
  NODE_ARGS+=(--env-file="${ROOT_DIR}/.env")
fi

node "${NODE_ARGS[@]}" "${CLI_DIST}"
