# Deploy the SecureBank gateway to Render

One Render web service runs the whole stack:

```
Render web service (securebank-gateway)
  ├─ sub-agent MCP server   :8090   (internal)
  ├─ LiteLLM + Reva hook     :4010   (internal)
  └─ FinBot (server:app)     :$PORT  (public)   ← the URL you share
```

Only FinBot is exposed. LiteLLM and the sub-agent MCP server talk to it over
localhost inside the same container. Config lives in `render.yaml` +
`start.sh` (both already in this folder).

---

## Steps

### 1. Put this folder in a GitHub repo
Render deploys from a Git repo. From `~/Downloads/securebank-gateway`:
```
git init
git add .
git commit -m "SecureBank gateway (no-SDK, Reva at the gateway)"
gh repo create securebank-gateway --private --source=. --push
```
(`.gitignore` already keeps `.env`, `.venv`, and logs out — no secrets get pushed.)

### 2. Create the service on Render
- Render dashboard → **New → Blueprint** → pick the `securebank-gateway` repo.
- Render reads `render.yaml` and proposes the service. Click **Apply**.

### 3. Set the two secrets (Render → the service → Environment)
These are `sync:false` in render.yaml, so Render prompts for them:
- `AZURE_API_KEY` — your Azure Foundry key (same one in your local `.env`)
- `REVA_AUTH_TOKEN` — the Reva PDP token
  - **Preview tokens expire.** Paste a fresh one right before the demo, or
    every call will fail-open (allow) or error.

Everything else (PDP URL, store id `9a8c5759…`, model names, ports) is baked
into `render.yaml` already.

### 4. Deploy + verify
- Render builds (`pip install -r requirements.local.txt`) and runs `./start.sh`.
- First boot is slow (installs + three processes + free-tier cold start).
- When live, hit:
  ```
  curl https://<your-service>.onrender.com/health
  curl -X POST https://<your-service>.onrender.com/chat \
    -H "Content-Type: application/json" \
    -d '{"message":"what is a credit score?","user_id":"employee@securebank","user_name":"Employee","role":"employee"}'
  ```
- Confirm the hops in the Reva Decision Logs for store `9a8c5759…`.

---

## Notes / gotchas
- **Free tier cold-starts (~50s)** after inactivity, and boots all three
  processes — the first request after idle is slow. Upgrade the plan if the
  demo needs snappy first response.
- **REVA_AUTH_TOKEN expiry** is the thing most likely to break a live demo.
  Refresh it in Render → Environment right before showing.
- **REVA_HOOK_MODE=enforce** is set — denies actually block. Switch to `log`
  in the dashboard if you want evaluate-only (never blocks) temporarily.
- Logs inside the container: `/tmp/agent_mcp.log`, `/tmp/litellm.log`, plus
  FinBot on stdout (Render’s log tab).
- To revert any hop to un-authorized for debugging: `MCP_VIA_GATEWAY=false`
  (tools) or `AGENT_VIA_GATEWAY=false` (delegation) in the environment.
