import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Build stamp, read once and used in two places: baked into the bundle for the
// login screen, and injected into index.html as a meta tag so a plain curl can
// read it. The login-screen copy is React-rendered, so it does NOT appear in the
// server-delivered HTML — which made the documented
//     curl .../securebank/ | grep 'build '
// check silently return nothing whether the build was current or not.
const BUILD_SHA = process.env.VITE_BUILD_SHA || "dev";
const BUILD_DATE = process.env.VITE_BUILD_DATE || "";

// A transformIndexHtml plugin rather than a %VITE_%-style placeholder: this is
// deterministic and does not depend on how Vite resolves env for HTML.
const buildStampMeta = {
  name: "build-stamp-meta",
  transformIndexHtml() {
    return [{
      tag: "meta",
      attrs: { name: "build-stamp", content: `${BUILD_SHA} ${BUILD_DATE}`.trim() },
      injectTo: "head" as const,
    }];
  },
};

export default defineConfig({
  // Public path the SPA is served under. "/" for local and Docker; behind the
  // demo box's nginx it is a subpath like "/securebank/", and asset URLs must
  // carry that prefix or the browser requests them from the host root and 404s.
  // run.sh sets VITE_BASE_PATH from SECUREBANK_BASE_PATH before building.
  base: process.env.VITE_BASE_PATH || "/",

  // BUILD STAMP — rendered on the login screen so "is the new build actually
  // deployed?" is answerable by looking, not by diffing bundle hashes.
  //
  // That question cost an evening: the demo box rebuilt happily from a stale
  // checkout, and the only way to tell was to fetch the served JS and compare
  // it byte-for-byte against a local build. run.sh fills these from git; the
  // defaults keep a bare `npx vite build` working.
  //
  // `define` rather than relying on VITE_-prefixed process.env passthrough, so
  // the substitution is explicit and cannot silently no-op.
  define: {
    "import.meta.env.VITE_BUILD_SHA": JSON.stringify(BUILD_SHA),
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(BUILD_DATE),
  },

  plugins: [
    react(),
    buildStampMeta,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});