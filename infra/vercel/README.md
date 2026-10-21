# KAIRO on Vercel (no Docker)

The live site runs on Vercel's free Hobby plan and a free Supabase project.
There is no Docker host and no server to keep running: the web app is served
from Vercel's CDN, the API is one Python function, submitted code runs in a
Vercel Sandbox micro-VM, Saarthi uses Vercel AI Gateway, and accounts live in
Supabase.

```
Browser ──► Vercel CDN: the web app (apps/web/dist), installable as an app (PWA)
   │
   ├──► Vercel Function, Python, region bom1 (Mumbai): services/api/app/main.py (FastAPI)
   │       ├──► Vercel Sandbox "kairo-runner": a micro-VM started from the runner snapshot;
   │       │      kairo_exec.py runs every compile/run step in its own namespaces and cgroup
   │       │      (no network, read-only image, memory, CPU, process and time limits)
   │       ├──► Gemini API: Saarthi's model when GEMINI_API_KEY is set (free key, no card)
   │       └──► Vercel AI Gateway: Saarthi's model (or the backup), signed in with the deployment's OIDC token
   │
   └──► Supabase (Auth + Postgres with Row Level Security): accounts and saved work

Vercel Cron, daily ──► GET /api/v1/system/keepalive ──► Supabase keepalive() + wakes the runner VM
```

## What changes compared with Docker Compose

| Part | `make` / Docker Compose | Vercel |
|---|---|---|
| Web app | Vite dev server, or served by the API container | Built by `vercel.json`'s build command and served from the CDN (`app.frontend()` in `main.py`, promoted at build time) |
| API | uvicorn | One Python function (Fluid compute), at most 300 s per request |
| Code runner | `services/runner` starts Docker containers | `VercelSandboxRunner` (`services/api/app/queue/vercel_sandbox.py`) sends each job to the `kairo-runner` VM, where `kairo_exec.py` gives every step what the Docker runner gives a container (the table at the top of `runner/kairo_exec.py`) |
| A run | `POST /executions`, then polling | `POST /executions/run` streams the run's snapshots in the same request, because the next request may reach another instance |
| Saarthi's evidence | kept in the API's memory | also signed and handed to the browser (`evidence`), so any instance can answer about the run; see [docs/saarthi.md](../../docs/saarthi.md) |
| Saarthi's model | an Anthropic or OpenAI-compatible key | AI Gateway with the deployment's OIDC token (no key stored anywhere), or a free Gemini key with AI Gateway as the backup |
| Accounts | optional | Supabase, configured in `infra/vercel/public-settings.json` (public values only) |

The security rules are the same everywhere: submitted code never runs in the
API process, nothing from a job is passed through a shell (argument arrays
only), every language runs with resource limits, and every run keeps the exact
source snapshot it ran.

## Deploying

1. In Vercel, **Add New → Project** and import the GitHub repository. Vercel
   reads `vercel.json` and `pyproject.toml`: framework FastAPI, region `bom1`,
   and the build command, which
   * generates this deployment's evidence key (`build-keys.mjs`, written only
     into the function's bundle, never into Git or the web app),
   * writes the live site's public settings from `public-settings.json` (the
     Supabase project URL and publishable key) to `apps/web/.env.vercel`, and
   * builds the web app with them (`npm run build:vercel`).
2. The runner snapshot and the named sandbox `kairo-runner` must exist in the
   project (see below). They are not part of a deployment.
3. Give Saarthi an AI model, one of:
   * **AI Gateway** (the default): Vercel dashboard → **AI Gateway** → **Use
     Free AI Gateway Credit** and verify a card (it is not charged). The free
     credit gives $5 every 30 days for a limited set of models; the default
     model, `google/gemini-2.5-flash-lite`, is one of them. Without it AI
     Gateway refuses every request ("customer_verification_required" in the
     function log).
   * **Gemini API, no card**: create a key at aistudio.google.com (**Get API
     key**), add it as the environment variable `GEMINI_API_KEY` (mark it
     *Sensitive*) and redeploy. The key alone switches Saarthi to Google's
     Gemini API with `gemini-3.5-flash-lite`.

   With both, Gemini answers first and AI Gateway steps in whenever Gemini
   cannot answer (busy or out of free quota); `CC_AI_BACKUP=false` turns that
   off.

   While no model answers, Saarthi's chat answers from KAIRO's built-in
   knowledge, and the quick notes, fixes and runs keep working.
4. Every push to `main` deploys to production; other branches get preview
   deployments.

No environment variable is required. Optional ones (Project → Settings →
Environment Variables, then redeploy):

| Variable | Default | Use |
|---|---|---|
| `CC_EVIDENCE_SECRET` | a key generated at build time | A fixed key for signing run evidence and fix tokens (they then stay valid across deployments). Mark it *Sensitive*. |
| `CRON_SECRET` | none | Vercel sends it with the cron request. Without it, anyone may call the keep-alive, which then does its work at most once every 10 minutes per instance. Mark it *Sensitive*. |
| `GEMINI_API_KEY` | none | A Gemini API key from Google AI Studio (free tier, no card). When set, Saarthi uses Google's Gemini API first and AI Gateway as its backup. Mark it *Sensitive*. |
| `CC_AI_BACKUP` | `true` | `false`: no backup between Gemini and AI Gateway. |
| `CC_AI_MODEL` | `google/gemini-2.5-flash-lite` (covered by the free credit); `gemini-3.5-flash-lite` with `GEMINI_API_KEY` | Any model id from AI Gateway's model list. A model page's *Free AI Gateway Credit* column says whether the free credit covers it; newer models such as `google/gemini-3.5-flash-lite` need paid credit. |
| `VITE_AUTH_PROVIDERS` | email and password only | Extra sign-in buttons: `google`, `github`, `azure`, `phone` (set them up in Supabase first, see [docs/accounts.md](../../docs/accounts.md)). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `public-settings.json` | Another Supabase project. |
| `CC_VERCEL_SANDBOX_NAME` | `kairo-runner` | Another named sandbox. |

`VERCEL_FASTAPI_STATIC_CDN=1` is set for the build in `vercel.json`; it tells
Vercel's FastAPI builder to serve the web app's files from the CDN. If it were
missing, the function would serve them itself (slower, same pages).

## The runner snapshot

The snapshot holds the eleven sandbox images of `infra/containers`, exported
as plain root filesystems under `/opt/kairo/images` (about 6 GB), plus the
`hosts` and `hostname` files mounted into every step. It is built once, inside
a Vercel Sandbox VM, by `runner/build-snapshot.sh`: the script builds the
images with Docker from the same Dockerfiles CI uses, exports them, checks
each one with the executor, then removes Docker, so the VM that runs students'
code has no container engine at all.

The executor itself is not in the snapshot: on the first job of each VM
session the API uploads `runner/kairo_exec.py` from the deployment and installs
it root-owned at `/opt/kairo/sbin/kairo_exec.py`, so it always matches the API
that calls it.

The live site's snapshot was built on 2026-10-14 through the Vercel API with
these steps (the `sandbox` CLI equivalents are shown; see `sandbox --help`):

```bash
# 1. a build VM with internet access and time for eleven image builds
sandbox create --name kairo-build --timeout 45m
# 2. copy this repository into it and run the build script as root
tar -czf kairo.tgz --exclude=node_modules --exclude=.git .
sandbox copy kairo.tgz kairo-build:/tmp/kairo.tgz
sandbox exec kairo-build -- sh -c "mkdir -p /tmp/kairo && tar -xzf /tmp/kairo.tgz -C /tmp/kairo"
sandbox exec kairo-build -- sudo bash /tmp/kairo/infra/vercel/runner/build-snapshot.sh
# 3. snapshot it (this stops the build VM)
sandbox snapshot kairo-build --stop
```

Then create the runner from that snapshot: a **named sandbox `kairo-runner`**
in this project, region `bom1` (next to the function), 2 vCPUs, network
**deny-all**, and **not persistent**, so a session that ends never replaces the
snapshot and every session starts from the same clean images. Rebuild the
snapshot only when a Dockerfile in `infra/containers` changes.

A snapshot expires 7 days after it was last used. Every run uses it, and on
days without runs the daily keep-alive starts a session, so it does not expire
while the cron job runs. A snapshot created with `sandbox snapshot ... --expiration 0`
never expires.

### Busy runner

The VM runs as many steps at once as it has CPUs (two); a step that finds no
free slot waits up to 20 seconds, then the executor answers `busy`. The API
tries again for up to 12 seconds, then ends the run as rejected with "The
sandbox is at capacity. Please run again in a few seconds." A VM session starts
with 5 minutes and is extended by 5 minutes whenever a job needs more time;
when it reaches the longest session the plan allows, the API starts a fresh
one.

## Checking a deployment

```bash
curl -s https://<your-domain>/api/v1/health            # api: ok, runner: vercel-sandbox, images
curl -s https://<your-domain>/api/v1/assistant/status  # Saarthi: enabled, provider gateway, model
curl -s https://<your-domain>/api/v1/system/keepalive  # database: ok, runner: ok
```

Then open the site, run the C example (the first run of a session takes a few
seconds longer while the VM starts), introduce an error and ask Saarthi about
it, and create an account to see the status bar switch to **Synced**.
