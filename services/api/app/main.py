"""KAIRO API: FastAPI application factory.

Run for development:  uvicorn app.main:app --reload --port 8000
(from services/api, with the runner started separately; see README).

On Vercel the same app is the deployment's one function (see vercel.json and
infra/vercel/README.md): code runs in the Vercel Sandbox runner VM, Saarthi
uses AI Gateway, and the built web app is served from the CDN.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .adapters.registry import LanguageRegistry
from .ai.providers import choose_provider
from .ai.service import AssistantService
from .api.v1 import router as v1_router
from .config import PUBLIC_ENV_FILE, REPO_ROOT, ApiSettings, on_vercel, read_key_file
from .persistence.memory import InMemoryExecutionStore
from .queue.runner_client import RunnerClient
from .queue.vercel_sandbox import OIDC, VercelSandboxRunner
from .services.evidence import EvidenceSeal
from .services.executions import ExecutionService

log = logging.getLogger("api")


def create_app(settings: ApiSettings | None = None,
               runner_transport: httpx.AsyncBaseTransport | None = None,
               ai_transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    # On Vercel the live site's public settings (apps/web/.env.vercel, written by the
    # build from infra/vercel/public-settings.json) fill in what the environment does not set.
    settings = settings or ApiSettings(_env_file=PUBLIC_ENV_FILE if on_vercel() else None)
    registry = LanguageRegistry.from_directory()  # fails fast on a broken profile

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.runner_backend == "vercel-sandbox":
            runner = VercelSandboxRunner(settings.vercel_sandbox_name, settings.vercel_sandbox_images,
                                         settings.vercel_executor, transport=runner_transport)
        else:
            runner = RunnerClient(settings.runner_url, settings.runner_token, transport=runner_transport)
        service = ExecutionService(registry, InMemoryExecutionStore(settings.max_stored_executions),
                                   runner, settings)
        # Saarthi's HTTP client talks only to the configured AI provider.
        ai_http = httpx.AsyncClient(transport=ai_transport, timeout=httpx.Timeout(settings.ai_timeout_s,
                                                                                  connect=10.0))
        choice = choose_provider(settings, ai_http, oidc_token=OIDC.token if on_vercel() else None)
        if choice.provider is None:
            logging.getLogger("saarthi").info("Saarthi is off: %s", choice.reason)
        else:
            logging.getLogger("saarthi").info("Saarthi uses %s (%s)", choice.provider.name, choice.provider.model)
        secret = settings.evidence_secret.get_secret_value().strip() if settings.evidence_secret else ""
        secret = secret or read_key_file(settings.evidence_key_file)  # the Vercel build's key
        if not secret and on_vercel():
            log.warning("No evidence key (CC_EVIDENCE_SECRET or the build's key): Saarthi can only "
                        "answer about runs this instance executed.")
        app.state.settings = settings
        app.state.registry = registry
        app.state.executions = service
        app.state.evidence = EvidenceSeal(secret or None)
        app.state.assistant = AssistantService(settings, registry, service, choice.provider, choice.reason,
                                               app.state.evidence)
        await service.start()
        try:
            yield
        finally:
            await service.stop()
            await runner.aclose()
            await ai_http.aclose()

    app = FastAPI(
        title="KAIRO API",
        version=__version__,
        description="Languages, sandboxed executions, normalized diagnostics and Saarthi, the AI assistant.",
        lifespan=lifespan,
    )
    app.include_router(v1_router)

    dist = settings.web_dist
    if dist is None and on_vercel():
        dist = REPO_ROOT / "apps" / "web" / "dist"  # built by vercel.json's buildCommand
    if dist is not None:
        _serve_web_app(app, dist)
    return app


def _serve_web_app(app: FastAPI, dist: Path) -> None:
    """Serve the built single-page app (Docker Compose, and Vercel, which moves it to its CDN)."""
    index = dist / "index.html"
    if not index.is_file():
        log.warning("CC_WEB_DIST=%s has no index.html; not serving the web app", dist)
        return
    if on_vercel():
        # Vercel promotes a frontend declared like this to its CDN at build time;
        # API routes keep priority over the files. Should the build not move them
        # (VERCEL_FASTAPI_STATIC_CDN unset), the function serves them and Vercel's
        # CDN caches the hashed ones after the first request.
        app.frontend("/", directory=str(dist), fallback="index.html")
        app.add_middleware(WebAppCaching)
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


class WebAppCaching:
    """HTTP caching for the web app the function serves on Vercel.

    * Built files under /assets/: their names carry a content hash, so a name
      never points to other content and browsers and Vercel's CDN may keep them
      for a year.
    * Everything else outside /api/ (the page itself, sw.js, the manifest,
      icons): always the current deployment's. Vercel gives every file in a
      function the same modification time (20 October 2018), so the file
      server's ETag and Last-Modified stay the same across deployments whenever
      a file keeps its size, and index.html does: it only names other files. A
      browser's conditional request would then get "304 Not Modified" and keep
      the old page, and with it the old app. These files are small, so they are
      always sent whole: conditional request headers are ignored and no
      validators are sent back.

    Pure ASGI, so the streamed API responses pass through untouched.
    """

    ASSET_HEADERS = ((b"cache-control", b"public, max-age=31536000, immutable"),
                     (b"cdn-cache-control", b"max-age=31536000"))
    VALIDATORS = (b"etag", b"last-modified")
    CONDITIONS = (b"if-none-match", b"if-modified-since", b"if-match", b"if-unmodified-since", b"if-range")

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        path = scope.get("path", "") if scope["type"] == "http" else ""
        if scope["type"] != "http" or path.startswith("/api/"):
            await self.app(scope, receive, send)
            return
        if path.startswith("/assets/"):
            await self.app(scope, receive, self._built_file(send))
            return
        headers = [(k, v) for k, v in scope["headers"] if k.lower() not in self.CONDITIONS]
        await self.app({**scope, "headers": headers}, receive, self._current_file(send))

    def _built_file(self, send):
        async def send_cached(message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 200:
                headers = message.get("headers", [])
                html = any(k.lower() == b"content-type" and v.startswith(b"text/html") for k, v in headers)
                if not html:  # a missing file answered with the page itself is not cached
                    kept = [(k, v) for k, v in headers if k.lower() not in (b"cache-control", b"cdn-cache-control")]
                    message = {**message, "headers": [*kept, *self.ASSET_HEADERS]}
            await send(message)
        return send_cached

    def _current_file(self, send):
        async def send_current(message) -> None:
            if message["type"] == "http.response.start":
                kept = [(k, v) for k, v in message.get("headers", [])
                        if k.lower() not in (*self.VALIDATORS, b"cache-control")]
                message = {**message, "headers": [*kept, (b"cache-control", b"no-cache")]}
            await send(message)
        return send_current


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
