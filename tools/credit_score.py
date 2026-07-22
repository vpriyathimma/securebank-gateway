"""
Credit Score Tools

CHANGE: credit-risk is now a real MCP tool call. get_credit_risk fetches the
applicant's profile from the bank, then invokes the Reva MCP Server's
credit-risk scorer via revaclient.proxy.mcp (a governed credit-agent →
reva-mcp-server/credit-risk-mcp `invokeTool` hop) — replacing the old
rtg_logger.log_rtg_tool_call() shim that faked that decision while the app
actually did the scoring. get_credit_score remains a direct bank data fetch.
"""

import httpx
import os
from langchain_core.tools import tool
from tools.mcp_tools import _call_mcp_tool
from reva_errors import RevaAuthorizationError, deny_message

SECUREBANK_URL = os.getenv("SECUREBANK_URL", "https://securebanking.onrender.com")

_current_trat: str = ""
_current_user_id: str = ""


def set_trat_token(token: str):
    global _current_trat
    _current_trat = token


def set_user_id(user_id: str):
    global _current_user_id
    _current_user_id = user_id


def _build_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if _current_trat:
        headers["Authorization"] = f"Bearer {_current_trat}"
    return headers


@tool
def get_credit_score(user_email: str = "", branch_id: str = "") -> str:
    """
    Fetch credit score data for a specific user or all users in a branch.
    Use this when the user asks about someone's credit score.

    Args:
        user_email: Email of the user to get credit score for
        branch_id: Branch ID to filter by (e.g. "BR001")
    """
    # Plain bank data fetch — NOT an MCP tool call. Governed app-side by the
    # TrAT/Cedar at issuance; no Reva decision-log hop is emitted here (the old
    # log_rtg_tool_call shim fabricated a credit-agent → credit-risk-mcp MCP row
    # that never corresponded to a real MCP invocation).
    endpoint = f"{SECUREBANK_URL}/api/agent/credit-score"
    params = {}
    if user_email:
        params["userEmail"] = user_email
    if branch_id:
        params["branchId"] = branch_id

    try:
        response = httpx.get(
            endpoint,
            headers=_build_headers(),
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Error fetching credit score: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Error fetching credit score: {str(e)}"


def _fetch_applicant_profile(user_email: str) -> dict:
    """Fetch the applicant's profile (input for the MCP risk scorer) from the bank.

    Best-effort: on any failure we fall back to a minimal profile so the MCP
    tool still runs (it scores gracefully with defaults).
    """
    applicant = {"email": user_email, "name": user_email, "creditScore": 0, "annualIncome": 0}
    try:
        response = httpx.get(
            f"{SECUREBANK_URL}/api/agent/credit-score",
            headers=_build_headers(),
            params={"userEmail": user_email},
            timeout=30,
        )
        if response.status_code == 200:
            rows = response.json()
            if isinstance(rows, list) and rows:
                row = next((r for r in rows if r.get("userId") == user_email), rows[0])
                applicant["name"] = row.get("name") or user_email
                applicant["creditScore"] = row.get("creditScore") or 0
    except Exception:
        pass
    return applicant


@tool
async def get_credit_risk(user_email: str) -> str:
    """
    Fetch credit risk analysis for a specific user.
    Use this when the user asks for credit risk analysis.

    Args:
        user_email: Email of the user to analyze
    """
    # 1. Fetch the applicant's profile — the input the risk model scores on.
    applicant = _fetch_applicant_profile(user_email)

    # 2. Score it via the real MCP credit-risk tool on the Reva MCP Server —
    #    a governed credit-agent → reva-mcp-server/credit-risk-mcp invokeTool hop.
    try:
        data = await _call_mcp_tool(
            "get_credit_risk",
            {"applicant": applicant, "currentLoans": [], "loanHistory": []},
            "reva-mcp-server/credit-risk-mcp",
            prompt=f"Credit risk analysis for {user_email}",
        )
    except RevaAuthorizationError as e:
        return deny_message(e, action="the credit-risk analysis tool")
    except Exception as e:
        return f"Error fetching credit risk: {str(e)}"

    # 3. Format the scorer's response.
    result = f"Credit Risk Analysis for {data.get('applicant', applicant['name'])}:\n"
    result += f"- Credit Score: {data.get('creditScore', applicant['creditScore'])}\n"
    result += f"- Risk Score: {data.get('riskScore', 'N/A')}/100\n"
    result += f"- Risk Band: {data.get('riskBand', 'unknown')}\n"
    result += f"- Recommendation: {data.get('recommendation', '')}"
    return result