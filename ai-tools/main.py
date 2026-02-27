"""SignConnect AI Chatbot — FastAPI entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import anthropic
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SignConnect AI Chatbot",
    version="1.0.0",
    lifespan=lifespan,
)

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
async def chat_endpoint(request: ChatRequest):
    """Process a chat message and return the AI response."""
    tb: TBClient = app.state.tb_client
    ac: anthropic.AsyncAnthropic = app.state.anthropic_client
    return await process_chat(request, tb, ac)


@app.get("/api/health")
async def health():
    """Health check — includes ThingsBoard connectivity status."""
    tb: TBClient = app.state.tb_client
    tb_ok = await tb.check_connectivity()
    return {
        "status": "ok" if tb_ok else "degraded",
        "thingsboard": "connected" if tb_ok else "disconnected",
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
    uvicorn.run("main:app", host="0.0.0.0", port=config.SERVICE_PORT, reload=True)
