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

# NET DIAG: can THIS Render container reach Azure Foundry and the Reva PDP?
echo "==> NETDIAG: testing outbound reachability from this container"
python - <<'PY'
import os, json, urllib.request
def test(name, url, data=None, headers=None):
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {},
                                     method='POST' if data else 'GET')
        r = urllib.request.urlopen(req, timeout=25)
        print(f"    NETDIAG {name}: HTTP {r.status} (REACHABLE)")
    except urllib.error.HTTPError as e:
        print(f"    NETDIAG {name}: HTTP {e.code} (REACHABLE)")
    except Exception as e:
        print(f"    NETDIAG {name}: FAILED {type(e).__name__}: {e}")
azkey = os.environ.get('AZURE_API_KEY', '')
test('azure', 'https://cog-rhk3ufnktbvxq.openai.azure.com/openai/deployments/gpt-5-mini/chat/completions?api-version=2024-12-01-preview',
     json.dumps({'messages': [{'role': 'user', 'content': 'hi'}], 'max_completion_tokens': 5}).encode(),
     {'api-key': azkey, 'Content-Type': 'application/json'})
test('pdp', 'https://api.pr06.preview.reva.ai')
test('github', 'https://github.com')
PY

echo "==> LiteLLM gateway on :$PORT [public]"
exec litellm --config litellm_config.yaml --port "$PORT"
