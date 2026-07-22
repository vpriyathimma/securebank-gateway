"""
MCP Tools — Connects Finbot to the Reva MCP Server.

Each tool calls the deployed MCP server (reva-mcp-server-v2.onrender.com)
through the Reva SDK's MCP proxy — `revaclient.proxy.mcp(endpoint_protected=True)`
— which runs the real MCP lifecycle (initialize → notifications/initialized →
tools/call) and produces a PDP-governed `invokeTool` decision log for
finbot-agent → each MCP tool.

Flow: Finbot Agent → proxy.mcp → MCP Server `POST /mcp` (JSON-RPC) → OpenFIGI / data

CHANGE from original: replaced the `rtg_logger.log_rtg_tool_call()` decision-log
shim + raw `httpx` REST calls with `revaclient.proxy.mcp`, so the agent→tool
hops are MCP-compliant and SDK-governed (AGENTS.md §8.2). The MCP server's
`structuredContent` mirrors the old REST JSON, so response formatting is
unchanged.
"""

import os
import json
import httpx
from langchain_core.tools import tool
# GATEWAY VERSION: SDK proxy removed. RevaAuthorizationError is now a local stub
# (never fires); deny_message still works. Tool authorization moves to the
# LiteLLM gateway — see the TODO in _call_mcp_tool.
from reva_errors import RevaAuthorizationError, deny_message
from reva_identity import current_user

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "https://reva-mcp-server-v2.onrender.com")
MCP_ENDPOINT = f"{MCP_SERVER_URL}/mcp"

# LiteLLM MCP gateway: tool calls route here so Reva's pre_mcp_call guardrail
# evaluates invokeTool. The mcp_servers key in litellm_config.yaml is "reva_mcp".
# Root URL = LITELLM_BASE_URL with any trailing /v1 stripped.
_LL_BASE = os.getenv("LITELLM_BASE_URL", "http://localhost:4010/v1").rstrip("/")
LITELLM_ROOT = _LL_BASE[:-3].rstrip("/") if _LL_BASE.endswith("/v1") else _LL_BASE
LITELLM_MCP_ENDPOINT = f"{LITELLM_ROOT}/mcp-rest/tools/call"
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-foundry-test")
# Most MCP tools act as finbot-agent, but credit-risk-mcp is credit-agent's tool
# (the store permits credit-agent -> reva-mcp-server/credit-risk-mcp). The eval
# subject must match the store's permit, so map the tool's policy id -> agent.
MCP_AGENT_ID = os.getenv("REVA_MCP_AGENT_ID", "finbot-agent")
_TOOL_AGENT = {
    "reva-mcp-server/credit-risk-mcp": "credit-agent",
}
REVA_USER = os.getenv("REVA_USER", "employee@securebank")
# Route tool calls through the gateway (authorized) unless explicitly disabled.
MCP_VIA_GATEWAY = os.getenv("MCP_VIA_GATEWAY", "true").lower() not in ("false", "0", "no")


# ── MCP result helpers ───────────────────────────────────────────────────────

def _mcp_text(result) -> str:
    """Pull the first text block out of an MCP tools/call result's content[]."""
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                return block.get("text", "") or ""
    return ""


def _mcp_data(result) -> dict:
    """Extract the tool's data dict from an MCP tools/call result.

    Prefers `structuredContent`; falls back to JSON-decoding the text block.
    Raises on `isError` so the caller's except clause surfaces the message.
    """
    if not isinstance(result, dict):
        return {}
    if result.get("isError"):
        raise RuntimeError(_mcp_text(result) or "MCP tool returned an error")
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    text = _mcp_text(result)
    if text:
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {"text": text}
    return {}


async def _call_mcp_tool(tool_name: str, arguments: dict, resource_id: str, prompt: str = "") -> dict:
    """Invoke an MCP tool through the Reva proxy and return its data dict.

    endpoint_protected=True runs the PDP-governed MCP lifecycle: the outbound
    hop is enriched/evaluated (invokeTool), a transaction token is minted, and
    the call is forwarded to the MCP server's `POST /mcp` JSON-RPC endpoint.

    `prompt` carries a natural-language description of the request under the
    `message` key. PDP's prompt-based guardrails (Prompt Injection, Goal Hijack)
    read `arguments[promptKey]`, and the inbound decorators set
    prompt_key="message". An MCP tools/call body only holds the tool's own args,
    so without a `message` field PDP 422s with "no prompt found to evaluate" and
    the guardrail denies the hop. The MCP server ignores this extra field (its
    tool handlers destructure only their declared arguments).
    """
    args = dict(arguments)
    if prompt and "message" not in args:
        args["message"] = prompt
    # FULL GATEWAY MODEL: route the tool call through LiteLLM's MCP gateway so
    # Reva's pre_mcp_call guardrail evaluates invokeTool (agent -> tool). The
    # tool EXECUTES under its real MCP name (`tool_name`, e.g. get_market_analysis)
    # but Reva sees the resource as `resource_id` (e.g.
    # reva-mcp-server/market-analysis-mcp) via metadata.reva_tool_id, which is how
    # the shared SecureBank store already names its Tool entities.
    if MCP_VIA_GATEWAY:
        payload = {
            "server_id": "reva_mcp",
            "name": tool_name,
            "arguments": args,
            "metadata": {
                "reva_agent_id": _TOOL_AGENT.get(resource_id, MCP_AGENT_ID),
                "reva_user_id": current_user(),
                "reva_server_id": "reva-mcp-server",
                "reva_tool_id": resource_id,
            },
        }
        async with httpx.AsyncClient(timeout=60.0) as _client:
            r = await _client.post(
                LITELLM_MCP_ENDPOINT, json=payload,
                headers={"Authorization": f"Bearer {LITELLM_MASTER_KEY}",
                         "Content-Type": "application/json"},
            )
        # 403 = Reva refused the tool at the gateway. Raise so the caller's
        # `except RevaAuthorizationError` turns it into a friendly deny message.
        if r.status_code == 403:
            raise RevaAuthorizationError(f"Reva denied tool {resource_id}")
        r.raise_for_status()
        body = r.json()
        result = body.get("result", body)
        return _mcp_data(result)

    # LEGACY (MCP_VIA_GATEWAY=false): direct JSON-RPC to the MCP server, no
    # gateway, so the tool call is NOT authorized. Kept for local debugging.
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": tool_name, "arguments": args}}
    async with httpx.AsyncClient(timeout=60.0) as _client:
        r = await _client.post(
            MCP_ENDPOINT, json=payload,
            headers={"Content-Type": "application/json",
                     "Accept": "application/json, text/event-stream"},
        )
    body = r.json()
    result = body.get("result", body)
    return _mcp_data(result)


# ── Tool 1: Market Analysis ──

@tool
async def get_market_analysis(manufacturer: str) -> str:
    """
    Get vehicle market analysis and depreciation risk for an auto manufacturer.
    Calls the Reva MCP Server's market analysis tool.
    Use when the user asks about a car manufacturer, vehicle depreciation,
    or auto loan collateral risk.

    Args:
        manufacturer: The vehicle manufacturer name (e.g. "Toyota", "Honda", "BMW", "Ford")
    """
    try:
        data = await _call_mcp_tool(
            "get_market_analysis",
            {"manufacturer": manufacturer},
            "reva-mcp-server/market-analysis-mcp",
            prompt=f"Vehicle market and depreciation risk analysis for {manufacturer}",
        )

        result = f"Market Analysis for {data.get('manufacturer', manufacturer)}:\n"
        result += f"- Vehicle Risk: {data.get('vehicleRisk', 'unknown').upper()}\n"
        result += f"- Signal: {data.get('riskSignal', '')}\n"
        result += f"- Analysis: {data.get('analysis', '')}\n"
        result += f"- Recommendation: {data.get('recommendation', '')}"

        instruments = data.get("figiInstruments", [])
        if instruments:
            result += f"\n- FIGI Instruments: {len(instruments)}"
            for inst in instruments:
                result += f"\n  - {inst.get('name', '')} ({inst.get('ticker', 'N/A')}) on {inst.get('exchCode', 'N/A')} — FIGI: {inst.get('figi', 'N/A')}"

        return result

    except RevaAuthorizationError as e:
        return deny_message(e, action="the market analysis tool")
    except Exception as e:
        return f"Market analysis error: {str(e)}"


# ── Tool 2: FIGI Search ──

@tool
async def search_financial_instrument(query: str) -> str:
    """
    Search for financial instruments by name, ticker, or keyword.
    Calls the Reva MCP Server's FIGI search tool.
    Use when the user asks about stocks, FIGI codes, or financial instruments.

    Args:
        query: Search term — instrument name, ticker, or keyword (e.g. "Apple", "AAPL", "Tesla")
    """
    try:
        data = await _call_mcp_tool(
            "search_financial_instrument",
            {"query": query},
            "reva-mcp-server/figi-search-mcp",
            prompt=f"Search financial instruments matching: {query}",
        )

        instruments = data.get("results", [])
        if not instruments:
            return f"No financial instruments found for '{query}'."

        result = f"FIGI Search for '{query}' — {len(instruments)} found:\n"
        for i, inst in enumerate(instruments[:5], 1):
            result += f"\n{i}. {inst.get('name', 'Unknown')}"
            result += f" | Ticker: {inst.get('ticker', 'N/A')}"
            result += f" | Exchange: {inst.get('exchCode', 'N/A')}"
            result += f" | FIGI: {inst.get('figi', 'N/A')}"

        if len(instruments) > 5:
            result += f"\n\n...and {len(instruments) - 5} more results."

        return result

    except RevaAuthorizationError as e:
        return deny_message(e, action="the instrument search tool")
    except Exception as e:
        return f"FIGI search error: {str(e)}"


# ── Tool 3: FIGI Map ──

@tool
async def map_to_figi(id_type: str, id_value: str) -> str:
    """
    Map a financial identifier (ticker, ISIN, CUSIP, SEDOL) to its FIGI code.
    Calls the Reva MCP Server's FIGI mapping tool.

    Args:
        id_type: Type of identifier — "TICKER", "ID_ISIN", "ID_CUSIP", or "ID_SEDOL"
        id_value: The identifier value (e.g. "AAPL", "US0378331005")
    """
    try:
        data = await _call_mcp_tool(
            "map_to_figi",
            {"idType": id_type, "idValue": id_value},
            "reva-mcp-server/figi-map-mcp",
            prompt=f"Map {id_type} {id_value} to its FIGI code",
        )

        instruments = data.get("results", [])
        if not instruments:
            return f"No FIGI mapping found for {id_type}={id_value}."

        result = f"FIGI Mapping for {id_type}={id_value} — {len(instruments)} found:\n"
        for i, inst in enumerate(instruments[:5], 1):
            result += f"\n{i}. {inst.get('name', 'Unknown')}"
            result += f" | FIGI: {inst.get('figi', 'N/A')}"
            result += f" | Ticker: {inst.get('ticker', 'N/A')}"
            result += f" | Exchange: {inst.get('exchCode', 'N/A')}"

        return result

    except RevaAuthorizationError as e:
        return deny_message(e, action="the FIGI mapping tool")
    except Exception as e:
        return f"FIGI mapping error: {str(e)}"


# ── Tool 4: Compliance Check ──

@tool
async def check_compliance(user_email: str) -> str:
    """
    Check a user against OFAC sanctions and PEP lists.
    Calls the Reva MCP Server's compliance check tool.

    Args:
        user_email: Email of the person to check (e.g. "john.smith@reva.ai")
    """
    try:
        data = await _call_mcp_tool(
            "check_compliance",
            {"userId": user_email},
            "reva-mcp-server/compliance-mcp",
            prompt=f"OFAC sanctions and PEP compliance check for {user_email}",
        )

        result = f"Compliance Check for {data.get('userId', user_email)}:\n"
        result += f"- Compliant: {'Yes' if data.get('compliant') else 'No'}\n"
        result += f"- Status: {data.get('complianceStatus', 'CLEAN')}\n"
        result += f"- Risk Level: {data.get('riskLevel', 'low').upper()}\n"
        result += f"- Flags: {', '.join(data.get('flags', [])) or 'None'}\n"
        result += f"- Recommendation: {data.get('recommendation', '')}"

        return result

    except RevaAuthorizationError as e:
        return deny_message(e, action="the compliance check tool")
    except Exception as e:
        return f"Compliance check error: {str(e)}"


# ── Tool 5: Property Valuation ──

@tool
async def get_property_valuation(address: str, loan_amount: float) -> str:
    """
    Assess property collateral value and loan-to-value (LTV) ratio.
    Calls the Reva MCP Server's property valuation tool.

    Args:
        address: Property address (e.g. "123 Oak Street, Springfield")
        loan_amount: The requested loan amount in dollars (e.g. 240000)
    """
    try:
        data = await _call_mcp_tool(
            "get_property_valuation",
            {"address": address, "loanAmount": loan_amount},
            "reva-mcp-server/property-valuation-mcp",
            prompt=f"Property collateral valuation for {address}",
        )

        result = f"Property Valuation for {data.get('address', address)}:\n"
        result += f"- Estimated Value: ${data.get('estimatedValue', 0):,}\n"
        result += f"- Loan Amount: ${data.get('loanAmount', 0):,.0f}\n"
        result += f"- LTV Ratio: {data.get('ltvPercent', 'N/A')}\n"
        result += f"- Market Trend: {data.get('marketTrend', 'unknown')}\n"
        result += f"- Valuation Risk: {data.get('valuationRisk', 'unknown').upper()}\n"
        result += f"- Recommendation: {data.get('recommendation', '')}"

        return result

    except RevaAuthorizationError as e:
        return deny_message(e, action="the property valuation tool")
    except Exception as e:
        return f"Property valuation error: {str(e)}"
