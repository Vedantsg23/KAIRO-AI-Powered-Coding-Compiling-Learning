<a id="readme-top"></a>

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/hero-light.svg">
  <img alt="KAIRO: AI-Powered Coding. Compiling. Learning. An online compiler for learners with 32 languages in Docker sandboxes plus HTML, CSS and React in a live preview, a Jupyter-style Python notebook, a live analyzer with quick fixes, extensions, and Saarthi, an AI guide whose fixes are verified by a real run." src="docs/images/readme/hero-dark.svg" width="100%">
</picture>

<br>

[![Languages](https://img.shields.io/badge/languages-32_+_web-22c55e?style=for-the-badge)](#languages)
[![Live site](https://img.shields.io/badge/live-kairo--ai--phi.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://kairo-ai-phi.vercel.app)
[![Sandbox](https://img.shields.io/badge/sandbox-Docker_or_Vercel_Sandbox-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#security-model)
[![AI guide](https://img.shields.io/badge/AI_guide-Saarthi-06b6d4?style=for-the-badge)](#saarthi-the-ai-guide)
[![Live analyzer](https://img.shields.io/badge/live_analyzer-p95_about_200_ms-16a34a?style=for-the-badge)](#live-analyzer)
[![Notebook](https://img.shields.io/badge/notebook-Jupyter--style-F37626?style=for-the-badge&logo=jupyter&logoColor=white)](#languages)
[![Status](https://img.shields.io/badge/milestones-M1_to_M6_done-0b1510?style=for-the-badge)](#roadmap-and-status)

[![React](https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Monaco](https://img.shields.io/badge/Monaco_Editor-0.57-0066B8?style=flat-square)](https://microsoft.github.io/monaco-editor/)
[![Tree-sitter](https://img.shields.io/badge/Tree--sitter-WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white)](https://tree-sitter.github.io)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)
[![Pydantic](https://img.shields.io/badge/Pydantic-2-E92063?style=flat-square&logo=pydantic&logoColor=white)](https://docs.pydantic.dev)
[![Docker](https://img.shields.io/badge/Docker-11_sandbox_images-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com)
[![Playwright](https://img.shields.io/badge/Playwright-1.56-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![Claude](https://img.shields.io/badge/Claude_API-optional-D97757?style=flat-square&logo=anthropic&logoColor=white)](https://platform.claude.com)
[![Ollama](https://img.shields.io/badge/Ollama-local_models-000000?style=flat-square&logo=ollama&logoColor=white)](https://ollama.com)
[![Supabase](https://img.shields.io/badge/Supabase-accounts_and_saved_work-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Vercel-Functions,_Sandbox,_AI_Gateway-000000?style=flat-square&logo=vercel&logoColor=white)](infra/vercel/README.md)
[![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](#highlights)

<p>
<a href="#about-the-project"><b>About</b></a> ·
<a href="#see-it-in-action"><b>Demo</b></a> ·
<a href="#how-it-works"><b>How it works</b></a> ·
<a href="#architecture"><b>Architecture</b></a> ·
<a href="#saarthi-the-ai-guide"><b>Saarthi</b></a> ·
<a href="#security-model"><b>Security</b></a> ·
<a href="#quick-start"><b>Quick start</b></a> ·
<a href="#documentation"><b>Docs</b></a>
</p>

</div>

**KAIRO** (*AI-Powered Coding. Compiling. Learning.*) is an online compiler made for people who are learning to
program, laid out like a developer command center. Write code in 32 languages that run with their real toolchains
in a locked-down sandbox (plus HTML, CSS and React in a live preview, and Python in a Jupyter-style notebook with
its own terminal), watch every run go through the build pipeline, catch syntax slips and typos while you type (with
the concept you are working on and rule-based quick fixes), format code, switch on extensions such as Emmet, Vim
keys and AI autocomplete, and understand each error with **Saarthi**, an AI guide that explains problems from your
run's real evidence and proposes small fixes that a real run then checks.

*Saarthi* (सारथी) is the charioteer who guides the way. (KAIRO was called Code Drishti until the redesign of
29 September 2026; the code keeps some internal names such as the `cd.` storage keys, so saved drafts and
profiles carry over.)

B.E. Computer Engineering final-year project "Compiler-Aware AI Coding Copilot", Group 04, Department of Computer
Engineering, DYPCOEI Varale, 2026-27. Guide: **Dr. Alpana Adsul**. Team: **Vedant Gadage** (lead),
**Prajwal Dudhal**, **Pratiksha Gadhave**, **Pooja Pyadewad**.

<details>
<summary><b>Table of contents</b></summary>

1. [About the project](#about-the-project)
2. [Highlights](#highlights)
3. [See it in action](#see-it-in-action)
4. [How it works](#how-it-works)
5. [Architecture](#architecture)
6. [Live analyzer](#live-analyzer)
7. [Diagnostics: one format for every toolchain](#diagnostics-one-format-for-every-toolchain)
8. [Saarthi, the AI guide](#saarthi-the-ai-guide)
9. [Security model](#security-model)
10. [Languages](#languages)
11. [Profiles, XP and badges](#profiles-xp-and-badges)
12. [Tech stack](#tech-stack)
13. [Quick start](#quick-start)
14. [Configuration](#configuration)
15. [API at a glance](#api-at-a-glance)
16. [Testing and quality](#testing-and-quality)
17. [Project structure](#project-structure)
18. [Roadmap and status](#roadmap-and-status)
19. [Team](#team)
20. [Documentation](#documentation)
21. [Principles](#principles)
22. [License](#license)
23. [Acknowledgements](#acknowledgements)

</details>

## About the project

### The problem

Beginners meet compilers mostly through their error messages. Online compilers run code but rarely explain it,
and AI chat assistants explain it but guess: they invent fixes and call them correct without ever running them.

| The gap | What students usually get | What KAIRO does |
|---|---|---|
| Cryptic errors | `expected ',' or ';' before 'printf'`, reported on the line *after* the mistake | One diagnostic format for 32 toolchains: exact range, a stable code (`C_MISSING_SEMICOLON`), a hint ("the missing `;` probably belongs at the end of line 4") and a plain-language note |
| Feedback only after a run | Mistakes found only when you press Run | A syntax check in the browser 150 ms after you stop typing, with the concept behind each slip and a rule-based quick fix where the repair is unambiguous; a measured p95 of about 200 ms from keystroke to marker on 500-line files |
| AI that guesses | Fixes that were never tried, presented as correct | Saarthi answers only from one stored run, proposes the smallest patch, changes nothing without your approval, and lets a real run decide whether the fix worked |
| Unsafe execution | Untrusted code run with weak isolation | Every step in a fresh container: no network, read-only file system, non-root user, no capabilities, strict time, memory, process and output limits |

### What this project is, and is not

> [!NOTE]
> KAIRO **does not implement a compiler**. GCC, javac, CPython, rustc and the other toolchains are used
> exactly as shipped. The project builds everything around them: normalized diagnostics, secure execution, live
> syntax checking, grounded AI explanations, human-approved fixes and automatic re-verification.
> See [docs/scope.md](docs/scope.md).

<details>
<summary><b>The synopsis algorithms and where they live</b></summary>

| Algorithm | Status | Where |
|---|---|---|
| A1 incremental syntax analysis | **Done**: Tree-sitter in a Web Worker, 14 languages; rule-based quick fixes and concept detection on the same tree | `apps/web/src/live` |
| A2 debounced two-speed scheduler | **Done**: 150 ms live check on every edit, full compile on Run; generation numbers drop stale answers | `apps/web/src/live/useLiveCheck.ts`, `App.tsx` |
| A3 diagnostic normalization | **Done** for 32 languages (+ Swift, unverified) | `services/api/app/analysis/`, `adapters/grammars/` |
| A4 fault classification | **Done** for 32 languages | `services/api/app/analysis/classify.py`, profiles |
| A5 evidence selection | **Done** (first form): focus diagnostic, windows around relevant lines, bounded output | `services/api/app/ai/context.py` |
| A6 binding-site backtracking | Partly: deterministic "missing `;` belongs on the line before" hints and related locations | grammars |
| A7 response validation | **Done**: schema, lengths, line range, source hash, patch applies to the snapshot, patch size policy | `services/api/app/ai/service.py` |
| A8 differential verification | **Done**: `fixed` / `improved` / `not_fixed` / `different_code` from a real run | `AssistantService.verify` |
| A9 confidence scoring | Model-reported (`low` / `medium` / `high`), shown with the answer; a deterministic score is future work | `services/api/app/ai` |
| A10 mutation seeding | Future work (evaluation corpus) | |
| A11 admission control | **Basic form**: global queue bound, W dispatch workers, runner capacity | `services/executions.py`, `runner/app.py` |
| A12 to A14 rate limits, priorities, cache | **Done for Saarthi**: per-client and global limits, concurrency cap, answer cache | `services/api/app/ai/service.py` |
| A15 circuit breaker | Future work | |

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Highlights

<table>
<tr>
<td width="50%" valign="top">

**32 real toolchains, plus the web**<br>
C, C++, Java, Python, JavaScript, TypeScript, Go, Rust, C#, Kotlin, PHP, Ruby, Lua, Bash, SQL, R, Assembly (NASM),
Lex, Verilog, Prolog, Fortran, Pascal, COBOL, Perl, Common Lisp, Scheme, Erlang, Elixir, Nim, D, Ada and Tcl, each
built and run by its real toolchain in a sandbox image. HTML, CSS and React run in a live preview in the browser.
Swift is prepared as an experimental extra.

</td>
<td width="50%" valign="top">

**Problems pinned to the line**<br>
Compile errors, warnings and runtime crashes from every toolchain arrive in one format, with a stable code, the
exact range, a hint and a plain-language note. Nothing a toolchain prints is dropped.

</td>
</tr>
<tr>
<td valign="top">

**Live analyzer**<br>
A Tree-sitter syntax check runs in a Web Worker while you type (14 languages), with Python 3's own rules for
colons and indentation. Each slip gets a WHY, its CONCEPT and, where the repair is unambiguous, a rule-based
QUICK FIX; the concept at your cursor is detected too. It never contacts the server.

</td>
<td valign="top">

**Saarthi, the AI guide**<br>
Explains a problem from your run's source, diagnostics and output; proposes a minimal patch as a diff; applies it
only when you press Apply; verifies it with a real run. Its answers stream in word by word in a chat panel like
Copilot's, with one-tap questions such as "Explain this error". Vercel AI Gateway on the live site; Claude or any
OpenAI-compatible model such as Ollama elsewhere.

</td>
</tr>
<tr>
<td valign="top">

**The build pipeline**<br>
QUEUE, COMPILE, RUN and RESULT light up as the real run reports progress (streamed in the same request), above a
terminal that shows the command, the output, the exit status and the time. A crash is mapped back to your line.

</td>
<td valign="top">

**Safe by construction**<br>
The API never runs code. Only the runner can reach Docker, and every step gets a fresh container with no network,
a read-only file system and strict limits. Six hostile programs are contained in every language.

</td>
</tr>
<tr>
<td valign="top">

**A workspace like VS Code**<br>
A boot sequence of real system checks, then one screen laid out like VS Code or Antigravity: the explorer, the
editor, a big terminal you drag to resize, maximize or hide with Ctrl+\`, and Saarthi's chat panel; every panel
resizes and hides, and the layout is remembered. Plain labels ("Hide the terminal", "Problems") for beginners. A
white "signal" theme by default and a graphite dark theme.

</td>
<td valign="top">

**Made for beginners**<br>
Guest profiles in seconds, a welcome screen, an 8-step tour, 140 example programs, XP, levels, 14 badges and day
streaks, light and dark themes, keyboard operation (Ctrl+Enter runs, Ctrl+S saves, Ctrl+K for everything) and
tablet and phone layouts.

</td>
</tr>
<tr>
<td valign="top">

**Interactive, and fun to use**<br>
The entry page reacts to you: code glyphs scatter around the pointer, cards tilt, headings rise word by word,
Saarthi stands in the middle of a scrolling tour of the pipeline and changes face at every step, and a playground
runs the real analyzer. In the console, Ctrl+K opens a
command palette for everything, Saarthi can be dragged anywhere, panels light up under the pointer, the terminal
writes its output line by line and optional sounds mark a pass or a fail.

</td>
<td valign="top">

**Motion with manners**<br>
Every effect is decoration: with "reduce motion" or the Animations switch off it stands still and nothing is
lost. Looping decorations pause while you type, touch screens get no cursor effects, CSS animations use only
transform and opacity, and pointer effects restyle one small element each, so the editor keeps its measured
keystroke-to-marker latency.

</td>
</tr>
<tr>
<td valign="top">

**A Jupyter-style notebook**<br>
Python cells and Markdown cells, `In [n]` and `Out[n]`, tracebacks and quick notes under the failing cell, live
checks that know the names from the cells above, `.ipynb` import and export, and a terminal of its own with a run
log, the program's input and a `>>>` console. Every run happens in the sandbox, from a fresh interpreter.

</td>
<td valign="top">

**Extensions that really work**<br>
Prettier in the browser and clang-format, Black, gofmt and shfmt in the sandbox (Shift+Alt+F, or Format on Save),
Emmet, a Vim keymap, Error Lens, Complexity Lens, Typo Guard, Saarthi Tips, AI autocomplete (ghost text, Tab
accepts), editor themes and more, each with a switch and a details page.

</td>
</tr>
<tr>
<td valign="top">

**An entry page that changes as you scroll**<br>
Each section turns the page dark or light with its own animated background; the header's links jump to the
languages, the sandbox pipeline and the analyzer; Saarthi jumps out big to say "Hii!", and says "Welcome" after
you sign in.

</td>
<td valign="top">

**Guests or accounts**<br>
Start as a guest in seconds, or create an account and stay signed in: your code, progress, badges and settings
are saved to it (Supabase, Row Level Security) and follow you to any device. Google, GitHub, Microsoft and phone
sign-in can be added.

</td>
</tr>
<tr>
<td valign="top">

**Online, no Docker needed**<br>
The live site runs on Vercel: the API is one Python function, every run goes to a Vercel Sandbox micro-VM built
from the same sandbox images with the same limits, and a daily keep-alive keeps the database and the runner
awake. See [infra/vercel/README.md](infra/vercel/README.md).

</td>
<td valign="top">

**Install it like an app**<br>
Chrome and Edge on a computer or an Android phone offer **Install app**; on an iPhone or iPad, Add to Home
Screen. KAIRO then opens in its own window with its own icon. While it starts, a field of stars gathers into the
KAIRO mark, and launching the workspace is a short flight through them.

</td>
</tr>
</table>

<p align="right"><a href="#readme-top">back to top</a></p>

## See it in action

<p align="center">
  <img src="docs/images/readme/demo.webp" alt="A walkthrough of KAIRO: the boot sequence; the entry page reacting to the pointer; the pipeline tour with Saarthi in the middle; the live analyzer playground fixing a slip; the curtain opening on the console; a run whose terminal writes itself in; Ctrl+K running an example with a compile error; Saarthi explaining it and a fix verified by a real run; Saarthi dragged across the editor; and the dark theme." width="880">
</p>
<p align="center"><sub>Recorded on the development stack: real compilers in Docker. Saarthi's AI answers in this recording come from the offline stand-in used for tests, labelled "(mock)"; the quick fixes are rule-based and need no AI.</sub></p>

<p align="center"><img src="docs/images/readme/console.png" alt="The KAIRO console after a compile error: the explorer with the drafts, examples and system status; the editor with the error underlined and marked in the gutter; the build pipeline stopped at COMPILE; the diagnostics list; Saarthi's panel with the error, why, concept and what to try" width="100%"></p>
<p align="center"><sub><b>The console.</b> Explorer, editor, build pipeline and terminal, diagnostics and Saarthi's panel on one screen, with the system status along the edges.</sub></p>

<table>
<tr>
<td width="50%"><img src="docs/images/readme/saarthi-verified.png" alt="The console in the dark theme after Saarthi's patch for a missing semicolon was applied and verified by a real run"></td>
<td width="50%"><img src="docs/images/readme/quick-fix.png" alt="Python: a missing colon flagged while typing, with Saarthi's live analysis: error, why, concept, a preview of the fix and an ADD ':' button"></td>
</tr>
<tr>
<td align="center"><sub><b>Saarthi's fix, verified by a real run</b> (graphite theme). Preview, apply, recompile, verify.</sub></td>
<td align="center"><sub><b>The live analyzer.</b> A missing <code>:</code> in Python, flagged while typing, with a one-click quick fix.</sub></td>
</tr>
<tr>
<td><img src="docs/images/readme/boot.png" alt="The boot sequence: seven real checks (compiler kernel online, 32 of 33 language runtimes ready, 57 diagnostic notes, the sandbox ready, Saarthi online, 14 analyzer grammars, 32 language adapters), then SYSTEM READY"></td>
<td><img src="docs/images/readme/languages.png" alt="The language selector: each runtime with its toolchain and a READY status, 35 of 36 ready, including HTML, CSS and React in the browser preview"></td>
</tr>
<tr>
<td align="center"><sub><b>The boot sequence.</b> Every line is a real check; any key skips it.</sub></td>
<td align="center"><sub><b>Every language runtime,</b> each with its real toolchain, version and status.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/readme/notebook.png" alt="The Python notebook: cells with In and Out numbers, a printed total, a NameError under the cell that failed with a quick note, the live typo check offering Change to average, and the notebook terminal with its run log, input and Python console"></td>
<td width="50%"><img src="docs/images/readme/extensions.png" alt="The graphite theme with the Extensions view filtered to formatters (Prettier, the sandbox formatters, Format on Save), a C file just formatted by clang-format, and the Vim keymap's NORMAL mode line under the editor"></td>
</tr>
<tr>
<td align="center"><sub><b>The notebook.</b> Cells, Out[n], errors under their cell, a live typo check that knows the cells above, and its own terminal.</sub></td>
<td align="center"><sub><b>Extensions.</b> clang-format in the sandbox (Shift+Alt+F), the Vim keymap, and the rest, each with a switch.</sub></td>
</tr>
<tr>
<td><img src="docs/images/readme/entry-chapter.png" alt="The entry page scrolled to the pipeline tour: the page has turned dark with a grid in the background, and the header link Sandboxed runs is highlighted"></td>
<td><img src="docs/images/readme/saarthi-hello.png" alt="Saarthi jumping out big over the entry page with a speech bubble: Hii! I'm Saarthi"></td>
</tr>
<tr>
<td align="center"><sub><b>The page changes as you scroll:</b> each chapter has its own tone and background, and the header links jump there.</sub></td>
<td align="center"><sub><b>Click Saarthi</b> and it jumps out to say hello (after signing in it says "Welcome").</sub></td>
</tr>
<tr>
<td><img src="docs/images/readme/signin.png" alt="The sign-in card: Guest, Sign in and Create account tabs; Google, GitHub and Microsoft buttons; a phone number with the +91 country code and Send code; email and password with Forgot password"></td>
<td><img src="docs/images/readme/preview-react.png" alt="React in KAIRO: App.jsx in the editor and the rendered page in the preview, with a button and a list, and the page's console below it"></td>
</tr>
<tr>
<td align="center"><sub><b>Sign in</b> with Google, GitHub, Microsoft, a phone number or email, or stay a guest.</sub></td>
<td align="center"><sub><b>HTML, CSS and React</b> render in a sandboxed preview that updates as you type.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="docs/images/readme/tour.png" alt="The entry page's pipeline tour at step 7 of 7, VERIFY: the step's title and text on the left, Saarthi in the middle on its holo-platform with a happy face and a speech bubble, the verified-run card on the right, and the seven-step track below"></td>
<td width="50%"><img src="docs/images/readme/palette.png" alt="The command palette over the console: the search 'run ex' lists Run example commands for the C examples, with their outcomes"></td>
</tr>
<tr>
<td align="center"><sub><b>The pipeline tour.</b> Scroll, and Saarthi walks you from CODE to VERIFY, changing face at every step.</sub></td>
<td align="center"><sub><b>Ctrl+K.</b> Every action, language and example in one fuzzy search; <code>:42</code> goes to line 42.</sub></td>
</tr>
<tr>
<td><img src="docs/images/readme/entry.png" alt="The entry page: the headline Code. Compile. Learn with KAIRO., code glyphs drifting behind it, Saarthi on its holo-platform with tilting cards, and the custom cursor showing LAUNCH over the launch button"></td>
<td><img src="docs/images/readme/playground.png" alt="The entry page's playground: a C program with a missing semicolon on line 4, the live analyzer's finding and an ADD ';' quick fix button"></td>
</tr>
<tr>
<td align="center"><sub><b>The entry page</b> reacts to the pointer: glyphs scatter, layers drift, cards tilt, the cursor labels the action.</sub></td>
<td align="center"><sub><b>Break it, watch it catch it.</b> The real live analyzer, on the entry page, before you sign in.</sub></td>
</tr>
</table>

<details>
<summary><b>More screenshots: entry page, editor, terminal, diagnostics, phone, dark theme</b></summary>
<br>

<p align="center"><img src="docs/images/kairo/01-entry-light.png" alt="The entry page: Code. Compile. Learn with KAIRO. Saarthi floating over its holo-platform with a live diagnostic, a quick fix and a verified run around it, and the guest session card" width="820"></p>
<p align="center"><sub>The entry page: Saarthi on its holo-platform, and a guest profile in a few seconds.</sub></p>

<p align="center"><img src="docs/images/kairo/03-editor-light.png" alt="The editor: a missing semicolon underlined, gutter markers, the analyzer strip with the concept at the cursor, and Saarthi floating in the corner" width="820"></p>
<p align="center"><sub>The editor: problems underlined and marked in the gutter, the concept at the cursor, Saarthi in the corner.</sub></p>

<p align="center">
<img src="docs/images/kairo/06-terminal-crash-dark.png" alt="The terminal after a crash: the pipeline with RUN failed with SIGSEGV, the program's output before the crash and the exit line" width="49%">
<img src="docs/images/kairo/05-diagnostics-light.png" alt="The diagnostics list: a segmentation fault with its plain-language note" width="42%">
</p>
<p align="center"><sub>A crash: the terminal keeps the output before it; the diagnostic explains it in plain words.</sub></p>

<p align="center"><img src="docs/images/kairo/02b-console-error-dark.png" alt="The console in the graphite dark theme after a compile error" width="820"></p>
<p align="center"><sub>The graphite dark theme.</sub></p>

<p align="center"><img src="docs/images/kairo/09-phone-light.png" alt="KAIRO on a phone: the editor with Saarthi, and tabs for diagnostics, Saarthi, terminal and input" width="300"></p>
<p align="center"><sub>On a phone.</sub></p>

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/run-journey-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/run-journey-light.svg">
  <img alt="An animation of one real C run: queued at 0 ms, the runner starts at 5 ms, a fresh container compiles the program from 83 to 336 ms, another runs it until 581 ms, and the result is shown at 583 ms." src="docs/images/readme/run-journey-dark.svg" width="100%">
</picture>

1. **You press Run.** The editor sends its exact text, the input and the language: `POST /api/v1/executions/run`.
2. **The API admits the run.** It checks the sizes (64 KB of source, 16 KB of input), records the SHA-256 of the
   exact snapshot, checks that the language's sandbox image is installed, and puts the run in a bounded queue. It
   answers at once with a stream: a full snapshot of the run on every change, in the same request, so it works on
   serverless hosts too (`POST /api/v1/executions` with a WebSocket remains for other clients).
3. **The runner prepares.** It re-checks the job against its own policy (allowed images, limit ceilings, file
   names, environment), creates a workspace volume and copies the source in through a container that is created
   but never started.
4. **Compile or check.** A fresh container compiles the program (or, for interpreted languages, checks its
   syntax), with no network and strict limits.
5. **Execute.** Another fresh container runs it, with the workspace read-only and only a small `/tmp` writable.
   On the live site the runner is a Vercel Sandbox micro-VM instead of Docker: `kairo_exec.py` gives each step the
   same isolation with namespaces, cgroups and seccomp ([infra/vercel/README.md](infra/vercel/README.md)).
6. **Diagnostics.** The API turns the toolchain's output into diagnostics: grammar rules, block parsers for
   tracebacks and stack traces, stable codes, hints, and synthesized diagnostics for silent crashes and limits.
7. **Result.** The final snapshot reaches the browser. Markers appear only while the editor still holds exactly
   the code that was run; change one character and the results are marked as outdated.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as API (FastAPI)
    participant R as Runner
    participant D as Docker
    B->>A: POST /api/v1/executions/run {languageId, source, stdin}
    A->>A: size checks, SHA-256, image installed? (409 if not), queue bound (503 if full)
    A-->>B: 200, a stream of snapshots begins (state QUEUED)
    A->>R: POST /v1/jobs (JobSpec built from the language profile)
    R->>R: policy check: image allow-list, limit ceilings, file names, environment
    R->>D: create a volume, seed the file (container created, never started)
    loop each step: check or compile, [link], run
        R-->>A: step_started (NDJSON)
        A-->>B: snapshot (COMPILING or RUNNING)
        R->>D: create a hardened container, attach, start, wait
        R-->>A: step_finished
    end
    R->>D: remove the containers and the volume
    R-->>A: job_finished (exit codes, signals, bounded output)
    A->>A: normalize into diagnostics, decide the final state
    A-->>B: final snapshot with its signed evidence, then the stream ends
```

<details>
<summary><b>The execution state machine</b></summary>

```mermaid
stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> STARTING: a dispatch worker picks it up
    STARTING --> COMPILING: compile or check step started
    STARTING --> RUNNING: languages without such a step (SQL)
    COMPILING --> RUNNING: compile succeeded
    COMPILING --> COMPILE_ERROR
    RUNNING --> SUCCEEDED
    RUNNING --> RUNTIME_ERROR: non-zero exit, signal, output limit
    COMPILING --> TIMEOUT
    RUNNING --> TIMEOUT
    COMPILING --> MEMORY_LIMIT
    RUNNING --> MEMORY_LIMIT
    STARTING --> REJECTED: runner at capacity
    STARTING --> INTERNAL_ERROR: runner unreachable or failed
```

Every change increments the execution's version, and every streamed line (or WebSocket message) is the full
snapshot, so a client that misses one still ends in the right state. If the stream breaks, the browser keeps the
last snapshot and says the run was interrupted, instead of showing it as finished.

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/architecture-light.svg">
  <img alt="KAIRO's architecture: the browser (web app, live check worker, storage) talks to the FastAPI server; the API sends job specs to the runner, the only process with Docker access, which starts a fresh hardened container per step; Saarthi calls the AI provider only when a student asks." src="docs/images/readme/architecture-dark.svg" width="100%">
</picture>

KAIRO is three processes with one rule: **student code only ever runs inside a throwaway container**.

| Component | Code | Responsibility | Never does |
|---|---|---|---|
| Web app | `apps/web` | Editing, running, showing results, the live check, the Saarthi panel, onboarding, profiles. Compares the editor text's SHA-256 with the result's `sourceHash` | Talk to the runner, Docker or the AI provider |
| Live check worker | `apps/web/src/live` | Parses the editor text with Tree-sitter 150 ms after the last keystroke and reports syntax problems | Send anything over the network |
| API | `services/api/app` | Validation, source snapshot and hash, admission control, jobs from profiles, normalizing results, state and events, Saarthi | Run student code, touch Docker |
| Language profiles | `services/api/app/adapters/profiles/*.toml`, `grammars/*.toml` | Everything language-specific: file name, argument arrays, limits, error grammars, classification rules, signal messages | Contain code |
| Saarthi | `services/api/app/ai` | Evidence from a stored run, prompts, provider calls, answer validation, patch checks, verification verdicts, rate limits and cache | Apply a change, or call anything "verified" without a run |
| Runner | `services/runner/runner` | Policy re-check, container lifecycle, limits, output caps, timeouts, cleanup, orphan reaper | Parse compiler output or know about languages |
| Sandbox images | `infra/containers/*` | Toolchains, unprivileged user 10001, no setuid binaries, toolchain metadata | |
| Contracts | `packages/contracts` | OpenAPI, the diagnostic schema and the runner contract, generated from the models | |

The API and the runner are separate processes on purpose: only the runner can reach the Docker socket, and the
runner knows nothing about languages, so adding a language never changes it (only its image allow-list).

<details>
<summary><b>Deployment with Docker Compose</b></summary>

```mermaid
flowchart LR
    B(["Browser"]) -->|"http://127.0.0.1:8080"| API
    subgraph host["One Linux machine with Docker"]
        API["api container<br/>FastAPI + the built web app<br/>networks: internal, egress"]
        RUN["runner container<br/>network: internal only<br/>(no route to the internet)"]
        D[["Docker daemon"]]
        SB["sandbox containers<br/>network: none"]
    end
    API -->|"JobSpec + token"| RUN
    RUN -->|"/var/run/docker.sock"| D
    D --> SB
    API -.->|"HTTPS, only for Saarthi"| AI(["AI provider"])
```

The app listens on `127.0.0.1` by default; set `WEB_BIND=0.0.0.0` only on a trusted lab network, because anyone
who can reach the port can run code. The same containers run in GitHub Codespaces and in local development.

</details>

<details>
<summary><b>Design decisions and why</b></summary>

| Decision | Why | Revisit when |
|---|---|---|
| One container **per step** (not one container with `docker exec`) | Docker itself reports the exit status and the OOM flag of PID 1; the program cannot forge them. The run step gets a read-only workspace | Container start-up time dominates (about 0.1 to 0.3 s per step here) |
| Declarative TOML profiles, grammars in separate files | "Add a language by configuration"; profiles share grammars where tools share formats (C# and TypeScript compilers, the Node.js runtime, the JVM runtime) | A language needs logic that rules and block parsers cannot express |
| A check step for interpreted languages | Syntax errors become compile errors with a line, and the program never starts | |
| Runner behind internal HTTP + NDJSON, not Redis | One lab machine; fewer moving parts; progress events for free | Several runner machines are needed |
| In-memory execution store | No accounts or projects yet | Persistence (planned with Supabase/Postgres) |
| WebSocket sends full snapshots | Simple client logic; no lost-update bugs | Output streaming (large payloads) |
| Monaco and Tree-sitter bundled locally, lazy-loaded | Works offline in a lab; first paint does not wait for them | |
| Editor owns its text while typing | Replacing the value on every render lost keystrokes during fast typing | |
| Language availability from the runner | A language whose image is not built is hidden instead of failing at Run | |
| Saarthi on the server, grounded in stored runs | Keys never reach the browser; answers can only use evidence the platform produced; one place for limits and cache | |
| Verification by running, not by asking | A model's opinion about its own fix is not evidence | |
| No peak-memory figure | Unreliable after exit on cgroup v1/v2 without a supervisor; a wrong number is worse than none | Measure via cgroup v2 `memory.peak` |

</details>

Full details: [docs/architecture.md](docs/architecture.md).

<p align="right"><a href="#readme-top">back to top</a></p>

## Live analyzer

While you type, the editor's text goes to a **Web Worker** 150 ms after the last change. The worker parses it with
the language's **Tree-sitter** grammar (compiled to WebAssembly and bundled with the app), turns error and missing
nodes into short messages ("Missing `;`", "This `{` is never closed") and adds the rules a grammar does not
enforce. Nothing is sent to the server or to the AI while typing.

Each slip is shown the way Saarthi's panel shows every problem: **ERROR** (the message and its place), **WHY** (what
the rule is), **CONCEPT** (the topic behind it, such as *Statements* or *Block headers*) and, where the repair is
unambiguous, a rule-based **QUICK FIX** such as `[ ADD ; ]`. A quick fix is one undoable edit, previewed first; the
analyzer then re-reads the code, which is the fix's first check, and Run confirms it with a real compile. The same
syntax tree also names the **concept at your cursor** (for example `C++ → Functions → Function calls →
Parameters`). The entry page has a small playground that runs this same analyzer, so visitors can break a program
and watch it being caught before they sign in.

```mermaid
sequenceDiagram
    participant E as Editor (Monaco)
    participant H as useLiveCheck
    participant W as Web Worker (Tree-sitter, WASM)
    E->>H: the text changed
    Note over H: waits until 150 ms pass without a change
    H->>W: {generation 42, language, text}
    W->>W: parse with the grammar (loaded on first use)<br/>ERROR and MISSING nodes become messages<br/>plus language rules (Python ':' and indentation)
    W-->>H: {generation 42, problems}
    H->>H: drop the answer if a newer generation exists<br/>or the text is no longer the same
    H-->>E: squiggles, the concept at the cursor and quick fixes
```

* **Python 3's own rules**, following CPython's tokenizer: a missing `:` after `if`/`def`/`for`/..., unexpected
  or inconsistent indentation, mixed tabs and spaces, a block without a body, `else if` instead of `elif`, `=`
  where `==` was meant, and Python 2's `print "x"`.
* **Ruby, Lua and Bash**: the missing `then`/`do`/`end`/`fi`/`done` messages.
* **It is a syntax check, not a compiler.** Undeclared names and wrong types are reported when the program runs,
  and the interface says so. SQL (dialects differ) and Swift have no live check.

**Measured latency**, from the keystroke to the updated markers on screen, including the 150 ms pause: 500-line
files, 14 languages, 20 edits each, headless Chromium on a 2-vCPU machine, development build. Target: p95 under
300 ms. With the KAIRO console and its interaction layer (30 Sep 2026) the overall p50 was 172.3 ms and the p95
187.2 ms in the full browser suite (172.2 and 190.0 ms when run alone). The code from before the redesign, measured
on the same machine the same day, gave 169.9 and 189.3 ms: the new interface costs nothing measurable while typing.
With the notebook, the extensions and AI autocomplete added (6 Oct 2026), the full browser suite measured 172.6 ms
(p50) and 196.7 ms (p95). With the VS Code-style workspace, the streamed Saarthi chat and accounts (15 Oct 2026):
174.2 ms (p50) and 203.9 ms (p95) in the full browser suite, 175.9 and 206.9 ms when run alone. The bars below are
the p95 per language from the 30 Sep full run; the line is the 300 ms target.

```mermaid
xychart-beta
    title "Keystroke to markers, p95 in ms (500-line files)"
    x-axis ["C", "C++", "Java", "Python", "JS", "TS", "Go", "Rust", "C#", "Kotlin", "PHP", "Ruby", "Lua", "Bash"]
    y-axis "milliseconds" 0 --> 320
    bar [194.7, 182.8, 187.7, 186.2, 184.3, 193.4, 184.7, 184.8, 189.6, 178.9, 183.6, 187.4, 181.1, 185.1]
    line [300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300]
```

<details>
<summary><b>Latency table and false-positive checks</b></summary>

| Language | p50 | p95 | Parse and analyse in the worker, p95 |
|---|---|---|---|
| C | 173.0 ms | 194.7 ms | 3.5 ms |
| C++ | 170.3 ms | 182.8 ms | 3.2 ms |
| Java | 171.4 ms | 187.7 ms | 4.4 ms |
| Python | 173.8 ms | 186.2 ms | 9.9 ms |
| JavaScript | 170.5 ms | 184.3 ms | 3.0 ms |
| TypeScript | 173.0 ms | 193.4 ms | 4.7 ms |
| Go | 171.3 ms | 184.7 ms | 2.5 ms |
| Rust | 171.2 ms | 184.8 ms | 3.1 ms |
| C# | 172.8 ms | 189.6 ms | 7.7 ms |
| Kotlin | 172.9 ms | 178.9 ms | 5.3 ms |
| PHP | 170.8 ms | 183.6 ms | 2.4 ms |
| Ruby | 172.7 ms | 187.4 ms | 4.3 ms |
| Lua | 171.2 ms | 181.1 ms | 3.7 ms |
| Bash | 170.5 ms | 185.1 ms | 3.8 ms |
| **All 280 edits** | **172.3 ms** | **187.2 ms** | |

The time is dominated by the 150 ms pause; the parse itself takes a few milliseconds. A check that flags correct
code teaches the wrong thing, so correct code was checked first:

| Corpus | Result |
|---|---|
| CPython 3.11's standard library (672 `.py` files) | **0** files flagged |
| The shipped starters and examples without a syntax error (14 languages) | **0** of 66 flagged |
| The shipped examples with a syntax error | **9 of 9** flagged, on the line of the mistake or with a hint about the line before |

Method and details: [docs/milestones/M3-M6-report.md](docs/milestones/M3-M6-report.md#4-live-checking-while-typing).

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Diagnostics: one format for every toolchain

Every toolchain prints errors differently. The API reads each step's output and produces the same diagnostic
shape for all 32 languages, so the editor, the problems panel and Saarthi work the same way everywhere.

```mermaid
flowchart TB
    subgraph read["1 · Read the output"]
        direction LR
        A["Raw output<br/>stdout and stderr of each step"] --> B["Grammar rules<br/>line by line, per toolchain"]
        B --> C["Block parsers<br/>tracebacks, stack traces, panics"]
        B -.->|"a line no rule explains"| U["UNPARSED diagnostic<br/>pointing at the raw output"]
    end
    subgraph decide["2 · Decide what it means"]
        direction LR
        D["Classification<br/>stable codes such as<br/>C_MISSING_SEMICOLON"] --> E["Hints<br/>the ';' belongs on the line before"]
        E --> F["Synthesis<br/>signals, timeouts, limits"]
        F --> G["Merge duplicates<br/>keep the higher severity"]
        G --> H[("Diagnostics<br/>line, column, code, message")]
    end
    read --> decide
```

* **Grammar matching.** Each line is matched against the language's ordered rules (`grammars/*.toml`): it starts a
  diagnostic, adds a detail or a related location, sets context, or is known noise such as caret lines.
* **Block parsers** read Python tracebacks, JVM and .NET exceptions with their stack traces, rustc's multi-line
  errors, Rust and Go panics, C++ `terminate` messages, and Node.js, PHP, Ruby, Lua and SQLite errors; the frame
  that belongs to the student's file gives the line. TypeScript runtime errors are mapped back through source maps.
* **Nothing is dropped.** A line no rule explains becomes an `UNPARSED` diagnostic pointing at the raw output.
* **Crashes never look like success.** Signals and limits that print nothing (SIGSEGV, SIGFPE, timeouts, memory
  and output limits) produce diagnostics such as `RUNTIME_SEGMENTATION_FAULT` or `LIMIT_TIMEOUT`.
* **Positions** are 1-based lines and UTF-16 columns, as in Monaco and LSP; tools that report bytes are converted
  using the exact source snapshot.

<details>
<summary><b>A real diagnostic, as the API returns it</b></summary>

```json
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
```

The full execution format, every state and the runner contract are in [docs/api.md](docs/api.md).

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Saarthi, the AI guide

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/saarthi-loop-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/saarthi-loop-light.svg">
  <img alt="Saarthi's loop: a run produces problems; Saarthi explains one from that run's evidence; it suggests the smallest patch as a diff; nothing changes until the student applies it; the patched code runs in the sandbox and the verdict comes from that run." src="docs/images/readme/saarthi-loop-dark.svg" width="100%">
</picture>

Saarthi is optional: without an AI provider the editor, the live check, compiling and running all work, and
Saarthi says it is not set up.

| Action | Where | What happens |
|---|---|---|
| **Explain** | "Explain" on a problem card, or Ctrl+Shift+Enter | Explains that diagnostic of the last run: what went wrong, why, which line to look at, what to change, related concepts, and a confidence level |
| **Suggest a fix** | "Fix" on a problem card | Proposes the smallest edit as a line diff. **Nothing changes** until the student presses Apply |
| **Apply and verify** | on the suggested patch | Applies the patch (one Ctrl+Z undoes it) and runs the program again; the verdict comes from that run |
| **Ask** | the Saarthi panel | A free question about the code, a concept or the last run, sent only when the student presses Enter |

```mermaid
sequenceDiagram
    actor S as Student
    participant B as Browser
    participant A as API (Saarthi)
    participant M as AI provider
    participant R as Runner and sandbox
    S->>B: Fix (on a problem card)
    B->>A: POST /assistant/fix {executionId, sourceHash, diagnosticId}
    A->>A: the editor's hash must match the run (409 if not)<br/>build the evidence from the stored run
    A->>M: evidence + a strict answer schema
    M-->>A: whole-line edits
    A->>A: validate: lines exist, at most 60 lines, applies to the snapshot
    A-->>B: patch, fixId, patchedSourceHash
    S->>B: Apply and verify
    B->>A: POST /executions (the patched code)
    A->>R: a fresh sandbox run
    R-->>A: result
    B->>A: POST /assistant/verify {fixId, executionId}
    A-->>B: fixed, improved, not_fixed or different_code
```

| Guard | How |
|---|---|
| Grounded in one run | The server (never the browser) builds the evidence from a stored execution: the numbered source snapshot, up to 12 diagnostics with the focus marked, the final state, input and output, and the toolchain version |
| No stale answers | Every request carries the editor's source hash; if the code changed since the run, the API answers `409` |
| Structured answers | Claude is called with a forced tool call whose JSON schema is the answer format; OpenAI-compatible servers use JSON mode. Anything that does not validate is rejected |
| Untrusted text stays data | Code, input, output and questions are wrapped in tags the system prompt declares to be data; tag names inside them are defused |
| Patch policy | Whole-line replacements of the snapshot: in range, not overlapping, at most 60 changed lines, must change something, within the size limit |
| Verification by running | `/assistant/verify` compares the run of the patched code with the original run. It never asks the model |
| Cost and privacy | Requests only on a button press; 6 a minute and 150 a day per client, 3000 a day per server, 4 in flight; identical requests answered from a 30-minute cache; keys stay on the server |

| Verdict | Meaning | `verified` |
|---|---|---|
| `fixed` | The patched program ran and finished without errors | true |
| `improved` | The targeted problem is gone, but the run still reports other errors | false |
| `not_fixed` | The same problem is still there | false |
| `different_code` | The run was not of exactly the patched code (it was edited further) | false |

> [!IMPORTANT]
> With a hosted provider, the evidence (the student's code, its input and output) is sent to that provider when
> a student presses a Saarthi button. Tell students so, and use a local model (Ollama) where code must not leave
> the network. Saarthi has been tested with a scripted fake Claude and a canned stand-in server; it has **not yet
> been tried with a real model**.

Full design and configuration: [docs/saarthi.md](docs/saarthi.md).

<p align="right"><a href="#readme-top">back to top</a></p>

## Security model

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/sandbox-layers-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/images/readme/sandbox-layers-light.svg">
  <img alt="Four nested layers around the student's program: API admission, runner policy, the container, and kernel-enforced limits per step." src="docs/images/readme/sandbox-layers-dark.svg" width="100%">
</picture>

| Control | Compile or check steps | Run step |
|---|---|---|
| Network | none | none |
| Root file system | read-only | read-only |
| Workspace `/workspace` | read-write (to write the program) | **read-only** |
| Writable scratch | `/tmp` tmpfs, noexec, size per profile | `/tmp` tmpfs, 16 MB, noexec |
| User | 10001:10001, all capabilities dropped, `no-new-privileges` | same |
| Memory (swap off), processes, CPU time, wall clock | from the language profile, within the runner's ceilings | same |
| Output per stream | 64 KB, then the container is stopped | same |
| Core dumps and open files | 0 and 256 | same |
| PID 1 | tini | tini |
| Seccomp and AppArmor | Docker defaults | Docker defaults |

<details>
<summary><b>Six hostile programs in every language: all contained</b></summary>

Every language runs the same six hostile programs through the production path: the profile builds the job, the
runner's policy checks it, the sandbox runs it and the API decides the final state. Results from 27 Sep 2026:

| Language | Endless loop | Memory hog | Process or thread bomb | Network | Write to workspace | Output flood |
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

Codes in backticks are the language runtime's own errors, which fire before the sandbox's limit; the sandbox limit
is still there behind them. The runner's own corpus adds privilege, daemon, disk-fill, process-snooping and
compiler-abuse programs in C.

</details>

<details>
<summary><b>Threats and controls</b></summary>

| Threat | Control |
|---|---|
| Shell or command injection through source, file names or input | Argument arrays only, no shell anywhere; source and input are data (a file and a stream); file names are validated |
| Client picks the image, compiler flags or environment | Not possible: the job is built from the trusted profile; the runner allow-lists images and refuses `LD_*` and `DYLD_*` variables |
| Network access | `network_mode=none` for every step |
| Privilege escalation | Non-root user 10001, all capabilities dropped, `no-new-privileges`, no setuid binaries, default seccomp and AppArmor |
| Changing the image or persisting files | Read-only root file system; workspace read-only during the run; only a size-limited `/tmp`; everything deleted after the job |
| CPU, memory, process, disk and output exhaustion | CPU quota and RLIMIT_CPU, cgroup memory limit with swap off, cgroup PID limit, RLIMIT_FSIZE and tmpfs size, 64 KB output cap |
| Processes that outlive the run | tini as PID 1; containers and volumes always removed; a reaper removes labelled leftovers older than 5 minutes |
| Flooding the service | Bounded API queue (503 with Retry-After), bounded dispatch workers, runner capacity check |
| Hijacking the runner | Not published; token checked in constant time; internal network only |
| Script injection in the browser | Output, compiler messages and AI answers are rendered as text, never as HTML |
| Results or fixes for changed code | SHA-256 source hash compared in the browser; the API refuses stale Saarthi requests with 409 |
| Prompt injection through code or output | Evidence is data inside defused tags; strict answer schema; Saarthi has no tools and cannot run code or change files |
| Leaking the AI key | Only in the API's environment; never in the browser bundle, responses or logs |

Residual risks (a shared kernel, the runner holding the Docker socket, no accounts yet) and the plan for each are
listed in [docs/threat-model.md](docs/threat-model.md).

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Languages

| Language | Toolchain | Sandbox image | Steps | Live check | Examples |
|---|---|---|---|---|---|
| C | GCC 13 | `sandbox-gcc:13` | compile, run | yes | 9 |
| C++ | G++ 13 | `sandbox-gcc:13` | compile, run | yes | 4 |
| Java | OpenJDK 21 | `sandbox-java:21` | compile, run | yes | 4 |
| Python | CPython 3.12 | `sandbox-python:3.12` | syntax check, run | yes, plus Python 3 rules | 4 |
| JavaScript | Node.js 18 | `sandbox-node:18` | syntax check, run | yes | 4 |
| TypeScript | TypeScript 7 (`tsc --strict`) on Node.js 18 | `sandbox-node:18` | compile (type check), run | yes (syntax) | 4 |
| Go | Go 1.23 | `sandbox-go:1.23` | compile, link, run | yes | 4 |
| Rust | rustc 1.75 | `sandbox-rust:1.75` | compile, run | yes | 4 |
| C# | .NET 8 (Roslyn `csc`) | `sandbox-dotnet:8.0` | compile, run | yes | 4 |
| Kotlin | Kotlin 2.4 on a Java 21 runtime | `sandbox-kotlin:2.4` | compile, run | yes | 4 |
| PHP | PHP 8.3 | `sandbox-scripting:24.04` | lint (`php -l`), run | yes | 4 |
| Ruby | Ruby 3.2 | `sandbox-scripting:24.04` | syntax check (`ruby -wc`), run | yes | 4 |
| Lua | Lua 5.4 | `sandbox-scripting:24.04` | syntax check (`luac -p`), run | yes | 4 |
| Bash | Bash 5.2 | `sandbox-scripting:24.04` | syntax check (`bash -n`), run | yes | 4 |
| SQL | SQLite 3.45 (in-memory database) | `sandbox-scripting:24.04` | run | no | 4 |
| R | R 4.3 (`Rscript`) | `sandbox-extra:24.04` | syntax check, run | no | 4 |
| Assembly | NASM 2.16 + GNU ld (x86-64 Linux, `_start` + syscalls) | `sandbox-native:24.04` | assemble, link, run | no | 4 |
| Lex | flex 2.6 + GCC 13 (`-lfl`) | `sandbox-native:24.04` | generate scanner, compile, run | no | 3 |
| Verilog | Icarus Verilog 12 (`-g2012`) | `sandbox-native:24.04` | elaborate, simulate | no | 3 |
| Prolog | SWI-Prolog 9 | `sandbox-extra:24.04` | load and run | no | 4 |
| Fortran | gfortran 13 (`-fcheck=all`) | `sandbox-native:24.04` | compile, run | no | 4 |
| Pascal | Free Pascal 3.2 (`-Cr -Co`) | `sandbox-native:24.04` | compile, run | no | 4 |
| COBOL | GnuCOBOL 3.1 (fixed form, `-debug`) | `sandbox-native:24.04` | compile, run | no | 4 |
| Perl | Perl 5.38 (`-w`) | `sandbox-extra:24.04` | syntax check (`perl -wc`), run | no | 3 |
| Common Lisp | SBCL 2.2 (`--script`) | `sandbox-extra:24.04` | run | no | 3 |
| Scheme | GNU Guile 3.0 | `sandbox-extra:24.04` | run | no | 3 |
| Erlang | Erlang/OTP 25 | `sandbox-extra:24.04` | compile (`erlc`), run | no | 4 |
| Elixir | Elixir 1.14 on OTP 25 | `sandbox-extra:24.04` | run | no | 4 |
| Nim | Nim 1.6 (C backend, GCC 13) | `sandbox-native:24.04` | compile, run | no | 4 |
| D | GDC 13 | `sandbox-native:24.04` | compile, run | no | 4 |
| Ada | GNAT 13 (`gnatmake`) | `sandbox-native:24.04` | compile, run | no | 4 |
| Tcl | Tcl 8.6 (`tclsh`) | `sandbox-extra:24.04` | run | no | 3 |
| HTML | The browser (sandboxed preview frame) | none: runs in the browser | preview | language service | 3 |
| CSS | The browser, on a sample page | none: runs in the browser | preview | language service | 3 |
| React (JSX) | Sucrase + React 18 in the browser | none: runs in the browser | compile (JSX), preview | language service | 4 |
| Python notebook | CPython 3.12, cells replayed in one namespace | `sandbox-python:3.12` | run cells | yes, per cell | starter notebook |
| Swift *(experimental)* | Swift 6.1 | `sandbox-swift:6.1` (opt-in) | compile, run | no | 3 |

Every language is configuration, not code: a profile with trusted argument arrays and limits, error grammars, a
sandbox image, examples and tests. The runner, the API routes, the diagnostic format and the editor are shared by
all of them. Exact commands and per-step limits: [docs/languages.md](docs/languages.md). Adding a language:
[docs/adding-a-language.md](docs/adding-a-language.md). How the [web preview](docs/languages.md#html-css-and-react-in-the-browser),
the [notebook](docs/languages.md#python-notebooks) and the [formatters](docs/languages.md#formatters) work is in
the same document.

> [!NOTE]
> Swift is prepared but **not verified**: its base image could not be downloaded where the project was built.
> It stays hidden until its image is built and its tests pass ([how to enable it](docs/languages.md#enabling-swift)).

<p align="right"><a href="#readme-top">back to top</a></p>

## Profiles, XP and badges

Everyone starts on the entry page: a hero whose code glyphs scatter around the pointer, Saarthi on its
holo-platform with cards that tilt towards you, a scrolling tour of the pipeline guided by Saarthi, and a live
analyzer playground.
**Guests** need only a name, an emblem, an experience level and a start language; their profile lives in the
browser. **Accounts** (email and password with Create account and password reset; Google, GitHub, Microsoft and
phone when set up) save the code, progress, badges and settings to Supabase, so they follow the student to any
device ([docs/accounts.md](docs/accounts.md)).

Only things the platform observed earn XP, never self-reported ones:

| Event | XP |
|---|---|
| Any run | 2 |
| A clean run (finished, no errors) | +10 |
| First clean run in a language | +15 |
| A clean run after the previous one in that language failed ("fixed an error") | +10 |
| First clean run of the day | +5 × the day streak (up to 7) |
| An explanation from Saarthi | 5 |
| A Saarthi fix verified by a real run | 20 |
| Opening an example | 3 |

Ten levels (Initiate, Syntax Scout, Bug Hunter, Builder, Debugger, Optimizer, Architect, Compiler Whisperer,
Systems Master, KAIRO Legend) and 14 badges (First Build, Bug Squasher, Curious Mind, Input Handler, Explorer,
On a Roll, Polyglot, Verified Fix, Three-Day Uptime, Night Owl, Unstoppable, Toolchain Master, Week of Code,
Century). The profile card shows them with a **language matrix**: one cell per language, lit after a clean run in
it.

<p align="right"><a href="#readme-top">back to top</a></p>

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Editor | [Monaco Editor](https://microsoft.github.io/monaco-editor/) 0.57 | The editor of VS Code: markers, keyboard shortcuts, inline (ghost text) completions, syntax modes for every language; bundled locally and lazy-loaded |
| Editor extensions | [Prettier](https://prettier.io) 3.9, [emmet-monaco-es](https://github.com/troy351/emmet-monaco-es) 5.7, [monaco-vim](https://github.com/brijeshb42/monaco-vim) 0.4 | Formatting, Emmet abbreviations and Vim keys, each loaded the first time it is used |
| Web preview | [Sucrase](https://github.com/alangpierce/sucrase), React 18 bundled for the frame | JSX compiled in the browser; HTML, CSS and React run in a sandboxed frame |
| Web app | [React](https://react.dev) 18.3, [TypeScript](https://www.typescriptlang.org) 5.9, [Vite](https://vite.dev) 8, [Tailwind CSS](https://tailwindcss.com) 4, [Lucide](https://lucide.dev) icons | A typed, fast single-page app; the API's TypeScript types are generated from its OpenAPI schema |
| Live check | [Tree-sitter](https://tree-sitter.github.io) via `web-tree-sitter` 0.27 in a Web Worker | Incremental, error-tolerant parsers for 14 languages, compiled to WebAssembly |
| Fonts | Geist and JetBrains Mono, variable (bundled) | Readable text and code; no request to a font service |
| API | [FastAPI](https://fastapi.tiangolo.com) 0.141, [Pydantic](https://docs.pydantic.dev) 2.13, [Uvicorn](https://www.uvicorn.org), [HTTPX](https://www.python-httpx.org), Python 3.12 | Typed models become the contracts; async WebSocket events; OpenAPI docs at `/docs` |
| Language adapters | TOML profiles and grammars | Adding a language is configuration: commands, limits, error rules |
| Runner | FastAPI service using the [Docker SDK for Python](https://docker-py.readthedocs.io) 7.2 | The only component with Docker access; NDJSON progress events |
| Sandboxes | Docker, 11 images built `FROM ubuntu:24.04`, tini | Real toolchains (and the formatters clang-format 18, Black, gofmt, shfmt) in hardened, throwaway containers |
| AI | [Claude API](https://platform.claude.com) (default model `claude-haiku-4-5-20251001`) or any OpenAI-compatible server such as [Ollama](https://ollama.com) | Replaceable; keys stay on the server |
| Accounts (optional) | [Supabase](https://supabase.com) Auth via `@supabase/supabase-js` | Google, GitHub, Microsoft, phone and email sign-in when configured |
| Tests | [pytest](https://pytest.org), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) 1.56 | Unit, golden, end-to-end language and browser tests |
| Quality | [Ruff](https://docs.astral.sh/ruff/), `tsc`, `npm audit` | Lint, type-check, dependency audit |
| Delivery | Docker Compose, GitHub Codespaces (dev container), GitHub Actions, `make` | One command per task, on any machine with Docker |

<p align="right"><a href="#readme-top">back to top</a></p>

## Quick start

**Use it online:** <https://kairo-ai-phi.vercel.app>, nothing to install (or install it as an app from there).

To run your own copy, pick one way. The first three need a Linux Docker daemon; the fourth needs only Vercel and
Supabase accounts.

<details open>
<summary><b>A. GitHub Codespaces (no Docker on your computer)</b></summary>
<br>

1. On the repository page: **Code → Codespaces → Create codespace**. Setup runs by itself.
2. Build the sandbox images: `make image-gcc` (C and C++) or `make images` (all languages).
3. In three terminals: `make runner`, `make api`, `make web`, then open the forwarded port 5173.

Full guide: [docs/codespaces.md](docs/codespaces.md).

</details>

<details>
<summary><b>B. Docker Compose (Linux, macOS, Windows with Docker Desktop)</b></summary>
<br>

```bash
cp .env.example .env                    # set RUNNER_TOKEN; optionally ANTHROPIC_API_KEY
docker compose --profile images build   # the sandbox images, the API and the runner
docker compose up -d
```

Open <http://localhost:8080>. The first build downloads base images and packages (about 11 GB for all
languages).

</details>

<details>
<summary><b>C. Local development (Linux, macOS, WSL 2)</b></summary>
<br>

Needs Python 3.12, Node.js 22, Docker and `make`.

```bash
make setup     # .venv with the API and runner, npm install for the web app
make images    # the sandbox images (or one: make image-gcc, make image-python ...)
make runner    # terminal 1: the sandbox runner on :8081 (the only process with Docker access)
make api       # terminal 2: the API on :8000
make web       # terminal 3: http://localhost:5173
```

`make help` lists every target. For Saarthi without a key, `make mock-ai` and `make api-mock` start a canned
stand-in that is clearly labelled as not an AI.

</details>

<details>
<summary><b>D. Vercel (no Docker, always online)</b></summary>
<br>

1. Import the repository in Vercel; `vercel.json` and `pyproject.toml` configure everything (no environment
   variables are required).
2. Build the runner snapshot once and create the `kairo-runner` sandbox from it.
3. Create a Supabase project, apply `supabase/migrations/`, put its URL and publishable key in
   `infra/vercel/public-settings.json`, and turn off "Confirm email".

Step by step: [infra/vercel/README.md](infra/vercel/README.md) and [docs/accounts.md](docs/accounts.md).

</details>

**First things to try:** press **Run** on the starter program; open **Examples → Missing semicolon → Run**, then
**Explain**, **Fix** and **Apply and verify**; switch to Python and type `if x > 1` without the colon; press
**Ctrl+K** and type a few letters of anything (a language, an example, "fold", ":12"); press **Shift+Alt+F** to
format messy code; open the **notebook** from the left bar and press **Shift+Enter** in a cell; pick **React** or
**HTML** and watch the preview follow your typing.

<p align="right"><a href="#readme-top">back to top</a></p>

## Configuration

<details>
<summary><b>Environment variables (<code>.env</code> for Docker Compose, the environment for <code>make</code>)</b></summary>
<br>

| Variable | Default | Meaning |
|---|---|---|
| `RUNNER_TOKEN` | *(required)* | Shared secret between the API and the runner. Use a long random string |
| `RUNNER_WORKERS` | `4` | Sandboxes that may run at once (the API dispatches the same number) |
| `WEB_PORT` | `8080` | Port for the app and API with Docker Compose |
| `WEB_BIND` | `127.0.0.1` | Interface to listen on. `0.0.0.0` only on a trusted network |
| `CC_AI_PROVIDER` | `anthropic` (`gateway` on Vercel) | `anthropic`, `openai` (any OpenAI-compatible server), `gateway` (Vercel AI Gateway) or `none` |
| `ANTHROPIC_API_KEY` | empty | Key for Claude. Without it Saarthi is off and everything else works |
| `CC_AI_MODEL` | `claude-haiku-4-5-20251001` | Model id |
| `CC_AI_BASE_URL` | empty | For `openai`: e.g. `http://127.0.0.1:11434/v1` (Ollama) |
| `CC_AI_API_KEY` or `OPENAI_API_KEY` | empty | For `openai` servers that need a key (Ollama does not) |
| `CC_AI_REQUESTS_PER_MINUTE` / `_PER_DAY` | `10` / `150` | Saarthi limits per client (IP address) |
| `CC_AI_DAILY_BUDGET` | `3000` | Saarthi requests per day for the whole server |
| `CC_MAX_QUEUE` | `20` | Runs that may wait; beyond that the API answers 503 with Retry-After |
| `CC_MAX_SOURCE_BYTES` / `CC_MAX_STDIN_BYTES` | 64 KB / 16 KB | Size limits of a run |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | empty | Turn on accounts (public values, used at build time) |
| `VITE_AUTH_PROVIDERS` | empty | Extra sign-in buttons: `google`, `github`, `azure`, `phone` |

Keys stay on the server: `.env` is git-ignored, and no response or log contains them. The Vercel deployment's
settings (all optional) are listed in [infra/vercel/README.md](infra/vercel/README.md).

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## API at a glance

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/languages` | The 16 language profiles, their commands and limits, and whether each image is installed |
| `GET` | `/api/v1/health` | API status plus what the runner reports |
| `POST` | `/api/v1/executions` | Queue a compile-and-run of `{languageId, source, stdin}`: `202`, or `409` / `413` / `422` / `503` |
| `GET` | `/api/v1/executions/{id}` | The current snapshot of a run |
| `WS` | `/api/v1/executions/{id}/events` | A full snapshot on every change; closes after the final state |
| `GET` | `/api/v1/assistant/status` | Whether Saarthi is enabled, the provider, model and limits (never the key) |
| `POST` | `/api/v1/assistant/explain` | Explain a diagnostic of a finished run |
| `POST` | `/api/v1/assistant/fix` | Propose the smallest patch for a diagnostic |
| `POST` | `/api/v1/assistant/verify` | Decide from a real run of the patched code whether the fix worked |
| `POST` | `/api/v1/assistant/ask` | Answer a question about the code, a concept or a run |

```bash
# Run a Python program and read the result
curl -s -X POST http://localhost:8000/api/v1/executions \
  -H 'Content-Type: application/json' \
  -d '{"languageId": "python", "source": "print(\"Namaste\")", "stdin": ""}'
curl -s http://localhost:8000/api/v1/executions/<id>
```

Interactive OpenAPI docs are served at `/docs` while the API runs. Contracts: [docs/api.md](docs/api.md) and
`packages/contracts/`.

<p align="right"><a href="#readme-top">back to top</a></p>

## Testing and quality

| Suite | Command | Result (15 Oct 2026) |
|---|---|---|
| API | `pytest services/api` | **378 passed**: golden tests for every toolchain's real output, all 41 profiles (32 languages, Swift, 7 formatters, the notebook), endpoints, the state machine, Saarthi (explain, fix, verify, ask, streamed answers, autocomplete) against scripted fake models, the Vercel setup (streamed runs, signed evidence across instances, the Vercel Sandbox client against a fake Vercel API, OIDC tokens, the keep-alive, serving the web app), contract freshness |
| Runner | `pytest services/runner` | **49 passed**: policy, HTTP layer and the containment corpus against real Docker |
| Every language end to end | `make test-languages` | **459 passed, 15 skipped** (Swift, and Verilog's process and network programs; 6 Oct 2026): for each language and the notebook a program with input, a compile error, a runtime error, out-of-memory codes, six hostile programs, every example, and the seven formatters |
| The same, in the Vercel Sandbox runner VM | `KAIRO_EXECUTOR=/opt/kairo/sbin/kairo_exec.py pytest tests/integration` (inside the VM) | **459 passed, 15 skipped** (14 Oct 2026): the Docker-free executor contains the same hostile programs |
| Web unit tests | `vitest run` | **162 passed**: live-check rules and quick fixes, concepts, edits, the palette's fuzzy matching, markers, patches, hashes, run pipeline, moods, XP and badges, the preview documents, notebook runs and `.ipynb`, ghost-text brackets |
| Browser tests | `make e2e` | **93 passed** (Chromium): boot sequence, entry page chapters, header links and Saarthi's hello and welcome, sign-in options, playground, pipeline tour, custom cursor, reduced motion, command palette, draggable Saarthi, tour, runs, errors, stale results, crashes, input, language picker, fast typing, drafts, themes, sounds, tablet and phone layouts, one example per language, HTML/CSS/React preview, the notebook, formatters, Emmet, Vim keys, AI autocomplete, live analyzer, quick fixes, concepts, latency, Saarthi explain, fix, verify and ask, badges and moods |
| Lint and types | `make lint` | `ruff` and `tsc -b`: clean. `npm audit --omit=dev`: 0 vulnerabilities (DOMPurify pinned to 3.4.16 under Monaco) |

```bash
make lint             # ruff + TypeScript type-check
make test             # API, runner (Docker tests skip without a daemon), web unit tests
make test-languages   # every language end to end in real sandboxes (needs the images)
make browsers         # once: Chromium for the browser tests
make e2e              # browser tests; start `make runner`, `make mock-ai`, `make api-mock` first
```

The CI workflow (`.github/workflows/ci.yml`) runs all of these on every push, builds every sandbox image from its
Dockerfile, and tries Swift in a separate job that may fail.

> [!WARNING]
> **Not verified yet, stated plainly:** building the images from the real Docker Hub base images (Docker Hub was
> blocked where this was built, so a local `ubuntu:24.04` made with `debootstrap` was used), Swift, GitHub
> Codespaces, the CI workflow on GitHub (linted, never run), Windows and macOS, Saarthi and AI autocomplete with a
> real model (only the labelled stand-in was used), accounts with a real Supabase project (Google, GitHub,
> Microsoft, phone codes, email, password reset), and browsers other than headless Chromium. Details in the
> [milestone report](docs/milestones/M3-M6-report.md#8-not-verified-stated-plainly).

<p align="right"><a href="#readme-top">back to top</a></p>

## Project structure

<details>
<summary><b>The repository, folder by folder</b></summary>

```text
apps/web/                    React 18 + TypeScript + Vite + Tailwind + Monaco
  src/auth/                  entry page (hero, pipeline tour, analyzer playground), guest profiles, Supabase sign-in
  src/cloud/                 an account's saved work: Supabase sync of drafts, progress, settings, notebook
  src/boot/                  the boot sequence (real system checks, the Astra star field)
  src/layout/                the VS Code-style workbench (resizable, hideable panels), top bar, status bar
  src/pwa/                   installing KAIRO as an app (the service worker is public/sw.js)
  src/workspace/             explorer, command palette and its commands
  src/fx/                    interaction layer: cursor, magnetic buttons, text and scroll reveals, tilt,
                             parallax, marquee, code-glyph canvas, star field and star flight, sounds
  src/styles/                KAIRO components (kairo.css) and motion (fx.css, astra.css)
  src/cosmos/                moods, celebrations
  src/mascot/                Saarthi's avatar and the draggable companion
  src/profile/               XP, levels, badges, streaks, profile card
  src/live/                  live syntax check (Tree-sitter in a Web Worker)
  src/editor/                Monaco setup, IntelliSense data, formatters, Emmet, AI ghost text
  src/extensions/            the Extensions view and its registry
  src/notebook/              the Jupyter-style Python notebook, its cells and terminal
  src/preview/               HTML, CSS and React in a sandboxed preview frame
  src/assistant/             Saarthi's chat panel (streamed answers)
  src/execution/             run journey, output, input, run details
  src/diagnostics/           problem cards, plain-language notes
  src/onboarding/            welcome, tour, examples for every language
  e2e/                       Playwright browser tests
services/api/app/            FastAPI: never runs code, never touches Docker
  adapters/profiles/*.toml   one profile per language: commands, limits, codes
  adapters/grammars/*.toml   how each toolchain's output is read
  analysis/                  grammar matching, classification, crash synthesis
  ai/                        Saarthi: evidence, prompts, providers, validation
  queue/                     runner clients: the Docker runner (HTTP) and the Vercel Sandbox VM
services/runner/runner/      the only component with Docker access; language-agnostic
infra/vercel/                the Vercel deployment: the runner VM's executor and snapshot build, build keys
supabase/migrations/         accounts schema with Row Level Security, keep-alive function
infra/containers/            sandbox images (gcc, java, python, node, go, rust, dotnet, kotlin, scripting, native,
                             extra, swift); python/notebook.py runs notebooks, python/format_python.py runs Black
tests/integration/           every language end to end, hostile programs, examples
packages/contracts/          generated OpenAPI and JSON Schemas
scripts/                     fixture capture, the stand-in AI for tests
vercel.json, pyproject.toml  Vercel build, function, cron and headers; the function's Python dependencies
.devcontainer/               GitHub Codespaces setup
docs/                        design, API, languages, threat model, reports, images
```

</details>

<p align="right"><a href="#readme-top">back to top</a></p>

## Roadmap and status

```mermaid
timeline
    title KAIRO milestones
    M1 : Repository, requirements and scope
    M2 : Vertical slice for C : sandbox, diagnostics, web IDE
    M3 : C++, Java, Python and eleven more languages
    M4 : Checking while typing
    M5 : Saarthi explanations grounded in evidence
    M6 : Reviewable fixes and re-verification
    UI : KAIRO console, boot sequence, Saarthi avatar, interactive entry page
    Live : Vercel deployment, accounts with saved work, streamed Saarthi, installable app
    M7 : Evaluation with students
```

| Milestone | Status |
|---|---|
| M1 Repository, requirements, scope | Done: [docs/scope.md](docs/scope.md) |
| M2 Vertical slice for C | Done: [report](docs/milestones/M2-report.md) |
| M3 C++, Java, Python, and eleven more languages | Done (Swift prepared, unverified): [report](docs/milestones/M3-M6-report.md) |
| M4 Checking while typing | Done |
| M5 Saarthi explanations grounded in evidence | Done (tested with a stand-in provider; a real key not yet tried) |
| M6 Reviewable fixes and automatic re-verification | Done |
| UI: the KAIRO console, boot sequence, Saarthi avatar, command palette, interactive entry page, badges | Done |
| 17 more languages, HTML/CSS/React preview, Python notebook, extensions and formatters, AI autocomplete, sign-in options | Done |
| Live site on Vercel without Docker: Vercel Sandbox runner, AI Gateway, Supabase accounts with saved code, progress, badges and settings, daily keep-alive, streamed Saarthi chat, VS Code-style workspace, installable app | Done: [infra/vercel/README.md](infra/vercel/README.md) |
| M7 Evaluation | Next |

**M7** is an evaluation with students (task completion, time to fix an error, usefulness of explanations), and
per-user limits in the API for signed-in accounts.

<p align="right"><a href="#readme-top">back to top</a></p>

## Team

| | Name | Role | Main areas |
|---|---|---|---|
| **Lead** | Vedant Gadage | Team lead, web app | Live analyzer, Saarthi panel and patches, the KAIRO console, entry page and interaction layer, profiles, mascot, examples, browser tests |
| | Prajwal Dudhal | Languages and sandboxes | Language profiles and error grammars, block parsers, sandbox images, golden tests, runner |
| | Pratiksha Gadhave | API and Saarthi | Execution API, language availability, Saarthi's server side |
| | Pooja Pyadewad | Testing | Golden tests, end-to-end language tests, hostile programs, runner |
| **Guide** | Dr. Alpana Adsul | Project guide | |

Department of Computer Engineering, DYPCOEI Varale, 2026-27, Group 04.

<p align="right"><a href="#readme-top">back to top</a></p>

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Components, flows, the sandbox, diagnostics, the live check, design decisions, known limitations |
| [docs/languages.md](docs/languages.md) | Every language's toolchain, commands and limits; enabling Swift |
| [docs/saarthi.md](docs/saarthi.md) | The AI guide, its safeguards and configuration |
| [docs/ui.md](docs/ui.md) | The KAIRO console, its design system and interaction layer, accessibility, measured performance |
| [docs/accounts.md](docs/accounts.md) | Guests, accounts with Supabase and what they save, the keep-alive, XP and badges |
| [infra/vercel/README.md](infra/vercel/README.md) | The live site on Vercel: how it fits together, deploying, the runner snapshot |
| [docs/api.md](docs/api.md) | REST, streaming and WebSocket API, the diagnostic format, the runner contract |
| [docs/threat-model.md](docs/threat-model.md) | Threats, controls, per-language containment results, residual risks |
| [docs/adding-a-language.md](docs/adding-a-language.md) | How a language is added |
| [docs/codespaces.md](docs/codespaces.md) | Running everything in GitHub Codespaces |
| [docs/scope.md](docs/scope.md), [docs/milestones/](docs/milestones/) | Requirements and milestone reports |

## Principles

* Student code runs only in the sandbox, never in the API process, and is never put into a shell command.
* Nothing a toolchain prints is silently dropped.
* Results and fixes apply only to the exact source they were made for.
* AI is optional and replaceable: editing, the live check, compiling and running work without it. No AI change is
  applied without the student's approval, and a fix is never called verified before a real run proves it.
* Every performance or accuracy number is measured and reported with its setup, never assumed.

## License

This repository has no license file: all rights are reserved by the authors.

## Acknowledgements

KAIRO stands on the work of many open-source projects: the GCC, OpenJDK, CPython, Node.js, TypeScript, Go,
Rust, .NET, Kotlin, PHP, Ruby, Lua, Bash, SQLite, R, NASM, flex, Icarus Verilog, SWI-Prolog, gfortran, Free
Pascal, GnuCOBOL, Perl, SBCL, GNU Guile, Erlang/OTP, Elixir, Nim, GDC, GNAT and Tcl toolchains; clang-format,
Black, gofmt and shfmt; Monaco Editor, Prettier, Emmet and monaco-vim; Tree-sitter and its grammars; Sucrase;
React, Vite and Tailwind CSS; FastAPI, Starlette and Pydantic; Docker and tini; Playwright, pytest and Vitest.

<p align="right"><a href="#readme-top">back to top</a></p>
