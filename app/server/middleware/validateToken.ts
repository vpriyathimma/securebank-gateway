import { Request, Response, NextFunction } from "express";
import { verifyTrAT } from "../trat.js";

const BEDROCK_AGENT_ID = "KQ2UZORR1E";

export interface TokenClaims {
  sub: string;          // email
  role: string;
  clearance_level: number;
  branch_id: string;
  department: string | null;
  act?: { sub: string; agent_type: string };
}

// ── requireAuth ───────────────────────────────────────────────────────────────
// Attaches req.user from session claims. 401 if not logged in.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.claims) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  (req as any).user = req.session.claims as TokenClaims;
  next();
}

// ── requireRole ───────────────────────────────────────────────────────────────
// 403 if token has no role claim (TES was bypassed / inline hook disabled)
export function requireRole(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as TokenClaims;
  if (!user?.role) {
    return res.status(403).json({
      error: "Access Denied",
      loginStatus: "authenticated",
      accessStatus: "denied",
      reason: "TOKEN_MISSING_ROLE",
      message: "Login successful but Business operations are denied for your current role. Please contact App team to validate your Role details.",
    });
  }
  next();
}

// ── requireAgentAct ───────────────────────────────────────────────────────────
// For FinBot agent routes — token must have act.sub = Bedrock agent ID
// This proves TES enriched the token AND the right agent is acting
export function requireAgentAct(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as TokenClaims;

  if (!user?.act?.sub) {
    return res.status(403).json({
      error: "Agent invocation denied",
      reason: "NO_ACT_CLAIM",
      message: "Token is missing act.sub claim. TES must enrich the token with agent delegation before FinBot can be invoked.",
    });
  }

  if (user.act.sub !== BEDROCK_AGENT_ID) {
    return res.status(403).json({
      error: "Agent invocation denied",
      reason: "INVALID_ACT_SUB",
      message: `act.sub '${user.act.sub}' does not match registered Bedrock agent '${BEDROCK_AGENT_ID}'.`,
    });
  }

  next();
}

// ── requireTrAT ───────────────────────────────────────────────────────────────
// DISABLED — governance removed. Just pass through.
export function requireTrAT(req: Request, res: Response, next: NextFunction) {
  // No TrAT validation — basic banking app mode
  (req as any).trat = {
    sub: (req as any).session?.claims?.sub || (req as any).user?.sub || "unknown",
    role: (req as any).session?.claims?.role || (req as any).user?.role || "",
    clearance_level: (req as any).session?.claims?.clearance_level || 10,
    branch_id: (req as any).session?.claims?.branch_id || "BR001",
    trace_id: "no-governance",
  };
  next();
}

// ── requireTrAT ───────────────────────────────────────────────────────────────
// Validates TrAT on all /api/agent/* routes.
// Checks: HMAC signature, expiry (2 min TTL), Okta session still alive.
// Attaches TrAT claims to req.trat.
/*export function requireTrAT(req: Request, res: Response, next: NextFunction) {
  const authHeader = (req as any).headers["authorization"] as string;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "TrAT required",
      reason: "MISSING_TRAT",
      message: "Authorization header with Bearer TrAT token is required.",
    });
  }

  const token   = authHeader.slice(7);
  const payload = verifyTrAT(token);

  if (!payload) {
    return res.status(401).json({
      error: "Invalid or expired TrAT",
      reason: "TRAT_INVALID",
      message: "TrAT signature invalid or token has expired. Request a new TrAT via POST /auth/trat.",
    });
  }

  // Session check — only if session is present (browser requests).
  // Lambda server-to-server calls have no session — TrAT HMAC + TTL + okta_jti binding is sufficient.
  // A TrAT can only be issued with a valid Okta session, so the chain is always anchored to Okta.
  const sessionClaims = (req as any).session?.claims;
  if (sessionClaims) {
    // Session exists — verify JTI matches what was bound at TrAT issuance
    const sessionJti = sessionClaims.jti as string;
    if (sessionJti && payload.okta_jti && sessionJti !== payload.okta_jti) {
      return res.status(401).json({
        error: "TrAT rejected",
        reason: "OKTA_SESSION_MISMATCH",
        message: "Okta session has changed. Please request a new TrAT.",
      });
    }
    // Session present but no active claims — session expired
    if (!sessionClaims.sub) {
      return res.status(401).json({
        error: "TrAT rejected",
        reason: "OKTA_SESSION_EXPIRED",
        message: "Okta session has expired. Please re-authenticate.",
      });
    }
  }
  // No session = Lambda/server call — TrAT HMAC + TTL is sufficient gate

  (req as any).trat = payload;
  next();
} */
