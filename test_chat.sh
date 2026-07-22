#!/usr/bin/env bash
# Sends one question to the FinBot /chat endpoint and prints the answer.
set -euo pipefail
MSG="${1:-What is a good credit score?}"
echo "==> Asking FinBot: \"$MSG\""
echo "----------------------------------------------------------------"
curl -s -X POST http://localhost:10000/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$MSG\", \"user_id\": \"employee@securebank\", \"user_name\": \"Employee\", \"role\": \"employee\"}" \
  | python3 -m json.tool
echo "----------------------------------------------------------------"
echo "If you see a 'response' with a real answer, the converted code works:"
echo "  FinBot -> LiteLLM -> Azure Foundry (gpt-5-mini), no Reva SDK."
