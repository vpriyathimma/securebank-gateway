import httpx
import os
from langchain_core.tools import tool

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
def get_pending_loans(branch_id: str = "", pending_only: bool = True) -> str:
    """
    Fetch pending loans from SecureBank.
    Use this when the user asks to see pending loans, loan list, or loan applications.

    Args:
        branch_id: The branch ID to filter loans by (e.g. "BR001")
        pending_only: If True, only return pending loans. Default is True.
    """
    params = {"userId": _current_user_id}
    if branch_id:
        params["branchId"] = branch_id
    if pending_only:
        params["pendingOnly"] = "true"

    try:
        response = httpx.get(
            f"{SECUREBANK_URL}/api/agent/loans",
            headers=_build_headers(),
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Error fetching loans: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Error fetching loans: {str(e)}"


@tool
def get_loan_details(loan_id: str) -> str:
    """
    Fetch details of a specific loan including any notes.
    Use this when the user asks about a specific loan.

    Args:
        loan_id: The ID of the loan to fetch details for
    """
    try:
        response = httpx.get(
            f"{SECUREBANK_URL}/api/agent/loans/{loan_id}",
            headers=_build_headers(),
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Error fetching loan details: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Error fetching loan details: {str(e)}"


@tool
def approve_loan(applicant_name: str) -> str:
    """
    Approve a pending loan for the given applicant.
    Use this when the user asks to approve someone's loan.

    Args:
        applicant_name: The name of the loan applicant (e.g. "Tom Bradley")
    """
    try:
        response = httpx.post(
            f"{SECUREBANK_URL}/api/agent/loans/approve",
            headers=_build_headers(),
            json={
                "applicantName": applicant_name,
                "userId": _current_user_id,
                "role": "Bank Manager",
                "clearanceLevel": 10,
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPStatusError as e:
        return f"Loan approval response: {e.response.text}"
    except Exception as e:
        return f"Error approving loan: {str(e)}"