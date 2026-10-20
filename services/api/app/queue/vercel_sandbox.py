"""Run jobs in a Vercel Sandbox: the code runner of the Vercel deployment (no Docker).

Vercel Functions cannot start containers, so on Vercel the API hands each job to
a named Vercel Sandbox: a Firecracker micro-VM started from a snapshot that holds
the same sandbox images as the Docker runner, as plain root filesystems (see
infra/vercel/README.md). infra/vercel/runner/kairo_exec.py runs a job there with
the Docker runner's isolation and limits and prints the runner's NDJSON protocol,
so this client returns exactly what RunnerClient returns.

The executor is part of this repository, not of the snapshot: the API uploads it
to every new VM session once and installs a root-owned copy, so the code that
runs jobs always matches the API that sends them.

The API calls the Sandbox REST API with the deployment's OIDC token (the
x-vercel-oidc-token request header, or VERCEL_OIDC_TOKEN when run locally):

    GET  /v2/sandboxes/{name}?resume=true            the VM's session, started if it was stopped
    POST /v2/sandboxes/sessions/{id}/extend-timeout  keep it up while jobs arrive
    POST /v2/sandboxes/sessions/{id}/fs/write        the job (JSON) as a gzipped tarball
    POST /v2/sandboxes/sessions/{id}/cmd             run the executor, stream its output

Submitted code never runs in the API process, and nothing from a job reaches a
shell: the executor gets the job as a file and every step as an argument array.
"""

from __future__ import annotations

import base64
import gzip
import io
import json
import logging
import os
import tarfile
import time
from collections.abc import Iterable
from pathlib import Path

import anyio
import httpx

from ..schemas.runner import JobEvent, JobResult, JobSpec
from .runner_client import ProgressCallback, RunnerBusy, RunnerError, RunnerUnavailable

log = logging.getLogger("api.vercel_sandbox")

API_BASE = "https://vercel.com/api"
PYTHON = "/usr/bin/python3"
EXECUTOR = "/opt/kairo/sbin/kairo_exec.py"   # root-owned copy, installed in each new session
UPLOAD = "tmp/kairo-up/kairo_exec.py"         # where the API uploads it first (relative to "/")
INBOX = "tmp/kairo-in"                        # where job files land (relative to "/")
SESSION_EXTEND_MS = 5 * 60 * 1000             # each extension keeps the VM up five more minutes
BUSY_PATIENCE_S = 12.0                        # how long a job waits for a free slot in the VM


class SandboxApiError(RunnerError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"Vercel Sandbox API answered {status}: {message}")
        self.status = status


def _b64url(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class OidcToken:
    """The deployment's OIDC token, kept from incoming requests (the latest-expiring one wins)."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._payload: dict = {}

    @staticmethod
    def _decode(token: str) -> dict:
        try:
            payload = json.loads(_b64url(token.split(".")[1]))
            return payload if isinstance(payload, dict) else {}
        except (IndexError, ValueError):
            return {}

    def offer(self, token: str | None) -> None:
        if not token:
            return
        payload = self._decode(token)
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)) or exp <= time.time():
            return
        current = self._payload.get("exp")
        if self._token is None or not isinstance(current, (int, float)) or exp >= current:
            self._token, self._payload = token, payload

    def token(self) -> str | None:
        """The current token (from a request, else VERCEL_OIDC_TOKEN), or None."""
        token, payload = self._token, self._payload
        if token is not None and float(payload.get("exp", 0)) > time.time() + 5:
            return token
        return os.environ.get("VERCEL_OIDC_TOKEN") or None

    def credentials(self) -> tuple[str, str, str]:
        """(token, project id, team id); raises RunnerUnavailable when there is none."""
        token = self.token()
        payload = self._payload if token == self._token else self._decode(token or "")
        project = os.environ.get("VERCEL_PROJECT_ID") or payload.get("project_id")
        team = os.environ.get("VERCEL_TEAM_ID") or payload.get("owner_id")
        if not token or not project or not team:
            raise RunnerUnavailable("no Vercel OIDC token yet (is OIDC enabled for this project?)")
        return token, str(project), str(team)


OIDC = OidcToken()


def tarball(files: Iterable[tuple[str, bytes, int]]) -> bytes:
    """A gzipped tarball of (path, data, mode) entries (what fs/write expects)."""
    raw = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=raw, mode="w") as tar:
        made: set[str] = set()
        for path, data, mode in files:
            folder = path.rsplit("/", 1)[0] if "/" in path else ""
            if folder.count("/") >= 1 and folder not in made:  # e.g. tmp/kairo-in (never tmp itself)
                info = tarfile.TarInfo(name=folder)
                info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o755, now
                tar.addfile(info)
                made.add(folder)
            info = tarfile.TarInfo(name=path)
            info.size, info.mode, info.mtime = len(data), mode, now
            tar.addfile(info, io.BytesIO(data))
    return gzip.compress(raw.getvalue(), compresslevel=6)


def job_tarball(path: str, data: bytes) -> bytes:
    """A gzipped tarball holding one job file."""
    return tarball([(path, data, 0o600)])


class VercelSandboxRunner:
    """Same interface as RunnerClient: run(job, on_progress) -> JobResult, health(), aclose()."""

    def __init__(self, sandbox_name: str, images: Iterable[str], executor: Path | bytes | None = None,
                 oidc: OidcToken = OIDC, transport: httpx.AsyncBaseTransport | None = None,
                 api_base: str = API_BASE, busy_patience_s: float = BUSY_PATIENCE_S) -> None:
        self.sandbox_name = sandbox_name
        self.images = list(images)
        self.oidc = oidc
        self.busy_patience_s = busy_patience_s
        if isinstance(executor, Path):
            try:
                executor = executor.read_bytes()
            except OSError as exc:
                log.error("the runner VM's executor is missing (%s); code cannot run", exc)
                executor = None
        self._executor: bytes | None = executor
        self._http = httpx.AsyncClient(base_url=api_base, transport=transport, trust_env=False,
                                       timeout=httpx.Timeout(30.0, connect=10.0))
        self._session_id: str | None = None
        self._expires_at = 0.0  # unix seconds
        self._installed: set[str] = set()  # sessions this process installed the executor in
        self._lock = anyio.Lock()

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ health

    async def health(self, max_age_s: float = 5.0) -> dict | None:
        """The images the snapshot holds. Answered without waking the VM: it starts on demand."""
        if self._executor is None:
            return {"status": "error", "backend": "vercel-sandbox", "images": {}}
        return {"status": "ok", "backend": "vercel-sandbox",
                "images": {image: "vercel-sandbox" for image in self.images}}

    async def keepalive(self) -> dict:
        """Wake the VM once: starting a session from the snapshot keeps the snapshot from
        expiring (snapshots expire 7 days after their last use). The session stops by itself."""
        _, project, _ = self.oidc.credentials()
        data = await self._request("GET", f"/v2/sandboxes/{self.sandbox_name}",
                                   params={"projectId": project, "resume": "true"})
        session = data.get("session") or {}
        return {"status": "ok", "session": session.get("status"), "resumed": data.get("resumed")}

    # ------------------------------------------------------------------- jobs

    async def run(self, job: JobSpec, on_progress: ProgressCallback) -> JobResult:
        if self._executor is None:
            raise RunnerUnavailable("the runner VM's executor (kairo_exec.py) is missing from this deployment")
        wall_s = sum(step.limits.wall_time_ms for step in job.steps) / 1000
        needed_s = wall_s + 30
        payload = job.model_dump_json(by_alias=True).encode("utf-8")
        give_up_at = time.monotonic() + self.busy_patience_s
        restarted = False
        while True:
            session_id = await self._session(needed_s)
            try:
                files = [(f"{INBOX}/{job.job_id}.json", payload, 0o600)]
                fresh = session_id not in self._installed
                if fresh:
                    files.append((UPLOAD, self._executor, 0o644))
                await self._write(session_id, files)
                if fresh:
                    await self._install(session_id)
                return await self._execute(session_id, job, on_progress, wall_s)
            except SandboxApiError as exc:
                if not restarted and exc.status in (404, 409, 410, 422):
                    log.info("sandbox session %s is gone (%s); starting a new one", session_id, exc)
                    self._forget(session_id)
                    restarted = True
                    continue
                raise RunnerUnavailable(str(exc)) from exc
            except RunnerBusy as exc:
                # Every slot of the VM is taken (other students' programs): wait briefly.
                if time.monotonic() + min(exc.retry_after_s, 2) > give_up_at:
                    raise
                await anyio.sleep(min(max(exc.retry_after_s, 0.5), 2.0))

    async def _install(self, session_id: str) -> None:
        """Install the uploaded executor as a root-owned file (once per session and process)."""
        code, _, err = await self._command(
            session_id, "/usr/bin/install",
            ["-D", "-o", "root", "-g", "root", "-m", "0755", f"/{UPLOAD}", EXECUTOR], sudo=True, timeout_ms=30_000)
        if code != 0:
            raise RunnerUnavailable(f"could not install the executor in the runner VM (exit {code}): {err[-300:]}")
        self._installed.add(session_id)

    async def _command(self, session_id: str, command: str, args: list[str], *, sudo: bool,
                       timeout_ms: int) -> tuple[int | None, str, str]:
        """Run a short command to completion: (exit code, stdout, stderr)."""
        token, _, team = self.oidc.credentials()
        body = {"command": command, "args": args, "cwd": "/", "env": {}, "sudo": sudo,
                "wait": True, "logs": True, "timeout": timeout_ms}
        out: list[str] = []
        err: list[str] = []
        code: int | None = None
        try:
            async with self._http.stream(
                "POST", f"/v2/sandboxes/sessions/{session_id}/cmd",
                params={"teamId": team, "wait": "true", "logs": "true"}, json=body,
                headers={"authorization": f"Bearer {token}"},
                timeout=httpx.Timeout(30.0, connect=10.0, read=timeout_ms / 1000 + 15),
            ) as response:
                if response.status_code != 200:
                    raise SandboxApiError(response.status_code, (await response.aread()).decode("utf-8", "replace")[:300])
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    stream, data = record.get("stream"), record.get("data")
                    if stream == "stdout" and isinstance(data, str):
                        out.append(data)
                    elif stream == "stderr" and isinstance(data, str):
                        err.append(data)
                    elif stream == "error":
                        raise RunnerError(f"sandbox stream error: {(data or {}).get('message', data)}")
                    command_record = record.get("command")
                    if isinstance(command_record, dict) and isinstance(command_record.get("exitCode"), int):
                        code = command_record["exitCode"]
        except httpx.TransportError as exc:
            raise RunnerUnavailable(f"lost the connection to the code runner: {exc!r}") from exc
        return code, "".join(out), "".join(err)

    async def _execute(self, session_id: str, job: JobSpec, on_progress: ProgressCallback, wall_s: float) -> JobResult:
        body = {
            "command": PYTHON,
            "args": ["-I", "-S", EXECUTOR, "run", f"/{INBOX}/{job.job_id}.json"],
            "cwd": "/",
            "env": {},
            "sudo": True,
            "wait": True,
            "logs": True,
            "timeout": int((wall_s + 60) * 1000),  # the VM kills the executor after this
        }
        token, _, team = self.oidc.credentials()
        timeout = httpx.Timeout(30.0, connect=10.0, read=max(step.limits.wall_time_ms for step in job.steps) / 1000 + 30)
        pending = ""
        stderr: list[str] = []
        try:
            async with self._http.stream(
                "POST", f"/v2/sandboxes/sessions/{session_id}/cmd",
                params={"teamId": team, "wait": "true", "logs": "true"}, json=body,
                headers={"authorization": f"Bearer {token}"}, timeout=timeout,
            ) as response:
                if response.status_code != 200:
                    raise SandboxApiError(response.status_code, (await response.aread()).decode("utf-8", "replace")[:300])
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    record = json.loads(line)
                    stream = record.get("stream")
                    if stream == "stdout" and isinstance(record.get("data"), str):
                        pending += record["data"]
                        while "\n" in pending:
                            event_line, pending = pending.split("\n", 1)
                            result = await self._event(event_line, on_progress)
                            if result is not None:
                                return result
                    elif stream == "stderr" and isinstance(record.get("data"), str):
                        stderr.append(record["data"])
                    elif stream == "error":
                        data = record.get("data") or {}
                        raise RunnerError(f"sandbox stream error: {data.get('message', data)}")
        except httpx.TransportError as exc:
            raise RunnerUnavailable(f"lost the connection to the code runner: {exc!r}") from exc
        if pending.strip():
            result = await self._event(pending, on_progress)
            if result is not None:
                return result
        tail = "".join(stderr)[-500:]
        raise RunnerError(f"the code runner stopped before the job finished. {tail}".strip())

    @staticmethod
    async def _event(line: str, on_progress: ProgressCallback) -> JobResult | None:
        if not line.strip():
            return None
        raw = json.loads(line)
        if raw.get("type") == "busy":
            raise RunnerBusy(int(raw.get("retryAfterS", 2)))
        event = JobEvent.model_validate(raw)
        if event.type == "job_finished":
            if event.result is None:
                raise RunnerError("the code runner sent job_finished without a result")
            return event.result
        await on_progress(event)
        return None

    # ------------------------------------------------------------- sandbox API

    async def _request(self, method: str, path: str, *, params: dict | None = None, **kwargs) -> dict:
        token, _, team = self.oidc.credentials()
        headers = {"authorization": f"Bearer {token}", **kwargs.pop("headers", {})}
        try:
            response = await self._http.request(method, path, params={"teamId": team, **(params or {})},
                                                headers=headers, **kwargs)
        except httpx.TransportError as exc:
            raise RunnerUnavailable(f"Vercel Sandbox API not reachable: {exc!r}") from exc
        if response.status_code >= 400:
            raise SandboxApiError(response.status_code, response.text[:300])
        try:
            data = response.json()
        except ValueError:
            data = {}
        return data if isinstance(data, dict) else {}

    async def _write(self, session_id: str, files: list[tuple[str, bytes, int]]) -> None:
        await self._request("POST", f"/v2/sandboxes/sessions/{session_id}/fs/write", content=tarball(files),
                            headers={"content-type": "application/gzip", "x-cwd": "/"})

    def _remember(self, session: dict) -> None:
        started, timeout = session.get("startedAt"), session.get("timeout")
        self._session_id = session.get("id")
        if isinstance(started, (int, float)) and isinstance(timeout, (int, float)):
            self._expires_at = (started + timeout) / 1000
        else:
            self._expires_at = time.time() + 60  # unknown: assume a minute and check again

    def _forget(self, session_id: str) -> None:
        self._installed.discard(session_id)
        if self._session_id == session_id:
            self._session_id, self._expires_at = None, 0.0

    async def _session(self, needed_s: float) -> str:
        """A running session with at least needed_s seconds left (extended or restarted if not)."""
        async with self._lock:
            now = time.time()
            if self._session_id and self._expires_at - now > needed_s:
                return self._session_id
            if self._session_id and self._expires_at - now > 5:
                try:
                    data = await self._request("POST", f"/v2/sandboxes/sessions/{self._session_id}/extend-timeout",
                                               json={"duration": SESSION_EXTEND_MS})
                    self._remember(data.get("session") or {})
                    if self._session_id and self._expires_at - time.time() > needed_s:
                        return self._session_id
                except SandboxApiError as exc:
                    log.info("could not extend sandbox session: %s", exc)
            _, project, _ = self.oidc.credentials()
            for _ in range(30):
                data = await self._request("GET", f"/v2/sandboxes/{self.sandbox_name}",
                                           params={"projectId": project, "resume": "true"})
                session = data.get("session") or {}
                status = session.get("status")
                if status == "running":
                    self._remember(session)
                    left = self._expires_at - time.time()
                    if left > needed_s:
                        return self._session_id  # type: ignore[return-value]
                    try:  # still up but too close to its end: extend, else replace it
                        data = await self._request("POST", f"/v2/sandboxes/sessions/{session['id']}/extend-timeout",
                                                   json={"duration": SESSION_EXTEND_MS})
                        self._remember(data.get("session") or session)
                        if self._expires_at - time.time() > needed_s:
                            return self._session_id  # type: ignore[return-value]
                    except SandboxApiError:
                        pass
                    # It reached the longest session the plan allows: start a fresh one.
                    await self._request("POST", f"/v2/sandboxes/sessions/{session['id']}/stop", json={})
                    self._forget(session["id"])
                elif status in ("failed", "aborted"):
                    raise RunnerUnavailable(f"the code runner VM failed to start ({status})")
                await anyio.sleep(1.0)  # pending, stopping or snapshotting: ask again
            raise RunnerUnavailable("the code runner VM did not start in time")
