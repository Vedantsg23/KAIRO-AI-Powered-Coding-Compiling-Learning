# API contracts

JSON field names are camelCase. The machine-readable versions are generated in
`packages/contracts/` (`openapi.json`, `diagnostic.schema.json`,
`runner-contract.schema.json`); this page explains them. Interactive docs are
served by the API at `/docs` while it runs.

## Public API (`/api/v1`)

### `GET /api/v1/languages`
All 16 language profiles, with the exact trusted commands and limits, whether
each is stable or experimental, and whether its sandbox image is installed on
the runner right now (`available`: `true`, `false`, or `null` when the runner
cannot be reached). The web app offers only stable languages that are not
known to be missing, and experimental ones only when `available` is `true`.

```json
[{
  "id": "c", "displayName": "C", "editorMode": "c", "sourceFile": "main.c",
  "toolchain": {"name": "GCC", "declaredVersion": "13", "image": "compiler-copilot/sandbox-gcc:13"},
  "steps": [
    {"name": "compile", "kind": "compile", "label": "Compile", "argv": ["gcc", "-std=gnu17", "..."],
     "limits": {"wallTimeMs": 10000, "memoryMb": 256, "outputKb": 64}},
    {"name": "run", "kind": "run", "label": "Run", "argv": ["stdbuf", "-oL", "/workspace/main"],
     "limits": {"wallTimeMs": 5000, "memoryMb": 256, "outputKb": 64}}
  ],
  "status": "stable",
  "available": true
}]
```

### `POST /api/v1/executions`
Queues a compile-and-run of a source snapshot and returns immediately.

Request:
```json
{"languageId": "c", "source": "#include <stdio.h>\n...", "stdin": ""}
```

| Status | Meaning |
|---|---|
| `202` | Accepted. Body: the execution (state `QUEUED`, with `queuePosition`). |
| `409` | The language's sandbox image is not installed on the runner (the body says which). |
| `413` | Source larger than 64 KB or input larger than 16 KB (configurable). |
| `422` | Unknown language or malformed body. |
| `503` | The queue is full. `Retry-After` header and `retryAfterS` in the body say when to try again. |

### `POST /api/v1/executions/run`
The same request as `POST /executions`, answered with a stream instead of a
single snapshot: `200` with `Content-Type: application/x-ndjson`, one full
execution snapshot (the JSON of `GET /executions/{id}`) per line whenever the
run changes, ending with the terminal snapshot. A blank line is sent every 10 s
while nothing changes, so proxies keep a quiet stream open. Refusals (`409`,
`413`, `422`, `503`) are ordinary responses before the stream starts.

This is what the web app uses for every run, the notebook and sandbox
formatting: it needs no WebSocket and no second request, so it also works on
serverless hosts such as Vercel, where the next request may reach another
instance.

The terminal snapshot carries `evidence`: the run (source snapshot,
diagnostics, output) signed by the API (HMAC). The browser hands it back to
Saarthi with *explain*, *fix* and *ask*, so any instance can answer about the
run; a changed or foreign token is refused. It is not encrypted: it holds only
what the browser already has.

### `GET /api/v1/executions/{id}`
The current snapshot. `404` if unknown or evicted. A real response for a
missing semicolon (stderr shortened):

```json
{
  "id": "exe_78494cb9f57f12d2c6de3fd6",
  "languageId": "c",
  "state": "COMPILE_ERROR",
  "terminal": true,
  "summary": "Compilation failed: 1 error, 1 warning",
  "sourceHash": "sha256:81146b0e4b7b8fae2a87542ab40c56e1a41072eb9db5fc99e3bd9db8c5f6865e",
  "sourceBytes": 90,
  "queuePosition": null,
  "createdAt": "2026-09-26T10:01:51.590788Z",
  "startedAt": "2026-09-26T10:01:51.591262Z",
  "finishedAt": "2026-09-26T10:01:51.846131Z",
  "toolchain": {"name": "GCC", "version": "13.3.0", "image": "compiler-copilot/sandbox-gcc:13",
                "imageId": "sha256:2c21f013f664712f48dcd1deac7ec293d024759b34f052296e55bbfdee7e8e88"},
  "steps": [
    {"name": "compile", "kind": "compile", "status": "FAILED", "termination": "EXITED",
     "exitCode": 1, "signal": null, "signalName": null, "durationMs": 90, "wallMs": 126,
     "stdout": "", "stderr": "main.c: In function 'main':\nmain.c:5:5: error: expected ',' or ';' before 'printf'\n...",
     "stdoutTruncated": false, "stderrTruncated": false, "peakMemoryBytes": null,
     "limits": {"wallTimeMs": 10000, "memoryMb": 256, "outputKb": 64}},
    {"name": "run", "kind": "run", "status": "SKIPPED", "termination": null, "...": "..."}
  ],
  "diagnostics": [
    {
      "id": "diag_05f638635fb5276c",
      "source": "compiler",
      "severity": "error",
      "category": "syntax",
      "code": "C_MISSING_SEMICOLON",
      "message": "expected ',' or ';' before 'printf'",
      "file": "main.c",
      "range": {"startLine": 5, "startColumn": 5, "endLine": 5, "endColumn": 11},
      "relatedLocations": [{
        "file": "main.c",
        "range": {"startLine": 4, "startColumn": 13, "endLine": 4, "endColumn": 14},
        "message": "The missing ';' probably belongs at the end of this line."
      }],
      "executionId": "exe_78494cb9f57f12d2c6de3fd6",
      "rawOutputReference": {"step": "compile", "stream": "stderr", "startLine": 2, "endLine": 4}
    }
  ],
  "error": null
}
```

`state` is one of `QUEUED, STARTING, COMPILING, RUNNING, SUCCEEDED,
COMPILE_ERROR, RUNTIME_ERROR, TIMEOUT, MEMORY_LIMIT, REJECTED, CANCELLED,
INTERNAL_ERROR`. Step `status` is `PENDING, RUNNING, SUCCEEDED, FAILED,
SKIPPED`; `termination` is `EXITED, SIGNALED, TIMEOUT, MEMORY_LIMIT,
OUTPUT_LIMIT, INTERNAL_ERROR`.

### `WS /api/v1/executions/{id}/events`
Sends the full execution snapshot (same JSON as `GET`) immediately and again
after every change, then closes with code `1000` after the terminal snapshot.
Unknown ids close with code `4404`. Clients should fall back to polling `GET`
if the socket cannot be opened (the web app does).

The API does not see accounts (guest profiles live in the browser, accounts
and their saved work between the browser and Supabase; see
[accounts.md](accounts.md)): the random execution id is the only credential
needed to read a result. No long-lived secret is ever placed in the WebSocket
URL.

### `GET /api/v1/health`
`{"status": "ok"|"degraded", "api": "ok", "runner": {...}, "queue": {"depth", "capacity", "workers"}}`.
The web app uses it for the status-bar indicator. On Vercel `runner` reads
`{"status", "backend": "vercel-sandbox", "images"}` without starting the
runner VM.

### `GET /api/v1/system/keepalive`
Called once a day by Vercel Cron (`vercel.json`): calls the Supabase function
`keepalive()` so the free project is never paused, and wakes the runner VM so
its snapshot does not expire. Returns
`{"database": {"status": "ok"|"skipped"|"error", ...}, "runner": {"status", ...}}`.
With `CRON_SECRET` set it requires `Authorization: Bearer <CRON_SECRET>`
(`401` otherwise); without it anyone may call it, and it does its work at most
once every 10 minutes per instance.

## The diagnostic format

One shape for every producer: compilers and runtimes (the browser's live
syntax check uses the same positions but stays in the browser).

| Field | Meaning |
|---|---|
| `id` | Deterministic per execution (`diag_` + hash of execution id, position in the list, code) |
| `source` | `local`, `compiler` or `runtime` |
| `severity` | `error`, `warning` or `info` |
| `category` | `syntax`, `name`, `type`, `build`, `runtime`, `timeout`, `memory`, `other` |
| `code` | Stable identifier. Language codes are prefixed (`C_UNDECLARED_IDENTIFIER`); platform events are not (`RUNTIME_SEGMENTATION_FAULT`, `LIMIT_TIMEOUT`, `UNPARSED`, `TOOLCHAIN_FAILED`) |
| `message` | The toolchain's message, unchanged, or a synthesized plain-language one |
| `file` | Workspace-relative path (`main.c`); `null` if not tied to a file |
| `range` | 1-based lines; 1-based **UTF-16** columns (as in Monaco/LSP); end exclusive; `null` if unknown |
| `relatedLocations` | Compiler notes ("declared here") and deterministic hints |
| `executionId` | The execution that produced it (`null` for local diagnostics) |
| `rawOutputReference` | Step, stream and 1-based line span in the bounded raw output |

Rules:
* Nothing the toolchain prints is dropped: unrecognized lines become one
  `UNPARSED` info diagnostic that points at the raw text.
* A crash or limit that prints nothing still produces a diagnostic.
* A result is shown as current only while the editor's SHA-256 equals
  `sourceHash`.

## Internal: API to runner (not reachable from browsers)

`POST http://runner:8081/v1/jobs` with header `X-Runner-Token`. Body (`JobSpec`):

```json
{
  "jobId": "exe_...",
  "image": "compiler-copilot/sandbox-gcc:13",
  "files": [{"path": "main.c", "content": "..."}],
  "steps": [
    {"name": "compile", "argv": ["gcc", "..."], "workdir": "/workspace", "workspaceMode": "rw",
     "env": {"LC_ALL": "C"}, "stdin": null,
     "limits": {"wallTimeMs": 10000, "cpuTimeS": 10, "memoryMb": 256, "pids": 64,
                "outputKb": 64, "tmpMb": 64, "fileSizeMb": 64}},
    {"name": "run", "argv": ["stdbuf", "-oL", "/workspace/main"], "workdir": "/tmp",
     "workspaceMode": "ro", "env": {}, "stdin": "...", "limits": {"...": "..."}}
  ]
}
```

The response is NDJSON, one event per line:

```text
{"type":"step_started","jobId":"exe_...","step":"compile",...}
{"type":"step_finished","jobId":"exe_...","step":"compile","termination":"EXITED","exitCode":0,...}
{"type":"step_started","jobId":"exe_...","step":"run",...}
{"type":"step_finished","jobId":"exe_...","step":"run","termination":"SIGNALED","exitCode":139,...}
{"type":"job_finished","jobId":"exe_...","result":{JobResult}}
```

Refusals happen before streaming: `401` wrong token, `400` policy violation
(image not allowed, limit above ceiling, unsafe file name, oversized input),
`503` at capacity with `Retry-After`.

## Saarthi (`/api/v1/assistant`)

Design and safeguards: [saarthi.md](saarthi.md). Explain, fix and ask call the
AI provider (rate-limited per client); verify never does. Errors use the same
`{"detail": ..., "retryAfterS": ...}` body as the rest of the API.

| Endpoint | Request | Response |
|---|---|---|
| `GET /status` | — | `{enabled, provider, model, reason, requestsPerMinute, requestsPerDay}` (never a key) |
| `POST /explain` | `{executionId, sourceHash, diagnosticId?, question?, evidence?}` | `{problem, whatHappened, why, location: {line} \| null, suggestedFix, relatedConcepts[], confidence, diagnosticIds[], focusDiagnosticId, sourceHash, verified: false, provider, model, cached}` |
| `POST /fix` | `{executionId, sourceHash, diagnosticId?, evidence?}` | `{fixId, fixToken, baseSourceHash, patchedSource, patchedSourceHash, summary, edits: [{startLine, endLine, replacement}], targetCodes[], confidence, verified: false, ...}` |
| `POST /verify` | `{fixId, executionId, fixToken?, evidence?}` (the run of the patched code) | `{verdict: "fixed" \| "improved" \| "not_fixed" \| "different_code", verified, message, beforeState, afterState, beforeErrors, afterErrors}` |
| `POST /ask` | `{question, languageId?, executionId? + sourceHash? \| source?, diagnosticId?, evidence?, history[] (up to 8 turns)}` | `{answer, groundedOn: "execution" \| "source" \| "none", ...}` |
| `POST /ask/stream` | the same as `/ask` | `application/x-ndjson`: `start`, then `delta` events with the next piece of text, then `done` (or `error`); see [saarthi.md](saarthi.md#streaming-answers) |

| Status | Meaning |
|---|---|
| `404` | Unknown or expired run, diagnostic or fix, or evidence / a fix token that does not check out |
| `409` | The code changed since the run (`sourceHash` differs), or the run has not finished |
| `422` | Nothing to explain or fix (a clean run), or no small safe fix exists |
| `429` | A rate limit or the daily budget was reached (`Retry-After`) |
| `502` | The AI provider failed or timed out, or its answer failed validation |
| `503` | Saarthi is not configured on this server |

`verified` is `false` on every explanation and fix. Only `/verify` can return
`true`, and only when the run of exactly the patched code finished without
errors.
