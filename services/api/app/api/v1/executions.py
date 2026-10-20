"""Execution endpoints.

POST /api/v1/executions              202 + execution (QUEUED), or 409/413/422/503
POST /api/v1/executions/run          the same, then streams every snapshot (NDJSON,
                                     one JSON object per line) until the terminal one;
                                     works where WebSockets do not (Vercel Functions)
GET  /api/v1/executions/{id}         current snapshot
WS   /api/v1/executions/{id}/events  pushes the full snapshot on every change
                                     and closes after the terminal state

A terminal snapshot carries `evidence`: a sealed copy of the run that the
browser sends back with Saarthi requests (see services/evidence.py).

Runs are anonymous: an execution id (96 random bits) acts as the access token
for its own results. Accounts (Supabase, in the browser) keep a student's code
and progress; the API needs no identity to compile and run a snapshot.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse, StreamingResponse

from ...schemas.executions import ErrorOut, ExecutionCreate, ExecutionOut
from ...services.evidence import execution_payload
from ...services.executions import ExecutionService, PayloadTooLarge, QueueFull, UnknownLanguage
from ...services.presenters import execution_out

router = APIRouter(tags=["executions"])
KEEPALIVE_S = 10.0  # an empty line now and then keeps proxies from closing a quiet stream


def _snapshot(service: ExecutionService, execution, seal=None) -> ExecutionOut:
    profile = service.registry.get(execution.language_id)
    out = execution_out(execution, profile, service.queue_position(execution.id))
    if execution.terminal and seal is not None:
        out.evidence = seal.seal("execution", execution_payload(execution))
    return out


async def _admit(service: ExecutionService, body: ExecutionCreate):
    """The new execution, or the JSONResponse explaining why it was refused."""
    profile = service.registry.get(body.language_id)
    if profile is not None and service.is_available(profile, await service.installed_images()) is False:
        return _error(409, f"{profile.display_name} is not installed on this server yet "
                           f"(its sandbox image {profile.toolchain.image} is missing).")
    try:
        return service.submit(body)
    except UnknownLanguage:
        return _error(422, f"unknown language {body.language_id!r}")
    except PayloadTooLarge as exc:
        return _error(413, str(exc))
    except QueueFull as exc:
        return _error(503, "Too many programs are waiting to run. Please try again shortly.",
                      retry_after_s=exc.retry_after_s)


@router.post(
    "/executions",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ExecutionOut,
    responses={409: {"model": ErrorOut}, 413: {"model": ErrorOut}, 422: {"model": ErrorOut},
               503: {"model": ErrorOut}},
)
async def create_execution(body: ExecutionCreate, request: Request):
    """Queue a compile-and-run of the given source. Returns immediately."""
    service: ExecutionService = request.app.state.executions
    execution = await _admit(service, body)
    if isinstance(execution, JSONResponse):
        return execution
    return _snapshot(service, execution, request.app.state.evidence)


@router.post(
    "/executions/run",
    responses={200: {"content": {"application/x-ndjson": {}},
                     "description": "One ExecutionOut per line, ending with the terminal one."},
               409: {"model": ErrorOut}, 413: {"model": ErrorOut}, 422: {"model": ErrorOut},
               503: {"model": ErrorOut}},
)
async def run_execution(body: ExecutionCreate, request: Request):
    """Queue a compile-and-run and stream its snapshots until it finishes (one request, no WebSocket)."""
    service: ExecutionService = request.app.state.executions
    seal = request.app.state.evidence
    execution = await _admit(service, body)
    if isinstance(execution, JSONResponse):
        return execution
    execution_id = execution.id
    signal = service.subscribe(execution_id)

    async def snapshots():
        try:
            last_sent: tuple | None = None
            while True:
                current = service.get(execution_id)
                if current is None:
                    yield json.dumps({"detail": "execution expired"}) + "\n"
                    return
                key = (current.version, service.queue_position(execution_id))
                if key != last_sent:
                    yield json.dumps(_snapshot(service, current, seal).to_json_dict()) + "\n"
                    last_sent = key
                if current.terminal:
                    return
                try:
                    await asyncio.wait_for(signal.get(), timeout=KEEPALIVE_S)
                except TimeoutError:
                    yield "\n"
        finally:
            service.unsubscribe(execution_id, signal)

    return StreamingResponse(snapshots(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/executions/{execution_id}", response_model=ExecutionOut, responses={404: {"model": ErrorOut}})
async def get_execution(execution_id: str, request: Request):
    service: ExecutionService = request.app.state.executions
    execution = service.get(execution_id)
    if execution is None:
        return _error(404, "execution not found")
    return _snapshot(service, execution, request.app.state.evidence)


@router.websocket("/executions/{execution_id}/events")
async def execution_events(websocket: WebSocket, execution_id: str) -> None:
    service: ExecutionService = websocket.app.state.executions
    await websocket.accept()
    execution = service.get(execution_id)
    if execution is None:
        await websocket.close(code=4404, reason="execution not found")
        return
    signal = service.subscribe(execution_id)
    try:
        last_sent: tuple | None = None
        while True:
            execution = service.get(execution_id)
            if execution is None:
                await websocket.close(code=4404, reason="execution expired")
                return
            key = (execution.version, service.queue_position(execution_id))
            if key != last_sent:
                await websocket.send_json(_snapshot(service, execution, websocket.app.state.evidence).to_json_dict())
                last_sent = key
            if execution.terminal:
                await websocket.close(code=1000)
                return
            await signal.get()
    except WebSocketDisconnect:
        pass
    finally:
        service.unsubscribe(execution_id, signal)


def _error(code: int, detail: str, retry_after_s: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(retry_after_s)} if retry_after_s is not None else None
    body = ErrorOut(detail=detail, retry_after_s=retry_after_s).model_dump(by_alias=True, exclude_none=True)
    return JSONResponse(status_code=code, content=body, headers=headers)
