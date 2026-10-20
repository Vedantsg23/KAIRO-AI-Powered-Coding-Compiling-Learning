"""Public contract of Saarthi, the AI assistant (/api/v1/assistant/...)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .common import ApiModel

Confidence = Literal["low", "medium", "high"]
SOURCE_HASH = r"^sha256:[0-9a-f]{64}$"
EVIDENCE_MAX = 3_000_000
EVIDENCE_HELP = ("The run's sealed evidence from its final snapshot; lets any server instance answer "
                 "about a run it did not execute. The server checks the seal.")


class AssistantStatusOut(ApiModel):
    enabled: bool = Field(description="False when no AI provider is configured; the rest of the app still works.")
    provider: str | None = None
    model: str | None = None
    reason: str | None = Field(default=None, description="Why Saarthi is unavailable, in plain words.")
    requests_per_minute: int
    requests_per_day: int


class ExplainIn(ApiModel):
    execution_id: str = Field(max_length=64)
    source_hash: str = Field(pattern=SOURCE_HASH,
                             description="Hash of the code in the editor; must match the run (no stale answers).")
    diagnostic_id: str | None = Field(default=None, max_length=128,
                                      description="Diagnostic to explain; default: the first error.")
    question: str | None = Field(default=None, max_length=500)
    evidence: str | None = Field(default=None, max_length=EVIDENCE_MAX, description=EVIDENCE_HELP)


class CodeLocationOut(ApiModel):
    line: int = Field(ge=1)


class ExplanationOut(ApiModel):
    execution_id: str
    source_hash: str = Field(description="The explanation applies to exactly this source.")
    focus_diagnostic_id: str | None
    diagnostic_ids: list[str] = Field(description="The diagnostics Saarthi was shown (its evidence).")
    problem: str
    what_happened: str
    why: str
    location: CodeLocationOut | None
    suggested_fix: str
    related_concepts: list[str]
    confidence: Confidence
    verified: Literal[False] = Field(default=False, description="Explanations are advice; only a run verifies code.")
    provider: str
    model: str
    cached: bool = False


class FixIn(ApiModel):
    execution_id: str = Field(max_length=64)
    source_hash: str = Field(pattern=SOURCE_HASH)
    diagnostic_id: str | None = Field(default=None, max_length=128)
    evidence: str | None = Field(default=None, max_length=EVIDENCE_MAX, description=EVIDENCE_HELP)


class PatchEditOut(ApiModel):
    start_line: int = Field(ge=1, description="First replaced line (1-based, in the original source).")
    end_line: int = Field(ge=1, description="Last replaced line, inclusive.")
    replacement: str = Field(description="The new lines; empty deletes the range.")


class FixOut(ApiModel):
    fix_id: str = Field(description="Pass to /assistant/verify after running the patched code.")
    execution_id: str
    base_source_hash: str = Field(description="The patch applies to exactly this source.")
    patched_source: str
    patched_source_hash: str
    summary: str
    edits: list[PatchEditOut]
    target_codes: list[str] = Field(description="Diagnostic codes the fix is meant to remove.")
    confidence: Confidence
    verified: Literal[False] = Field(default=False, description="Not verified until the patched code is run.")
    provider: str
    model: str
    cached: bool = False
    fix_token: str | None = Field(default=None, description="The sealed proposal; send it back to /verify.")


class VerifyIn(ApiModel):
    fix_id: str = Field(max_length=64)
    execution_id: str = Field(max_length=64, description="The run of the patched code.")
    fix_token: str | None = Field(default=None, max_length=8_000, description="FixOut.fixToken of the proposal.")
    evidence: str | None = Field(default=None, max_length=EVIDENCE_MAX, description=EVIDENCE_HELP)


class VerifyOut(ApiModel):
    fix_id: str
    execution_id: str
    verdict: Literal["fixed", "improved", "not_fixed", "different_code"]
    verified: bool = Field(description="True only when the run of the patched code finished without errors.")
    message: str
    before_state: str
    after_state: str
    before_errors: int
    after_errors: int


class ChatTurnIn(ApiModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskIn(ApiModel):
    question: str = Field(min_length=1, max_length=2000)
    language_id: str | None = Field(default=None, max_length=32)
    execution_id: str | None = Field(default=None, max_length=64,
                                     description="Ground the answer in this run (source, diagnostics, output).")
    source_hash: str | None = Field(default=None, pattern=SOURCE_HASH)
    source: str | None = Field(default=None, max_length=64 * 1024,
                               description="The editor's code when there is no run to ground the answer in.")
    history: list[ChatTurnIn] = Field(default_factory=list, max_length=8)
    evidence: str | None = Field(default=None, max_length=EVIDENCE_MAX, description=EVIDENCE_HELP)
    diagnostic_id: str | None = Field(default=None, max_length=128,
                                      description="With executionId: the diagnostic the question is about.")


class AskOut(ApiModel):
    answer: str
    grounded_on: Literal["execution", "source", "none"]
    execution_id: str | None = None
    source_hash: str | None = None
    provider: str
    model: str
    cached: bool = False


class CompleteIn(ApiModel):
    """Code around the editor's cursor, for an inline completion (ghost text)."""

    language_id: str = Field(max_length=32)
    prefix: str = Field(max_length=16 * 1024, description="The code before the cursor.")
    suffix: str = Field(default="", max_length=8 * 1024, description="The code after the cursor.")
    max_lines: int = Field(default=4, ge=1, le=12)


class CompleteOut(ApiModel):
    completion: str = Field(description="Text to insert at the cursor; empty when the model has nothing useful.")
    provider: str
    model: str
    cached: bool = False
