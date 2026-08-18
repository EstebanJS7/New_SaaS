#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env into a namespaced associative array so .env values take precedence
# over hardcoded defaults but can still be overridden by exported env vars.
declare -A DOTENV=()
if [ -f "${ROOT_DIR}/.env" ]; then
  while IFS= read -r line || [ -n "${line}" ]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    case "${trimmed}" in
      "" | \#*) continue ;;
    esac
    if [[ "${trimmed}" =~ ^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$ ]]; then
      DOTENV["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
    fi
  done < "${ROOT_DIR}/.env"
fi

resolve_value() {
  local env_name="$1"
  local default_value="$2"
  printf '%s' "${!env_name:-${DOTENV[${env_name}]:-${default_value}}}"
}

validate_port() {
  local name="$1"
  local value="$2"
  if ! [[ "${value}" =~ ^[0-9]+$ ]]; then
    echo "${name} must be an integer between 1 and 65535; got '${value}'." >&2
    exit 1
  fi
  if [ "${value}" -lt 1 ] || [ "${value}" -gt 65535 ]; then
    echo "${name} must be an integer between 1 and 65535; got ${value}." >&2
    exit 1
  fi
}

HOST="$(resolve_value PREFLIGHT_HOST "127.0.0.1")"
POSTGRES_PORT="$(resolve_value POSTGRES_PORT "5432")"
REDIS_PORT="$(resolve_value REDIS_PORT "6379")"

validate_port POSTGRES_PORT "${POSTGRES_PORT}"
validate_port REDIS_PORT "${REDIS_PORT}"

export PREFLIGHT_HOST="${HOST}"
export POSTGRES_PORT="${POSTGRES_PORT}"
export REDIS_PORT="${REDIS_PORT}"

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
