"""Docker can record an out-of-memory kill a moment after the exit (no daemon needed here)."""

from __future__ import annotations

import docker
import pytest

from runner import sandbox
from runner.jobspec import Termination
from runner.sandbox import _Captured, _settle_oom_flag, _step_result

KILLED = 128 + 9  # tini reports "killed by SIGKILL" as 137


class LateOomContainer:
    """A container whose OOMKilled flag turns true only after a few inspections."""

    def __init__(self, oom_after: int | None) -> None:
        self.oom_after = oom_after
        self.reloads = 0
        self.attrs = {"State": {"OOMKilled": False}}

    def reload(self) -> None:
        self.reloads += 1
        late = self.oom_after is not None and self.reloads >= self.oom_after
        self.attrs = {"State": {"OOMKilled": late}}


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    monkeypatch.setattr(sandbox, "OOM_SETTLE_S", 0.3)
    monkeypatch.setattr(sandbox, "_OOM_POLL_S", 0.01)


def test_a_late_oom_flag_is_waited_for_and_reported_as_the_memory_limit():
    container = LateOomContainer(oom_after=3)
    state = _settle_oom_flag(container, {"OOMKilled": False}, KILLED, _Captured())
    assert state["OOMKilled"] is True and container.reloads == 3
    step = _step_result("run", KILLED, state, _Captured(), wall_ms=500)
    assert step.termination is Termination.MEMORY_LIMIT and step.oom_killed


def test_a_sigkill_without_an_oom_stays_a_signal_after_the_wait():
    container = LateOomContainer(oom_after=None)
    state = _settle_oom_flag(container, {"OOMKilled": False}, KILLED, _Captured())
    assert state["OOMKilled"] is False and container.reloads >= 1
    step = _step_result("run", KILLED, state, _Captured(), wall_ms=500)
    assert step.termination is Termination.SIGNALED and step.signal == 9


@pytest.mark.parametrize("exit_code, stop_reason", [
    (0, None),                               # a normal exit
    (128 + 11, None),                        # a crash (SIGSEGV)
    (KILLED, Termination.TIMEOUT),           # the runner killed it at the time limit
    (KILLED, Termination.OUTPUT_LIMIT),      # the runner killed it for printing too much
])
def test_other_endings_are_not_delayed(exit_code, stop_reason):
    container = LateOomContainer(oom_after=1)
    captured = _Captured()
    captured.stop_reason = stop_reason
    state = _settle_oom_flag(container, {"OOMKilled": False}, exit_code, captured)
    assert state == {"OOMKilled": False} and container.reloads == 0


def test_a_container_that_disappears_ends_the_wait():
    class Gone(LateOomContainer):
        def reload(self) -> None:
            self.reloads += 1
            raise docker.errors.NotFound("no such container")

    container = Gone(oom_after=None)
    assert _settle_oom_flag(container, {"OOMKilled": False}, KILLED, _Captured()) == {"OOMKilled": False}
    assert container.reloads == 1
