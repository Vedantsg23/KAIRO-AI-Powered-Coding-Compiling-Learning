# Saarthi, the AI guide

Saarthi explains problems, proposes small fixes and answers questions, inside
KAIRO. The AI model is optional: without one, the editor, the live analysis,
compiling and running all work, and Saarthi still answers from KAIRO's
built-in knowledge (see [Offline Saarthi](#offline-saarthi-no-model)), clearly
marked as not AI.

## What a student can do

| Action | Where | What happens |
|---|---|---|
| **Explain** | "Explain" on a problem card, or Ctrl+Shift+Enter in the editor | Saarthi explains that diagnostic of the last run: what went wrong, what happened, why, which line to look at, what to change, related concepts, and a confidence level. |
| **Suggest a fix** | "Fix" on a problem card | Saarthi proposes the smallest edit as a line diff. **Nothing changes** until the student presses *Apply* or *Apply & verify*. |
| **Apply & verify** | on the suggested patch | The patch is applied (one Ctrl+Z undoes it, or *Undo fix*) and the program is run again; the verdict comes from that run, not from the model. |
| **Ask** | the Saarthi chat panel (right side, like Copilot) | A free question about the code, a concept or the last run, sent when the student presses Enter or taps a suggestion ("Explain this error", "Give me a hint"...). The answer **streams in word by word**; *Stop* ends it early, *New chat* starts over, each answer has a copy button. Without a model, the offline Saarthi answers. |
| **Live analysis** | the Saarthi panel's "Live analysis" card | While the student types: syntax errors, possible typos ("Did you mean `printf`?") and tips, each with the line and, when it is safe, a one-click fix. Computed in the browser, never sent anywhere. |
| **AI autocomplete** | the editor, when the student switches the extension on | After a short pause in typing, a suggestion for the next lines appears as grey ghost text; Tab accepts it, Esc or typing on dismisses it. Off by default. |

Every explanation carries the label "AI explanation · not verified: run your
code to check". A fix is called verified only when a real run of exactly the
patched code finishes without errors.

## What Saarthi is given (and what it is not)

Answers are **grounded in one run**. For *explain* and *fix*, the server (never
the browser) builds the evidence from the stored execution:

* the exact source snapshot of that run, as a numbered listing (whole file up
  to 400 lines, otherwise windows of 20 lines around the relevant lines);
* the normalized diagnostics (up to 12): code, category, message, line and
  column, related notes such as "declared here", with the chosen one marked
  as the focus;
* the run's final state, exit status or signal, and the program's input and
  output (stdout from its start, stderr from its end, a few KB at most);
* the language and toolchain version.

For *ask*, the evidence is the last run if its code is still what is in the
editor, otherwise the editor's code, plus up to 8 earlier turns of the chat.

The request must carry the editor's current source hash. If the code changed
since the run, the API answers `409` and the panel asks the student to run
again: an answer never describes code that is no longer there.

On Vercel every request may reach a different server instance, so the run the
answer is grounded in travels with the request: the API signs the run's
evidence (HMAC with `CC_EVIDENCE_SECRET`) when the run finishes, the browser
sends it back with *explain*, *fix* and *ask*, and the API checks the
signature and the source hash before using it. A suggested fix is signed the
same way (`fixToken`) so *Apply & verify* works on any instance. Tampered or
foreign evidence is refused (`404`), and old evidence for code that changed is
`409` as above.

## Streaming answers

`POST /api/v1/assistant/ask/stream` takes the same body as `/ask` and answers
with newline-delimited JSON (`application/x-ndjson`), one event per line:

| Event | Fields | Meaning |
|---|---|---|
| `start` | `groundedOn`, `executionId`, `sourceHash`, `provider`, `model` | What the answer is grounded in (a run, or the editor's code). |
| `delta` | `text` | The next piece of the answer; the panel appends it as it arrives. |
| `done` | `cached` | The answer is complete (and now cached). |
| `error` | `detail`, `retryAfterS` | The model failed or took too long after the stream started; the panel keeps what arrived and shows the message. |

Stale code (`409`) and rate limits (`429`) are ordinary HTTP errors, returned
before the stream starts. An identical question within the cache time replays
the cached answer as a quick stream and does not count against the limits.
Answers stop at 6,000 characters. The panel draws the arriving text once per
animation frame, so long answers stay smooth.

Nothing is sent while the student types, and the live check never calls the
server or the AI, with one exception the student chooses: the **AI
autocomplete** extension (off by default). When it is on, about 0.5 s after the
last keystroke the editor sends the code around the cursor (up to 4,000
characters before it and 1,500 after it) to `POST /api/v1/assistant/complete`,
which asks the model for at most 4 lines. Completions have their own rate
limits (below), so they never use up the questions. The editor asks again after
each pause, also right after a completion item or snippet was accepted (when
Monaco would not ask by itself), and a newer keystroke cancels the request in
flight. When the suggestion also types the characters already after the cursor
(an auto-closed `)` for example), accepting it replaces them instead of
doubling them. Notebook cells get the same ghost text, as Python.

## Keeping answers honest

| Gate | How |
|---|---|
| Structured answers | Claude is called with a forced tool call whose JSON schema is the answer format; OpenAI-compatible servers use JSON mode. Anything that does not validate is rejected ("Saarthi's answer was incomplete. Please try again."). |
| Evidence only | The system prompt tells the model to use only the evidence, to say when it does not show the cause (low confidence) and never to claim that code works. |
| Untrusted text stays data | Code, input, output and questions are wrapped in tags the system prompt declares to be data; tag names inside them are defused so a program cannot "close" a tag and pose as the platform. |
| Lines exist | A line number outside the file is dropped from the answer. |
| Patch policy | Edits are whole-line replacements of the snapshot: in range, not overlapping, at most 60 changed lines, must change something, and the result must stay within the source size limit. |
| Exact snapshot | A fix is stored with the hash of the code it was made for and of the patched code; the browser refuses to apply it to anything else. |
| Verification by running | `/assistant/verify` compares the run of the patched code with the original run. It never asks the model. |

Verdicts of `/assistant/verify`:

| Verdict | Meaning | `verified` |
|---|---|---|
| `fixed` | The patched program ran and finished without errors. | true |
| `improved` | The targeted problem is gone, but the run still reports other errors. | false |
| `not_fixed` | The same problem is still there. | false |
| `different_code` | The run was not of exactly the patched code (it was edited further). | false |

## Configuration

Set on the API process (never in the browser; `.env` is not committed):

| Variable | Default | Meaning |
|---|---|---|
| `CC_AI_PROVIDER` | `gateway` on Vercel, otherwise `anthropic` | `anthropic`, `openai` (any OpenAI-compatible server), `gateway` (Vercel AI Gateway) or `none` |
| `ANTHROPIC_API_KEY` | empty | Key for Claude. Without it Saarthi is off. |
| `CC_AI_MODEL` | `claude-haiku-4-5-20251001`; `google/gemini-3.5-flash-lite` with `gateway` | Model id, e.g. `claude-sonnet-5` for deeper answers |
| `CC_AI_BASE_URL` | empty | For `openai`: e.g. `http://127.0.0.1:11434/v1` (Ollama) |
| `CC_AI_API_KEY` or `OPENAI_API_KEY` | empty | For `openai` servers that need a key (Ollama does not) |
| `CC_AI_TIMEOUT_S` | 45 | Per request |
| `CC_AI_MAX_OUTPUT_TOKENS` | 1500 | Per answer |
| `CC_AI_REQUESTS_PER_MINUTE` | 10 | Per client (IP address; on Vercel the address Vercel reports in `x-real-ip`) |
| `CC_AI_REQUESTS_PER_DAY` | 150 | Per client |
| `CC_AI_DAILY_BUDGET` | 3000 | For the whole server |
| `CC_AI_MAX_CONCURRENCY` | 4 | Requests in flight to the provider |
| `CC_AI_CACHE_TTL_S` | 1800 | Identical requests (same model, run, diagnostic, question) are answered from memory, marked `cached`, and do not count against the limits |
| `CC_AI_COMPLETE_PER_MINUTE` | 30 | AI autocomplete requests per client |
| `CC_AI_COMPLETE_PER_DAY` | 1500 | AI autocomplete requests per client per day |
| `CC_AI_COMPLETE_DAILY_BUDGET` | 20000 | AI autocomplete requests for the whole server per day |

`GET /api/v1/assistant/status` reports whether Saarthi is enabled, the
provider and model, and the limits; it never returns a key.

### Vercel AI Gateway (the live site)

On Vercel the API uses `gateway` by default and signs in with the
deployment's own OIDC token (Vercel adds it to every request), so **no AI key
is stored anywhere**: enable AI Gateway for the team in the Vercel dashboard
(the free monthly credit is enough for a class), redeploy, and Saarthi is on.
To choose another model, set `CC_AI_MODEL` to any model id from the Gateway's
model list (for example `anthropic/claude-haiku-4.5`). Outside Vercel the
gateway can be used with `AI_GATEWAY_API_KEY`.

### Claude

1. Create a key in the Claude Console (platform.claude.com) and set a spending limit there.
2. Put it in `.env` as `ANTHROPIC_API_KEY=...` (compose), in the environment
   before `make api`, or as a Codespaces secret ([codespaces.md](codespaces.md)).

### A local model with Ollama (free, code stays on the machine)

```bash
ollama pull llama3.1
CC_AI_PROVIDER=openai CC_AI_BASE_URL=http://127.0.0.1:11434/v1 CC_AI_MODEL=llama3.1 make api
```

(With compose, use `http://host.docker.internal:11434/v1` and make sure the API
container can reach the host.) Small local models follow the answer format
less reliably; rejected answers show "please try again".

### Free hosted models (OpenAI-compatible)

Any server that speaks the OpenAI chat-completions format works with
`CC_AI_PROVIDER=openai`. Some offer a free tier that is enough for a class or a
demo; their models, limits and terms change, so check the provider's page
before relying on one, and never commit the key.

| Provider | `CC_AI_BASE_URL` | Key variable | Notes |
|---|---|---|---|
| Google Gemini API | `https://generativelanguage.googleapis.com/v1beta/openai/` | `CC_AI_API_KEY` (a key from Google AI Studio) | Use a current "Flash" model id from Google's OpenAI-compatibility page. |
| Groq | `https://api.groq.com/openai/v1` | `CC_AI_API_KEY` (from the Groq console) | Very fast open models; pick a model id from the console. |
| OpenRouter | `https://openrouter.ai/api/v1` | `CC_AI_API_KEY` | Many models, some marked free. |

```bash
# .env (not committed)
CC_AI_PROVIDER=openai
CC_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
CC_AI_MODEL=<a current Gemini Flash model id>
CC_AI_API_KEY=<your key>
```

None of these was tested where KAIRO was built (no keys were available). The
answers for Explain and Fix must follow a JSON format; KAIRO asks for JSON mode
and also accepts JSON inside a Markdown code block, and rejects anything else
with "please try again". Try Explain on the C "missing semicolon" example
after configuring a provider.

### Privacy

With a hosted provider, the evidence above (the student's code, its input and
output) is sent to that provider when a student presses a Saarthi button. Tell
students so; use a local model where code must not leave the network.

## Offline Saarthi (no model)

When the server has no model configured, or the model cannot be reached, the
panel's question box still works: the browser answers from KAIRO's own
knowledge (`apps/web/src/assistant/offline.ts` and `knowledge.ts`). It can:

* explain the problems in the code as it is now (the live analysis: syntax
  errors, possible typos and tips, with their quick fixes) and the errors of
  the last run, using the same plain-language notes as the diagnostics list;
* explain about 40 concepts (pointers, recursion, arrays, the phases of a
  compiler, the preprocessor and the linker, segmentation faults, Turbo C
  habits such as `conio.h` and `void main`...), with an example in the
  current language family;
* show how to do common tasks ("how do I read input", "reverse a string",
  "sort an array", "find the largest number") in C, C++, Java, Python and
  JavaScript;
* summarise the program (functions, loops, decisions, input and output) and
  estimate each function's time complexity from its loops and recursion.

Every such answer ends with "Offline Saarthi · KAIRO's built-in knowledge, not
an AI model", and when a model is configured but failed, the answer says why.

## Testing

* `services/api/tests/test_assistant.py` (21 tests) drives every endpoint with
  a scripted fake Claude on the wire (the real Messages API request format):
  grounding, stale hashes, patch validation, verdicts, rate limits, cache,
  prompt-injection text staying inside the evidence, keys never exposed.
* `services/api/tests/test_vercel.py` covers the live-site setup: streamed
  answers from a fake AI Gateway (server-sent events), the cached replay,
  `409`/`429` before the stream and the `error` event after it, signed
  evidence and fix tokens across server instances (tampered, foreign or stale
  evidence refused), and per-visitor limits behind Vercel's proxy.
* `scripts/mock_llm.py` is a canned OpenAI-compatible server for the browser
  tests and offline demos. **It is not an AI**: it restates the focused
  diagnostic, fixes only "missing ';'", completes only a few fixed line
  endings (`printf(`, `for (`, `print(`), and labels every answer "(mock)".
  It streams when asked to, three words at a time.
  `make mock-ai` + `make api-mock` start it; `apps/web/e2e/saarthi.spec.ts`
  runs only against it.
* `apps/web/e2e/extensions.spec.ts` turns the AI autocomplete extension on and
  checks that ghost text appears after `printf(`, that Tab accepts it and that
  the auto-closed `)` is not doubled. `apps/web/e2e/notebook.spec.ts` checks
  the notebook's error notes (the "Ask Saarthi why" button needs a model).
* Not yet exercised: a real Claude or Ollama model (no key was available where
  this was built). The first time a key is configured, try Explain and Fix on
  the C "missing semicolon" and "typo" examples and check that the answers
  refer to the right lines.
