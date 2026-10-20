"""Signed evidence: finished runs and fix proposals the browser can hand back.

On a single server the API keeps executions and Saarthi's fix proposals in
memory. On Vercel each request may reach a different function instance, so a
question asked a minute after a run may land where that run is unknown. The
API therefore gives the browser a sealed copy of every finished run (and of
every fix proposal): compressed JSON plus an HMAC-SHA256 tag. The browser
sends it back with Saarthi requests; the API accepts it only if the tag
matches, so the browser can carry the evidence but cannot change it. A
sealed run is still exactly the snapshot that was compiled: its source hash
is checked against the editor's as before.

The key is CC_EVIDENCE_SECRET (set it on every instance of a deployment);
without one each process uses a random key, which is fine for one server.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import zlib
from datetime import datetime

from ..domain.execution import Execution, ExecutionState, StepStatus
from ..schemas.diagnostics import Diagnostic
from ..schemas.runner import JobResult

MAX_TOKEN_CHARS = 3_000_000       # a sealed run carries at most a few MB of program output
MAX_PLAIN_BYTES = 8 * 1024 * 1024
MAX_AGE_S = 7 * 24 * 3600


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class EvidenceSeal:
    def __init__(self, secret: str | None) -> None:
        self._key = hashlib.sha256((secret or secrets.token_hex(32)).encode("utf-8")).digest()

    def seal(self, kind: str, payload: dict) -> str:
        plain = json.dumps({"k": kind, "t": int(time.time()), "p": payload}, separators=(",", ":"),
                           ensure_ascii=False).encode("utf-8")
        body = _b64(zlib.compress(plain, 6))
        tag = hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest()[:24]
        return f"{body}.{_b64(tag)}"

    def open(self, kind: str, token: str | None, max_age_s: int = MAX_AGE_S) -> dict | None:
        """The payload, or None when the token is missing, altered, of another kind or too old."""
        if not token or len(token) > MAX_TOKEN_CHARS or token.count(".") != 1:
            return None
        body, tag = token.split(".")
        try:
            expected = hmac.new(self._key, body.encode("ascii"), hashlib.sha256).digest()[:24]
            if not hmac.compare_digest(expected, _unb64(tag)):
                return None
            inflater = zlib.decompressobj()
            plain = inflater.decompress(_unb64(body), MAX_PLAIN_BYTES)
            if inflater.unconsumed_tail:
                return None
            envelope = json.loads(plain)
        except (ValueError, UnicodeError, zlib.error):
            return None
        if not isinstance(envelope, dict) or envelope.get("k") != kind:
            return None
        if not isinstance(envelope.get("t"), int) or time.time() - envelope["t"] > max_age_s:
            return None
        payload = envelope.get("p")
        return payload if isinstance(payload, dict) else None


# ------------------------------------------------------------------ executions


def execution_payload(execution: Execution) -> dict:
    return {
        "id": execution.id,
        "languageId": execution.language_id,
        "source": execution.source,
        "sourceHash": execution.source_hash,
        "stdin": execution.stdin,
        "state": execution.state.value,
        "createdAt": execution.created_at.isoformat(),
        "startedAt": execution.started_at.isoformat() if execution.started_at else None,
        "finishedAt": execution.finished_at.isoformat() if execution.finished_at else None,
        "stepStatus": {name: status.value for name, status in execution.step_status.items()},
        "result": execution.result.model_dump(mode="json", by_alias=True) if execution.result else None,
        "diagnostics": [d.model_dump(mode="json", by_alias=True) for d in execution.diagnostics],
        "error": execution.error,
    }


def execution_from_payload(data: dict) -> Execution | None:
    try:
        def when(value):
            return datetime.fromisoformat(value) if value else None

        return Execution(
            id=str(data["id"]),
            language_id=str(data["languageId"]),
            source=str(data["source"]),
            source_hash=str(data["sourceHash"]),
            stdin=str(data.get("stdin", "")),
            state=ExecutionState(data["state"]),
            created_at=when(data["createdAt"]),
            started_at=when(data.get("startedAt")),
            finished_at=when(data.get("finishedAt")),
            step_status={str(k): StepStatus(v) for k, v in (data.get("stepStatus") or {}).items()},
            result=JobResult.model_validate(data["result"]) if data.get("result") else None,
            diagnostics=[Diagnostic.model_validate(d) for d in data.get("diagnostics") or []],
            error=data.get("error"),
        )
    except (KeyError, TypeError, ValueError):
        return None
