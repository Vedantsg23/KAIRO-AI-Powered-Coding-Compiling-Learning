import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, FileCode2, Loader2, WifiOff, X, Zap } from "lucide-react";
import { createContext, lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ApiError, api } from "./api/client";
import type { Execution, Language, RawOutputReference } from "./api/types";
import { SaarthiPanel, type LiveFixResult } from "./assistant/SaarthiPanel";
import { LoginPage } from "./auth/LoginPage";
import { useAuth } from "./auth/useAuth";
import { BootSequence, bootedThisSession } from "./boot/BootSequence";
import { CelebrateProvider, useCelebrate } from "./cosmos/Celebrate";
import { useMood, useMotion } from "./cosmos/mood";
import { useSaarthi } from "./assistant/useSaarthi";
import { ProblemsPanel } from "./diagnostics/ProblemsPanel";
import type { CodeEditorHandle } from "./editor/CodeEditor";
import { setEmmet } from "./editor/emmet";
import { formatCode, formatterFor } from "./editor/format";
import { diagnosticsToMarkers, liveProblemsToMarkers } from "./editor/markers";
import { OutputPanel, type OutputTab } from "./execution/OutputPanel";
import { formatMs } from "./execution/pipeline";
import { RunPipeline } from "./execution/RunPipeline";
import { useExecution } from "./execution/useExecution";
import { FxContext, useFinePointer } from "./fx/context";
import { StarFlight } from "./fx/Curtain";
import { MagneticField } from "./fx/MagneticField";
import { Spot, useSpotlight } from "./fx/pointer";
import { play, useSound } from "./fx/sound";
import { Scramble } from "./fx/text";
import { LanguageBadge, offeredLanguages, toolchainLabel } from "./layout/LanguagePicker";
import { KairoMark, SaarthiMark } from "./layout/Logo";
import { ShortcutsDialog } from "./layout/ShortcutsDialog";
import { healthView, StatusBar } from "./layout/StatusBar";
import { TopBar } from "./layout/TopBar";
import { loadLayout, saveLayout, Workbench, type WorkbenchLayout } from "./layout/Workbench";
import { applyTextEdits } from "./lib/edits";
import { sourceHash } from "./lib/hash";
import { useHealth, useMediaQuery, useTheme, type Theme } from "./lib/hooks";
import { load, migrateLegacyKeys, save } from "./lib/storage";
import type { LiveProblem } from "./live/analyze";
import { LIVE_LANGUAGES } from "./live/support";
import { useLiveCheck, type LiveState } from "./live/useLiveCheck";
import { ExampleGallery } from "./onboarding/ExampleGallery";
import { examplesFor, starterFor, type Example } from "./onboarding/examples";
import { Tour } from "./onboarding/Tour";
import { TOUR_STEPS } from "./onboarding/tourSteps";
import { WelcomeDialog } from "./onboarding/WelcomeDialog";
import { Companion, useCompanion, type BubbleTone } from "./mascot/Companion";
import { applyEvent, currentDayStreak, levelFor, loadProgress, saveProgress, type BadgeDef, type ProgressEvent } from "./profile/achievements";
import { BadgeToast } from "./profile/BadgeToast";
import { ProfileCard } from "./profile/ProfileCard";
import { AVATARS, cleanName, EXPERIENCE, type Profile } from "./profile/profile";
import { Badge, Dot } from "./ui/primitives";
import { SplitPane } from "./ui/SplitPane";
import { useToast } from "./ui/Toast";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { CommandPalette } from "./workspace/CommandPalette";
import { buildCommands } from "./workspace/commands";
import { Explorer } from "./workspace/Explorer";
import { ActivityRail, type SideView } from "./workspace/ActivityRail";
import { ExtensionsView } from "./extensions/ExtensionsView";
import { EXTENSIONS, useExtensions } from "./extensions/registry";
import { focusProblem, mergeLiveProblems, serviceProblems } from "./live/merge";
import type { EditorOptions, ServiceMarker } from "./editor/CodeEditor";
import { isBrowserLanguage, withBrowserLanguages } from "./preview/languages";
import { PreviewPanel } from "./preview/PreviewPanel";
import { setCompleter } from "./editor/intellisense/completer";
import { SaarthiHelloProvider, useSaarthiHello } from "./mascot/SaarthiHello";
import { doneWelcome, markWelcome, welcomeDue } from "./auth/welcome";
import { NewPasswordDialog } from "./auth/NewPasswordDialog";
import { CloudMirror, forgetAccount, hydrate, keysFor, recordRun, saveProfileRow, type SyncStatus } from "./cloud/sync";

migrateLegacyKeys();

// Monaco is large: load it in its own chunk so the page (and the welcome
// screen) appears immediately while the editor downloads.
const CodeEditor = lazy(() => import("./editor/CodeEditor").then((m) => ({ default: m.CodeEditor })));
const NotebookView = lazy(() => import("./notebook/NotebookView").then((m) => ({ default: m.NotebookView })));

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 font-mono text-xs uppercase tracking-wider text-muted">
      <Loader2 size={16} className="animate-spin text-brand-fg" /> Loading the editor...
    </div>
  );
}

/** Earlier versions stored one input for all languages; now each language has its own. */
function loadInputs(key: string): Record<string, string> {
  const stored = load<unknown>(key, {});
  if (typeof stored === "string") return { c: stored };
  return stored && typeof stored === "object" ? (stored as Record<string, string>) : {};
}

/** Where a profile's drafts and inputs live in this browser (an account's are mirrored to the cloud). */
function storageKeys(profile: Profile) {
  return profile.kind === "account" ? keysFor(profile.id) : { drafts: "cd.drafts", stdin: "cd.stdin" };
}

/** A signed-in account's cloud saves, as the workspace sees them. */
interface CloudControls {
  status: SyncStatus;
  flush(): Promise<void>;
}

/** One empty list for "no live problems", so the markers do not change identity on every keystroke. */
const NO_PROBLEMS: LiveProblem[] = [];

/** The element that carries the app's mood (data-mood) for the background and the aura. */
const ShellContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

interface WorkspaceProps {
  profile: Profile;
  /** Present for signed-in accounts: their work is saved to the cloud. */
  cloud: CloudControls | null;
  /** An account changed its name, emblem or level of experience. */
  onSaveProfile?(profile: Profile): void;
  onSignOut(): void;
  motion: boolean;
  onToggleMotion(): void;
  theme: Theme;
  onToggleTheme(): void;
}

// Saarthi greets each profile once per page load.
const greeted = new Set<string>();

function Workspace({ profile, cloud, onSignOut, motion, onToggleMotion, theme, onToggleTheme }: WorkspaceProps) {
  const toast = useToast();
  const wide = useMediaQuery("(min-width: 1024px)");
  const roomy = useMediaQuery("(min-width: 1280px)");
  const health = useHealth();
  const editor = useRef<CodeEditorHandle>(null);
  const saarthi = useSaarthi();

  // ------------------------------------------------------------ languages
  const [languages, setLanguages] = useState<Language[] | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [languageId, setLanguageId] = useState<string>(() => load("cd.language", "c"));
  useEffect(() => {
    api
      .languages()
      .then((list) => {
        setLanguages(list);
        setApiDown(false);
      })
      .catch(() => setApiDown(true));
  }, [health.kind, health.kind === "up" ? JSON.stringify(health.health.runner.images ?? {}) : ""]);
  // The server's languages that can run, plus HTML, CSS and React, which run in
  // the browser's preview (so they work even when the server is unreachable).
  const serverOffered = useMemo(() => offeredLanguages(languages ?? []), [languages]);
  const offered = useMemo(() => withBrowserLanguages(serverOffered), [serverOffered]);
  const language = offered.find((l) => l.id === languageId) ?? serverOffered[0] ?? null;
  const activeId = language?.id ?? languageId;
  const fileName = language?.sourceFile ?? "main.c";
  useEffect(() => void save("cd.language", activeId), [activeId]);
  // Languages opened in this session show up in the explorer next to saved drafts.
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => setOpened((all) => (all.includes(activeId) ? all : [...all, activeId])), [activeId]);

  // ------------------------------------------------- source, input, drafts
  const keys = storageKeys(profile);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => load(keys.drafts, {}));
  const source = drafts[activeId] ?? starterFor(activeId);
  const [inputs, setInputs] = useState<Record<string, string>>(() => loadInputs(keys.stdin));
  const stdin = inputs[activeId] ?? "";
  const setStdin = useCallback((value: string) => setInputs((all) => ({ ...all, [activeId]: value })), [activeId]);
  const [draftSaved, setDraftSaved] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const editedAt = useRef(0);

  const setSource = useCallback(
    (value: string) => {
      editedAt.current = performance.now();
      setDrafts((all) => (all[activeId] === value ? all : { ...all, [activeId]: value }));
    },
    [activeId],
  );
  // While the user types, the editor owns its text and reports it through
  // setSource. replaceSource is for deliberate replacements (an example, a
  // Saarthi fix or its undo): only those bump the revision that tells the
  // editor to take the new text, so a render that lags behind fast typing can
  // never put an older text back into the editor.
  const [revision, setRevision] = useState(0);
  const replaceSource = useCallback(
    (value: string) => {
      setSource(value);
      setRevision((r) => r + 1);
    },
    [setSource],
  );
  useEffect(() => {
    setDraftSaved(false);
    const timer = setTimeout(() => setDraftSaved(save(keys.drafts, drafts)), 700);
    return () => clearTimeout(timer);
  }, [drafts]);
  // Ctrl+S saves the draft right away (drafts also save themselves as you
  // type). The text comes from the editor itself: while typing fast, React
  // state can be a few keystrokes behind it.
  const draftsRef = useRef({ drafts, activeId });
  draftsRef.current = { drafts, activeId };
  const saveDraftNow = useCallback(() => {
    const { drafts: all, activeId: id } = draftsRef.current;
    const text = editor.current?.getValue();
    setDraftSaved(save(keys.drafts, text == null ? all : { ...all, [id]: text }));
    void cloud?.flush();
  }, [keys.drafts, cloud]);
  useEffect(() => {
    const timer = setTimeout(() => save(keys.stdin, inputs), 500);
    return () => clearTimeout(timer);
  }, [inputs]);

  // ---------------------------------------------------------- execution
  const { execution: latest, busy, run } = useExecution();
  const [lastRuns, setLastRuns] = useState<Record<string, Execution>>({});
  useEffect(() => {
    if (latest) setLastRuns((all) => (all[latest.languageId] === latest ? all : { ...all, [latest.languageId]: latest }));
  }, [latest]);
  // Only this language's latest run is shown; switching back brings it back.
  const execution = latest?.languageId === activeId ? latest : (lastRuns[activeId] ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deckTab, setDeckTab] = useState<OutputTab>("output");
  const [previewRun, setPreviewRun] = useState(0);
  const browserLanguage = isBrowserLanguage(activeId);
  const [mobileTab, setMobileTab] = useState<string>("problems");
  // Desktop panels: the explorer (open by default on large screens) and Saarthi's dock.
  const [explorerPref, setExplorerPref] = useState<boolean | null>(() => load<boolean | null>("k.explorer", null));
  const explorerOpen = wide && (explorerPref ?? roomy);
  const toggleExplorer = useCallback(() => {
    const next = !(explorerPref ?? roomy);
    setExplorerPref(next);
    save("k.explorer", next);
  }, [explorerPref, roomy]);
  const [sideView, setSideView] = useState<SideView>(() => load<SideView>("k.sideView", "explorer"));
  useEffect(() => void save("k.sideView", sideView), [sideView]);
  // The rail: pick a view; clicking the open one hides the side panel.
  const selectSideView = useCallback(
    (view: SideView) => {
      if (explorerOpen && view === sideView) {
        toggleExplorer();
        return;
      }
      setSideView(view);
      if (!explorerOpen) {
        setExplorerPref(true);
        save("k.explorer", true);
      }
    },
    [explorerOpen, sideView, toggleExplorer],
  );
  const [dockOpen, setDockOpen] = useState<boolean>(() => load("k.dock", true));
  useEffect(() => void save("k.dock", dockOpen), [dockOpen]);
  // The panel under the editor (terminal and problems), as in VS Code: drag its edge to resize it,
  // maximize it, or hide it with Ctrl+` (it comes back by itself when you press Run).
  const [panelOpen, setPanelOpen] = useState<boolean>(() => load("k.panel.open", true));
  useEffect(() => void save("k.panel.open", panelOpen), [panelOpen]);
  const [panelMax, setPanelMax] = useState(false);
  const togglePanel = useCallback(() => {
    setPanelMax(false);
    setPanelOpen((open) => !open);
  }, []);
  const toggleMaximize = useCallback(() => {
    setPanelOpen(true);
    setPanelMax((max) => !max);
  }, []);
  const [layout, setLayout] = useState<WorkbenchLayout>(loadLayout);
  const changeLayout = useCallback((next: WorkbenchLayout) => {
    setLayout(next);
    saveLayout(next);
  }, []);
  // The Python notebook takes the editor's place while it is open.
  const [notebookOpen, setNotebookOpen] = useState<boolean>(() => load("k.notebook.open", false));
  useEffect(() => void save("k.notebook.open", notebookOpen), [notebookOpen]);
  const toggleNotebook = useCallback(() => setNotebookOpen((o) => !o), []);
  const [highlight, setHighlight] = useState<RawOutputReference | null>(null);

  // Results are "current" only while the editor text hashes to the same
  // value as the snapshot that was run. Until the hash of the latest text is
  // known, results are treated as stale.
  const [hashed, setHashed] = useState<{ text: string; hash: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const hash = await sourceHash(source);
      if (!cancelled) setHashed({ text: source, hash });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);
  const currentHash = hashed?.text === source ? hashed.hash : null;
  const stale = execution !== null && currentHash !== execution.sourceHash;

  const markers = useMemo(
    () =>
      execution && !stale && language
        ? diagnosticsToMarkers(execution.diagnostics, language.sourceFile, language.toolchain.name)
        : [],
    [execution, stale, language],
  );

  // ------------------------------------------------------------ extensions
  const extensions = useExtensions();
  const ext = extensions.enabled;
  const pack = extensions.packFor(activeId);
  const editorOptions = useMemo<EditorOptions>(
    () => ({
      minimap: ext("minimap"),
      wordWrap: ext("word-wrap"),
      stickyScroll: ext("sticky-scroll"),
      bracketColors: ext("bracket-colors"),
      ligatures: true,
      fontSize: extensions.fontSize,
      intellisense: pack ? ext(pack.id) : true,
      snippets: pack ? ext(pack.id) : true,
      editorTheme: ext("theme-midnight")
        ? "kairo-midnight"
        : ext("theme-paper")
          ? "kairo-paper"
          : ext("theme-contrast")
            ? theme === "dark"
              ? "hc-black"
              : "hc-light"
            : "",
      whitespace: ext("whitespace"),
    }),
    [ext, pack, extensions.fontSize, theme],
  );
  const insightOptions = useMemo(() => ({ typos: ext("typo-guard"), tips: ext("saarthi-tips") }), [ext]);

  // Emmet: HTML and CSS abbreviations, and JSX ones while React is open.
  const emmetOn = ext("emmet");
  useEffect(() => setEmmet({ html: emmetOn && activeId === "html", css: emmetOn && activeId === "css", jsx: emmetOn && activeId === "react" }), [emmetOn, activeId]);

  // Format document (Shift+Alt+F, the palette, Format on Save): Prettier in the
  // browser, or clang-format / Black / gofmt / shfmt in the sandbox.
  const formatOptions = useMemo(() => ({ prettier: ext("prettier"), sandbox: ext("sandbox-format") }), [ext]);
  const formatting = useRef(false);
  const formatNow = useCallback(async (): Promise<void> => {
    if (formatting.current) return;
    const id = activeId;
    const before = editor.current?.getValue() ?? source;
    const tool = formatterFor(id, formatOptions);
    if (!tool) {
      // Monaco formats JSON-like web languages itself; otherwise say how to get a formatter.
      if (id === "javascript" || id === "typescript" || id === "react" || id === "html" || id === "css") {
        editor.current?.trigger("editor.action.formatDocument");
        return;
      }
      toast.show({ tone: "info", title: `No formatter for ${language?.displayName ?? id} yet`, body: "Prettier and the Sandbox Formatters (Extensions) cover JavaScript, TypeScript, React, HTML, CSS, C, C++, Java, C#, Python, Go and Bash." });
      return;
    }
    formatting.current = true;
    try {
      const result = await formatCode(id, before, formatOptions);
      if (!result) return;
      if (!result.ok) {
        toast.show({ tone: "error", title: `${result.tool} could not format this code`, body: result.message });
        return;
      }
      // Only apply to the text that was formatted (the student may have typed meanwhile).
      if (draftsRef.current.activeId !== id || (editor.current?.getValue() ?? before) !== before) {
        toast.show({ tone: "info", title: "Not formatted", body: "The code changed while it was being formatted. Press Shift+Alt+F again." });
        return;
      }
      if (result.text === before) {
        toast.show({ tone: "success", title: `Already formatted (${result.tool})` }, 2500);
        return;
      }
      editor.current?.replaceAll(result.text);
      toast.show({ tone: "success", title: `Formatted with ${result.tool}`, body: "Ctrl+Z undoes it." }, 3000);
    } finally {
      formatting.current = false;
    }
  }, [activeId, source, formatOptions, language, toast]);
  const formatOnSave = ext("format-on-save");
  const saveNow = useCallback(() => {
    if (formatOnSave && formatterFor(draftsRef.current.activeId, formatOptions)) void formatNow().then(saveDraftNow);
    else saveDraftNow();
  }, [formatOnSave, formatOptions, formatNow, saveDraftNow]);

  // ------------------------------------------------------ live syntax check
  const live = useLiveCheck(activeId, source, editedAt, cursor, insightOptions);
  const syntaxProblems = live.text === source ? live.problems : NO_PROBLEMS;
  const insights = live.insights && live.insights.text === source ? live.insights : null;
  // Syntax errors, typos (Typo Guard) and tips (Saarthi Tips), for the current text only.
  // TypeScript/HTML/CSS language services report through the editor (JavaScript, TypeScript, React, HTML, CSS).
  const [serviceMarkers, setServiceMarkers] = useState<ServiceMarker[]>([]);
  useEffect(() => setServiceMarkers([]), [activeId]);
  const fromServices = useMemo(() => serviceProblems(serviceMarkers, syntaxProblems), [serviceMarkers, syntaxProblems]);
  const liveProblems = useMemo(
    () => mergeLiveProblems(syntaxProblems, [...(insights?.typos ?? NO_PROBLEMS), ...fromServices], insights?.tips ?? NO_PROBLEMS),
    [syntaxProblems, insights, fromServices],
  );
  // Language-service problems already have their own squiggles.
  const liveMarkers = useMemo(() => liveProblemsToMarkers(liveProblems.filter((p) => p.origin !== "service")), [liveProblems]);
  const liveCounts = useMemo(() => {
    let errors = 0;
    let typos = 0;
    let tips = 0;
    let checker = 0;
    for (const p of liveProblems) {
      if (p.kind === "tip") tips++;
      else if (p.kind === "typo") typos++;
      else if (p.origin === "service") checker++;
      else errors++;
    }
    return { errors, typos, tips, checker };
  }, [liveProblems]);
  // The live problem Saarthi looks at: the most important one on the cursor's line, or overall.
  const liveFocus = focusProblem(liveProblems, cursor.line);
  const errorLens = useMemo(
    () =>
      ext("error-lens")
        ? [...markers, ...liveMarkers].map((m) => ({ line: m.startLineNumber, text: m.message, severity: m.severity }))
        : undefined,
    [ext, markers, liveMarkers],
  );
  const complexity = useMemo(
    () =>
      ext("complexity-lens") && insights
        ? insights.metrics.functions
            .filter((f) => f.estimate !== "O(1)")
            .map((f) => ({ line: f.line, text: `≈ ${f.estimate} · ${f.reason} · estimate` }))
        : undefined,
    [ext, insights],
  );

  // ---------------------------------------------------------------- runs
  const inputUsed = useRef(new Map<string, boolean>());
  const startRun = useCallback(
    async (text: string, input: string) => {
      if (!language || busy) return null;
      setPanelOpen(true);
      if (isBrowserLanguage(language.id)) {
        // HTML, CSS and React: Run refreshes the preview in the browser.
        setPreviewRun((n) => n + 1);
        setMobileTab("preview");
        return null;
      }
      setSelectedId(null);
      setHighlight(null);
      setDeckTab((tab) => (tab === "input" ? "output" : tab));
      try {
        const accepted = await run(language.id, text, input);
        if (accepted) inputUsed.current.set(accepted.id, input.trim() !== "");
        return accepted;
      } catch (error) {
        const e = error instanceof ApiError ? error : new ApiError(String(error), -1);
        if (e.status === 503) {
          toast.show({ tone: "error", title: "The sandbox is busy", body: `Too many programs are waiting. Try again in ${e.retryAfterS ?? 2} s.` });
        } else if (e.status === 409) {
          toast.show({ tone: "error", title: "Language not available", body: e.message });
        } else if (e.status === 413) {
          toast.show({ tone: "error", title: "Too large to run", body: e.message });
        } else if (e.status === 0) {
          toast.show({ tone: "error", title: "Server unreachable", body: e.message });
        } else {
          toast.show({ tone: "error", title: "Could not start the run", body: e.message });
        }
        return null;
      }
    },
    [language, busy, run, toast],
  );
  // Run reads the latest text through a ref, so the callback (and everything
  // memoised on it, such as the system bar) stays the same while typing. The
  // editor's own text comes first: Ctrl+Enter pressed right after a keystroke
  // must run that keystroke too, even if the state is a render behind.
  const runInput = useRef({ source, stdin });
  runInput.current = { source, stdin };
  const doRun = useCallback(() => void startRun(editor.current?.getValue() ?? runInput.current.source, runInput.current.stdin), [startRun]);

  // When a run finishes with errors, pre-select the first one.
  const finishedId = execution?.terminal ? execution.id : null;
  useEffect(() => {
    if (!finishedId || !execution) return;
    const firstError = execution.diagnostics.find((d) => d.severity === "error");
    setSelectedId(firstError?.id ?? null);
  }, [finishedId]); // only once per finished run, not on every snapshot

  const reveal = useCallback((line: number, column = 1) => editor.current?.reveal(line, column), []);
  const showRaw = useCallback(
    (ref: RawOutputReference) => {
      setHighlight(ref);
      const kind = language?.steps.find((s) => s.name === ref.step)?.kind;
      const tab = kind === "run" ? "output" : "log";
      setDeckTab(tab);
      setMobileTab(tab);
    },
    [language],
  );

  // ----------------------------------------------------------------- Saarthi
  const openSaarthi = useCallback(() => {
    setDockOpen(true);
    setMobileTab("saarthi");
  }, []);

  // AI autocomplete asks the API for ghost text (only while its extension is on).
  useEffect(() => {
    setCompleter((body, signal) => api.complete(body, signal));
    return () => setCompleter(null);
  }, []);

  // Saarthi's big hello: after signing in ("Welcome, <name>!"), and when the
  // floating Saarthi is clicked (at most once a minute, so it never gets in the way).
  const hello = useSaarthiHello();
  const companionElement = () => document.querySelector('[data-testid="companion"] .k-float-button');
  useEffect(() => {
    if (!welcomeDue()) return;
    const timer = window.setTimeout(() => {
        doneWelcome();
        hello({
          title: `Welcome, ${profile.name}!`,
          text: "Your workspace is ready. Write some code and press Run: I'll explain whatever the compiler says. I'm in the corner if you need me.",
          from: companionElement(),
          mood: "happy",
          hold: 1600,
          onDone: () => setHelloFirst(false),
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, []);
  // A new guest's onboarding dialog waits until Saarthi's big welcome is over.
  const [helloFirst, setHelloFirst] = useState(() => welcomeDue());
  useEffect(() => {
    if (!helloFirst) return;
    const timer = window.setTimeout(() => setHelloFirst(false), 8000); // in case the welcome never shows
    return () => window.clearTimeout(timer);
  }, [helloFirst]);
  const lastHello = useRef(0);
  const onCompanion = useCallback(() => {
    openSaarthi();
    if (Date.now() - lastHello.current < 60_000) return;
    lastHello.current = Date.now();
    hello({ title: "Hii!", text: "Ask me anything about your code: I'm open on the right.", from: companionElement() });
  }, [openSaarthi, hello]);
  const explain = useCallback(
    (diagnosticId: string | null) => {
      openSaarthi();
      if (!saarthi.enabled || !execution?.terminal || !currentHash || stale) return;
      if (diagnosticId) setSelectedId(diagnosticId);
      void saarthi.explain({ executionId: execution.id, sourceHash: currentHash, diagnosticId, evidence: execution.evidence });
    },
    [openSaarthi, saarthi, execution, currentHash, stale],
  );
  const suggestFix = useCallback(
    (diagnosticId: string) => {
      openSaarthi();
      if (!saarthi.enabled || !execution?.terminal || !currentHash || stale) return;
      setSelectedId(diagnosticId);
      void saarthi.suggestFix({ executionId: execution.id, sourceHash: currentHash, diagnosticId, evidence: execution.evidence });
    },
    [openSaarthi, saarthi, execution, currentHash, stale],
  );

  const pendingVerify = useRef<{ fixId: string; executionId: string } | null>(null);
  const verifyRequested = useRef(new Set<string>());
  const applyFix = useCallback(
    async (runAfter: boolean) => {
      const fix = saarthi.fix;
      if (!fix || currentHash !== fix.baseSourceHash) return;
      saarthi.markApplied(fix.fixId, source);
      replaceSource(fix.patchedSource);
      play("fix");
      if (runAfter) {
        const accepted = await startRun(fix.patchedSource, stdin);
        if (accepted) pendingVerify.current = { fixId: fix.fixId, executionId: accepted.id };
      }
    },
    [saarthi, currentHash, source, replaceSource, startRun, stdin],
  );
  // A run of exactly the patched code (either "Apply & verify" or a later
  // Run) is sent to Saarthi's verify endpoint when it finishes.
  useEffect(() => {
    const fix = saarthi.fix;
    if (!execution?.terminal || !fix || saarthi.applied?.fixId !== fix.fixId) return;
    if (saarthi.verdict?.fixId === fix.fixId && saarthi.verdict.executionId === execution.id) return;
    const expected = pendingVerify.current;
    const key = `${fix.fixId}:${execution.id}`;
    if (verifyRequested.current.has(key)) return;
    if ((expected && expected.executionId === execution.id) || execution.sourceHash === fix.patchedSourceHash) {
      pendingVerify.current = null;
      verifyRequested.current.add(key);
      void saarthi.verify(fix.fixId, execution.id, execution.evidence);
    }
  }, [execution, saarthi]);
  const undoFix = useCallback(() => {
    if (saarthi.applied) replaceSource(saarthi.applied.before);
    saarthi.dismissFix();
  }, [saarthi, replaceSource]);

  // A rule-based quick fix the student applied, until the live analyzer has re-read the code.
  const [liveFix, setLiveFix] = useState<(LiveFixResult & { appliedText: string }) | null>(null);

  // Switching language: keep drafts; Saarthi's answers belong to the old code.
  const { clearForLanguage } = saarthi;
  const changeLanguage = useCallback(
    (id: string) => {
      setLanguageId(id);
      setSelectedId(null);
      setHighlight(null);
      setLiveFix(null);
      clearForLanguage();
    },
    [clearForLanguage],
  );

  // ------------------------------------------------ live quick fixes (rule-based)
  const applyLiveFix = useCallback(
    (problem: LiveProblem, runAfter: boolean) => {
      if (!problem.fix) return;
      const next = applyTextEdits(source, problem.fix.edits);
      if (!editor.current?.applyEdits(problem.fix.edits, "kairo-quick-fix")) return;
      play("fix");
      setLiveFix({ label: problem.fix.label, line: problem.startLine, status: "checking", remaining: 0, appliedText: next });
      if (runAfter) void startRun(next, stdin);
    },
    [source, startRun, stdin],
  );
  // The live analyzer re-reads the fixed text: that is the fix's first verification.
  useEffect(() => {
    if (!liveFix) return;
    if (liveFix.status === "checking") {
      if (live.status === "error") setLiveFix(null);
      else if (live.text === liveFix.appliedText && live.status === "ready") {
        setLiveFix({ ...liveFix, status: live.problems.length === 0 ? "passed" : "failed", remaining: live.problems.length });
      }
    } else if (source !== liveFix.appliedText) {
      const timer = window.setTimeout(() => setLiveFix(null), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [liveFix, live.text, live.status, live.problems, source]);

  // ------------------------------------- progress, badges and the companion
  const { burst } = useCelebrate();
  const companion = useCompanion(saarthi.pending !== null);
  const { say } = companion;
  const progressRef = useRef(loadProgress(profile.id));
  const [progress, setProgress] = useState(progressRef.current);
  const [xpPulse, setXpPulse] = useState<{ id: number; amount: number } | null>(null);
  // A light sweeps across the terminal when a run finishes: green when it passed, red when not.
  const [sweep, setSweep] = useState<{ id: string; ok: boolean } | null>(null);
  const [badgeQueue, setBadgeQueue] = useState<BadgeDef[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const level = levelFor(progress.xp);
  const dayStreak = currentDayStreak(progress);

  const record = useCallback(
    (event: ProgressEvent) => {
      const outcome = applyEvent(progressRef.current, event);
      progressRef.current = outcome.progress;
      saveProgress(profile.id, outcome.progress);
      setProgress(outcome.progress);
      if (outcome.xpGained > 0 && motion) setXpPulse({ id: Date.now(), amount: outcome.xpGained });
      if (outcome.unlocked.length > 0) {
        setBadgeQueue((queue) => [...queue, ...outcome.unlocked]);
        burst({ y: 110, count: 40, spread: 190 });
      } else if (outcome.levelUp) {
        burst({ y: 110, count: 32, spread: 170 });
      }
      return outcome;
    },
    [profile.id, motion, burst],
  );
  useEffect(() => {
    if (!xpPulse) return;
    const timer = window.setTimeout(() => setXpPulse(null), 1900);
    return () => window.clearTimeout(timer);
  }, [xpPulse]);
  useEffect(() => {
    if (badgeQueue.length === 0) return;
    const timer = window.setTimeout(() => setBadgeQueue((queue) => queue.slice(1)), 5200);
    return () => window.clearTimeout(timer);
  }, [badgeQueue]);

  // Every finished run counts once; then Saarthi reacts to it.
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    if (!latest?.terminal || recorded.current.has(latest.id)) return;
    recorded.current.add(latest.id);
    const errors = latest.diagnostics.filter((d) => d.severity === "error");
    const succeeded = latest.state === "SUCCEEDED" && errors.length === 0;
    const outcome = record({ type: "run", languageId: latest.languageId, succeeded, usedInput: inputUsed.current.get(latest.id) ?? false });
    if (cloud && latest.state !== "REJECTED") {
      const runStep = latest.steps.find((s) => s.kind === "run");
      void recordRun({ languageId: latest.languageId, state: latest.state, durationMs: runStep?.durationMs ?? runStep?.wallMs ?? null, errors: errors.length });
    }
    if (latest.state !== "REJECTED") {
      play(succeeded ? "success" : "error");
      if (motion) setSweep({ id: latest.id, ok: succeeded });
    }
    if (outcome.levelUp) {
      say(`Level up! You are now a ${outcome.levelUp.name}.`, "badge");
    } else {
      const reaction = runReaction(latest, errors, outcome.progress.cleanStreak);
      const firstError = errors[0]?.id ?? null;
      say(
        reaction.text,
        reaction.tone,
        reaction.explain && saarthi.enabled ? { label: "Explain it with Saarthi", onClick: () => explain(firstError) } : undefined,
      );
    }
  }, [latest, record, say, saarthi.enabled, explain, motion, cloud]);

  const explained = useRef(new Set<string>());
  const { react } = companion;
  useEffect(() => {
    const answer = saarthi.explanation;
    if (!answer) return;
    const key = `${answer.executionId}:${answer.focusDiagnosticId ?? ""}`;
    if (explained.current.has(key)) return;
    explained.current.add(key);
    record({ type: "explained" });
    react("explaining", 5000);
  }, [saarthi.explanation, record, react]);
  useEffect(() => {
    if (saarthi.fix) react("suggesting", 5000);
  }, [saarthi.fix, react]);

  const verified = useRef(new Set<string>());
  useEffect(() => {
    const verdict = saarthi.verdict;
    if (!verdict?.verified || verified.current.has(verdict.fixId)) return;
    verified.current.add(verdict.fixId);
    record({ type: "verified" });
    play("success");
    say("Verified by a real run: the fix works.", "success");
  }, [saarthi.verdict, record, say]);

  useEffect(() => {
    if (greeted.has(profile.id)) return;
    const timer = window.setTimeout(() => {
      greeted.add(profile.id);
      say(`Namaste, ${profile.name}! Write some code and press Run. I'm right here if you need me.`, "info");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [profile.id, profile.name, say]);

  // The mood drives the background, the editor's aura and the companion.
  const shell = useContext(ShellContext);
  const root = useRef<HTMLDivElement>(null);
  useSpotlight(useCallback(() => root.current, []));
  const { mood, typing } = useMood({ execution, stale, liveProblemCount: liveCounts.errors + liveCounts.typos + liveCounts.checker, edits: editedAt.current });
  useEffect(() => {
    if (shell?.current) shell.current.dataset.mood = mood;
  }, [mood, shell]);
  // Decorative motion holds still while the student types, so every frame
  // goes to the editor and the live check.
  useEffect(() => {
    if (shell?.current) shell.current.dataset.typing = typing ? "true" : "false";
  }, [typing, shell]);
  useEffect(
    () => () => {
      if (!shell?.current) return;
      shell.current.dataset.mood = "calm";
      shell.current.dataset.typing = "false";
    },
    [shell],
  );

  // ------------------------------------------------------- onboarding UI
  const [welcomeOpen, setWelcomeOpen] = useState(() => !load("cd.onboarded", false) && !load(`cd.welcomed.${profile.id}`, false));
  const [tourOpen, setTourOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The command palette, and where it was opened from (the editor completes Monaco's Ctrl+K chords).
  const [palette, setPalette] = useState<"editor" | "app" | null>(null);
  const openPalette = useCallback((from: "editor" | "app") => {
    play("tick");
    setPalette(from);
  }, []);
  const [sound, toggleSound] = useSound();
  const finishWelcome = useCallback(() => {
    save(`cd.welcomed.${profile.id}`, true);
    setWelcomeOpen(false);
  }, [profile.id]);

  const loadExample = useCallback(
    (example: Example, runNow: boolean) => {
      setExamplesOpen(false);
      record({ type: "example" });
      replaceSource(example.source);
      setStdin(example.stdin ?? "");
      if (runNow) {
        void startRun(example.source, example.stdin ?? "");
      } else {
        toast.show({ tone: "info", title: `Loaded "${example.title}"`, body: "Press Run when ready. Ctrl+Z in the editor restores your previous code." });
      }
    },
    [replaceSource, setStdin, startRun, toast, record],
  );

  // Global shortcuts (the editor handles its own while focused).
  const selectedDiagnostic = execution?.diagnostics.find((d) => d.id === selectedId) ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditor = !!target.closest(".monaco-editor");
      const typing = target.closest("input, textarea, select, .monaco-editor");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey) {
        // The editor and the palette handle Ctrl+K themselves (and mark it handled).
        if (inEditor || e.defaultPrevented) return;
        e.preventDefault();
        openPalette("app");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault(); // never the browser's "Save page" dialog
        if (!inEditor) saveNow();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !inEditor) {
        if (target.closest("#saarthi-question")) return; // Enter there sends the question
        if (target.closest("[data-notebook]")) return; // the notebook runs its own cells
        e.preventDefault();
        if (e.shiftKey) explain(selectedDiagnostic?.id ?? null);
        else doRun();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "e")) {
        // Ctrl+Shift+X extensions, Ctrl+Shift+E explorer (as in VS Code).
        e.preventDefault();
        selectSideView(e.key.toLowerCase() === "x" ? "extensions" : "explorer");
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`" || e.key.toLowerCase() === "j")) {
        // Ctrl+` (or Ctrl+J) shows and hides the terminal panel, as in VS Code.
        e.preventDefault();
        togglePanel();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === "KeyB" || e.key.toLowerCase() === "b") && wide) {
        // Ctrl+B: the side bar; Ctrl+Alt+B: Saarthi's panel (VS Code's secondary side bar).
        e.preventDefault();
        if (e.altKey) setDockOpen((open) => !open);
        else toggleExplorer();
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && (e.code === "KeyI" || e.key.toLowerCase() === "i")) {
        // Ctrl+Alt+I: chat with Saarthi (as Copilot Chat in VS Code).
        e.preventDefault();
        openSaarthi();
        window.setTimeout(() => document.getElementById("saarthi-question")?.focus(), 60);
      } else if (e.key === "?" && !typing) {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doRun, explain, selectedDiagnostic, saveNow, openPalette, selectSideView, togglePanel, toggleExplorer, wide, openSaarthi]);

  // -------------------------------------------------------------- layout
  const saarthiStatus: "checking" | "online" | "offline" =
    saarthi.status === null ? (health.kind === "checking" ? "checking" : "offline") : saarthi.enabled ? "online" : "offline";
  // Props of the memoised panels (system bar, explorer, terminal) stay the
  // same objects while the student types, so those panels skip re-rendering.
  const readyCount = useMemo(() => (languages ? { ready: serverOffered.length, total: languages.length } : null), [languages, serverOffered.length]);
  const inputLines = stdin ? stdin.replace(/\n$/, "").split("\n").length : 0;
  const draftKey = Object.keys(drafts).join(" ");
  const draftIds = useMemo(() => [...new Set([...(draftKey ? draftKey.split(" ") : []), ...opened])], [draftKey, opened]);
  const systemStatus = useMemo(
    () => ({ health: healthView(health), saarthi: saarthiStatus, live: live.status, languages: readyCount }),
    [health, saarthiStatus, live.status, readyCount],
  );
  const openExamples = useCallback(() => setExamplesOpen(true), []);
  const openTour = useCallback(() => setTourOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const openInput = useCallback(() => setDeckTab("input"), []);
  const openPaletteFromBar = useCallback(() => openPalette("app"), [openPalette]);
  const toggleDock = useCallback(() => setDockOpen((o) => !o), []);
  const explorerControl = useMemo(() => (wide ? { open: explorerOpen, toggle: toggleExplorer } : undefined), [wide, explorerOpen, toggleExplorer]);
  const dockControl = useMemo(() => (wide ? { open: dockOpen, toggle: toggleDock } : undefined), [wide, dockOpen, toggleDock]);
  const panelControl = useMemo(() => (wide ? { open: panelOpen, toggle: togglePanel } : undefined), [wide, panelOpen, togglePanel]);
  const notebooksOn = ext("notebooks");
  const notebookControl = useMemo(() => (notebooksOn ? { open: notebookOpen, toggle: toggleNotebook } : undefined), [notebooksOn, notebookOpen, toggleNotebook]);

  const panelActions = (
    <span className="flex shrink-0 items-center gap-0.5" data-testid="panel-actions">
      <button
        type="button"
        onClick={toggleMaximize}
        aria-label={panelMax ? "Restore the terminal size" : "Maximize the terminal"}
        title={panelMax ? "Restore panel size" : "Maximize panel size"}
        className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:bg-fg/8 hover:text-fg"
        data-testid="panel-maximize"
      >
        {panelMax ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Hide the terminal"
        title="Hide the panel (Ctrl+`)"
        className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:bg-fg/8 hover:text-fg"
        data-testid="panel-close"
      >
        <X size={14} />
      </button>
    </span>
  );
  const problemsPanel = (bare = false) => (
    <ProblemsPanel
      execution={execution}
      language={language}
      stale={stale}
      liveProblems={liveProblems}
      liveSupported={LIVE_LANGUAGES.has(activeId)}
      selectedId={selectedId}
      saarthi={saarthi.enabled}
      onSelect={setSelectedId}
      onReveal={reveal}
      onShowRaw={showRaw}
      onRun={doRun}
      onOpenExamples={() => setExamplesOpen(true)}
      onExplain={(id) => explain(id)}
      onFix={suggestFix}
      onApplyLiveFix={(problem) => applyLiveFix(problem, false)}
      bare={bare}
      actions={bare ? undefined : panelActions}
    />
  );
  const saarthiPanel = (
    <SaarthiPanel
      saarthi={saarthi}
      execution={execution}
      language={language}
      stale={stale}
      currentHash={currentHash}
      source={source}
      selectedDiagnostic={selectedDiagnostic}
      onReveal={reveal}
      onApplyFix={(runAfter) => void applyFix(runAfter)}
      onUndoFix={undoFix}
      onRun={doRun}
      concept={live.status === "unsupported" ? null : live.concept}
      liveSupported={LIVE_LANGUAGES.has(activeId)}
      liveProblem={liveFocus}
      liveCount={liveProblems.length}
      onApplyLiveFix={applyLiveFix}
      liveFixResult={liveFix}
      mood={companion.mood}
      liveProblems={liveProblems}
      metrics={insights?.metrics ?? null}
      stdin={stdin}
      onOpenInput={openInput}
    />
  );
  const errorCount = execution && !stale ? execution.diagnostics.filter((d) => d.severity === "error").length : 0;
  const problemCount = errorCount + liveCounts.errors + liveCounts.typos + liveCounts.checker;
  const problemsBadge =
    problemCount > 0 ? <span className="rounded bg-danger/15 px-1.5 font-mono text-[10px] text-danger-fg">{problemCount}</span> : undefined;

  // Panels rise in one after another when the console opens (motion on).
  const enter = (i: number) => (motion ? { className: "k-in", style: { "--i": i } as CSSProperties } : { className: "", style: undefined });

  const editorCard = (
    <section data-tour="editor" className={`k-panel k-editor-frame h-full ${enter(1).className}`} style={enter(1).style} aria-label="Code editor">
      <Spot />
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raised pr-2">
        <div className="flex h-full items-center gap-2 border-r border-line bg-surface px-3">
          <FileCode2 size={14} className="text-brand-fg" />
          <span className="font-mono text-xs font-semibold text-fg" data-testid="file-name">
            {fileName}
          </span>
          <span className={`h-1.5 w-1.5 rounded-full ${draftSaved ? "bg-line-strong" : "bg-accent"}`} title={draftSaved ? "Saved" : "Saving"} aria-hidden />
        </div>
        {stale && execution?.terminal && (
          <Badge className="bg-warn/15 text-warn-fg" title="The results below are from an earlier version of this code">
            edited since last run
          </Badge>
        )}
        <span className="ml-auto flex min-w-0 items-center gap-2 truncate text-[11px] text-faint">
          {language && <LanguageBadge id={language.id} />}
          <span className="hidden truncate font-mono sm:inline">{language ? toolchainLabel(language) : ""}</span>
          <span className="k-index hidden pl-1 md:inline">02</span>
          <Scramble text="Editor" className="k-label max-md:hidden" />
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <ErrorBoundary
          fallback={(error, retry) => (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-muted" role="alert" data-testid="editor-failed">
              <div>
                <p className="font-semibold text-fg">The editor could not load.</p>
                <p className="mt-1 text-xs">{error.message}</p>
                <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-md border border-line px-3 py-1 text-xs text-fg hover:bg-fg/5">
                  Reload
                </button>
                <button type="button" onClick={retry} className="ml-2 mt-3 rounded-md border border-line px-3 py-1 text-xs text-fg hover:bg-fg/5">
                  Try again
                </button>
              </div>
            </div>
          )}
        >
        <Suspense fallback={<EditorLoading />}>
          <CodeEditor
            ref={editor}
            value={source}
            revision={`${activeId}:${revision}`}
            language={language?.editorMode ?? "c"}
            languageId={activeId}
            symbols={insights?.symbols}
            problems={liveProblems}
            options={editorOptions}
            lens={errorLens}
            todoHighlight={ext("todo-highlight")}
            complexity={complexity}
            onServiceMarkers={setServiceMarkers}
            aiComplete={ext("ai-autocomplete") && saarthi.enabled}
            vim={ext("vim")}
            onFormat={() => void formatNow()}
            theme={theme}
            markers={markers}
            liveMarkers={liveMarkers}
            fileName={fileName}
            minimap={wide}
            onChange={setSource}
            onCursorChange={(line, column) => setCursor({ line, column })}
            onRun={doRun}
            onExplain={() => explain(selectedDiagnostic?.id ?? null)}
            onSave={saveNow}
            onPalette={() => openPalette("editor")}
          />
        </Suspense>
        </ErrorBoundary>
        <Companion api={companion} size={wide ? 76 : 58} onClick={onCompanion} />
      </div>
      <AnalyzerStrip
        live={live}
        liveCount={liveCounts.errors}
        typoCount={liveCounts.typos}
        tipCount={liveCounts.tips}
        checkerCount={liveCounts.checker}
        execution={execution}
        stale={stale}
        languageName={language?.displayName ?? ""}
      />
    </section>
  );

  const preview = browserLanguage ? (
    <PreviewPanel languageId={activeId} source={source} runToken={previewRun} auto={ext("live-preview")} onReveal={reveal} />
  ) : null;

  const terminalPanel = browserLanguage ? (
    <div className={`k-panel h-full ${enter(2).className}`} style={enter(2).style}>
      <Spot />
      {preview}
    </div>
  ) : (
    <div className={`k-panel h-full ${enter(2).className}`} style={enter(2).style}>
      <Spot />
      {sweep && <span key={sweep.id} className={`k-sweep ${sweep.ok ? "k-sweep-ok" : "k-sweep-bad"}`} aria-hidden onAnimationEnd={() => setSweep(null)} />}
      <div className="flex shrink-0 items-center border-b border-line">
        <span className="k-index pl-3 max-md:hidden">03</span>
        <RunPipeline execution={execution} plan={language?.steps ?? []} />
      </div>
      <div className="min-h-0 flex-1">
        <OutputPanel
          execution={execution}
          language={language}
          stdin={stdin}
          onStdinChange={setStdin}
          tab={deckTab}
          onTabChange={setDeckTab}
          highlight={highlight}
        />
      </div>
    </div>
  );

  const bottom = (
    <SplitPane
      storageKey="k.split.diag"
      initial={0.56}
      min={0.32}
      max={0.76}
      label="Resize the diagnostics"
      first={terminalPanel}
      second={
        <div className={`k-panel h-full ${enter(3).className}`} style={enter(3).style}>
          <Spot />
          {problemsPanel()}
        </div>
      }
    />
  );

  const notebook = notebookOpen && ext("notebooks") ? (
    <div className={`h-full min-h-0 ${enter(1).className}`} style={enter(1).style}>
      <ErrorBoundary
        fallback={(error, retry) => (
          <div className="k-panel grid h-full place-items-center p-6 text-center text-sm text-muted" role="alert">
            <div>
              <p className="font-semibold text-fg">The notebook could not load.</p>
              <p className="mt-1 text-xs">{error.message}</p>
              <button type="button" onClick={retry} className="mt-3 rounded-md border border-line px-3 py-1 text-xs text-fg hover:bg-fg/5">
                Try again
              </button>
            </div>
          </div>
        )}
      >
        <Suspense fallback={<EditorLoading />}>
          <NotebookView
            storageKey={`k.notebook.${profile.id}`}
            theme={theme}
            fontSize={editorOptions.fontSize}
            available={(languages ?? []).some((l) => l.id === "python" && l.available !== false)}
            saarthi={saarthi.enabled}
            insights={insightOptions}
            onClose={toggleNotebook}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null;


  const dock = (
    <div className={`k-panel h-full ${enter(4).className}`} style={enter(4).style} data-tour="saarthi">
      <Spot />
      {saarthiPanel}
    </div>
  );

  const mobilePanel = (
    <div className="k-panel h-full">
      <Spot />
      <OutputPanel
        execution={execution}
        language={language}
        stdin={stdin}
        onStdinChange={setStdin}
        tab={deckTab}
        onTabChange={(tab) => {
          setDeckTab(tab);
          setMobileTab(tab);
        }}
        highlight={highlight}
        extraTabs={[
          ...(browserLanguage ? [{ id: "preview", label: "Preview", testId: "side-tab-preview" }] : []),
          { id: "problems", label: "Diagnostics", badge: problemsBadge, testId: "side-tab-problems" },
          { id: "saarthi", label: <><SaarthiMark size={15} /> Saarthi</>, testId: "side-tab-saarthi", tour: "saarthi" },
        ]}
        onlyExtraTabs={browserLanguage}
        extraSelected={
          mobileTab === "problems" || mobileTab === "saarthi" || (browserLanguage && mobileTab === "preview")
            ? mobileTab
            : browserLanguage
              ? "preview"
              : null
        }
        onExtraSelect={(id) => id && setMobileTab(id)}
        extraContent={
          mobileTab === "saarthi" ? (
            saarthiPanel
          ) : browserLanguage && mobileTab !== "problems" ? (
            preview
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-line">
                <RunPipeline execution={execution} plan={language?.steps ?? []} />
              </div>
              <div className="min-h-0 flex-1">{problemsPanel(true)}</div>
            </div>
          )
        }
      />
    </div>
  );

  const extensionsOn = EXTENSIONS.filter((e) => extensions.enabled(e.id)).length;
  // The picker lists every server language (unavailable ones greyed out) and the browser languages.
  const pickerLanguages = useMemo(() => withBrowserLanguages(languages ?? []), [languages]);

  return (
    <div ref={root} className="relative z-10 flex h-full flex-col" data-testid="workspace">
      <TopBar
        languages={pickerLanguages}
        languageId={activeId}
        onLanguageChange={changeLanguage}
        busy={busy}
        canRun={language !== null && language.available !== false}
        onRun={doRun}
        execution={execution}
        stale={stale}
        onExamples={openExamples}
        onTour={openTour}
        onShortcuts={openShortcuts}
        onPalette={openPaletteFromBar}
        onSaarthi={openSaarthi}
        saarthiStatus={saarthiStatus}
        theme={theme}
        onToggleTheme={onToggleTheme}
        profile={profile}
        levelName={level.name}
        levelFraction={level.fraction}
        dayStreak={dayStreak}
        xpPulse={xpPulse}
        onProfile={openProfile}
        explorer={explorerControl}
        dock={dockControl}
        panel={panelControl}
        notebook={notebookControl}
      />
      {apiDown && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-fg" role="alert">
          <WifiOff size={14} className="text-danger-fg" />
          Cannot reach the API, so programs cannot run yet. Start it (see README); this page retries automatically.
        </div>
      )}
      <main className="min-h-0 flex-1 p-2">
        {wide ? (
          <Workbench
            rail={
              <ActivityRail
                view={sideView}
                open={explorerOpen}
                onSelect={selectSideView}
                extensionsOn={extensionsOn}
                onNotebook={ext("notebooks") ? toggleNotebook : undefined}
                notebookOpen={notebookOpen}
              />
            }
            sidebar={
              explorerOpen ? (
                <div className={`h-full ${enter(0).className}`} style={enter(0).style}>
                  {sideView === "extensions" ? (
                    <ExtensionsView
                      extensions={extensions}
                      languageId={activeId}
                      languageName={language?.displayName ?? ""}
                      serverUp={health.kind === "up"}
                    />
                  ) : (
                    <Explorer
                      languages={offered}
                      language={language}
                      draftIds={draftIds}
                      onOpenLanguage={changeLanguage}
                      inputLines={inputLines}
                      onOpenInput={openInput}
                      onLoadExample={loadExample}
                      onOpenExamples={openExamples}
                      busy={busy}
                      system={systemStatus}
                    />
                  )}
                </div>
              ) : null
            }
            editor={notebook ?? editorCard}
            panel={!notebook && panelOpen ? bottom : null}
            panelMaximized={panelMax}
            secondary={dockOpen ? dock : null}
            layout={layout}
            onLayout={changeLayout}
            onCollapse={(which) => {
              if (which === "sidebar") {
                setExplorerPref(false);
                save("k.explorer", false);
              } else if (which === "panel") {
                setPanelOpen(false);
                setPanelMax(false);
              } else setDockOpen(false);
            }}
          />
        ) : (
          notebook ?? (
            <div className="flex h-full flex-col gap-2 overflow-y-auto">
              <div className="h-[58vh] shrink-0">{editorCard}</div>
              <div className="h-[78vh] shrink-0">{mobilePanel}</div>
            </div>
          )
        )}
      </main>
      <StatusBar
        health={health}
        execution={execution}
        fileName={fileName}
        cursor={cursor}
        draftSaved={draftSaved}
        onShortcuts={openShortcuts}
        saarthiStatus={saarthiStatus}
        languages={readyCount}
        cloud={cloud?.status ?? null}
      />

      {/* Dialogs are mounted only while open: closed, they cost nothing on the renders that follow typing. */}
      {welcomeOpen && !helloFirst && (
      <WelcomeDialog
        open={welcomeOpen}
        name={profile.name}
        onClose={finishWelcome}
        onTour={() => {
          finishWelcome();
          setTourOpen(true);
        }}
        onExamples={() => {
          finishWelcome();
          setExamplesOpen(true);
        }}
      />
      )}
      {tourOpen && <Tour steps={TOUR_STEPS} open={tourOpen} onClose={() => setTourOpen(false)} />}
      {examplesOpen && <ExampleGallery open={examplesOpen} language={language} onClose={() => setExamplesOpen(false)} onLoad={loadExample} />}
      {shortcutsOpen && <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />}
      {profileOpen && (
      <ProfileCard
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={profile}
        progress={progress}
        motion={motion}
        onToggleMotion={onToggleMotion}
        theme={theme}
        onToggleTheme={onToggleTheme}
        sound={sound}
        onToggleSound={toggleSound}
        onSignOut={() => {
          setProfileOpen(false);
          onSignOut();
        }}
      />
      )}
      <CommandPalette
        open={palette !== null}
        onClose={() => setPalette(null)}
        commands={palette === null ? [] : buildCommands({
          canRun: language !== null && language.available !== false,
          busy,
          run: doRun,
          save: saveNow,
          format: { label: formatterFor(activeId, formatOptions) ?? "the editor", run: () => void formatNow() },
          explain: saarthi.enabled && execution?.terminal && !stale ? () => explain(selectedDiagnostic?.id ?? null) : null,
          quickFix:
            liveFocus?.fix ? { label: liveFocus.fix.label, line: liveFocus.startLine, apply: () => applyLiveFix(liveFocus, false) } : null,
          openSaarthi,
          askSaarthi: () => {
            openSaarthi();
            window.setTimeout(() => document.getElementById("saarthi-question")?.focus(), 60);
          },
          trick: companion.doTrick,
          editorAction: (id) => editor.current?.trigger(id),
          languages: offered,
          activeId,
          switchLanguage: changeLanguage,
          examples: examplesFor(activeId),
          compileLabel: language?.steps.find((st) => st.kind === "compile")?.label ?? "Compile",
          loadExample,
          openExamples: () => setExamplesOpen(true),
          theme,
          toggleTheme: onToggleTheme,
          explorer: wide ? { open: explorerOpen, toggle: toggleExplorer } : undefined,
          dock: wide ? { open: dockOpen, toggle: () => setDockOpen((o) => !o) } : undefined,
          notebook: ext("notebooks") ? { open: notebookOpen, toggle: toggleNotebook } : undefined,
          showTab: (tab) => {
            setDeckTab(tab);
            setMobileTab(tab);
          },
          showDiagnostics: wide ? undefined : () => setMobileTab("problems"),
          motion,
          toggleMotion: onToggleMotion,
          sound,
          toggleSound,
          tour: () => setTourOpen(true),
          shortcuts: () => setShortcutsOpen(true),
          profile: () => setProfileOpen(true),
          signOut: { label: profile.kind === "guest" ? "Switch profile" : "Sign out", run: onSignOut },
        })}
        onGoToLine={(line) => reveal(Math.min(Math.max(1, line), source.split("\n").length))}
        onEditorAction={palette === "editor" ? (id) => editor.current?.trigger(id) : undefined}
      />
      {badgeQueue[0] && (
        <BadgeToast
          key={badgeQueue[0].id}
          badge={badgeQueue[0]}
          onClose={() => setBadgeQueue((queue) => queue.slice(1))}
          onOpenProfile={() => {
            setBadgeQueue([]);
            setProfileOpen(true);
          }}
        />
      )}
    </div>
  );
}

/** What Saarthi says when a run finishes. */
function runReaction(
  execution: Execution,
  errors: Execution["diagnostics"],
  cleanStreak: number,
): { text: string; tone: BubbleTone; explain: boolean } {
  const first = errors[0];
  const where = first?.range ? ` on line ${first.range.startLine}` : "";
  const short = (text: string | undefined) => (!text ? "" : text.length > 90 ? `${text.slice(0, 87)}...` : text);
  switch (execution.state) {
    case "SUCCEEDED": {
      if (errors.length > 0) {
        return { text: `It finished, but reported ${errors.length} problem${errors.length === 1 ? "" : "s"}${where}.`, tone: "error", explain: true };
      }
      if (cleanStreak >= 3) return { text: `${cleanStreak} clean runs in a row. You're on fire!`, tone: "success", explain: false };
      const run = execution.steps.find((s) => s.kind === "run");
      const ms = formatMs(run?.durationMs ?? run?.wallMs);
      return { text: ms ? `It ran cleanly in ${ms}. The output is below.` : "It ran cleanly. The output is below.", tone: "success", explain: false };
    }
    case "COMPILE_ERROR":
      return { text: `The compiler stopped${where}: ${short(first?.message)}`, tone: "error", explain: true };
    case "RUNTIME_ERROR":
      return { text: `It crashed${where}. ${short(first?.message)}`.trim(), tone: "error", explain: true };
    case "TIMEOUT":
      return { text: "It ran out of time. Is there a loop that never ends?", tone: "error", explain: true };
    case "MEMORY_LIMIT":
      return { text: "It used too much memory. Look for something that keeps growing.", tone: "error", explain: true };
    case "REJECTED":
      return { text: "The sandbox is busy right now. Try again in a moment.", tone: "info", explain: false };
    default:
      return { text: "Something went wrong on the server's side, not in your code.", tone: "error", explain: false };
  }
}

function Opening({ text = "Starting KAIRO..." }: { text?: string }) {
  return (
    <div className="relative z-10 flex h-full flex-col items-center justify-center gap-3 font-mono text-xs uppercase tracking-[0.14em] text-muted" data-testid="opening">
      <KairoMark size={52} animated />
      {text}
    </div>
  );
}

/**
 * A signed-in account's cloud saves: pull and merge them before the
 * workspace opens, then mirror changes while it is open (see cloud/sync.ts).
 * Returns the account's profile as saved in the cloud (name, avatar, level of
 * experience) and the controls the workspace uses; `ready` is false while
 * the account is loading.
 */
function useAccountCloud(profile: Profile | null) {
  const toast = useToast();
  const accountId = profile?.kind === "account" ? profile.id : null;
  const [ready, setReady] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name?: string; avatar?: string; experience?: string } | null>(null);
  const [status, setStatus] = useState<SyncStatus>("off");
  const mirror = useRef<CloudMirror | null>(null);

  useEffect(() => {
    if (!accountId) {
      setReady(null);
      setStatus("off");
      return;
    }
    let cancelled = false;
    let stop: (() => void) | null = null;
    setStatus("loading");
    hydrate(accountId)
      .then((result) => {
        if (cancelled) return;
        if (result.profile) {
          save(`cd.avatar.${accountId}`, result.profile.avatar);
          save(`cd.experience.${accountId}`, result.profile.experience);
          setSaved({ name: result.profile.displayName, avatar: result.profile.avatar, experience: result.profile.experience });
        }
      })
      .catch(() => {
        if (!cancelled) toast.show({ tone: "error", title: "Working offline", body: "Your saved work could not be loaded right now. Changes stay in this browser and are saved to your account when the connection is back." });
      })
      .finally(() => {
        if (cancelled) return;
        const m = new CloudMirror(accountId);
        mirror.current = m;
        const unsubscribe = m.subscribe(setStatus);
        const end = m.start();
        stop = () => {
          unsubscribe();
          end();
        };
        setReady(accountId);
      });
    return () => {
      cancelled = true;
      stop?.();
      mirror.current = null;
    };
  }, [accountId, toast]);

  const controls = useMemo<CloudControls | null>(
    () => (accountId && ready === accountId ? { status, flush: () => mirror.current?.flush() ?? Promise.resolve() } : null),
    [accountId, ready, status],
  );
  const merged = useMemo<Profile | null>(() => {
    if (!profile || profile.kind !== "account" || !saved) return profile;
    const avatar = AVATARS.some((a) => a.id === saved.avatar) ? (saved.avatar as Profile["avatar"]) : profile.avatar;
    const experience = EXPERIENCE.some((e) => e.id === saved.experience) ? (saved.experience as Profile["experience"]) : profile.experience;
    return { ...profile, name: cleanName(saved.name ?? "") || profile.name, avatar, experience };
  }, [profile, saved]);

  /** Upload what is left, then remove the account's copies from this browser. */
  const leave = useCallback(async () => {
    if (!accountId) return;
    try {
      await Promise.race([mirror.current?.flush(), new Promise((r) => setTimeout(r, 4000))]);
    } finally {
      forgetAccount(accountId);
    }
  }, [accountId]);

  const saveProfile = useCallback(
    (next: Profile) => {
      if (!accountId) return;
      setSaved({ name: next.name, avatar: next.avatar, experience: next.experience });
      save(`cd.avatar.${accountId}`, next.avatar);
      save(`cd.experience.${accountId}`, next.experience);
      void saveProfileRow(accountId, next).catch(() => undefined);
    },
    [accountId],
  );

  return { loading: !!accountId && ready !== accountId, profile: merged, controls, leave, saveProfile };
}

/**
 * The app shell: the boot sequence (once per tab), then either the entry
 * page or the workspace for the current profile.
 */
export function App() {
  const [motion, toggleMotion] = useMotion();
  const [theme, toggleTheme] = useTheme();
  const fine = useFinePointer();
  const auth = useAuth();
  const account = useAccountCloud(auth.profile);
  const shell = useRef<HTMLDivElement>(null);
  const [curtain, setCurtain] = useState(false);
  // "on" while the boot sequence covers the screen, "leaving" while it fades out.
  const [boot, setBoot] = useState<"on" | "leaving" | "off">(() => (bootedThisSession() ? "off" : "on"));
  // The page under the boot sequence mounts only when the boot leaves: its
  // entrance animations then play in view, and it does not compete with the
  // boot's checks. The editor's code is fetched in the meantime.
  useEffect(() => {
    if (boot === "on") void import("./editor/CodeEditor");
  }, []);
  const fx = useMemo(() => ({ motion, fine }), [motion, fine]);
  const endCurtain = useCallback(() => setCurtain(false), []);

  return (
    <FxContext.Provider value={fx}>
      <div ref={shell} className="cd-app relative h-full" data-motion={motion ? "on" : "off"} data-mood="calm">
        <SaarthiHelloProvider>
        <CelebrateProvider enabled={motion}>
          {boot === "on" ? null : !auth.ready ? (
            <Opening />
          ) : account.loading ? (
            <Opening text="Loading your saved work..." />
          ) : account.profile ? (
            <ShellContext.Provider value={shell}>
              <Workspace
                key={account.profile.id}
                profile={account.profile}
                cloud={account.controls}
                onSaveProfile={account.saveProfile}
                onSignOut={() => void account.leave().finally(() => void auth.signOut())}
                motion={motion}
                onToggleMotion={toggleMotion}
                theme={theme}
                onToggleTheme={toggleTheme}
              />
            </ShellContext.Provider>
          ) : (
            <LoginPage
              motion={motion}
              theme={theme}
              onToggleTheme={toggleTheme}
              onLaunch={() => motion && setCurtain(true)}
              onEnter={(profile, start) => {
                if (start) save("cd.language", start);
                markWelcome();
                auth.enterAsGuest(profile);
              }}
            />
          )}
        </CelebrateProvider>
        </SaarthiHelloProvider>
        {motion && fine && <MagneticField />}
        {curtain && <StarFlight onDone={endCurtain} />}
        {auth.recovery && <NewPasswordDialog onDone={auth.endRecovery} />}
        {boot !== "off" && <BootSequence motion={motion} onLeave={() => setBoot("leaving")} onDone={() => setBoot("off")} />}
      </div>
    </FxContext.Provider>
  );
}

/** The editor's analyzer strip: live check timing, the concept at the cursor, results freshness. Real numbers only. */
const AnalyzerStrip = memo(function AnalyzerStrip({
  live,
  liveCount,
  typoCount = 0,
  tipCount = 0,
  checkerCount = 0,
  execution,
  stale,
  languageName,
}: {
  live: LiveState;
  liveCount: number;
  typoCount?: number;
  tipCount?: number;
  checkerCount?: number;
  execution: Execution | null;
  stale: boolean;
  languageName: string;
}) {
  const { stats } = live;
  const ms = (v: number | null) => (v === null ? "-" : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);
  let liveView;
  if (live.status === "unsupported") {
    liveView = (
      <span className="flex items-center gap-1.5" title="Problems appear when you run the code">
        <CircleDashed size={12} /> No live check for {languageName}
      </span>
    );
  } else if (live.status === "loading") {
    liveView = (
      <span className="flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" /> Loading the {languageName} grammar...
      </span>
    );
  } else if (live.status === "error") {
    liveView = (
      <span className="flex items-center gap-1.5 text-warn-fg" title={live.error}>
        <AlertTriangle size={12} /> Live check unavailable
      </span>
    );
  } else {
    liveView = (
      <span
        className="flex items-center gap-1.5"
        data-testid="live-status"
        title={`Tree-sitter syntax check in a Web Worker, 150 ms after you stop typing.\nCheck time p50 ${ms(stats.checkP50)}, p95 ${ms(stats.checkP95)}.\nKeystroke to markers p50 ${ms(stats.latencyP50)}, p95 ${ms(stats.latencyP95)} (${stats.samples} samples).${stats.grammarLoadMs !== null ? `\nGrammar loaded in ${Math.round(stats.grammarLoadMs)} ms.` : ""}`}
      >
        {liveCount > 0 ? <Zap size={12} className="text-warn-fg" /> : <CheckCircle2 size={12} className="text-brand-fg" />}
        <span className={liveCount > 0 ? "text-warn-fg" : ""}>{liveCount > 0 ? `${liveCount} syntax problem${liveCount === 1 ? "" : "s"}` : "Syntax OK"}</span>
        {typoCount > 0 && (
          <span className="text-warn-fg" data-testid="live-typos" title="Typo Guard: possible misspelt names (Ctrl+. to fix)">
            · {typoCount} typo{typoCount === 1 ? "" : "s"}
          </span>
        )}
        {checkerCount > 0 && (
          <span className="text-danger-fg" data-testid="live-checker" title="Problems found by the language service (types, unknown names...)">
            · {checkerCount} type error{checkerCount === 1 ? "" : "s"}
          </span>
        )}
        {tipCount > 0 && (
          <span className="text-info-fg" data-testid="live-tips" title="Saarthi tips: valid code that probably does not do what you meant">
            · {tipCount} tip{tipCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="text-faint/80 max-md:hidden">
          · {ms(stats.checkP50)}
          {stats.samples >= 5 ? ` · p95 ${ms(stats.latencyP95)} to screen` : ""}
        </span>
      </span>
    );
  }
  const concept = live.status !== "unsupported" ? live.concept : null;
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-raised px-3 font-mono text-[10.5px] text-muted">
      <span className="k-label !text-[9px] max-sm:hidden">Analyzer</span>
      {liveView}
      {concept && (
        <span className="hidden min-w-0 items-center gap-1.5 truncate lg:flex" data-testid="concept-strip" title="The concept at your cursor">
          <span className="text-line-strong">|</span>
          <span className="text-brand-fg">{languageName}</span>
          <span className="truncate text-muted">→ {concept.path.join(" → ")}</span>
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {!execution ? (
          <>
            <Dot className="bg-faint" /> not run yet
          </>
        ) : !execution.terminal ? (
          <>
            <Dot className="bg-brand" pulse /> running
          </>
        ) : stale ? (
          <>
            <Dot className="bg-warn" /> results outdated
          </>
        ) : (
          <>
            <Dot className="bg-brand" /> results current
          </>
        )}
      </span>
    </div>
  );
});
