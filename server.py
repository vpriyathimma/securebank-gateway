"""
LangGraph Agent Service — FastAPI Server

GATEWAY VERSION: the Reva SDK (@reva_ai_authorise decorators + revaclient
proxy) has been removed. Authorization now happens in the LiteLLM gateway,
which the agents' model/tool calls route through. No SDK is embedded here.
"""
import os
import uuid
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any
from dotenv import load_dotenv
load_dotenv()

import os
print(f"DEBUG ENV: RTG_URL={os.getenv('RTG_URL')}")
print(f"DEBUG ENV: POLICYSTORE_ID={os.getenv('POLICYSTORE_ID')}")
print(f"DEBUG ENV: RTG_DISABLED={os.getenv('RTG_DISABLED')}")
print(f"DEBUG ENV: RTG_AUTH_TOKEN={'SET' if os.getenv('RTG_AUTH_TOKEN') else 'NOT SET'}")

from finbot_agent import invoke_finbot, _credit_context
from credit_agent import invoke_credit_agent
from sharepoint_agent import invoke_sharepoint_agent


app = FastAPI(
    title="SecureBank LangGraph Agent Service",
    description="LangGraph-based agent service replacing AWS Bedrock agents",
    version="1.0.0",
)



app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("SECUREBANK_URL", "https://securebank-app-v2.onrender.com"),
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HistoryModel(BaseModel):
    prompt: str = ""


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: str = ""
    user_name: str = ""
    role: str = ""
    clearance_level: int = 0
    branch_id: str = ""
    department: str = ""
    trat_token: str = ""
    prompt: str = ""
    query: str = ""
    query_history: str = ""
    history: Optional[HistoryModel] = None
    document_name: str = ""
    sensitivity_label: str = ""


class ChatResponse(BaseModel):
    response: str
    session_id: str
    agent: str = "finbot-langgraph"


# ── ORIGINAL /chat endpoint (unchanged) ─────────────────────────

@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request):
    """Main chat endpoint — called by SecureBank's routes.ts"""
    try:
        session_id = body.session_id or str(uuid.uuid4())

        print(f"DEBUG SDK: Request reached handler - SDK allowed the request")
        print(f"DEBUG SDK: Auth header present: {bool(request.headers.get('authorization'))}")
        print(f"DEBUG PROMPT: current='{body.prompt}'")
        print(f"DEBUG PROMPT: query_history='{body.query_history}'")
        print(f"DEBUG PROMPT: history={body.history}")

        response = await invoke_finbot(
            session_id=session_id,
            user_message=body.message,
            user_id=body.user_id,
            user_name=body.user_name,
            role=body.role,
            clearance_level=body.clearance_level,
            branch_id=body.branch_id,
            department=body.department,
            trat_token=body.trat_token,
        )

        print(f"DEBUG SERVER: routed_to = {_credit_context.get('routed_to')}")
        routed_to = _credit_context.get("routed_to", "finbot-langgraph")
        print(f"DEBUG SERVER: final routed_to = {routed_to}")

        return ChatResponse(
            response=response,
            session_id=session_id,
            agent=routed_to,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── NEW: Sub-agent request model ─────────────────────────────────

class SubAgentRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: str = ""
    user_name: str = ""
    user_email: str = ""
    role: str = ""
    clearance_level: int = 0
    branch_id: str = ""
    department: str = ""
    trat_token: str = ""


class SubAgentResponse(BaseModel):
    response: str
    agent: str


# ── NEW: /credit endpoint for RTG decision log ──────────────────

@app.post("/credit", response_model=SubAgentResponse)
async def credit(body: SubAgentRequest, request: Request):
    """Credit agent endpoint — creates RTG decision log for finbot→credit delegation."""
    try:
        result = await invoke_credit_agent(
            user_message=body.message,
            user_email=body.user_email,
            trat_token=body.trat_token,
            branch_id=body.branch_id,
        )
        return SubAgentResponse(response=result, agent="credit-agent")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── NEW: /sharepoint endpoint for RTG decision log ──────────────

@app.post("/sharepoint", response_model=SubAgentResponse)
async def sharepoint(body: SubAgentRequest, request: Request):
    """SharePoint agent endpoint — creates RTG decision log for finbot→sharepoint delegation."""
    try:
        result = await invoke_sharepoint_agent(
            user_message=body.message,
            user_name=body.user_name,
            role=body.role,
            branch_id=body.branch_id,
        )
        return SubAgentResponse(response=result, agent="sharepoint-agent")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ORIGINAL health endpoint (unchanged) ─────────────────────────

@app.get("/health")
async def health():
    """Health check endpoint for Render."""
    return {"status": "healthy", "service": "securebank-langgraph-agent"}