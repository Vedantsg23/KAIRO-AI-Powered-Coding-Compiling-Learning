from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from ..domain.execution import ExecutionState, StepStatus
from .common import ApiModel
from .diagnostics import Diagnostic


class ExecutionCreate(ApiModel):
    language_id: str = Field(min_length=1, max_length=32, examples=["c"])
    source: str = Field(description="Exact editor contents; its SHA-256 identifies this snapshot.")
    stdin: str = Field(default="", description="Text given to the program on standard input.")


class StepLimitsOut(ApiModel):
    wall_time_ms: int
    memory_mb: int
    output_kb: int


class ExecutionStepOut(ApiModel):
    name: str
    kind: Literal["compile", "run"]
    status: StepStatus
    termination: str | None = None
    exit_code: int | None = None
    signal: int | None = None
    signal_name: str | None = None
    duration_ms: int | None = None
    wall_ms: int | None = None
    stdout: str = ""
    stderr: str = ""
    stdout_truncated: bool = False
    stderr_truncated: bool = False
    peak_memory_bytes: int | None = None
    limits: StepLimitsOut


class ToolchainOut(ApiModel):
    name: str
    version: str | None = Field(description="Exact version read from the sandbox image; null if unknown.")
    image: str
    image_id: str | None = None


class ExecutionOut(ApiModel):
    id: str
    language_id: str
    state: ExecutionState
    terminal: bool
    summary: str = Field(description="One-line, plain-language status for the UI.")
    source_hash: str = Field(description="sha256:<hex> of the exact source that was (or will be) compiled.")
    source_bytes: int
    queue_position: int | None = Field(default=None, description="1-based position while QUEUED.")
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    toolchain: ToolchainOut | None = None
    steps: list[ExecutionStepOut]
    diagnostics: list[Diagnostic]
    error: str | None = None
    evidence: str | None = Field(
        default=None, description="Sealed copy of the finished run (terminal snapshots only); send it with "
                                  "Saarthi requests about this run.")


class ErrorOut(ApiModel):
    detail: str
    retry_after_s: int | None = None
