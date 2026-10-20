import { Check, Cloud, CloudOff, Keyboard, Loader2, PencilLine } from "lucide-react";
import type { Execution } from "../api/types";
import type { HealthState } from "../lib/hooks";
import { Dot } from "../ui/primitives";

interface Props {
  health: HealthState;
  execution: Execution | null;
  fileName: string;
  cursor: { line: number; column: number };
  draftSaved: boolean;
  onShortcuts(): void;
  saarthiStatus: "checking" | "online" | "offline";
  /** Languages that can run here, of all the server knows. */
  languages: { ready: number; total: number } | null;
  /** A signed-in account's cloud saves (null for guests: saved in this browser only). */
  cloud?: "off" | "loading" | "synced" | "saving" | "offline" | null;
}

export interface HealthView {
  dot: string;
  text: string;
  title: string;
  pulse: boolean;
  /** The API itself answers. */
  core: boolean;
}

export function healthView(health: HealthState): HealthView {
  if (health.kind === "checking") return { dot: "bg-faint", text: "Checking sandbox...", title: "Contacting the API", pulse: true, core: false };
  if (health.kind === "down")
    return { dot: "bg-danger", text: "API offline", title: "The KAIRO server cannot be reached; this page retries automatically", pulse: false, core: false };
  const { runner } = health.health;
  if (runner.status === "unreachable")
    return { dot: "bg-danger", text: "Runner offline", title: "The code runner cannot be reached right now", pulse: false, core: true };
  if (runner.docker === false)
    return { dot: "bg-warn", text: "Sandbox degraded", title: "Docker is not reachable by the runner", pulse: false, core: true };
  const missing = Object.values(runner.images ?? {}).filter((id) => !id).length;
  return {
    dot: "bg-brand",
    text: "Sandbox ready",
    title: missing
      ? `${missing} sandbox image(s) not built: those languages are hidden. ${health.health.queue.depth} waiting in queue.`
      : `${health.health.queue.depth} waiting in queue`,
    pulse: false,
    core: true,
  };
}

/** The status strip along the bottom: real system state only. */
export function StatusBar({ health, execution, fileName, cursor, draftSaved, onShortcuts, saarthiStatus, languages, cloud = null }: Props) {
  const view = healthView(health);
  const toolchain = execution?.toolchain;
  const queue = health.kind === "up" ? health.health.queue.depth : null;
  const item = "flex items-center gap-1.5 whitespace-nowrap";
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3.5 overflow-hidden border-t border-line bg-surface px-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
      <span className={`${item} max-md:hidden`} title="The KAIRO API">
        <Dot className={view.core ? "bg-brand" : "bg-danger"} />
        Compiler core <b className={view.core ? "text-fg" : "text-danger-fg"}>{view.core ? "online" : "offline"}</b>
      </span>
      <span className={item} title={view.title} data-testid="health">
        <Dot className={view.dot} pulse={view.pulse} />
        {view.text}
      </span>
      <span className={`${item} max-lg:hidden`}>
        <Dot className={saarthiStatus === "online" ? "bg-ai" : saarthiStatus === "offline" ? "bg-warn" : "bg-faint"} />
        Saarthi <b className={saarthiStatus === "online" ? "text-ai-fg" : "text-warn-fg"}>{saarthiStatus}</b>
      </span>
      {languages && (
        <span className={`${item} max-lg:hidden`} title="Languages whose sandbox image is installed here">
          Languages <b className="text-fg">{languages.ready}/{languages.total}</b> ready
        </span>
      )}
      {queue !== null && (
        <span className={`${item} max-xl:hidden`} title="Programs waiting for a sandbox">
          Queue <b className="text-fg">{queue}</b>
        </span>
      )}
      {toolchain && (
        <span className={`${item} max-xl:hidden normal-case tracking-normal`} title={`${toolchain.image} (${toolchain.imageId ?? "unknown id"})`}>
          {toolchain.name} {toolchain.version ?? ""}
        </span>
      )}
      <span className="ml-auto hidden normal-case tracking-normal sm:inline">{fileName}</span>
      <span className="ml-auto whitespace-nowrap normal-case tracking-normal sm:ml-0" data-testid="cursor">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <span className="hidden normal-case tracking-normal md:inline">UTF-8</span>
      <span className={item} title={cloud ? "Your code is saved in this browser and to your account (Ctrl+S saves right away)" : "Your code is saved in this browser only (Ctrl+S saves right away). Sign in to keep it in your account."}>
        {/* A still icon while saving: a spinner here would animate on every keystroke. */}
        {draftSaved ? <Check size={11} className="text-brand-fg" /> : <PencilLine size={11} className="text-accent-fg" />}
        <span className="hidden sm:inline">{draftSaved ? "Draft saved" : "Saving"}</span>
      </span>
      {cloud && cloud !== "off" && (
        <span
          className={`${item} ${cloud === "offline" ? "text-warn-fg" : ""}`}
          title={
            cloud === "offline"
              ? "Your account could not be reached: changes stay in this browser and are uploaded when the connection is back"
              : "Your code, progress, badges and settings are saved to your account"
          }
          data-testid="cloud-status"
        >
          {cloud === "offline" ? <CloudOff size={11} /> : cloud === "saving" || cloud === "loading" ? <Loader2 size={11} className="animate-spin" /> : <Cloud size={11} className="text-brand-fg" />}
          <span className="hidden md:inline">{cloud === "offline" ? "Offline" : cloud === "saving" ? "Syncing" : cloud === "loading" ? "Loading" : "Synced"}</span>
        </span>
      )}
      <button type="button" onClick={onShortcuts} className="flex items-center gap-1 uppercase hover:text-fg" aria-label="Keyboard shortcuts">
        <Keyboard size={12} /> <span className="hidden sm:inline">Keys</span>
      </button>
    </footer>
  );
}
