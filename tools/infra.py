"""
Infrastructure tools for the FinBot agent.

These tools replace the finbot-s3-handler Lambda function.
They provide access to AWS infrastructure info like S3 buckets
and IAM users through SecureBank's API.

CHANGE: Added RTG decision logging for finbot-agent → SecureBank infra API calls.
Note: These API entities are not yet registered in the topology. The RTG log
calls will fail silently until API entities are added to the policy store.
"""

import httpx
import os
from langchain_core.tools import tool


SECUREBANK_URL = os.getenv("SECUREBANK_URL", "https://securebanking.onrender.com")


@tool
def list_s3_buckets() -> str:
    """
    List all S3 storage buckets.
    Use this when the user asks about S3 buckets or storage infrastructure.
    """
    trat_token = _get_trat_from_context()
    endpoint = f"{SECUREBANK_URL}/api/agent/infra"

    try:
        response = httpx.get(
            endpoint,
            headers=_build_headers(trat_token),
            params={"action": "list-buckets"},
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Error listing S3 buckets: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Error listing S3 buckets: {str(e)}"


@tool
def list_iam_users() -> str:
    """
    List all IAM users.
    Use this when the user asks about IAM users or access management.
    """
    trat_token = _get_trat_from_context()
    endpoint = f"{SECUREBANK_URL}/api/agent/infra"

    try:
        response = httpx.get(
            endpoint,
            headers=_build_headers(trat_token),
            params={"action": "list-iam-users"},
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Error listing IAM users: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Error listing IAM users: {str(e)}"


# ── Helper functions ─────────────────────────────────────────────

_current_trat: str = ""


def set_trat_token(token: str):
    """Called by the agent to set the TrAT token before tool execution."""
    global _current_trat
    _current_trat = token


def _get_trat_from_context() -> str:
    """Get the current TrAT token."""
    return _current_trat


def _build_headers(trat_token: str) -> dict:
    """Build HTTP headers with authorization."""
    headers = {"Content-Type": "application/json"}
    if trat_token:
        headers["Authorization"] = f"Bearer {trat_token}"
    return headers