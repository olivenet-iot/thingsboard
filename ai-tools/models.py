"""Pydantic request / response models for the chat API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class EntityContext(BaseModel):
    """Dashboard context sent by the chat widget."""

    user_id: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None
    dashboard: str | None = None
    dashboard_state: str | None = None
    entity_id: str | None = None
    entity_type: str | None = None
    entity_name: str | None = None
    entity_subtype: str | None = None
    dashboard_tier: str | None = None


class ChatMessage(BaseModel):
    """A single message in the conversation history."""

    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    """Incoming chat request from the widget."""

    message: str
    chat_history: list[ChatMessage] = Field(default_factory=list)
    context: EntityContext | None = None


class EntityReference(BaseModel):
    """An entity mentioned in the response."""

    name: str
    id: str
    type: str


class ChatMetadata(BaseModel):
    """Metadata returned alongside the assistant response."""

    tools_used: list[str] = Field(default_factory=list)
    entity_references: list[EntityReference] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class ChatResponse(BaseModel):
    """Response sent back to the chat widget."""

    response: str
    metadata: ChatMetadata = Field(default_factory=ChatMetadata)
