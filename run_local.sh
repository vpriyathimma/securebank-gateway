#!/usr/bin/env bash
# Brings up the SecureBank gateway demo locally:
#   1. LiteLLM  on :4010  (routes to Azure Foundry gpt-5-mini)
#   2. FinBot   on :10000 (the converted, no-SDK LangGraph app)
# Ctrl-C stops both.
#
# NOTE: LiteLLM uses port 4010 on purpose. Port 4000 is often already taken by
# the other (reva-litellm-demo) LiteLLM, which has its own key database and
# would reject our master key. 4010 keeps this demo isolated.
set -euo pipefail
cd "$(dirname "$0")"

LITELLM_PORT=4010
APP_PORT=10000

VENV=".venv"
if [ ! -d "$VENV" ]; then
  echo "==> Creating virtualenv (.venv) ..."
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "==> Installing dependencies (first run takes a few minutes) ..."
pip install -q --upgrade pip
pip install -q -r requirements.local.txt

# Load .env so LiteLLM sees AZURE_API_KEY
set -a; # shellcheck disable=SC1091
source .env; set +a

AGENT_MCP_PORT=8090

# Fail loudly if the port is already taken (rather than silently binding a random one)
for p in $LITELLM_PORT $AGENT_MCP_PORT; do
  if lsof -iTCP:$p -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "ERROR: port $p is already in use. Stop whatever is on it (the demo may already be running)." >&2
    exit 1
  fi
done

# Sub-agent MCP server FIRST — LiteLLM lists its tools at startup, so it must
# be up before LiteLLM. Exposes credit-agent/sharepoint-agent as MCP tools so
# finbot's delegation traverses the gateway (Reva authorizes invokeAgent).
echo "==> Starting sub-agent MCP server on :$AGENT_MCP_PORT (log: agent_mcp.log) ..."
AGENT_MCP_PORT=$AGENT_MCP_PORT python agent_mcp_server.py > agent_mcp.log 2>&1 &
AGENT_MCP_PID=$!
echo -n "==> Waiting for sub-agent MCP "
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:$AGENT_MCP_PORT/mcp 2>/dev/null; then echo " ready."; break; fi
  echo -n "."; sleep 1
done

echo "==> Starting LiteLLM on :$LITELLM_PORT (log: litellm.log) ..."
litellm --config litellm_config.yaml --port $LITELLM_PORT > litellm.log 2>&1 &
LITELLM_PID=$!
trap 'echo; echo "==> Stopping ..."; kill $LITELLM_PID $AGENT_MCP_PID 2>/dev/null || true' EXIT INT TERM

echo -n "==> Waiting for LiteLLM to be ready "
READY=""
for i in $(seq 1 40); do
  if curl -s -o /dev/null -H "Authorization: Bearer sk-foundry-test" http://localhost:$LITELLM_PORT/v1/models 2>/dev/null; then
    READY=1; echo " ready."; break
  fi
  echo -n "."; sleep 1
done
if [ -z "$READY" ]; then
  echo; echo "ERROR: LiteLLM did not come up on :$LITELLM_PORT. Last log lines:" >&2
  tail -15 litellm.log >&2; exit 1
fi
# Confirm it actually bound the port we asked for (LiteLLM silently falls back otherwise)
if ! grep -q "Uvicorn running on http://0.0.0.0:$LITELLM_PORT" litellm.log; then
  echo "ERROR: LiteLLM did not bind :$LITELLM_PORT (it fell back to another port). Check litellm.log." >&2
  grep "Uvicorn running" litellm.log >&2; exit 1
fi

echo "==> Starting FinBot (server:app) on :$APP_PORT ..."
echo "    When you see 'Application startup complete', open a NEW terminal and run: ./test_chat.sh"
uvicorn server:app --host 0.0.0.0 --port $APP_PORT
