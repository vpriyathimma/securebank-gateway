"""
Account Agent — Hosted on Microsoft Foundry

This agent lives in Microsoft's cloud (Microsoft Foundry), NOT in our codebase.
We just call it via API — exactly like how Bedrock agents used to work.

The agent is configured in the Foundry portal with instructions and a model (gpt-4.1-mini).
Our code sends a message, Foundry runs the agent, and returns the response.

Agent: SecureBank-Account-Agent
Platform: Microsoft Foundry
Model: gpt-4.1-mini
Handles: Accounts, Transactions, Dashboard, General banking questions
"""

import os
import httpx


FOUNDRY_ENDPOINT = os.getenv(
    "AZURE_FOUNDRY_ENDPOINT",
    "https://vishnupriyat-resource.services.ai.azure.com/api/projects/vishnupriyat"
)
FOUNDRY_API_KEY = os.getenv("AZURE_FOUNDRY_API_KEY", "")
AGENT_NAME = "SecureBank-Account-Agent"


async def invoke_account_agent(
    user_message: str,
    user_name: str = "",
    role: str = "",
    branch_id: str = "",
    clearance_level: int = 0,
    trat_token: str = "",
) -> str:
    """
    Invoke the Account Agent hosted on Microsoft Foundry.

    This is similar to how agent.ts used to call Bedrock:
    - Bedrock: InvokeAgentCommand → AWS cloud → response
    - Foundry: HTTP POST → Microsoft cloud → response

    The agent logic lives in Foundry. We just send a message and get a response.
    """

    # Build context message
    context = f"""User context:
- Name: {user_name}
- Role: {role}
- Branch: {branch_id}
- Clearance Level: {clearance_level}

User query: {user_message}"""

    # Call the Foundry agent via Responses API
    url = f"{FOUNDRY_ENDPOINT}/agents/{AGENT_NAME}/endpoint/protocols/openai/responses?api-version=v1"

    headers = {
        "Content-Type": "application/json",
        "api-key": FOUNDRY_API_KEY,
    }

    body = {
        "input": context,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=body)
            response.raise_for_status()

            data = response.json()

            # Extract the response text from the Responses API format
            # The response contains an "output" array with message items
            if "output" in data:
                text_parts = []
                for item in data["output"]:
                    if item.get("type") == "message":
                        for content in item.get("content", []):
                            if content.get("type") == "output_text":
                                text_parts.append(content.get("text", ""))
                            elif content.get("type") == "text":
                                text_parts.append(content.get("text", ""))
                if text_parts:
                    return "\n".join(text_parts)

            # Fallback: try other response formats
            if "choices" in data:
                return data["choices"][0]["message"]["content"]

            # Last resort: return raw response
            return str(data)

    except httpx.HTTPStatusError as e:
        return f"Account agent error: {e.response.status_code} - {e.response.text}"
    except Exception as e:
        return f"Account agent error: {str(e)}"