"""Chat handler — orchestrates Claude API calls with iterative tool use."""

from __future__ import annotations

import json
import logging
import time

import anthropic
import httpx

import config
from cache import (
    get_cached_hierarchy,
    get_hierarchy_entity_ids,
    set_cached_hierarchy,
)
from guardrails import (
    REJECTION_RESPONSE,
    REJECTION_SUGGESTIONS,
    is_on_topic,
    sanitize_input,
)
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

# ---------------------------------------------------------------------------
# Per-customer rate limiting (in-memory)
# ---------------------------------------------------------------------------

_customer_request_log: dict[str, list[float]] = {}


def _check_customer_rate(customer_id: str) -> bool:
    """Return True if the customer is within rate limits."""
    now = time.time()
    window = config.RATE_LIMIT_CUSTOMER_WINDOW
    limit = config.RATE_LIMIT_PER_CUSTOMER

    timestamps = _customer_request_log.get(customer_id, [])
    # Prune old entries
    timestamps = [t for t in timestamps if now - t < window]
    _customer_request_log[customer_id] = timestamps

    if len(timestamps) >= limit:
        return False

    timestamps.append(now)
    return True


RATE_LIMIT_RESPONSE = (
    "Too many requests. Please wait a moment before sending another message."
)


async def process_chat(
    request: ChatRequest,
    tb_client: TBClient,
    anthropic_client: anthropic.AsyncAnthropic,
) -> ChatResponse:
    """Process a chat request through Claude with iterative tool use.

    Pipeline:
    1. Topic guard — reject off-topic messages (no Claude call).
    2. Input sanitization — block prompt injection attempts.
    3. Per-customer rate limit check.
    4. Customer isolation — validate customer_id exists.
    5. Hierarchy cache — fetch or use cached hierarchy.
    6. Build system prompt + conversation messages.
    7. Claude API loop with iterative tool use.
    8. Return final response with suggestions + metadata.
    """
    ctx = request.context

    # -- 1. Topic guard ---------------------------------------------------
    if not is_on_topic(request.message):
        return ChatResponse(
            response=REJECTION_RESPONSE,
            metadata=ChatMetadata(suggestions=REJECTION_SUGGESTIONS),
        )

    # -- 2. Prompt injection protection -----------------------------------
    is_safe, result = sanitize_input(request.message)
    if not is_safe:
        return ChatResponse(
            response=result,
            metadata=ChatMetadata(suggestions=REJECTION_SUGGESTIONS),
        )
    # Use the cleaned message from here on
    user_message = result

    # -- 3. Per-customer rate limit ---------------------------------------
    customer_id = ctx.customer_id if ctx else None
    if customer_id and not _check_customer_rate(customer_id):
        return ChatResponse(
            response=RATE_LIMIT_RESPONSE,
            metadata=ChatMetadata(suggestions=[]),
        )

    # -- 4. Customer isolation — validate customer exists -----------------
    if customer_id:
        try:
            await tb_client.get_customer(customer_id)
        except httpx.HTTPStatusError:
            return ChatResponse(
                response="Unable to verify your account. Please refresh and try again.",
                metadata=ChatMetadata(suggestions=[]),
            )

    # -- 5. Hierarchy cache -----------------------------------------------
    hierarchy_data = None
    if customer_id:
        hierarchy_data = get_cached_hierarchy(customer_id)
        if hierarchy_data is None:
            try:
                hierarchy_data = await execute_tool(
                    "get_hierarchy",
                    {"customer_id": customer_id},
                    tb_client,
                    ctx,
                )
                if "error" not in hierarchy_data:
                    set_cached_hierarchy(customer_id, hierarchy_data)
                    logger.info("Fetched + cached hierarchy for customer %s", customer_id)
                else:
                    logger.warning("Hierarchy fetch returned error: %s", hierarchy_data.get("error"))
                    hierarchy_data = None
            except Exception:
                logger.warning("Failed to fetch hierarchy", exc_info=True)
                hierarchy_data = None
        else:
            logger.debug("Using cached hierarchy for customer %s", customer_id)

    # -- 6. Build system prompt + messages --------------------------------
    system_prompt = build_system_prompt(ctx, hierarchy_data=hierarchy_data)

    messages: list[dict] = []
    for msg in request.chat_history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": user_message})

    tools_used: list[str] = []
    entity_refs: list[EntityReference] = []

    # -- 7. Iterative tool-use loop ---------------------------------------
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
                response="I'm having trouble connecting right now. Please try again.",
                metadata=ChatMetadata(suggestions=DEFAULT_SUGGESTIONS),
            )

        # Check if Claude wants to use tools
        if response.stop_reason != "tool_use":
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

                # Entity-level ownership check for downlink/query tools
                _OWNERSHIP_CHECKED_TOOLS = {
                    "send_dim_command",
                    "send_task_schedule",
                    "delete_task_schedule",
                    "send_location_setup",
                    "query_task_schedule",
                }
                if tool_name in _OWNERSHIP_CHECKED_TOOLS and customer_id:
                    allowed_ids = get_hierarchy_entity_ids(customer_id)
                    target_id = tool_input.get("device_id", "")
                    if allowed_ids and target_id not in allowed_ids:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps({
                                "error": "Device not found in your account.",
                            }),
                        })
                        continue

                logger.info("Executing tool: %s(%s)", tool_name, json.dumps(tool_input)[:200])
                tool_result = await execute_tool(tool_name, tool_input, tb_client, ctx)

                # Collect entity references from tool inputs
                _collect_entity_refs(tool_name, tool_input, tool_result, entity_refs)

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(tool_result),
                })

        # Append assistant message with tool_use blocks
        messages.append({
            "role": "assistant",
            "content": [_block_to_dict(b) for b in assistant_content],
        })
        # Append tool results
        messages.append({"role": "user", "content": tool_results})

    # -- 8. Extract final text --------------------------------------------
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    if not final_text:
        final_text = "I processed your request but couldn't generate a text response. Please try rephrasing."

    suggestions = _extract_suggestions(final_text, ctx)

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
