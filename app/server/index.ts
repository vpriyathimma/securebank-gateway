import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import { setupRoutes } from "./routes.js";
import { validateAuthConfig } from "./auth/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Fail fast on misconfiguration ─────────────────────────────────────────────
// Better a clear message at boot than an opaque IdP error three redirects later.
validateAuthConfig();

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error(
    "FATAL: SESSION_SECRET is not set.\n" +
    "  It signs session cookies — without it sessions are forgeable by anyone\n" +
    "  who can read this source. Set it in .config (run.sh generates one for you)."
  );
  process.exit(1);
}

const app = express();

// Number of reverse proxies in front of us. 1 behind nginx/Render, 0 when the
// app is exposed directly (the default for local + docker runs). Getting this
// wrong breaks secure-cookie detection and client IP logging.
const TRUST_PROXY = parseInt(process.env.TRUST_PROXY ?? "0", 10);
if (TRUST_PROXY > 0) app.set("trust proxy", TRUST_PROXY);

// ── Slack raw body — MUST be mounted before express.json() ────────────────────
// Slack signs the exact bytes it sent. Once express.json() has parsed a request
// the original bytes are gone, and re-serialising the parsed object reorders
// keys and re-escapes strings, so every signature check fails — with a symptom
// that looks exactly like a wrong signing secret. Mounting order IS the fix.
app.use("/api/slack/interactions", express.raw({ type: "*/*", limit: "1mb" }));

// ── /health ─────────────────────────────────────────────────────────────────
// Before the session middleware and before any auth, so it answers even when the
// app is misconfigured in ways that break login. Its whole job is to prove this
// process is listening and serving — which a PID cannot.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "securebank-app" });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ───────────────────────────────────────────────────────────────────
// Cookie flags are explicit env vars, NOT derived from NODE_ENV. Deriving them
// meant `NODE_ENV=production` over plain HTTP (a normal docker/local run) set
// secure+sameSite=none, the browser silently dropped the cookie, and login
// looped forever with no error anywhere.
//   COOKIE_SECURE=true     only when actually served over HTTPS
//   COOKIE_SAMESITE=none   only for cross-site flows, and requires secure=true
//
// MemoryStore is fine for a single-process demo; state resets on restart and
// does not survive multiple replicas.
const COOKIE_SECURE = (process.env.COOKIE_SECURE || "false").toLowerCase() === "true";
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || "lax") as "lax" | "strict" | "none";
if (COOKIE_SAMESITE === "none" && !COOKIE_SECURE) {
  console.warn(
    "WARN: COOKIE_SAMESITE=none requires COOKIE_SECURE=true — browsers reject the " +
    "combination and login will fail. Set COOKIE_SECURE=true or use sameSite=lax."
  );
}

app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
  },
}));

// ── Static frontend ───────────────────────────────────────────────────────────
// Resolved from THIS file, not process.cwd(), so the server works regardless of
// the directory it was launched from (containers set WORKDIR differently).
// vite.config.ts outputs to <app>/dist/public; this file lives at <app>/server.
const distPath = path.resolve(__dirname, "..", "dist", "public");
app.use(express.static(distPath));

// ── API + Auth routes ─────────────────────────────────────────────────────────
setupRoutes(app);

// SPA fallback — React router handles all non-API routes.
// Registered after setupRoutes, so an unmatched /api/* path lands here and
// returns index.html with a 200 rather than a 404. Guard it so API clients get
// a real error instead of a page of HTML.
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }
  const indexFile = path.join(distPath, "index.html");
  res.sendFile(indexFile, (err) => {
    if (err) {
      console.error(`sendFile failed for ${indexFile}:`, err.message);
      res.status(500).send(
        "Frontend build not found. Run `npx vite build` in the app/ directory " +
        "(or `./run.sh install` from the securebank/ directory)."
      );
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "8400");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureBank running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  console.log(`Static files from: ${distPath}`);
});

export default app;
