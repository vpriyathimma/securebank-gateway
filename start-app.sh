#!/usr/bin/env bash
# Render Service B — the APP: FinBot on $PORT (public). It routes model/tool/
# delegation calls to Service A (LiteLLM) via LITELLM_BASE_URL.
set -uo pipefail
cd "$(dirname "$0")"
echo "==> FinBot (server:app) on :$PORT  →  LiteLLM at ${LITELLM_BASE_URL:-unset}"
exec uvicorn server:app --host 0.0.0.0 --port "$PORT"
