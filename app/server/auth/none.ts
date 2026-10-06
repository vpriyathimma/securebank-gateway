/**
 * AUTH_PROVIDER=none — no identity provider.
 *
 * Pick a seeded user from a list and you are signed in as them. This exists so
 * the demo can be cloned and run with zero cloud setup; it is the default mode.
 *
 * This is deliberately a bypass. It was previously reachable in EVERY mode as an
 * unguarded `POST /auth/direct-login` on the main router — any caller could mint
 * a Bank Manager session by posting an email, in production, with no password
 * and no NODE_ENV check. It now only exists when AUTH_PROVIDER=none, and the
 * router refuses to mount otherwise.
 */
import express, { Request, Response } from "express";
import crypto from "crypto";
import { storage } from '../storage.js';
import { setSessionTokens } from './index.js';
import { appUrl } from '../base-path.js';

const router = express.Router();

// Optional shared password for the demo picker. Empty (the default) means any
// listed user can be selected with one click. It is NOT a security control —
// it is a shared secret sitting in .config, and the whole mode is a bypass —
// but it stops a casual visitor to a shared demo box from clicking straight in,
// and it gives the README something concrete to document.
const DEMO_PASSWORD = (process.env.DEMO_PASSWORD || "").trim();

// Mint a local id_token on sign-in. Default ON, because the whole point of this
// app is to demonstrate Reva authorization and that needs a principal.
//
// Without a token the app sends no Authorization header, the SDK derives an
// EMPTY principal (it reads the JWT payload — see
// _jwt_subject_without_verification) and every User-scoped policy stops
// matching. That made RTG_DISABLED=false unusable without first registering an
// app in Entra or Okta, which is a lot of hoops just to watch a PDP call happen.
//
// The token is signed HS256 with SESSION_SECRET. That signature is meaningless
// to anyone but us — no IdP issued it and no JWKS will verify it — so this is
// strictly a local-demo affordance, never an authentication mechanism. It works
// because the SDK derives the principal from the token's CLAIMS without
// verifying the signature.
const PREFILL_PASSWORD =
  (process.env.DEMO_PASSWORD_PREFILL || "true").trim().toLowerCase() !== "false";

const MINT_TOKEN = (process.env.DEMO_MINT_TOKEN || "true").trim().toLowerCase() !== "false";
const TOKEN_ISSUER = (process.env.DEMO_TOKEN_ISSUER || "https://securebank.local/demo").trim();
const TOKEN_TTL_SECONDS = parseInt(process.env.DEMO_TOKEN_TTL_SECONDS || "28800", 10); // 8h

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * A locally-signed OIDC-shaped id_token for a seeded user.
 *
 * Claim names deliberately mirror what the real providers emit, so
 * PRINCIPAL_CLAIM works unchanged whichever value is configured:
 *   sub / email                  — what okta and AUTH_PROVIDER=none use
 *   upn / preferred_username     — what entra uses
 */
function mintIdToken(user: any): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: TOKEN_ISSUER,
    aud: "securebank-demo",
    iat: now,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    sub: user.email,
    email: user.email,
    upn: user.email,
    preferred_username: user.email,
    name: user.name || user.email,
    // Local attributes the policies key on, so they are visible to anything
    // that reads the token rather than the session.
    role: user.role || "",
    branch_id: user.branchId || "",
    department: user.department || "",
    clearance_level: user.clearanceLevel || 0,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "insecure-demo-key")
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${sig}`;
}

// ── GET /auth/login ───────────────────────────────────────────────────────────
// There is no IdP to redirect to; the SPA renders its own user picker.
router.get("/login", (_req: Request, res: Response) => {
  res.redirect(appUrl("/?login=pick"));
});

// ── GET /auth/users ───────────────────────────────────────────────────────────
// Feeds the picker. Only the fields needed to choose an identity — no account
// numbers, balances or the synthetic PII carried on the full user record.
router.get("/users", async (_req: Request, res: Response) => {
  const users = await storage.getUsers();
  // The password is returned so the picker can prefill it. That is deliberate
  // for a local demo — hunting for a value in .config is pure friction — but it
  // does mean the password no longer gates anything, since every visitor to the
  // login page receives it. Set DEMO_PASSWORD_PREFILL=false to keep the gate on
  // a shared or exposed box.
  res.json({
    passwordRequired: DEMO_PASSWORD.length > 0,
    passwordPrefill:  PREFILL_PASSWORD ? DEMO_PASSWORD : "",
    users: users.map((u: any) => ({
      email:      u.email,
      name:       u.name || u.email,
      role:       u.role || null,
      branchId:   u.branchId || null,
      department: u.department || null,
    })),
  });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
// Sign in as the chosen seeded user.
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email is required" });

  if (DEMO_PASSWORD && String(password ?? "") !== DEMO_PASSWORD) {
    return res.status(401).json({ error: "Incorrect demo password." });
  }

  const user = await storage.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: `No such user: ${email}` });

  req.session.claims = {
    sub:             user.email,
    name:            (user as any).name || user.email,
    email:           user.email,
    role:            user.role,
    clearance_level: (user as any).clearanceLevel || 0,
    branch_id:       (user as any).branchId || "",
    department:      (user as any).department || "",
    status:          (user as any).status || "active",
    id:              user.id,
    uniqueId:        (user as any).uniqueId || user.id,
  };

  // Mint a local token so the agent receives an Authorization header and the
  // PDP sees a real principal. This is what makes RTG_DISABLED=false usable
  // without an IdP.
  //
  // It is NOT a Microsoft Graph token: SharePoint OBO needs a token Entra
  // actually issued, which is why ENABLE_SHAREPOINT stays incompatible with
  // this mode regardless.
  const token = MINT_TOKEN ? mintIdToken(user) : null;
  setSessionTokens(req.session, { idToken: token, accessToken: token });

  req.session.save((err) => {
    if (err) console.error("Session save error in none/login:", err);
    console.log(`[auth:none] signed in as ${user.email} (${user.role})`);
    res.json({ ok: true, email: user.email, role: user.role });
  });
});

// ── GET /auth/logout ──────────────────────────────────────────────────────────
router.get("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {});
  res.redirect(appUrl("/"));
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/me", (req: Request, res: Response) => {
  if (!req.session.claims) return res.status(401).json({ error: "Not authenticated" });
  const c = req.session.claims;
  res.json({
    sub:            c.sub,
    email:          c.email || c.sub,
    name:           (c.name as string) || c.sub,
    role:           (c.role as string) || null,
    clearanceLevel: (c.clearance_level as number) || null,
    branchId:       (c.branch_id as string) || null,
    department:     (c.department as string) || null,
    accessGranted:  !!(c.role && String(c.role).trim()),
    enriched:       !!(c.role && String(c.role).trim()),
  });
});

export default router;
