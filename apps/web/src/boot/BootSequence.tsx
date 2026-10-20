import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Health, Language } from "../api/types";
import { NOTE_COUNT } from "../diagnostics/notes";
import { AstraField } from "../fx/AstraField";
import { KairoMark, KairoWordmark } from "../layout/Logo";
import { offeredLanguages } from "../layout/LanguagePicker";
import { LIVE_LANGUAGES } from "../live/support";

type Tone = "ok" | "warn" | "bad";
interface Result {
  tone: Tone;
  value: string;
}
interface Step {
  label: string;
  run(): Promise<Result>;
}

const BOOT_KEY = "kairo.booted";
const STEP_MS = 115;
const CHECK_TIMEOUT_MS = 2500;
const MAX_MS = 4500;
/** With motion on, the boot stays up long enough for the stars to finish forming the mark. */
const MIN_MOTION_MS = 2100;

/** Whether this browser tab has already seen the boot sequence. */
export function bootedThisSession(): boolean {
  try {
    return sessionStorage.getItem(BOOT_KEY) === "1";
  } catch {
    return true;
  }
}

function markBooted() {
  try {
    sessionStorage.setItem(BOOT_KEY, "1");
  } catch {
    // storage unavailable: the boot shows again next time, which is harmless
  }
}

function within<T>(promise: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** The checks behind each line: real requests and real counts, nothing staged. */
function makeSteps(): { steps: Step[]; summary: Promise<{ core: boolean; sandbox: string; saarthi: string; node: string }> } {
  const health = within(api.health()).catch(() => null as Health | null);
  const languages = within(api.languages()).catch(() => null as Language[] | null);
  const assistant = within(api.assistantStatus()).catch(() => null);
  const sandboxWord = (h: Health | null) =>
    !h ? "OFFLINE" : h.runner.status === "unreachable" ? "OFFLINE" : h.runner.docker === false ? "DEGRADED" : "READY";
  const steps: Step[] = [
    { label: "Initializing compiler kernel", run: async () => ((await health) ? { tone: "ok", value: "ONLINE" } : { tone: "bad", value: "OFFLINE" }) },
    {
      label: "Mounting language runtimes",
      run: async () => {
        const list = await languages;
        if (!list) return { tone: "bad", value: "UNAVAILABLE" };
        const ready = offeredLanguages(list).length;
        return { tone: ready > 0 ? "ok" : "warn", value: `${ready}/${list.length} READY` };
      },
    },
    { label: "Loading diagnostic engine", run: async () => ({ tone: "ok", value: `${NOTE_COUNT} NOTES` }) },
    {
      label: "Initializing sandbox",
      run: async () => {
        const word = sandboxWord(await health);
        return { tone: word === "READY" ? "ok" : word === "DEGRADED" ? "warn" : "bad", value: word };
      },
    },
    {
      label: "Connecting Saarthi AI",
      run: async () => {
        const status = await assistant;
        return !status ? { tone: "bad", value: "UNREACHABLE" } : status.enabled ? { tone: "ok", value: "ONLINE" } : { tone: "warn", value: "NOT SET UP" };
      },
    },
    {
      label: "Calibrating real-time analyzer",
      run: async () =>
        typeof WebAssembly === "object" && typeof Worker === "function"
          ? { tone: "ok", value: `${LIVE_LANGUAGES.size} GRAMMARS` }
          : { tone: "warn", value: "UNSUPPORTED" },
    },
    {
      label: "Verifying language adapters",
      run: async () => {
        const list = await languages;
        if (!list) return { tone: "bad", value: "SKIPPED" };
        const adapters = offeredLanguages(list).filter((l) => l.steps.length > 0).length;
        return { tone: "ok", value: `${adapters} OK` };
      },
    },
  ];
  const summary = Promise.all([health, assistant]).then(([h, a]) => ({
    core: h !== null,
    sandbox: sandboxWord(h),
    saarthi: !a ? "OFFLINE" : a.enabled ? "ONLINE" : "NOT SET UP",
    node: /^(localhost|127\.|\[::1\])/.test(window.location.hostname) ? "LOCAL" : window.location.hostname.toUpperCase(),
  }));
  return { steps, summary };
}

const TONE_TEXT: Record<Tone, string> = { ok: "text-brand-fg", warn: "text-warn-fg", bad: "text-danger-fg" };

/**
 * KAIRO's start-up screen: each line is a real check (API, runtimes, sandbox,
 * Saarthi, analyzer), shown quickly and once per browser tab. Any key or
 * click skips it; with motion off it shows everything at once.
 */
export function BootSequence({ motion, onDone, onLeave }: { motion: boolean; onDone(): void; onLeave?(): void }) {
  const [plan] = useState(makeSteps);
  const [shown, setShown] = useState(motion ? 0 : plan.steps.length);
  const [results, setResults] = useState<(Result | null)[]>(() => plan.steps.map(() => null));
  const [summary, setSummary] = useState<{ core: boolean; sandbox: string; saarthi: string; node: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const startedAt = useRef(performance.now());

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    markBooted();
    onLeave?.();
    if (motion) {
      setLeaving(true);
      window.setTimeout(onDone, 360);
    } else onDone();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    plan.steps.forEach((step, i) =>
      void step
        .run()
        .catch(() => ({ tone: "bad" as const, value: "ERROR" }))
        .then((result) => setResults((all) => all.map((r, j) => (j === i ? result : r)))),
    );
    void plan.summary.then(setSummary);
    const guard = window.setTimeout(() => finishRef.current(), MAX_MS);
    const skip = () => finishRef.current();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.clearTimeout(guard);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [plan]);

  // Lines appear one after another; a line waits for its own check.
  useEffect(() => {
    if (shown >= plan.steps.length) return;
    if (shown > 0 && results[shown - 1] === null) return;
    const timer = window.setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [shown, results, plan.steps.length]);

  const done = shown >= plan.steps.length && results.every((r) => r !== null);
  useEffect(() => {
    if (!done || !summary) return;
    const wait = motion ? Math.max(650, MIN_MOTION_MS - (performance.now() - startedAt.current)) : 250;
    const timer = window.setTimeout(() => finishRef.current(), wait);
    return () => window.clearTimeout(timer);
  }, [done, summary, motion]);

  const resolved = results.filter((r, i) => r !== null && i < shown).length;
  const percent = Math.round((resolved / plan.steps.length) * 100);

  return (
    <div
      // The star field is a night sky in either theme, so the card above it is drawn in the dark palette too.
      className={`k-boot ${motion ? "dark" : ""}`}
      data-leaving={leaving ? "true" : undefined}
      data-testid="boot"
      role="dialog"
      aria-modal="true"
      aria-label="KAIRO is starting"
    >
      {/* Stars gather into the KAIRO mark above the checks. */}
      {motion && <AstraField mode="gather" motion markY={0.26} markSize={0.26} />}
      <div
        className={`k-hud relative w-[min(560px,calc(100vw-2rem))] rounded-lg border border-line p-5 shadow-[var(--cd-shadow)] sm:p-7 ${motion ? "mt-[30vh] bg-surface/80 backdrop-blur-md" : "bg-surface/95"}`}
      >
        <div className="flex items-center gap-3">
          <KairoMark size={40} animated={motion} />
          <div className="text-fg">
            <KairoWordmark height={18} animated={motion} />
            <p className="k-label mt-1.5">System / Boot</p>
          </div>
          <span className="ml-auto font-mono text-2xl font-semibold tabular-nums text-fg" aria-hidden>
            {String(percent).padStart(3, "0")}
            <span className="text-sm text-faint">%</span>
          </span>
        </div>

        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-line">
          <div className="k-boot-bar h-full bg-brand" style={{ width: `${percent}%` }} />
        </div>

        <ol className="mt-4 flex flex-col gap-1 font-mono text-[11.5px]" aria-live="polite">
          {plan.steps.slice(0, shown).map((step, i) => {
            const result = results[i];
            return (
              <li key={step.label} className="k-boot-line flex items-center gap-2 uppercase tracking-[0.06em]" data-testid="boot-line">
                <span className="text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 truncate text-muted">{step.label}...</span>
                <span className="min-w-4 flex-1 border-b border-dotted border-line-strong" aria-hidden />
                {result ? (
                  <b className={`shrink-0 whitespace-nowrap font-semibold ${TONE_TEXT[result.tone]}`}>[ {result.value} ]</b>
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-faint">[ .... ]</span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 border-t border-line pt-3">
          {done && summary ? (
            <div className="k-boot-line" data-testid="boot-ready">
              <p className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-brand-fg">System ready</p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">
                <span>Node 01 · {summary.node}</span>
                <span>
                  Compiler core · <b className={summary.core ? "text-brand-fg" : "text-danger-fg"}>{summary.core ? "online" : "offline"}</b>
                </span>
                <span>
                  Saarthi AI · <b className={summary.saarthi === "ONLINE" ? "text-ai-fg" : "text-warn-fg"}>{summary.saarthi.toLowerCase()}</b>
                </span>
                <span>
                  Sandbox · <b className={summary.sandbox === "READY" ? "text-brand-fg" : "text-warn-fg"}>{summary.sandbox.toLowerCase()}</b>
                </span>
              </p>
            </div>
          ) : (
            <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">AI-powered coding. Compiling. Learning.</p>
          )}
          <button type="button" onClick={finish} className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint hover:text-fg" data-testid="boot-skip">
            Press any key to skip
          </button>
        </div>
      </div>
    </div>
  );
}
