import { BookOpenCheck, CircleHelp, Command, Flame, Keyboard, Loader2, Moon, NotebookPen, PanelBottom, PanelLeft, PanelRight, Play, Sun } from "lucide-react";
import { memo } from "react";
import type { Execution, Language } from "../api/types";
import { altKey, modKey, type Theme } from "../lib/hooks";
import { Avatar } from "../profile/Avatar";
import type { Profile } from "../profile/profile";
import { Button } from "../ui/primitives";
import { InstallButton, useInstall } from "../pwa/install";
import { LanguagePicker } from "./LanguagePicker";
import { KairoLogo, SaarthiMark } from "./Logo";

interface Props {
  languages: Language[] | null;
  languageId: string;
  onLanguageChange(id: string): void;
  busy: boolean;
  canRun: boolean;
  onRun(): void;
  execution: Execution | null;
  stale: boolean;
  onExamples(): void;
  onTour(): void;
  onShortcuts(): void;
  /** Open the command palette (Ctrl+K). */
  onPalette(): void;
  onSaarthi(): void;
  saarthiStatus: "checking" | "online" | "offline";
  theme: Theme;
  onToggleTheme(): void;
  profile: Profile;
  levelName: string;
  levelFraction: number;
  dayStreak: number;
  /** A short "+12 XP" flourish after progress was earned. */
  xpPulse: { id: number; amount: number } | null;
  onProfile(): void;
  /** Desktop panel toggles (absent on small screens). */
  explorer?: { open: boolean; toggle(): void };
  dock?: { open: boolean; toggle(): void };
  /** The terminal panel under the editor (Ctrl+`). */
  panel?: { open: boolean; toggle(): void };
  /** The Python notebook (shown here below 1024 px, where the left bar is hidden). */
  notebook?: { open: boolean; toggle(): void };
}

/** The build state in one word, for the system bar. */
export function buildState(execution: Execution | null, stale: boolean): { word: string; tone: "idle" | "busy" | "ok" | "bad" | "warn" } {
  if (!execution) return { word: "READY", tone: "idle" };
  if (!execution.terminal) return { word: "RUNNING", tone: "busy" };
  if (stale) return { word: "OUTDATED", tone: "warn" };
  const errors = execution.diagnostics.some((d) => d.severity === "error");
  switch (execution.state) {
    case "SUCCEEDED":
      return errors ? { word: "ERRORS", tone: "bad" } : { word: "PASSED", tone: "ok" };
    case "COMPILE_ERROR":
      return { word: "FAILED", tone: "bad" };
    case "RUNTIME_ERROR":
      return { word: "CRASHED", tone: "bad" };
    case "TIMEOUT":
      return { word: "TIMEOUT", tone: "bad" };
    case "MEMORY_LIMIT":
      return { word: "MEMORY LIMIT", tone: "bad" };
    case "REJECTED":
      return { word: "BUSY", tone: "warn" };
    default:
      return { word: "ERROR", tone: "bad" };
  }
}

const TONE_DOT = { idle: "bg-faint", busy: "bg-brand", ok: "bg-brand", bad: "bg-danger", warn: "bg-warn" } as const;
const TONE_TEXT = { idle: "text-fg", busy: "text-brand-fg", ok: "text-brand-fg", bad: "text-danger-fg", warn: "text-warn-fg" } as const;

/**
 * The system bar: KAIRO / COMPILER OS, the language runtime, the build and
 * Saarthi status, and the actions (examples, tour, keys, theme, RUN, profile).
 */
export const TopBar = memo(function TopBar(props: Props) {
  const build = buildState(props.execution, props.stale);
  const install = useInstall();
  const saarthiWord = props.saarthiStatus === "online" ? "ONLINE" : props.saarthiStatus === "offline" ? "OFFLINE" : "CHECKING";
  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-2.5 backdrop-blur-md sm:gap-2.5 sm:px-3">
      <a href="/" className="flex items-center rounded-md pr-1" aria-label="KAIRO home">
        <KairoLogo size={30} animated sub="COMPILER OS" compact />
      </a>

      <div className="mx-0.5 h-6 w-px bg-line max-sm:hidden" aria-hidden />
      <LanguagePicker languages={props.languages} value={props.languageId} onChange={props.onLanguageChange} />

      <span className="k-chip max-xl:hidden" data-testid="build-status" title="State of the last build and run">
        BUILD
        {build.tone === "busy" ? (
          <Loader2 size={11} className="animate-spin text-brand-fg" />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[build.tone]}`} aria-hidden />
        )}
        <b className={TONE_TEXT[build.tone]}>{build.word}</b>
      </span>
      <button
        type="button"
        onClick={props.onSaarthi}
        data-testid="open-saarthi"
        data-magnetic="0.2"
        title={props.saarthiStatus === "online" ? "Open Saarthi, the AI guide" : "Saarthi, the AI guide (not set up on this server)"}
        aria-label={`Saarthi, the AI guide: ${saarthiWord.toLowerCase()}. Open Saarthi`}
        className="k-chip transition-colors hover:border-ai/60 hover:bg-ai/8 max-sm:!px-1.5"
      >
        <SaarthiMark size={16} />
        <span className="max-lg:hidden">SAARTHI</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${props.saarthiStatus === "online" ? "bg-ai" : props.saarthiStatus === "offline" ? "bg-warn" : "bg-faint"} max-lg:hidden`}
          aria-hidden
        />
        <b className={`max-lg:hidden ${props.saarthiStatus === "online" ? "text-ai-fg" : "text-warn-fg"}`}>{saarthiWord}</b>
      </button>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={props.onPalette}
          data-testid="open-palette"
          data-tour="palette"
          aria-label="Command palette"
          title={`Command palette (${modKey}+K)`}
          aria-keyshortcuts="Control+K Meta+K"
          className="k-chip mr-1 transition-colors hover:border-brand/60 hover:bg-brand/6 max-lg:hidden"
        >
          <Command size={13} className="text-brand-fg" />
          <span className="max-2xl:hidden">Commands</span>
          <kbd className="rounded border border-line-strong bg-raised px-1 font-mono text-[9.5px] font-bold text-muted">{modKey} K</kbd>
        </button>
        <Button variant="ghost" size="compact" onClick={props.onExamples} data-tour="examples" data-testid="open-examples">
          <BookOpenCheck size={16} />
          <span className="hidden font-mono text-[11px] font-semibold uppercase tracking-wider 2xl:inline">Examples</span>
        </Button>
        {props.notebook && (
          <Button
            variant="ghost"
            size="icon"
            onClick={props.notebook.toggle}
            aria-label={props.notebook.open ? "Close the notebook" : "Python notebook"}
            aria-pressed={props.notebook.open}
            title={props.notebook.open ? "Back to the code editor" : "Python notebook"}
            data-testid="topbar-notebook"
            className={`lg:hidden ${props.notebook.open ? "text-brand-fg" : ""}`}
          >
            <NotebookPen size={16} />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={props.onTour} aria-label="Take the tour" title="Take the tour" className="max-sm:hidden">
          <CircleHelp size={16} />
        </Button>
        <Button variant="ghost" size="icon" onClick={props.onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className="max-lg:hidden">
          <Keyboard size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={props.onToggleTheme}
          aria-label={props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={props.theme === "dark" ? "Light theme" : "Dark theme"}
          data-testid="theme-toggle"
          className="max-[420px]:hidden"
        >
          {props.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <InstallButton state={install} compact className="max-sm:hidden 2xl:hidden" />
        <InstallButton state={install} className="max-2xl:hidden" />
        {(props.explorer || props.panel || props.dock) && (
          <span className="mx-0.5 flex items-center rounded-md border border-line bg-raised/60 p-0.5 max-lg:hidden" role="group" aria-label="Layout">
            {props.explorer && (
              <LayoutToggle
                open={props.explorer.open}
                onClick={props.explorer.toggle}
                label={props.explorer.open ? "Hide the explorer" : "Show the explorer"}
                title={`Files and examples (${modKey}+B)`}
                icon={<PanelLeft size={15} />}
                testId="toggle-explorer"
              />
            )}
            {props.panel && (
              <LayoutToggle
                open={props.panel.open}
                onClick={props.panel.toggle}
                label={props.panel.open ? "Hide the terminal" : "Show the terminal"}
                title="Terminal and problems (Ctrl+`)"
                icon={<PanelBottom size={15} />}
                testId="toggle-terminal"
              />
            )}
            {props.dock && (
              <LayoutToggle
                open={props.dock.open}
                onClick={props.dock.toggle}
                label={props.dock.open ? "Hide Saarthi's panel" : "Show Saarthi's panel"}
                title={`Saarthi chat (${modKey}+${altKey}+B)`}
                icon={<PanelRight size={15} />}
                testId="toggle-saarthi"
              />
            )}
          </span>
        )}
        <Button
          variant="primary"
          onClick={props.onRun}
          disabled={!props.canRun || props.busy}
          data-tour="run"
          data-testid="run-button"
          data-magnetic="0.35"
          className="ml-1 font-mono uppercase tracking-wider sm:min-w-[6.5rem]"
          title={`Compile and run (${modKey}+Enter)`}
        >
          {props.busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
          <span className="max-[380px]:sr-only">{props.busy ? "Running" : "Run"}</span>
          <span className="hidden rounded border border-on-brand/20 bg-on-brand/10 px-1 py-px text-[9.5px] font-bold xl:inline">{modKey} ↵</span>
        </Button>

        <button
          type="button"
          onClick={props.onProfile}
          data-testid="profile-chip"
          aria-label={`${props.profile.name}: ${props.levelName}${props.dayStreak ? `, ${props.dayStreak}-day streak` : ""}. Open your profile`}
          title={`${props.profile.name} · ${props.levelName}`}
          className="relative ml-1 flex items-center gap-2 rounded-md border border-line bg-surface py-0.5 pl-0.5 pr-0.5 transition-colors hover:border-brand/50 sm:pr-2"
        >
          <Avatar id={props.profile.avatar} size={32} ring={props.levelFraction} />
          <span className="hidden min-w-0 flex-col items-start leading-tight 2xl:flex">
            <span className="max-w-24 truncate text-xs font-semibold text-fg">{props.profile.name}</span>
            <span className="max-w-24 truncate font-mono text-[9.5px] uppercase tracking-wider text-faint">{props.levelName}</span>
          </span>
          {props.dayStreak > 0 && (
            <span className="hidden items-center gap-0.5 font-mono text-[11px] font-bold text-accent-fg sm:flex" data-testid="streak">
              <Flame size={13} className="cd-flame" /> {props.dayStreak}
            </span>
          )}
          {props.xpPulse && (
            <span
              key={props.xpPulse.id}
              className="cd-xp-pulse pointer-events-none absolute -bottom-5 right-0 whitespace-nowrap rounded bg-accent px-1.5 py-px font-mono text-[10px] font-bold text-[#2a1600]"
              data-testid="xp-pulse"
            >
              +{props.xpPulse.amount} XP
            </span>
          )}
        </button>
      </div>
    </header>
  );
});

/** One of the three layout buttons (side bar, terminal, Saarthi), lit while its part is shown. */
function LayoutToggle({ open, onClick, label, title, icon, testId }: { open: boolean; onClick(): void; label: string; title: string; icon: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={open}
      title={title}
      data-testid={testId}
      className={`grid h-7 w-7 place-items-center rounded transition-colors ${open ? "bg-brand/14 text-brand-fg" : "text-faint hover:bg-fg/6 hover:text-fg"}`}
    >
      {icon}
    </button>
  );
}
