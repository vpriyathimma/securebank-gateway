// ── Approvals store ───────────────────────────────────────────────────────────
// The record of who was asked, what they were asked about, and what they said.
//
// The agent pauses and the store remembers; neither of them ENFORCES anything.
// A rejection is binding because Cedar denies the replayed hop — see
// HITL-CONTRACT.md. If you read this file looking for the code that stops a
// rejected loan, it is not here and it is not supposed to be.
//
// In-memory, like the session store above it: single process, state resets on
// restart, does not survive replicas. Fine for a demo, and stated rather than
// discovered.

import crypto from "crypto";

export type Verdict = "approved" | "rejected";
export type ApprovalStatus = "pending" | Verdict;

export interface Approval {
  id: string;
  /** The join key. The chat id from the turn that raised this, replayed VERBATIM. */
  sessionId: string;
  /** Bare tool name, as REVA_HITL_TOOLS names it. Not the entity id. */
  tool: string;
  arguments: Record<string, unknown>;
  /** The user's clean prompt — what they actually asked for. */
  prompt: string;
  displayMessage: string;
  requester: string;
  requesterId: string;
  createdAt: string;
  status: ApprovalStatus;
  approver?: string;
  decidedAt?: string;
  /** Where the card landed, so a decision can edit it. Null when Slack is off. */
  slack?: { channel: string; ts: string } | null;
  /** Why the card did not land. Surfaced in the queue — a silently missing card
   *  looks exactly like a card nobody has looked at yet. */
  slackError?: string | null;
}

export interface DecisionResult {
  ok: boolean;
  reason?: "not_found" | "already_decided" | "self_approval";
  approval?: Approval;
}

// Self-approval is refused unless explicitly disabled. Defaulting this OFF would
// make the demo work on the first try for one signed-in user, and would also be
// the wrong thing for anyone who copies this file into something real.
export const MAKER_CHECKER =
  (process.env.HITL_MAKER_CHECKER || "true").toLowerCase() !== "false";

// Bounded so a long-running demo cannot grow it without limit. Decided records
// are evicted first; a pending one is still someone waiting.
const MAX_RECORDS = 200;

const records = new Map<string, Approval>();

function evictIfNeeded(): void {
  if (records.size <= MAX_RECORDS) return;
  const decided = Array.from(records.values())
    .filter(a => a.status !== "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const a of decided) {
    if (records.size <= MAX_RECORDS) break;
    records.delete(a.id);
  }
}

/**
 * `pending` is the agent's block, forwarded whole. Its field names are the
 * agent's (snake_case) — this is the one place they are translated, so the
 * contract is legible in a single diff when either side moves.
 */
export function create(
  pending: any,
  requester: { email: string; id: string },
): Approval {
  const approval: Approval = {
    id:             `ap-${crypto.randomUUID()}`,
    sessionId:      String(pending?.session_id || ""),
    tool:           String(pending?.tool || ""),
    arguments:      (pending && typeof pending.arguments === "object" && pending.arguments) || {},
    prompt:         String(pending?.prompt || ""),
    displayMessage: String(pending?.display_message || "This action needs approval."),
    // The agent reports who it thinks asked; the session is what we actually
    // know. The session wins — the agent's copy travelled through the model.
    requester:      requester.email || String(pending?.requester || ""),
    requesterId:    requester.id,
    createdAt:      new Date().toISOString(),
    status:         "pending",
    slack:          null,
    slackError:     null,
  };
  records.set(approval.id, approval);
  evictIfNeeded();
  return approval;
}

export function get(id: string): Approval | undefined {
  return records.get(id);
}

export function listPending(): Approval[] {
  return Array.from(records.values())
    .filter(a => a.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAll(limit = 50): Approval[] {
  return Array.from(records.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/**
 * Record a verdict. Returns ok:false with a reason rather than throwing — every
 * caller here is an HTTP handler and each reason maps to a different status.
 *
 * A second decision on the same record is REFUSED, not overwritten: two people
 * clicking a Slack card a second apart must not race, and the first answer is
 * the one the requester may already have been told.
 */
export function decide(
  id: string,
  verdict: Verdict,
  approver: string,
): DecisionResult {
  const approval = records.get(id);
  if (!approval) return { ok: false, reason: "not_found" };
  if (approval.status !== "pending") {
    return { ok: false, reason: "already_decided", approval };
  }
  if (MAKER_CHECKER && approver && approver === approval.requester) {
    return { ok: false, reason: "self_approval", approval };
  }
  approval.status   = verdict;
  approval.approver = approver;
  approval.decidedAt = new Date().toISOString();
  return { ok: true, approval };
}

/** The three fields the agent replays. Absent means nobody has been asked. */
export function verdictFor(approval: Approval): null | {
  status: Verdict; approver: string; approval_id: string;
} {
  if (approval.status === "pending") return null;
  return {
    status:      approval.status,
    approver:    approval.approver || "",
    approval_id: approval.id,
  };
}
