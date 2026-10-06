# Combined image: the Python LiteLLM gateway (Reva's authorization enforcement
# point) and the real SecureBank Node/React app, in one container, one Render
# service. The Node app is the only thing Render's $PORT reaches; everything
# else (sub-agent MCP server, LiteLLM, the FastAPI chat backend) runs on
# internal-only ports and is invisible from outside the container.
#
# Why one image instead of two services talking over the public internet:
# fewer Render services to pay for/manage, and the internal hops never leave
# localhost, so there is no cross-service cold-start tax between them.
FROM python:3.13-slim

# Node 20, to build and run the real app alongside the Python gateway.
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# ── Python gateway deps ──────────────────────────────────────────────────────
COPY requirements.local.txt .
RUN pip install --no-cache-dir -r requirements.local.txt

# ── Gateway source (everything at the repo root) ─────────────────────────────
COPY *.py litellm_config.yaml ./
COPY tools ./tools
# server.py mounts StaticFiles(directory="ui") unconditionally and Starlette
# checks the directory exists at startup — copied even though the Node app
# below is what actually serves the UI here, so the gateway process doesn't
# crash on boot for want of an empty folder.
COPY ui ./ui

# ── The real app: deps first (cache layer), then source, then build its SPA ──
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --no-audit --no-fund
COPY app ./app
RUN cd app && npx vite build

ENV NODE_ENV=production
EXPOSE 8400
COPY start-combined.sh .
RUN chmod +x start-combined.sh
CMD ["./start-combined.sh"]
