from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import config


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TODO: start APScheduler here
    yield
    # TODO: shut down APScheduler here


app = FastAPI(title="SignConnect Reports Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=config.SERVICE_PORT, reload=True)
