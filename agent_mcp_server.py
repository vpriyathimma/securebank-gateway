"""SecureBank sub-agents (credit, sharepoint) exposed as an MCP server.

LiteLLM — like TrueFoundry — only intercepts LLM and MCP calls, never plain
agent->agent HTTP. Modelling each sub-agent as an MCP tool makes finbot's
delegation traverse the gateway, so Reva can allow/deny the invokeAgent hop
(finbot-agent -> credit-agent / sharepoint-agent). Each tool just calls the
existing invoke_* function; the sub-agent's own model + tool calls still route
through LiteLLM and are authorized too.

Started by run_local.sh BEFORE LiteLLM (LiteLLM lists this server's tools at
startup). Speaks MCP over streamable-http on :8090 by default.
"""
from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP
from reva_identity import set_current_user
from credit_agent import invoke_credit_agent
from sharepoint_agent import invoke_sharepoint_agent

PORT = int(os.getenv("AGENT_MCP_PORT", "8090"))
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("agent_mcp")

mcp = FastMCP("securebank-subagents", host="0.0.0.0", port=PORT)


@mcp.tool()
async def authorize_finbot_entry(message: str = "") -> str:
    """Front-door checkpoint: routing the user->finbot hop through the gateway so
    Reva evaluates invokeAgent(User -> finbot-agent). Returns 'ok' when allowed;
    a denied user never reaches here (the guardrail returns 403 first)."""
    return "ok"


@mcp.tool()
async def invoke_credit_agent_tool(message: str, user_email: str = "",
                                   branch_id: str = "", trat_token: str = "",
                                   on_behalf_of: str = "") -> str:
    """Delegate to the SecureBank credit-agent (credit score & risk analysis)."""
    # Re-set the acting user on this side of the process boundary so the credit
    # agent's own model + tool calls carry the same on-behalf-of user.
    set_current_user(on_behalf_of)
    log.info("delegate -> credit-agent (obo=%s): %s", on_behalf_of, (message or "")[:60])
    return await invoke_credit_agent(user_message=message, user_email=user_email,
                                     trat_token=trat_token, branch_id=branch_id)


@mcp.tool()
async def invoke_sharepoint_agent_tool(message: str, user_name: str = "",
                                       role: str = "", branch_id: str = "",
                                       on_behalf_of: str = "") -> str:
    """Delegate to the SecureBank sharepoint-agent (company policy / document lookup)."""
    set_current_user(on_behalf_of)
    log.info("delegate -> sharepoint-agent (obo=%s): %s", on_behalf_of, (message or "")[:60])
    return await invoke_sharepoint_agent(user_message=message, user_name=user_name,
                                         role=role, branch_id=branch_id)


def main() -> None:
    log.info("SecureBank sub-agent MCP server on :%s", PORT)
    mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
