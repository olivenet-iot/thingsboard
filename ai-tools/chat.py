"""Chat handler — orchestrates Claude API calls with iterative tool use."""

from __future__ import annotations

import json
import logging

import anthropic

import config
from models import (
    ChatMetadata,
    ChatRequest,
    ChatResponse,
    EntityReference,
)
from prompts import build_system_prompt
from tb_client import TBClient
from tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger(__name__)

# Default follow-up suggestions when Claude doesn't provide any
DEFAULT_SUGGESTIONS = [
    "Show me the site overview",
    "Any active alarms?",
    "How are the energy savings?",
]


async def process_chat(
    request: ChatRequest,
    tb_client: TBClient,
    anthropic_client: anthropic.AsyncAnthropic,
) -> ChatResponse:
    """Process a chat request through Claude with iterative tool use.

    1. Build the system prompt with entity context.
    2. Assemble messages (history + new user message).
    3. Call Claude — if it returns tool_use blocks, execute them and loop.
    4. Extract the final text response, suggestions, and metadata.
    """
    # Pre-fetch hierarchy on first message if customer_id available
    hierarchy_data = None
    if not request.chat_history and request.context and request.context.customer_id:
        try:
            hierarchy_data = await execute_tool(
                "get_hierarchy",
                {"customer_id": request.context.customer_id},
                tb_client,
            )
            if "error" not in hierarchy_data:
                logger.info("Pre-fetched hierarchy for customer %s", request.context.customer_id)
            else:
                logger.warning("Hierarchy pre-fetch returned error: %s", hierarchy_data.get("error"))
                hierarchy_data = None
        except Exception:
            logger.warning("Failed to pre-fetch hierarchy", exc_info=True)
            hierarchy_data = None

    system_prompt = build_system_prompt(request.context, hierarchy_data=hierarchy_data)

    # Build conversation messages
    messages: list[dict] = []
    for msg in request.chat_history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    tools_used: list[str] = []
    entity_refs: list[EntityReference] = []

    # -- Iterative tool-use loop ------------------------------------------
    iterations = 0
    while iterations < config.MAX_TOOL_ITERATIONS:
        iterations += 1
        try:
            response = await anthropic_client.messages.create(
                model=config.AI_MODEL,
                max_tokens=config.AI_MAX_TOKENS,
                system=system_prompt,
                messages=messages,
                tools=TOOL_DEFINITIONS,
            )
        except anthropic.APIError as exc:
            logger.exception("Claude API error")
            return ChatResponse(
                response=f"I'm having trouble connecting to the AI service. Please try again. (Error: {exc.message})",
                metadata=ChatMetadata(suggestions=DEFAULT_SUGGESTIONS),
            )

        # Check if Claude wants to use tools
        if response.stop_reason != "tool_use":
            # No more tool calls — extract final text
            break

        # Process each content block
        assistant_content = []
        tool_results = []

        for block in response.content:
            assistant_content.append(block)
            if block.type == "tool_use":
                tool_name = block.name
                tool_input = block.input
                tools_used.append(tool_name)

                logger.info("Executing tool: %s(%s)", tool_name, json.dumps(tool_input)[:200])
                result = await execute_tool(tool_name, tool_input, tb_client)

                # Collect entity references from tool inputs
                _collect_entity_refs(tool_name, tool_input, result, entity_refs)

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })

        # Append assistant message with tool_use blocks
        messages.append({
            "role": "assistant",
            "content": [_block_to_dict(b) for b in assistant_content],
        })
        # Append tool results
        messages.append({"role": "user", "content": tool_results})

    # -- Extract final text -----------------------------------------------
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    if not final_text:
        final_text = "I processed your request but couldn't generate a text response. Please try rephrasing."

    # -- Extract suggestions -----------------------------------------------
    suggestions = _extract_suggestions(final_text, request.context)

    return ChatResponse(
        response=final_text,
        metadata=ChatMetadata(
            tools_used=list(set(tools_used)),
            entity_references=entity_refs,
            suggestions=suggestions,
        ),
    )


def _block_to_dict(block) -> dict:
    """Convert an Anthropic content block to a serialisable dict."""
    if block.type == "text":
        return {"type": "text", "text": block.text}
    if block.type == "tool_use":
        return {
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": block.input,
        }
    # Fallback
    return {"type": block.type}


def _collect_entity_refs(
    tool_name: str,
    tool_input: dict,
    result: dict,
    refs: list[EntityReference],
) -> None:
    """Collect entity references from tool calls for metadata."""
    seen_ids = {r.id for r in refs}

    # From tool inputs
    for key in ("device_id", "site_id", "entity_id"):
        eid = tool_input.get(key)
        if eid and eid not in seen_ids:
            etype = "DEVICE" if "device" in key else tool_input.get("entity_type", "ASSET")
            name = result.get("device_name") or result.get("site_name") or result.get("entity_name", "")
            refs.append(EntityReference(name=name, id=eid, type=etype))
            seen_ids.add(eid)

    # From compare_sites results
    if tool_name == "compare_sites":
        for site in result.get("sites", []):
            sid = site.get("site_id", "")
            if sid and sid not in seen_ids:
                refs.append(EntityReference(
                    name=site.get("site_name", ""),
                    id=sid,
                    type="ASSET",
                ))
                seen_ids.add(sid)


def _extract_suggestions(text: str, context=None) -> list[str]:
    """Generate contextual follow-up suggestions.

    Returns defaults unless context gives us something more specific.
    """
    suggestions = []

    if context and context.entity_type == "DEVICE":
        suggestions = [
            "Show me the energy savings",
            "What's the current dim level?",
            "Any alarms for this device?",
        ]
    elif context and context.entity_type == "ASSET":
        suggestions = [
            "Compare with other sites",
            "Show me the energy savings",
            "Any active alarms?",
        ]
    else:
        suggestions = list(DEFAULT_SUGGESTIONS)

    return suggestions
