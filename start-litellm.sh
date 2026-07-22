#!/usr/bin/env bash
# Render Service A — the GATEWAY: LiteLLM on $PORT (public) + the sub-agent MCP
# on :8090 (internal, same container). LiteLLM reaches the MCP over localhost,
# so agent->agent delegation needs no cross-service wiring.
set -uo pipefail
cd "$(dirname "$0")"
AGENT_MCP_PORT="${AGENT_MCP_PORT:-8090}"

echo "==> sub-agent MCP on :$AGENT_MCP_PORT (its sub-agents call THIS service's LiteLLM)"
# credit/sharepoint sub-agents must call the LiteLLM in THIS container (localhost:$PORT)
LITELLM_BASE_URL="http://localhost:${PORT}/v1" AGENT_MCP_PORT=$AGENT_MCP_PORT \
  python agent_mcp_server.py > /tmp/agent_mcp.log 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$AGENT_MCP_PORT/mcp" 2>/dev/null && { echo "    MCP ready"; break; }; sleep 1; done

echo "==> LiteLLM gateway on :$PORT [public]"
exec litellm --config litellm_config.yaml --port "$PORT"
