#!/usr/bin/env bash
# Render start command — runs the whole SecureBank gateway stack in ONE service:
#   agent_mcp (:8090 internal) -> LiteLLM (:4010 internal) -> FinBot (:$PORT public)
# Render injects $PORT and expects the web process to listen on it; that's FinBot.
# LiteLLM and the sub-agent MCP server are internal (localhost), never exposed.
set -uo pipefail
cd "$(dirname "$0")"

LITELLM_PORT=4010
AGENT_MCP_PORT="${AGENT_MCP_PORT:-8090}"
APP_PORT="${PORT:-10000}"
MASTER_KEY="${LITELLM_MASTER_KEY:-sk-foundry-test}"

echo "==> [1/3] sub-agent MCP server on :$AGENT_MCP_PORT"
AGENT_MCP_PORT=$AGENT_MCP_PORT python agent_mcp_server.py > /tmp/agent_mcp.log 2>&1 &
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://localhost:$AGENT_MCP_PORT/mcp" 2>/dev/null && { echo "    ready"; break; }
  sleep 1
done

echo "==> [2/3] LiteLLM gateway on :$LITELLM_PORT"
litellm --config litellm_config.yaml --port $LITELLM_PORT > /tmp/litellm.log 2>&1 &
for i in $(seq 1 90); do
  curl -s -o /dev/null -H "Authorization: Bearer $MASTER_KEY" "http://localhost:$LITELLM_PORT/v1/models" 2>/dev/null && { echo "    ready"; break; }
  sleep 1
done

echo "==> [3/3] FinBot (server:app) on :$APP_PORT  [public]"
exec uvicorn server:app --host 0.0.0.0 --port "$APP_PORT"
