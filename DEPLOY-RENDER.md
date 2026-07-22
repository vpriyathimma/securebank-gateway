# Deploy the SecureBank gateway to Render — TWO free services

The stack is split so it fits Render's free tier (512Mi each):

```
Service A  securebank-litellm   = LiteLLM gateway + Reva plugin + sub-agent MCP
                                   (LiteLLM public on $PORT; MCP internal :8090)
Service B  securebank-app        = FinBot (public on $PORT)
                                   └── talks to Service A over its public URL
```

Only dependency is **B → A**. Service A needs no reference to B (its sub-agent
MCP calls its own LiteLLM over localhost).

---

## Steps

### 1. Push the repo (already done once — re-push after changes)
```
cd ~/Downloads/securebank-gateway
git add . && git commit -m "two-service Render deploy"
git push
```

### 2. Create BOTH services from the blueprint
- Render → **New → Blueprint** → pick `vpriyathimma/securebank-gateway`.
- The blueprint (`render.yaml`) now defines **two** services: `securebank-litellm`
  and `securebank-app`. Render shows both. Give the blueprint a name, **Apply**.

### 3. Set the secrets
**On `securebank-litellm` (Service A):**
- `AZURE_API_KEY` — Azure Foundry key (from your `.env`)
- `REVA_AUTH_TOKEN` — Reva PDP token (from your `.env`; expires — refresh before demo)
- `AZURE_CLIENT_SECRET` — SharePoint agent's Azure secret
- `REVA_FOUNDRY_API_KEY` — SharePoint agent's Foundry key

**On `securebank-app` (Service B):** nothing yet — see step 4.

### 4. Wire B → A (the one manual link)
1. Wait for **Service A** (`securebank-litellm`) to go **live**, copy its URL
   (e.g. `https://securebank-litellm.onrender.com`).
2. On **Service B** (`securebank-app`) → Environment → set:
   ```
   LITELLM_BASE_URL = https://securebank-litellm.onrender.com/v1
   ```
   (Service A's URL + `/v1`.)
3. Service B redeploys automatically.

### 5. Verify
```
# Service A (gateway) alive:
curl https://securebank-litellm.onrender.com/health/liveliness

# Service B (app) — a real query:
curl -X POST https://securebank-app.onrender.com/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"what is a credit score?","user_id":"mike.wilson@revapreview.onmicrosoft.com","user_name":"Mike Wilson","role":"manager"}'
```
Then check the hops in the Reva Decision Logs (store `9a8c5759…`).

---

## Notes / gotchas
- **Cold starts:** free services spin down after ~15 min idle. A request may
  wake **both** services (B then A) — the first one after idle can take a minute
  or two. **Warm them up** (hit both health URLs) right before demoing.
- **REVA_AUTH_TOKEN** (on Service A) expires — the top demo risk. Refresh it in
  Service A's Environment before showing.
- **Order matters:** Service A must be live before Service B can serve real
  requests (B needs A's URL in step 4).
- **The UI:** point your local UI at Service B — open `ui/index.html` after
  editing the fetch URL to `https://securebank-app.onrender.com/chat`, or keep
  driving it locally.
- **Logs:** each service has its own Logs tab in Render. Service A's log shows
  the `[reva_hook] … decision=…` lines; Service B's shows FinBot.
