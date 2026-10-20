import { Download, Share, SquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Installing KAIRO as an app, like VS Code or Antigravity: from Chrome or
 * Edge on a computer or Android phone the browser's own install prompt
 * opens; on an iPhone or iPad (Safari has no prompt) a short guide shows how
 * to add it to the Home Screen. Installed, KAIRO opens in its own window with
 * its own icon. The service worker (public/sw.js) keeps the app's files so it
 * opens quickly; running code and Saarthi still need the internet.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Call once, before the app renders: the browser offers the install prompt early. */
export function registerPwa(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep it for our own Install button
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    notify();
  });
  // Production builds only: the dev server and the browser tests run without it.
  if ("serviceWorker" in navigator && import.meta.env.PROD && !import.meta.env.VITE_E2E) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export interface InstallState {
  /** KAIRO can be installed here (and is not yet). */
  available: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** Open the browser's prompt, or the guide on iPhone and iPad. */
  install(): void;
  /** The iPhone/iPad guide is open. */
  guide: boolean;
  closeGuide(): void;
}

export function useInstall(): InstallState {
  const [, rerender] = useState(0);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  const installed = installedNow || isStandalone();
  const ios = !installed && isIos();
  const install = useCallback(() => {
    if (deferred) {
      const event = deferred;
      void event
        .prompt()
        .then(() => event.userChoice)
        .then(() => {
          deferred = null;
          notify();
        })
        .catch(() => undefined);
    } else if (isIos()) {
      setGuide(true);
    }
  }, []);
  return { available: !installed && (deferred !== null || ios), installed, install, guide, closeGuide: useCallback(() => setGuide(false), []) };
}

/** The Install button (shown only where installing is possible). */
export function InstallButton({ state, compact = false, className = "" }: { state: InstallState; compact?: boolean; className?: string }) {
  if (!state.available) return null;
  return (
    <>
      <button
        type="button"
        onClick={state.install}
        title="Install KAIRO as an app on this device"
        aria-label="Install KAIRO as an app"
        data-testid="install-app"
        className={`k-install flex h-8 items-center gap-1.5 rounded-md border border-brand/50 bg-brand/10 px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-brand-fg transition-colors hover:bg-brand/18 ${className}`}
      >
        <Download size={14} />
        {!compact && <span>Install app</span>}
      </button>
      {state.guide && <IosGuide onClose={state.closeGuide} />}
    </>
  );
}

function IosGuide({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-end bg-[var(--cd-scrim)] p-3 sm:place-items-center" role="dialog" aria-modal="true" aria-label="Install KAIRO" onClick={onClose}>
      <div className="k-chat-in w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-[var(--cd-shadow)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} className="rounded-lg" />
          <p className="flex-1 font-semibold text-fg">Install KAIRO on your iPhone or iPad</p>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-faint hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <ol className="mt-3 flex flex-col gap-2.5 text-[13px] text-fg">
          <li className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[11px] font-bold text-brand-fg">1</span>
            Tap the <Share size={15} className="inline text-info-fg" /> <b>Share</b> button in Safari's toolbar.
          </li>
          <li className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[11px] font-bold text-brand-fg">2</span>
            Choose <SquarePlus size={15} className="inline" /> <b>Add to Home Screen</b>, then <b>Add</b>.
          </li>
          <li className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[11px] font-bold text-brand-fg">3</span>
            Open KAIRO from your Home Screen: it runs full screen, like an app.
          </li>
        </ol>
      </div>
    </div>
  );
}
