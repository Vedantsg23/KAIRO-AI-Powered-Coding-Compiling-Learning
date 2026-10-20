"""Saarthi's use cases: explain a run, propose a fix, verify a fix, answer a question.

Rules this module enforces:
  * An answer is always tied to one execution's exact source snapshot. The
    student's editor sends the hash of the code it shows; if that is not the
    code of the run, the request is refused as stale.
  * A fix is only a proposal. It is validated (line ranges, size, overlap),
    shown to the student as a patch, and applied only when they accept it.
  * "Verified" is decided by running the patched code in the sandbox, never
    by the model: /verify compares that run with the original one.
  * The model is only called when a student presses a Saarthi button, never
    while typing. Per-client and global limits, a response cache and a
    concurrency cap protect the provider budget.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import time
from collections import OrderedDict, deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..adapters.registry import LanguageRegistry
from ..config import ApiSettings
from ..domain.execution import Execution, ExecutionState, source_hash
from ..schemas.assistant import (
    AskIn,
    AskOut,
    AssistantStatusOut,
    CodeLocationOut,
    CompleteIn,
    CompleteOut,
    ExplainIn,
    ExplanationOut,
    FixIn,
    FixOut,
    PatchEditOut,
    VerifyIn,
    VerifyOut,
)
from ..schemas.diagnostics import Severity
from ..services.evidence import EvidenceSeal, execution_from_payload
from ..services.presenters import summarize
from . import prompts
from .context import build_evidence, build_source_only, defuse, pick_focus
from .providers import Provider, ProviderError

# ------------------------------------------------------------------ errors


class AssistantError(Exception):
    status = 400

    def __init__(self, message: str, retry_after_s: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after_s = retry_after_s


class AssistantDisabled(AssistantError):
    status = 503


class RateLimited(AssistantError):
    status = 429


class NotFound(AssistantError):
    status = 404


class Conflict(AssistantError):
    status = 409  # stale source, run not finished


class NothingToDo(AssistantError):
    status = 422


class BadAnswer(AssistantError):
    status = 502  # the provider failed or its answer was unusable


# ------------------------------------------------------- limits and caches


class RateLimiter:
    """Sliding one-minute window and a daily count per client, plus a global daily budget."""

    def __init__(self, per_minute: int, per_day: int, daily_budget: int) -> None:
        self.per_minute, self.per_day, self.daily_budget = per_minute, per_day, daily_budget
        self._minute: dict[str, deque[float]] = {}
        self._day: dict[str, int] = {}
        self._day_key = ""
        self._total = 0

    def acquire(self, client: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        day = datetime.fromtimestamp(now, UTC).strftime("%Y-%m-%d")
        if day != self._day_key:
            self._day_key, self._day, self._total = day, {}, 0
        if self._total >= self.daily_budget:
            raise RateLimited("Saarthi has answered as many questions as this server allows today. "
                              "Please try again tomorrow.", retry_after_s=3600)
        if self._day.get(client, 0) >= self.per_day:
            raise RateLimited("You have used today's Saarthi questions. Please try again tomorrow.",
                              retry_after_s=3600)
        window = self._minute.setdefault(client, deque())
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= self.per_minute:
            wait = int(60 - (now - window[0])) + 1
            raise RateLimited(f"Saarthi needs a short break: try again in {wait} seconds.", retry_after_s=wait)
        window.append(now)
        self._day[client] = self._day.get(client, 0) + 1
        self._total += 1
        if len(self._minute) > 10_000:  # forget idle clients
            for key in [k for k, w in self._minute.items() if not w or now - w[-1] >= 60][:5_000]:
                del self._minute[key]


class TTLCache:
    def __init__(self, ttl_s: float, max_entries: int = 256) -> None:
        self.ttl_s, self.max_entries = ttl_s, max_entries
        self._items: OrderedDict[str, tuple[float, object]] = OrderedDict()

    def get(self, key: str) -> object | None:
        item = self._items.get(key)
        if item is None:
            return None
        expires, value = item
        if expires < time.monotonic():
            del self._items[key]
            return None
        self._items.move_to_end(key)
        return value

    def put(self, key: str, value: object) -> None:
        self._items[key] = (time.monotonic() + self.ttl_s, value)
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)


@dataclass
class FixProposal:
    fix_id: str
    execution_id: str
    language_id: str
    base_hash: str
    patched_hash: str
    target_codes: list[str]
    before_state: str
    before_errors: int
    created: float = field(default_factory=time.monotonic)

    def payload(self) -> dict:
        """What the fix token carries (FixOut.fixToken), so any instance can verify the fix."""
        return {"fixId": self.fix_id, "executionId": self.execution_id, "languageId": self.language_id,
                "baseHash": self.base_hash, "patchedHash": self.patched_hash, "targetCodes": self.target_codes,
                "beforeState": self.before_state, "beforeErrors": self.before_errors}

    @classmethod
    def from_payload(cls, data: dict) -> FixProposal | None:
        try:
            return cls(fix_id=str(data["fixId"]), execution_id=str(data["executionId"]),
                       language_id=str(data["languageId"]), base_hash=str(data["baseHash"]),
                       patched_hash=str(data["patchedHash"]), target_codes=[str(c) for c in data["targetCodes"]],
                       before_state=str(data["beforeState"]), before_errors=int(data["beforeErrors"]))
        except (KeyError, TypeError, ValueError):
            return None


FIX_TTL_S = 2 * 3600  # how long a proposed fix can still be verified


@dataclass
class _AskPlan:
    """A question, ready for the model: the provider, the messages and what grounds the answer."""

    provider: Provider
    messages: list[dict]
    key: str
    grounded: str
    execution_id: str | None
    source_hash: str | None


# ------------------------------------------------------ model answer shapes


def _clip(value: object, limit: int) -> str:
    text = str(value if value is not None else "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class _ExplainDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    problem: str
    what_happened: str
    why: str
    location_line: int | None = 0
    suggested_fix: str
    related_concepts: list[str] = Field(default_factory=list)
    confidence: str = "low"

    @field_validator("problem", mode="before")
    @classmethod
    def _short(cls, value: object) -> str:
        return _clip(value, 300)

    @field_validator("what_happened", "why", "suggested_fix", mode="before")
    @classmethod
    def _long(cls, value: object) -> str:
        return _clip(value, 1_200)

    @field_validator("location_line", mode="before")
    @classmethod
    def _line(cls, value: object) -> int | None:
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    @field_validator("related_concepts", mode="before")
    @classmethod
    def _concepts(cls, value: object) -> list[str]:
        items = value if isinstance(value, list) else []
        return [_clip(v, 60) for v in items if str(v or "").strip()][:4]

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value: object) -> str:
        return value if value in ("low", "medium", "high") else "low"


class _EditDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    start_line: int
    end_line: int
    replacement: str = Field(max_length=4_000)


class _FixDraft(BaseModel):
    model_config = ConfigDict(extra="ignore")
    summary: str
    edits: list[_EditDraft] = Field(default_factory=list, max_length=8)
    confidence: str = "low"

    @field_validator("summary", mode="before")
    @classmethod
    def _summary(cls, value: object) -> str:
        return _clip(value, 600)

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence(cls, value: object) -> str:
        return value if value in ("low", "medium", "high") else "low"


MAX_CHANGED_LINES = 60  # removed + inserted lines of one fix


def apply_edits(source: str, edits: list[_EditDraft]) -> str:
    """Apply whole-line replacements to `source`; raises ValueError if they do not fit."""
    eol = "\r\n" if "\r\n" in source else "\n"
    lines = source.split(eol)
    trailing_newline = bool(lines) and lines[-1] == ""
    if trailing_newline:
        lines = lines[:-1]
    total = len(lines)
    ordered = sorted(edits, key=lambda e: e.start_line)
    changed = 0
    previous_end = 0
    for edit in ordered:
        if not 1 <= edit.start_line <= edit.end_line <= total:
            raise ValueError(f"lines {edit.start_line}-{edit.end_line} are outside the file (1-{total})")
        if edit.start_line <= previous_end:
            raise ValueError("edits overlap")
        if "\x00" in edit.replacement:
            raise ValueError("replacement contains a NUL character")
        previous_end = edit.end_line
        new_lines = edit.replacement.replace("\r\n", "\n").split("\n") if edit.replacement else []
        changed += (edit.end_line - edit.start_line + 1) + len(new_lines)
    if changed > MAX_CHANGED_LINES:
        raise ValueError(f"the change touches {changed} lines (at most {MAX_CHANGED_LINES} allowed)")
    for edit in reversed(ordered):
        new_lines = edit.replacement.replace("\r\n", "\n").split("\n") if edit.replacement else []
        lines[edit.start_line - 1: edit.end_line] = new_lines
    patched = eol.join(lines)
    return patched + eol if trailing_newline else patched


# ----------------------------------------------------------------- service


class AssistantService:
    def __init__(self, settings: ApiSettings, registry: LanguageRegistry, executions,
                 provider: Provider | None, disabled_reason: str | None,
                 seal: EvidenceSeal | None = None) -> None:
        self.settings = settings
        # Opens the sealed runs and fixes the browser sends back (see services/evidence.py).
        self.seal = seal or EvidenceSeal(None)
        self.registry = registry
        self.executions = executions  # ExecutionService: .get(execution_id)
        self.provider = provider
        self.disabled_reason = disabled_reason
        self.limiter = RateLimiter(settings.ai_requests_per_minute, settings.ai_requests_per_day,
                                   settings.ai_daily_budget)
        self.cache = TTLCache(settings.ai_cache_ttl_s)
        # Inline completions have their own, larger budget and cache.
        self.complete_limiter = RateLimiter(settings.ai_complete_per_minute, settings.ai_complete_per_day,
                                            settings.ai_complete_daily_budget)
        self.completions = TTLCache(ttl_s=600, max_entries=2_000)
        self.fixes = TTLCache(ttl_s=FIX_TTL_S, max_entries=1_000)
        self._slots = asyncio.Semaphore(settings.ai_max_concurrency)

    # ---------------------------------------------------------------- status

    def status(self) -> AssistantStatusOut:
        return AssistantStatusOut(
            enabled=self.provider is not None,
            provider=self.provider.name if self.provider else None,
            model=self.provider.model if self.provider else None,
            reason=self.disabled_reason,
            requests_per_minute=self.settings.ai_requests_per_minute,
            requests_per_day=self.settings.ai_requests_per_day,
        )

    # ------------------------------------------------------------- explain

    async def explain(self, request: ExplainIn, client: str) -> ExplanationOut:
        provider = self._require_provider()
        execution, profile = self._finished_execution(request.execution_id, request.source_hash, request.evidence)
        focus = pick_focus(execution, request.diagnostic_id)
        if request.diagnostic_id and focus is None:
            raise NotFound("That diagnostic is not part of this run.")
        if focus is None and not request.question and execution.state is ExecutionState.SUCCEEDED:
            raise NothingToDo("This run finished without problems, so there is nothing to explain. "
                              "Ask Saarthi a question instead.")
        headline = summarize(execution, profile, None)
        evidence = build_evidence(execution, profile, headline, focus, request.question)
        key = self._cache_key("explain", execution.source_hash, execution.id, focus.id if focus else "",
                              request.question or "")
        cached = self.cache.get(key)
        if isinstance(cached, ExplanationOut):
            return cached.model_copy(update={"cached": True})

        data = await self._call(provider, client, prompts.EXPLAIN_TASK, evidence.text, prompts.EXPLAIN_TOOL,
                                max_tokens=min(self.settings.ai_max_output_tokens, 1_200))
        try:
            draft = _ExplainDraft.model_validate(data)
        except ValidationError as exc:
            raise BadAnswer("Saarthi's answer was incomplete. Please try again.") from exc
        line = draft.location_line if draft.location_line and 1 <= draft.location_line <= evidence.line_count else None
        answer = ExplanationOut(
            execution_id=execution.id, source_hash=execution.source_hash,
            focus_diagnostic_id=focus.id if focus else None, diagnostic_ids=evidence.diagnostic_ids,
            problem=draft.problem, what_happened=draft.what_happened, why=draft.why,
            location=CodeLocationOut(line=line) if line else None, suggested_fix=draft.suggested_fix,
            related_concepts=draft.related_concepts, confidence=draft.confidence,
            provider=provider.name, model=provider.model,
        )
        self.cache.put(key, answer)
        return answer

    # ----------------------------------------------------------------- fix

    async def fix(self, request: FixIn, client: str) -> FixOut:
        provider = self._require_provider()
        execution, profile = self._finished_execution(request.execution_id, request.source_hash, request.evidence)
        focus = pick_focus(execution, request.diagnostic_id)
        if focus is None:
            raise NothingToDo("This run has no error or warning to fix.")
        headline = summarize(execution, profile, None)
        evidence = build_evidence(execution, profile, headline, focus)
        key = self._cache_key("fix", execution.source_hash, execution.id, focus.id)
        cached = self.cache.get(key)
        if isinstance(cached, FixOut):
            return cached.model_copy(update={"cached": True})

        data = await self._call(provider, client, prompts.FIX_TASK, evidence.text, prompts.FIX_TOOL,
                                max_tokens=self.settings.ai_max_output_tokens)
        try:
            draft = _FixDraft.model_validate(data)
        except ValidationError as exc:
            raise BadAnswer("Saarthi's fix could not be read. Please try again.") from exc
        if not draft.edits:
            raise NothingToDo(draft.summary or "Saarthi could not find a small, safe fix for this problem. "
                              "Try asking for an explanation instead.")
        try:
            patched = apply_edits(execution.source, draft.edits)
        except ValueError as exc:
            raise BadAnswer(f"Saarthi suggested a change that does not fit your code ({exc}). "
                            "Please try again or ask for an explanation.") from exc
        if patched == execution.source:
            raise BadAnswer("Saarthi's suggestion would not change your code. Try asking for an explanation.")
        if len(patched.encode("utf-8")) > self.settings.max_source_bytes:
            raise BadAnswer("Saarthi's suggestion would make the file too large.")

        errors_before = sum(d.severity is Severity.ERROR for d in execution.diagnostics)
        proposal = FixProposal(
            fix_id="fix_" + secrets.token_hex(12), execution_id=execution.id, language_id=execution.language_id,
            base_hash=execution.source_hash, patched_hash=source_hash(patched), target_codes=[focus.code],
            before_state=execution.state.value, before_errors=errors_before,
        )
        self.fixes.put(proposal.fix_id, proposal)
        answer = FixOut(
            fix_id=proposal.fix_id, execution_id=execution.id, base_source_hash=execution.source_hash,
            patched_source=patched, patched_source_hash=proposal.patched_hash, summary=draft.summary,
            edits=[PatchEditOut(start_line=e.start_line, end_line=e.end_line, replacement=e.replacement)
                   for e in sorted(draft.edits, key=lambda e: e.start_line)],
            target_codes=proposal.target_codes, confidence=draft.confidence,
            provider=provider.name, model=provider.model, fix_token=self.seal.seal("fix", proposal.payload()),
        )
        self.cache.put(key, answer)
        return answer

    # -------------------------------------------------------------- verify

    def verify(self, request: VerifyIn) -> VerifyOut:
        proposal = self.fixes.get(request.fix_id)
        if not isinstance(proposal, FixProposal) and request.fix_token:
            data = self.seal.open("fix", request.fix_token, max_age_s=FIX_TTL_S)
            sealed = FixProposal.from_payload(data) if data else None
            if sealed is not None and sealed.fix_id == request.fix_id:
                proposal = sealed
        if not isinstance(proposal, FixProposal):
            raise NotFound("This fix has expired. Ask Saarthi for a new one.")
        execution = self._execution(request.execution_id, request.evidence)
        if execution is None:
            raise NotFound("That run was not found (runs are kept for a limited time).")
        if not execution.terminal:
            raise Conflict("The run has not finished yet.")
        errors_after = sum(d.severity is Severity.ERROR for d in execution.diagnostics)
        base = {"fix_id": proposal.fix_id, "execution_id": execution.id, "before_state": proposal.before_state,
                "after_state": execution.state.value, "before_errors": proposal.before_errors,
                "after_errors": errors_after}
        if execution.language_id != proposal.language_id or execution.source_hash != proposal.patched_hash:
            return VerifyOut(verdict="different_code", verified=False, **base,
                             message="This run is not of the patched code (it was edited further), so the fix "
                                     "itself cannot be checked. The run's own results still apply.")
        if execution.state is ExecutionState.SUCCEEDED and errors_after == 0:
            return VerifyOut(verdict="fixed", verified=True, **base,
                             message="The patched program ran and finished without errors.")
        still = any(d.severity is Severity.ERROR and d.code in proposal.target_codes for d in execution.diagnostics)
        if not still and execution.state is not ExecutionState.INTERNAL_ERROR:
            return VerifyOut(verdict="improved", verified=False, **base,
                             message="The problem the fix targeted is gone, but the run still reports "
                                     f"{errors_after} error{'s' if errors_after != 1 else ''} "
                                     f"({execution.state.value.replace('_', ' ').lower()}).")
        return VerifyOut(verdict="not_fixed", verified=False, **base,
                         message="The run of the patched code still shows the same problem. "
                                 "Undo the change or ask Saarthi to explain the error.")

    # ----------------------------------------------------------------- ask

    def _plan_ask(self, request: AskIn) -> _AskPlan:
        """Check the question and gather its evidence; raises before any model call."""
        provider = self._require_provider()
        grounded = "none"
        execution_id = None
        hash_ = None
        if request.execution_id:
            if not request.source_hash:
                raise Conflict("Send the hash of the code in the editor with the run id.")
            execution, profile = self._finished_execution(request.execution_id, request.source_hash, request.evidence)
            focus = pick_focus(execution, request.diagnostic_id) if request.diagnostic_id else None
            evidence = build_evidence(execution, profile, summarize(execution, profile, None),
                                      focus or pick_focus(execution, None), request.question).text
            grounded, execution_id, hash_ = "execution", execution.id, execution.source_hash
        elif request.source is not None and request.source.strip():
            profile = self.registry.get(request.language_id) if request.language_id else None
            evidence = build_source_only(request.source, profile, request.question)
            grounded, hash_ = "source", source_hash(request.source)
        else:
            evidence = "<question>\n" + defuse(request.question.strip()) + "\n</question>"
        history = [{"role": t.role, "content": defuse(t.content)} for t in request.history[-8:]]
        while history and history[0]["role"] != "user":
            history.pop(0)  # the conversation must start with the student
        key = self._cache_key("ask", hash_ or "", execution_id or "", request.diagnostic_id or "", request.question,
                              json.dumps(history, sort_keys=True))
        messages = [*_alternate(history), {"role": "user", "content": f"{prompts.ASK_TASK}\n\n{evidence}"}]
        return _AskPlan(provider=provider, messages=messages, key=key, grounded=grounded,
                        execution_id=execution_id, source_hash=hash_)

    async def ask(self, request: AskIn, client: str) -> AskOut:
        plan = self._plan_ask(request)
        cached = self.cache.get(plan.key)
        if isinstance(cached, AskOut):
            return cached.model_copy(update={"cached": True})
        completion = await self._complete(plan.provider, client, plan.messages, None, max_tokens=self._ask_tokens())
        text = (completion.text or "").strip()
        if not text:
            raise BadAnswer("Saarthi returned an empty answer. Please try again.")
        answer = self._ask_answer(plan, text)
        self.cache.put(plan.key, answer)
        return answer

    def ask_stream(self, request: AskIn, client: str) -> AsyncIterator[str]:
        """The answer as NDJSON lines while the model writes it (Saarthi's chat, like Copilot):

            {"type": "start", "groundedOn": ..., "executionId": ..., "sourceHash": ..., "provider": ..., "model": ...}
            {"type": "delta", "text": "..."}            (many)
            {"type": "done", "cached": false}           or {"type": "error", "detail": "...", "retryAfterS": ...}

        Problems found before the model is called (stale code, limits) raise an
        AssistantError here, so the endpoint can answer with a normal HTTP error.
        """
        plan = self._plan_ask(request)
        cached = self.cache.get(plan.key)
        if not isinstance(cached, AskOut):
            cached = None
            self.limiter.acquire(client)
        return self._ask_events(plan, cached)

    async def _ask_events(self, plan: _AskPlan, cached: AskOut | None) -> AsyncIterator[str]:
        def line(event: dict) -> str:
            return json.dumps(event, ensure_ascii=False) + "\n"

        yield line({"type": "start", "groundedOn": plan.grounded, "executionId": plan.execution_id,
                    "sourceHash": plan.source_hash, "provider": plan.provider.name, "model": plan.provider.model})
        if cached is not None:  # the same question about the same code: replay the answer quickly
            for piece in _pieces(cached.answer):
                yield line({"type": "delta", "text": piece})
                await asyncio.sleep(0.008)
            yield line({"type": "done", "cached": True})
            return
        parts: list[str] = []
        try:
            async with self._slots:
                async with asyncio.timeout(self.settings.ai_timeout_s + 30):
                    async for piece in plan.provider.stream(system=prompts.SYSTEM, messages=plan.messages,
                                                            max_tokens=self._ask_tokens()):
                        if sum(map(len, parts)) >= 6_000:
                            break  # long enough for a chat answer
                        parts.append(piece)
                        yield line({"type": "delta", "text": piece})
        except TimeoutError:
            yield line({"type": "error", "detail": "Saarthi took too long to answer. Please try again.",
                        "retryAfterS": None})
            return
        except ProviderError as exc:
            yield line({"type": "error", "detail": exc.public, "retryAfterS": exc.retry_after_s})
            return
        text = "".join(parts).strip()
        if not text:
            yield line({"type": "error", "detail": "Saarthi returned an empty answer. Please try again.",
                        "retryAfterS": None})
            return
        self.cache.put(plan.key, self._ask_answer(plan, text))
        yield line({"type": "done", "cached": False})

    def _ask_tokens(self) -> int:
        return min(self.settings.ai_max_output_tokens, 900)

    @staticmethod
    def _ask_answer(plan: _AskPlan, text: str) -> AskOut:
        return AskOut(answer=text[:6_000], grounded_on=plan.grounded, execution_id=plan.execution_id,
                      source_hash=plan.source_hash, provider=plan.provider.name, model=plan.provider.model)

    # ------------------------------------------------------------ complete

    async def complete(self, request: CompleteIn, client: str) -> CompleteOut:
        """Ghost text for the editor: what probably comes next at the cursor.

        Only the code around the cursor is sent (the end of the text before it
        and the start of the text after it). The answer is cleaned (no fences,
        no text the student already has after the cursor) and cut to max_lines.
        """
        provider = self._require_provider()
        before = request.prefix[-4_000:]
        after = request.suffix[:1_500]
        if not before.strip():
            return CompleteOut(completion="", provider=provider.name, model=provider.model)
        profile = self.registry.get(request.language_id)
        language = profile.display_name if profile else request.language_id
        key = self._cache_key("complete", request.language_id, before, after, str(request.max_lines))
        cached = self.completions.get(key)
        if isinstance(cached, CompleteOut):
            return cached.model_copy(update={"cached": True})
        evidence = (f"<language>{defuse(language)}</language>\n<code_before>\n{defuse(before)}</code_before>\n"
                    f"<code_after>\n{defuse(after)}\n</code_after>")
        task = prompts.COMPLETE_TASK.format(max_lines=request.max_lines)
        self.complete_limiter.acquire(client)
        try:
            async with self._slots:
                completion = await asyncio.wait_for(
                    provider.complete(system=prompts.SYSTEM, messages=[{"role": "user", "content": f"{task}\n\n{evidence}"}],
                                      max_tokens=min(self.settings.ai_max_output_tokens, 256), tool=None),
                    timeout=min(self.settings.ai_timeout_s, 20) + 2)
        except TimeoutError as exc:
            raise BadAnswer("The completion took too long.") from exc
        except ProviderError as exc:
            raise BadAnswer(exc.public, retry_after_s=exc.retry_after_s) from exc
        text = clean_completion(completion.text or "", before, after, request.max_lines)
        answer = CompleteOut(completion=text, provider=provider.name, model=provider.model)
        self.completions.put(key, answer)
        return answer

    # ------------------------------------------------------------- helpers

    def _require_provider(self) -> Provider:
        if self.provider is None:
            raise AssistantDisabled(f"Saarthi is not available: {self.disabled_reason}")
        return self.provider

    def _execution(self, execution_id: str, evidence: str | None) -> Execution | None:
        """The run from this instance's memory, else from its sealed evidence (any instance)."""
        execution = self.executions.get(execution_id)
        if execution is None and evidence:
            payload = self.seal.open("execution", evidence)
            if payload is not None and payload.get("id") == execution_id:
                execution = execution_from_payload(payload)
        return execution

    def _finished_execution(self, execution_id: str, editor_hash: str,
                            evidence: str | None = None) -> tuple[Execution, object]:
        execution = self._execution(execution_id, evidence)
        if execution is None:
            raise NotFound("That run was not found (runs are kept for a limited time). Run the code again.")
        if execution.source_hash != editor_hash:
            raise Conflict("Your code changed after this run. Run it again, then ask Saarthi about the new result.")
        if not execution.terminal:
            raise Conflict("Wait for the run to finish, then ask Saarthi.")
        profile = self.registry.get(execution.language_id)
        if profile is None:
            raise NotFound("This run's language is no longer available.")
        return execution, profile

    def _cache_key(self, *parts: str) -> str:
        model = f"{self.provider.name}:{self.provider.model}" if self.provider else "-"
        return hashlib.sha256("\x1f".join((model, *parts)).encode("utf-8")).hexdigest()

    async def _call(self, provider: Provider, client: str, task: str, evidence: str, tool, max_tokens: int) -> dict:
        messages = [{"role": "user", "content": f"{task}\n\n{evidence}"}]
        completion = await self._complete(provider, client, messages, tool, max_tokens)
        return completion.data or {}

    async def _complete(self, provider: Provider, client: str, messages: list[dict], tool, max_tokens: int):
        self.limiter.acquire(client)
        try:
            async with self._slots:
                return await asyncio.wait_for(
                    provider.complete(system=prompts.SYSTEM, messages=messages, max_tokens=max_tokens, tool=tool),
                    timeout=self.settings.ai_timeout_s + 5)
        except TimeoutError as exc:
            raise BadAnswer("Saarthi took too long to answer. Please try again.") from exc
        except ProviderError as exc:
            raise BadAnswer(exc.public, retry_after_s=exc.retry_after_s) from exc


def _alternate(history: list[dict]) -> list[dict]:
    """Earlier turns in strict user/assistant alternation (the Messages API requires it),
    ending with an assistant turn so the new question can follow as the user turn."""
    merged: list[dict] = []
    for turn in history:
        if merged and merged[-1]["role"] == turn["role"]:
            merged[-1] = {"role": turn["role"], "content": merged[-1]["content"] + "\n\n" + turn["content"]}
        else:
            merged.append(dict(turn))
    while merged and merged[-1]["role"] == "user":
        merged.pop()  # a question that never got an answer
    return merged


def clean_completion(text: str, before: str, after: str, max_lines: int) -> str:
    """The model's completion, made safe to insert as ghost text: no Markdown
    fences, no repeat of the line already typed, nothing the code after the
    cursor already has, at most max_lines lines."""
    text = text.replace("\r\n", "\n")
    fence = text.strip()
    if fence.startswith("```"):
        lines = fence.split("\n")[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    # A model that repeats the current line from its start: keep only the new part.
    current = before.rsplit("\n", 1)[-1]
    if current.strip() and text.startswith(current):
        text = text[len(current):]
    lines = text.split("\n")[:max_lines]
    text = "\n".join(lines).rstrip()
    # Drop what the code after the cursor already starts with (a closing bracket, the rest of the line).
    head = after.lstrip(" \t").split("\n", 1)[0].strip()
    if head and text.endswith(head):
        text = text[: -len(head)].rstrip()
    return text if text.strip() else ""


def _pieces(text: str, size: int = 24) -> list[str]:
    """A cached answer cut into short pieces (at spaces where possible) to replay it as a stream."""
    pieces: list[str] = []
    while text:
        cut = text.rfind(" ", 0, size) + 1 if len(text) > size else len(text)
        cut = cut if cut > 0 else size
        pieces.append(text[:cut])
        text = text[cut:]
    return pieces
