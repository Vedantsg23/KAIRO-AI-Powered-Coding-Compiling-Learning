import { AlertTriangle, CheckCircle2, Gauge, Keyboard, Loader2, ScrollText, Terminal, XCircle } from "lucide-react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import type { Execution, ExecutionStep, Language, RawOutputReference } from "../api/types";
import { useFx } from "../fx/context";
import { LineReveal, lineReveal } from "../fx/text";
import { modKey } from "../lib/hooks";
import { EmptyState, Tabs } from "../ui/primitives";
import { formatMs, promptLine } from "./pipeline";

export type OutputTab = "output" | "input" | "log" | "details";

interface Props {
  execution: Execution | null;
  language: Language | null;
  stdin: string;
  onStdinChange(value: string): void;
  tab: OutputTab;
  onTabChange(tab: OutputTab): void;
  highlight: RawOutputReference | null;
  /** Extra tabs placed before these (used on small screens), or after `extraAfter`. */
  extraTabs?: { id: string; label: ReactNode; badge?: ReactNode; testId?: string; tour?: string }[];
  /** Put the extra tabs right after this tab instead of first (the desktop panel: Terminal, Problems, ...). */
  extraAfter?: OutputTab;
  /** Shown above the program's output in the Terminal tab (the run's stages). */
  terminalHeader?: ReactNode;
  /** Shown at the right end of the tab bar (Saarthi's companion on wide screens). */
  right?: ReactNode;
  extraContent?: ReactNode;
  extraSelected?: string | null;
  onExtraSelect?(id: string): void;
  /** Show only the extra tabs (HTML, CSS and React have a preview instead of a terminal). */
  onlyExtraTabs?: boolean;
}

const INPUT_HINT: Record<string, string> = {
  c: "scanf and getchar", cpp: "std::cin and getline", java: "Scanner", python: "input()", javascript: "fs.readFileSync(0)",
  typescript: "fs.readFileSync(0)", go: "fmt.Scan", rust: "stdin().read_line", csharp: "Console.ReadLine",
  kotlin: "readLine()", swift: "readLine()", php: "fgets(STDIN)", ruby: "gets", lua: "io.read", bash: "read",
};

export const OutputPanel = memo(function OutputPanel(props: Props) {
  const { execution, language, stdin, tab, onTabChange, highlight } = props;
  const plan = language?.steps ?? [];
  const runStep = execution?.steps.find((s) => s.kind === "run");
  const compileSteps = execution?.steps.filter((s) => s.kind === "compile") ?? [];
  const compileLabel = plan.find((s) => s.kind === "compile")?.label ?? null;
  const inputLines = stdin ? stdin.replace(/\n$/, "").split("\n").length : 0;
  const extraActive = props.extraSelected ?? null;

  const own = [
    { id: "output", label: <><Terminal size={13} /> Terminal</>, testId: "tab-output" },
    {
      id: "input",
      label: <><Keyboard size={13} /> Input</>,
      badge: inputLines ? <span className="rounded bg-brand/15 px-1.5 font-mono text-[10px] text-brand-fg">{inputLines}</span> : undefined,
      tour: "input-tab",
      testId: "tab-input",
    },
    {
      id: "log",
      label: <><ScrollText size={13} /> {compileLabel === "Syntax check" ? "Check log" : "Build log"}</>,
      testId: "tab-log",
    },
    { id: "details", label: <><Gauge size={13} /> Details</>, testId: "tab-details" },
  ];
  const extra = props.extraTabs ?? [];
  const after = props.extraAfter ? own.findIndex((t) => t.id === props.extraAfter) : -1;
  const tabs = props.onlyExtraTabs
    ? [...extra]
    : after >= 0
      ? [...own.slice(0, after + 1), ...extra, ...own.slice(after + 1)]
      : [...extra, ...own];
  const value = extraActive ?? tab;

  return (
    <section className="flex h-full min-h-0 flex-col" data-tour="output">
      <Tabs
        tabs={tabs}
        value={value}
        onChange={(id) => {
          if (props.extraTabs?.some((t) => t.id === id)) props.onExtraSelect?.(id);
          else {
            props.onExtraSelect?.("");
            onTabChange(id as OutputTab);
          }
        }}
        label="Program output"
        idPrefix="deck"
        right={props.right}
      />
      <div id="deck-panel" role="tabpanel" className="cd-scroll min-h-0 flex-1 overflow-auto">
        {extraActive && props.extraContent}
        {!extraActive && tab === "input" && <InputTab stdin={stdin} onChange={props.onStdinChange} languageId={language?.id ?? ""} />}
        {!extraActive && tab === "log" && <CompilerLog steps={compileSteps} plan={plan} highlight={highlight} language={language} />}
        {!extraActive && tab === "output" && (
          <div className="flex min-h-full flex-col">
            {props.terminalHeader}
            <div className="flex min-h-0 flex-1 flex-col">
              <ProgramOutput execution={execution} step={runStep} highlight={highlight} language={language} />
            </div>
          </div>
        )}
        {!extraActive && tab === "details" && <RunDetails execution={execution} language={language} />}
      </div>
    </section>
  );
});

function runArgv(language: Language | null, step: ExecutionStep | undefined): string[] | undefined {
  return (language?.steps.find((s) => s.name === step?.name) ?? language?.steps.find((s) => s.kind === "run"))?.argv;
}

function ProgramOutput({
  execution,
  step,
  highlight,
  language,
}: {
  execution: Execution | null;
  step: ExecutionStep | undefined;
  highlight: RawOutputReference | null;
  language: Language | null;
}) {
  if (!execution) {
    return (
      <div className="flex min-h-full flex-col bg-[var(--cd-terminal)] p-3 font-mono text-[12.5px] leading-relaxed">
        <p className="text-faint">
          KAIRO terminal · {language ? `${language.displayName} · ${language.toolchain.name} ${language.toolchain.declaredVersion}` : "sandbox"}
        </p>
        <p className="mt-1 text-fg">
          <span className="select-none text-brand-fg">$ </span>
          <span className="cd-caret" aria-hidden />
        </p>
        <p className="mt-3 font-sans text-xs text-muted">
          Press <b className="text-fg">Run</b> ({modKey}+Enter) to compile and run your program in an isolated sandbox. Its output lands here.
        </p>
      </div>
    );
  }
  if (!execution.terminal && (!step || step.status !== "SUCCEEDED")) {
    return (
      <div className="flex min-h-full flex-col bg-[var(--cd-terminal)] p-3 font-mono text-[12.5px]">
        <p className="text-fg">
          <span className="select-none text-brand-fg">$ </span>
          {promptLine(runArgv(language, step))}
        </p>
        <p className="mt-2 flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin text-brand-fg" />
          {execution.summary}...
        </p>
      </div>
    );
  }
  if (!step || step.status === "SKIPPED" || step.status === "PENDING") {
    const reason =
      execution.state === "COMPILE_ERROR"
        ? "The program did not run because the code has errors. Fix the problems listed under Problems (on the right), then run again."
        : (execution.error ?? execution.summary);
    return (
      <EmptyState icon={<XCircle size={20} className="text-danger-fg" />} title="The program did not run">
        {reason}
      </EmptyState>
    );
  }

  const empty = !step.stdout && !step.stderr;
  const marked = highlight && highlight.step === step.name ? highlight : null;
  return (
    <div className="flex min-h-full flex-col bg-[var(--cd-terminal)]">
      <p className="px-3 pt-2.5 font-mono text-[12.5px] text-faint" aria-hidden>
        <span className="select-none text-brand-fg">$ </span>
        {promptLine(runArgv(language, step))}
      </p>
      <pre
        className="flex-1 whitespace-pre-wrap break-words px-3 pb-3 pt-1 font-mono text-[13px] leading-relaxed text-fg"
        data-testid="program-stdout"
      >
        {empty && <span className="italic text-faint">(the program printed nothing)</span>}
        <LineReveal key={execution.id} text={step.stdout} />
        {step.stdoutTruncated && <TruncatedMark kb={step.limits.outputKb} />}
        {step.stderr && (
          <span
            className={`text-danger-fg ${marked?.stream === "stderr" ? "rounded bg-warn/10 outline outline-1 outline-warn/40" : ""}`}
            data-testid="program-stderr"
          >
            {step.stdout && !step.stdout.endsWith("\n") ? "\n" : ""}
            <LineReveal key={execution.id} text={step.stderr} />
          </span>
        )}
        {step.stderrTruncated && <TruncatedMark kb={step.limits.outputKb} />}
      </pre>
      <ExitLine execution={execution} step={step} />
    </div>
  );
}

function TruncatedMark({ kb }: { kb: number }) {
  return <span className="my-1 block font-sans text-xs font-semibold text-warn-fg">... output cut off at {kb} KB</span>;
}

function ExitLine({ execution, step }: { execution: Execution; step: ExecutionStep }) {
  const ok = execution.state === "SUCCEEDED" && !execution.diagnostics.some((d) => d.severity === "error");
  const time = formatMs(step.durationMs ?? step.wallMs);
  let text: string;
  if (step.termination === "TIMEOUT") text = `Stopped by the ${step.limits.wallTimeMs / 1000} s time limit`;
  else if (step.termination === "MEMORY_LIMIT") text = `Stopped by the ${step.limits.memoryMb} MB memory limit`;
  else if (step.termination === "OUTPUT_LIMIT") text = `Stopped after ${step.limits.outputKb} KB of output`;
  else if (step.termination === "SIGNALED") text = `Crashed with ${step.signalName ?? `signal ${step.signal}`} (exit status ${step.exitCode})`;
  else text = `Process exited with status ${step.exitCode}`;

  return (
    <div
      data-testid="exit-line"
      className={`sticky bottom-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] backdrop-blur ${
        ok ? "border-brand/30 bg-brand/10 text-brand-fg" : "border-danger/30 bg-danger/10 text-danger-fg"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
        {text}
      </span>
      {time && (
        <span className="font-medium opacity-85">
          <span className="opacity-70">Time </span>
          {time}
        </span>
      )}
      <span className="ml-auto font-medium opacity-70 max-sm:hidden" title="The sandbox's limits for this step (memory use itself is not measured)">
        Limits {step.limits.wallTimeMs / 1000} s · {step.limits.memoryMb} MB
      </span>
    </div>
  );
}

function InputTab({ stdin, onChange, languageId }: { stdin: string; onChange(value: string): void; languageId: string }) {
  const reader = INPUT_HINT[languageId];
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <label htmlFor="stdin" className="text-xs text-muted">
        Text typed here is given to your program as <b className="text-fg">standard input</b>
        {reader ? (
          <>
            : <code className="font-mono text-fg">{reader}</code> reads it
          </>
        ) : null}
        , line by line. It is sent with the next run.
      </label>
      <textarea
        id="stdin"
        value={stdin}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={"e.g.\n5\n10 20 30 40 50"}
        data-testid="stdin"
        className="min-h-24 flex-1 resize-none rounded-md border border-line-strong bg-[var(--cd-terminal)] p-2.5 font-mono text-[13px] text-fg outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </div>
  );
}

function CompilerLog({
  steps,
  plan,
  highlight,
  language,
}: {
  steps: ExecutionStep[];
  plan: Language["steps"];
  highlight: RawOutputReference | null;
  language: Language | null;
}) {
  const { motion } = useFx();
  const marked = useRef<HTMLDivElement>(null);
  useEffect(() => {
    marked.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight?.step, highlight?.stream, highlight?.startLine, highlight?.endLine]);

  const planned = plan.filter((s) => s.kind === "compile");
  if (planned.length === 0) {
    return (
      <p className="p-4 text-xs text-muted">
        {language?.displayName ?? "This language"} has no separate compile or check step: problems are reported while the
        program runs. See the Output tab.
      </p>
    );
  }
  return (
    <div className="font-mono text-[12.5px] leading-relaxed">
      {planned.map((p) => {
        const step = steps.find((s) => s.name === p.name);
        const streams: ("stdout" | "stderr")[] = ["stdout", "stderr"];
        return (
          <div key={p.name} className="border-b border-line last:border-b-0">
            <div className="flex items-center gap-2 bg-raised px-3 py-1.5 text-faint">
              <span className="select-none text-brand-fg">$</span>
              <span className="truncate" title={p.argv.join(" ")}>
                {p.argv.join(" ")}
              </span>
              <span className="k-label ml-auto shrink-0">{p.label}</span>
            </div>
            {!step || step.status === "PENDING" || step.status === "RUNNING" ? (
              <p className="px-3 py-2 font-sans text-xs text-faint">Output appears here after a run.</p>
            ) : step.status === "SKIPPED" ? (
              <p className="px-3 py-2 font-sans text-xs text-faint">Skipped: an earlier step failed.</p>
            ) : !step.stdout && !step.stderr ? (
              <p className="px-3 py-2 font-sans text-xs text-faint">No output: no errors or warnings.</p>
            ) : (
              streams.map((stream) => {
                const text = step[stream];
                if (!text) return null;
                const lines = text.replace(/\n$/, "").split("\n");
                const active = highlight && highlight.step === step.name && highlight.stream === stream ? highlight : null;
                return (
                  <div key={stream} className="py-1" data-testid={`log-${step.name}-${stream}`}>
                    {lines.map((line, i) => {
                      const n = i + 1;
                      const hit = active && n >= active.startLine && n <= active.endLine;
                      const fx = lineReveal(motion, i, lines.length);
                      return (
                        <div key={n} ref={hit && n === active.startLine ? marked : undefined} className={`flex ${hit ? "bg-warn/15" : ""} ${fx.className}`} style={fx.style}>
                          <span className="w-10 shrink-0 select-none pr-3 text-right text-faint/70">{n}</span>
                          <span className={`whitespace-pre-wrap break-all ${stream === "stderr" ? "text-fg" : "text-muted"}`}>{line}</span>
                        </div>
                      );
                    })}
                    {(stream === "stdout" ? step.stdoutTruncated : step.stderrTruncated) && <TruncatedMark kb={step.limits.outputKb} />}
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunDetails({ execution, language }: { execution: Execution | null; language: Language | null }) {
  if (!execution) {
    return (
      <div className="p-4 text-xs text-muted">
        <p className="mb-2 font-semibold text-fg">How {language?.displayName ?? "your code"} runs here</p>
        <ul className="flex flex-col gap-1.5">
          {(language?.steps ?? []).map((s) => (
            <li key={s.name} className="font-mono text-[11.5px]">
              <span className="font-sans font-semibold text-fg">{s.label}:</span> {s.argv.join(" ")}{" "}
              <span className="text-faint">
                (≤ {s.limits.wallTimeMs / 1000} s, {s.limits.memoryMb} MB, {s.limits.outputKb} KB output)
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3">Every step runs in a fresh sandbox container: no network, read-only system files, a non-root user and the limits above.</p>
      </div>
    );
  }
  const tc = execution.toolchain;
  return (
    <div className="p-3 text-xs">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-faint">State</dt>
        <dd className="font-mono text-fg" data-testid="details-state">{execution.state}</dd>
        <dt className="text-faint">Toolchain</dt>
        <dd className="font-mono text-fg">{tc ? `${tc.name} ${tc.version ?? ""}` : "-"}</dd>
        <dt className="text-faint">Image</dt>
        <dd className="break-all font-mono text-muted">{tc ? `${tc.image} ${tc.imageId ? `(${tc.imageId.slice(0, 19)})` : ""}` : "-"}</dd>
        <dt className="text-faint">Source</dt>
        <dd className="break-all font-mono text-muted" title="SHA-256 of the exact code that was run">
          {execution.sourceHash.slice(0, 23)}… ({execution.sourceBytes} bytes)
        </dd>
      </dl>
      <table className="mt-3 w-full border-collapse text-left font-mono text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-faint">
            <th className="py-1 pr-3 font-medium">Step</th>
            <th className="py-1 pr-3 font-medium">Ended</th>
            <th className="py-1 pr-3 font-medium">Exit</th>
            <th className="py-1 pr-3 font-medium">Time</th>
            <th className="py-1 font-medium">Limits</th>
          </tr>
        </thead>
        <tbody>
          {execution.steps.map((s) => (
            <tr key={s.name} className="border-b border-line/60 text-muted">
              <td className="py-1 pr-3 text-fg">{language?.steps.find((p) => p.name === s.name)?.label ?? s.name}</td>
              <td className="py-1 pr-3">{s.termination?.toLowerCase().replace("_", " ") ?? s.status.toLowerCase()}</td>
              <td className="py-1 pr-3">{s.signalName ?? s.exitCode ?? "-"}</td>
              <td className="py-1 pr-3">{formatMs(s.durationMs ?? s.wallMs) ?? "-"}</td>
              <td className="py-1">
                {s.limits.wallTimeMs / 1000} s · {s.limits.memoryMb} MB · {s.limits.outputKb} KB
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-faint">
        Memory use is limited but not measured per run yet. Every step ran in its own sandbox with no network.
      </p>
    </div>
  );
}
