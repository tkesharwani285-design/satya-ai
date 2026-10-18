"""Satya.ai verification API. Run: uvicorn main:app --reload --port 8000"""
import logging
import time
from collections import deque
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from config import get_settings
from routers import audio_verifier, bot_risk, media_verifier, text_verifier, url_verifier
from schemas import HealthResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("satya")
settings = get_settings()
STARTED = time.time()
LATENCIES: deque[float] = deque(maxlen=100)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=settings.http_timeout, headers={"User-Agent": f"SatyaBot/{settings.version}"},
        limits=httpx.Limits(max_connections=50))
    yield
    await app.state.http.aclose()


app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan)


async def timing(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("Unhandled error on %s", request.url.path)
        response = JSONResponse({"detail": "Internal server error"}, status_code=500)
    ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-ms"] = f"{ms:.0f}"
    if request.url.path != "/api/v1/health":
        LATENCIES.append(ms)
    return response


app.add_middleware(BaseHTTPMiddleware, dispatch=timing)
# In development, accept the Vite dev/preview server on ANY localhost port (5173, 5174, 4173, ...).
# Production uses only CORS_ORIGINS / CORS_ORIGIN_REGEX. A "*" origin is deliberately not used: it cannot
# be combined with allow_credentials=True in a spec-compliant way and would expose the API to every site.
LOCAL_DEV_REGEX = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
cors_regex = settings.cors_origin_regex or (LOCAL_DEV_REGEX if settings.environment == "development" else None)

app.add_middleware(  # added last so CORS wraps everything, including error responses
    CORSMiddleware, allow_origins=settings.origins, allow_origin_regex=cors_regex,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Process-Time-ms"])

for r in (url_verifier, text_verifier, media_verifier, audio_verifier, bot_risk):
    app.include_router(r.router, prefix="/api/v1")


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
async def health():
    return HealthResponse(
        status="ok", engine=settings.app_name, version=settings.version,
        latency_ms=round(sum(LATENCIES) / len(LATENCIES)) if LATENCIES else 0,
        uptime_seconds=int(time.time() - STARTED),
        integrations={"google_factcheck": bool(settings.google_factcheck_api_key),
                      "tavily": bool(settings.tavily_api_key),
                      "reverse_image": bool(settings.google_vision_api_key),
                      "whisper": bool(settings.openai_api_key),
                      "sarvam": bool(settings.sarvam_api_key),
                      "social_data": bool(settings.x_bearer_token)})
