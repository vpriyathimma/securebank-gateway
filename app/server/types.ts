import "express-session";

declare module "express-session" {
  interface SessionData {
    // OIDC flow (entra / okta)
    oauthState?: string;
    // Tokens from the IdP. AUTH_PROVIDER=none has neither, so both are nullable
    // as well as optional — anything downstream that needs a real bearer token
    // (SharePoint OBO in particular) must handle their absence.
    accessToken?: string | null;
    idToken?: string | null;
    // Resolved user claims (set after callback / picker login)
    claims?: Record<string, any>;
    // Legacy — kept for backward compat during transition
    user?: any;
  }
}
