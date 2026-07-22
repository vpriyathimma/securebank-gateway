# SecureBank — "gateway" version (no Reva SDK)

This is the SecureBank LangGraph service converted from the **SDK integration**
to the **gateway integration**, per Amit's Task 2:

> Take out the SDK from everywhere. Route the agents through LiteLLM. Reva
> authorizes at the gateway (the LiteLLM plugin) instead of via the embedded SDK.

**Status: code-converted AND tested locally — it runs.** Zero `import reva_ai`.
On 2026-07-21 it was run end to end: `/chat` returned a real answer routed
`FinBot -> credit-agent -> LiteLLM (:4010) -> Azure Foundry gpt-5-mini`, with a
`POST /v1/chat/completions 200 OK` in the LiteLLM log. Not yet deployed, and the
Reva guardrail is not yet turned on (see Step 2 below).

### Run it locally (reproducible)
Two terminals, from this folder:
```
# Terminal 1 — starts LiteLLM (:4010) + FinBot (:10000)
./run_local.sh
# Terminal 2 — once you see "Application startup complete":
./test_chat.sh "In one sentence, what is a credit score?"
```
A real answer in the `response` field = the no-SDK gateway version works.
(`run_local.sh` builds a `.venv` and installs deps on first run — a few minutes.
LiteLLM uses :4010 on purpose; :4000 is often taken by the other litellm-demo,
which would reject our key.)

### Next: Step 2 — turn on Reva (authorization)
Right now the model calls route through LiteLLM but nothing authorizes them yet.
To make it governed: add the Reva guardrail (`reva_auth_hook.RevaAuthHook`) to
`litellm_config.yaml` + create a SecureBank policy store, so each model call gets
a PDP decision. Then the two TODOs below (agent->agent, agent->tool).

---

## What changed

### 1. Models: Gemini → Azure Foundry via LiteLLM
`finbot_agent.py`, `credit_agent.py`:
- `ChatGoogleGenerativeAI(model="gemini-3.5-flash", google_api_key=...)`
  → `ChatOpenAI(model=<foundry deployment>, base_url=<LiteLLM>, api_key=<LiteLLM key>)`
- Added `extra_body.metadata = {reva_agent_id, reva_user_id}` so LiteLLM's Reva
  guardrail knows who's acting (this replaces what the SDK used to carry).

Config via env: `LITELLM_BASE_URL`, `LITELLM_MODEL` (e.g. `gpt-5-mini`),
`LITELLM_MASTER_KEY`, `REVA_USER`.

### 2. Reva SDK removed everywhere
- `server.py`: removed the three `@reva_ai_authorise` decorators, the
  `RevaAuthorizationError` exception handler, and the `_reva_proxy` timeout shim.
- `finbot_agent.py`: `revaclient.proxy.agent(...)` (agent→agent) → plain
  `httpx.post()`.
- `tools/mcp_tools.py`: `revaclient.proxy.mcp(...)` → plain JSON-RPC POST to the
  MCP server.
- `reva_errors.py`: `RevaAuthorizationError` is now a **local stub** (the SDK
  class is gone) so existing `except` blocks still import; they simply never fire.
- `requirements.txt`: commented out `reva-ai` and `langchain-google-genai`,
  added `langchain-openai`.

---

## TODO before this is a real demo (the important part)

**Authorization is currently only on the MODEL calls** (those route through
LiteLLM, where the Reva plugin evaluates `invokeModel`). Two things are NOT yet
authorized, because plain HTTP hops aren't seen by LiteLLM:

1. **Agent→agent** (finbot → credit / sharepoint) — now a plain `httpx.post`.
   To authorize it, the sub-agents must be reached **through LiteLLM's MCP
   gateway** (the way `reva-litellm-demo` wraps its sub-agents as MCP servers).
2. **Agent→tool** (`_call_mcp_tool`) — now a plain JSON-RPC call to the MCP
   server. Point `MCP_ENDPOINT` at **LiteLLM's MCP gateway** so the tool call is
   authorized (`invokeTool`).

Both are marked `TODO (full gateway model)` in the code.

---

## To run/test (Chiranth)
1. `pip install -r requirements.txt`
2. Stand up a LiteLLM with the Foundry models + the Reva guardrail
   (`reva_auth_hook.RevaAuthHook`) + a SecureBank policy store.
3. Set env: `LITELLM_BASE_URL`, `LITELLM_MODEL`, `LITELLM_MASTER_KEY`,
   `MCP_SERVER_URL`, `LANGGRAPH_SELF_URL`.
4. `uvicorn server:app --port 10000` and hit `/chat`.
5. Confirm calls appear in LiteLLM's logs and in Reva's decision logs.
6. Then do the two TODOs to authorize agent→agent and agent→tool.

---

## The one-line summary for Amit
> Code's converted to the no-SDK gateway version — models route through LiteLLM
> (Azure Foundry), SDK removed everywhere. Model-call authorization is wired;
> agent→agent and tool authorization via LiteLLM's MCP gateway is the remaining
> step. Testing + deploy pending.
