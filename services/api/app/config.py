"""API configuration, read from environment variables prefixed CC_.

The AI provider keys are the exception: they are also read from the
provider's usual variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
AI_GATEWAY_API_KEY). Keys live only on the server; no response ever contains them.

On Vercel (the platform sets VERCEL=1) two defaults change, so a deployment
works without extra settings: code runs in the Vercel Sandbox runner VM
(runner_backend="vercel-sandbox") and Saarthi uses Vercel AI Gateway
(ai_provider="gateway"), signed in with the deployment's OIDC token. A
GEMINI_API_KEY (a free key from Google AI Studio) switches Saarthi to Google's
Gemini API instead, on Vercel and everywhere else. An explicit
CC_RUNNER_BACKEND or CC_AI_PROVIDER still wins.
"""

import os
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def on_vercel() -> bool:
    """True inside a Vercel deployment (build or function)."""
    return os.environ.get("VERCEL") == "1"


VERCEL_SANDBOX_IMAGES = [
    "compiler-copilot/sandbox-gcc:13", "compiler-copilot/sandbox-java:21", "compiler-copilot/sandbox-python:3.12",
    "compiler-copilot/sandbox-node:18", "compiler-copilot/sandbox-go:1.23", "compiler-copilot/sandbox-rust:1.75",
    "compiler-copilot/sandbox-dotnet:8.0", "compiler-copilot/sandbox-kotlin:2.4",
    "compiler-copilot/sandbox-scripting:24.04", "compiler-copilot/sandbox-native:24.04",
    "compiler-copilot/sandbox-extra:24.04",
]

# The program that runs a job inside the runner VM (uploaded to each new VM session).
REPO_ROOT = Path(__file__).resolve().parents[3]
VERCEL_EXECUTOR = REPO_ROOT / "infra" / "vercel" / "runner" / "kairo_exec.py"

# Written by the Vercel build (infra/vercel/build-keys.mjs) into the function's bundle
# only: a random key, new for every deployment, that signs run evidence when
# CC_EVIDENCE_SECRET is not set. It is never in Git or in the web app.
BUILD_EVIDENCE_KEY = REPO_ROOT / "services" / "api" / "app" / "_build" / "evidence.key"

# The live site's public settings (the Supabase project URL and publishable key):
# kept in infra/vercel/public-settings.json and written to this file by the Vercel
# build, for the web app (`vite build --mode vercel`) and, on Vercel, for the API's
# daily keep-alive. Environment variables win over it.
PUBLIC_SETTINGS = REPO_ROOT / "infra" / "vercel" / "public-settings.json"
PUBLIC_ENV_FILE = REPO_ROOT / "apps" / "web" / ".env.vercel"


def read_key_file(path: Path) -> str:
    """The key stored in `path`, or "" when there is none."""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CC_", extra="ignore", populate_by_name=True)

    # Where submitted code runs. "http": the runner service (Docker), at runner_url.
    # "vercel-sandbox": a Vercel Sandbox micro-VM started from the runner snapshot
    # (the Vercel deployment; see infra/vercel/README.md). Default: "vercel-sandbox"
    # on Vercel, "http" everywhere else.
    runner_backend: Literal["http", "vercel-sandbox"] = Field(
        default_factory=lambda: "vercel-sandbox" if on_vercel() else "http")

    # Where the runner listens and the shared secret it expects.
    runner_url: str = "http://127.0.0.1:8081"
    runner_token: str = ""

    # The named Vercel Sandbox that runs jobs, the images its snapshot holds, and the
    # executor the API installs in each new VM session (kept in this repository).
    vercel_sandbox_name: str = "kairo-runner"
    vercel_sandbox_images: list[str] = VERCEL_SANDBOX_IMAGES
    vercel_executor: Path = VERCEL_EXECUTOR

    # Signs the evidence of finished runs and fixes that the browser hands back to
    # Saarthi, so follow-up questions work on any server instance. Set the same value
    # on every instance. Empty = the key the Vercel build generated (evidence_key_file),
    # else a random key per process (fine for one server).
    evidence_secret: SecretStr | None = None
    evidence_key_file: Path = BUILD_EVIDENCE_KEY

    # Bounded admission: at most `dispatch_workers` executions are handed to
    # the runner at once (keep equal to RUNNER_WORKERS) and at most
    # `max_queue` more may wait. Beyond that, POST /executions returns 503.
    dispatch_workers: int = 4
    max_queue: int = 20
    mean_service_time_s: float = 2.0  # used only for the Retry-After estimate

    # Request size caps (bytes of UTF-8).
    max_source_bytes: int = 64 * 1024
    max_stdin_bytes: int = 16 * 1024

    # Executions are kept in memory (per server instance); this bounds it. Signed
    # evidence (above) lets other instances answer about a finished run.
    max_stored_executions: int = 500

    # Optional: serve the built web app (apps/web/dist) from this directory. On Vercel
    # the repository's apps/web/dist is used when it exists (the build creates it).
    web_dist: Path | None = None

    # Client addresses for rate limits: behind Vercel's proxy the socket address is the
    # proxy's, so the address Vercel puts in X-Real-IP / X-Forwarded-For is used there.
    trust_proxy_headers: bool = Field(default_factory=on_vercel)

    # ------------------------------------------------ daily keep-alive (Vercel Cron)
    # GET /api/v1/system/keepalive pings the Supabase database (so the free project is
    # never paused) and wakes the runner VM once (so its snapshot never expires).
    # Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
    cron_secret: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("CRON_SECRET", "CC_CRON_SECRET", "cron_secret"))
    # The project's public URL and publishable (browser) key: the same values as the web app's.
    supabase_url: str = Field(
        default="", validation_alias=AliasChoices("CC_SUPABASE_URL", "VITE_SUPABASE_URL", "supabase_url"))
    supabase_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("CC_SUPABASE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "supabase_key"))

    # ------------------------------------------------ Saarthi (AI assistant)
    # "anthropic" = Claude API; "openai" = any OpenAI-compatible endpoint
    # (OpenAI, or a local Ollama / LM Studio server via ai_base_url);
    # "gateway" = Vercel AI Gateway (on Vercel it signs in with the deployment's
    # OIDC token, so no key is stored anywhere; elsewhere set AI_GATEWAY_API_KEY);
    # "gemini" = Google's Gemini API with GEMINI_API_KEY (free tier, no card);
    # "none" = assistant switched off. Without a key (Anthropic/OpenAI) the
    # assistant reports that it is not configured; everything else works.
    # Default: "gemini" when GEMINI_API_KEY is set, otherwise "gateway" on
    # Vercel and "anthropic" everywhere else.
    ai_provider: Literal["anthropic", "openai", "gateway", "gemini", "none"] = Field(
        default_factory=lambda: "gateway" if on_vercel() else "anthropic")
    ai_model: str = ""      # empty = the provider default (see app/ai/providers.py)
    ai_complete_model: str = ""  # model for inline completions; empty = ai_model
    ai_base_url: str = ""   # empty = the provider's public API
    ai_api_key: SecretStr | None = None  # CC_AI_API_KEY, or the provider's variable below
    anthropic_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_API_KEY", "anthropic_api_key"))
    openai_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"))
    ai_gateway_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("AI_GATEWAY_API_KEY", "ai_gateway_api_key"))
    gemini_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY", "gemini_api_key"))
    # Gemini and AI Gateway back each other up when both are available (see
    # app/ai/providers.py: choose_provider). CC_AI_BACKUP=false turns that off.
    ai_backup: bool = True
    ai_timeout_s: float = 45.0
    ai_max_output_tokens: int = 1500
    # Requests only happen when a student presses a Saarthi button; these
    # limits protect the key's budget from a runaway client.
    ai_requests_per_minute: int = 10   # per client address
    ai_requests_per_day: int = 150     # per client address
    ai_daily_budget: int = 3000        # all clients together
    ai_max_concurrency: int = 4
    ai_cache_ttl_s: int = 1800
    # Inline code completions while typing (the "AI autocomplete" extension):
    # a separate, larger per-client budget so they never use up the questions.
    ai_complete_per_minute: int = 30
    ai_complete_per_day: int = 1500
    ai_complete_daily_budget: int = 20000

    @model_validator(mode="after")
    def _gemini_when_its_key_is_set(self) -> "ApiSettings":
        """A Gemini API key chooses Gemini, unless CC_AI_PROVIDER names a provider."""
        key = self.gemini_api_key.get_secret_value().strip() if self.gemini_api_key else ""
        if key and "ai_provider" not in self.model_fields_set:
            self.ai_provider = "gemini"
        return self
