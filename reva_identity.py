"""Current on-behalf-of user for the request, so every hop's eval carries the
real user (not the REVA_USER default).

Each process sets this at the start of handling a request:
  * the FinBot process  — invoke_finbot() sets it from the request user
  * the agent_mcp process — invoke_*_agent_tool() sets it from on_behalf_of,
    which the delegating agent threads through the MCP call arguments.

A ContextVar keeps it async-task-local (safe under concurrent requests).
It does NOT cross the process boundary — hence on_behalf_of is passed explicitly
through the MCP delegation and re-set on the other side.
"""
from __future__ import annotations

import contextvars
import os

_current_user: contextvars.ContextVar[str] = contextvars.ContextVar(
    "reva_current_user", default=""
)


def set_current_user(user_id: str) -> None:
    if user_id:
        _current_user.set(user_id)


def current_user() -> str:
    """The acting user, falling back to REVA_USER then a safe default."""
    return _current_user.get() or os.getenv("REVA_USER", "employee@securebank")
