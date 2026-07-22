"""Turn Reva PDP denials into friendly, user-facing messages.

A PDP deny surfaces as ``RevaAuthorizationError`` (a FastAPI ``HTTPException``).
Left alone it collapses into a generic 500 / "I couldn't process your request".
These helpers convert it into a short sentence the FinBot UI can render as a
normal chat bubble, optionally including the PDP's own reason. The deny is still
recorded in Reva's decision log — this only controls what the end user sees.
"""

# GATEWAY VERSION: the Reva SDK is removed, so its RevaAuthorizationError no
# longer exists. We keep a local stub of the same name so existing `except
# RevaAuthorizationError` blocks in the tools still import and compile — they
# simply never fire now, because denials come from the LiteLLM gateway (a 403),
# not from an SDK-raised exception. deny_message()/is_timeout_error() still work
# on any exception via getattr defaults.
class RevaAuthorizationError(Exception):
    """Local stub — the SDK exception is gone in the gateway version."""


__all__ = ["RevaAuthorizationError", "deny_message", "is_timeout_error"]


def is_timeout_error(exc: Exception) -> bool:
    """True when exc is (or reads as) a timeout — e.g. a slow downstream
    sub-agent such as the Microsoft-hosted SharePoint agent. Some timeout
    exceptions (httpx.ReadTimeout) stringify to "", which is exactly what
    produced the bare "Agent error: " users saw."""
    name = type(exc).__name__.lower()
    return "timeout" in name or "timeout" in str(exc).lower()

# Generic PDP reasons that add nothing for an end user — suppressed from the
# user-facing message (they still live in the decision log).
_GENERIC_REASONS = {"", "authorization denied by policy", "pdp denied"}


def _pdp_reason(exc) -> str:
    """Best specific reason from the exception, else "" when only generic."""
    reason = (getattr(exc, "reason", "") or "").strip()
    if not reason or reason.lower() in _GENERIC_REASONS:
        pdp = getattr(exc, "pdp_response", None)
        if isinstance(pdp, dict):
            ctx = pdp.get("context")
            if isinstance(ctx, dict):
                ctx_reason = (ctx.get("reason") or "").strip()
                if ctx_reason:
                    reason = ctx_reason
    return "" if reason.lower() in _GENERIC_REASONS else reason


def deny_message(exc, action: str = "") -> str:
    """Build a friendly, user-facing message for a PDP denial.

    ``action`` is an optional noun phrase describing what was blocked
    (e.g. "the credit-risk analysis tool", "credit-agent").
    """
    parts = [
        "I'm not able to complete that request — it was blocked by "
        "SecureBank's authorization policy."
    ]
    if action:
        parts.append(f"You don't have permission to use {action}.")
    reason = _pdp_reason(exc)
    if reason:
        parts.append(f"(Policy reason: {reason})")
    return " ".join(parts)
