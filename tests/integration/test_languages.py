"""Every supported language, end to end through the real sandbox.

For each language (programs.py): a program that reads input and succeeds, a
compile (or syntax-check) error mapped to its line, a runtime error mapped
to its line, and hostile programs that the sandbox limits must contain:
time, memory, processes, network, file system and output. The C containment
corpus in services/runner/tests covers the runner itself in more depth.
"""

from __future__ import annotations

import pytest
from programs import LANGUAGES, PROGRAMS

pytestmark = pytest.mark.docker

WITH_COMPILE_STEP = [lang for lang in LANGUAGES if PROGRAMS[lang]["compile_error"] is not None]


def test_every_profile_has_programs():
    from conftest import REGISTRY

    assert sorted(LANGUAGES) == sorted(p.id for p in REGISTRY.all() if p.purpose == "program")


@pytest.mark.parametrize("lang", LANGUAGES)
def test_hello_reads_input_and_succeeds(execute, lang):
    out = execute(lang, PROGRAMS[lang]["hello"], stdin="Asha\n")
    assert out.state == "SUCCEEDED", (out.state, out.codes)
    assert "Hello, Asha!" in out.stdout()
    assert out.codes == []


@pytest.mark.parametrize("lang", WITH_COMPILE_STEP)
def test_compile_error_is_mapped_to_its_line(execute, lang):
    source, code, line = PROGRAMS[lang]["compile_error"]
    out = execute(lang, source)
    assert out.state == "COMPILE_ERROR", (out.state, out.codes)
    d = next(d for d in out.diagnostics if d.code == code)
    assert d.range is not None and d.range.start_line == line
    assert "run" not in out.steps  # the program never started


@pytest.mark.parametrize("lang", LANGUAGES)
def test_runtime_error_is_mapped_to_its_line(execute, lang):
    source, code, line = PROGRAMS[lang]["runtime_error"]
    out = execute(lang, source)
    assert out.state == "RUNTIME_ERROR", (out.state, out.codes)
    d = next(d for d in out.diagnostics if d.code == code)
    if line is None:
        assert d.range is None  # e.g. C++ uncaught exceptions carry no source position
    else:
        assert d.range is not None and d.range.start_line == line


@pytest.mark.parametrize("lang", LANGUAGES)
def test_infinite_loop_hits_the_time_limit(execute, lang):
    out = execute(lang, PROGRAMS[lang]["loop"])
    assert out.state == "TIMEOUT", (out.state, out.codes)
    assert "LIMIT_TIMEOUT" in out.codes
    assert out.seconds < 30


@pytest.mark.parametrize("lang", LANGUAGES)
def test_memory_hog_is_stopped(execute, lang):
    out = execute(lang, PROGRAMS[lang]["memory"])
    # Either the sandbox kills it at the memory limit, or the language runtime
    # reports its own out-of-memory error first (Java's -Xmx, PHP's memory_limit).
    # Docker records the kernel's OOM kill from a separate event; the runner waits
    # for it (runner/sandbox.py: _settle_oom_flag), but should Docker never deliver
    # it, the program has still been stopped, by SIGKILL, and is reported as killed.
    assert out.state in {"MEMORY_LIMIT", "RUNTIME_ERROR"}, (out.state, out.codes)
    assert set(out.codes) & ({"LIMIT_MEMORY", "RUNTIME_KILLED"} | PROGRAMS[lang]["memory_codes"]), out.codes
    assert out.seconds < 30


@pytest.mark.parametrize("lang", LANGUAGES)
def test_process_bomb_is_contained(execute, lang):
    if PROGRAMS[lang]["bomb"] is None:
        pytest.skip(f"{lang} cannot start processes")
    out = execute(lang, PROGRAMS[lang]["bomb"])
    # The PID limit makes process/thread creation fail; the program then either
    # dies with an error or keeps trying until the time limit.
    assert out.state in {"TIMEOUT", "RUNTIME_ERROR", "MEMORY_LIMIT"}, (out.state, out.codes)
    assert out.seconds < 30


@pytest.mark.parametrize("lang", LANGUAGES)
def test_network_is_unreachable(execute, lang):
    if PROGRAMS[lang]["network"] is None:
        pytest.skip(f"{lang} cannot open network connections")
    out = execute(lang, PROGRAMS[lang]["network"])
    assert "CONNECTED" not in out.stdout()
    assert "BLOCKED" in out.stdout(), (out.state, out.codes, out.stdout())


@pytest.mark.parametrize("lang", LANGUAGES)
def test_workspace_is_read_only_while_running(execute, lang):
    out = execute(lang, PROGRAMS[lang]["write"])
    assert "WROTE" not in out.stdout()
    assert "BLOCKED" in out.stdout(), (out.state, out.codes, out.stdout())


@pytest.mark.parametrize("lang", LANGUAGES)
def test_output_flood_is_cut_at_the_output_limit(execute, lang):
    out = execute(lang, PROGRAMS[lang]["flood"])
    assert out.state == "RUNTIME_ERROR", (out.state, out.codes)
    assert "LIMIT_OUTPUT" in out.codes
    assert out.steps["run"].stdout_truncated
    assert out.seconds < 30
