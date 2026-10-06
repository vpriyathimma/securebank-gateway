/**
 * Public base path, server side.
 *
 * THE SERVER CANNOT INFER THIS FROM A REQUEST. nginx fronts the app with the
 * stripping form (`proxy_pass http://127.0.0.1:8400/;`), so a browser request
 * for /securebank/auth/logout arrives here as /auth/logout. Nothing in the
 * request carries "/securebank" — not the path, not Host, not X-Forwarded-*.
 * The only source of truth is SECUREBANK_BASE_PATH, which .config already sets
 * and run.sh already uses for the frontend build.
 *
 * Without it, `res.redirect("/")` sends the browser to the ORIGIN root —
 * https://agent.demo.reva.ai/ — which on the demo box is a different
 * application. Signing out of SecureBank landed on the PM-demo home page.
 *
 * The client-side equivalent is app/client/src/lib/base-path.ts, which reads
 * Vite's build-time BASE_URL. Two mechanisms because the two halves learn their
 * public path in genuinely different ways: the browser is told at build time,
 * the server has to be told by configuration.
 *
 * Empty locally and in Docker, where the app really is at the root.
 */

/** "" at the root, "/securebank" behind the demo box's nginx. No trailing slash. */
export const BASE_PATH: string = (() => {
  const raw = (process.env.SECUREBANK_BASE_PATH || process.env.BASE_PATH || "").trim();
  if (!raw || raw === "/") return "";
  return `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
})();

/**
 * Prefix an app-absolute path for use in a redirect or a link.
 *
 * Query strings and fragments survive, because several call sites redirect to
 * "/?error=auth_failed" and losing the query would silently drop the reason the
 * user is back at the login screen.
 */
export function appUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${p}`;
}
