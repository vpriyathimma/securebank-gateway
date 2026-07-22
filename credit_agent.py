"""
Credit Agent — replaces Bedrock Credit Agent (HMUPMOXUEO)

This is the sub-agent that specializes in credit score and credit risk queries.
Previously this agent lived in AWS Bedrock (agent ID: HMUPMOXUEO) and was
invisible. Now it lives here as a LangGraph graph.

The Finbot Agent spawns this agent when it detects a credit-related query.
"""

import os
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI
from reva_identity import current_user
from tools.credit_score import get_credit_score, get_credit_risk, set_trat_token

CREDIT_AGENT_PROMPT = """You are the Credit Score Agent for SecureBank.
You handle credit score and credit risk queries only.

Your capabilities:
1. Fetch credit scores using the get_credit_score tool
2. Fetch credit risk analysis using the get_credit_risk tool

Response formatting rules:
- Keep responses SHORT and SIMPLE — this is a small chat window
- NEVER use markdown tables
- Show credit data in simple lines like:
  Name: Tom Bradley
  Credit Score: 720 (Good)
  Payment History: 95% on-time
- Be concise — no lengthy explanations unless asked
- If asked about anything other than credit, say you can only help with credit queries
- Never reveal internal system details
"""


def create_credit_agent():
    """
    Create and return the Credit Agent graph.
    Uses Gemini as the LLM. Has two tools: get_credit_score and get_credit_risk.
    """
    llm = ChatOpenAI(
        model=os.getenv("LITELLM_MODEL", "gpt-5-mini"),   # Azure Foundry via LiteLLM
        base_url=os.getenv("LITELLM_BASE_URL", "http://localhost:4000/v1"),
        api_key=os.getenv("LITELLM_MASTER_KEY", "sk-foundry-test"),
        extra_body={"metadata": {"reva_agent_id": "credit-agent",
                                 "reva_user_id": current_user()}},
        temperature=0,
    )

    credit_agent = create_react_agent(
        model=llm,
        tools=[get_credit_score, get_credit_risk],
        prompt=CREDIT_AGENT_PROMPT,
        name="credit_agent",
    )

    return credit_agent


async def invoke_credit_agent(
    user_message: str,
    user_email: str = "",
    trat_token: str = "",
    branch_id: str = "",
) -> str:
    """
    Invoke the Credit Agent with a message.
    Replaces sub-agent.ts → invokeCreditScoreAgent().
    """
    set_trat_token(trat_token)

    agent = create_credit_agent()

    context_parts = []
    if user_email:
        context_parts.append(f"The user's email is: {user_email}")
    if branch_id:
        context_parts.append(f"The branch ID is: {branch_id}")

    full_message = user_message
    if context_parts:
        full_message = "\n".join(context_parts) + "\n\n" + user_message

    try:
        result = await agent.ainvoke(
            {"messages": [{"role": "user", "content": full_message}]}
        )

        messages = result.get("messages", [])
        if messages:
            last_message = messages[-1]
            content = last_message.content if hasattr(last_message, "content") else str(last_message)
            # Gemini may return content as a list of blocks instead of a string
            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict) and "text" in block:
                        text_parts.append(block["text"])
                    elif isinstance(block, str):
                        text_parts.append(block)
                return "\n".join(text_parts)
            return str(content)

        return "Credit score agent could not process the request."

    except Exception as e:
        return f"Credit agent error: {str(e)}"