# SecureBank policy store — manual upload guide

Everything to create the SecureBank store in the Reva console yourself.

**Bundle to upload:** `~/Downloads/securebank-authorisation-bundle.zip`
(contains `cedarschema.json`, `entities.json`, `policies/`)

---

## The topology you're publishing

```
                 invokeModel
   finbot-agent  ───────────────►  gpt-5-mini          ✅ PERMIT  (standard model)
                                     (standard)

                 invokeModel
   credit-agent  ───────────────►  gpt-5-mini          ✅ PERMIT  (standard model)
                                     (standard)

                 invokeModel
   (any agent)   ───────────────►  gpt-5.1-sharepoint  ⛔ FORBID  (gated / premium)
                                     (premium)

   on-behalf-of:  employee@securebank
```

### Entities (5)
| Type  | Id                    | Notes                          |
|-------|-----------------------|--------------------------------|
| Agent | `finbot-agent`        | FinBot primary orchestrator    |
| Agent | `credit-agent`        | Credit sub-agent               |
| Model | `gpt-5-mini`          | standard tier — open           |
| Model | `gpt-5.1-sharepoint`  | premium tier — gated           |
| User  | `employee@securebank` | the human the agents act for   |

### Policies (3)
| Policy id                          | Effect | Rule                                                  |
|------------------------------------|--------|-------------------------------------------------------|
| `permit-finbot-invoke-gpt5mini`    | permit | finbot-agent → invokeModel → gpt-5-mini               |
| `permit-credit-invoke-gpt5mini`    | permit | credit-agent → invokeModel → gpt-5-mini               |
| `forbid-gated-sharepoint-model`    | forbid | any principal → invokeModel → gpt-5.1-sharepoint      |

Cedar is **deny-by-default**, so anything not permitted is denied. The explicit
forbid on the gated model just makes the deny name a policy in the Decision Log.

---

## Steps in the console

1. **Create a new policy store** — name it `securebank-gateway`
   (application: `SecureBank`, environment: `preview`).
   > One store per gateway — don't reuse the litellm-demo store (`c5a1339b…`).
2. **Upload / import the bundle zip** (`securebank-authorisation-bundle.zip`) as
   the workload — this loads the schema, the 5 entities, and the 3 policies.
   (This is the same "upload workload zip" flow you've used before.)
3. **Publish** the store. Publish is mandatory — a draft won't serve evals.
4. **Copy the new policy store id** and send it to me.

Then I:
- set `REVA_POLICYSTORE_ID=<new id>` in the app's `.env`
- flip `REVA_HOOK_MODE=enforce`
- run the live **allow** (`gpt-5-mini`) and **deny** (`gpt-5.1-sharepoint`) demo.

---

## If the console needs the pieces manually instead of a zip

`entities.json` and the three `.cedar` files under `authorisation/policies/` are
plain text — you can paste them in directly. They're all in
`~/Downloads/securebank-gateway/authorisation/`.
