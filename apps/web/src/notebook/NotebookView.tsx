import {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eraser,
  FastForward,
  Loader2,
  NotebookPen,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { Category, Execution } from "../api/types";
import { Markdown } from "../assistant/Markdown";
import { noteFor } from "../diagnostics/notes";
import { setNotebookSymbols } from "../editor/intellisense/providers";
import type { Theme } from "../lib/hooks";
import { load, save } from "../lib/storage";
import type { LiveProblem } from "../live/analyze";
import { Badge, Button, Kbd } from "../ui/primitives";
import { SplitPane } from "../ui/SplitPane";
import { useToast } from "../ui/Toast";
import { CellChecker } from "./cellCheck";
import { CellEditor, type CellEditorHandle } from "./CellEditor";
import {
  applyRun,
  cellsUpTo,
  fromIpynb,
  newCell,
  parseRun,
  runSource,
  STARTER_NOTEBOOK,
  toIpynb,
  type Cell,
  type CellOutput,
  type CellType,
  type Notebook,
} from "./model";

interface Props {
  /** Where this profile's notebook is kept in the browser. */
  storageKey: string;
  theme: Theme;
  fontSize: number;
  /** Is the Python sandbox installed on the server? */
  available: boolean;
  /** Saarthi's AI model is reachable (for "Ask Saarthi" on errors). */
  saarthi: boolean;
  /** Typo Guard and Saarthi Tips extensions. */
  insights: { typos: boolean; tips: boolean };
  onClose(): void;
}

interface LogEntry {
  id: number;
  kind: "run" | "console" | "info";
  title: string;
  lines: { text: string; tone?: "out" | "err" | "result" | "ok" | "bad" | "muted" }[];
}

/** Error codes of the notebook profile, per exception (as the server classifies them). */
const CODES: [RegExp, string, Category][] = [
  [/^(SyntaxError|IndentationError|TabError)\b/, "NB_SYNTAX_ERROR", "syntax"],
  [/^(NameError|UnboundLocalError)\b/, "NB_NAME_ERROR", "name"],
  [/^TypeError\b/, "NB_TYPE_ERROR", "type"],
  [/^(IndexError|KeyError)\b/, "NB_INDEX_ERROR", "runtime"],
  [/^ZeroDivisionError\b/, "NB_ZERO_DIVISION", "runtime"],
  [/^ValueError\b/, "NB_VALUE_ERROR", "runtime"],
  [/^(ModuleNotFoundError|ImportError)\b/, "NB_MODULE_NOT_FOUND", "build"],
  [/^RecursionError\b/, "NB_RECURSION_ERROR", "memory"],
  [/^MemoryError\b/, "NB_MEMORY_ERROR", "memory"],
  [/^EOFError\b/, "NB_EOF_ERROR", "runtime"],
];

/** The code of an error read from a saved notebook (runs here get theirs from the server). */
function codeOf(summary: string): [string, Category] {
  for (const [pattern, code, category] of CODES) if (pattern.test(summary)) return [code, category];
  return ["NB_RUNTIME_ERROR", "runtime"];
}

function loadNotebook(key: string): Notebook {
  const stored = load<Notebook | null>(key, null);
  if (stored && Array.isArray(stored.cells) && stored.cells.length > 0) return stored;
  return { ...STARTER_NOTEBOOK, cells: STARTER_NOTEBOOK.cells.map((c) => newCell(c.type, c.source)) };
}

const maxCount = (nb: Notebook) => nb.cells.reduce((n, c) => Math.max(n, c.count ?? 0), 0);

/** Run the notebook's program and wait for the result (one streamed request); unmounting stops waiting. */
async function runToEnd(body: { languageId: string; source: string; stdin: string }, stops: Set<() => void>): Promise<Execution> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  stops.add(stop);
  try {
    return await api.runStream(body, undefined, controller.signal);
  } finally {
    stops.delete(stop);
  }
}

let logSeq = 1;

/**
 * KAIRO's Jupyter-style notebook for Python: code and Markdown cells, shared
 * variables, Out[n] values, tracebacks per cell, a terminal of its own with a
 * console, live checks while typing, and .ipynb import/export.
 *
 * Each run happens in the same sandbox as programs: running a cell replays
 * the code cells from the first one to it in a fresh interpreter
 * (infra/containers/python/notebook.py), so results never depend on hidden
 * state left over from an earlier run.
 */
export function NotebookView({ storageKey, theme, fontSize, available, saarthi, insights, onClose }: Props) {
  const toast = useToast();
  const [nb, setNb] = useState<Notebook>(() => loadNotebook(storageKey));
  const nbRef = useRef(nb);
  nbRef.current = nb;
  const counter = useRef(maxCount(nb));
  const [selected, setSelected] = useState<string>(() => nb.cells[0]?.id ?? "");
  const [editingText, setEditingText] = useState<Set<string>>(() => new Set());
  const [running, setRunning] = useState<{ ids: string[]; console: boolean } | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const [problems, setProblems] = useState<Record<string, LiveProblem[]>>({});
  const [stdin, setStdin] = useState<string>(() => load(`${storageKey}.stdin`, ""));
  const [log, setLog] = useState<LogEntry[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => load("k.nb.terminal", true));
  const [answers, setAnswers] = useState<Record<string, { state: "asking" | "done" | "error"; text: string }>>({});
  const editors = useRef(new Map<string, CellEditorHandle>());
  const stops = useRef(new Set<() => void>());
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Keep the notebook (with its outputs) and the input in this browser: a moment after
  // each change, and right away when the page is left or the notebook closed.
  useEffect(() => {
    const timer = window.setTimeout(() => save(storageKey, nb), 400);
    return () => window.clearTimeout(timer);
  }, [nb, storageKey]);
  useEffect(() => {
    const flush = () => save(storageKey, nbRef.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [storageKey]);
  useEffect(() => void save(`${storageKey}.stdin`, stdin), [stdin, storageKey]);
  useEffect(() => void save("k.nb.terminal", terminalOpen), [terminalOpen]);
  useEffect(() => () => stops.current.forEach((stop) => stop()), []);

  // ------------------------------------------------------------ live check
  const checker = useRef<CellChecker | null>(null);
  useEffect(() => {
    checker.current = new CellChecker((result) => {
      const cell = nbRef.current.cells.find((c) => c.id === result.cellId);
      if (!cell || cell.source !== result.text) return; // edited since
      setProblems((all) => ({ ...all, [result.cellId]: result.problems }));
      setNotebookSymbols(result.symbols);
    }, insights);
    return () => {
      checker.current?.dispose();
      checker.current = null;
      setNotebookSymbols([]);
    };
    // One checker for the view; the options are updated below.
  }, []);
  useEffect(() => checker.current?.setOptions(insights), [insights]);
  const checkTimers = useRef(new Map<string, number>());
  const scheduleCheck = useCallback((cellId: string, urgent = false) => {
    const timers = checkTimers.current;
    window.clearTimeout(timers.get(cellId));
    timers.set(
      cellId,
      window.setTimeout(() => {
        const cells = nbRef.current.cells;
        const index = cells.findIndex((c) => c.id === cellId);
        const cell = cells[index];
        if (!cell || cell.type !== "code") return;
        const before = cells.slice(0, index).filter((c) => c.type === "code").map((c) => c.source);
        checker.current?.check(cellId, cell.source, before, urgent);
      }, urgent ? 220 : 400),
    );
  }, []);
  // Check every code cell when the notebook opens, and when cells are added, moved or imported.
  const cellKey = nb.cells.map((c) => `${c.id}:${c.type}`).join(" ");
  useEffect(() => {
    nbRef.current.cells.forEach((c) => c.type === "code" && scheduleCheck(c.id));
  }, [cellKey, scheduleCheck]);
  useEffect(() => () => checkTimers.current.forEach((t) => window.clearTimeout(t)), []);

  // ------------------------------------------------------------ editing
  const update = useCallback((fn: (cells: Cell[]) => Cell[]) => setNb((current) => ({ ...current, cells: fn(current.cells) })), []);

  const setSource = useCallback(
    (id: string, source: string) => {
      update((cells) => cells.map((c) => (c.id === id ? { ...c, source } : c)));
      scheduleCheck(id, true);
    },
    [update, scheduleCheck],
  );

  const focusCell = useCallback((id: string, position?: "start" | "end") => {
    setSelected(id);
    // Wait for a new cell's editor to mount.
    window.setTimeout(() => {
      const editor = editors.current.get(id);
      if (editor) editor.focus(position);
      else document.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)?.focus();
      document.querySelector(`[data-cell-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 30);
  }, []);

  const insert = useCallback(
    (at: number, type: CellType = "code", source = "") => {
      const cell = newCell(type, source);
      update((cells) => [...cells.slice(0, at), cell, ...cells.slice(at)]);
      if (type === "markdown") setEditingText((s) => new Set(s).add(cell.id));
      focusCell(cell.id);
      return cell;
    },
    [update, focusCell],
  );

  const indexOf = (id: string) => nbRef.current.cells.findIndex((c) => c.id === id);

  const remove = useCallback(
    (id: string) => {
      const cells = nbRef.current.cells;
      const index = cells.findIndex((c) => c.id === id);
      if (index < 0) return;
      const removed = cells[index];
      const next = cells.length > 1 ? cells[Math.min(index + 1, cells.length - 1)] ?? cells[index - 1] : null;
      update((all) => {
        const rest = all.filter((c) => c.id !== id);
        return rest.length ? rest : [newCell()];
      });
      if (next && next.id !== id) setSelected(next.id);
      toast.show({
        tone: "info",
        title: "Cell deleted",
        action: { label: "Undo", onClick: () => update((all) => [...all.slice(0, index), removed, ...all.slice(index)]) },
      });
    },
    [update, toast],
  );

  const move = useCallback(
    (id: string, by: -1 | 1) =>
      update((cells) => {
        const i = cells.findIndex((c) => c.id === id);
        const j = i + by;
        if (i < 0 || j < 0 || j >= cells.length) return cells;
        const copy = [...cells];
        [copy[i], copy[j]] = [copy[j], copy[i]];
        return copy;
      }),
    [update],
  );

  const setType = useCallback(
    (id: string, type: CellType) => {
      update((cells) => cells.map((c) => (c.id === id ? { ...c, type, output: type === "markdown" ? null : c.output, count: type === "markdown" ? null : c.count } : c)));
      if (type === "markdown") setEditingText((s) => new Set(s).add(id));
      else scheduleCheck(id);
    },
    [update, scheduleCheck],
  );

  const duplicate = useCallback(
    (id: string) => {
      const index = indexOf(id);
      const cell = nbRef.current.cells[index];
      if (cell) insert(index + 1, cell.type, cell.source);
    },
    [insert],
  );

  // ------------------------------------------------------------ running
  const addLog = useCallback((entry: Omit<LogEntry, "id">) => setLog((all) => [...all.slice(-60), { ...entry, id: logSeq++ }]), []);

  /** Run the code cells up to `index` (plus a console line), then show the outputs. */
  const execute = useCallback(
    async (index: number, consoleLine?: string) => {
      if (runningRef.current) return;
      if (!available) {
        setBanner("The Python sandbox is not installed on this server, so notebooks cannot run yet.");
        return;
      }
      // The exact text in each cell's editor at this moment: a run started by a key
      // press right after typing must include the last keystroke, which the
      // notebook's state may not have caught up with yet.
      const ran = cellsUpTo(nbRef.current, index).map((c) => ({ id: c.id, source: editors.current.get(c.id)?.getValue() ?? c.source }));
      const sources = ran.map((r) => r.source);
      if (consoleLine !== undefined) sources.push(consoleLine);
      if (sources.length === 0) return;
      setBanner(null);
      setRunning({ ids: consoleLine !== undefined ? [] : ran.map((r) => r.id), console: consoleLine !== undefined });
      try {
        const final = await runToEnd({ languageId: "notebook", source: runSource(sources), stdin }, stops.current);
        const step = final.steps.find((s) => s.kind === "run");
        const outputs = parseRun(step?.stdout ?? "", step?.stderr ?? "");
        const truncated = !!(step?.stdoutTruncated || step?.stderrTruncated);
        if (final.state === "REJECTED" || (outputs.size === 0 && (final.state === "INTERNAL_ERROR" || final.state === "CANCELLED"))) {
          setBanner(final.error || final.summary);
          addLog({ kind: "info", title: "Run not started", lines: [{ text: final.error || final.summary, tone: "bad" }] });
          return;
        }
        // Why the sandbox stopped the run, if it did (time, memory, output limits).
        const limit = final.diagnostics.find((d) => d.code.startsWith("LIMIT_") || d.code.startsWith("RUNTIME_SIGNAL"));
        const end = { state: final.state, summary: final.summary, truncated, code: limit?.code, category: limit?.category };
        if (consoleLine !== undefined) {
          const n = sources.length;
          const own = outputs.get(n);
          const failedEarlier = [...outputs.entries()].find(([k, o]) => k < n && o.error);
          const lines: LogEntry["lines"] = [];
          if (failedEarlier) {
            lines.push({ text: `A cell above failed first (cell ${failedEarlier[0]}): ${failedEarlier[1].error!.summary}`, tone: "bad" });
          } else if (own) {
            if (own.stdout) lines.push({ text: own.stdout, tone: "out" });
            if (own.stderr) lines.push({ text: own.stderr, tone: "err" });
            if (own.result !== null) lines.push({ text: `Out[${counter.current + 1}]: ${own.result}`, tone: "result" });
            if (own.error) lines.push({ text: (own.error.traceback ? `${own.error.traceback}\n` : "") + own.error.summary, tone: "bad" });
            if (!own.error && end.state !== "SUCCEEDED" && end.state !== "RUNTIME_ERROR") lines.push({ text: final.summary, tone: "bad" });
          } else {
            lines.push({ text: final.summary, tone: "bad" });
          }
          counter.current += 1;
          addLog({ kind: "console", title: `In [${counter.current}]: ${consoleLine}`, lines: lines.length ? lines : [{ text: "(no output)", tone: "muted" }] });
          return;
        }
        // Codes and categories from the server's diagnostics, per cell.
        for (const d of final.diagnostics) {
          const m = /^Cell (\d+), line \d+: /.exec(d.message);
          const target = m ? outputs.get(Number(m[1])) : undefined;
          if (target?.error) Object.assign(target.error, { code: d.code, category: d.category });
        }
        const before = counter.current;
        counter.current = applyRun(nbRef.current, ran, outputs, end, before).counter;
        // Applied to the latest cells: text typed during the run stays, and its output is marked as edited since.
        setNb((current) => applyRun(current, ran, outputs, end, before).notebook);
        // The run's terminal log.
        const lines: LogEntry["lines"] = [];
        ran.forEach((_cell, k) => {
          const o = outputs.get(k + 1);
          if (!o) return;
          if (o.stdout) lines.push({ text: o.stdout, tone: "out" });
          if (o.stderr) lines.push({ text: o.stderr, tone: "err" });
          if (o.error) lines.push({ text: `✖ cell ${k + 1}, line ${o.error.line}: ${o.error.summary}`, tone: "bad" });
        });
        const runStep = final.steps.find((s) => s.kind === "run");
        const ms = runStep?.durationMs ?? runStep?.wallMs;
        lines.push({
          text: final.state === "SUCCEEDED" ? `✓ ${ran.length} cell${ran.length === 1 ? "" : "s"} ran${ms ? ` in ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}` : ""}` : final.summary,
          tone: final.state === "SUCCEEDED" ? "ok" : "bad",
        });
        addLog({ kind: "run", title: ran.length === 1 ? "Run cell 1" : `Run cells 1–${ran.length}`, lines });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Cannot reach the server. Check your connection and try again.";
        setBanner(message);
        addLog({ kind: "info", title: "Run failed", lines: [{ text: message, tone: "bad" }] });
      } finally {
        setRunning(null);
      }
    },
    [available, stdin, addLog],
  );

  const runCell = useCallback(
    (id: string, mode: "next" | "stay" | "insert") => {
      const cells = nbRef.current.cells;
      const index = cells.findIndex((c) => c.id === id);
      const cell = cells[index];
      if (!cell) return;
      if (cell.type === "markdown") {
        setEditingText((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      } else {
        void execute(index);
      }
      if (mode === "insert") insert(index + 1);
      else if (mode === "next") {
        const after = cells[index + 1];
        if (after) focusCell(after.id, "start");
        else insert(index + 1);
      }
    },
    [execute, insert, focusCell],
  );

  const runAll = useCallback(() => {
    const cells = nbRef.current.cells;
    let last = -1;
    cells.forEach((c, i) => c.type === "code" && (last = i));
    setEditingText(new Set());
    if (last >= 0) void execute(last);
  }, [execute]);

  const clearOutputs = useCallback(() => {
    update((cells) => cells.map((c) => ({ ...c, output: null, count: null, ranSource: undefined })));
    counter.current = 0;
    setAnswers({});
    addLog({ kind: "info", title: "Kernel restarted", lines: [{ text: "Outputs cleared. The next run starts from a fresh interpreter (every run does).", tone: "muted" }] });
  }, [update, addLog]);

  const runConsole = useCallback(
    (line: string) => {
      const cells = nbRef.current.cells;
      let last = -1;
      cells.forEach((c, i) => c.type === "code" && (last = i));
      void execute(last, line);
    },
    [execute],
  );

  // ------------------------------------------------------------ Saarthi on errors
  const askSaarthi = useCallback(async (cell: Cell) => {
    const error = cell.output?.error;
    if (!error) return;
    const cells = nbRef.current.cells;
    const index = cells.findIndex((c) => c.id === cell.id);
    // The code that produced this error (cells edited since are asked about as they ran).
    const code = cellsUpTo(nbRef.current, index)
      .map((c, i) => `# --- cell ${i + 1} ---\n${c.ranSource ?? c.source}`)
      .join("\n\n");
    setAnswers((a) => ({ ...a, [cell.id]: { state: "asking", text: "" } }));
    try {
      const answer = await api.ask({
        question: `This Jupyter notebook cell (the last one below) stops with "${error.summary}". Why, and how do I fix it?`,
        languageId: "python",
        source: code,
      });
      setAnswers((a) => ({ ...a, [cell.id]: { state: "done", text: answer.answer } }));
    } catch (e) {
      setAnswers((a) => ({ ...a, [cell.id]: { state: "error", text: e instanceof ApiError ? e.message : "Saarthi could not be reached." } }));
    }
  }, []);

  // ------------------------------------------------------------ import / export
  const exportNotebook = useCallback(() => {
    const current = nbRef.current;
    const blob = new Blob([toIpynb(current)], { type: "application/x-ipynb+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = current.name.endsWith(".ipynb") ? current.name : `${current.name}.ipynb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const importFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const previous = nbRef.current;
          const imported = fromIpynb(String(reader.result), file.name);
          setNb(imported);
          counter.current = maxCount(imported);
          setSelected(imported.cells[0].id);
          setEditingText(new Set());
          setProblems({});
          setAnswers({});
          toast.show({
            tone: "success",
            title: `Opened ${imported.name}`,
            body: `${imported.cells.length} cell${imported.cells.length === 1 ? "" : "s"}. Outputs saved in the file are shown until you run the cells here.`,
            action: { label: "Undo", onClick: () => setNb(previous) },
          });
        } catch (e) {
          toast.show({ tone: "error", title: "Could not open that file", body: e instanceof Error ? e.message : "It is not a Jupyter notebook." });
        }
      };
      reader.readAsText(file);
    },
    [toast],
  );

  // ------------------------------------------------------------ keyboard (command mode)
  const pendingDelete = useRef<{ id: string; at: number } | null>(null);
  const onCellKey = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>, cell: Cell) => {
      if (e.target !== e.currentTarget) return; // typing in the editor or a button
      const index = indexOf(cell.id);
      const cells = nbRef.current.cells;
      const key = e.key;
      if (key === "Enter" && e.shiftKey) {
        e.preventDefault();
        runCell(cell.id, "next");
      } else if (key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runCell(cell.id, "stay");
      } else if (key === "Enter") {
        e.preventDefault();
        if (cell.type === "markdown") setEditingText((s) => new Set(s).add(cell.id));
        focusCell(cell.id, "end");
      } else if (key === "ArrowUp" || key === "k") {
        e.preventDefault();
        const prev = cells[index - 1];
        if (prev) {
          setSelected(prev.id);
          document.querySelector<HTMLElement>(`[data-cell-id="${prev.id}"]`)?.focus();
        }
      } else if (key === "ArrowDown" || key === "j") {
        e.preventDefault();
        const next = cells[index + 1];
        if (next) {
          setSelected(next.id);
          document.querySelector<HTMLElement>(`[data-cell-id="${next.id}"]`)?.focus();
        }
      } else if (key === "a") {
        e.preventDefault();
        insert(index);
      } else if (key === "b") {
        e.preventDefault();
        insert(index + 1);
      } else if (key === "m") {
        e.preventDefault();
        setType(cell.id, "markdown");
      } else if (key === "y") {
        e.preventDefault();
        setType(cell.id, "code");
      } else if (key === "d") {
        e.preventDefault();
        const last = pendingDelete.current;
        if (last && last.id === cell.id && Date.now() - last.at < 800) {
          pendingDelete.current = null;
          remove(cell.id);
        } else pendingDelete.current = { id: cell.id, at: Date.now() };
      }
    },
    [runCell, focusCell, insert, setType, remove],
  );

  // ------------------------------------------------------------ render
  const editingTextRef = useRef(editingText);
  editingTextRef.current = editingText;
  const codeIndex = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    nb.cells.forEach((c) => c.type === "code" && map.set(c.id, ++n));
    return map;
  }, [nb.cells]);

  const handlers = useMemo(
    () => ({
      setSource,
      runCell,
      remove,
      move,
      setType,
      duplicate,
      onKey: onCellKey,
      select: (id: string) => setSelected(id),
      editText: (id: string) => setEditingText((s) => new Set(s).add(id)),
      escape: (id: string) => {
        setSelected(id);
        document.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)?.focus();
      },
      edge: (id: string, direction: -1 | 1) => {
        const cells = nbRef.current.cells;
        const target = cells[indexOf(id) + direction];
        if (!target) return;
        if (target.type === "markdown" && !editingTextRef.current.has(target.id)) {
          setSelected(target.id);
          document.querySelector<HTMLElement>(`[data-cell-id="${target.id}"]`)?.focus();
        } else focusCell(target.id, direction === 1 ? "start" : "end");
      },
      register: (id: string, handle: CellEditorHandle | null) => {
        if (handle) editors.current.set(id, handle);
        else editors.current.delete(id);
      },
      ask: (cell: Cell) => void askSaarthi(cell),
      applyFix: (id: string, problem: LiveProblem) => problem.fix && editors.current.get(id)?.applyEdits(problem.fix.edits),
    }),
    [setSource, runCell, remove, move, setType, duplicate, onCellKey, focusCell, askSaarthi],
  );

  const codeCount = codeIndex.size;
  const runningIds = useMemo(() => new Set(running?.ids ?? []), [running]);

  const cellsPane = (
    <section className="k-panel flex h-full min-h-0 flex-col" aria-label="Notebook cells">
      <header className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-raised px-2 py-1.5">
        <NotebookPen size={15} className="ml-1 text-brand-fg" aria-hidden />
        <input
          value={nb.name}
          onChange={(e) => setNb((current) => ({ ...current, name: e.target.value }))}
          onBlur={(e) => !e.target.value.trim() && setNb((current) => ({ ...current, name: "Untitled.ipynb" }))}
          aria-label="Notebook name"
          data-testid="nb-name"
          className="w-44 min-w-0 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs font-semibold text-fg hover:border-line focus:border-brand focus:outline-none"
        />
        <Badge className="bg-fg/6 text-muted" title="Each run starts a fresh Python 3.12 in the sandbox and replays the code cells from the top">
          Python 3.12 · sandbox
        </Badge>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Button size="sm" variant="primary" onClick={runAll} disabled={!!running || codeCount === 0} data-testid="nb-run-all" title="Run all cells">
          <FastForward size={13} /> Run all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => insert(indexOf(selected) + 1 || nbRef.current.cells.length)} data-testid="nb-add-code" title="Add a code cell below (B)">
          <Plus size={13} /> Code
        </Button>
        <Button size="sm" variant="ghost" onClick={() => insert(indexOf(selected) + 1 || nbRef.current.cells.length, "markdown")} data-testid="nb-add-text" title="Add a text (Markdown) cell below">
          <Plus size={13} /> Text
        </Button>
        <Button size="sm" variant="ghost" onClick={clearOutputs} disabled={!!running} data-testid="nb-restart" title="Restart: clear every output and the In [n] numbers">
          <Eraser size={13} /> Clear outputs
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} data-testid="nb-import" title="Open a Jupyter notebook (.ipynb)">
            <Upload size={13} /> Open .ipynb
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".ipynb,application/json,application/x-ipynb+json"
            className="hidden"
            data-testid="nb-import-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" onClick={exportNotebook} data-testid="nb-export" title="Download as a Jupyter notebook (.ipynb): opens in Jupyter, VS Code and Colab">
            <Download size={13} /> .ipynb
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTerminalOpen((o) => !o)}
            aria-pressed={terminalOpen}
            data-testid="nb-terminal-toggle"
            title="The notebook's terminal: run log, input and a Python console"
          >
            <SquareTerminal size={13} /> Terminal
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="nb-close" title="Back to the code editor" aria-label="Close the notebook">
            <X size={14} />
          </Button>
        </span>
      </header>
      {banner && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-fg" role="alert" data-testid="nb-banner">
          <span className="min-w-0 flex-1">{banner}</span>
          <button type="button" className="text-muted hover:text-fg" onClick={() => setBanner(null)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4" data-testid="nb-cells">
        <ol className="mx-auto flex max-w-5xl flex-col gap-2.5">
          {nb.cells.map((cell) => (
            <CellRow
              key={cell.id}
              cell={cell}
              number={codeIndex.get(cell.id) ?? null}
              selected={cell.id === selected}
              editingText={editingText.has(cell.id)}
              state={runningIds.has(cell.id) ? "running" : "idle"}
              busy={!!running}
              problems={problems[cell.id] ?? EMPTY}
              theme={theme}
              fontSize={fontSize}
              saarthi={saarthi}
              answer={answers[cell.id] ?? null}
              h={handlers}
            />
          ))}
        </ol>
        <div className="mx-auto mt-3 flex max-w-5xl items-center justify-center gap-2 pb-6">
          <Button size="sm" variant="secondary" onClick={() => insert(nbRef.current.cells.length)} data-testid="nb-add-code-end">
            <Code2 size={13} /> Add code
          </Button>
          <Button size="sm" variant="secondary" onClick={() => insert(nbRef.current.cells.length, "markdown")} data-testid="nb-add-text-end">
            <Type size={13} /> Add text
          </Button>
        </div>
        <p className="mx-auto max-w-5xl pb-2 text-center text-[11px] text-faint">
          <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> run and go to the next cell · <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> run · <Kbd>Alt</Kbd>+<Kbd>Enter</Kbd> run and insert ·{" "}
          <Kbd>Esc</Kbd> then <Kbd>A</Kbd>/<Kbd>B</Kbd> add above/below, <Kbd>M</Kbd>/<Kbd>Y</Kbd> text/code, <Kbd>D</Kbd> <Kbd>D</Kbd> delete
        </p>
      </div>
    </section>
  );

  const terminal = (
    <NotebookTerminal
      log={log}
      busy={!!running}
      stdin={stdin}
      onStdin={setStdin}
      onConsole={runConsole}
      onClear={() => setLog([])}
      onClose={() => setTerminalOpen(false)}
    />
  );

  return (
    <div className="h-full min-h-0" data-testid="notebook" data-notebook data-running={running ? "true" : "false"}>
      {terminalOpen ? (
        <SplitPane orientation="vertical" storageKey="k.split.notebook" initial={0.68} min={0.3} max={0.88} label="Resize the notebook terminal" first={cellsPane} second={terminal} />
      ) : (
        cellsPane
      )}
    </div>
  );
}

const EMPTY: LiveProblem[] = [];

interface Handlers {
  setSource(id: string, source: string): void;
  runCell(id: string, mode: "next" | "stay" | "insert"): void;
  remove(id: string): void;
  move(id: string, by: -1 | 1): void;
  setType(id: string, type: CellType): void;
  duplicate(id: string): void;
  onKey(e: ReactKeyboardEvent<HTMLElement>, cell: Cell): void;
  select(id: string): void;
  editText(id: string): void;
  escape(id: string): void;
  edge(id: string, direction: -1 | 1): void;
  register(id: string, handle: CellEditorHandle | null): void;
  ask(cell: Cell): void;
  applyFix(id: string, problem: LiveProblem): void;
}

interface RowProps {
  cell: Cell;
  /** Position among the code cells (1-based), null for text cells. */
  number: number | null;
  selected: boolean;
  editingText: boolean;
  state: "idle" | "running";
  busy: boolean;
  problems: LiveProblem[];
  theme: Theme;
  fontSize: number;
  saarthi: boolean;
  answer: { state: "asking" | "done" | "error"; text: string } | null;
  h: Handlers;
}

const CellRow = memo(function CellRow({ cell, number, selected, editingText, state, busy, problems, theme, fontSize, saarthi, answer, h }: RowProps) {
  const code = cell.type === "code";
  const prompt = !code ? "" : state === "running" ? "[*]" : cell.count !== null ? `[${cell.count}]` : "[ ]";
  const stale = code && cell.output !== null && cell.ranSource !== undefined && cell.ranSource !== cell.source;
  const showEditor = code || editingText || !cell.source.trim();
  const register = useCallback((handle: CellEditorHandle | null) => h.register(cell.id, handle), [h, cell.id]);
  const firstFix = problems.find((p) => p.fix);
  return (
    <li
      className={`group relative rounded-lg border bg-surface transition-colors focus:outline-none ${
        selected ? "border-brand/55 shadow-[inset_3px_0_0_var(--cd-brand)]" : "border-line hover:border-line-strong"
      }`}
      data-testid="nb-cell"
      data-cell-id={cell.id}
      data-type={cell.type}
      data-state={state}
      data-selected={selected ? "true" : "false"}
      tabIndex={-1}
      onKeyDown={(e) => h.onKey(e, cell)}
      onMouseDown={() => h.select(cell.id)}
      aria-label={code ? `Code cell ${number}` : "Text cell"}
    >
      <div className="flex items-start gap-1.5 px-1.5 pt-1.5">
        <div className="flex w-12 shrink-0 flex-col items-end gap-1 pt-1.5">
          {code ? (
            <>
              <span className={`font-mono text-[11px] ${state === "running" ? "text-brand-fg" : "text-faint"}`} data-testid="nb-prompt">
                {prompt}
              </span>
              <button
                type="button"
                onClick={() => h.runCell(cell.id, "stay")}
                disabled={busy}
                className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors hover:bg-brand hover:text-on-brand disabled:opacity-40"
                title="Run this cell (Ctrl+Enter); the cells above run first"
                aria-label={`Run code cell ${number}`}
                data-testid="nb-run-cell"
              >
                {state === "running" ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
              </button>
            </>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint">text</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {showEditor ? (
            <div className={`overflow-hidden rounded-md border ${code ? "border-line bg-sunken" : "border-dashed border-line-strong"}`}>
              <CellEditor
                ref={register}
                cellId={cell.id}
                value={cell.source}
                language={code ? "python" : "markdown"}
                theme={theme}
                fontSize={fontSize - 1}
                problems={code ? problems : EMPTY}
                label={code ? `Code cell ${number}` : "Text cell (Markdown)"}
                onChange={(value) => h.setSource(cell.id, value)}
                onRun={(mode) => h.runCell(cell.id, mode)}
                onFocus={() => h.select(cell.id)}
                onEscape={() => h.escape(cell.id)}
                onEdge={(direction) => h.edge(cell.id, direction)}
              />
            </div>
          ) : (
            <div
              className="cursor-text rounded-md px-2 py-1"
              onDoubleClick={() => h.editText(cell.id)}
              title="Double-click to edit"
              data-testid="nb-markdown"
            >
              <Markdown text={cell.source} />
            </div>
          )}
          {code && firstFix && (
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted" data-testid="nb-live">
              <span className={`h-1.5 w-1.5 rounded-full ${firstFix.kind === "typo" ? "bg-warn" : "bg-danger"}`} aria-hidden />
              <span className="min-w-0 truncate">
                Line {firstFix.startLine}: {firstFix.message}
              </span>
              <button type="button" className="shrink-0 font-semibold text-brand-fg hover:underline" onClick={() => h.applyFix(cell.id, firstFix)} data-testid="nb-live-fix">
                {firstFix.fix!.label}
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[on=true]:opacity-100" data-on={selected}>
          <IconButton label="Move up" onClick={() => h.move(cell.id, -1)} testId="nb-move-up">
            <ChevronUp size={13} />
          </IconButton>
          <IconButton label="Move down" onClick={() => h.move(cell.id, 1)} testId="nb-move-down">
            <ChevronDown size={13} />
          </IconButton>
          <IconButton label={code ? "Make it a text cell (M)" : "Make it a code cell (Y)"} onClick={() => h.setType(cell.id, code ? "markdown" : "code")} testId="nb-toggle-type">
            {code ? <Type size={13} /> : <Code2 size={13} />}
          </IconButton>
          <IconButton label="Duplicate" onClick={() => h.duplicate(cell.id)} testId="nb-duplicate">
            <Copy size={13} />
          </IconButton>
          <IconButton label="Delete (D D)" onClick={() => h.remove(cell.id)} testId="nb-delete">
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
      {code && cell.output && <CellOutputView cell={cell} output={cell.output} stale={stale} saarthi={saarthi} answer={answer} onAsk={() => h.ask(cell)} />}
      <div className="h-1.5" />
    </li>
  );
});

function IconButton({ label, onClick, testId, children }: { label: string; onClick(): void; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      data-testid={testId}
      className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-fg/8 hover:text-fg"
    >
      {children}
    </button>
  );
}

function CellOutputView({
  cell,
  output,
  stale,
  saarthi,
  answer,
  onAsk,
}: {
  cell: Cell;
  output: CellOutput;
  stale: boolean;
  saarthi: boolean;
  answer: { state: "asking" | "done" | "error"; text: string } | null;
  onAsk(): void;
}) {
  const error = output.error;
  const note = error ? (error.code ? noteFor(error.code, (error.category ?? "runtime") as Category) : noteFor(...codeOf(error.summary))) : null;
  const empty = !output.stdout && !output.stderr && output.result === null && !error && !output.note;
  return (
    <div className="ml-[3.6rem] mr-9 mt-1.5 flex flex-col gap-1.5 text-[12.5px]" data-testid="nb-output" data-stale={stale ? "true" : "false"}>
      {stale && (
        <span className="w-fit rounded bg-warn/15 px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-warn-fg" data-testid="nb-stale">
          edited since this ran
        </span>
      )}
      {output.stdout && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg" data-testid="nb-stdout">
          {output.stdout}
        </pre>
      )}
      {output.stderr && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-warn/8 px-2 py-1 font-mono text-[12px] leading-relaxed text-warn-fg" data-testid="nb-stderr">
          {output.stderr}
        </pre>
      )}
      {output.result !== null && (
        <div className="flex items-start gap-2" data-testid="nb-result">
          <span className="shrink-0 pt-px font-mono text-[11px] text-danger-fg/80">Out[{cell.count ?? " "}]:</span>
          <pre className="min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg">{output.result}</pre>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-danger/35 bg-danger/8 px-2.5 py-2" data-testid="nb-error">
          <p className="font-mono text-[12px] font-semibold text-danger-fg" data-testid="nb-error-summary">
            {error.line > 0 && <span className="mr-1.5 font-normal text-muted">line {error.line}</span>}
            {error.summary}
          </p>
          {error.traceback && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted hover:text-fg">Traceback</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-fg/85" data-testid="nb-traceback">
                {error.traceback}
              </pre>
            </details>
          )}
          {note && (
            <div className="mt-2 border-t border-danger/20 pt-1.5 text-[12px] text-fg" data-testid="nb-note-quick">
              <p>
                <span className="mr-1 rounded bg-fg/8 px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Quick note</span>
                <span className="font-semibold">{note.title}.</span> {note.meaning}
              </p>
              <p className="mt-0.5 text-muted">{note.tip}</p>
            </div>
          )}
          {saarthi && (
            <div className="mt-2">
              {answer?.state === "done" ? (
                <div className="rounded border border-ai/35 bg-ai/8 px-2 py-1.5" data-testid="nb-saarthi-answer">
                  <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-ai-fg">Saarthi · AI, check before trusting</p>
                  <Markdown text={answer.text} />
                </div>
              ) : (
                <Button size="sm" variant="ai" onClick={onAsk} disabled={answer?.state === "asking"} data-testid="nb-ask-saarthi">
                  {answer?.state === "asking" ? <Loader2 size={12} className="animate-spin" /> : null}
                  {answer?.state === "asking" ? "Saarthi is reading the cells..." : "Ask Saarthi why"}
                </Button>
              )}
              {answer?.state === "error" && <p className="mt-1 text-[11px] text-danger-fg">{answer.text}</p>}
            </div>
          )}
        </div>
      )}
      {output.note && (
        <p className="text-[11.5px] italic text-muted" data-testid="nb-note">
          {output.note}
        </p>
      )}
      {empty && <p className="text-[11px] text-faint">(no output)</p>}
    </div>
  );
}

const TONES: Record<NonNullable<LogEntry["lines"][number]["tone"]>, string> = {
  out: "text-fg",
  err: "text-warn-fg",
  result: "text-info-fg",
  ok: "text-brand-fg",
  bad: "text-danger-fg",
  muted: "text-faint",
};

function NotebookTerminal({
  log,
  busy,
  stdin,
  onStdin,
  onConsole,
  onClear,
  onClose,
}: {
  log: LogEntry[];
  busy: boolean;
  stdin: string;
  onStdin(value: string): void;
  onConsole(line: string): void;
  onClear(): void;
  onClose(): void;
}) {
  const [line, setLine] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // A block body: newer browsers return a Promise from scrollIntoView, and an effect must
  // return nothing or a clean-up function (React calls whatever it returns on the next run).
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [log]);
  const submit = () => {
    const text = line.trim();
    if (!text || busy) return;
    onConsole(text);
    setHistory((h) => [...h.slice(-50), text]);
    setCursor(null);
    setLine("");
  };
  return (
    <section className="k-panel flex h-full min-h-0 flex-col" aria-label="Notebook terminal" data-testid="nb-terminal">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-raised px-3">
        <SquareTerminal size={13} className="text-brand-fg" aria-hidden />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Notebook terminal</span>
        {busy && <Loader2 size={12} className="animate-spin text-brand-fg" aria-label="Running" />}
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onClear} data-testid="nb-terminal-clear" title="Clear the terminal">
            <Eraser size={12} /> Clear
          </Button>
          <button type="button" className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-fg/8 hover:text-fg" onClick={onClose} aria-label="Hide the terminal">
            <X size={13} />
          </button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto bg-sunken px-3 py-2 font-mono text-[12px] leading-relaxed" data-testid="nb-log" aria-live="polite">
          {log.length === 0 && (
            <p className="text-faint">
              Runs show their output here. Type Python below to try something with the notebook's variables: it runs after all the cells.
            </p>
          )}
          {log.map((entry) => (
            <div key={entry.id} className="mb-2" data-testid="nb-log-entry" data-kind={entry.kind}>
              <p className={entry.kind === "console" ? "text-brand-fg" : "text-muted"}>{entry.kind === "console" ? entry.title : `$ ${entry.title}`}</p>
              {entry.lines.map((l, i) => (
                <pre key={i} className={`whitespace-pre-wrap break-words ${TONES[l.tone ?? "out"]}`}>
                  {l.text}
                </pre>
              ))}
            </div>
          ))}
          <div ref={end} />
        </div>
        <label className="hidden w-56 shrink-0 flex-col gap-1 border-l border-line p-2 md:flex">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-faint">Input for input()</span>
          <textarea
            value={stdin}
            onChange={(e) => onStdin(e.target.value)}
            placeholder={"One line per input() call\ne.g. Asha"}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded border border-line bg-surface p-1.5 font-mono text-[12px] text-fg focus:border-brand focus:outline-none"
            data-testid="nb-stdin"
          />
        </label>
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="font-mono text-[12px] text-brand-fg" aria-hidden>
          &gt;&gt;&gt;
        </span>
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
              setCursor(next);
              setLine(history[next]);
            } else if (e.key === "ArrowDown" && cursor !== null) {
              e.preventDefault();
              const next = cursor + 1;
              if (next >= history.length) {
                setCursor(null);
                setLine("");
              } else {
                setCursor(next);
                setLine(history[next]);
              }
            }
          }}
          placeholder="Python, with the notebook's variables (e.g. sum(marks))"
          spellCheck={false}
          aria-label="Python console"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-fg placeholder:text-faint focus:outline-none"
          data-testid="nb-console-input"
        />
        <Button size="sm" variant="secondary" type="submit" disabled={busy || !line.trim()} data-testid="nb-console-run">
          <Play size={12} /> Run
        </Button>
      </form>
    </section>
  );
}
