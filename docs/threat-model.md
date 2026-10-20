# Threat model

The platform compiles and runs code written by people we do not control, in
32 languages (plus Python notebooks, and formatters that reformat code in the
sandbox), and can send a student's code to an AI provider when the student
asks Saarthi for help or switches on AI autocomplete. HTML, CSS and React run in
the student's own browser, in a sandboxed frame with an opaque origin. This document states what is protected, from whom, how,
how that was tested, and what is **not** protected yet. A normal container is
not treated as a perfect security boundary.

## 1. Assets

1. The host machine: its files, processes, network position and other services.
2. Availability for the whole lab: CPU, memory, disk, the job queue.
3. Other users' code and results.
4. Secrets: `RUNNER_TOKEN` and the AI provider's API key.
5. The AI budget: every Saarthi answer from a hosted model costs money.

## 2. Actors

| Actor | Capability |
|---|---|
| Student, curious or malicious | Submits arbitrary source and input in any of the 32 languages or a notebook; asks Saarthi anything |
| Someone on the lab network | Can reach the published API port (there are no accounts yet) |
| Text inside a program | Comments, strings or output written to steer Saarthi ("ignore your instructions...") |
| A bug or compromise in the API | Can send arbitrary jobs to the runner |

## 3. Trust boundaries

```text
 browser --(HTTP/WS, untrusted input)--> API --(internal network, token)--> runner --(Docker socket)--> Docker daemon
                                          |                                                               |
                                          +--(HTTPS, on request only)--> AI provider     sandbox containers (untrusted code, network: none)
```

* Only the **runner** holds the Docker socket. It is not published on any host
  port, and it requires `X-Runner-Token`. In `compose.yaml` it sits on an
  internal network with no route to the internet.
* The **API** never runs code and has no Docker access. It builds jobs only
  from server-side language profiles: the browser supplies the source text and
  stdin, never commands, images, environment or limits. It is the only
  component that talks to the AI provider, and only when a student presses a
  Saarthi button.
* The runner **re-checks** every job (image allow-list, limit ceilings, safe
  file names, input size, environment), so a compromised API still cannot
  request a privileged container, another image or larger limits.

On the live site (Vercel) there is no Docker:

```text
 browser --(HTTPS, untrusted input)--> API (Vercel Function) --(Vercel API, OIDC token)--> runner VM (Vercel Sandbox, network: deny-all)
    |                                     |                                                   kairo_exec.py: one namespace set + cgroup per step
    +--(HTTPS, publishable key)--> Supabase (Auth, Postgres with RLS)    +--(HTTPS)--> AI Gateway
```

* Jobs run in a Firecracker micro-VM with **no network at all**, started from
  a snapshot of the same sandbox images. `kairo_exec.py` (root inside the VM)
  re-checks each job like the runner does and gives every step new PID,
  mount, network, IPC and UTS namespaces, the image read-only, a size-limited
  `/tmp`, UID 10001 without capabilities, `no_new_privs`, a seccomp filter and
  a cgroup v2 with memory (no swap), PID and CPU limits (the table at the top of
  `infra/vercel/runner/kairo_exec.py`).
* The API reaches the VM only through Vercel's API with the deployment's
  short-lived OIDC token; no long-lived credential exists.
* Accounts and their saved work go **directly** between the browser and
  Supabase with the publishable key; Row Level Security limits every row to
  its owner. The API never sees account data.

## 4. Threats and controls

| # | Threat | Control | Verified by |
|---|---|---|---|
| T1 | Shell/command injection through source, file names or input | Argument arrays only, no shell anywhere; source and stdin are data (a file and a stream); file names match `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$` | `test_policy.py`, `test_profiles.py::test_every_step_uses_an_existing_grammar_and_a_trusted_argv` (every profile, formatters and the notebook included) |
| T2 | Client picks the image, compiler flags or environment | Not possible: the job is built from the profile; the runner allow-lists images and refuses `LD_*`/`DYLD_*` variables | `test_api.py::test_job_is_built_only_from_the_trusted_profile`, `test_policy.py` |
| T3 | Network access (exfiltration, attacking others) | `network_mode=none` for every step | per-language `network` programs (section 5.2), `hostile_network.c` |
| T4 | Escalating privileges | Non-root UID 10001, all capabilities dropped, `no-new-privileges`, no setuid binaries in any image, default seccomp and AppArmor | `hostile_privileges.c` |
| T5 | Modifying the image or the compiled program, persisting files | Read-only root filesystem; workspace read-only during the run; only a size-limited `/tmp` tmpfs is writable; everything deleted after the job | per-language `write` programs, `hostile_write_outside.c` |
| T6 | CPU exhaustion | 1-CPU quota, RLIMIT_CPU, runner wall-clock limit, per step | per-language `loop` programs, `hostile_cpu_loop.c` |
| T7 | Memory exhaustion | cgroup memory limit with swap disabled; runtimes' own heap caps (`-Xmx`, `--max-old-space-size`, PHP `memory_limit`) report first where they exist | per-language `memory` programs, `hostile_memory_bomb.c` |
| T8 | Process/thread exhaustion | cgroup PID limit | per-language `bomb` programs, `hostile_fork_bomb.c` |
| T9 | Disk exhaustion | RLIMIT_FSIZE, tmpfs size, read-only workspace during the run, no log files (`log_driver=none`) | `hostile_disk_fill.c`, `compile_bomb_big_array.c` |
| T10 | Output flood (service memory) | 64 KB per stream, then the container is killed | per-language `flood` programs, `hostile_stdout_flood.c`, `hostile_stderr_flood.c` |
| T11 | Compiler abuse (endless include, huge objects, slow compilers) | Same limits apply to compile and check steps, sized per toolchain (Kotlin 45 s / 1 GB) | `compile_bomb_dev_zero.c`, `compile_bomb_big_array.c` |
| T12 | Processes that outlive the run, or close their output to look finished | tini is PID 1; when the program exits, the container and every descendant are killed; containers and volumes are always removed; a reaper removes labelled leftovers older than 5 minutes | `hostile_daemon.c`, `hostile_close_streams.c`, `test_nothing_is_left_behind`, the integration suite's leftover check |
| T13 | Seeing other processes or host secrets | PID namespace; `/etc/shadow` unreadable to UID 10001 | `hostile_proc_snoop.c` |
| T14 | Flooding the service with jobs | Bounded API queue (503 + Retry-After), bounded dispatch workers, runner capacity check | `test_api.py::test_full_queue_is_refused_with_retry_after`, `test_app.py::test_capacity_is_enforced_with_retry_after` |
| T15 | Hijacking the runner from the network | Not published; token checked in constant time | `test_app.py::test_wrong_token_is_rejected` |
| T16 | Script injection in the browser through program output, compiler messages or AI answers | React renders all output, messages and Saarthi's text as text; no raw-HTML rendering | Code review (no `dangerouslySetInnerHTML` in `apps/web`) |
| T17 | Showing results or fixes for code the student has since changed | SHA-256 source hash comparison in the UI; the API refuses Saarthi requests with a different hash (409); fixes apply only to their base hash | `e2e/ide.spec.ts` ("editing after a run..."), `test_assistant.py::test_explain_refuses_stale_code_and_unknown_runs`, `e2e/saarthi.spec.ts` |
| T18 | Prompt injection: text in the program, input or output tells Saarthi what to do | Evidence is wrapped in tags the system prompt declares to be data; tag names inside it are defused; answers must match a strict schema; Saarthi has no tools or actions, cannot run code or change files; fixes are shown as a diff and applied only by the student; verification is a real run, never the model's word | `test_assistant.py::test_ask_about_unrun_code_defuses_tags...`, `test_defuse_neutralizes_our_tags_only`, `test_fix_rejects_patches_that_do_not_fit` |
| T19 | Leaking the AI key | Only in the API's environment (`.env` is git-ignored, Codespaces secrets); never in the browser bundle, responses or logs; `/assistant/status` reports provider and model only | `test_assistant.py::test_status_names_provider_and_model_but_never_the_key` |
| T20 | Running up the AI bill, or starving other students | Requests only on button press; per-client limits (10/min, 150/day; on Vercel the visitor's address from `x-real-ip`), a global daily budget (3000), at most 4 in flight, answers cached for 30 min (cache hits are free) | `test_assistant.py::test_rate_limit_answers_429_with_retry_after`, `test_rate_limiter_windows` |
| T21 | A malformed or hostile AI answer (huge patch, edits outside the file) | Patch policy: whole-line edits inside the file, no overlaps, at most 60 changed lines, size limit, must change something | `test_fix_rejects_patches_that_do_not_fit` |
| T22 | Language escape hatches: `system()`, `exec`, backticks, SQLite's `.shell`/`.system`, `os.execute` | Allowed by design: they run **inside the same sandbox** with the same limits, like any Bash program. The platform's safety never depends on restricting a language | per-language `bomb`, `network` and `write` programs (SQL's go through `.shell`) |
| T23 | HTML, CSS and React pages reading KAIRO's storage, cookies or the API, or breaking out of their frame | They run in an `<iframe>` with `sandbox="allow-scripts allow-modals allow-forms"` and no `allow-same-origin` (an opaque origin): no access to KAIRO's `localStorage`, cookies or DOM; console messages come back by `postMessage` and are accepted only with the run's token | `e2e/preview.spec.ts` (the page cannot read `localStorage`) |
| T24 | Hostile text given to a formatter (clang-format, Black, gofmt, shfmt) or to the notebook runner | Same path as a program: an unlisted profile with a fixed argument array, run by the runner in a fresh sandbox with the same isolation and limits; formatters only parse the text, and the notebook runner (`notebook.py`) runs the cells as a Python program would | `tests/integration/test_formatters.py`, the notebook's six hostile programs (section 5.2) |
| T25 | AI autocomplete sending code to the provider, or running up the bill | Off by default; only while the student has switched it on; at most 4,000 characters before and 1,500 after the cursor; its own limits (30/min, 1,500/day per client, a global daily budget of 20,000) so it never uses up the questions; keys stay on the server | `test_assistant.py` (complete endpoint, limits) |
| T26 | Forged run evidence or fix tokens (the browser hands them back to Saarthi on serverless hosts) | Signed with HMAC-SHA256 (`CC_EVIDENCE_SECRET`, or a random key the Vercel build writes into the function only) and checked in constant time; bound to the run id and the source hash; tampered or foreign tokens are refused (404), old ones for changed code too (409); fix tokens expire after 2 h | `test_vercel.py::test_another_instance_explains_a_run_from_its_sealed_evidence`, `test_instances_of_one_deployment_share_the_key_its_build_generated`, `test_a_fix_proposed_on_one_instance_is_verified_on_another` |
| T27 | Reading or changing another account's saved code, progress or settings | Row Level Security on every table (`auth.uid()` must own the row); the anonymous role has no table privileges; only the publishable key is in the browser and the repository | Supabase security advisor: no findings (15 Oct 2026); catalog check that every table has RLS on and `anon` cannot select |
| T28 | Abusing the daily keep-alive | With `CRON_SECRET` set, only Vercel Cron may call it (constant-time check); without it, it does its work at most once every 10 minutes per instance, and the work is two harmless pings | `test_vercel.py::test_keepalive_needs_the_cron_secret_when_one_is_set` |

## 5. Test results

### 5.1 Runner containment corpus (C)

Programs live in `services/runner/tests/programs/`; each file's header states
the attack and the expected outcome. `pytest services/runner` runs them
against real Docker (49 runner tests in total).

| Program | Observed outcome |
|---|---|
| `ok_hello_stdin.c`, `ok_eof_count.c` | Correct output; end-of-input delivered, no hang |
| `crash_segfault.c`, `crash_stack_overflow.c` | SIGSEGV (exit 139); output printed before the crash kept |
| `crash_assert.c` | SIGABRT (134) with the assertion message |
| `crash_divide_by_zero.c` | SIGFPE (136) |
| `hostile_cpu_loop.c`, `hostile_sleep.c` | TIMEOUT at the wall-clock limit |
| `hostile_memory_bomb.c` | MEMORY_LIMIT, `oomKilled=true` |
| `hostile_fork_bomb.c` | Contained by the PID limit; ended by TIMEOUT |
| `hostile_stdout_flood.c`, `hostile_stderr_flood.c` | OUTPUT_LIMIT at 64 KB; 24 concurrent floods finished in at most 2.7 s |
| `hostile_network.c` | `connect failed: Network is unreachable` |
| `hostile_write_outside.c` | `/etc` and `/workspace` read-only; `/tmp` writable |
| `hostile_disk_fill.c` | Stopped at the 16 MB scratch limit |
| `hostile_privileges.c` | uid 10001, `CapEff` 0, `NoNewPrivs` 1, `Seccomp` 2, `setuid(0)` fails |
| `hostile_daemon.c` | Background child killed with the container |
| `hostile_close_streams.c` | Closing stdout/stderr and sleeping does not escape the limit: TIMEOUT |
| `hostile_proc_snoop.c` | Only the sandbox's own processes visible; `/etc/shadow` unreadable |
| `compile_bomb_big_array.c` | Compile fails quickly (file-size limit hit by the assembler) |
| `compile_bomb_dev_zero.c` | Compile stopped by the memory limit |

### 5.2 Every language

`tests/integration/programs.py` gives every language the same six hostile
programs (an endless loop, a memory hog, a process or thread bomb, a network
connection, a write to the workspace, an output flood), run through the
production path: the language profile builds the job, the runner's policy
checks it, the sandbox runs it, and the API's diagnostics decide the final
state. Results on 27 Sep 2026 (Docker 29.4.3, cgroup v1 host):

| Language | Endless loop | Memory hog | Process/thread bomb | Network | Write to workspace | Output flood |
|---|---|---|---|---|---|---|
| C | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| C++ | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| Java | TIMEOUT | `JAVA_OUT_OF_MEMORY` | TIMEOUT (`JAVA_THREAD_LIMIT`) | blocked | blocked | OUTPUT_LIMIT |
| Python | TIMEOUT | MEMORY_LIMIT | `PY_OS_ERROR` (fork refused) | blocked | blocked | OUTPUT_LIMIT |
| JavaScript | TIMEOUT | `JS_OUT_OF_MEMORY` | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| TypeScript | TIMEOUT | `JS_OUT_OF_MEMORY` | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| Go | TIMEOUT | MEMORY_LIMIT | `GO_THREAD_LIMIT` | blocked | blocked | OUTPUT_LIMIT |
| Rust | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| C# | TIMEOUT | `CS_OUT_OF_MEMORY` | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| Kotlin | TIMEOUT | `KT_OUT_OF_MEMORY` | TIMEOUT (`KT_THREAD_LIMIT`) | blocked | blocked | OUTPUT_LIMIT |
| PHP | TIMEOUT | `PHP_MEMORY_LIMIT` | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| Ruby | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| Lua | TIMEOUT | MEMORY_LIMIT | OUTPUT_LIMIT (fork errors flood the output) | blocked | blocked | OUTPUT_LIMIT |
| Bash | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |
| SQL (via `.shell`) | TIMEOUT | MEMORY_LIMIT | TIMEOUT | blocked | blocked | OUTPUT_LIMIT |

The 17 languages added later (R, Assembly, Lex, Verilog, Prolog, Fortran,
Pascal, COBOL, Perl, Common Lisp, Scheme, Erlang, Elixir, Nim, D, Ada, Tcl)
and Python notebooks have the same six programs. On 30 Sep and 6 Oct 2026 every
one was contained: endless loops ended in TIMEOUT, memory hogs in MEMORY_LIMIT
or the runtime's own out-of-memory error (`ERL_OUT_OF_MEMORY`,
`EX_OUT_OF_MEMORY`, `LISP_OUT_OF_MEMORY`, `PROLOG_STACK_OVERFLOW`, `NB_MEMORY_ERROR`), process bombs
in TIMEOUT or a refused fork, network connections and workspace writes were
refused, and output floods were cut at 64 KB. Verilog has no way to start
processes or open sockets, so those two programs are skipped for it.

"blocked" means the program itself printed that its connection or write was
refused. Codes in backticks are the language runtime's own out-of-memory or
thread errors, which fire before the sandbox's limit; the sandbox limit is
still there behind them. Swift has the same programs but was not run (its
image could not be built here). These images were built from a local copy of
`ubuntu:24.04` because Docker Hub was not reachable from the development
environment; the CI workflow builds and tests every image from the real base
images.

Earlier findings fixed during this testing, each with a regression test:
the runner could hang for 60 s when a program kept printing after the output
cap; a program that closed its output streams looked finished and was
reported as killed rather than timed out; the runner's environment policy
rejected .NET's mixed-case variables (now allowed, while `LD_*`/`DYLD_*` stay
refused); the runner's ceilings were below the Kotlin compiler's needs.

## 6. Residual risks and next steps

| Risk | Why it remains | Plan |
|---|---|---|
| Kernel shared with the host: a kernel exploit could escape the container | Containers are not VMs | Evaluate gVisor (`runsc`) as the sandbox runtime and measure the overhead; keep the host kernel patched |
| The runner holds the Docker socket (root-equivalent on the host) | Needed to start containers | Keep it unpublished, token-protected and on the internal network; later a Docker socket proxy that allows only the needed endpoints, rootless Docker, or a dedicated VM |
| The API does not check accounts: anyone who can reach it can run code and use Saarthi, and an execution id is enough to read its result | Accounts live between the browser and Supabase; the API is stateless | Verify Supabase session tokens in the API for per-user admission and rate limits; on a self-hosted server keep the API on a trusted network (`WEB_BIND=127.0.0.1` by default) |
| Saarthi limits are per IP address | The API does not check accounts | A lab behind one NAT address shares one budget: raise `CC_AI_REQUESTS_PER_DAY` there, or add per-user limits |
| On Vercel, concurrent runs share one runner VM (separate namespaces and cgroups, one kernel) | One VM per run would add seconds to every run | A kernel exploit inside the VM could reach other runs in the same session, not Vercel's hosts or the API; sessions are short (minutes) and start from the clean snapshot |
| Student code goes to the AI provider when Saarthi is used | That is how a hosted model works | Tell students; use a local model (Ollama) where code must not leave the network |
| One user can fill the shared run queue | Only a global bound exists | Per-user in-flight cap and fair-share queue |
| Unpinned base images and packages | Simpler during development | Pin base images by digest and record image IDs (already stored per execution) before the evaluation |
| No custom seccomp profile | Docker's default profile is broad but reasonable | A tighter profile if the corpus shows a need |
| More hostile programs | The synopsis asks for 20+ hostile programs per evaluation | Thread bombs per runtime, `mmap` and `/proc/self/mem` abuse, file-descriptor exhaustion, `ptrace`/`unshare` attempts, symlink races in `/tmp` |
