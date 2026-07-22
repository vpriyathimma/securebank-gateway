#!/usr/bin/env bash
# Render Service B — the APP: FinBot on $PORT (public). It routes model/tool/
# delegation calls to Service A (LiteLLM) via LITELLM_BASE_URL.
set -uo pipefail
cd "$(dirname "$0")"

# Strip stray newlines from pasted env values (esp. LITELLM_BASE_URL) — a
# trailing \n breaks the URL and the Bearer header.
for v in LITELLM_BASE_URL LITELLM_MASTER_KEY LITELLM_MODEL REVA_USER MCP_SERVER_URL; do
  if [ -n "${!v:-}" ]; then export "$v"="$(printf '%s' "${!v}" | tr -d '\r\n')"; fi
done

echo "==> FinBot (server:app) on :$PORT  →  LiteLLM at ${LITELLM_BASE_URL:-unset}"
exec uvicorn server:app --host 0.0.0.0 --port "$PORT"
