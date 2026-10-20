import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Health } from "../api/types";

export type Theme = "light" | "dark";

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0a0a" : "#f3f6f4");
    try {
      localStorage.setItem("cd.theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);
  // An account's saved settings were just loaded (cloud/sync.ts): take its theme.
  useEffect(() => {
    const onSettings = () => {
      try {
        const saved = localStorage.getItem("cd.theme");
        if (saved === "dark" || saved === "light") setTheme(saved);
      } catch {
        // ignore
      }
    };
    window.addEventListener("kairo:settings", onSettings);
    return () => window.removeEventListener("kairo:settings", onSettings);
  }, []);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    onChange();
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export type HealthState = { kind: "checking" } | { kind: "down" } | { kind: "up"; health: Health };

/** Polls /api/v1/health so the status bar can say whether runs will work. */
export function useHealth(intervalMs = 10_000): HealthState {
  const [state, setState] = useState<HealthState>({ kind: "checking" });
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await api.health();
        if (!cancelled) setState({ kind: "up", health });
      } catch {
        if (!cancelled) setState({ kind: "down" });
      }
    };
    void check();
    const timer = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return state;
}

/** Value that only updates after `delayMs` without changes. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** True when the platform uses the Command key (macOS, iOS). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
/** The Alt key's name on this keyboard (Option on a Mac). */
export const altKey = isMac ? "Option" : "Alt";
