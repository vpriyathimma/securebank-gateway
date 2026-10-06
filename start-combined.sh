#!/usr/bin/env bash
# One container, four processes, in the same order as run_local.sh:
#   1. agent_mcp_server.py :8090  — sub-agents as MCP tools (LiteLLM reads
#      this at startup, so it must be up first)
#   2. litellm              :4010  — the gateway; Reva's auth hook runs inside it
#   3. uvicorn server:app  :10000  — the FastAPI chat backend (/chat, /credit,
#      /sharepoint) that finbot_agent.py etc. actually run inside
#   4. the real Node/React app — the ONLY thing bound to $PORT, so it is the
#      only process Render's health check and the public internet ever reach
#
# All internal ports are localhost-only; nothing outside the container can
# address them directly. If any of the first three processes dies, the whole
# container exits (the `trap` + `wait -n` below) rather than serving a UI
# whose chat silently can't reach its backend.
set -euo pipefail
cd "$(dirname "$0")"

AGENT_MCP_PORT=8090
LITELLM_PORT=4010
GATEWAY_PORT=10000

echo "==> [1/4] sub-agent MCP server on :$AGENT_MCP_PORT"
AGENT_MCP_PORT=$AGENT_MCP_PORT python agent_mcp_server.py &
AGENT_MCP_PID=$!
for i in $(seq 1 30); do
  curl -s -o /dev/null http://localhost:$AGENT_MCP_PORT/mcp 2>/dev/null && break
  sleep 1
done

echo "==> [2/4] litellm gateway on :$LITELLM_PORT"
litellm --config litellm_config.yaml --port $LITELLM_PORT &
LITELLM_PID=$!
for i in $(seq 1 40); do
  curl -s -o /dev/null -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-foundry-test}" \
    http://localhost:$LITELLM_PORT/v1/models 2>/dev/null && break
  sleep 1
done

echo "==> [3/4] FastAPI chat backend (server:app) on :$GATEWAY_PORT"
LITELLM_BASE_URL="http://localhost:$LITELLM_PORT/v1" \
  uvicorn server:app --host 0.0.0.0 --port $GATEWAY_PORT &
GATEWAY_PID=$!
for i in $(seq 1 30); do
  curl -s -o /dev/null http://localhost:$GATEWAY_PORT/health 2>/dev/null && break
  sleep 1
done

trap 'kill $AGENT_MCP_PID $LITELLM_PID $GATEWAY_PID 2>/dev/null || true' EXIT INT TERM

echo "==> [4/4] SecureBank app on :\$PORT (public)"
cd app
LANGGRAPH_URL="http://localhost:$GATEWAY_PORT" exec npm run start &
APP_PID=$!

# If ANY process dies, bring the whole container down — a half-working
# container (UI up, gateway dead) is worse than a visible crash-restart.
wait -n $AGENT_MCP_PID $LITELLM_PID $GATEWAY_PID $APP_PID
