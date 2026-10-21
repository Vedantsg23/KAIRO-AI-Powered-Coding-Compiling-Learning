"""Runs one job inside locked-down, throw-away Docker containers.

Lifecycle of a job (every step is visible with `docker ps -a` / `docker volume ls`
while it runs, and everything is removed afterwards):

1. Create a per-job named volume (the workspace) labelled as ours.
2. Copy the source files into it through a *seed* container that is created
   but never started, so no code runs during the copy.
3. For each step (e.g. compile, then run) create a fresh container with the
   hardening options below, attach to its stdin/stdout/stderr, start it,
   enforce the wall-clock and output limits, wait, and record the outcome.
   Stop after the first step that does not exit with status 0.
4. Remove every container and the volume, whatever happened (finally blocks).

Hardening applied to every step container (not configurable by the job):
  network_mode=none, read-only root filesystem, all capabilities dropped,
  no-new-privileges, fixed non-root UID/GID, memory limit with swap disabled,
  CPU quota, PID limit, RLIMIT_CPU/FSIZE/CORE/NOFILE, size-limited /tmp tmpfs,
  tini as PID 1 (init=True) so signals behave normally, no log files.
Docker's default seccomp and AppArmor profiles stay enabled. See
docs/threat-model.md for what this does and does not protect against.
"""

from __future__ import annotations

import io
import json
import logging
import re
import secrets
import select
import signal as signals
import socket
import tarfile
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

import docker
from docker.types import LogConfig, Ulimit

from .config import RunnerSettings
from .jobspec import JobEvent, JobResult, JobSpec, StepResult, StepSpec, Termination, ToolchainInfo

log = logging.getLogger("runner.sandbox")

LABEL_MANAGED = "org.compiler-copilot.managed"
LABEL_JOB = "org.compiler-copilot.job"
LABEL_STEP = "org.compiler-copilot.step"
WORKSPACE = "/workspace"
TOOLCHAIN_FILE = "/etc/compiler-copilot/toolchain.json"
MB = 1024 * 1024
BASE_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "HOME": "/tmp",
    "LANG": "C.UTF-8",
}

# Docker multiplexes stdout/stderr on one connection when tty=False:
# 8-byte header = [stream id, 0, 0, 0, size (big-endian uint32)] + payload.
_STDOUT, _STDERR = 1, 2


@dataclass
class _Captured:
    stdout: bytearray = field(default_factory=bytearray)
    stderr: bytearray = field(default_factory=bytearray)
    stdout_truncated: bool = False
    stderr_truncated: bool = False
    stop_reason: Termination | None = None  # TIMEOUT or OUTPUT_LIMIT when we had to kill it


class Sandbox:
    def __init__(self, client: docker.DockerClient, settings: RunnerSettings) -> None:
        self.client = client
        self.settings = settings
        self._toolchains: dict[str, ToolchainInfo | None] = {}
        self._toolchain_lock = threading.Lock()

    # ------------------------------------------------------------------ job

    def run_job(self, job: JobSpec, on_event: Callable[[JobEvent], None] | None = None) -> JobResult:
        """Run all steps of a job. Always returns a JobResult; never raises."""
        emit = on_event or (lambda event: None)
        steps: list[StepResult] = []
        toolchain: ToolchainInfo | None = None
        image_id = ""
        volume = None
        try:
            try:
                image = self.client.images.get(job.image)
            except docker.errors.ImageNotFound:
                return JobResult(
                    job_id=job.job_id, image=job.image, image_id="", steps=[],
                    error=f"sandbox image {job.image!r} is not built on this host "
                          f"(see README: build the images in infra/containers)",
                )
            image_id = image.id
            suffix = secrets.token_hex(4)
            labels = {LABEL_MANAGED: "1", LABEL_JOB: job.job_id}
            volume = self.client.volumes.create(name=f"cc-ws-{job.job_id}-{suffix}", labels=labels)
            toolchain = self._seed_workspace(image, volume.name, job, labels)
            for step in job.steps:
                emit(JobEvent(type="step_started", job_id=job.job_id, step=step.name))
                result = self._run_step(image, volume.name, step, labels, f"{job.job_id}-{suffix}")
                steps.append(result)
                emit(JobEvent(type="step_finished", job_id=job.job_id, step=step.name,
                              termination=result.termination, exit_code=result.exit_code))
                if result.termination is not Termination.EXITED or result.exit_code != 0:
                    break
            return JobResult(job_id=job.job_id, image=job.image, image_id=image_id,
                             toolchain=toolchain, steps=steps)
        except Exception as exc:  # report, never crash the worker
            log.exception("job %s failed inside the runner", job.job_id)
            return JobResult(job_id=job.job_id, image=job.image, image_id=image_id,
                             toolchain=toolchain, steps=steps, error=f"runner error: {exc}")
        finally:
            if volume is not None:
                _remove_volume(volume)

    # ------------------------------------------------------------ workspace

    def _seed_workspace(self, image, volume_name: str, job: JobSpec, labels: dict) -> ToolchainInfo | None:
        """Copy the job's files into the volume without running anything."""
        archive = _tar_files(job, self.settings.sandbox_uid, self.settings.sandbox_gid)
        seed = self.client.containers.create(
            image.id,
            command=["true"],  # never started
            network_mode="none",
            user=f"{self.settings.sandbox_uid}:{self.settings.sandbox_gid}",
            volumes={volume_name: {"bind": WORKSPACE, "mode": "rw"}},
            labels={**labels, LABEL_STEP: "seed"},
        )
        try:
            if not seed.put_archive(WORKSPACE, archive):
                raise RuntimeError("could not copy the source files into the workspace")
            return self._toolchain(image.id, seed)
        finally:
            seed.remove(force=True)

    def _toolchain(self, image_id: str, container) -> ToolchainInfo | None:
        """Read /etc/compiler-copilot/toolchain.json once per image ID."""
        with self._toolchain_lock:
            if image_id in self._toolchains:
                return self._toolchains[image_id]
        info: ToolchainInfo | None = None
        try:
            stream, _ = container.get_archive(TOOLCHAIN_FILE)
            with tarfile.open(fileobj=io.BytesIO(b"".join(stream))) as tar:
                member = tar.getmembers()[0]
                data = tar.extractfile(member).read()  # type: ignore[union-attr]
            info = ToolchainInfo.model_validate(json.loads(data))
        except Exception:  # noqa: BLE001 - image without metadata: version unknown
            log.warning("image %s has no readable %s", image_id[:19], TOOLCHAIN_FILE)
        with self._toolchain_lock:
            self._toolchains[image_id] = info
        return info

    # ----------------------------------------------------------------- step

    def _run_step(self, image, volume_name: str, step: StepSpec, labels: dict, tag: str) -> StepResult:
        lim = step.limits
        s = self.settings
        api = self.client.api  # low-level API for full control over the config
        host_config = api.create_host_config(
            binds={volume_name: {"bind": WORKSPACE, "mode": step.workspace_mode}},
            network_mode="none",
            read_only=True,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            mem_limit=f"{lim.memory_mb}m",
            memswap_limit=f"{lim.memory_mb}m",
            nano_cpus=int(s.cpus_per_step * 1_000_000_000),
            pids_limit=lim.pids,
            ulimits=[
                Ulimit(name="cpu", soft=lim.cpu_time_s, hard=lim.cpu_time_s + 1),
                Ulimit(name="fsize", soft=lim.file_size_mb * MB, hard=lim.file_size_mb * MB),
                Ulimit(name="core", soft=0, hard=0),
                Ulimit(name="nofile", soft=256, hard=256),
            ],
            tmpfs={"/tmp": f"rw,nosuid,nodev,noexec,size={lim.tmp_mb}m,mode=1777"},
            init=True,  # tini as PID 1: normal signal semantics, zombies reaped
            log_config=LogConfig(type=LogConfig.types.NONE),  # nothing written to disk
        )
        created = api.create_container(
            image.id,
            command=step.argv,  # argument array: no shell, no string interpolation
            name=f"cc-{tag}-{step.name}",
            working_dir=step.workdir,
            user=f"{s.sandbox_uid}:{s.sandbox_gid}",
            environment={**BASE_ENV, **step.env},
            hostname="sandbox",
            volumes=[WORKSPACE],
            # stdin_open with detach=False makes docker-py set StdinOnce=true:
            # when we half-close our stdin stream, the program sees end-of-file.
            stdin_open=True,
            detach=False,
            tty=False,
            labels={**labels, LABEL_STEP: step.name},
            host_config=host_config,
        )
        container = self.client.containers.get(created["Id"])
        sock = None
        try:
            # Attach BEFORE start so no output is lost (log driver is "none").
            sock = self.client.api.attach_socket(
                container.id, params={"stdin": 1, "stdout": 1, "stderr": 1, "stream": 1}
            )
            raw: socket.socket = sock._sock
            requested = time.monotonic()
            container.start()
            # The limit starts once the container is running, so Docker's own
            # start-up time is not charged to the student's program.
            deadline = time.monotonic() + lim.wall_time_ms / 1000
            feeder = threading.Thread(
                target=_feed_stdin, args=(raw, (step.stdin or "").encode("utf-8")), daemon=True
            )
            feeder.start()

            captured = _collect(raw, deadline=deadline, cap=lim.output_kb * 1024)
            if captured.stop_reason is not None:
                # Close our end first: if we stop reading while the program is
                # still printing, Docker's stream copier blocks on the full
                # socket and the kill/wait calls below would hang with it.
                _close_quietly(sock)
                sock = None
                _kill_quietly(container)
            # Output can end before the process does (it may close stdout and
            # stderr and keep running), so the wall-clock limit applies here too.
            exit_code, overran = _wait_for_exit(container, deadline)
            if overran and captured.stop_reason is None:
                captured.stop_reason = Termination.TIMEOUT
            wall_ms = int((time.monotonic() - requested) * 1000)

            container.reload()
            state = _settle_oom_flag(container, container.attrs.get("State", {}), exit_code, captured)
            return _step_result(step.name, exit_code, state, captured, wall_ms)
        finally:
            if sock is not None:
                _close_quietly(sock)
            try:
                container.remove(force=True)
            except docker.errors.APIError:
                log.warning("could not remove container %s; the reaper will retry", container.id[:12])


# ---------------------------------------------------------------- helpers


def _tar_files(job: JobSpec, uid: int, gid: int) -> bytes:
    buffer = io.BytesIO()
    now = int(time.time())
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        for f in job.files:
            data = f.content.encode("utf-8")
            info = tarfile.TarInfo(name=f.path)
            info.size, info.mode, info.mtime = len(data), 0o644, now
            info.uid, info.gid, info.uname, info.gname = uid, gid, "sandbox", "sandbox"
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def _feed_stdin(raw: socket.socket, data: bytes) -> None:
    """Send the program's input, then half-close so it sees end-of-file."""
    try:
        if data:
            raw.sendall(data)
    except OSError:
        pass  # the program exited without reading all of its input
    finally:
        try:
            raw.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def _collect(raw: socket.socket, deadline: float, cap: int) -> _Captured:
    """Read multiplexed output until EOF, the deadline, or the output cap."""
    got = _Captured()
    pending = bytearray()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            got.stop_reason = Termination.TIMEOUT
            return got
        ready, _, _ = select.select([raw], [], [], min(remaining, 0.25))
        if not ready:
            continue
        try:
            chunk = raw.recv(65536)
        except OSError:
            chunk = b""
        if not chunk:
            return got  # all output streams closed: the process tree has ended
        pending += chunk
        while len(pending) >= 8:
            size = int.from_bytes(pending[4:8], "big")
            if len(pending) < 8 + size:
                break
            stream, payload = pending[0], bytes(pending[8:8 + size])
            del pending[:8 + size]
            if stream == _STDOUT:
                buf, attr = got.stdout, "stdout_truncated"
            elif stream == _STDERR:
                buf, attr = got.stderr, "stderr_truncated"
            else:
                continue
            room = cap - len(buf)
            if len(payload) > room:
                buf += payload[:max(room, 0)]
                setattr(got, attr, True)
                got.stop_reason = Termination.OUTPUT_LIMIT
                return got
            buf += payload


def _close_quietly(sock) -> None:
    try:
        sock._sock.shutdown(socket.SHUT_RDWR)
    except (OSError, AttributeError):
        pass
    try:
        sock.close()
    except OSError:
        pass


def _kill_quietly(container) -> None:
    try:
        container.kill()
    except docker.errors.APIError:
        pass  # already exited


# Docker learns about an out-of-memory kill from an event of its own, and that
# event can arrive a moment after the exit: inspected straight away, a program
# the kernel killed at the memory limit may still show OOMKilled=false (seen on
# GitHub's runners, for Go and Pascal memory hogs). A step that died of SIGKILL
# without the runner killing it (no timeout, no output limit) is therefore
# inspected again for a short while before it is reported as merely "killed".
OOM_SETTLE_S = 1.0
_OOM_POLL_S = 0.05


def _settle_oom_flag(container, state: dict, exit_code: int | None, captured: _Captured) -> dict:
    """The container's final state, once Docker has had a moment to record an OOM kill."""
    if state.get("OOMKilled") or captured.stop_reason is not None or exit_code != 128 + signals.SIGKILL:
        return state
    deadline = time.monotonic() + OOM_SETTLE_S
    while time.monotonic() < deadline:
        time.sleep(_OOM_POLL_S)
        try:
            container.reload()
        except docker.errors.APIError:
            break
        state = container.attrs.get("State", {})
        if state.get("OOMKilled"):
            break
    return state


def _wait_for_exit(container, deadline: float) -> tuple[int | None, bool]:
    """(exit status, whether we had to kill it because the deadline passed)."""
    grace_s = 2.0
    try:
        remaining = max(deadline - time.monotonic(), 0.0) + grace_s
        return container.wait(timeout=remaining).get("StatusCode"), False
    except Exception:  # noqa: BLE001 - still running at the deadline (requests timeout)
        _kill_quietly(container)
    try:
        return container.wait(timeout=10).get("StatusCode"), True
    except Exception:  # noqa: BLE001 - cleanup continues whatever failed
        return None, True


_TIMESTAMP = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?"
)


def _parse_docker_time(value: str | None) -> datetime | None:
    """Parse Docker's RFC 3339 timestamps (nanoseconds, 'Z' or +hh:mm offset)."""
    match = _TIMESTAMP.match((value or "").strip())
    if not match or match.group(1).startswith("0001-"):
        return None  # missing, or Docker's "zero time" for never-started containers
    day, clock, frac, tz = match.groups()
    frac = ((frac or "") + "000000")[:6]  # Python supports microseconds only
    if tz in (None, "Z"):
        tz = "+00:00"
    elif ":" not in tz:
        tz = f"{tz[:3]}:{tz[3:]}"
    try:
        return datetime.fromisoformat(f"{day}T{clock}.{frac}{tz}")
    except ValueError:
        return None


def _step_result(name: str, exit_code: int | None, state: dict, captured: _Captured, wall_ms: int) -> StepResult:
    oom = bool(state.get("OOMKilled"))
    sig: int | None = None
    if captured.stop_reason is not None:
        termination = captured.stop_reason
    elif oom:
        termination = Termination.MEMORY_LIMIT
    elif exit_code is None:
        termination = Termination.INTERNAL_ERROR
    elif 128 < exit_code <= 128 + 64:
        # tini (PID 1) reports "killed by signal N" as exit status 128+N.
        sig = exit_code - 128
        termination = Termination.TIMEOUT if sig == signals.SIGXCPU else Termination.SIGNALED
    else:
        termination = Termination.EXITED

    started = _parse_docker_time(state.get("StartedAt"))
    finished = _parse_docker_time(state.get("FinishedAt"))
    duration_ms = int((finished - started).total_seconds() * 1000) if started and finished else None

    return StepResult(
        name=name,
        termination=termination,
        exit_code=exit_code,
        signal=sig,
        duration_ms=duration_ms,
        wall_ms=wall_ms,
        stdout=captured.stdout.decode("utf-8", errors="replace"),
        stderr=captured.stderr.decode("utf-8", errors="replace"),
        stdout_truncated=captured.stdout_truncated,
        stderr_truncated=captured.stderr_truncated,
        oom_killed=oom,
    )


def _remove_volume(volume) -> None:
    for attempt in range(5):
        try:
            volume.remove(force=True)
            return
        except docker.errors.NotFound:
            return
        except docker.errors.APIError:
            time.sleep(0.2 * (attempt + 1))  # a container may still be releasing it
    log.warning("could not remove volume %s; the reaper will retry", volume.name)


# ----------------------------------------------------------------- reaper


def reap_orphans(client: docker.DockerClient, max_age_s: int) -> int:
    """Remove our containers/volumes older than max_age_s. Returns how many.

    Only objects carrying our label AND a parseable creation time older than
    the threshold are touched, so jobs that are still running are never hit.
    """
    removed = 0
    now = time.time()
    for c in client.containers.list(all=True, filters={"label": f"{LABEL_MANAGED}=1"}):
        created = _parse_docker_time(c.attrs.get("Created"))
        if created is not None and now - created.timestamp() > max_age_s:
            try:
                c.remove(force=True)
                removed += 1
            except docker.errors.APIError:
                pass
    for v in client.volumes.list(filters={"label": f"{LABEL_MANAGED}=1"}):
        created = _parse_docker_time(v.attrs.get("CreatedAt"))
        if created is not None and now - created.timestamp() > max_age_s:
            try:
                v.remove(force=True)
                removed += 1
            except docker.errors.APIError:
                pass
    return removed
