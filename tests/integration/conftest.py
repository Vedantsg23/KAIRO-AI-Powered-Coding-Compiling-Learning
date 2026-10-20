"""Integration tests: real language profiles -> real sandbox -> real diagnostics.

These tests run student-style programs through the production path minus
HTTP: the API's language profiles build the job, the runner's Sandbox runs it
in Docker (same images, argv and limits as production), and the API's
diagnostics pipeline and final-state rules interpret the result.

They need Docker (otherwise they skip) and the sandbox images (`make images`);
a language whose image is not built is skipped. Every job is first checked
against the runner's production policy (image allow-list, limit ceilings).
Run from the repository root:  .venv/bin/pytest tests/integration -q

The same suite also runs against the Docker-free executor used on Vercel
(infra/vercel/runner/kairo_exec.py), inside the runner VM, as root:
    KAIRO_EXECUTOR=/opt/kairo/sbin/kairo_exec.py pytest tests/integration -q
"""

from __future__ import annotations

import itertools
import json
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "services" / "api"), str(ROOT / "services" / "runner")]

from app.adapters.registry import LanguageRegistry
from app.analysis.pipeline import diagnose
from app.schemas.runner import JobResult as ApiJobResult
from app.services.executions import final_state
from runner.config import RunnerSettings
from runner.jobspec import JobResult, JobSpec
from runner.policy import check_job

# Path of kairo_exec.py to run jobs with instead of Docker (see the module docstring).
EXECUTOR = os.environ.get("KAIRO_EXECUTOR", "")

REGISTRY = LanguageRegistry.from_directory()
_ids = itertools.count(1)


@dataclass
class Outcome:
    state: str
    diagnostics: list
    steps: dict  # step name -> runner StepResult
    seconds: float

    @property
    def codes(self) -> list[str]:
        return [d.code for d in self.diagnostics]

    def stdout(self, step: str = "run") -> str:
        return self.steps[step].stdout if step in self.steps else ""


@pytest.fixture(scope="session")
def docker_client():
    if EXECUTOR:
        yield None
        return
    try:
        import docker

        client = docker.from_env()
        client.ping()
    except Exception as exc:  # noqa: BLE001 - no daemon or no socket access
        pytest.skip(f"Docker is not available: {exc}")
    yield client


class _ExecutorSandbox:
    """Runs a job with kairo_exec.py and reads its NDJSON answer, like the API's Vercel client."""

    def __init__(self, path: str) -> None:
        self.path = path
        report = subprocess.run([sys.executable, "-I", "-S", path, "health"], capture_output=True, text=True,
                                check=True)
        self.images = {name for name, image_id in json.loads(report.stdout)["images"].items() if image_id}

    def run_job(self, job: JobSpec) -> JobResult:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write(job.model_dump_json(by_alias=True))
        done = subprocess.run([sys.executable, "-I", "-S", self.path, "run", fh.name], capture_output=True,
                              text=True, timeout=300, check=False)
        for line in done.stdout.splitlines():
            event = json.loads(line)
            if event.get("type") == "job_finished":
                return JobResult.model_validate(event["result"])
        raise RuntimeError(f"executor answered without a result (exit {done.returncode}): "
                           f"{done.stdout[-500:]} {done.stderr[-500:]}")


@pytest.fixture(scope="session")
def execute(docker_client):
    settings = RunnerSettings()
    if EXECUTOR:
        sandbox = _ExecutorSandbox(EXECUTOR)
        built = {image: image in sandbox.images for image in settings.allowed_images}
    else:
        from runner.sandbox import Sandbox

        sandbox = Sandbox(docker_client, settings)
        built: dict[str, bool] = {}

    def run(language: str, source: str, stdin: str = "") -> Outcome:
        profile = REGISTRY.get(language)
        image = profile.toolchain.image
        if image not in built and EXECUTOR:
            built[image] = False  # not in the executor's snapshot
        if image not in built:
            import docker

            try:
                docker_client.images.get(image)
                built[image] = True
            except docker.errors.ImageNotFound:
                built[image] = False
        if not built.get(image):
            pytest.skip(f"sandbox image {image} is not built (make images)")
        job = JobSpec.model_validate({
            "jobId": f"it-{language}-{next(_ids)}-{int(time.time())}",
            "image": image,
            "files": [{"path": profile.source_file, "content": source}],
            "steps": [{
                "name": s.name, "argv": list(s.argv), "workdir": s.workdir, "workspaceMode": s.workspace_mode,
                "env": dict(s.env), "stdin": stdin if s.stdin else None,
                "limits": {"wallTimeMs": s.limits.wall_time_ms, "cpuTimeS": s.limits.cpu_time_s,
                           "memoryMb": s.limits.memory_mb, "pids": s.limits.pids,
                           "outputKb": s.limits.output_kb, "tmpMb": s.limits.tmp_mb,
                           "fileSizeMb": s.limits.file_size_mb},
            } for s in profile.steps],
        })
        check_job(job, settings)  # the production runner refuses anything outside its policy
        started = time.monotonic()
        result = sandbox.run_job(job)
        seconds = time.monotonic() - started
        api_result = ApiJobResult.model_validate(result.model_dump(mode="json", by_alias=True))
        diagnostics = diagnose(profile, "exe_it", {profile.source_file: source}, api_result)
        state = final_state(api_result, {s.name: s.kind for s in profile.steps}).value
        return Outcome(state, diagnostics, {s.name: s for s in result.steps}, seconds)

    return run


@pytest.fixture(scope="session", autouse=True)
def nothing_left_behind():
    """After the whole session: no sandbox container or volume of these tests may remain."""
    yield
    if EXECUTOR:
        return  # no Docker objects; the executor removes its own cgroups and workspaces
    from runner.sandbox import LABEL_JOB, LABEL_MANAGED

    try:
        import docker

        client = docker.from_env()
        objects = client.containers.list(all=True, filters={"label": f"{LABEL_MANAGED}=1"}) + \
            client.volumes.list(filters={"label": f"{LABEL_MANAGED}=1"})
    except Exception:  # noqa: BLE001
        return  # no Docker: the tests skipped anyway
    ours = [o for o in objects if (o.attrs.get("Labels") or o.attrs.get("Config", {}).get("Labels") or {})
            .get(LABEL_JOB, "").startswith("it-")]
    assert not ours, f"sandbox objects left behind: {[getattr(o, 'name', o.id) for o in ours]}"
