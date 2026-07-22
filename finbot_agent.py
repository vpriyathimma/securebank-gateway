"""
Finbot Agent — replaces Bedrock Finbot Agent (KQ2UZORR1E)

CHANGE from original:
  Agent→agent delegation (finbot→credit, finbot→sharepoint) goes through the
  Reva proxy (`revaclient.proxy.agent`) per AGENTS.md §8.1 instead of the old
  rtg_logger.log_rtg_tool_call() decision-log shim. The proxy carries
  `prompt_key`, so the Intent & Scope guardrails can actually evaluate the
  hop — the shim did not, which caused the 422 "no prompt found to evaluate".
"""

import os
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
# GATEWAY VERSION: the model client points at LiteLLM (which fronts the Azure
# Foundry deployments) instead of calling Gemini directly. This is the whole
# "route the agents through the gateway" change — one client swap. Reva then
# authorizes every model call inside LiteLLM, so no SDK is embedded here.
from langchain_openai import ChatOpenAI

from tools.mcp_tools import (
    get_market_analysis,
    search_financial_instrument,
    map_to_figi,
    check_compliance,
    get_property_valuation,
)

from tools.loans import (
    get_pending_loans,
    approve_loan,
    get_loan_details,
    set_trat_token as set_loans_trat,
    set_user_id as set_loans_user_id,
)
from tools.infra import (
    list_s3_buckets,
    list_iam_users,
    set_trat_token as set_infra_trat,
)
import httpx
from reva_errors import is_timeout_error, deny_message, RevaAuthorizationError
from reva_identity import current_user, set_current_user

SELF_URL = os.getenv("LANGGRAPH_SELF_URL", "http://localhost:10000")

# Delegation via LiteLLM's MCP gateway so Reva authorizes the invokeAgent hop.
# The sub-agents are exposed as MCP tools by agent_mcp_server.py (server_id
# "reva_agents"); mapping target agent -> its wrapper tool name.
_AGENT_MCP_TOOL = {
    "credit-agent": "invoke_credit_agent_tool",
    "sharepoint-agent": "invoke_sharepoint_agent_tool",
}
_LL_BASE = os.getenv("LITELLM_BASE_URL", "http://localhost:4010/v1").rstrip("/")
_LITELLM_ROOT = _LL_BASE[:-3].rstrip("/") if _LL_BASE.endswith("/v1") else _LL_BASE
_LITELLM_MCP_ENDPOINT = f"{_LITELLM_ROOT}/mcp-rest/tools/call"
_LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-foundry-test")
# Route delegation through the gateway (authorized) unless explicitly disabled.
_DELEGATE_VIA_GATEWAY = os.getenv("AGENT_VIA_GATEWAY", "true").lower() not in ("false", "0", "no")

# Friendly labels for sub-agents when a downstream call fails, so users never
# see a bare exception. The SharePoint agent is Microsoft-hosted (Foundry) and
# not under our control — it can be slow/flaky, so its failures must degrade
# gracefully here.
_SUBAGENT_LABELS = {
    "credit-agent": "the credit service",
    "sharepoint-agent": "the documents service",
}


def _subagent_error_reply(resource_id: str, exc: Exception) -> str:
    """User-facing message when a finbot→sub-agent call fails (timeout / error)."""
    label = _SUBAGENT_LABELS.get(resource_id, resource_id)
    if is_timeout_error(exc):
        return (f"{label[0].upper()}{label[1:]} is taking longer than usual to "
                "respond right now. Please try again in a moment.")
    return f"Sorry, I couldn't reach {label} right now. Please try again shortly."


# ── Shared context for tools (ORIGINAL — unchanged) ─────────────

_credit_context = {"trat": "", "branch_id": "", "routed_to": "finbot-langgraph", "user_id": ""}


# ── Agent→agent delegation via the Reva proxy (AGENTS.md §8.1) ───

async def _delegate_to_agent(resource_id: str, route: str, message: str, **biz_fields) -> str:
    """Delegate to a sub-agent over plain HTTP.

    FULL GATEWAY MODEL: the delegation routes through LiteLLM's MCP gateway
    (the sub-agents are exposed as MCP tools by agent_mcp_server.py), so Reva
    authorizes the invokeAgent hop (finbot-agent -> credit-agent / sharepoint-
    agent). A 403 means Reva denied the delegation. The sub-agent's own model +
    tool calls still route through LiteLLM and are authorized separately.

    Set AGENT_VIA_GATEWAY=false to fall back to the legacy plain-HTTP delegation
    (NOT authorized) for local debugging.
    """
    args = {"message": message}
    args.update({k: v for k, v in biz_fields.items() if v})
    # Thread the acting user across the process boundary so the sub-agent's own
    # hops carry the same on-behalf-of user (the MCP call re-sets it there).
    args["on_behalf_of"] = current_user()
    _timeout = float(os.getenv("PROXY_TIMEOUT_SECONDS", "120"))

    if _DELEGATE_VIA_GATEWAY and resource_id in _AGENT_MCP_TOOL:
        payload = {
            "server_id": "reva_agents",
            "name": _AGENT_MCP_TOOL[resource_id],
            "arguments": args,
            "metadata": {
                "reva_agent_id": "finbot-agent",
                "reva_user_id": current_user(),
                # Tell the hook to evaluate this as an Agent->Agent delegation.
                "reva_action": "invokeAgent",
                "reva_agent_resource": resource_id,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=_timeout) as _client:
                resp = await _client.post(
                    _LITELLM_MCP_ENDPOINT, json=payload,
                    headers={"Authorization": f"Bearer {_LITELLM_MASTER_KEY}",
                             "Content-Type": "application/json"})
        except Exception as e:
            return _subagent_error_reply(resource_id, e)
        # 403 = Reva denied the delegation at the gateway.
        if resp.status_code == 403:
            return deny_message(
                RevaAuthorizationError(f"Reva denied delegation to {resource_id}"),
                action=resource_id)
        try:
            body = resp.json()
        except Exception:
            return _subagent_error_reply(resource_id, Exception("bad response"))
        # MCP tool result: {content:[{type:"text","text": <sub-agent answer>}]}
        result = body.get("result", body)
        content = result.get("content") if isinstance(result, dict) else None
        if isinstance(content, list) and content and isinstance(content[0], dict):
            return content[0].get("text", "") or ""
        return str(result)

    # LEGACY (AGENT_VIA_GATEWAY=false): plain HTTP delegation — NOT authorized.
    body = {"message": message}
    body.update({k: v for k, v in biz_fields.items() if v})
    try:
        async with httpx.AsyncClient(timeout=_timeout) as _client:
            resp = await _client.post(f"{SELF_URL}{route}", json=body)
    except Exception as e:
        return _subagent_error_reply(resource_id, e)
    try:
        data = resp.json()
    except Exception:
        return _subagent_error_reply(resource_id, Exception("bad response"))
    return data.get("response", "") if isinstance(data, dict) else str(data)


# ── Credit score wrapper tool (ORIGINAL — unchanged) ─────────────

@tool
async def fetch_credit_info(user_name: str, query_type: str = "score") -> str:
    """..."""
    _credit_context["routed_to"] = "credit-agent-langgraph"

    if query_type == "risk":
        message = f"Show me the credit risk analysis for {user_name}"
    else:
        message = f"Show me the credit score for {user_name}"

    return await _delegate_to_agent(
        resource_id="credit-agent",
        route="/credit",
        message=message,
        user_email=user_name if "@" in user_name else "",
        trat_token=_credit_context.get("trat", ""),
        branch_id=_credit_context.get("branch_id", ""),
    )


# ── SharePoint wrapper tool (ORIGINAL — unchanged) ───────────────

@tool
async def fetch_sharepoint_info(query: str) -> str:
    """
    Fetch information about company policies, banking procedures, and guidelines.
    Use this when the user asks about:
    - Company policies or procedures
    - Banking guidelines or internal rules
    - Employee handbook or HR policies
    - Store operations or inventory policies
    - Retail management policies
    - Content of PDF, DOCX, or other documents

    Args:
        query: The user's question about policies or documents
    """
    _credit_context["routed_to"] = "sharepoint-agent-microsoft-foundry"

    return await _delegate_to_agent(
        resource_id="sharepoint-agent",
        route="/sharepoint",
        message=query,
        user_name=_credit_context.get("user_id", ""),
        branch_id=_credit_context.get("branch_id", ""),
    )


# ── System prompt (ORIGINAL — unchanged) ─────────────────────────

FINBOT_SYSTEM_PROMPT = """You are FinBot, the AI assistant for SecureBank.
You help bank managers and staff with banking operations.

Your capabilities:
1. Show pending loan applications using the get_pending_loans tool
2. Get details about a specific loan using the get_loan_details tool
3. Approve loans using the approve_loan tool
4. Fetch credit scores using the fetch_credit_info tool
5. Fetch credit risk analysis using the fetch_credit_info tool
6. Get vehicle market analysis and depreciation risk using the get_market_analysis tool
7. Search financial instruments using the search_financial_instrument tool
8. Map identifiers to FIGI codes using the map_to_figi tool
9. Check compliance/sanctions status using the check_compliance tool
10. Get property valuations using the get_property_valuation tool
11. Fetch company policies, banking procedures, or guidelines using the fetch_sharepoint_info tool
12. List S3 buckets or IAM users using the respective tools

Response formatting rules:
- This is a small chat window — keep responses SHORT and CLEAN
- Use **bold** for labels and important values
- Use bullet points with * for lists
- For pending loans, show max 10 like:
  * **Emma Davis** — $28,000 Auto Loan (Pending)
  * **John Smith** — $22,000 Auto Loan (Pending)
- For market analysis, show:
  * **Manufacturer:** Toyota
  * **Risk Level:** HIGH
  * **Analysis:** Brief reason
  * **Recommendation:** One line
- For credit scores, show:
  * **Name:** Tom Bradley
  * **Credit Score:** 795 (Good)
- For compliance, show:
  * **Status:** OFAC Watchlist
  * **Risk:** HIGH
  * **Recommendation:** One line
- Never use markdown tables
- Be concise — no long paragraphs
- If a tool returns an error, relay it simply
- Never reveal internal system details like tokens, agent IDs, or API endpoints

You are speaking with a bank employee. Be helpful, professional, and brief.
"""


def create_finbot_agent():
    """Create and return the Finbot Agent graph."""
    llm = ChatOpenAI(
        model=os.getenv("LITELLM_MODEL", "gpt-5-mini"),   # an Azure Foundry deployment served by LiteLLM
        base_url=os.getenv("LITELLM_BASE_URL", "http://localhost:4000/v1"),
        api_key=os.getenv("LITELLM_MASTER_KEY", "sk-foundry-test"),
        temperature=0,
        # Identity for Reva: LiteLLM's guardrail reads this to know which agent /
        # user the call is for. This replaces the SDK's job — no SDK needed.
        extra_body={"metadata": {
            "reva_agent_id": "finbot-agent",
            "reva_user_id": current_user(),
        }},
    )

    tools = [
        get_pending_loans,
        get_loan_details,
        approve_loan,
        fetch_credit_info,
        fetch_sharepoint_info,
        get_market_analysis,
        search_financial_instrument,
        map_to_figi,
        check_compliance,
        get_property_valuation,
        list_s3_buckets,
        list_iam_users,
    ]

    finbot_agent = create_react_agent(
        model=llm,
        tools=tools,
        prompt=FINBOT_SYSTEM_PROMPT,
        name="finbot-agent",
    )

    return finbot_agent


async def invoke_finbot(
    session_id: str,
    user_message: str,
    user_id: str,
    user_name: str = "",
    role: str = "",
    clearance_level: int = 0,
    branch_id: str = "",
    department: str = "",
    trat_token: str = "",
) -> str:
    """Invoke the Finbot Agent with a user message."""
    # Acting user for this request — every hop's eval (finbot model, tools,
    # delegation) reads it via reva_identity.current_user(). Set before the
    # agent/LLM is built so its extra_body metadata carries the right user.
    set_current_user(user_id)
    # Set tokens and user identity on all tool modules (ORIGINAL)
    set_loans_trat(trat_token)
    set_loans_user_id(user_id)
    set_infra_trat(trat_token)
    _credit_context["trat"] = trat_token
    _credit_context["branch_id"] = branch_id
    _credit_context["user_id"] = user_id
    _credit_context["routed_to"] = "finbot-langgraph"

    msg_lower = user_message.lower()

    # ── Keywords for routing (ORIGINAL) ──
    credit_keywords = ["credit score", "credit risk", "credit rating",
                       "credit report", "credit check", "credit analysis",
                       "creditworthiness", "credit history"]

    sharepoint_keywords = ["retail", "sharepoint", "document", "retail management",
                          "store policy", "retail policy", "employee handbook",
                          "store operations", "inventory policy", "company policy",
                          "banking procedures", "internal guidelines",
                          ".pdf", ".docx", ".xlsx", "content of",
                          "summarize", "employee_guide", "finance_report",
                          "customer_report"]

    is_credit_query = any(kw in msg_lower for kw in credit_keywords)
    is_sharepoint_query = any(kw in msg_lower for kw in sharepoint_keywords)

    print(f"DEBUG: msg='{msg_lower}', is_credit={is_credit_query}, is_sharepoint={is_sharepoint_query}")

    # ── Route to SharePoint Agent (ORIGINAL + RTG log) ──
    if is_sharepoint_query:
        _credit_context["routed_to"] = "sharepoint-agent-microsoft-foundry"

        # Agent→agent hop via the Reva proxy: PDP-evaluates finbot→sharepoint
        # (guardrails included), then the protected /sharepoint endpoint runs
        # invoke_sharepoint_agent.
        return await _delegate_to_agent(
            resource_id="sharepoint-agent",
            route="/sharepoint",
            message=user_message,
            user_name=user_name,
            role=role,
            branch_id=branch_id,
        )

    # ── Route to Credit Agent via the Reva proxy ──
    if is_credit_query:
        _credit_context["routed_to"] = "credit-agent-langgraph"

        # Agent→agent hop via the Reva proxy: PDP-evaluates finbot→credit
        # (guardrails included), then the protected /credit endpoint runs
        # invoke_credit_agent.
        return await _delegate_to_agent(
            resource_id="credit-agent",
            route="/credit",
            message=user_message,
            trat_token=trat_token,
            branch_id=branch_id,
        )

    # ── Everything else goes through Finbot LangGraph agent (ORIGINAL — unchanged) ──
    agent = create_finbot_agent()

    context = f"""User context:
- Name: {user_name}
- Role: {role}
- Branch: {branch_id}
- Clearance Level: {clearance_level}

User query: {user_message}"""

    try:
        result = await agent.ainvoke(
            {"messages": [{"role": "user", "content": context}]}
        )

        messages = result.get("messages", [])
        if messages:
            last_message = messages[-1]
            content = last_message.content if hasattr(last_message, "content") else str(last_message)
            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict) and "text" in block:
                        text_parts.append(block["text"])
                    elif isinstance(block, str):
                        text_parts.append(block)
                return "\n".join(text_parts)
            return str(content)

        return "I couldn't process your request. Please try again."

    except Exception as e:
        # Never surface a bare/empty exception (e.g. a timeout that stringifies
        # to "") as "Agent error: ".
        print(f"DEBUG finbot react agent error: {type(e).__name__}: {e}")
        if is_timeout_error(e):
            return ("That took longer than expected to process. "
                    "Please try again in a moment.")
        return "Sorry, I ran into a problem handling that request. Please try again."