import { useEffect, useRef, useState } from "react";
import type { Execution } from "../api/types";
import { load, save } from "../lib/storage";

/** How the app feels right now; the background, the editor's aura and Saarthi follow it. */
export type Mood = "calm" | "typing" | "warn" | "error" | "running" | "success";

export interface MoodInput {
  execution: Execution | null;
  stale: boolean;
  liveProblemCount: number;
  /** Increases on every edit (a counter, not the text). */
  edits: number;
}

const TYPING_MS = 1200;
const SUCCESS_MS = 2600;

/** Pure part of the mood rules (tested). Order matters: a run in flight wins. */
export function moodFor(input: MoodInput, typing: boolean, celebrating: boolean): Mood {
  const { execution, stale } = input;
  if (execution && !execution.terminal) return "running";
  if (celebrating) return "success";
  const errors = execution && !stale ? execution.diagnostics.some((d) => d.severity === "error") : false;
  if (errors || (execution && !stale && execution.terminal && execution.state !== "SUCCEEDED")) return "error";
  if (input.liveProblemCount > 0) return "warn";
  if (typing) return "typing";
  return "calm";
}

/** The mood, and whether the student is typing right now (decorative motion pauses meanwhile). */
export function useMood(input: MoodInput): { mood: Mood; typing: boolean } {
  const [typing, setTyping] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const firstEdit = useRef(input.edits);

  useEffect(() => {
    if (input.edits === firstEdit.current) return;
    setTyping(true);
    const timer = window.setTimeout(() => setTyping(false), TYPING_MS);
    return () => window.clearTimeout(timer);
  }, [input.edits]);

  const succeededId = input.execution?.terminal && input.execution.state === "SUCCEEDED" ? input.execution.id : null;
  useEffect(() => {
    if (!succeededId) return;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [succeededId]);

  return { mood: moodFor(input, typing, celebrating), typing };
}

/** Whether decorative motion is on: the system setting first, then the student's choice. */
export function useMotion(): [boolean, () => void] {
  const systemReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [motion, setMotion] = useState<boolean>(() => load("cd.motion", !systemReduced));
  useEffect(() => void save("cd.motion", motion), [motion]);
  // An account's saved settings were just loaded (cloud/sync.ts): take its choice.
  useEffect(() => {
    const onSettings = () => setMotion(load("cd.motion", !systemReduced));
    window.addEventListener("kairo:settings", onSettings);
    return () => window.removeEventListener("kairo:settings", onSettings);
  }, [systemReduced]);
  return [motion, () => setMotion((m) => !m)];
}
