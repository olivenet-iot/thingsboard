"""SignConnect AI Chatbot — FastAPI entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import anthropic
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import config
from chat import process_chat
from models import ChatRequest, ChatResponse
from tb_client import TBClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — initialise / tear down shared clients
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting SignConnect AI Chatbot service")
    tb = TBClient()
    await tb.authenticate()
    logger.info("ThingsBoard authenticated")

    ac = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)

    app.state.tb_client = tb
    app.state.anthropic_client = ac

    yield

    await tb.close()
    logger.info("SignConnect AI Chatbot service stopped")


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=get_remote_address)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SignConnect AI Chatbot",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/api/chat", response_model=ChatResponse)
@limiter.limit(config.RATE_LIMIT_PER_IP)
async def chat_endpoint(request: Request, body: ChatRequest):
    """Process a chat message and return the AI response."""
    tb: TBClient = app.state.tb_client
    ac: anthropic.AsyncAnthropic = app.state.anthropic_client
    return await process_chat(body, tb, ac)


@app.get("/api/health")
async def health():
    """Health check — includes ThingsBoard and Anthropic key status."""
    tb: TBClient = app.state.tb_client
    tb_ok = await tb.check_connectivity()
    api_key_ok = bool(
        config.ANTHROPIC_API_KEY and len(config.ANTHROPIC_API_KEY) > 10
    )
    return {
        "status": "ok" if (tb_ok and api_key_ok) else "degraded",
        "thingsboard": "connected" if tb_ok else "disconnected",
        "anthropic_key": "configured" if api_key_ok else "missing",
        "model": config.AI_MODEL,
    }


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "response": "An internal error occurred. Please try again.",
            "metadata": {"tools_used": [], "entity_references": [], "suggestions": []},
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=config.SERVICE_PORT)
