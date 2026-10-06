// ── Slack approvals ───────────────────────────────────────────────────────────
// Posts the approval card and verifies the click that comes back.
//
// Slack is a CONVENIENCE here, never the authority. Everything it does, the
// in-app queue also does; a Slack outage degrades to that queue rather than
// stranding somebody's turn. What Slack must not do is let an unverified or
// unattributable click become a verdict, so both of those fail closed.

import crypto from "crypto";
import type { Approval } from "./approvals.js";

const BOT_TOKEN       = process.env.SLACK_BOT_TOKEN || "";
const SIGNING_SECRET  = process.env.SLACK_SIGNING_SECRET || "";
const CHANNEL         = process.env.SLACK_APPROVALS_CHANNEL || "";

/** Slack email → bank email, for the common case where the two directories
 *  disagree. `alice@slack.example=alice.smith@reva.ai,...`  Empty when they match. */
const APPROVER_MAP: Record<string, string> = Object.fromEntries(
  (process.env.SLACK_APPROVER_MAP || "")
    .split(",")
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
      const i = pair.indexOf("=");
      return i === -1 ? null : [pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim()];
    })
    .filter(Boolean) as [string, string][],
);

/** Argument keys allowed onto the card. Everything else is withheld: Slack is a
 *  wider audience than the app, and an approver does not need the whole record
 *  to answer "should this happen". */
const CARD_FIELDS = new Set(
  (process.env.SLACK_CARD_FIELDS || "applicant_name,loan_id,amount")
    .split(",").map(s => s.trim()).filter(Boolean),
);

export function slackEnabled(): boolean {
  return Boolean(BOT_TOKEN && SIGNING_SECRET && CHANNEL);
}

/** What is missing, for a startup line that names the gap instead of going quiet. */
export function slackConfigGaps(): string[] {
  const gaps: string[] = [];
  if (!BOT_TOKEN)      gaps.push("SLACK_BOT_TOKEN");
  if (!SIGNING_SECRET) gaps.push("SLACK_SIGNING_SECRET");
  if (!CHANNEL)        gaps.push("SLACK_APPROVALS_CHANNEL");
  return gaps;
}

// ── Redaction ─────────────────────────────────────────────────────────────────
// Applied to every free-text value that reaches the card, allowlisted or not.
// The allowlist decides which FIELDS appear; this decides that a field's value
// cannot smuggle an identifier through regardless.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g,                     "[email]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g,                        "[ssn]"],
  [/\b(?:\d[ -]?){13,19}\b/g,                       "[card/account]"],
  [/\b\+?\d[\d\s().-]{8,}\d\b/g,                    "[phone]"],
];

export function redact(value: string, max = 200): string {
  let out = String(value ?? "");
  for (const [re, tag] of PATTERNS) out = out.replace(re, tag);
  return out.length > max ? out.slice(0, max) + "…" : out;
}

function argumentLines(approval: Approval): string {
  const keys = Object.keys(approval.arguments || {});
  if (!keys.length) return "_no arguments_";
  return keys.map(k => {
    if (!CARD_FIELDS.has(k)) return `• *${k}*: _withheld — open in app_`;
    return `• *${k}*: ${redact(String((approval.arguments as any)[k]), 80)}`;
  }).join("\n");
}

// ── Posting ───────────────────────────────────────────────────────────────────

/**
 * Post the card. Throws on failure; the caller degrades to the in-app queue.
 * The approval id rides on each button's `value`, so a click identifies the
 * record exactly rather than being matched back by content.
 */
export async function postApprovalCard(approval: Approval): Promise<{ channel: string; ts: string }> {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "Approval needed" } },
    { type: "section", text: { type: "mrkdwn",
        text: `*${redact(approval.tool, 60)}* requested by *${redact(approval.requester, 60)}*` } },
    { type: "section", text: { type: "mrkdwn", text: argumentLines(approval) } },
    { type: "context", elements: [{ type: "mrkdwn",
        text: `_“${redact(approval.prompt, 160)}”_` }] },
    { type: "actions", block_id: `approval:${approval.id}`, elements: [
      { type: "button", style: "primary", action_id: "hitl_approve",
        text: { type: "plain_text", text: "Approve" }, value: approval.id },
      { type: "button", style: "danger", action_id: "hitl_reject",
        text: { type: "plain_text", text: "Reject" },  value: approval.id },
    ]},
    { type: "context", elements: [{ type: "mrkdwn",
        text: `id \`${approval.id}\` · approving here does not run it — the request ` +
              `is replayed and the policy decides` }] },
  ];

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8",
               Authorization: `Bearer ${BOT_TOKEN}` },
    body: JSON.stringify({ channel: CHANNEL, blocks, text: `Approval needed: ${approval.tool}` }),
  });
  const data: any = await res.json();
  // Slack answers 200 with ok:false for most real failures — channel_not_found,
  // not_in_channel, invalid_auth. Checking res.ok alone reports every one of
  // those as a successful post.
  if (!data?.ok) throw new Error(`slack chat.postMessage: ${data?.error || res.status}`);
  return { channel: data.channel, ts: data.ts };
}

/** Rewrite the card once decided, so the next person to read it does not act on
 *  a question that has been answered. Best-effort: a failure here changes nothing. */
export async function updateApprovalCard(approval: Approval): Promise<void> {
  if (!approval.slack) return;
  const verb = approval.status === "approved" ? "Approved" : "Rejected";
  const icon = approval.status === "approved" ? "✅" : "⛔";
  try {
    await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8",
                 Authorization: `Bearer ${BOT_TOKEN}` },
      body: JSON.stringify({
        channel: approval.slack.channel, ts: approval.slack.ts,
        text: `${verb}: ${approval.tool}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn",
              text: `${icon} *${verb}* — ${redact(approval.tool, 60)} requested by ` +
                    `${redact(approval.requester, 60)}` } },
          { type: "context", elements: [{ type: "mrkdwn",
              text: `by ${redact(approval.approver || "unknown", 60)} · id \`${approval.id}\`` }] },
        ],
      }),
    });
  } catch (e: any) {
    console.warn(`[hitl] could not update Slack card for ${approval.id}: ${e?.message || e}`);
  }
}

// ── Verifying the click ───────────────────────────────────────────────────────

/**
 * Slack signs the RAW request body. This must be handed the exact bytes Express
 * received — re-serialising a parsed body reorders and re-escapes it, and every
 * signature then fails for a reason that looks like a wrong secret.
 *
 * Returns false, never throws: a malformed or unsigned request is simply not a
 * verdict.
 */
export function verifySlackSignature(
  rawBody: Buffer | string,
  timestamp: string | undefined,
  signature: string | undefined,
): boolean {
  if (!SIGNING_SECRET || !timestamp || !signature) return false;

  // Five-minute window, so a captured request cannot be replayed later.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const base = `v0:${timestamp}:${Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody}`;
  const mine = "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(base).digest("hex");

  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  const a = Buffer.from(mine, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Slack user id → the bank email the verdict is attributed to.
 *
 * Returns "" when it cannot be established, and every caller must refuse on ""
 * rather than substituting a placeholder. An approval recorded against
 * "unknown" is worse than no approval: it looks like accountability in the log
 * and carries none.
 */
export async function resolveApproverEmail(slackUserId: string): Promise<string> {
  if (!slackUserId || !BOT_TOKEN) return "";
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
      { headers: { Authorization: `Bearer ${BOT_TOKEN}` } });
    const data: any = await res.json();
    if (!data?.ok) {
      console.warn(`[hitl] slack users.info failed: ${data?.error || res.status}`);
      return "";
    }
    const slackEmail = String(data.user?.profile?.email || "").toLowerCase();
    if (!slackEmail) return "";
    return APPROVER_MAP[slackEmail] || slackEmail;
  } catch (e: any) {
    console.warn(`[hitl] slack users.info error: ${e?.message || e}`);
    return "";
  }
}
