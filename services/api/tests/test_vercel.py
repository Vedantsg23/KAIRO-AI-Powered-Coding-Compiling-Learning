"""The Vercel deployment's pieces, with every external service mocked:

* runs streamed over one request (POST /executions/run, no WebSocket);
* sealed evidence and fix tokens, so any server instance can answer Saarthi
  questions about a run another instance executed;
* Saarthi's streamed chat answers (POST /assistant/ask/stream);
* the Vercel Sandbox runner client (session, executor install, job, busy VM);
* the daily keep-alive endpoint and the Vercel defaults of the settings.
"""

from __future__ import annotations

import base64
import gzip
import io
import json
import tarfile
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai.providers import FallbackProvider, choose_provider
from app.config import ApiSettings
from app.main import create_app
from app.queue.runner_client import RunnerBusy
from app.queue.vercel_sandbox import EXECUTOR, OIDC, OidcToken, VercelSandboxRunner
from app.schemas.runner import JobSpec, StepResult, Termination

from .conftest import ndjson_response
from .test_assistant import BROKEN, EXPLANATION, FIX, FIXED, FakeClaude, gcc_runner, sha

SECRET = "test-evidence-secret"


def run_streamed(client: TestClient, source: str, language: str = "c") -> list[dict]:
    with client.stream("POST", "/api/v1/executions/run",
                       json={"languageId": language, "source": source, "stdin": ""}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        return [json.loads(line) for line in response.iter_lines() if line.strip()]


def claude_app(make_client, fake: FakeClaude, **settings) -> TestClient:
    return make_client(gcc_runner(), ai_transport=fake.transport, ai_provider="anthropic",
                       anthropic_api_key="test-key-123", evidence_secret=SECRET, **settings)


# ------------------------------------------------------------ streamed runs


def test_run_streams_snapshots_until_the_terminal_one_with_evidence(make_client):
    client = make_client(gcc_runner(), evidence_secret=SECRET)
    snapshots = run_streamed(client, FIXED)
    assert snapshots[-1]["state"] == "SUCCEEDED"  # a fast run may already be over at the first line
    assert all(not s["terminal"] for s in snapshots[:-1]) and snapshots[-1]["terminal"]
    assert all("evidence" not in s or s["evidence"] is None for s in snapshots[:-1])
    assert snapshots[-1]["evidence"] and len({s["id"] for s in snapshots}) == 1


def test_run_refusals_are_plain_http_errors(make_client):
    client = make_client(gcc_runner())
    refused = client.post("/api/v1/executions/run", json={"languageId": "nope", "source": "x", "stdin": ""})
    assert refused.status_code == 422


# ---------------------------------------------------- evidence across instances


def test_another_instance_explains_a_run_from_its_sealed_evidence(make_client):
    fake = FakeClaude(EXPLANATION)
    first = claude_app(make_client, fake)
    second = claude_app(make_client, fake)  # same secret, empty memory: like another Vercel instance
    run = run_streamed(first, BROKEN)[-1]
    body = {"executionId": run["id"], "sourceHash": sha(BROKEN)}

    assert second.post("/api/v1/assistant/explain", json=body).status_code == 404
    answer = second.post("/api/v1/assistant/explain", json={**body, "evidence": run["evidence"]})
    assert answer.status_code == 200 and answer.json()["problem"] == EXPLANATION["problem"]

    # The evidence is bound to its run and cannot be altered or reused for other code.
    stale = second.post("/api/v1/assistant/explain",
                        json={**body, "sourceHash": sha(FIXED), "evidence": run["evidence"]})
    assert stale.status_code == 409
    body_part, tag = run["evidence"].split(".")
    tampered = body_part[:-2] + ("AA" if body_part[-2:] != "AA" else "BB") + "." + tag
    assert second.post("/api/v1/assistant/explain", json={**body, "evidence": tampered}).status_code == 404
    other = make_client(gcc_runner(), ai_transport=fake.transport, ai_provider="anthropic",
                        anthropic_api_key="k", evidence_secret="another-secret")
    assert other.post("/api/v1/assistant/explain", json={**body, "evidence": run["evidence"]}).status_code == 404


def test_instances_of_one_deployment_share_the_key_its_build_generated(make_client, tmp_path):
    # Without CC_EVIDENCE_SECRET, the Vercel build writes a random key into the function's
    # bundle (infra/vercel/build-keys.mjs): every instance of that deployment reads the same file.
    key = tmp_path / "evidence.key"
    key.write_text("generated-by-the-build\n")
    fake = FakeClaude(EXPLANATION)
    settings = {"ai_transport": fake.transport, "ai_provider": "anthropic", "anthropic_api_key": "k"}
    first = make_client(gcc_runner(), evidence_key_file=key, **settings)
    second = make_client(gcc_runner(), evidence_key_file=key, **settings)
    run = run_streamed(first, BROKEN)[-1]
    body = {"executionId": run["id"], "sourceHash": sha(BROKEN), "evidence": run["evidence"]}
    assert second.post("/api/v1/assistant/explain", json=body).status_code == 200

    # Another deployment (another key), or no key at all (a random one per process): refused.
    other_key = tmp_path / "other.key"
    other_key.write_text("another-build\n")
    for key_file in (other_key, tmp_path / "missing.key"):
        other = make_client(gcc_runner(), evidence_key_file=key_file, **settings)
        assert other.post("/api/v1/assistant/explain", json=body).status_code == 404
    # The environment variable wins over the build's key.
    pinned = make_client(gcc_runner(), evidence_key_file=key, evidence_secret="from-the-environment", **settings)
    assert pinned.post("/api/v1/assistant/explain", json=body).status_code == 404


def test_on_vercel_the_live_sites_public_settings_fill_in_the_supabase_project(tmp_path, monkeypatch):
    for name in ("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "CC_SUPABASE_URL", "CC_SUPABASE_KEY"):
        monkeypatch.delenv(name, raising=False)
    public = tmp_path / ".env.vercel"
    public.write_text("# public settings\nVITE_SUPABASE_URL=https://abc.supabase.co\n"
                      "VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test\n")
    settings = ApiSettings(_env_file=public, ai_provider="none")
    assert settings.supabase_url == "https://abc.supabase.co"
    assert settings.supabase_key is not None and settings.supabase_key.get_secret_value() == "sb_publishable_test"
    # An environment variable (a Vercel project setting) wins over the file.
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://other.supabase.co")
    assert ApiSettings(_env_file=public, ai_provider="none").supabase_url == "https://other.supabase.co"
    # Off Vercel the file is not read (see create_app).
    monkeypatch.delenv("VITE_SUPABASE_URL")
    assert ApiSettings(ai_provider="none").supabase_url == ""


def test_the_live_sites_public_settings_hold_no_secret():
    from app.config import PUBLIC_SETTINGS

    values = {k: v for k, v in json.loads(PUBLIC_SETTINGS.read_text()).items() if not k.startswith("_")}
    assert set(values) == {"VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"}
    assert values["VITE_SUPABASE_URL"].startswith("https://") and values["VITE_SUPABASE_URL"].endswith(".supabase.co")
    assert values["VITE_SUPABASE_PUBLISHABLE_KEY"].startswith("sb_publishable_")  # never sb_secret_ / service_role


def test_a_fix_proposed_on_one_instance_is_verified_on_another(make_client):
    fake = FakeClaude(FIX)
    first = claude_app(make_client, fake)
    second = claude_app(make_client, fake)
    broken = run_streamed(first, BROKEN)[-1]
    fix = first.post("/api/v1/assistant/fix", json={"executionId": broken["id"], "sourceHash": sha(BROKEN),
                                                    "evidence": broken["evidence"]}).json()
    assert fix["patchedSource"] == FIXED and fix["fixToken"]

    patched = run_streamed(first, fix["patchedSource"])[-1]
    request = {"fixId": fix["fixId"], "executionId": patched["id"]}
    assert second.post("/api/v1/assistant/verify", json=request).status_code == 404
    verdict = second.post("/api/v1/assistant/verify",
                          json={**request, "fixToken": fix["fixToken"], "evidence": patched["evidence"]})
    assert verdict.status_code == 200 and verdict.json()["verdict"] == "fixed" and verdict.json()["verified"]

    # A token for one fix does not verify another fix id.
    wrong = second.post("/api/v1/assistant/verify", json={**request, "fixId": "fix_other", "fixToken": fix["fixToken"],
                                                          "evidence": patched["evidence"]})
    assert wrong.status_code == 404


# ------------------------------------------------------------ streamed chat


class FakeGateway:
    """An OpenAI-compatible server that streams its answer as server-sent events."""

    def __init__(self, pieces: list[str] | None = None, status: int = 200, error: dict | None = None) -> None:
        self.pieces = pieces or ["Line 3 ", "needs a ", "semicolon."]
        self.status = status
        self.error = error or {"error": "nope"}
        self.requests: list[dict] = []
        self.headers: list[httpx.Headers] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://gateway.test/v1/chat/completions"
        body = json.loads(request.content)
        self.requests.append(body)
        self.headers.append(request.headers)
        if self.status != 200:
            return httpx.Response(self.status, json=self.error)
        assert body["stream"] is True
        events = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': p}}]})}\n\n" for p in self.pieces)
        return httpx.Response(200, content=(events + "data: [DONE]\n\n").encode(),
                              headers={"content-type": "text/event-stream"})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def gateway_app(make_client, fake: FakeGateway, **settings) -> TestClient:
    return make_client(gcc_runner(), ai_transport=fake.transport, ai_provider="gateway",
                       ai_gateway_api_key="gw-key", ai_base_url="https://gateway.test/v1",
                       evidence_secret=SECRET, **settings)


def ask_streamed(client: TestClient, body: dict) -> list[dict]:
    with client.stream("POST", "/api/v1/assistant/ask/stream", json=body) as response:
        assert response.status_code == 200, response.read()
        return [json.loads(line) for line in response.iter_lines() if line.strip()]


def test_chat_answers_stream_word_by_word_and_repeat_from_the_cache(make_client):
    fake = FakeGateway()
    client = gateway_app(make_client, fake)
    run = run_streamed(client, BROKEN)[-1]
    body = {"question": "Why does it not compile?", "languageId": "c", "executionId": run["id"],
            "sourceHash": sha(BROKEN), "evidence": run["evidence"]}

    events = ask_streamed(client, body)
    assert events[0]["type"] == "start" and events[0]["groundedOn"] == "execution"
    assert events[0]["provider"] == "gateway" and events[0]["executionId"] == run["id"]
    assert [e["text"] for e in events if e["type"] == "delta"] == fake.pieces
    assert events[-1] == {"type": "done", "cached": False}
    assert fake.headers[0]["authorization"] == "Bearer gw-key"
    assert "<diagnostics>" in fake.requests[0]["messages"][-1]["content"]

    again = ask_streamed(client, body)
    assert "".join(e["text"] for e in again if e["type"] == "delta") == "Line 3 needs a semicolon."
    assert again[-1] == {"type": "done", "cached": True} and len(fake.requests) == 1


def test_chat_problems_before_the_answer_are_http_errors_and_after_it_are_events(make_client):
    client = gateway_app(make_client, FakeGateway(), ai_requests_per_minute=1)
    run = run_streamed(client, BROKEN)[-1]
    stale = client.post("/api/v1/assistant/ask/stream", json={
        "question": "Why?", "executionId": run["id"], "sourceHash": sha(FIXED), "evidence": run["evidence"]})
    assert stale.status_code == 409
    assert ask_streamed(client, {"question": "What is a pointer?"})[-1]["type"] == "done"
    limited = client.post("/api/v1/assistant/ask/stream", json={"question": "And an array?"})
    assert limited.status_code == 429 and limited.headers.get("retry-after")

    failing = gateway_app(make_client, FakeGateway(status=503))
    events = ask_streamed(failing, {"question": "What is a loop?"})
    assert events[0]["type"] == "start" and events[-1]["type"] == "error"
    assert "overloaded" in events[-1]["detail"] and "nope" not in json.dumps(events)


def test_a_refusal_by_ai_gateway_says_what_to_check_and_logs_the_gateways_reason(make_client, caplog):
    # What AI Gateway answers when the team's credit does not cover the model.
    token = fake_jwt()
    refusal = {"error": {"type": "forbidden", "message": f"Free credit does not cover this model ({token})"}}
    client = gateway_app(make_client, FakeGateway(status=403, error=refusal))
    with caplog.at_level("WARNING", logger="saarthi"):
        events = ask_streamed(client, {"question": "What is a loop?"})
    assert events[-1]["type"] == "error"
    assert "AI Gateway" in events[-1]["detail"] and "credit" in events[-1]["detail"]
    assert "Free credit does not cover" not in json.dumps(events)  # the gateway's text stays on the server
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "gateway answered HTTP 403: forbidden | Free credit does not cover this model" in logged
    assert token not in logged and "[redacted]" in logged

    spent = gateway_app(make_client, FakeGateway(status=402, error={"error": {"type": "insufficient_funds"}}))
    assert "no credit left" in ask_streamed(spent, {"question": "What is an array?"})[-1]["detail"]


# ----------------------------------------------- Gemini API (free key, no card)

GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"


class FakeGemini:
    """Google's OpenAI-compatible endpoint: streams chat answers and returns JSON answers."""

    def __init__(self, refuse_json_mode: bool = False, bad_key: bool = False) -> None:
        self.refuse_json_mode = refuse_json_mode
        self.bad_key = bad_key
        self.requests: list[dict] = []
        self.headers: list[httpx.Headers] = []

    @staticmethod
    def error(message: str) -> httpx.Response:  # Google wraps its errors in a list
        return httpx.Response(400, json=[{"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": message}}])

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == GEMINI_CHAT
        body = json.loads(request.content)
        self.requests.append(body)
        self.headers.append(request.headers)
        if self.bad_key:
            return self.error("API key not valid. Please pass a valid API key.")
        if body.get("stream"):
            events = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': p}}]})}\n\n"
                             for p in ["A loop ", "repeats ", "code."])
            return httpx.Response(200, content=(events + "data: [DONE]\n\n").encode(),
                                  headers={"content-type": "text/event-stream"})
        if self.refuse_json_mode and "response_format" in body:
            return self.error('Invalid JSON payload received. Unknown name "response_format".')
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(EXPLANATION)}}],
                                         "usage": {"prompt_tokens": 800, "completion_tokens": 90}})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def gemini_app(make_client, fake: FakeGemini) -> TestClient:
    return make_client(gcc_runner(), ai_transport=fake.transport, ai_provider="gemini",
                       gemini_api_key="test-gemini-key", evidence_secret=SECRET)


def test_a_gemini_api_key_alone_turns_saarthi_on(monkeypatch):
    for name in ("CC_AI_PROVIDER", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VERCEL", "1")
    assert ApiSettings().ai_provider == "gateway"
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    assert ApiSettings().ai_provider == "gemini"
    monkeypatch.setenv("CC_AI_PROVIDER", "gateway")  # an explicit choice still wins
    assert ApiSettings().ai_provider == "gateway"


def test_saarthi_streams_gemini_answers_and_sends_the_key_only_to_google(make_client):
    fake = FakeGemini()
    client = gemini_app(make_client, fake)
    status = client.get("/api/v1/assistant/status").json()
    assert status["enabled"] is True and status["provider"] == "gemini"
    assert status["model"] == "gemini-3.5-flash-lite" and "test-gemini-key" not in json.dumps(status)
    events = ask_streamed(client, {"question": "What is a loop?"})
    assert [e["text"] for e in events if e["type"] == "delta"] == ["A loop ", "repeats ", "code."]
    assert events[-1] == {"type": "done", "cached": False}
    assert fake.headers[0]["authorization"] == "Bearer test-gemini-key"
    assert fake.requests[0]["model"] == "gemini-3.5-flash-lite" and fake.requests[0]["stream"] is True


def test_gemini_explains_a_run_even_when_json_mode_is_refused(make_client):
    fake = FakeGemini(refuse_json_mode=True)
    client = gemini_app(make_client, fake)
    run = run_streamed(client, BROKEN)[-1]
    answer = client.post("/api/v1/assistant/explain", json={"executionId": run["id"], "sourceHash": sha(BROKEN)})
    assert answer.status_code == 200, answer.text
    assert answer.json()["problem"] == EXPLANATION["problem"]
    assert fake.requests[0]["response_format"] == {"type": "json_object"}
    assert "response_format" not in fake.requests[1] and len(fake.requests) == 2


def test_a_wrong_gemini_key_is_reported_as_a_rejected_key(make_client):
    fake = FakeGemini(bad_key=True)
    client = gemini_app(make_client, fake)
    events = ask_streamed(client, {"question": "What is a loop?"})
    assert events[-1]["type"] == "error" and "rejected the server's API key" in events[-1]["detail"]
    run = run_streamed(client, BROKEN)[-1]
    failed = client.post("/api/v1/assistant/explain", json={"executionId": run["id"], "sourceHash": sha(BROKEN)})
    assert failed.status_code == 502 and "rejected the server's API key" in failed.json()["detail"]
    assert len(fake.requests) == 2  # a bad key is not retried without JSON mode


def sse(*pieces: str) -> httpx.Response:
    events = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': p}}]})}\n\n" for p in pieces)
    return httpx.Response(200, content=(events + "data: [DONE]\n\n").encode(), headers={"content-type": "text/event-stream"})


def two_services(gemini, gateway) -> httpx.MockTransport:
    """One mock transport for Google's Gemini API and Vercel AI Gateway, told apart by host."""
    services = {"generativelanguage.googleapis.com": gemini, "ai-gateway.vercel.sh": gateway}
    return httpx.MockTransport(lambda request: services[request.url.host](request))


def test_gemini_and_ai_gateway_back_each_other_up_unless_turned_off():
    http = None  # never used: choosing a provider sends nothing
    both = choose_provider(ApiSettings(ai_provider="gemini", gemini_api_key="k", ai_gateway_api_key="g"), http).provider
    assert isinstance(both, FallbackProvider) and [p.name for p in both.providers] == ["gemini", "gateway"]
    assert (both.name, both.model) == ("gemini", "gemini-3.5-flash-lite")
    on_vercel = choose_provider(ApiSettings(ai_provider="gateway", gemini_api_key="k"), http, oidc_token=lambda: "t")
    assert [p.name for p in on_vercel.provider.providers] == ["gateway", "gemini"]
    alone = choose_provider(ApiSettings(ai_provider="gemini", gemini_api_key="k", ai_gateway_api_key="g",
                                        ai_backup=False), http).provider
    assert not isinstance(alone, FallbackProvider) and alone.name == "gemini"
    claude = choose_provider(ApiSettings(ai_provider="anthropic", anthropic_api_key="a", gemini_api_key="k"), http)
    assert claude.provider.name == "anthropic"


def test_ai_gateway_answers_when_gemini_is_out_of_free_quota(make_client):
    to_gateway: list[tuple[str, dict]] = []

    def gemini(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json=[{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                                    "message": "You exceeded your current quota."}}])

    def gateway(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        to_gateway.append((request.headers["authorization"], body))
        if body.get("stream"):
            return sse("From ", "the gateway.")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(EXPLANATION)}}]})

    client = make_client(gcc_runner(), ai_transport=two_services(gemini, gateway), ai_provider="gemini",
                         gemini_api_key="test-gemini-key", ai_gateway_api_key="gw-key", evidence_secret=SECRET)
    assert client.get("/api/v1/assistant/status").json()["provider"] == "gemini"
    events = ask_streamed(client, {"question": "What is a loop?"})
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "From the gateway."
    run = run_streamed(client, BROKEN)[-1]
    answer = client.post("/api/v1/assistant/explain", json={"executionId": run["id"], "sourceHash": sha(BROKEN)})
    assert answer.status_code == 200 and answer.json()["problem"] == EXPLANATION["problem"]
    assert {auth for auth, _ in to_gateway} == {"Bearer gw-key"}  # each service gets only its own key
    assert {body["model"] for _, body in to_gateway} == {"google/gemini-2.5-flash-lite"}


def test_when_neither_can_answer_students_see_the_first_providers_error(make_client):
    def gemini(request: httpx.Request) -> httpx.Response:
        return FakeGemini.error("API key not valid. Please pass a valid API key.")

    def gateway(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": {"type": "customer_verification_required", "message": "Add a card."}})

    client = make_client(gcc_runner(), ai_transport=two_services(gemini, gateway), ai_provider="gemini",
                         gemini_api_key="test-gemini-key", ai_gateway_api_key="gw-key", evidence_secret=SECRET)
    events = ask_streamed(client, {"question": "What is a loop?"})
    assert events[-1]["type"] == "error" and "rejected the server's API key" in events[-1]["detail"]


class CutOff(httpx.AsyncByteStream):
    """A streamed answer whose connection breaks after the first piece."""

    async def __aiter__(self):
        yield b'data: {"choices": [{"delta": {"content": "A loop "}}]}\n\n'
        raise httpx.ReadError("connection reset")


def test_an_answer_cut_off_midway_is_not_restarted_by_the_other_model(make_client):
    def gemini(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=CutOff(), headers={"content-type": "text/event-stream"})

    def gateway(request: httpx.Request) -> httpx.Response:
        raise AssertionError("the backup must not be asked to finish another model's answer")

    client = make_client(gcc_runner(), ai_transport=two_services(gemini, gateway), ai_provider="gemini",
                         gemini_api_key="test-gemini-key", ai_gateway_api_key="gw-key", evidence_secret=SECRET)
    events = ask_streamed(client, {"question": "What is a loop?"})
    assert [e["text"] for e in events if e["type"] == "delta"] == ["A loop "]
    assert events[-1]["type"] == "error"


def test_rate_limits_count_the_visitor_address_behind_vercels_proxy(make_client):
    client = gateway_app(make_client, FakeGateway(), ai_requests_per_minute=1, trust_proxy_headers=True)
    first = client.post("/api/v1/assistant/ask/stream", json={"question": "Q1"}, headers={"x-real-ip": "1.1.1.1"})
    assert first.status_code == 200
    other = client.post("/api/v1/assistant/ask/stream", json={"question": "Q2"}, headers={"x-real-ip": "2.2.2.2"})
    assert other.status_code == 200
    again = client.post("/api/v1/assistant/ask/stream", json={"question": "Q3"}, headers={"x-real-ip": "1.1.1.1"})
    assert again.status_code == 429


# ------------------------------------------------------- Vercel Sandbox runner


def fake_jwt(**claims) -> str:
    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
    payload = {"exp": int(time.time()) + 3600, "project_id": "prj_test", "owner_id": "team_test", **claims}
    return f"{part({'alg': 'RS256'})}.{part(payload)}.c2ln"


def untar(data: bytes) -> dict[str, tuple[bytes, int]]:
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(data))) as tar:
        return {m.name: (tar.extractfile(m).read() if m.isfile() else b"", m.mode) for m in tar.getmembers()}


class FakeSandboxApi:
    """The Vercel Sandbox REST API for one named sandbox, with the executor's answers."""

    def __init__(self, busy_first: int = 0, gone_once: bool = False) -> None:
        self.calls: list[tuple[str, str]] = []
        self.writes: list[dict[str, tuple[bytes, int]]] = []
        self.commands: list[dict] = []
        self.jobs: dict[str, dict] = {}
        self.busy_left = busy_first
        self.gone_once = gone_once
        self.session = 0
        self.auth: set[str] = set()

    def _session(self) -> dict:
        return {"id": f"sbx_{self.session}", "status": "running", "startedAt": int(time.time() * 1000),
                "timeout": 300_000}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        self.auth.add(request.headers["authorization"])
        assert request.url.params["teamId"] == "team_test"
        if request.method == "GET" and path == "/api/v2/sandboxes/kairo-runner":
            assert request.url.params["resume"] == "true" and request.url.params["projectId"] == "prj_test"
            if self.session == 0:
                self.session = 1
            return httpx.Response(200, json={"session": self._session(), "resumed": True})
        if path.endswith("/fs/write"):
            if self.gone_once:
                self.gone_once = False
                self.session += 1
                return httpx.Response(410, json={"error": "session stopped"})
            assert request.headers["content-type"] == "application/gzip" and request.headers["x-cwd"] == "/"
            files = untar(request.content)
            self.writes.append(files)
            for name, (data, _) in files.items():
                if name.startswith("tmp/kairo-in/") and data:
                    self.jobs["/" + name] = json.loads(data)
            return httpx.Response(200, json={})
        if path.endswith("/cmd"):
            body = json.loads(request.content)
            self.commands.append(body)
            started = json.dumps({"command": {"id": "cmd_x", "exitCode": None}}) + "\n"
            if body["command"] == "/usr/bin/install":
                done = json.dumps({"command": {"id": "cmd_x", "exitCode": 0}}) + "\n"
                return httpx.Response(200, content=(started + done).encode())
            assert body["command"] == "/usr/bin/python3" and body["args"][:3] == ["-I", "-S", EXECUTOR]
            assert body["sudo"] is True
            if self.busy_left:
                self.busy_left -= 1
                out = json.dumps({"stream": "stdout", "data": json.dumps({"type": "busy", "retryAfterS": 0}) + "\n"})
                return httpx.Response(200, content=(started + out + "\n").encode())
            job = self.jobs[body["args"][4]]
            events = ndjson_response(job, [
                StepResult(name="compile", termination=Termination.EXITED, exit_code=0, wall_ms=90),
                StepResult(name="run", termination=Termination.EXITED, exit_code=0, wall_ms=40, stdout="hi\n"),
            ]).content.decode()
            # The API streams stdout in arbitrary chunks: split one event line in two.
            chunks = [events[:25], events[25:]]
            lines = [json.dumps({"stream": "stdout", "data": c}) for c in chunks]
            done = json.dumps({"command": {"id": "cmd_x", "exitCode": 0}})
            return httpx.Response(200, content=(started + "\n".join(lines) + "\n" + done + "\n").encode())
        if path.endswith("/extend-timeout"):
            return httpx.Response(200, json={"session": self._session()})
        return httpx.Response(404, json={"error": f"unexpected {request.method} {path}"})

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def job(job_id: str = "job_1") -> JobSpec:
    return JobSpec.model_validate({
        "jobId": job_id, "image": "compiler-copilot/sandbox-gcc:13",
        "files": [{"path": "main.c", "content": "int main(){}"}],
        "steps": [{"name": "compile", "argv": ["gcc", "main.c"],
                   "limits": {"wallTimeMs": 10000, "cpuTimeS": 10, "memoryMb": 256, "pids": 64,
                              "outputKb": 64, "tmpMb": 16, "fileSizeMb": 8}},
                  {"name": "run", "argv": ["./a.out"],
                   "limits": {"wallTimeMs": 5000, "cpuTimeS": 5, "memoryMb": 128, "pids": 16,
                              "outputKb": 64, "tmpMb": 16, "fileSizeMb": 8}}],
    })


async def no_progress(event) -> None:
    pass


async def test_runner_installs_the_executor_once_per_session_then_runs_jobs():
    api = FakeSandboxApi()
    oidc = OidcToken()
    oidc.offer(fake_jwt())
    runner = VercelSandboxRunner("kairo-runner", ["compiler-copilot/sandbox-gcc:13"], b"print('executor')",
                                 oidc=oidc, transport=api.transport)
    seen: list[str] = []

    async def progress(event) -> None:
        seen.append(f"{event.type}:{event.step}")

    first = await runner.run(job("job_1"), progress)
    second = await runner.run(job("job_2"), no_progress)
    await runner.aclose()

    assert first.job_id == "job_1" and second.job_id == "job_2"
    assert [s.name for s in first.steps] == ["compile", "run"] and first.steps[1].stdout == "hi\n"
    assert seen == ["step_started:compile", "step_finished:compile", "step_started:run", "step_finished:run"]
    # The first job also uploads the executor and installs it as root; the second does not.
    assert set(api.writes[0]) >= {"tmp/kairo-in/job_1.json", "tmp/kairo-up/kairo_exec.py"}
    assert api.writes[0]["tmp/kairo-up/kairo_exec.py"][0] == b"print('executor')"
    assert api.writes[0]["tmp/kairo-in/job_1.json"][1] == 0o600
    assert "tmp" not in api.writes[0]  # never touches /tmp itself
    assert set(api.writes[1]) == {"tmp/kairo-in", "tmp/kairo-in/job_2.json"}
    installs = [c for c in api.commands if c["command"] == "/usr/bin/install"]
    assert len(installs) == 1 and installs[0]["sudo"] is True
    assert installs[0]["args"] == ["-D", "-o", "root", "-g", "root", "-m", "0755", "/tmp/kairo-up/kairo_exec.py", EXECUTOR]
    # Only one session lookup: the session is reused while it has time left.
    assert [c for c in api.calls if c[0] == "GET"] == [("GET", "/api/v2/sandboxes/kairo-runner")]
    assert api.auth == {f"Bearer {oidc.token()}"}


async def test_runner_waits_for_a_free_slot_and_restarts_a_stopped_session():
    api = FakeSandboxApi(busy_first=2, gone_once=True)
    oidc = OidcToken()
    oidc.offer(fake_jwt())
    runner = VercelSandboxRunner("kairo-runner", [], b"x", oidc=oidc, transport=api.transport)
    result = await runner.run(job(), no_progress)
    await runner.aclose()
    assert result.steps[-1].stdout == "hi\n"
    assert len([c for c in api.calls if c[0] == "GET"]) == 2  # looked up again after the 410
    runs = [c for c in api.commands if c["command"] == "/usr/bin/python3"]
    assert len(runs) == 3  # busy, busy, then the job


async def test_runner_gives_up_when_the_vm_stays_busy():
    api = FakeSandboxApi(busy_first=1000)
    oidc = OidcToken()
    oidc.offer(fake_jwt())
    runner = VercelSandboxRunner("kairo-runner", [], b"x", oidc=oidc, transport=api.transport, busy_patience_s=0.2)
    with pytest.raises(RunnerBusy):
        await runner.run(job(), no_progress)
    await runner.aclose()


async def test_runner_without_a_token_or_executor_says_why():
    runner = VercelSandboxRunner("kairo-runner", [], b"x", oidc=OidcToken())
    with pytest.raises(Exception, match="OIDC"):
        await runner.run(job(), no_progress)
    missing = VercelSandboxRunner("kairo-runner", [], None, oidc=OidcToken())
    assert (await missing.health())["status"] == "error"
    with pytest.raises(Exception, match="kairo_exec.py"):
        await missing.run(job(), no_progress)
    await runner.aclose()
    await missing.aclose()


def test_oidc_token_prefers_the_freshest_unexpired_token():
    oidc = OidcToken()
    oidc.offer("not-a-jwt")
    oidc.offer(fake_jwt(exp=int(time.time()) - 10))
    assert oidc.token() is None
    later = fake_jwt(exp=int(time.time()) + 7200)
    oidc.offer(fake_jwt())
    oidc.offer(later)
    oidc.offer(fake_jwt())
    assert oidc.token() == later and oidc.credentials() == (later, "prj_test", "team_test")


@pytest.fixture
def fresh_oidc():
    OIDC._token, OIDC._payload = None, {}
    yield OIDC
    OIDC._token, OIDC._payload = None, {}


def test_the_api_runs_code_in_the_vercel_sandbox_with_the_requests_oidc_token(tmp_path, fresh_oidc):
    executor = tmp_path / "kairo_exec.py"
    executor.write_text("# the executor\n")
    api = FakeSandboxApi()
    settings = ApiSettings(runner_backend="vercel-sandbox", vercel_executor=executor, ai_provider="none",
                           evidence_secret=SECRET)
    with TestClient(create_app(settings, runner_transport=api.transport)) as client:
        health = client.get("/api/v1/health").json()
        assert health["runner"]["backend"] == "vercel-sandbox" and health["status"] == "ok"
        token = fake_jwt()
        with client.stream("POST", "/api/v1/executions/run", headers={"x-vercel-oidc-token": token},
                           json={"languageId": "c", "source": "int main(){}", "stdin": ""}) as response:
            snapshots = [json.loads(line) for line in response.iter_lines() if line.strip()]
    assert snapshots[-1]["state"] == "SUCCEEDED" and snapshots[-1]["evidence"]
    assert api.auth == {f"Bearer {token}"}
    assert api.writes[0]["tmp/kairo-up/kairo_exec.py"][0] == b"# the executor\n"


# --------------------------------------------------------------- keep-alive


def test_keepalive_needs_the_cron_secret_when_one_is_set(make_client, monkeypatch, fresh_oidc):
    from app.api.v1 import system

    async def database(settings):
        return {"status": "ok", "url": settings.supabase_url}

    monkeypatch.setattr(system, "_ping_database", database)
    monkeypatch.setattr(system, "_last", {"at": 0.0, "result": None})
    client = make_client(cron_secret="cron-123", supabase_url="https://db.test")
    assert client.get("/api/v1/system/keepalive").status_code == 401
    assert client.get("/api/v1/system/keepalive", headers={"authorization": "Bearer wrong"}).status_code == 401
    ok = client.get("/api/v1/system/keepalive", headers={"authorization": "Bearer cron-123"})
    assert ok.status_code == 200
    assert ok.json()["database"] == {"status": "ok", "url": "https://db.test"}
    assert ok.json()["runner"]["status"] == "skipped"  # the Docker runner needs no wake-up


def test_keepalive_wakes_the_runner_vm(tmp_path, monkeypatch, fresh_oidc):
    from app.api.v1 import system

    monkeypatch.setattr(system, "_last", {"at": 0.0, "result": None})
    api = FakeSandboxApi()
    settings = ApiSettings(runner_backend="vercel-sandbox", vercel_executor=tmp_path / "missing.py",
                           ai_provider="none")
    with TestClient(create_app(settings, runner_transport=api.transport)) as client:
        body = client.get("/api/v1/system/keepalive", headers={"x-vercel-oidc-token": fake_jwt()}).json()
    assert body["runner"] == {"status": "ok", "session": "running", "resumed": True}
    assert body["database"]["status"] == "skipped"


def test_on_vercel_the_function_serves_the_web_app_with_long_caching_for_built_files(tmp_path, monkeypatch):
    # When the build does not move the files to the CDN, the function serves them; hashed
    # files under /assets/ may then be cached for a year, the page itself is not.
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>KAIRO</title>")
    (dist / "assets" / "index-abc123.js").write_text("console.log('kairo')")
    monkeypatch.setenv("VERCEL", "1")
    settings = ApiSettings(web_dist=dist, runner_backend="http", ai_provider="none")
    with TestClient(create_app(settings, runner_transport=gcc_runner().transport)) as client:
        asset = client.get("/assets/index-abc123.js")
        assert asset.status_code == 200 and "kairo" in asset.text
        assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert asset.headers["cdn-cache-control"] == "max-age=31536000"
        page = client.get("/?source=app", headers={"accept": "text/html"})  # the installed app's start page
        assert page.status_code == 200 and "<title>KAIRO</title>" in page.text
        page = client.get("/any/route", headers={"accept": "text/html,*/*;q=0.8"})  # a browser navigation
        assert page.status_code == 200 and "<title>KAIRO</title>" in page.text
        assert "immutable" not in page.headers.get("cache-control", "")
        assert client.get("/api/v1/health").json()["api"] == "ok"  # API routes come first
        missing = client.get("/assets/missing-0000.js")  # e.g. a chunk of an older deployment
        assert missing.status_code == 404 and "immutable" not in missing.headers.get("cache-control", "")
        # Streamed responses pass through untouched.
        snapshots = run_streamed(client, FIXED)
        assert snapshots[-1]["state"] == "SUCCEEDED"


def test_vercel_defaults(monkeypatch):
    for name in ("CC_RUNNER_BACKEND", "CC_AI_PROVIDER", "CC_TRUST_PROXY_HEADERS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VITE_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("CRON_SECRET", "c")
    settings = ApiSettings()
    assert settings.runner_backend == "vercel-sandbox" and settings.ai_provider == "gateway"
    assert settings.trust_proxy_headers is True and settings.supabase_url == "https://example.supabase.co"
    assert settings.cron_secret.get_secret_value() == "c"
    assert settings.vercel_executor.is_file()  # infra/vercel/runner/kairo_exec.py
    monkeypatch.setenv("CC_RUNNER_BACKEND", "http")
    assert ApiSettings().runner_backend == "http"
    monkeypatch.delenv("VERCEL")
    monkeypatch.delenv("CC_RUNNER_BACKEND")
    assert ApiSettings().runner_backend == "http" and ApiSettings().ai_provider == "anthropic"
