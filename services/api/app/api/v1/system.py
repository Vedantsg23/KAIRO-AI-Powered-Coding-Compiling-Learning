"""Operations endpoints.

GET /api/v1/system/keepalive   called once a day by Vercel Cron (vercel.json):
                               * calls the database's keepalive() function, so the
                                 free Supabase project never pauses for inactivity;
                                 accounts and saved work stay available;
                               * wakes the runner VM once, so its snapshot (which
                                 expires 7 days after its last use) never expires.

When CRON_SECRET is set, Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"
and other callers are refused. Without it the endpoint works for anyone, at most
once every ten minutes per server instance (it only does harmless pings).
"""

from __future__ import annotations

import hmac
import logging
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/system", tags=["system"])
log = logging.getLogger("api.system")

MIN_INTERVAL_S = 600
_last: dict[str, object] = {"at": 0.0, "result": None}


@router.get("/keepalive")
async def keepalive(request: Request):
    settings = request.app.state.settings
    secret = settings.cron_secret.get_secret_value().strip() if settings.cron_secret else ""
    if secret:
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {secret}".encode()):
            return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    elif time.monotonic() - float(_last["at"]) < MIN_INTERVAL_S and _last["result"] is not None:
        return _last["result"]

    result = {"database": await _ping_database(settings), "runner": await _wake_runner(request)}
    _last["at"], _last["result"] = time.monotonic(), result
    log.info("keep-alive: %s", result)
    return result


async def _ping_database(settings) -> dict:
    url = settings.supabase_url.rstrip("/")
    key = settings.supabase_key.get_secret_value().strip() if settings.supabase_key else ""
    if not url or not key:
        return {"status": "skipped", "detail": "Supabase is not configured on the server"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=10.0)) as http:
            response = await http.post(f"{url}/rest/v1/rpc/keepalive", json={},
                                       headers={"apikey": key, "content-type": "application/json"})
    except httpx.HTTPError as exc:
        return {"status": "error", "detail": f"database not reachable: {type(exc).__name__}"}
    if response.status_code >= 400:
        return {"status": "error", "detail": f"database answered HTTP {response.status_code}"}
    return {"status": "ok", "at": response.json() if response.content else None}


async def _wake_runner(request: Request) -> dict:
    runner = request.app.state.executions.runner
    wake = getattr(runner, "keepalive", None)
    if wake is None:
        return {"status": "skipped", "detail": "the runner is not a Vercel Sandbox"}
    try:
        return await wake()
    except Exception as exc:  # noqa: BLE001 - reported, never raised to the cron
        return {"status": "error", "detail": str(exc)[:300]}
