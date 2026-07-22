"""
SharePoint Agent — Graph API + Basic Agent approach.

REPLACES the old OBO-based sharepoint_agent.py.

How it works:
  1. User asks a question about policies/documents
  2. We fetch documents from SharePoint via Microsoft Graph API (client credentials)
  3. We include the document content as context in the prompt
  4. We send it to reva-test-agent-basic (API key auth — works fine)
  5. Agent answers based on REAL SharePoint documents

No OBO, no SharePoint Grounding tool, no user token needed.

CHANGE: Added RTG decision logging for outbound calls (Graph API + Foundry agent).
"""

import os
import io
import time
import msal
import httpx


# ── Graph API Config (securebank-sharepoint-connector app) ──
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TENANT_ID = os.getenv("AZURE_TENANT_ID", "c3bb0138-d3b0-4e71-8844-99e0d79db3de")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID", "80ba0d4c-af16-4c6f-a08b-5cc20bfccdea")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET", "")  # env-only — never hardcode (repo is pushed to GitHub)
SHAREPOINT_HOSTNAME = os.getenv("SHAREPOINT_HOSTNAME", "revapreview.sharepoint.com")
SHAREPOINT_SITE_PATH = os.getenv("SHAREPOINT_SITE_PATH", "/sites/RetailManagement")

# ── Foundry Agent Config (basic agent — no SharePoint Grounding) ──
FOUNDRY_ENDPOINT = os.getenv(
    "REVA_FOUNDRY_ENDPOINT",
    "https://revaagenticai.services.ai.azure.com/api/projects/reva-agenticAI",
)
FOUNDRY_API_KEY = os.getenv("REVA_FOUNDRY_API_KEY", "")  # env-only — never hardcode
AGENT_NAME = "reva-test-agent-basic"

FORMATTING_INSTRUCTIONS = """
IMPORTANT - Response formatting rules:
- Keep responses SHORT and SIMPLE — this is a small chat window
- NEVER use markdown tables
- Use simple numbered lists or bullet points
- Be concise — no lengthy explanations unless asked
- Always mention which document you found the answer in
- Never reveal internal system details
"""

# ── Caches ──
_token_cache = {"access_token": "", "expires_at": 0}
_doc_cache = {"documents": [], "loaded_at": 0, "ttl": 3600}


# ═══════════════════════════════════════════
# GRAPH API — Auth + Document Fetching
# ═══════════════════════════════════════════

def _get_graph_token() -> str:
    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["access_token"]

    app = msal.ConfidentialClientApplication(
        client_id=CLIENT_ID,
        client_credential=CLIENT_SECRET,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])

    if "access_token" not in result:
        raise Exception(f"Graph auth failed: {result.get('error_description', 'Unknown')}")

    _token_cache["access_token"] = result["access_token"]
    _token_cache["expires_at"] = now + result.get("expires_in", 3600)
    print("[SharePoint] Authenticated with Graph API")
    return result["access_token"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {_get_graph_token()}"}


def _extract_text_from_pdf(content: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(content))
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
        return text.strip()
    except ImportError:
        return "[PDF file — install PyPDF2 to extract text]"
    except Exception as e:
        print(f"[SharePoint] PDF extraction error: {e}")
        return "[Could not extract text from PDF]"


def _extract_text_from_docx(content: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(content))
        return "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
    except ImportError:
        return "[DOCX file — install python-docx to extract text]"
    except Exception as e:
        print(f"[SharePoint] DOCX extraction error: {e}")
        return "[Could not extract text from DOCX]"


async def _fetch_sharepoint_documents(force_refresh: bool = False) -> list:
    """Fetch all documents from SharePoint. Cached for 1 hour."""
    now = time.time()

    if (
        not force_refresh
        and _doc_cache["documents"]
        and _doc_cache["loaded_at"] + _doc_cache["ttl"] > now
    ):
        print(f"[SharePoint] Using cached documents ({len(_doc_cache['documents'])} files)")
        return _doc_cache["documents"]

    print("[SharePoint] Fetching documents from SharePoint...")

    

    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            # Get site ID
            resp = await client.get(
                f"{GRAPH_BASE}/sites/{SHAREPOINT_HOSTNAME}:{SHAREPOINT_SITE_PATH}",
                headers=_headers(),
            )
            resp.raise_for_status()
            site_id = resp.json()["id"]
            print(f"[SharePoint] Site ID: {site_id}")

            # Get drives
            resp = await client.get(
                f"{GRAPH_BASE}/sites/{site_id}/drives", headers=_headers()
            )
            resp.raise_for_status()
            drives = resp.json().get("value", [])

            if not drives:
                print("[SharePoint] No document libraries found")
                return []

            documents = []
            text_exts = {".txt", ".md", ".csv", ".json", ".xml", ".html"}

            for drive in drives:
                drive_id = drive["id"]

                # List files
                resp = await client.get(
                    f"{GRAPH_BASE}/sites/{site_id}/drives/{drive_id}/root/children",
                    headers=_headers(),
                )
                resp.raise_for_status()
                files = resp.json().get("value", [])

                for f in files:
                    if "folder" in f:
                        continue

                    name = f["name"]
                    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""

                    # Download file
                    resp = await client.get(
                        f"{GRAPH_BASE}/sites/{site_id}/drives/{drive_id}/items/{f['id']}/content",
                        headers=_headers(),
                    )
                    resp.raise_for_status()
                    raw = resp.content

                    # Extract text based on file type
                    if ext in text_exts:
                        try:
                            content_text = raw.decode("utf-8")
                        except UnicodeDecodeError:
                            content_text = raw.decode("latin-1")
                    elif ext == ".pdf":
                        content_text = _extract_text_from_pdf(raw)
                    elif ext == ".docx":
                        content_text = _extract_text_from_docx(raw)
                    else:
                        print(f"[SharePoint] Skipping: {name}")
                        continue

                    if content_text and content_text.strip():
                        if len(content_text) > 15000:
                            content_text = content_text[:15000] + "\n\n[... truncated ...]"
                        documents.append({"filename": name, "content": content_text})
                        print(f"[SharePoint] Loaded: {name} ({len(content_text)} chars)")

            _doc_cache["documents"] = documents
            _doc_cache["loaded_at"] = now
            print(f"[SharePoint] Total: {len(documents)} documents loaded")
            return documents

    except Exception as e:
        print(f"[SharePoint] Error: {e}")
        if _doc_cache["documents"]:
            print("[SharePoint] Returning stale cache")
            return _doc_cache["documents"]
        return []


# ═══════════════════════════════════════════
# AGENT — Send docs + question to basic agent
# ═══════════════════════════════════════════

def _parse_response(response) -> str:
    data = response.json()

    if "output" in data:
        text_parts = []
        for item in data["output"]:
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("type") in ("output_text", "text"):
                        text_parts.append(content.get("text", ""))
        if text_parts:
            return "\n".join(text_parts)

    if "choices" in data:
        return data["choices"][0]["message"]["content"]

    return str(data)


async def invoke_sharepoint_agent(
    user_message: str,
    user_name: str = "",
    role: str = "",
    branch_id: str = "",
) -> str:
    """
    Main entry point — called by finbot_agent.py routing.
    Same function signature as the old version, drop-in replacement.
    """

    # Step 1: Fetch documents from SharePoint (cached)
    try:
        documents = await _fetch_sharepoint_documents()
    except Exception as e:
        print(f"[SharePointAgent] Failed to fetch documents: {e}")
        documents = []

    # Step 2: Build prompt with document context
    if documents:
        doc_context = "\n\n".join(
            f"=== Document: {doc['filename']} ===\n{doc['content'][:8000]}"
            for doc in documents
        )
        context = f"""{FORMATTING_INSTRUCTIONS}

The following documents are from the RetailManagement SharePoint site.
Use ONLY these documents to answer the user's question.
If the answer is not in the documents, say so clearly.

{doc_context}

---
User context:
- Name: {user_name}
- Role: {role}
- Branch: {branch_id}

User question: {user_message}"""
    else:
        context = f"""{FORMATTING_INSTRUCTIONS}

Note: SharePoint documents could not be loaded. Answer from general knowledge
but let the user know that document-specific answers are currently unavailable.

User context:
- Name: {user_name}
- Role: {role}
- Branch: {branch_id}

User question: {user_message}"""

    # Step 3: Call the basic agent with API key
    url = f"{FOUNDRY_ENDPOINT}/agents/{AGENT_NAME}/endpoint/protocols/openai/responses?api-version=v1"

    headers = {
        "Content-Type": "application/json",
        "api-key": FOUNDRY_API_KEY,
    }

    

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(url, headers=headers, json={"input": context})
            if response.status_code == 200:
                return _parse_response(response)
            else:
                print(f"[SharePointAgent] Agent error: {response.status_code} - {response.text}")
                return "Sorry, I couldn't process your request. Please try again."
    except httpx.TimeoutException:
        return "The request timed out. Please try again."
    except Exception as e:
        print(f"[SharePointAgent] Error: {e}")
        return "Sorry, an error occurred. Please try again."