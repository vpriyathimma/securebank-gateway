/**
 * Public-path helper.
 *
 * THE APP DOES NOT KNOW ITS OWN PUBLIC PATH. nginx fronts it with the stripping
 * form (`proxy_pass http://127.0.0.1:8400/;`), so a request for
 * /securebank/auth/login arrives at the server as /auth/login. Nothing in the
 * request says "/securebank".
 *
 * Vite is told at BUILD time (`base: process.env.VITE_BASE_PATH || "/"`,
 * vite.config.ts:10, fed from SECUREBANK_BASE_PATH), which is why assets resolve
 * correctly under a subpath and the page renders. But hand-written URLs did not
 * use it: `fetch("/auth/login")` is ROOT-relative, so under
 * https://agent.demo.reva.ai/securebank/ the browser resolved it to
 * https://agent.demo.reva.ai/auth/login — which nginx routes to `location /`,
 * a different application entirely.
 *
 * The symptom was not an error. /api/auth/me returned the other app's response,
 * .json() threw, the catch set provider="unknown", and the login screen showed a
 * generic button instead of the user picker. Clicking it navigated away from
 * SecureBank and looked like "the login just comes back".
 *
 * Invisible locally, because SECUREBANK_BASE_PATH is empty there and the app IS
 * at the root — so root-relative happens to be correct.
 *
 * BASE_URL is "/securebank/" on the demo box and "/" locally, so one build works
 * in both places.
 *
 * USE THIS FOR EVERY SERVER PATH IN CLIENT CODE. A bare "/..." string is the bug.
 */
export function url(path: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Navigate, honouring the public base path. */
export function goTo(path: string): void {
  window.location.href = url(path);
}
