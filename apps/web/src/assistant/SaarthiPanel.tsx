import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Check,
  CircleSlash,
  Copy,
  Crosshair,
  Loader2,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Undo2,
  Wand2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Diagnostic, Execution, Language } from "../api/types";
import { CATEGORY_LABEL, splitMessage } from "../diagnostics/format";
import { noteFor } from "../diagnostics/notes";
import { previewEdits } from "../lib/edits";
import { modKey } from "../lib/hooks";
import type { LiveProblem } from "../live/analyze";
import type { ConceptInfo } from "../live/concepts";
import type { CodeMetrics } from "../live/insights";
import { topicCode, topicNote } from "../live/topics";
import { SaarthiMascot, type MascotMood } from "../mascot/SaarthiMascot";
import { Scramble } from "../fx/text";
import { Button } from "../ui/primitives";
import { Markdown } from "./Markdown";
import { diffLines } from "./patch";
import type { SaarthiApi } from "./useSaarthi";

/** What happened after a live quick fix was applied. */
export interface LiveFixResult {
  label: string;
  line: number;
  /** checking: the live analyzer is re-reading the code; passed: no syntax problem left there; failed: still problems. */
  status: "checking" | "passed" | "failed";
  remaining: number;
}

interface Props {
  saarthi: SaarthiApi;
  execution: Execution | null;
  language: Language | null;
  stale: boolean;
  currentHash: string | null;
  source: string;
  selectedDiagnostic: Diagnostic | null;
  onReveal(line: number, column?: number): void;
  onApplyFix(runAfter: boolean): void;
  onUndoFix(): void;
  onRun(): void;
  /** The concept at the cursor (live analyzer), null when unknown. */
  concept: ConceptInfo | null;
  liveSupported: boolean;
  /** The live problem Saarthi is looking at (at the cursor, or the first one). */
  liveProblem: LiveProblem | null;
  liveCount: number;
  onApplyLiveFix(problem: LiveProblem, runAfter: boolean): void;
  liveFixResult: LiveFixResult | null;
  /** Saarthi's face in the panel header. */
  mood: MascotMood;
  /** Every live finding (syntax, typos, tips, type checker), for the live overview. */
  liveProblems?: LiveProblem[];
  /** Metrics of the code in the editor (functions, loops, input/output). */
  metrics?: CodeMetrics | null;
  /** The program's input (to remind about it). */
  stdin?: string;
  onOpenInput?(): void;
}

const CONFIDENCE_STYLE = {
  high: "border-brand/40 bg-brand/10 text-brand-fg",
  medium: "border-warn/40 bg-warn/12 text-warn-fg",
  low: "border-danger/35 bg-danger/10 text-danger-fg",
} as const;

const LOOP = ["Code", "Analyze", "Diagnose", "Explain", "Fix", "Compile", "Verify"] as const;
type LoopStage = (typeof LOOP)[number];

/** Where the student is in CODE -> ANALYZE -> DIAGNOSE -> EXPLAIN -> FIX -> COMPILE -> VERIFY. */
function loopStage(props: Props, hasRunProblem: boolean): LoopStage {
  const { saarthi, execution } = props;
  const running = execution !== null && !execution.terminal;
  if (saarthi.verdict?.verified || (props.liveFixResult?.status === "passed" && !running)) return "Verify";
  if (running && (saarthi.applied || props.liveFixResult)) return "Compile";
  if (saarthi.fix || props.liveProblem?.fix) return "Fix";
  if (saarthi.explanation && !props.stale) return "Explain";
  if (props.liveCount > 0 || hasRunProblem) return "Diagnose";
  if (running || saarthi.pending) return "Analyze";
  return "Code";
}

/** A labelled line in an analysis card: ERROR, WHY, CONCEPT, QUICK FIX... */
function Row({ label, children, tone = "text-faint" }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="grid grid-cols-[4.6rem_1fr] gap-2 border-t border-line/70 py-1.5 first:border-t-0">
      <span className={`k-label !text-[9.5px] pt-[3px] ${tone}`}>{label}</span>
      <div className="min-w-0 text-[12.5px] leading-relaxed text-fg">{children}</div>
    </div>
  );
}

function ConceptPath({ language, path }: { language: string; path: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {[language, ...path].map((part, i) => (
        <span key={`${part}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-faint">→</span>}
          <span className={`font-mono text-[11px] font-semibold ${i === 0 ? "text-brand-fg" : i === path.length ? "text-fg" : "text-muted"}`}>{part}</span>
        </span>
      ))}
    </span>
  );
}

export function SaarthiPanel(props: Props) {
  const { saarthi, execution, stale, language } = props;
  const problems = execution?.terminal ? execution.diagnostics.filter((d) => d.code !== "UNPARSED") : [];
  const focus = props.selectedDiagnostic ?? problems.find((d) => d.severity === "error") ?? problems[0] ?? null;
  const canUseRun = !!execution?.terminal && !stale && !!props.currentHash;
  const scroller = useRef<HTMLDivElement>(null);
  const languageName = language?.displayName ?? "Code";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [saarthi.chat.length, saarthi.explanation, saarthi.fix, saarthi.verdict]);
  // While an answer is being written, keep its newest line in view (unless the student scrolled up to read).
  const streamingText = saarthi.chat.find((m) => m.streaming)?.content.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !streamingText) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [streamingText]);

  const explain = () =>
    execution &&
    props.currentHash &&
    void saarthi.explain({ executionId: execution.id, sourceHash: props.currentHash, diagnosticId: focus?.id ?? null, evidence: execution.evidence });
  const suggest = () =>
    execution &&
    props.currentHash &&
    void saarthi.suggestFix({ executionId: execution.id, sourceHash: props.currentHash, diagnosticId: focus?.id ?? null, evidence: execution.evidence });

  const stage = loopStage(props, !!focus && focus.severity !== "info" && canUseRun);
  // A current run with problems comes first; otherwise the live analyzer (about the code as it is now).
  const runFirst = canUseRun && !!focus;
  const live = (
    <>
      {props.liveProblem && (
        <LiveAnalysis
          problem={props.liveProblem}
          count={props.liveCount}
          languageName={languageName}
          fileName={language?.sourceFile ?? ""}
          source={props.source}
          onReveal={props.onReveal}
          onApply={props.onApplyLiveFix}
        />
      )}
      {props.liveFixResult && <LiveFixStatus result={props.liveFixResult} />}
    </>
  );
  const runAnalysis = (
        <div className="mb-3 overflow-hidden rounded-md border border-line bg-surface" data-testid="saarthi-context">
          <p className="flex items-center gap-2 border-b border-line bg-raised px-2.5 py-1.5">
            <span className="k-label shrink-0 whitespace-nowrap !text-[9.5px]">Run analysis</span>
            {execution?.terminal && !stale && <span className="ml-auto truncate font-mono text-[10px] text-muted">{execution.summary}</span>}
          </p>
          <div className="px-2.5 py-2">
            {!execution ? (
              <p className="text-xs text-muted">
                Saarthi explains the results of a run. <b className="text-fg">Run your code</b> first, or ask a question below.
              </p>
            ) : !execution.terminal ? (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin text-brand-fg" /> Waiting for the run to finish...
              </p>
            ) : stale ? (
              <div className="flex items-center gap-2 text-xs text-fg">
                <AlertTriangle size={14} className="shrink-0 text-warn-fg" />
                <span className="flex-1">Your code changed after the last run. Run it again so Saarthi sees the same code as you.</span>
                <Button size="sm" onClick={props.onRun}>
                  <Play size={12} /> Run
                </Button>
              </div>
            ) : focus ? (
              <FocusAnalysis
                diagnostic={focus}
                languageName={languageName}
                onReveal={props.onReveal}
                actions={
                  saarthi.enabled && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="ai" size="sm" onClick={explain} disabled={!canUseRun || saarthi.pending !== null} data-testid="saarthi-explain">
                        {saarthi.pending === "explain" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        Explain this problem
                      </Button>
                      {focus.severity !== "info" && (
                        <Button size="sm" onClick={suggest} disabled={!canUseRun || saarthi.pending !== null} data-testid="saarthi-fix">
                          {saarthi.pending === "fix" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                          Suggest a fix
                        </Button>
                      )}
                    </div>
                  )
                }
              />
            ) : (
              <p className="text-xs text-muted">
                <BadgeCheck size={13} className="mr-1 inline text-brand-fg" />
                No problems in this run. {saarthi.enabled ? "Ask Saarthi anything about your code below." : ""}
              </p>
            )}
            {saarthi.enabled && focus && canUseRun && (
              <p className="mt-2 text-[10.5px] text-faint">Tip: select a problem under Problems, or press {modKey}+Shift+Enter in the editor.</p>
            )}
          </div>
        </div>
  );
  const statusWord = saarthi.status === null ? "offline" : saarthi.enabled ? "online" : "not set up";

  return (
    <section className="@container flex h-full min-h-0 flex-col" aria-label="Saarthi, the AI guide" data-testid="saarthi-panel">
      <header className="flex items-center gap-2.5 border-b border-line bg-raised px-3 py-2">
        <SaarthiMascot size={40} mood={props.mood} variant="head" watch={false} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="k-index">05</span>
            <Scramble text="Saarthi" className="k-label !text-fg" />
            <span className="k-label hidden !tracking-[0.1em] 2xl:inline">/ diagnostic intelligence</span>
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
            AI guide · grounded in your run{saarthi.status?.model ? ` · ${saarthi.status.model}` : ""}
          </p>
        </div>
        {saarthi.chat.length > 0 && (
          <button
            type="button"
            onClick={saarthi.newChat}
            title="Start a new chat"
            aria-label="New chat"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-fg/6 hover:text-fg"
            data-testid="saarthi-new-chat"
          >
            <MessageSquarePlus size={15} />
          </button>
        )}
        <span
          className={`flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ${
            saarthi.enabled ? "border-ai/40 bg-ai/10 text-ai-fg" : "border-warn/40 bg-warn/12 text-warn-fg"
          }`}
          data-testid="saarthi-status"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${saarthi.enabled ? "animate-pulse-dot bg-ai" : "bg-warn"}`} aria-hidden />
          {statusWord}
        </span>
      </header>

      <ol className="grid grid-cols-7 gap-0.5 border-b border-line px-2 py-1.5" aria-label="Where you are in the fix loop" data-testid="saarthi-loop">
        {LOOP.map((step, i) => {
          const at = LOOP.indexOf(stage);
          const state = i < at ? "done" : i === at ? "now" : "next";
          return (
            <li key={step} className="min-w-0" aria-current={state === "now" ? "step" : undefined}>
              <span className={`block h-[3px] rounded-full ${state === "next" ? "bg-line-strong" : "bg-brand"}`} aria-hidden />
              <span
                className={`mt-1 block truncate text-center font-mono text-[8.5px] font-bold uppercase tracking-[0.04em] ${
                  state === "now" ? "text-fg" : state === "done" ? "text-brand-fg" : "text-faint"
                }`}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      <div ref={scroller} className="cd-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {saarthi.status && !saarthi.enabled && <SetupCard reason={saarthi.status.reason} />}
        {saarthi.status === null && (
          <p className="mb-3 rounded-md border border-line bg-raised p-3 text-xs text-muted">Cannot reach the server to check whether Saarthi is available.</p>
        )}

        <LiveOverview
          problems={props.liveProblems ?? []}
          focused={props.liveProblem}
          metrics={props.metrics ?? null}
          stdin={props.stdin ?? ""}
          stale={stale}
          hasRun={!!execution?.terminal}
          fileName={language?.sourceFile ?? ""}
          liveSupported={props.liveSupported}
          onReveal={props.onReveal}
          onApply={props.onApplyLiveFix}
          onOpenInput={props.onOpenInput}
          onRun={props.onRun}
        />

        <ConceptCard concept={props.concept} languageName={languageName} liveSupported={props.liveSupported} />

        {!runFirst && live}

        {runAnalysis}
        {runFirst && live}

        {saarthi.error && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2.5 text-xs text-fg">
            <ShieldAlert size={14} className="mt-px shrink-0 text-danger-fg" />
            {saarthi.error}
          </div>
        )}

        {saarthi.explanation && (
          <ExplanationCard
            explanation={saarthi.explanation}
            outdated={saarthi.explanation.sourceHash !== props.currentHash}
            diagnostic={execution?.diagnostics.find((d) => d.id === saarthi.explanation?.focusDiagnosticId) ?? null}
            onReveal={props.onReveal}
          />
        )}

        {saarthi.fix && <FixCard {...props} />}

        {!props.liveProblem && !focus && !saarthi.explanation && !saarthi.fix && saarthi.chat.length === 0 && <Capabilities enabled={saarthi.enabled} />}

        <ChatThread saarthi={saarthi} />
      </div>

      <AskBox
        busy={saarthi.pending === "ask"}
        streaming={saarthi.chat.some((m) => m.streaming)}
        onStop={saarthi.stop}
        grounding={canUseRun ? "run" : "code"}
        offline={!saarthi.enabled}
        suggestions={saarthi.chat.length === 0 ? suggestions({ focus: canUseRun ? focus : null, languageName, concept: props.concept, hasRun: canUseRun }) : []}
        onAsk={(question, diagnosticId) =>
          saarthi.ask(
            {
              question,
              languageId: language?.id ?? "",
              ...(canUseRun
                ? { executionId: execution!.id, sourceHash: props.currentHash, evidence: execution!.evidence, diagnosticId: diagnosticId ?? null }
                : { source: props.source }),
            },
            () => ({
              languageId: language?.id ?? "",
              languageName,
              source: props.source,
              liveProblems: props.liveProblems ?? [],
              execution: canUseRun ? execution : null,
              concept: props.concept,
              metrics: props.metrics ?? null,
              stdin: props.stdin ?? "",
            }),
          )
        }
      />
    </section>
  );
}

/** The live side panel: everything the analyzer sees in the code right now, and what to do next. */
function LiveOverview(props: {
  problems: LiveProblem[];
  focused: LiveProblem | null;
  metrics: CodeMetrics | null;
  stdin: string;
  stale: boolean;
  hasRun: boolean;
  fileName: string;
  liveSupported: boolean;
  onReveal(line: number, column?: number): void;
  onApply(problem: LiveProblem, runAfter: boolean): void;
  onOpenInput?(): void;
  onRun(): void;
}) {
  const { problems, metrics } = props;
  const syntax = problems.filter((p) => p.kind === "missing" || p.kind === "unexpected").length;
  const typos = problems.filter((p) => p.kind === "typo").length;
  const tips = problems.filter((p) => p.kind === "tip").length;
  const others = problems.filter((p) => p !== props.focused).slice(0, 5);
  const next: { text: string; action?: { label: string; run(): void } }[] = [];
  if (metrics?.readsInput && !props.stdin.trim()) {
    next.push({ text: "Your program reads input, but the Input tab is empty.", action: props.onOpenInput ? { label: "Open Input", run: props.onOpenInput } : undefined });
  }
  if (metrics && !metrics.printsOutput && metrics.lines > 3) next.push({ text: "Nothing is printed, so a run will show no output." });
  if (syntax + typos === 0 && (!props.hasRun || props.stale)) next.push({ text: props.stale ? "Your code changed: run again so the results match it." : "No problems so far: run it to let the compiler check everything.", action: { label: "Run", run: props.onRun } });
  const heavy = metrics?.functions.filter((f) => f.estimate !== "O(1)").slice(0, 3) ?? [];
  if (!props.liveSupported && problems.length === 0 && next.length === 0) return null;
  return (
    <section className="mb-3 rounded-md border border-line bg-surface" data-testid="live-overview" aria-label="Live analysis">
      <p className="flex items-center gap-2 border-b border-line bg-raised px-2.5 py-1.5">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
        </span>
        <span className="k-label !text-[9.5px]">Live analysis</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px]" data-testid="live-overview-counts">
          {syntax + typos + tips === 0 ? (
            <span className="flex items-center gap-1 text-brand-fg">
              <BadgeCheck size={12} /> all clear
            </span>
          ) : (
            <>
              {syntax > 0 && <span className="rounded bg-danger/12 px-1 text-danger-fg">{syntax} error{syntax === 1 ? "" : "s"}</span>}
              {typos > 0 && <span className="rounded bg-warn/15 px-1 text-warn-fg">{typos} typo{typos === 1 ? "" : "s"}</span>}
              {tips > 0 && <span className="rounded bg-info/12 px-1 text-info-fg">{tips} tip{tips === 1 ? "" : "s"}</span>}
            </>
          )}
        </span>
      </p>
      {others.length > 0 && (
        <ul className="divide-y divide-line/70">
          {others.map((p, i) => (
            <li key={`${p.startLine}:${p.startColumn}:${i}`} className="flex items-start gap-1.5 px-2.5 py-1.5">
              <button type="button" onClick={() => props.onReveal(p.startLine, p.startColumn)} className="min-w-0 flex-1 text-left text-[11.5px] leading-snug text-fg hover:underline">
                <span className={`mr-1 font-mono text-[9.5px] font-bold uppercase ${p.kind === "tip" ? "text-info-fg" : p.kind === "typo" ? "text-warn-fg" : "text-danger-fg"}`}>
                  {p.kind === "tip" ? "tip" : p.kind === "typo" ? "typo" : "error"} · {p.startLine}
                </span>
                {p.message.length > 110 ? `${p.message.slice(0, 107)}...` : p.message}
              </button>
              {p.fix && (
                <button
                  type="button"
                  onClick={() => props.onApply(p, false)}
                  title={p.fix.label}
                  className="shrink-0 rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-brand-fg hover:bg-brand/20"
                  data-testid="overview-fix"
                >
                  Fix
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(next.length > 0 || heavy.length > 0) && (
        <div className="space-y-1 border-t border-line px-2.5 py-2">
          {next.map((n) => (
            <p key={n.text} className="flex items-center gap-2 text-[11.5px] text-muted" data-testid="live-next">
              <span className="text-brand-fg" aria-hidden>
                ›
              </span>
              <span className="flex-1">{n.text}</span>
              {n.action && (
                <button type="button" onClick={n.action.run} className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-fg hover:bg-fg/5">
                  {n.action.label}
                </button>
              )}
            </p>
          ))}
          {heavy.length > 0 && (
            <p className="text-[11px] text-muted" data-testid="live-complexity">
              <span className="k-label mr-1 !text-[9px]">Complexity</span>
              {heavy.map((f) => (
                <span key={f.name} className="mr-2 whitespace-nowrap font-mono text-[10.5px]">
                  {f.name} <b className="text-fg">{f.estimate}</b>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const CAPABILITIES: [string, string][] = [
  ["Identify", "the error, its code and exact line"],
  ["Explain", "what happened, in plain words"],
  ["Cause", "why it happened"],
  ["Concept", "the idea behind it"],
  ["Solution", "how to fix it"],
  ["Quick fix", "a rule-based fix for simple slips"],
  ["Preview", "the change as a diff first"],
  ["Apply", "only when you press Apply"],
  ["Recompile", "a real run in the sandbox"],
  ["Verify", "checks that the fix worked"],
];

/** What Saarthi does, shown while there is nothing to analyse yet. */
function Capabilities({ enabled }: { enabled: boolean }) {
  return (
    <div className="mb-3 rounded-md border border-dashed border-line-strong px-2.5 py-2" data-testid="saarthi-capabilities">
      <p className="k-label !text-[9.5px]">What Saarthi does</p>
      <ol className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 @[34rem]:grid-cols-2">
        {CAPABILITIES.map(([name, what], i) => (
          <li key={name} className="flex items-baseline gap-1.5 text-[11.5px] leading-snug">
            <span className="font-mono text-[9.5px] text-faint">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-semibold text-fg">{name}</span>
            <span className="truncate text-muted" title={what}>
              {what}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10.5px] text-faint">
        {enabled
          ? "Run your code, or make a slip while typing, to see these in action. Steps 1 to 7 also work without AI (quick notes and the live analyzer)."
          : "Without an AI provider, the quick notes and the live analyzer still cover steps 1 to 7."}
      </p>
    </div>
  );
}

function ConceptCard({ concept, languageName, liveSupported }: { concept: ConceptInfo | null; languageName: string; liveSupported: boolean }) {
  return (
    <div className="k-hud relative mb-3 rounded-md border border-line bg-surface px-2.5 py-2" data-testid="concept-card">
      <p className="flex items-center gap-2">
        <BookOpen size={12} className="text-brand-fg" aria-hidden />
        <span className="k-label !text-[9.5px]">Current concept</span>
        {concept?.scope && <span className="ml-auto truncate font-mono text-[10px] text-faint">in {concept.scope}</span>}
      </p>
      <div className="mt-1.5" data-testid="current-concept">
        {!liveSupported ? (
          <p className="text-xs text-muted">Concept detection reads the syntax tree while you type; it is not available for {languageName}.</p>
        ) : concept ? (
          <ConceptPath language={languageName} path={concept.path} />
        ) : (
          <p className="text-xs text-faint">Move the cursor into your code...</p>
        )}
      </div>
      {concept && concept.inFile.length > 0 && (
        <p className="mt-2 flex h-[18px] flex-wrap items-center gap-1 overflow-hidden" title={`In this file: ${concept.inFile.join(", ")}`}>
          <span className="k-label mr-0.5 !text-[9px]">In this file</span>
          {concept.inFile.map((area) => (
            <span key={area} className="rounded border border-line bg-raised px-1.5 py-px font-mono text-[10px] text-muted">
              {area}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function LiveAnalysis({
  problem,
  count,
  languageName,
  fileName,
  source,
  onReveal,
  onApply,
}: {
  problem: LiveProblem;
  count: number;
  languageName: string;
  fileName: string;
  source: string;
  onReveal(line: number, column?: number): void;
  onApply(problem: LiveProblem, runAfter: boolean): void;
}) {
  const note = topicNote(problem.topic);
  const preview = problem.fix ? previewEdits(source, problem.fix.edits) : null;
  const kind = problem.kind === "tip" ? "tip" : problem.kind === "typo" || problem.topic === "typo" ? "typo" : "syntax";
  const tag =
    kind === "tip"
      ? "border-info/35 bg-info/10 text-info-fg"
      : kind === "typo"
        ? "border-warn/40 bg-warn/12 text-warn-fg"
        : "border-danger/35 bg-danger/10 text-danger-fg";
  const label =
    problem.origin === "service"
      ? "Type checker · live"
      : kind === "tip"
        ? "Saarthi tip · live"
        : kind === "typo"
          ? problem.kind === "typo"
            ? "Typo Guard · live"
            : "Syntax error · typo · live"
          : "Syntax error · live";
  return (
    <article className="cd-ai-border mb-3 animate-slide-up rounded-md p-2.5" data-testid="live-analysis" data-kind={kind}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded border px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ${tag}`}>
          {topicCode(problem.topic)}
        </span>
        <span className="k-label !text-[9.5px]">{label}</span>
        <button
          type="button"
          onClick={() => onReveal(problem.startLine, problem.startColumn)}
          className="ml-auto rounded px-1 font-mono text-[10.5px] font-semibold text-brand-fg hover:bg-brand/10"
        >
          {fileName}:{problem.startLine}:{problem.startColumn} &rarr;
        </button>
      </div>
      {count > 1 && <p className="mt-1 font-mono text-[10px] text-faint">1 of {count} live problems (the one at your cursor, or the first)</p>}
      <div className="mt-1.5">
        <Row label={kind === "tip" ? "Tip" : kind === "typo" ? "Typo" : "Error"} tone={kind === "tip" ? "text-info-fg" : kind === "typo" ? "text-warn-fg" : "text-danger-fg"}>
          {problem.message}
        </Row>
        <Row label="Why">{note.why}</Row>
        <Row label="Concept">
          <ConceptPath language={languageName} path={note.concept} />
        </Row>
        <Row label="Quick fix" tone="text-brand-fg">
          {problem.fix ? (
            <div>
              {preview && (
                <div className="mb-2 overflow-hidden rounded border border-line font-mono text-[11.5px]" data-testid="live-fix-preview">
                  {preview.before.map((l, i) => (
                    <div key={`b${i}`} className="flex bg-danger/8 text-danger-fg">
                      <span className="w-8 shrink-0 select-none pr-1.5 text-right opacity-60">{preview.line + i}</span>
                      <span className="w-3 shrink-0 select-none">−</span>
                      <span className="whitespace-pre-wrap break-all">{l || " "}</span>
                    </div>
                  ))}
                  {preview.after.map((l, i) => (
                    <div key={`a${i}`} className="flex bg-brand/10 text-brand-fg">
                      <span className="w-8 shrink-0 select-none pr-1.5 text-right opacity-60">{preview.line + i}</span>
                      <span className="w-3 shrink-0 select-none">+</span>
                      <span className="whitespace-pre-wrap break-all">{l || " "}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => onApply(problem, false)} data-testid="apply-live-fix" className="font-mono uppercase tracking-wider">
                  <Wrench size={12} /> [ {problem.fix.label} ]
                </Button>
                <Button size="sm" onClick={() => onApply(problem, true)} data-testid="apply-live-fix-run">
                  <Play size={12} /> Apply & run
                </Button>
              </div>
            </div>
          ) : (
            <span className="text-muted">No automatic fix here: the right repair depends on what you meant. {note.title === "Indentation" ? "Line the code up with its block." : "Check the highlighted spot."}</span>
          )}
        </Row>
        {problem.fix && (
          <Row label="Confidence">
            <span className={`rounded border px-1.5 py-px font-mono text-[10px] font-bold uppercase ${CONFIDENCE_STYLE[problem.fix.confidence]}`}>{problem.fix.confidence}</span>
            <span className="ml-2 text-[10.5px] text-faint">rule-based, not AI · checked again by the live analyzer</span>
          </Row>
        )}
      </div>
    </article>
  );
}

function LiveFixStatus({ result }: { result: LiveFixResult }) {
  return (
    <div
      className={`mb-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs ${
        result.status === "passed" ? "border-brand/35 bg-brand/10" : result.status === "failed" ? "border-warn/40 bg-warn/10" : "border-line bg-raised"
      }`}
      data-testid="live-fix-status"
      data-status={result.status}
    >
      {result.status === "checking" ? (
        <Loader2 size={13} className="animate-spin text-brand-fg" />
      ) : result.status === "passed" ? (
        <BadgeCheck size={14} className="text-brand-fg" />
      ) : (
        <CircleSlash size={14} className="text-warn-fg" />
      )}
      <span className="text-fg">
        <b className="font-mono text-[10.5px] uppercase tracking-wider">{result.label}</b> applied on line {result.line}.{" "}
        {result.status === "checking"
          ? "Re-checking..."
          : result.status === "passed"
            ? "Live analyzer: syntax OK. Run to let the compiler verify the rest."
            : `Live analyzer still reports ${result.remaining} problem${result.remaining === 1 ? "" : "s"}.`}
      </span>
    </div>
  );
}

function FocusAnalysis({
  diagnostic: d,
  languageName,
  onReveal,
  actions,
}: {
  diagnostic: Diagnostic;
  languageName: string;
  onReveal(line: number, column?: number): void;
  actions: ReactNode;
}) {
  const note = noteFor(d.code, d.category);
  const { text } = splitMessage(d.message);
  const tone = d.severity === "error" ? "border-danger/35 bg-danger/10 text-danger-fg" : d.severity === "warning" ? "border-warn/40 bg-warn/12 text-warn-fg" : "border-info/35 bg-info/10 text-info-fg";
  return (
    <div data-testid="focus-analysis">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded border px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] ${tone}`}>{d.code}</span>
        <span className="k-label !text-[9.5px]">
          {CATEGORY_LABEL[d.category]} {d.severity}
        </span>
        {d.range && (
          <button
            type="button"
            onClick={() => onReveal(d.range!.startLine, d.range!.startColumn)}
            className="ml-auto flex items-center gap-1 rounded px-1 font-mono text-[10.5px] font-semibold text-brand-fg hover:bg-brand/10"
          >
            <Crosshair size={11} /> line {d.range.startLine}:{d.range.startColumn}
          </button>
        )}
      </div>
      <div className="mt-1.5">
        <Row label="Error" tone="text-danger-fg">
          {text}
        </Row>
        <Row label="Why">{note.meaning}</Row>
        <Row label="Concept">
          <ConceptPath language={languageName} path={[note.concept]} />
        </Row>
        <Row label="Try" tone="text-brand-fg">
          {note.tip}
        </Row>
      </div>
      <p className="mt-1 text-[10px] text-faint">Quick note written by people, not AI. {actions ? "Saarthi can explain your exact case:" : ""}</p>
      {actions}
    </div>
  );
}

function SetupCard({ reason }: { reason?: string | null }) {
  return (
    <div className="mb-3 rounded-md border border-warn/35 bg-warn/[0.07] p-3 text-xs leading-relaxed text-muted" data-testid="saarthi-setup">
      <p className="font-semibold text-fg">Offline mode: no AI model is connected</p>
      <p className="mt-1">{reason ?? "No AI provider is configured."}</p>
      <p className="mt-2">
        I still answer your questions below from KAIRO's built-in knowledge, explain the live problems and your runs' errors, and show how-to
        examples. For full AI answers, explanations and fixes, add a model on the server (free: a Google Gemini API key or Ollama on your
        computer; or Claude/OpenAI). See docs/saarthi.md.
      </p>
    </div>
  );
}

function ExplanationCard({
  explanation: e,
  outdated,
  diagnostic,
  onReveal,
}: {
  explanation: NonNullable<SaarthiApi["explanation"]>;
  outdated: boolean;
  diagnostic: Diagnostic | null;
  onReveal(line: number, column?: number): void;
}) {
  return (
    <article className={`cd-ai-border mb-3 animate-slide-up rounded-md p-2.5 ${outdated ? "opacity-60" : ""}`} data-testid="saarthi-explanation">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ai-fg">
          <Sparkles size={11} /> AI analysis
        </span>
        {diagnostic && (
          <span className="rounded border border-danger/35 bg-danger/10 px-1.5 py-px font-mono text-[9.5px] font-bold text-danger-fg">{diagnostic.code}</span>
        )}
        {e.cached && <span className="font-mono text-[10px] text-faint">cached</span>}
      </div>
      <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug text-fg">{e.problem}</h3>
      {outdated && <p className="mt-1.5 rounded bg-warn/10 px-2 py-1 text-[11px] text-warn-fg">This explanation is about an earlier version of your code.</p>}
      <div className="mt-1.5">
        <Row label="What" tone="text-ai-fg">
          {e.whatHappened}
        </Row>
        <Row label="Why" tone="text-ai-fg">
          {e.why}
        </Row>
        <Row label="Fix" tone="text-ai-fg">
          <Markdown text={e.suggestedFix} />
        </Row>
        {e.relatedConcepts.length > 0 && (
          <Row label="Concepts" tone="text-ai-fg">
            <span className="flex flex-wrap gap-1">
              {e.relatedConcepts.map((c) => (
                <span key={c} className="rounded border border-ai/30 bg-ai/10 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ai-fg">
                  {c}
                </span>
              ))}
            </span>
          </Row>
        )}
        <Row label="Confidence" tone="text-ai-fg">
          <span className={`rounded border px-1.5 py-px font-mono text-[10px] font-bold uppercase ${CONFIDENCE_STYLE[e.confidence]}`}>{e.confidence}</span>
        </Row>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {e.location && !outdated && (
          <Button size="sm" variant="ghost" onClick={() => onReveal(e.location!.line)}>
            <Crosshair size={12} /> Show line {e.location.line}
          </Button>
        )}
        <span className="ml-auto text-[10.5px] text-faint">AI explanation · not verified: run your code to check</span>
      </div>
    </article>
  );
}

const FIX_STEPS = ["Preview", "Apply", "Recompile", "Verify"] as const;

function FixCard(props: Props) {
  const { saarthi } = props;
  const fix = saarthi.fix!;
  const lines = useMemo(() => {
    const base = saarthi.applied?.fixId === fix.fixId ? saarthi.applied.before : props.source;
    return diffLines(base, fix.edits);
  }, [fix, saarthi.applied, props.source]);
  const applied = saarthi.applied?.fixId === fix.fixId;
  const matchesBase = props.currentHash === fix.baseSourceHash;
  const running = props.execution !== null && !props.execution.terminal;
  const verdict = saarthi.verdict?.fixId === fix.fixId ? saarthi.verdict : null;
  const step = verdict ? 4 : running || saarthi.pending === "verify" ? 2 : applied ? 1 : 0;

  return (
    <article className="cd-ai-border mb-3 animate-slide-up rounded-md p-2.5" data-testid="saarthi-fix-card">
      <div className="flex items-center gap-2">
        <p className="flex items-center gap-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ai-fg">
          <Wand2 size={11} /> Fix preview
        </p>
        <span className={`ml-auto rounded border px-1.5 py-px font-mono text-[10px] font-bold uppercase ${CONFIDENCE_STYLE[fix.confidence]}`}>
          confidence: {fix.confidence}
        </span>
      </div>
      <ol className="mt-2 grid grid-cols-4 gap-1" aria-label="Fix progress">
        {FIX_STEPS.map((label, i) => (
          <li
            key={label}
            className={`rounded-sm border-t-2 pt-1 font-mono text-[9px] font-bold uppercase tracking-wider ${
              i < step || (i === 3 && verdict?.verified) ? "border-brand text-brand-fg" : i === step ? "border-ai text-ai-fg" : "border-line-strong text-faint"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[13px] text-fg">{fix.summary}</p>
      <div className="mt-2 overflow-hidden rounded border border-line font-mono text-[12px]" data-testid="patch-diff">
        {lines.map((l, i) =>
          l.kind === "gap" ? (
            <div key={i} className="bg-raised px-2 text-faint">
              ⋯
            </div>
          ) : (
            <div key={i} className={`flex ${l.kind === "removed" ? "bg-danger/10 text-danger-fg" : l.kind === "added" ? "bg-brand/10 text-brand-fg" : "text-muted"}`}>
              <span className="w-9 shrink-0 select-none pr-2 text-right opacity-60">{l.number}</span>
              <span className="w-4 shrink-0 select-none">{l.kind === "removed" ? "−" : l.kind === "added" ? "+" : " "}</span>
              <span className="whitespace-pre-wrap break-all">{l.text || " "}</span>
            </div>
          ),
        )}
      </div>

      {verdict && (
        <div
          data-testid="fix-verdict"
          className={`mt-2.5 flex items-start gap-2 rounded-md border p-2.5 text-xs ${
            verdict.verified ? "border-brand/35 bg-brand/10 text-fg" : verdict.verdict === "improved" ? "border-warn/35 bg-warn/10 text-fg" : "border-danger/30 bg-danger/10 text-fg"
          }`}
        >
          {verdict.verified ? <BadgeCheck size={15} className="mt-px shrink-0 text-brand-fg" /> : <CircleSlash size={15} className="mt-px shrink-0 text-warn-fg" />}
          <span>
            <b>{verdict.verified ? "Verified by a real run." : verdict.verdict === "improved" ? "Partly fixed." : "Not verified."}</b> {verdict.message}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!applied ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={!matchesBase || running}
              onClick={() => props.onApplyFix(true)}
              data-testid="apply-and-verify"
              title={matchesBase ? "Replace the lines, run the program and check the result" : "Your code changed since this suggestion"}
            >
              <Play size={12} fill="currentColor" /> Apply & verify
            </Button>
            <Button size="sm" disabled={!matchesBase} onClick={() => props.onApplyFix(false)} data-testid="apply-only">
              Apply only
            </Button>
            <Button size="sm" variant="ghost" onClick={saarthi.dismissFix}>
              Dismiss
            </Button>
          </>
        ) : (
          <>
            {saarthi.pending === "verify" || running ? (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Loader2 size={13} className="animate-spin text-brand-fg" /> Running the patched code...
              </span>
            ) : (
              !verdict && (
                <Button size="sm" variant="primary" onClick={props.onRun}>
                  <RotateCcw size={12} /> Run to verify
                </Button>
              )
            )}
            <Button size="sm" variant="ghost" onClick={props.onUndoFix} data-testid="undo-fix">
              <Undo2 size={12} /> Undo fix
            </Button>
          </>
        )}
        {!matchesBase && !applied && <span className="text-[10.5px] text-warn-fg">Your code changed since this suggestion.</span>}
      </div>
      <p className="mt-2 text-[10.5px] text-faint">Nothing changes in your code until you apply it; {modKey}+Z in the editor also undoes it.</p>
    </article>
  );
}

function ChatThread({ saarthi }: { saarthi: SaarthiApi }) {
  if (saarthi.chat.length === 0) return null;
  const waiting = saarthi.pending === "ask" && !saarthi.chat.some((m) => m.streaming) && saarthi.chat[saarthi.chat.length - 1]?.role === "user";
  return (
    <ol className="flex flex-col gap-3" aria-label="Conversation with Saarthi" data-testid="saarthi-chat" aria-live="polite">
      {saarthi.chat.map((m) =>
        m.role === "user" ? (
          <li key={m.id} className="k-chat-in ml-auto max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-brand/30 bg-brand/10 px-3 py-2 text-[13px] text-fg">
            {m.content}
          </li>
        ) : (
          <li key={m.id} className="k-chat-in flex max-w-full gap-2" data-streaming={m.streaming || undefined}>
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ai/40 bg-ai/12 font-mono text-[10px] font-bold text-ai-fg" aria-hidden>
              S
            </span>
            <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-md px-3 py-2 ${m.error ? "border border-danger/30 bg-danger/10 text-[13px] text-fg" : "cd-ai-border"}`}>
              <p className="mb-0.5 flex items-center gap-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ai-fg">
                Saarthi
                {m.streaming && <span className="font-normal normal-case tracking-normal text-faint">writing...</span>}
                {m.stopped && <span className="font-normal normal-case tracking-normal text-faint">stopped</span>}
                {!m.streaming && !m.error && m.content && <CopyButton text={m.content} />}
              </p>
              {m.error ? (
                m.content
              ) : m.content ? (
                <div className={m.streaming ? "k-streaming" : undefined}>
                  <Markdown text={m.content} />
                </div>
              ) : (
                <span className="k-typing" aria-label="Saarthi is thinking">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {!m.streaming && m.grounded && m.grounded !== "none" && (
                <p className="mt-1 font-mono text-[10px] text-faint">based on your {m.grounded === "execution" ? "last run" : "current code"} · AI answer, check by running</p>
              )}
              {m.offline && (
                <p className="mt-1 font-mono text-[10px] text-faint" data-testid="offline-answer">offline Saarthi · built-in knowledge · check by running</p>
              )}
            </div>
          </li>
        ),
      )}
      {waiting && (
        <li className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin text-ai-fg" /> Saarthi is thinking...
        </li>
      )}
    </ol>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => undefined,
        );
      }}
      className="ml-auto rounded p-0.5 text-faint transition-colors hover:bg-fg/8 hover:text-fg"
      aria-label={copied ? "Copied" : "Copy the answer"}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

interface Suggestion {
  label: string;
  question: string;
  diagnosticId?: string;
}

/** Questions a beginner can send with one click, chosen from what is on screen. */
function suggestions({ focus, languageName, concept, hasRun }: { focus: Diagnostic | null; languageName: string; concept: ConceptInfo | null; hasRun: boolean }): Suggestion[] {
  const list: Suggestion[] = [];
  if (focus && focus.severity !== "info") {
    const where = focus.range ? ` on line ${focus.range.startLine}` : "";
    list.push({ label: "Explain this error", question: `Explain the ${focus.severity}${where}: what does it mean and why did it happen?`, diagnosticId: focus.id });
    list.push({ label: "Give me a hint", question: `Give me a hint to fix the ${focus.severity}${where}, without writing the whole answer.`, diagnosticId: focus.id });
  } else if (hasRun) {
    list.push({ label: "What does my code do?", question: "Explain what my program does, step by step." });
    list.push({ label: "How can I improve it?", question: "How can I make this program clearer or faster?" });
  } else {
    list.push({ label: "What does my code do?", question: "Explain what my code does, step by step." });
  }
  const topic = concept?.path[concept.path.length - 1];
  if (topic) list.push({ label: `Explain ${topic}`, question: `Explain ${topic} in ${languageName} with a small example.` });
  list.push({ label: `Input in ${languageName}`, question: `How do I read input from the user in ${languageName}?` });
  return list.slice(0, 4);
}

/** Example prompts typed into the empty box one after another (a hint of what to ask). */
const PROMPTS = ["Why does my program crash?", "Explain this error in simple words", "What is a pointer?", "How do loops work?", "Give me a hint, not the answer"];

function useTypedPrompt(active: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText("");
      return;
    }
    let prompt = 0;
    let chars = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      // Decoration: it stands still with Animations off and while the student types,
      // so every frame goes to the editor and the live check.
      const app = document.querySelector<HTMLElement>(".cd-app");
      if (app?.dataset.motion === "off") {
        setText("");
        timer = window.setTimeout(tick, 1500);
        return;
      }
      if (app?.dataset.typing === "true") {
        timer = window.setTimeout(tick, 700);
        return;
      }
      const target = PROMPTS[prompt];
      if (!deleting) {
        chars++;
        setText(target.slice(0, chars));
        if (chars >= target.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1800);
          return;
        }
        timer = window.setTimeout(tick, 45 + Math.random() * 40);
      } else {
        chars -= 2;
        setText(target.slice(0, Math.max(0, chars)));
        if (chars <= 0) {
          deleting = false;
          chars = 0;
          prompt = (prompt + 1) % PROMPTS.length;
          timer = window.setTimeout(tick, 400);
          return;
        }
        timer = window.setTimeout(tick, 22);
      }
    };
    timer = window.setTimeout(tick, 900);
    return () => window.clearTimeout(timer);
  }, [active]);
  return text;
}

function AskBox({
  busy,
  streaming,
  onStop,
  grounding,
  offline,
  suggestions: chips,
  onAsk,
}: {
  busy: boolean;
  streaming: boolean;
  onStop(): void;
  grounding: "run" | "code";
  offline: boolean;
  suggestions: Suggestion[];
  onAsk(question: string, diagnosticId?: string): void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const typed = useTypedPrompt(!focused && !text);
  const send = () => {
    const question = text.trim();
    if (!question || busy) return;
    onAsk(question);
    setText("");
  };
  return (
    <form
      className="border-t border-line bg-raised p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5" data-testid="saarthi-suggestions">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={busy}
              onClick={() => onAsk(chip.question, chip.diagnosticId)}
              className="k-chip-suggest rounded-full border border-ai/35 bg-ai/8 px-2.5 py-1 text-[11.5px] font-medium text-fg transition-colors hover:border-ai/70 hover:bg-ai/15 disabled:opacity-50"
            >
              <Sparkles size={11} className="mr-1 inline text-ai-fg" />
              {chip.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface p-1.5 transition-shadow focus-within:border-ai focus-within:ring-2 focus-within:ring-ai/20">
        <label htmlFor="saarthi-question" className="sr-only">
          Ask Saarthi
        </label>
        <textarea
          id="saarthi-question"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={
            typed
              ? `${typed}▍`
              : offline
                ? "Ask Saarthi: why does my code fail? · explain pointers · how do I read input?"
                : grounding === "run"
                  ? "Ask about this run, e.g. why does line 7 fail?"
                  : "Ask about your code or a concept"
          }
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-fg outline-none placeholder:text-faint"
          data-testid="saarthi-input"
        />
        {streaming ? (
          <Button type="button" variant="ai" size="sm" onClick={onStop} aria-label="Stop the answer" title="Stop" data-testid="saarthi-stop">
            <Square size={12} fill="currentColor" />
          </Button>
        ) : (
          <Button type="submit" variant="ai" size="sm" disabled={busy || !text.trim()} aria-label="Send question">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </Button>
        )}
      </div>
      <p className="mt-1 px-1 text-[10px] text-faint">
        {offline
          ? "Offline mode: answered in your browser from KAIRO's built-in knowledge and the live analysis. Nothing is sent anywhere."
          : `Enter sends, Shift+Enter adds a line. Saarthi sees your ${grounding === "run" ? "last run (code, problems, output)" : "current code"}.`}
      </p>
    </form>
  );
}
