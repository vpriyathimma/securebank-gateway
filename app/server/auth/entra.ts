import express, { Request, Response } from "express";
import { findLocalUser } from './identity.js';

import { storage } from '../storage.js';
import { setSessionTokens } from './index.js';
import { appUrl } from '../base-path.js';

const router = express.Router();

// ── Azure AD (Entra ID) config from environment ─────────────────────────────
const TENANT_ID     = process.env.AZURE_AD_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_AD_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET!;
const REDIRECT_URI  = process.env.AZURE_AD_REDIRECT_URI!;

// Authority host is overridable. The public-cloud default is right for most
// tenants, but Azure Government (login.microsoftonline.us) and Azure China
// (login.chinacloudapi.cn) use different hosts — and Okta already has the
// equivalent knob in OKTA_ISSUER, so this was a parity gap. It also makes the
// flow testable against a local OIDC stub.
const AUTHORITY     = (process.env.AZURE_AD_AUTHORITY || "").trim().replace(/\/+$/, "")
                      || `https://login.microsoftonline.com/${TENANT_ID}`;
const AUTHORIZE_URL = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_URL     = `${AUTHORITY}/oauth2/v2.0/token`;
const LOGOUT_URL    = `${AUTHORITY}/oauth2/v2.0/logout`;

// Graph delegated scopes — so the forwarded user token can read SharePoint
// per-user (Sites.Read.All / Files.Read.All). SecureBank-SSO already has these
// delegated permissions consented.
const SCOPES = "openid profile email https://graph.microsoft.com/Sites.Read.All https://graph.microsoft.com/Files.Read.All offline_access";

// ── GET /auth/login ───────────────────────────────────────────────────────────
router.get("/login", (req: Request, res: Response) => {
  const state = Math.random().toString(36).slice(2);
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    response_type: "code",
    scope:         SCOPES,
    redirect_uri:  REDIRECT_URI,
    response_mode: "query",
    prompt:        "select_account",
    state,
  });

  req.session.save((err) => {
    if (err) console.error("Session save error in /auth/login:", err);
    res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  });
});

// ── GET /auth/callback ────────────────────────────────────────────────────────
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      console.error("Azure AD callback error:", error, error_description);
      return res.redirect(appUrl(`/?error=${encodeURIComponent(String(error_description || error))}`));
    }

    console.log("Callback state check:", { received: state, session: req.session.oauthState });

    if (!state || state !== req.session.oauthState) {
      console.warn("OAuth state mismatch — redirecting to login");
      return res.redirect(appUrl("/auth/login"));
    }

    // Exchange authorization code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  REDIRECT_URI,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         SCOPES,
      }),
    });

    const tokens = await tokenRes.json() as any;
    console.log("Token exchange response keys:", Object.keys(tokens));

    if (!tokens.id_token && !tokens.access_token) {
      throw new Error("No tokens in Azure AD response: " + JSON.stringify(tokens));
    }

    // ── Extract user identity from Azure AD ──────────────────────────────────
    let email = "";
    let name  = "";

    if (tokens.id_token) {
      try {
        const parts   = tokens.id_token.split(".");
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        // Azure AD uses 'preferred_username' for the UPN (email)
        email = payload.preferred_username || payload.email || payload.upn || payload.sub || "";
        name  = payload.name || `${payload.given_name || ""} ${payload.family_name || ""}`.trim() || email;
        console.log("ID token decoded — email:", email, "name:", name);
      } catch (decodeErr) {
        console.error("Failed to decode id_token:", decodeErr);
      }
    }

    // Fallback: use Microsoft Graph /me endpoint if id_token didn't yield an email
    if (!email && tokens.access_token) {
      try {
        const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const meData = await meRes.json() as any;
        email = meData.userPrincipalName || meData.mail || "";
        name  = meData.displayName || email;
        console.log("Graph /me fallback — email:", email);
      } catch (meErr) {
        console.error("Graph /me fetch failed:", meErr);
      }
    }

    if (!email) {
      throw new Error("Could not determine user email from Azure AD tokens");
    }

    console.log("Azure AD user email:", email);

    // ── Look up user in local SecureBank database ────────────────────────────
    // Shared with the other providers so identity mapping is provider-agnostic.
    const localUser = await findLocalUser(storage, email);

    if (!localUser) {
      console.error("User not found in local DB:", email);
      return res.redirect(appUrl(`/?error=${encodeURIComponent("User not found in SecureBank: " + email)}`));
    }

    console.log("Local user found:", localUser.email, "role:", localUser.role);

    // ── Populate session claims (Azure AD identity + local attributes) ───────
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
      azureEmail:      email,
    };

    // Store tokens — access_token is needed for SharePoint OBO via Azure Foundry
    setSessionTokens(req.session, {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
    });
    delete req.session.oauthState;

    console.log("Session stored — idToken present:", !!tokens.id_token, "accessToken present:", !!tokens.access_token);

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
  req.session.destroy(() => {});

  // No hardcoded fallback: a wrong post-logout URI silently bounces users to a
  // deployment that is not this one. PUBLIC_BASE_URL is required in .config.
  const appUrl = process.env.PUBLIC_BASE_URL || process.env.BANK_APP_URL || "/";
  const params = new URLSearchParams({
    post_logout_redirect_uri: appUrl,
  });
  res.redirect(`${LOGOUT_URL}?${params.toString()}`);
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
