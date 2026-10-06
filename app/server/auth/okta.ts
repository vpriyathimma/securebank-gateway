import express, { Request, Response } from "express";
import { storage } from '../storage.js';
import { setSessionTokens } from './index.js';
import { appUrl } from '../base-path.js';
import { findLocalUser } from './identity.js';
 
const router = express.Router();
 
const OKTA_DOMAIN   = process.env.OKTA_DOMAIN!;
const CLIENT_ID     = process.env.OKTA_CLIENT_ID!;
const CLIENT_SECRET = process.env.OKTA_CLIENT_SECRET!;
const CALLBACK_URL  = process.env.OKTA_CALLBACK_URL!;
// Use OKTA_ISSUER env var (set to https://demo-ai-auth-raah.okta.com/oauth2/default)
// Falls back to default authorization server if not set
const ISSUER        = process.env.OKTA_ISSUER || `https://${OKTA_DOMAIN}/oauth2/default`;
 
// ── GET /auth/login ───────────────────────────────────────────────────────────
router.get("/login", (req: Request, res: Response) => {
  const state = Math.random().toString(36).slice(2);
  req.session.oauthState = state;
 
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: "code",
    scope:         "openid profile email",
    redirect_uri:  CALLBACK_URL,
    state,
  });
 
  req.session.save((err) => {
    if (err) console.error("Session save error in /auth/login:", err);
    res.redirect(`${ISSUER}/v1/authorize?${params.toString()}`);
  });
});
 
// ── GET /auth/callback ────────────────────────────────────────────────────────
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query as Record<string, string>;
 
    if (error) {
      console.error("Okta callback error:", error, error_description);
      return res.redirect(appUrl(`/?error=${encodeURIComponent(String(error_description || error))}`));
    }
 
    console.log("Callback state check:", { received: state, session: req.session.oauthState });
 
    if (!state || state !== req.session.oauthState) {
      console.warn("OAuth state mismatch — redirecting to login");
      return res.redirect(appUrl("/auth/login"));
    }
 
    // Exchange authorization code for tokens
    const tokenRes = await fetch(`${ISSUER}/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  CALLBACK_URL,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });
 
    const tokens = await tokenRes.json() as any;
    console.log("Token exchange response keys:", Object.keys(tokens));
 
    if (!tokens.id_token && !tokens.access_token) {
      throw new Error("No tokens in Okta response: " + JSON.stringify(tokens));
    }
 
    // ── Extract user identity from Okta ──────────────────────────────────────
    // Decode id_token to get email/name — trusted because it came directly from
    // Okta over HTTPS in the code exchange (not from user input).
    let email = "";
    let name  = "";
 
    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        email = payload.email || payload.preferred_username || payload.sub || "";
        name  = payload.name || `${payload.given_name || ""} ${payload.family_name || ""}`.trim() || email;
        console.log("ID token decoded — email:", email, "name:", name);
      } catch (decodeErr) {
        console.error("Failed to decode id_token:", decodeErr);
      }
    }
 
    // Fallback: use userinfo endpoint if id_token didn't yield an email
    if (!email && tokens.access_token) {
      try {
        const userinfoRes = await fetch(`${ISSUER}/v1/userinfo`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const userinfo = await userinfoRes.json() as any;
        email = userinfo.email || userinfo.preferred_username || userinfo.sub || "";
        name  = userinfo.name || email;
        console.log("Userinfo fallback — email:", email);
      } catch (uiErr) {
        console.error("Userinfo fetch failed:", uiErr);
      }
    }
 
    if (!email) {
      throw new Error("Could not determine user email from Okta tokens");
    }
 
    // ── Look up user in local SecureBank database ────────────────────────────
    // Role, clearance_level, branch_id etc. come from local DB since
    // governance/TES inline hook is not yet active.
    const localUser = await findLocalUser(storage, email);
 
    if (!localUser) {
      console.error("User not found in local DB:", email);
      return res.redirect(appUrl(`/?error=${encodeURIComponent("User not found in SecureBank: " + email)}`));
    }
 
    console.log("Local user found:", localUser.email, "role:", localUser.role);
 
    // ── Populate session claims (Okta identity + local attributes) ───────────
    req.session.claims = {
      sub:             localUser.email,
      name:            (localUser as any).name || name,
      email:           localUser.email,
      role:            localUser.role,
      clearance_level: localUser.clearanceLevel || 0,
      branch_id:       localUser.branchId || "",
      department:      localUser.department || "",
      status:          localUser.status || "active",
      id:              localUser.id,
      uniqueId:        (localUser as any).uniqueId || localUser.id,
    };
 
    // Store tokens — Reva SDK (Step 3) will need the id_token (IDP token)
    setSessionTokens(req.session, { idToken: tokens.id_token, accessToken: tokens.access_token });
    req.session.accessToken = tokens.access_token || null;
    delete req.session.oauthState;
 
    req.session.save((err) => {
      if (err) console.error("Session save after callback error:", err);
      res.redirect(appUrl("/"));
    });
 
  } catch (err) {
    console.error("Auth callback unhandled error:", err);
    res.redirect(appUrl("/?error=auth_failed"));
  }
});
 
// ── GET /auth/logout ──────────────────────────────────────────────────────────
router.get("/logout", (req: Request, res: Response) => {
  const idToken = (req.session as any).idToken;
  req.session.destroy(() => {});
 
  const appUrl = process.env.PUBLIC_BASE_URL || process.env.BANK_APP_URL || "/";
  const params = new URLSearchParams({
    id_token_hint:            idToken || "",
    post_logout_redirect_uri: appUrl,
  });
  res.redirect(`${ISSUER}/v1/logout?${params.toString()}`);
});
 
// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get("/me", (req: Request, res: Response) => {
  if (!req.session.claims) {
    return res.status(401).json({ error: "Not authenticated" });
  }
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
