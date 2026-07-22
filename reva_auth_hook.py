"""Reva authorization hook for LiteLLM proxy.

Wires up as a LiteLLM ``CustomGuardrail`` with ``async_pre_call_hook``. Every
chat-completion request flowing through the proxy hits this hook first; the
hook calls the Reva PDP and either:

  * returns ``data`` unchanged (Allow), or
  * raises ``fastapi.HTTPException(403)`` (Deny).

Identity flow: the agent sends user identity inside ``data["metadata"]``
(set by langchain-openai's ``extra_body`` parameter). The hook reads
``reva_user_id``, ``reva_team``, ``reva_tier`` from there. We do *not* rely
on LiteLLM virtual keys, so this demo doesn't need a Postgres backend.

PDP request shape mirrors reva-langchain/src/reva_langchain/pdp_client.py so
the same Reva backend can serve both clients without policy changes.

Two Cedar vocabularies, selected by ``REVA_SCHEMA_MODE`` (mirrors the
TrueFoundry plugin so both gateways speak the same contract against one
policy store):

  * ``vanilla``  — User/CallModel/Model, User/InvokeTool/Tool. The original
                   contract; hits ``/pdp/access/v1/evaluation``.
  * ``agent_v5`` — Agent/invokeModel/Model, Agent/invokeTool/Tool with a
                   SharedContext (onBehalfOf, full conversation history,
                   sequence-aligned hops, transmission/current prompt, real
                   turn number). Hits the AI Evaluation API
                   ``/pdp/access/v1/ai/evaluation`` and forwards the caller's
                   W3C traceparent instead of minting a fresh one. This is the
                   port of the TrueFoundry plugin's new evaluation contract
                   (guardrail/reva_auth.py) back into the LiteLLM hook.

Modes (``REVA_HOOK_MODE`` env):
  * ``enforce`` (default) — raise 403 on Deny
  * ``log``               — log the decision but always allow (useful for
                            staging the demo before policies are published)
"""

from __future__ import annotations

import datetime as _dt
import os
import re
import sys
import time
import uuid
from typing import Any, Literal

import httpx
from fastapi import HTTPException
from litellm.integrations.custom_guardrail import CustomGuardrail


class _Log:
    """Tiny logger that writes straight to stderr so LiteLLM's logger
    reconfiguration can't swallow the output."""

    def _emit(self, level: str, msg: str) -> None:
        print(f"[reva_hook {level}] {msg}", file=sys.stderr, flush=True)

    def info(self, fmt: str, *args: Any) -> None:
        self._emit("INFO", fmt % args if args else fmt)

    def warning(self, fmt: str, *args: Any) -> None:
        self._emit("WARN", fmt % args if args else fmt)


log = _Log()


# Team-level entitlements inlined onto the User entity at request time.
# Mirrors authorisation/entities.json — kept in sync by hand for the demo.
# In a production deployment this would come from a directory / IDP attribute
# lookup rather than a hard-coded map.
TEAM_CONFIG: dict[str, dict[str, list[str]]] = {
    "analyst-team": {
        "allowedModels": ["nova-premium", "amazon.nova-micro-v1-0"],
        "blockedTools": [],
        # MCP manifest — the rug-pull defense. Any tool not in this list
        # gets denied by `forbid-tool-not-in-approved-manifest` even if no
        # other policy bites. To onboard a new tool, add it here (and to
        # the entity in the Reva console).
        "approvedMcpTools": ["get_billing_report", "get_compliance_status", "get_customer_pii"],
    },
    "intern-team": {
        "allowedModels": ["amazon.nova-micro-v1-0"],
        "blockedTools": ["delete_invoice", "send_invoice_email"],
        "approvedMcpTools": ["get_billing_report", "get_compliance_status"],
    },
    "free-team": {
        "allowedModels": ["nova-premium", "amazon.nova-micro-v1-0"],
        "blockedTools": [],
        "approvedMcpTools": ["get_billing_report"],
    },
    # Finance gets the full model allow-list at the team level. The
    # forbid-finance-off-hours-unless-approved Cedar policy layers the
    # time-of-day + break-glass restriction on top.
    "finance-team": {
        "allowedModels": ["nova-premium", "amazon.nova-micro-v1-0"],
        "blockedTools": [],
        "approvedMcpTools": ["get_billing_report", "get_compliance_status"],
    },
}
_DEFAULT_TEAM = {"allowedModels": [], "blockedTools": [], "approvedMcpTools": []}


def _build_traceparent(trace_id: str | None = None) -> str:
    tid = (trace_id or uuid.uuid4().hex).replace("-", "")[:32].ljust(32, "0")
    sid = uuid.uuid4().hex[:16]
    return f"00-{tid}-{sid}-01"


def _trace_id_of(traceparent: str) -> str:
    """The 32-hex trace-id from a W3C traceparent (00-<trace>-<span>-01).

    This is the value the Reva console shows as "Trace ID" and groups Decision
    Logs by, so every hop of a turn must send it as the correlation id."""
    parts = (traceparent or "").split("-")
    return parts[1] if len(parts) >= 2 and parts[1] else uuid.uuid4().hex


def _span_id_of(traceparent: str) -> str:
    """The 16-hex span-id (3rd field) of a W3C traceparent."""
    parts = (traceparent or "").split("-")
    return parts[2] if len(parts) >= 3 and parts[2] else uuid.uuid4().hex[:16]


# ---------------------------------------------------------------------------
# AI Evaluation (agent_v5) contract helpers — ported from the TrueFoundry
# plugin's guardrail/reva_auth.py so both gateways emit an identical envelope:
# subject/action/resource/principal/context(onBehalfOf, conversation, hops)/
# transmission/session. The PDP resolves entity *attributes* from the
# published store by uid, so we send type+id+name and only the dynamic bits.
# ---------------------------------------------------------------------------
def _iso_now() -> str:
    return _dt.datetime.utcnow().isoformat() + "Z"


def _resolve_v5_identity(data: dict, meta: dict) -> str:
    """The human the agent acts for (context.onBehalfOf + principal). Normally
    the LiteLLM caller's ``reva_user_id``; a ``reva_user`` override lets the
    demo UI pick which user the agent acts on behalf of (e.g. carol@free)."""
    return (
        meta.get("reva_user") or meta.get("onBehalfOf") or meta.get("reva_onbehalf")
        or meta.get("reva_user_id") or data.get("user") or "anonymous"
    )


def _extract_prompt(messages: list[Any] | None) -> str:
    """Last user message content → transmission.content. This is the prompt the
    PDP authorizes against — the field the vanilla contract never sent."""
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, str):
                return c[:4000]
            if isinstance(c, list):  # OpenAI content-parts form
                return " ".join(
                    p.get("text", "") for p in c if isinstance(p, dict)
                )[:4000]
    return ""


def _turn(messages: list[Any] | None) -> int:
    """Turn number = how many user messages the session has seen (incl. the
    current one). New contract wants the real turn; the old code pinned it to 1."""
    n = sum(1 for m in (messages or []) if isinstance(m, dict) and m.get("role") == "user")
    return n or 1


def _conversation(messages: list[Any] | None, now: str,
                  keep_current_prompt: bool = False) -> dict[str, Any]:
    """context.conversation.messages[] — the accumulated history. Each entry is
    {seq, role, content, timestamp}.

    For a MODEL eval the current user prompt goes to transmission, so it is held
    back here. For a TOOL eval there is no user prompt to hold back (the
    transmission is the tool arguments), so pass keep_current_prompt=True to
    include the whole conversation.

    This is the field the intent engine reads to judge drift across a session.
    Per-message timestamps aren't in the proxy payload, so we stamp receipt
    time."""
    msgs = messages or []
    last_user = None
    if not keep_current_prompt:
        for i in range(len(msgs) - 1, -1, -1):
            if isinstance(msgs[i], dict) and msgs[i].get("role") == "user":
                last_user = i
                break
    out: list[dict[str, Any]] = []
    for i, m in enumerate(msgs):
        if not isinstance(m, dict) or m.get("role") == "system":
            continue
        if i == last_user:
            # Skip ONLY the current prompt (it goes to transmission). Everything
            # else is history — including tool results that come AFTER the prompt
            # within one turn, which is what makes chatHistory fill from a single
            # complex prompt (agent calls a tool, result becomes history for the
            # next model call) rather than only across separate turns.
            continue
        c = m.get("content")
        if isinstance(c, list):  # OpenAI content-parts form
            c = " ".join(p.get("text", "") for p in c if isinstance(p, dict))
        out.append({
            "seq": len(out) + 1,
            "role": m.get("role"),
            "content": str(c or "")[:4000],
            "timestamp": now,
        })
    return {"messages": out}


# An orchestrator tool result reaches the model phrased as
# "billing-mcp/get_billing_report returned: {...}". That server-qualified id is
# exactly the hop's Tool resource id.
_TOOL_RESULT = re.compile(r"^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\s+returned:")


def _tool_from_result(content: str) -> str | None:
    m = _TOOL_RESULT.match((content or "").strip())
    return m.group(1) if m else None


def _hops(agent_id: str, conv_messages: list[dict[str, Any]],
          user_id: str, now: str) -> list[dict[str, Any]]:
    """context.hops[] — the delegation chain, seq-aligned to the conversation
    (Amit: "hop 1 = message 1 ... one, one, two, two"). ONE hop per conversation
    message, keyed on that message's seq:
      * a user message  -> user invoked the agent   (User -> invokeAgent -> Agent)
      * a tool result   -> agent invoked that tool   (Agent -> invokeTool -> Tool)
      * any other agent turn -> agent invoked its model (Agent -> invokeModel)
    The CURRENT action (this eval's tool/model) is NOT a hop — it lives in the
    top-level action/resource, exactly as in Karthik's payload.

    When the conversation is empty (turn 1), we still record the single
    User -> invokeAgent hop for the current invocation, matching the simple curl
    Amit sent (empty conversation, one hop)."""
    hops: list[dict[str, Any]] = []
    for m in conv_messages:
        seq = m.get("seq")
        t = m.get("timestamp") or now
        if m.get("role") == "user":
            hops.append({"seq": seq, "subject": {"type": "User", "id": user_id},
                         "action": "invokeAgent",
                         "resource": {"type": "Agent", "id": agent_id}, "time": t})
            continue
        tool = _tool_from_result(m.get("content", ""))
        if tool:
            hops.append({"seq": seq, "subject": {"type": "Agent", "id": agent_id},
                         "action": "invokeTool",
                         "resource": {"type": "Tool", "id": tool}, "time": t})
        else:
            hops.append({"seq": seq, "subject": {"type": "Agent", "id": agent_id},
                         "action": "invokeModel",
                         "resource": {"type": "Model", "id": "model"}, "time": t})
    if not hops:
        hops.append({"seq": 1, "subject": {"type": "User", "id": user_id},
                     "action": "invokeAgent",
                     "resource": {"type": "Agent", "id": agent_id}, "time": now})
    return hops


def _on_behalf_of(user_id: str, meta: dict[str, Any]) -> dict[str, Any]:
    """context.onBehalfOf — the delegating end user + any attributes the agent
    forwarded (team/tier). Authoritative attributes come from the store's entity
    data; these are supplementary/dynamic."""
    props: dict[str, Any] = {}
    for src, dst in (("team", "team"), ("reva_team", "team"),
                     ("tier", "tier"), ("reva_tier", "tier"),
                     ("riskTier", "riskTier")):
        v = meta.get(src)
        if v and dst not in props:
            props[dst] = str(v)
    # agent_v5 parity with the vanilla contract: inline the team's entitlements
    # onto onBehalfOf so policies can read allowedModels / blockedTools /
    # approvedMcpTools without the store having to carry them as entity data.
    # (The store-entity route is the "purer" agent_v5 modelling; inlining here
    # keeps one source of truth — TEAM_CONFIG — across both contracts.)
    team_cfg = TEAM_CONFIG.get(props.get("team", ""), _DEFAULT_TEAM)
    props["allowedModels"] = team_cfg.get("allowedModels", [])
    props["blockedTools"] = team_cfg.get("blockedTools", [])
    props["approvedMcpTools"] = team_cfg.get("approvedMcpTools", [])
    ob: dict[str, Any] = {"type": "User", "id": user_id}
    if props:
        ob["properties"] = props
    return ob


def _ai_context(user_id: str, meta: dict[str, Any]) -> dict[str, Any]:
    ctx: dict[str, Any] = {
        "onBehalfOf": _on_behalf_of(user_id, meta),
        "environment": {"requestId": uuid.uuid4().hex, "time": _iso_now()},
    }
    # Break-glass token + any guardrail signals the agent forwarded.
    approval = meta.get("approval_token") or meta.get("approvalToken")
    if approval:
        ctx["approvalToken"] = str(approval)
    for sig in ("blockedTermInUserMessage", "blockedTermInInput", "isBlockedTool"):
        if sig in meta:
            ctx[sig] = meta[sig]
    return ctx


def _session(meta: dict[str, Any], now: str, turn: int = 1) -> dict[str, Any]:
    return {"id": meta.get("session_id") or uuid.uuid4().hex, "turn": turn, "startedAt": now}


def _incoming_traceparent(data: dict) -> str | None:
    """The W3C traceparent LiteLLM received on the inbound request. Unlike the
    TrueFoundry plugin (which reads it off the FastAPI Request), the LiteLLM
    guardrail hook gets no raw request object — LiteLLM stashes the original
    request under ``data["proxy_server_request"]``. We forward that traceparent
    to the PDP (per Amit) so a session's calls share one trace instead of
    minting a fresh id per hop. Falls back to None (mint one) if absent."""
    psr = data.get("proxy_server_request") or {}
    headers = psr.get("headers") or {}
    if isinstance(headers, dict):
        for k, v in headers.items():
            if isinstance(k, str) and k.lower() == "traceparent" and v:
                return str(v)
    # Some LiteLLM versions surface forwarded headers under metadata.headers.
    meta = data.get("metadata") or {}
    mh = meta.get("headers") or {}
    if isinstance(mh, dict):
        for k, v in mh.items():
            if isinstance(k, str) and k.lower() == "traceparent" and v:
                return str(v)
    return None


class RevaAuthHook(CustomGuardrail):
    """LiteLLM pre-call guardrail that delegates allow/deny to the Reva PDP.

    Subclasses ``CustomGuardrail`` (not ``CustomLogger``) so the proxy
    dispatches ``async_pre_call_hook`` through the guardrail path, which is
    the modern channel for blocking enforcement. Wired up via the
    ``guardrails:`` list in litellm_config.yaml.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.endpoint = os.getenv("REVA_PDP_URL", "").rstrip("/")
        self.origin = os.getenv("REVA_PDP_ORIGIN", "https://demo.preview.reva.ai")
        self.policy_store_id = os.getenv("REVA_POLICYSTORE_ID", "")
        self.auth_token = os.getenv("REVA_AUTH_TOKEN", "")
        self.mode = os.getenv("REVA_HOOK_MODE", "enforce").lower()
        self.timeout_s = float(os.getenv("REVA_PDP_TIMEOUT", "5.0"))
        # Which Cedar vocabulary to speak — see module docstring. Mirrors the
        # TrueFoundry plugin's REVA_SCHEMA_MODE so a single policy store serves
        # both gateways. "vanilla" keeps the original demo working unchanged.
        self.schema_mode = os.getenv("REVA_SCHEMA_MODE", "vanilla").lower()
        # agent_v5 only: the Agent id used as the request subject/principal.
        # Normally arrives per-request in metadata (reva_agent_id / agent_id);
        # this is the fallback.
        self.agent_id = os.getenv("REVA_AGENT_ID", "")
        self.environment = os.getenv("REVA_ENVIRONMENT", "")
        self._http: httpx.AsyncClient | None = None
        log.info(
            "RevaAuthHook initialised mode=%s schema_mode=%s pdp_configured=%s",
            self.mode,
            self.schema_mode,
            bool(self.endpoint and self.policy_store_id),
        )

    async def _http_client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=self.timeout_s)
        return self._http

    def _resolve_agent_id(self, meta: dict) -> str:
        return meta.get("reva_agent_id") or meta.get("agent_id") or self.agent_id or "unknown-agent"

    # ------------------------------------------------------------------
    # LiteLLM hook entrypoint
    # ------------------------------------------------------------------
    async def async_pre_call_hook(
        self,
        user_api_key_dict: Any,
        cache: Any,
        data: dict,
        call_type: Literal[
            "completion",
            "text_completion",
            "embeddings",
            "image_generation",
            "moderation",
            "audio_transcription",
            "pass_through_endpoint",
            "rerank",
        ],
    ) -> dict | None:
        # MCP tool calls have their own evaluation branch — different action
        # (InvokeTool) and resource (Tool) than LLM calls. The proxy dispatches
        # twice per MCP call (canonical + post-route normalized); we evaluate
        # only the canonical one which carries `name` and `server_id`.
        if call_type == "call_mcp_tool":
            return await self._handle_mcp_call(data)

        # Only gate LLM chat / text-completion calls; let embeddings, moderations,
        # etc. through. LiteLLM proxy uses the async variants (acompletion /
        # atext_completion) for routed calls, so accept both forms.
        if call_type not in (
            "completion", "acompletion", "text_completion", "atext_completion"
        ):
            return data

        meta = data.get("metadata") or {}

        # Demo-UI toggle: when the agent sets reva_in_loop=false the hook
        # short-circuits without calling the PDP. Lets a buyer see the same
        # prompt + identity flip from deny → allow with one switch.
        if meta.get("reva_in_loop") is False:
            log.info("bypass reva_in_loop=false user=%s model=%s",
                     meta.get("reva_user_id"), data.get("model"))
            return data

        trace_id = uuid.uuid4().hex
        if self.schema_mode == "agent_v5":
            eval_request, subject_id = self._build_llm_eval_v5(data, meta)
            resource_label = eval_request["resource"]["id"]
        else:
            eval_request, subject_id = self._build_llm_eval_vanilla(data, meta)
            resource_label = eval_request["resource"]["id"]

        log.info(
            "pre_call subject=%s model=%s trace=%s",
            subject_id, resource_label, trace_id,
        )

        decision, reason, latency_ms = await self._evaluate(
            eval_request, trace_id, incoming_traceparent=_incoming_traceparent(data)
        )

        # Latency_ms is intentionally kept off the log line — the demo UI
        # surfaces decisions to the buyer and we don't show numbers that
        # aren't representative of production yet.
        log.info(
            "decision=%s reason=%r trace=%s",
            decision, reason, trace_id,
        )

        if decision == "deny" and self.mode == "enforce":
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "reva_deny",
                    "message": reason or "Reva PDP denied the request",
                    "subject": subject_id,
                    "model": data.get("model"),
                    "trace_id": trace_id,
                },
            )

        return data

    # -- eval-request construction: LLM call -------------------------------
    def _build_llm_eval_vanilla(self, data: dict, meta: dict) -> tuple[dict, str]:
        """Original contract: User/CallModel/Model with attributes inlined."""
        user_id = meta.get("reva_user_id") or data.get("user") or "anonymous"
        team = meta.get("reva_team") or "unknown-team"
        tier = meta.get("reva_tier") or "unknown"
        model = data.get("model") or "unknown-model"
        requested_tools = [
            t.get("function", {}).get("name")
            for t in (data.get("tools") or [])
            if t.get("function", {}).get("name")
        ]
        messages_len = len(data.get("messages") or [])

        # Request shape mirrors what Reva's /pdp/access/v1/evaluation expects:
        # single eval object, bare type names (no LiteLLM:: prefix — the
        # policyStoreId header tells the PDP which namespace to resolve in),
        # and attributes inlined under `properties` on subject + resource.
        team_cfg = TEAM_CONFIG.get(team, _DEFAULT_TEAM)
        resource_properties = {
            # Tier is derived from the model name (gpt-4o, claude-opus →
            # premium; *-mini → standard). LiteLLM's own ModelInfo.tier is a
            # reserved literal, so we don't carry it on the proxy side.
            "name": model,
            "tier": _model_tier(model),
            "provider": _model_provider(model),
        }
        user_properties = {
            "team": team,
            "tier": tier,
            "allowedModels": team_cfg["allowedModels"],
            "blockedTools": team_cfg["blockedTools"],
            "approvedMcpTools": team_cfg.get("approvedMcpTools", []),
        }
        # Time-of-day for the off-hours policy. Cards in the demo UI can
        # override via metadata.simulated_hour so we don't have to wait for
        # the wall clock to roll past 6pm UTC to demo.
        sim_hour = meta.get("simulated_hour")
        try:
            hour = int(sim_hour) if sim_hour is not None else _dt.datetime.utcnow().hour
        except (TypeError, ValueError):
            hour = _dt.datetime.utcnow().hour

        context = {
            # `tools` (not `requested_tools`) — the Reva backend's Cedar
            # tokenizer mis-handles identifiers containing the substring "eq",
            # so we avoid `requested_tools` everywhere.
            "tools": requested_tools,
            "messages_len": messages_len,
            "hour": hour,
        }
        # Break-glass token only added when present, so policies can use
        # `context has approval_token` as the override clause.
        approval_token = meta.get("approval_token")
        if approval_token:
            context["approval_token"] = str(approval_token)

        eval_request = {
            "subject": {"type": "User", "id": user_id, "properties": user_properties},
            "action": {"name": "CallModel"},
            "resource": {"type": "Model", "id": model, "properties": resource_properties},
            "context": context,
        }
        return eval_request, user_id

    def _build_llm_eval_v5(self, data: dict, meta: dict) -> tuple[dict, str]:
        """AI Evaluation contract: Agent/invokeModel/Model + SharedContext
        (onBehalfOf, conversation history, seq-aligned hops), transmission
        (current prompt), and session (real turn). Ported from the TF plugin's
        build_model_eval agent_v5 branch."""
        agent_id = self._resolve_agent_id(meta)
        user_id = _resolve_v5_identity(data, meta)
        now = _iso_now()
        messages = data.get("messages")
        # LiteLLM can send provider-prefixed names ("bedrock/nova-premium");
        # the policy store's Model ids are bare ("nova-premium"). Derive the
        # provider from the full name, then strip the prefix so matching works.
        raw_model = data.get("model") or "unknown-model"
        provider = _model_provider(raw_model)
        model = raw_model.split("/", 1)[1] if "/" in raw_model else raw_model

        context = _ai_context(user_id, meta)
        # keep_current_prompt=True: chatHistory should be the ENTIRE conversation,
        # including the triggering user prompt (Sarthak's chatHistory[3] item #1 is
        # the user message). transmission still carries the current prompt too;
        # the small overlap matches the reference Kong payload. Including the user
        # message also gives _hops its user->invokeAgent entry.
        context["conversation"] = _conversation(messages, now, keep_current_prompt=True)
        # The Reva console's Decision Logs render prior turns under `chatHistory`
        # (Sarthak's Kong plugin sends that name), so emit the same flat array
        # there in addition to `conversation.messages`. Same data, both names —
        # so the history shows in the console AND feeds whatever reads either key.
        context["chatHistory"] = context["conversation"]["messages"]
        context["hops"] = _hops(agent_id, context["conversation"]["messages"], user_id, now)
        # NOTE (2026-07-20): `tools` and `hour` are NOT readable by Cedar under
        # the agent_v5 schema. SharedContext is a closed record — onBehalfOf,
        # chain, timestamp, sourceIp, geo, network, authStrength, rate, anomaly,
        # approvalToken, environment — and nothing else. A policy referencing
        # `context.tools` fails validation outright:
        #
        #   attribute `tools` in context for AppPolicies::Action::"invokeModel"
        #   not found
        #
        # They are kept because the PDP accepts them and non-Cedar consumers
        # (the intent engine) may read the envelope, and because vanilla mode
        # genuinely uses them. Do NOT write a v5 policy against these — express
        # the same intent via entity attributes instead (Tool.riskTier,
        # Tool.dataClassification), which is how the tool-governance scenarios
        # were re-modelled.
        context["tools"] = [
            t.get("function", {}).get("name")
            for t in (data.get("tools") or [])
            if isinstance(t, dict) and t.get("function", {}).get("name")
        ]
        sim_hour = meta.get("simulated_hour")
        try:
            context["hour"] = int(sim_hour) if sim_hour is not None else _dt.datetime.utcnow().hour
        except (TypeError, ValueError):
            context["hour"] = _dt.datetime.utcnow().hour
        approval_token = meta.get("approval_token")
        if approval_token:
            context["approval_token"] = str(approval_token)
        eval_request = {
            "subject": {"type": "Agent", "id": agent_id,
                        "name": meta.get("reva_agent_name") or meta.get("agent_name") or agent_id},
            "action": {"name": "invokeModel"},
            # tier drives forbid-premium-for-free-tier / the off-hours policy.
            "resource": {"type": "Model", "id": model, "name": model,
                         "properties": {"provider": provider, "tier": _model_tier(model)}},
            "principal": {"type": "User", "id": user_id},
            "context": context,
            "transmission": {"promptKey": "content", "role": "user",
                             "contentType": "text/plain",
                             "content": _extract_prompt(messages)},
            "session": _session(meta, now, _turn(messages)),
        }
        log.info(
            "[ai-eval] invokeModel agent=%s model=%s user=%s history=%d turn=%d",
            agent_id, model, user_id,
            len(context["conversation"]["messages"]), eval_request["session"]["turn"],
        )
        return eval_request, agent_id

    # ------------------------------------------------------------------
    # MCP tool-call branch — Action: InvokeTool, Resource: Tool
    # ------------------------------------------------------------------
    async def _handle_mcp_call(self, data: dict) -> dict | None:
        # Skip the second (post-route) dispatch which lacks the canonical
        # `name`/`server_id` keys. The first dispatch is the one we gate.
        tool_name = data.get("name")
        if not tool_name:
            return data

        meta = data.get("metadata") or {}

        # Same UI toggle behavior as LLM calls: bypass when reva_in_loop=false
        if meta.get("reva_in_loop") is False:
            log.info(
                "bypass reva_in_loop=false user=%s tool=%s",
                meta.get("reva_user_id"), tool_name,
            )
            return data

        server_id = data.get("server_id") or "unknown"
        trace_id = uuid.uuid4().hex

        if self.schema_mode == "agent_v5" and meta.get("reva_action") == "invokeAgent":
            # Sub-agent delegation wrapped as an MCP tool — authorize the
            # invokeAgent hop (Agent -> Agent), not the wrapper tool.
            eval_request, subject_id = self._build_agent_eval_v5(data, meta)
        elif self.schema_mode == "agent_v5":
            eval_request, subject_id = self._build_tool_eval_v5(data, meta, tool_name, server_id)
        else:
            eval_request, subject_id = self._build_tool_eval_vanilla(data, meta, tool_name, server_id)

        log.info(
            "pre_call subject=%s tool=%s server=%s trace=%s",
            subject_id, tool_name, server_id, trace_id,
        )

        decision, reason, _latency_ms = await self._evaluate(
            eval_request, trace_id, incoming_traceparent=_incoming_traceparent(data)
        )

        log.info(
            "decision=%s reason=%r trace=%s",
            decision, reason, trace_id,
        )

        if decision == "deny" and self.mode == "enforce":
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "reva_deny",
                    "message": reason or "Reva PDP denied the tool call",
                    "subject": subject_id,
                    "tool": tool_name,
                    "server": server_id,
                    "trace_id": trace_id,
                },
            )

        return data

    def _build_tool_eval_vanilla(self, data: dict, meta: dict, tool_name: str,
                                 server_id: str) -> tuple[dict, str]:
        """Original contract: User/InvokeTool/Tool with attributes inlined."""
        user_id = meta.get("reva_user_id") or "anonymous"
        team = meta.get("reva_team") or "unknown-team"
        tier = meta.get("reva_tier") or "unknown"

        team_cfg = TEAM_CONFIG.get(team, _DEFAULT_TEAM)
        user_properties = {
            "team": team,
            "tier": tier,
            "allowedModels": team_cfg["allowedModels"],
            "blockedTools": team_cfg["blockedTools"],
            "approvedMcpTools": team_cfg.get("approvedMcpTools", []),
        }
        # Tool risk score from Reva's continuous MCP scanner. In production
        # the scanner writes this onto the Tool entity in Reva's store;
        # the hook ships the tool's current attributes on every InvokeTool
        # eval. Scenario cards can simulate a freshly-detected rug-pull by
        # passing `metadata.simulated_risk_score` — same call, score flipped
        # high, forbid-tool-when-risk-score-high policy fires.
        sim_score = meta.get("simulated_risk_score")
        try:
            risk_score = (
                int(sim_score) if sim_score is not None else _tool_risk_score(tool_name)
            )
        except (TypeError, ValueError):
            risk_score = _tool_risk_score(tool_name)

        # Tool category — heuristic by name. Lets the
        # forbid-pii-tool-for-intern policy bite without us having to author
        # an entity per tool in the policy store.
        tool_properties = {
            "name": tool_name,
            "category": _tool_category(tool_name),
            "server": server_id,
            "risk_score": risk_score,
        }
        # Args summary is a string for Cedar's String type; cap length so a
        # large argument blob doesn't blow up the context.
        args_summary = str(data.get("arguments") or {})[:240]

        eval_request = {
            "subject": {"type": "User", "id": user_id, "properties": user_properties},
            "action": {"name": "InvokeTool"},
            "resource": {"type": "Tool", "id": tool_name, "properties": tool_properties},
            "context": {"tool_name": tool_name, "args_summary": args_summary},
        }
        return eval_request, user_id

    def _build_tool_eval_v5(self, data: dict, meta: dict, tool_name: str,
                            server_id: str) -> tuple[dict, str]:
        """AI Evaluation contract: Agent/invokeTool/Tool + SharedContext. Ported
        from the TF plugin's build_tool_eval agent_v5 branch.

        Tool-call authorizations carry NO message history today (the MCP
        pre-call payload is just the tool args), so the intent engine can't
        judge a tool call against the conversation — the drift gap Amit
        described. Forward-compatible: if the orchestrator supplies the
        transcript under metadata.conversation/messages, we map it.
        """
        agent_id = self._resolve_agent_id(meta)
        user_id = _resolve_v5_identity(data, meta)
        now = _iso_now()
        # Server-qualify the tool id so it matches the hop convention
        # ("server/tool") and the store entity ids. Bare name when no server.
        #
        # The *routing* server id and the *policy* server id are allowed to
        # differ: LiteLLM forbids "-" in mcp_servers names, but a shared policy
        # store may use hyphenated ids (e.g. "billing-mcp"). The agent can send
        # `reva_server_id` in metadata to name the resource as the store knows
        # it, while traffic still routes to the local server.
        policy_server = meta.get("reva_server_id") or server_id
        # An explicit policy resource id wins: the tool EXECUTES under its real
        # MCP name (e.g. get_market_analysis) but the store may know the resource
        # by a different id (e.g. reva-mcp-server/market-analysis-mcp). The agent
        # passes that id as reva_tool_id so the permit matches without renaming
        # the shared store's Tool entities.
        tool_id = (meta.get("reva_tool_id") or meta.get("reva_resource_id")
                   or (f"{policy_server}/{tool_name}"
                       if policy_server and policy_server != "unknown" else tool_name))
        arguments = data.get("arguments")

        context = _ai_context(user_id, meta)
        # Also surface the scanner risk score on the context (not just the resource)
        # so a policy can read `context.risk_score` directly — context passes through
        # from the eval, whereas resource attributes resolve from store entity data.
        # Same caveat as `tools`/`hour` on the model path: `risk_score` is not in
        # the agent_v5 SharedContext, so Cedar cannot read it. The equivalent v5
        # control reads Tool.riskTier from published entity data instead, which
        # also means the scanner updates data rather than policy.
        context["risk_score"] = _resolve_tool_risk(tool_name, meta)
        history = meta.get("conversation") or meta.get("messages")
        # A tool call has no "current user prompt" to hold back (its transmission
        # is the tool arguments), so include the whole conversation — the user
        # prompt and every prior turn/tool result all count as history here.
        context["conversation"] = (
            _conversation(history, now, keep_current_prompt=True)
            if history else {"messages": []}
        )
        # Same as the model path: mirror history under `chatHistory` for the
        # Decision Logs console view.
        context["chatHistory"] = context["conversation"]["messages"]
        context["hops"] = _hops(agent_id, context["conversation"]["messages"], user_id, now)
        turn = _turn(history) if history else int(meta.get("turn") or 1)
        eval_request = {
            "subject": {"type": "Agent", "id": agent_id,
                        "name": meta.get("reva_agent_name") or meta.get("agent_name") or agent_id},
            "action": {"name": "invokeTool"},
            # Authoritative Tool attributes (dataClassification, riskTier,
            # agent_v5 parity with vanilla: carry category + risk_score inline so
            # forbid-pii-tool-for-intern and forbid-tool-when-risk-score-high can
            # evaluate. (Without these agent_v5 sent only type+id+name, so the
            # PII-category and scanner-drift scenarios could not fire.)
            "resource": {"type": "Tool", "id": tool_id, "name": tool_name,
                         "properties": {
                             "name": tool_name,
                             "category": _tool_category(tool_name),
                             "risk_score": _resolve_tool_risk(tool_name, meta),
                         }},
            "principal": {"type": "User", "id": user_id},
            "context": context,
            "transmission": {"promptKey": "content", "role": "user",
                             "contentType": "text/plain",
                             "content": str(arguments or "")[:2000]},
            "inputValues": arguments if isinstance(arguments, dict) else {},
            "session": _session(meta, now, turn),
        }
        log.info(
            "[ai-eval] invokeTool agent=%s tool=%s user=%s history=%d",
            agent_id, tool_id, user_id, len(context["conversation"]["messages"]),
        )
        return eval_request, agent_id

    def _build_agent_eval_v5(self, data: dict, meta: dict) -> tuple[dict, str]:
        """AI Evaluation for agent->agent delegation: Agent/invokeAgent/Agent.

        A sub-agent is exposed as an MCP tool so the delegation traverses the
        gateway, but the authorization we want is the delegation itself
        (finbot-agent -> credit-agent), so the resource is the TARGET Agent
        (meta.reva_agent_resource), not the wrapper Tool. This matches the
        store's Agent->Agent (invokeAgent) permit.
        """
        agent_id = self._resolve_agent_id(meta)
        user_id = _resolve_v5_identity(data, meta)
        now = _iso_now()
        target = meta.get("reva_agent_resource") or "unknown-agent"
        arguments = data.get("arguments")
        context = _ai_context(user_id, meta)
        history = meta.get("conversation") or meta.get("messages")
        context["conversation"] = (
            _conversation(history, now, keep_current_prompt=True)
            if history else {"messages": []}
        )
        context["chatHistory"] = context["conversation"]["messages"]
        context["hops"] = _hops(agent_id, context["conversation"]["messages"], user_id, now)
        turn = _turn(history) if history else int(meta.get("turn") or 1)
        msg = str(arguments.get("message") or "")[:2000] if isinstance(arguments, dict) else ""
        eval_request = {
            "subject": {"type": "Agent", "id": agent_id,
                        "name": meta.get("reva_agent_name") or agent_id},
            "action": {"name": "invokeAgent"},
            "resource": {"type": "Agent", "id": target, "name": target},
            "principal": {"type": "User", "id": user_id},
            "context": context,
            "transmission": {"promptKey": "content", "role": "user",
                             "contentType": "text/plain", "content": msg},
            "session": _session(meta, now, turn),
        }
        log.info("[ai-eval] invokeAgent agent=%s -> %s user=%s", agent_id, target, user_id)
        return eval_request, agent_id

    # ------------------------------------------------------------------
    async def _evaluate(
        self, eval_request: dict, trace_id: str,
        *, incoming_traceparent: str | None = None,
    ) -> tuple[str, str, int]:
        """Call the Reva PDP and normalize the outcome. Returns
        (decision, reason, latency_ms).

        vanilla mode hits ``/pdp/access/v1/evaluation`` (raw token + origin +
        minted traceparent). agent_v5 hits the AI Evaluation API
        ``/pdp/access/v1/ai/evaluation`` (Bearer token + policyStoreId +
        x-ms-correlation-id) and FORWARDS ``incoming_traceparent`` so a
        session's calls share one trace.

        If the PDP isn't configured (no URL) or transport fails, we *log-only*
        — never block traffic on infra issues. Production would invert this
        with REVA_FAIL_MODE=closed.
        """
        if not (self.endpoint and self.policy_store_id and self.auth_token):
            return "allow", "pdp not configured (allow-by-default)", 0

        # Bearer-normalize: the Reva preview/AI-Evaluation PDPs require
        # `Bearer <token>`. Accept a token pasted with or without the prefix.
        token = self.auth_token
        auth = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        if self.schema_mode == "agent_v5":
            # The traceparent this call actually sends — the inbound one when the
            # agent forwarded a turn-level id, else a minted one.
            traceparent = incoming_traceparent or _build_traceparent(trace_id)
            # The console reads the trace from the request BODY (Decision Logs
            # show `trace_source: request-body`), not the header — so the shared
            # turn id MUST be in the eval body, else the PDP generates a fresh
            # one per hop and the trace filter scatters them. This mirrors what
            # the Kong plugin's Lua does ("add the trace into the PDP body").
            eval_request["trace_id"] = _trace_id_of(traceparent)
            eval_request["parent_span_id"] = _span_id_of(traceparent)
            # Correlation header too, belt-and-braces.
            headers = {
                "Content-Type": "application/json",
                "policyStoreId": self.policy_store_id,
                "Authorization": auth,
                "x-ms-correlation-id": _trace_id_of(traceparent),
                "traceparent": traceparent,
            }
        else:
            headers = {
                "Content-Type": "application/json",
                "policyStoreId": self.policy_store_id,
                "Authorization": auth,
                "origin": self.origin,
                "traceparent": _build_traceparent(trace_id),
            }

        # Log the traceparent actually sent to the PDP — parity with the
        # TrueFoundry plugin's `tp=` hop lines, and the only way to confirm a
        # turn's hops correlate rather than each minting its own id.
        log.info("pdp → %s tp=%s corr=%s", self.schema_mode, headers.get("traceparent", "-"), headers.get("x-ms-correlation-id", "-"))

        t0 = time.perf_counter()
        try:
            client = await self._http_client()
            resp = await client.post(self.endpoint, json=eval_request, headers=headers)
        except Exception as e:
            elapsed = int((time.perf_counter() - t0) * 1000)
            log.warning("PDP error: %s — failing open", e)
            return "allow", f"pdp error: {type(e).__name__}", elapsed

        # DO NOT raise_for_status. The AI Evaluation API returns the decision
        # envelope on BOTH 200 (allow) and 403 (deny) — a 403 here is a *policy
        # denial*, not an infra failure. So we honor any body that carries a
        # `decision`, regardless of status. Only a response with no decision
        # (401 auth, 5xx, non-JSON) is a genuine error → fail open (log-only).
        elapsed = int((time.perf_counter() - t0) * 1000)
        try:
            payload = resp.json()
        except Exception:
            payload = None

        result = payload[0] if isinstance(payload, list) and payload else payload
        result = result if isinstance(result, dict) else {}
        if "decision" not in result:
            log.warning(
                "PDP %s no-decision response=%r request_keys=%s — failing open",
                resp.status_code, resp.text[:500], sorted(eval_request.keys()),
            )
            return "allow", f"pdp error: HTTP {resp.status_code}", elapsed

        raw_decision = result.get("decision")
        decision = "allow" if raw_decision in (True, "allow", "Allow") else "deny"

        # Reason: AI Evaluation API returns it at context.reason on deny; the
        # generic PDP returns determiningPolicies. Support both.
        reason = ""
        ctx = result.get("context")
        if isinstance(ctx, dict) and ctx.get("reason"):
            reason = str(ctx["reason"])
        if not reason:
            determining = result.get("determiningPolicies") or []
            reason = "; ".join(
                p.get("policyId") or p.get("policy_id") or "policy"
                for p in determining if isinstance(p, dict)
            )
        return decision, reason, result.get("latency_ms", elapsed)


def _model_tier(model: str) -> str:
    m = (model or "").lower()
    # Two tiers only: amazon.nova-micro-v1-0 is standard (open to everyone),
    # nova-premium is premium (gated). The substring test also keeps any
    # *-mini / *-micro / haiku name on the standard side.
    if "mini" in m or "micro" in m or "haiku" in m or "3.5" in m:
        return "standard"
    return "premium"


def _tool_category(tool_name: str) -> str:
    """Map MCP tool names → Cedar category. Keeps policy authors out of
    per-tool boolean attributes; one rule covers any future tool that
    matches the name pattern."""
    n = (tool_name or "").lower()
    if "pii" in n or "customer" in n or "personal" in n:
        return "pii"
    if "compliance" in n or "audit" in n:
        return "compliance"
    if "billing" in n or "invoice" in n or "report" in n:
        return "billing"
    return "general"


# Mock "Reva MCP scanner" output. A real implementation runs a continuous
# scanner against every connected MCP server — hashing tool definitions,
# diffing them across pulls, scoring descriptions with an LLM-judge for
# instruction-injection patterns and schema drift, then publishing
# a per-tool risk score (0–100). The hook fetches that score on every
# call and ships it in the PDP eval context.
#
# For the demo we hard-code a baseline. A scenario card can override via
# `metadata.simulated_risk_score` so the buyer sees the same tool flip
# from low → high as if a rug-pull had just been detected.
_BASELINE_TOOL_RISK: dict[str, int] = {
    "get_billing_report":         10,
    "get_compliance_status":      15,
    "get_customer_pii":           40,   # baseline higher because it touches PII
    "analytics_diagnostic_probe": 80,   # the deliberately-rugged tool
}


def _tool_risk_score(tool_name: str) -> int:
    """Look up the current scanner-reported risk score for an MCP tool.

    Returns 0 when the tool isn't in our catalog — the policy treats
    "unknown" as benign by default and other policies catch new tools
    via the approvedMcpTools manifest.
    """
    return _BASELINE_TOOL_RISK.get(tool_name, 0)


def _resolve_tool_risk(tool_name: str, meta: dict[str, Any]) -> int:
    """Scanner risk score, with the demo's `simulated_risk_score` override.

    Same resolution vanilla uses — extracted so the agent_v5 tool eval can
    carry the score too (the scanner-drift scenario needs it).
    """
    sim = meta.get("simulated_risk_score")
    try:
        return int(sim) if sim is not None else _tool_risk_score(tool_name)
    except (TypeError, ValueError):
        return _tool_risk_score(tool_name)


def _model_provider(model: str) -> str:
    m = (model or "").lower()
    if m.startswith("gpt") or m.startswith("openai/"):
        return "openai"
    if "claude" in m or m.startswith("anthropic/"):
        return "anthropic"
    if m.startswith("bedrock/"):
        return "bedrock"
    return "unknown"


# The guardrails: config in litellm_config.yaml points at the class path
# ``reva_auth_hook.RevaAuthHook`` and LiteLLM instantiates it itself, so
# no module-level instance / litellm.callbacks registration is needed.
