import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TextEdit } from "../lib/edits";
import type { Theme } from "../lib/hooks";
import type { LiveProblem } from "../live/analyze";
import type { CodeSymbol } from "../live/insights";
import { AI_COMPLETE_DELAY_MS, registerIntellisense, setIntelContext } from "./intellisense/providers";
import { MONACO_SEVERITY, type MarkerSpec } from "./markers";
import { ensureReactTypes, monaco } from "./monaco";

/** A problem reported by one of Monaco's language services. */
export interface ServiceMarker {
  owner: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Editor settings the Extensions view can change. */
export interface EditorOptions {
  minimap: boolean;
  wordWrap: boolean;
  stickyScroll: boolean;
  bracketColors: boolean;
  ligatures: boolean;
  fontSize: number;
  /** Language pack: KAIRO completions, hovers and parameter hints. */
  intellisense: boolean;
  snippets: boolean;
  /** Editor colour theme override ("" = follow the app theme). */
  editorTheme: string;
  /** Show whitespace characters. */
  whitespace: boolean;
}

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = {
  minimap: true,
  wordWrap: false,
  stickyScroll: false,
  bracketColors: true,
  ligatures: true,
  fontSize: 14,
  intellisense: true,
  snippets: true,
  editorTheme: "",
  whitespace: false,
};

export interface CodeEditorHandle {
  /** Move the cursor to a position, scroll it into view and flash the line. */
  reveal(line: number, column?: number): void;
  focus(): void;
  /** Apply edits as one undoable step (Ctrl+Z restores the text). */
  applyEdits(edits: TextEdit[], source?: string): boolean;
  /** The editor's text right now (React state can be a few keystrokes behind while typing fast). */
  getValue(): string | null;
  /** Run one of Monaco's editor actions (fold all, toggle comment, find...) and focus the editor. */
  trigger(actionId: string): void;
  /** Replace the whole text as one undo step, keeping the cursor's line (formatting). */
  replaceAll(text: string): void;
}

interface Props {
  value: string;
  /** KAIRO's language id (c, python, react...): picks IntelliSense data. */
  languageId?: string;
  /** Names declared in the file, for completions. */
  symbols?: CodeSymbol[];
  /** Live problems with fixes, offered as quick fixes (Ctrl+.). */
  problems?: LiveProblem[];
  /** Settings from the Extensions view. */
  options?: EditorOptions;
  /** Error Lens: messages shown at the end of their line. */
  lens?: { line: number; text: string; severity: "error" | "warning" | "info" | "hint" }[];
  /** TODO Highlight extension. */
  todoHighlight?: boolean;
  /** Complexity Lens: estimates shown above each function. */
  complexity?: { line: number; text: string }[];
  /** Problems found by Monaco's language services (TypeScript, HTML, CSS) for this file. */
  onServiceMarkers?(markers: ServiceMarker[]): void;
  /** AI autocomplete (ghost text from Saarthi's model). */
  aiComplete?: boolean;
  /** Vim Keymap extension: Vim modes and motions, with a mode line under the editor. */
  vim?: boolean;
  /** Shift+Alt+F: format the document (Prettier or a sandbox formatter). */
  onFormat?(): void;
  /**
   * Changes when the parent replaces the text (another language's draft, an
   * example, a Saarthi fix), never when the user types: only then is `value`
   * written into the editor. Typing is reported through onChange.
   */
  revision: string;
  language: string;
  theme: Theme;
  /** Problems from the last run (compiler, runtime). */
  markers: MarkerSpec[];
  /** Problems from the live syntax check of the current text. */
  liveMarkers: MarkerSpec[];
  fileName: string;
  /** Show the minimap (wide screens). */
  minimap?: boolean;
  onChange(value: string): void;
  onCursorChange?(line: number, column: number): void;
  onRun?(): void;
  onExplain?(): void;
  /** Ctrl+S: save the draft now. */
  onSave?(): void;
  /** Ctrl+K: open the command palette. */
  onPalette?(): void;
}

const themeName = (theme: Theme, override = "") => override || (theme === "dark" ? "kairo-dark" : "kairo-light");

const uriFor = (fileName: string) => monaco.Uri.parse(`file:///${encodeURIComponent(fileName)}`);

function editorSettings(o: EditorOptions, wide: boolean) {
  return {
    minimap: { enabled: o.minimap && wide, renderCharacters: false, showSlider: "mouseover" as const, maxColumn: 90, scale: 1 },
    wordWrap: o.wordWrap ? ("on" as const) : ("off" as const),
    stickyScroll: { enabled: o.stickyScroll },
    bracketPairColorization: { enabled: o.bracketColors },
    fontLigatures: o.ligatures,
    fontSize: o.fontSize,
    lineHeight: Math.round(o.fontSize * 1.64),
    renderWhitespace: o.whitespace ? ("all" as const) : ("selection" as const),
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    snippetSuggestions: o.snippets ? ("inline" as const) : ("none" as const),
    parameterHints: { enabled: o.intellisense },
    hover: { enabled: "on" as const, delay: 350 },
  };
}

/** One glyph per line in the gutter for the most severe problem on it. */
function glyphs(markers: MarkerSpec[]): monaco.editor.IModelDeltaDecoration[] {
  const worst = new Map<number, MarkerSpec>();
  const rank = { error: 3, warning: 2, info: 1, hint: 0 } as const;
  for (const m of markers) {
    if (m.severity === "hint") continue;
    const current = worst.get(m.startLineNumber);
    if (!current || rank[m.severity] > rank[current.severity]) worst.set(m.startLineNumber, m);
  }
  return [...worst.values()].map((m) => ({
    range: new monaco.Range(m.startLineNumber, 1, m.startLineNumber, 1),
    options: {
      glyphMarginClassName: `k-glyph k-glyph-${m.severity}`,
      glyphMarginHoverMessage: { value: m.message.split("\n")[0] },
      overviewRuler: {
        color: m.severity === "error" ? "#dc2626" : m.severity === "warning" ? "#d97706" : "#2563eb",
        position: monaco.editor.OverviewRulerLane.Left,
      },
    },
  }));
}

function toMonaco(markers: MarkerSpec[]): monaco.editor.IMarkerData[] {
  return markers.map((m) => ({
    severity: MONACO_SEVERITY[m.severity],
    message: m.message,
    code: m.code,
    source: m.source,
    startLineNumber: m.startLineNumber,
    startColumn: m.startColumn,
    endLineNumber: m.endLineNumber,
    endColumn: m.endColumn,
  }));
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const flash = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const gutter = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const modelSub = useRef<{ dispose(): void } | null>(null);
  const extra = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  // Create the editor once; props are read through `latest` in callbacks.
  useEffect(() => {
    registerIntellisense();
    const opts = latest.current.options ?? DEFAULT_EDITOR_OPTIONS;
    // One model per file name (main.c, App.jsx...): the file name gives the
    // language services the right extension (JSX needs .jsx).
    const uri = uriFor(latest.current.fileName);
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(latest.current.value, latest.current.language, uri);
    // Always "\n": on Windows an empty file would otherwise get "\r\n", which breaks Bash scripts in the sandbox.
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    const editor = monaco.editor.create(container.current!, {
      model,
      theme: themeName(latest.current.theme, opts.editorTheme),
      automaticLayout: true,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
      ...editorSettings(opts, latest.current.minimap ?? false),
      glyphMargin: true,
      folding: true,
      showFoldingControls: "mouseover",
      lineDecorationsWidth: 6,
      wordBasedSuggestions: "currentDocument",
      suggest: { showWords: true, preview: true, showStatusBar: true },
      inlineSuggest: { enabled: true },
      lightbulb: { enabled: "onCode" as never },
      autoClosingBrackets: "languageDefined",
      autoIndent: "full",
      matchBrackets: "always",
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      cursorBlinking: "smooth",
      renderLineHighlight: "all",
      padding: { top: 14, bottom: 14 },
      tabSize: 4,
      insertSpaces: true,
      lineNumbersMinChars: 3,
      fixedOverflowWidgets: true,
      guides: { bracketPairs: "active", indentation: true },
      "semanticHighlighting.enabled": false,
      ariaLabel: `Code editor for ${latest.current.fileName}. Press ${
        navigator.platform.includes("Mac") ? "Control+Shift+M" : "Control+M"
      } to let Tab move focus out of the editor.`,
    });
    editorRef.current = editor;
    flash.current = editor.createDecorationsCollection();
    gutter.current = editor.createDecorationsCollection();
    extra.current = editor.createDecorationsCollection();
    // Development builds and the end-to-end test build (VITE_E2E=1) only: lets the
    // tests put a large file in the editor without typing it. Not present in
    // production builds.
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") (window as unknown as { __kairoEditor?: unknown }).__kairoEditor = editor;

    modelSub.current = model.onDidChangeContent(() => latest.current.onChange(model.getValue()));
    const cursorSub = editor.onDidChangeCursorPosition((e) =>
      latest.current.onCursorChange?.(e.position.lineNumber, e.position.column),
    );
    // Language-service problems (TypeScript "Cannot find name 'consol'"...) go to the diagnostics list too.
    // Only real changes are reported: KAIRO's own "compiler" and "live" markers change these events too,
    // and reporting an unchanged list would re-render the app, which sets the live markers again (a loop).
    let lastService = "";
    const markerSub = monaco.editor.onDidChangeMarkers((uris) => {
      const current = editor.getModel();
      if (!current || !uris.some((u) => u.toString() === current.uri.toString())) return;
      const sev = (s: number): ServiceMarker["severity"] => (s >= 8 ? "error" : s >= 4 ? "warning" : s >= 2 ? "info" : "hint");
      const service = monaco.editor
        .getModelMarkers({ resource: current.uri })
        .filter((m) => m.owner !== "compiler" && m.owner !== "live")
        .map((m) => ({
          owner: m.owner,
          severity: sev(m.severity),
          message: m.message,
          code: typeof m.code === "string" ? m.code : m.code?.value,
          startLine: m.startLineNumber,
          startColumn: m.startColumn,
          endLine: m.endLineNumber,
          endColumn: m.endColumn,
        }));
      const key = `${current.uri.toString()}|${JSON.stringify(service)}`;
      if (key === lastService) return;
      lastService = key;
      latest.current.onServiceMarkers?.(service);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => latest.current.onRun?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
      latest.current.onExplain?.(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave?.());
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      if (latest.current.onFormat) latest.current.onFormat();
      else editor.trigger("kairo", "editor.action.formatDocument", null);
    });
    // Ctrl+K opens KAIRO's command palette. Monaco's own Ctrl+K chords
    // (Ctrl+K Ctrl+C to comment, Ctrl+K Ctrl+0 to fold all...) keep working:
    // the palette passes the second key back as the matching editor action.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => latest.current.onPalette?.());

    return () => {
      modelSub.current?.dispose();
      markerSub.dispose();
      cursorSub.dispose();
      const current = editor.getModel();
      editor.dispose();
      current?.dispose();
      editorRef.current = null;
    };
  }, []);

  // Another file (language switch): a fresh model with that file's text.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const uri = uriFor(props.fileName);
    const old = editor.getModel();
    if (old && old.uri.toString() === uri.toString()) return;
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(latest.current.value, latest.current.language, uri);
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    modelSub.current?.dispose();
    editor.setModel(model);
    modelSub.current = model.onDidChangeContent(() => latest.current.onChange(model.getValue()));
    old?.dispose();
    monaco.editor.setModelMarkers(model, "compiler", toMonaco(latest.current.markers));
    monaco.editor.setModelMarkers(model, "live", toMonaco(latest.current.liveMarkers));
  }, [props.fileName]);

  // IntelliSense follows the language, the file's names and the live problems.
  useEffect(() => {
    const languageId = props.languageId ?? "c";
    const o = props.options ?? DEFAULT_EDITOR_OPTIONS;
    setIntelContext({
      languageId,
      symbols: props.symbols ?? [],
      problems: props.problems ?? [],
      completions: o.intellisense,
      snippets: o.snippets,
      complexity: props.complexity ?? [],
      aiComplete: props.aiComplete ?? false,
    });
    if (languageId === "react") void ensureReactTypes();
  }, [props.languageId, props.symbols, props.problems, props.options, props.complexity, props.aiComplete]);

  useEffect(() => {
    const o = props.options ?? DEFAULT_EDITOR_OPTIONS;
    editorRef.current?.updateOptions(editorSettings(o, props.minimap ?? false));
    monaco.editor.setTheme(themeName(props.theme, o.editorTheme));
  }, [props.options, props.minimap, props.theme]);

  // Error Lens and TODO highlights.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || !extra.current) return;
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    const lines = model.getLineCount();
    const seen = new Set<number>();
    for (const l of props.lens ?? []) {
      if (l.line < 1 || l.line > lines || seen.has(l.line) || l.severity === "hint") continue;
      seen.add(l.line);
      const end = model.getLineMaxColumn(l.line);
      decorations.push({
        range: new monaco.Range(l.line, end, l.line, end),
        options: {
          after: { content: `   ${l.text.split("\n")[0].slice(0, 120)}`, inlineClassName: `k-lens k-lens-${l.severity}` },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    if (props.todoHighlight) {
      const re = /\b(TODO|FIXME|HACK|NOTE|XXX)\b:?/g;
      for (let n = 1; n <= Math.min(lines, 5000); n++) {
        const text = model.getLineContent(n);
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          decorations.push({
            range: new monaco.Range(n, m.index + 1, n, m.index + 1 + m[0].length),
            options: { inlineClassName: `k-todo k-todo-${m[1].toLowerCase()}`, hoverMessage: { value: `${m[1]} (TODO Highlight)` } },
          });
        }
      }
    }
    extra.current.set(decorations);
  }, [props.lens, props.todoHighlight, props.value, props.fileName]);

  // Replacements from outside (an example, a language switch, a Saarthi fix)
  // go through the undo stack, so Ctrl+Z brings the previous code back. This
  // runs only when the revision changes: comparing `value` on every render
  // would race with fast typing and could put an older text back.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || model.getValue() === props.value) return;
    editor.pushUndoStop();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: props.value }], () => null);
    editor.pushUndoStop();
  }, [props.revision]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, props.language);
  }, [props.language]);


  // Markers are set only when they really changed (a new array with the same markers changes nothing).
  const shownMarkers = useRef({ compiler: "", live: "", model: "" });
  const setMarkers = (owner: "compiler" | "live", list: typeof props.markers) => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const key = JSON.stringify(list);
    const modelKey = model.uri.toString() + model.id;
    if (shownMarkers.current.model !== modelKey) shownMarkers.current = { compiler: "", live: "", model: modelKey };
    if (shownMarkers.current[owner] === key) return;
    shownMarkers.current[owner] = key;
    monaco.editor.setModelMarkers(model, owner, toMonaco(list));
  };
  useEffect(() => setMarkers("compiler", props.markers), [props.markers]);
  useEffect(() => setMarkers("live", props.liveMarkers), [props.liveMarkers]);

  useEffect(() => {
    gutter.current?.set(glyphs([...props.markers, ...props.liveMarkers]));
  }, [props.markers, props.liveMarkers]);

  // AI autocomplete: ask for ghost text after a pause in typing, also where Monaco would
  // not on its own (right after a suggestion or a snippet was accepted).
  useEffect(() => {
    const editor = editorRef.current;
    if (!props.aiComplete || !editor) return;
    let timer = 0;
    const sub = editor.onDidChangeModelContent((e) => {
      window.clearTimeout(timer);
      if (e.isFlush || e.isUndoing || e.isRedoing) return;
      timer = window.setTimeout(() => {
        if (editor.hasTextFocus()) editor.trigger("kairo-ai", "editor.action.inlineSuggest.trigger", {});
      }, AI_COMPLETE_DELAY_MS);
    });
    return () => {
      window.clearTimeout(timer);
      sub.dispose();
    };
  }, [props.aiComplete]);

  // Vim Keymap: monaco-vim is loaded the first time it is switched on.
  const vimStatus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = editorRef.current;
    if (!props.vim || !editor) return;
    let mode: { dispose(): void } | null = null;
    let cancelled = false;
    void import("monaco-vim").then(({ initVimMode }) => {
      if (cancelled || !vimStatus.current) return;
      mode = initVimMode(editor, vimStatus.current);
    });
    return () => {
      cancelled = true;
      mode?.dispose();
      if (vimStatus.current) vimStatus.current.textContent = "";
    };
  }, [props.vim]);

  useImperativeHandle(ref, () => ({
    reveal(line: number, column = 1) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Smooth);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
      flash.current?.set([
        { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "cd-flash-line" } },
      ]);
      window.setTimeout(() => flash.current?.clear(), 1600);
    },
    focus() {
      editorRef.current?.focus();
    },
    getValue() {
      return editorRef.current?.getModel()?.getValue() ?? null;
    },
    trigger(actionId: string) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.trigger("kairo", actionId, null);
    },
    replaceAll(text: string) {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || model.getValue() === text) return;
      const position = editor.getPosition();
      editor.pushUndoStop();
      editor.executeEdits("kairo-format", [{ range: model.getFullModelRange(), text }]);
      editor.pushUndoStop();
      if (position) editor.setPosition(model.validatePosition({ lineNumber: position.lineNumber, column: model.getLineFirstNonWhitespaceColumn(Math.min(position.lineNumber, model.getLineCount())) || 1 }));
      editor.revealLineInCenterIfOutsideViewport(editor.getPosition()?.lineNumber ?? 1);
    },
    applyEdits(edits: TextEdit[], source = "kairo") {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || edits.length === 0) return false;
      editor.pushUndoStop();
      const ok = editor.executeEdits(
        source,
        edits.map((e) => ({ range: new monaco.Range(e.startLine, e.startColumn, e.endLine, e.endColumn), text: e.text, forceMoveMarkers: true })),
      );
      editor.pushUndoStop();
      const last = edits[edits.length - 1];
      const lines = last.text.split("\n");
      const line = last.startLine + lines.length - 1;
      const column = (lines.length === 1 ? last.startColumn : 1) + lines[lines.length - 1].length;
      editor.setPosition({ lineNumber: line, column });
      editor.revealLineInCenterIfOutsideViewport(line, monaco.editor.ScrollType.Smooth);
      editor.focus();
      return ok;
    },
  }));

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={container} className="min-h-0 w-full flex-1" data-testid="code-editor" />
      {props.vim && (
        <div
          ref={vimStatus}
          className="h-6 shrink-0 border-t border-line bg-raised px-3 font-mono text-[11px] leading-6 text-muted"
          data-testid="vim-status"
          aria-live="polite"
        />
      )}
    </div>
  );
});
