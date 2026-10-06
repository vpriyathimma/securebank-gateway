// Canonicalizes any incoming identity to the bank's primary email domain.
// Entra issues  user@<tenant>.onmicrosoft.com ; SecureBank keys users on user@reva.ai.
// Generic domain swap (not a per-user map), env-driven so it survives tenant changes.
const CANONICAL_DOMAIN = process.env.CANONICAL_EMAIL_DOMAIN || "reva.ai";

export function canonicalizeEmail(email?: string): string {
  if (!email || !email.includes("@")) return email || "";
  const [local, domain] = email.split("@");
  if (domain.toLowerCase().endsWith(".onmicrosoft.com")) {
    return `${local}@${CANONICAL_DOMAIN}`;
  }
  return email;
}
// Match identities that differ only by CASE or DOTS in the local part.
// e.g. Entra "SaiSrungaram@reva.ai" ↔ DB "sai.srungaram@reva.ai" both become "saisrungaram@reva.ai"
export function normalizeForMatch(email?: string): string {
  if (!email || !email.includes("@")) return (email || "").toLowerCase();
  const [local, domain] = email.split("@");
  return `${local.replace(/\./g, "").toLowerCase()}@${domain.toLowerCase()}`;
}


/**
 * Resolve an IdP-issued email to a seeded SecureBank user.
 *
 * Shared by every provider so identity mapping does not depend on which one is
 * active. It previously lived only in the Entra callback, so the exact same
 * address that signed in fine under `entra` was rejected under `okta` with
 * "User not found in SecureBank" — a difference with no reason behind it beyond
 * which branch the helper happened to be written on.
 *
 * Three attempts, widening:
 *   1. the address exactly as issued
 *   2. canonicalised onto CANONICAL_EMAIL_DOMAIN (…onmicrosoft.com -> reva.ai)
 *   3. ignoring case and dots in the local part (SaiSrungaram ≈ sai.srungaram)
 */
export async function findLocalUser(
  storage: { getUserByEmail(e: string): Promise<any>; getUsers(): Promise<any[]> },
  email: string,
): Promise<any | undefined> {
  let user = await storage.getUserByEmail(email);
  if (user) return user;

  const canonical = canonicalizeEmail(email);
  if (canonical && canonical !== email) {
    user = await storage.getUserByEmail(canonical);
    if (user) {
      console.log(`[auth] matched by canonical domain: ${email} -> ${user.email}`);
      return user;
    }
  }

  const target = normalizeForMatch(canonical || email);
  const all = await storage.getUsers();
  user = all.find((u: any) => normalizeForMatch(u.email) === target);
  if (user) console.log(`[auth] matched by normalized email: ${email} -> ${user.email}`);
  return user;
}
