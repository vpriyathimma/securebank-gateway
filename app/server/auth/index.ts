/**
 * Auth provider selection.
 *
 * AUTH_PROVIDER picks which router handles /auth/*. All three expose the same
 * surface (`/login`, `/logout`, `/me`), so nothing downstream needs to know
 * which one is active — it reads `req.session.claims` either way.
 *
 *   none   (default) — pick a seeded user, no IdP, no cloud account needed
 *   entra            — Microsoft Entra ID (Azure AD)
 *   okta             — Okta OIDC
 */
import type { Router } from "express";
import entraRouter from "./entra.js";
import oktaRouter from "./okta.js";
import noneRouter from "./none.js";

export type AuthProvider = "none" | "entra" | "okta";

const RAW = (process.env.AUTH_PROVIDER || "none").trim().toLowerCase();
export const AUTH_PROVIDER: AuthProvider =
  RAW === "entra" || RAW === "okta" ? RAW : "none";

/**
 * Which JWT claim carries the user principal.
 *
 * This MUST match the `principal_claim` the agent service passes to
 * @reva_ai_authorise, or the PDP evaluates a different principal than the one
 * that signed in and policies silently stop matching — a failure that looks
 * like "the policy is broken" rather than a config error. run.sh derives
 * PRINCIPAL_CLAIM from AUTH_PROVIDER for both services so they cannot drift.
 */
export const PRINCIPAL_CLAIM =
  process.env.PRINCIPAL_CLAIM || (AUTH_PROVIDER === "entra" ? "upn" : "email");

const ROUTERS: Record<AuthProvider, Router> = {
  none:  noneRouter,
  entra: entraRouter,
  okta:  oktaRouter,
};

const LABELS: Record<AuthProvider, string> = {
  none:  "Choose a demo user",
  entra: "Sign in with Microsoft",
  okta:  "Sign in with Okta SSO",
};

export const authRouter: Router = ROUTERS[AUTH_PROVIDER];

/**
 * Store the IdP tokens on the session.
 *
 * Goes through one cast because `express-session` ships its own types AND
 * `@types/express-session` is installed; `req.session` resolves to the copy our
 * `declare module` augmentation in server/types.ts does not reach, so assigning
 * `idToken` directly fails to typecheck even though it is declared. Keeping the
 * cast in a single helper means the providers stay clean and there is one place
 * to fix if the duplicate typings are ever resolved.
 *
 * Both values are nullable: AUTH_PROVIDER=none has no IdP and therefore no
 * tokens at all.
 */
export function setSessionTokens(
  session: any,
  tokens: { idToken?: string | null; accessToken?: string | null },
): void {
  session.idToken = tokens.idToken ?? null;
  session.accessToken = tokens.accessToken ?? null;
}

/** Shape the SPA needs to render the right login screen. */
export function authInfo() {
  return {
    provider:       AUTH_PROVIDER,
    buttonLabel:    LABELS[AUTH_PROVIDER],
    principalClaim: PRINCIPAL_CLAIM,
  };
}

/**
 * Fail fast when the selected provider is missing its config.
 *
 * The provider modules read their env vars with non-null assertions, so an
 * unset variable becomes the literal string "undefined" inside the authorize
 * URL and surfaces much later as an opaque IdP error. Catch it at boot instead.
 */
export function validateAuthConfig(): void {
  const required: Record<AuthProvider, string[]> = {
    none:  [],
    entra: ["AZURE_AD_TENANT_ID", "AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET", "AZURE_AD_REDIRECT_URI"],
    okta:  ["OKTA_CLIENT_ID", "OKTA_CLIENT_SECRET", "OKTA_CALLBACK_URL"],
  };

  const missing = required[AUTH_PROVIDER].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `FATAL: AUTH_PROVIDER=${AUTH_PROVIDER} but these are not set:\n` +
      missing.map((k) => `  - ${k}`).join("\n") +
      `\n\nSet them in .config, or use AUTH_PROVIDER=none to run without an IdP.`
    );
    process.exit(1);
  }

  // Okta accepts either an explicit issuer or a domain to derive one from.
  if (AUTH_PROVIDER === "okta" && !process.env.OKTA_ISSUER && !process.env.OKTA_DOMAIN) {
    console.error("FATAL: AUTH_PROVIDER=okta requires OKTA_ISSUER (or OKTA_DOMAIN).");
    process.exit(1);
  }

  if (AUTH_PROVIDER === "none") {
    console.warn(
      "AUTH_PROVIDER=none — anyone who can reach this app can sign in as any " +
      "seeded user. Intended for local demos only."
    );

    // AUTH_PROVIDER=none and live PDP enforcement do not work together.
    //
    // There is no IdP, so there is no id_token/access_token, so the app sends no
    // Authorization header to the agent. The Reva SDK derives the principal by
    // decoding that bearer token (_jwt_subject_without_verification) — with no
    // token it derives an EMPTY principal, and every policy keyed on a User
    // principal stops matching. The symptom is denials that look like broken
    // policies rather than missing authentication, which is an expensive thing
    // to debug. Say so at boot instead.
    const rtgDisabled = (process.env.RTG_DISABLED || "true").trim().toLowerCase();
    if (!["1", "true", "yes", "on"].includes(rtgDisabled)) {
      console.warn(
        "WARNING: AUTH_PROVIDER=none with RTG_DISABLED=" + rtgDisabled + ".\n" +
        "  No IdP means no bearer token, so the PDP receives an EMPTY principal\n" +
        "  and policies scoped to a User will not match. Use AUTH_PROVIDER=entra\n" +
        "  or okta for a governed demo, or RTG_DISABLED=true for an ungoverned one."
      );
    }
  }
  console.log(`[auth] provider=${AUTH_PROVIDER} principalClaim=${PRINCIPAL_CLAIM}`);
}
