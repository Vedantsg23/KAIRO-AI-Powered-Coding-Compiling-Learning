from fastapi import APIRouter, Depends
from fastapi.requests import HTTPConnection

from ...queue.vercel_sandbox import OIDC
from . import assistant, executions, health, languages, system


def _capture_oidc(connection: HTTPConnection) -> None:
    """On Vercel every request carries the deployment's OIDC token (x-vercel-oidc-token);
    the runner VM client and AI Gateway sign in with the freshest one."""
    OIDC.offer(connection.headers.get("x-vercel-oidc-token"))


router = APIRouter(prefix="/api/v1", dependencies=[Depends(_capture_oidc)])
router.include_router(health.router)
router.include_router(languages.router)
router.include_router(executions.router)
router.include_router(assistant.router)
router.include_router(system.router)
