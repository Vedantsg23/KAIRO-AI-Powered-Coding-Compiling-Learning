import { CheckCircle2, History, Loader2, RotateCw, ShieldCheck, Wrench, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Execution, Language, RawOutputReference } from "../api/types";
import type { LiveProblem } from "../live/analyze";
import { topicCode } from "../live/topics";
import { Button, EmptyState, PanelHead } from "../ui/primitives";
import { DiagnosticCard } from "./DiagnosticCard";
import { countBySeverity, sortDiagnostics } from "./format";

type Filter = "all" | "error" | "warning";

interface Props {
  execution: Execution | null;
  language: Language | null;
  stale: boolean;
  liveProblems: LiveProblem[];
  liveSupported: boolean;
  selectedId: string | null;
  saarthi: boolean;
  onSelect(id: string): void;
  onReveal(line: number, column: number): void;
  onShowRaw(ref: RawOutputReference): void;
  onRun(): void;
  onOpenExamples(): void;
  onExplain(diagnosticId: string): void;
  onFix(diagnosticId: string): void;
  /** Apply a live problem's rule-based quick fix. */
  onApplyLiveFix?(problem: LiveProblem): void;
  /** Hide the panel header (on phones the tab already names it). */
  bare?: boolean;
  /** Buttons at the right end of the header (maximize and hide the panel). */
  actions?: ReactNode;
}

/** PROBLEMS: live syntax problems while typing, then the last run's errors, warnings and crashes. */
export function ProblemsPanel(props: Props) {
  const { execution, stale, language } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const diagnostics = useMemo(() => sortDiagnostics(execution?.diagnostics ?? []), [execution]);
  const counts = countBySeverity(diagnostics);
  const shown = diagnostics.filter((d) => filter === "all" || d.severity === filter);
  const toolName = language?.toolchain.name ?? "the compiler";
  const fileName = language?.sourceFile ?? "";

  return (
    <section className="@container flex h-full min-h-0 flex-col" data-tour="problems" aria-label="Problems">
      {!props.bare && (
        <PanelHead index="04" title="Problems">
          <span className="flex shrink-0 gap-1 whitespace-nowrap font-mono text-[10px] font-bold">
            {props.liveProblems.length > 0 && <span className="rounded border border-warn/40 bg-warn/12 px-1.5 text-warn-fg">{props.liveProblems.length} live</span>}
            {counts.error > 0 && <span className="rounded border border-danger/35 bg-danger/10 px-1.5 text-danger-fg">{counts.error} err</span>}
            {counts.warning > 0 && <span className="rounded border border-warn/40 bg-warn/12 px-1.5 text-warn-fg">{counts.warning} warn</span>}
          </span>
          {diagnostics.length > 1 && (
            <div className="hidden rounded border border-line bg-surface p-0.5 @[25rem]:flex" role="group" aria-label="Filter problems">
              {(["all", "error", "warning"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-sm px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-wider transition-colors ${
                    filter === f ? "bg-fg text-surface" : "text-faint hover:text-fg"
                  }`}
                >
                  {f === "all" ? "All" : f === "error" ? "Err" : "Warn"}
                </button>
              ))}
            </div>
          )}
          {props.actions}
        </PanelHead>
      )}

      <div className="cd-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {props.liveProblems.length > 0 && (
          <div className="mb-2 rounded-md border border-warn/35 bg-warn/[0.06]" data-testid="live-problems">
            <p className="flex items-center gap-1.5 border-b border-warn/25 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-warn-fg">
              <Zap size={12} /> Live analyzer · not run yet
              <span className="ml-auto rounded bg-warn/15 px-1.5">{props.liveProblems.length}</span>
            </p>
            <ul className="flex flex-col py-1">
              {props.liveProblems.map((p, i) => (
                <li key={`${p.startLine}:${p.startColumn}:${i}`} className="flex items-start gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => props.onReveal(p.startLine, p.startColumn)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded px-1.5 py-1 text-left text-xs text-fg hover:bg-warn/10"
                  >
                    <span
                      className={`mt-px shrink-0 rounded px-1 font-mono text-[8.5px] font-bold uppercase tracking-wider ${
                        p.kind === "tip"
                          ? "bg-info/15 text-info-fg"
                          : p.kind === "typo" || p.topic === "typo"
                            ? "bg-warn/18 text-warn-fg"
                            : "bg-danger/14 text-danger-fg"
                      }`}
                      data-testid={`live-kind-${p.kind}`}
                    >
                      {p.kind === "tip" ? "tip" : p.kind === "typo" || p.topic === "typo" ? "typo" : "syntax"}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] font-semibold text-warn-fg">
                      {fileName}:{p.startLine}:{p.startColumn}
                    </span>
                    <span className="min-w-0">
                      {p.message}
                      <span className="ml-1.5 font-mono text-[9.5px] text-faint">{topicCode(p.topic)}</span>
                    </span>
                  </button>
                  {p.fix && props.onApplyLiveFix && (
                    <button
                      type="button"
                      onClick={() => props.onApplyLiveFix?.(p)}
                      data-testid="live-fix"
                      title={`Quick fix (rule-based, not AI): ${p.fix.label}`}
                      className="mt-0.5 flex shrink-0 items-center gap-1 rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-fg hover:bg-brand/20"
                    >
                      <Wrench size={11} /> {p.fix.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-t border-warn/20 px-2.5 py-1.5 text-[10.5px] text-faint">
              While you type: the grammar, the Typo Guard and Saarthi's tips (rule-based, not AI). Run for the compiler's full check.
            </p>
          </div>
        )}

        {stale && execution?.terminal && (
          <div
            data-testid="stale-banner"
            className="mb-2 flex animate-fade-in items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-fg"
          >
            <History size={14} className="shrink-0 text-warn-fg" />
            <span className="flex-1">
              You changed the code after this run, so these results may not match it. Its markers are hidden until you run again.
            </span>
            <Button size="sm" variant="secondary" onClick={props.onRun}>
              <RotateCw size={12} /> Run again
            </Button>
          </div>
        )}

        {!execution && props.liveProblems.length === 0 && (
          <EmptyState icon={<ShieldCheck size={20} />} title="No problems yet" className={props.bare ? "!h-auto" : ""}>
            {language?.toolchain.name === "Browser" ? (
              <>
                This code runs in the browser: the preview shows your page and its console. The {language.displayName} checker flags mistakes
                here while you type.
              </>
            ) : (
              <>
                Press <b>Run</b> to {language?.steps.some((s) => s.kind === "compile") ? "compile and run" : "run"} your code in a sandbox. Errors,
                warnings and crashes appear here, pinned to the exact line.
                {props.liveSupported ? " Syntax slips are flagged while you type." : ""}
              </>
            )}{" "}
            <button type="button" onClick={props.onOpenExamples} className="font-semibold text-brand-fg hover:underline">
              Try an example with a bug &rarr;
            </button>
          </EmptyState>
        )}
        {execution && !execution.terminal && (
          <div className="flex items-center gap-2 px-2 py-6 font-mono text-xs uppercase tracking-wider text-muted">
            <Loader2 size={15} className="animate-spin text-brand-fg" /> {execution.summary}...
          </div>
        )}
        {execution?.terminal &&
          diagnostics.length === 0 &&
          (execution.state === "SUCCEEDED" ? (
            <EmptyState icon={<CheckCircle2 size={20} className="text-brand-fg" />} title="No problems found" className={props.bare ? "!h-auto" : ""}>
              {toolName} reported no errors or warnings and the program finished normally.
            </EmptyState>
          ) : (
            <EmptyState icon={<ShieldCheck size={20} />} title={execution.summary} className={props.bare ? "!h-auto" : ""}>
              {execution.error ?? "No diagnostics were produced for this run."}
            </EmptyState>
          ))}
        {execution?.terminal && shown.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Diagnostics">
            {shown.map((d, i) => (
              <DiagnosticCard
                key={d.id}
                index={i + 1}
                diagnostic={d}
                stale={stale}
                fileName={fileName}
                saarthi={props.saarthi}
                selected={props.selectedId === d.id}
                onSelect={() => props.onSelect(d.id)}
                onReveal={props.onReveal}
                onShowRaw={props.onShowRaw}
                onExplain={() => props.onExplain(d.id)}
                onFix={() => props.onFix(d.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
