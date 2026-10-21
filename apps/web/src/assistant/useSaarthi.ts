import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type AskRequest } from "../api/client";
import type { AssistantStatus, ChatTurn, Explanation, FixProposal, FixVerdict } from "../api/types";
import { offlineAnswer, type OfflineContext } from "./offline";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  grounded?: "execution" | "source" | "none";
  error?: boolean;
  /** Answered by offline Saarthi (built-in knowledge), not by the AI model. */
  offline?: boolean;
  /** The answer is still being written (streamed from the model). */
  streaming?: boolean;
  /** The student pressed Stop before the answer was complete. */
  stopped?: boolean;
}

export type Pending = null | "explain" | "fix" | "verify" | "ask";

export interface AskArgs {
  question: string;
  languageId: string;
  executionId?: string | null;
  sourceHash?: string | null;
  source?: string | null;
  /** The run's sealed evidence (Execution.evidence). */
  evidence?: string | null;
  diagnosticId?: string | null;
}

export interface SaarthiApi {
  status: AssistantStatus | null;
  enabled: boolean;
  explanation: Explanation | null;
  fix: FixProposal | null;
  /** The source the fix was applied to, so it can be undone. */
  applied: { fixId: string; before: string } | null;
  verdict: FixVerdict | null;
  chat: ChatMessage[];
  pending: Pending;
  error: string | null;
  explain(args: { executionId: string; sourceHash: string; diagnosticId?: string | null; question?: string | null; evidence?: string | null }): Promise<void>;
  suggestFix(args: { executionId: string; sourceHash: string; diagnosticId?: string | null; evidence?: string | null }): Promise<void>;
  markApplied(fixId: string, before: string): void;
  verify(fixId: string, executionId: string, evidence?: string | null): Promise<void>;
  /**
   * Ask a question. With an AI model on the server the answer streams in word
   * by word; without one (or when it cannot answer) offline Saarthi answers
   * from the context.
   */
  ask(args: AskArgs, offline?: () => Omit<OfflineContext, "question">): Promise<void>;
  /** Stop the answer being written. */
  stop(): void;
  /** Start a new conversation. */
  newChat(): void;
  dismissFix(): void;
  clearForLanguage(): void;
}

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Cannot reach the server. Check your connection and try again.";
    return error.message;
  }
  return String(error);
}

let nextId = 1;

/**
 * Saarthi's client state. Nothing here runs on a timer or on typing: every
 * request starts from a button the student pressed or a question they sent.
 */
export function useSaarthi(): SaarthiApi {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [fix, setFix] = useState<FixProposal | null>(null);
  const [applied, setApplied] = useState<{ fixId: string; before: string } | null>(null);
  const [verdict, setVerdict] = useState<FixVerdict | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const answering = useRef<AbortController | null>(null);
  /** The answer the student stopped with the Stop button (not by asking again). */
  const stoppedByUser = useRef<AbortController | null>(null);
  /** Counts questions, so only the latest one clears the busy state. */
  const askTurn = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .assistantStatus()
        .then((s) => !cancelled && setStatus(s))
        .catch(() => !cancelled && setStatus(null));
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      answering.current?.abort();
    };
  }, []);

  const explain = useCallback<SaarthiApi["explain"]>(async (args) => {
    setPending("explain");
    setError(null);
    try {
      setExplanation(await api.explain(args));
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(null);
    }
  }, []);

  const suggestFix = useCallback<SaarthiApi["suggestFix"]>(async (args) => {
    setPending("fix");
    setError(null);
    setVerdict(null);
    setApplied(null);
    try {
      setFix(await api.fix(args));
    } catch (e) {
      setFix(null);
      setError(message(e));
    } finally {
      setPending(null);
    }
  }, []);

  const verify = useCallback<SaarthiApi["verify"]>(async (fixId, executionId, evidence) => {
    setPending("verify");
    setError(null);
    try {
      const fixToken = fixRef.current?.fixId === fixId ? fixRef.current.fixToken : null;
      setVerdict(await api.verify({ fixId, executionId, fixToken, evidence }));
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(null);
    }
  }, []);

  const statusRef = useRef(status);
  statusRef.current = status;

  const update = useCallback((id: number, change: (m: ChatMessage) => ChatMessage) => {
    setChat((all) => all.map((m) => (m.id === id ? change(m) : m)));
  }, []);

  const ask = useCallback<SaarthiApi["ask"]>(
    async ({ question, languageId, executionId, sourceHash, source, evidence, diagnosticId }, offline) => {
      answering.current?.abort();
      const turn = ++askTurn.current;
      const history: ChatTurn[] = chatRef.current
        .filter((m) => !m.error && !m.offline && !m.streaming && m.content.trim())
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      const userId = nextId++;
      setChat((all) => [...all, { id: userId, role: "user", content: question }]);
      setPending("ask");
      setError(null);
      const answerOffline = (reason?: string, replace?: number) => {
        if (!offline) return false;
        // The chat shows only the answer; why the AI model did not answer goes to the console.
        if (reason) console.info(`Saarthi answered from built-in knowledge (${reason})`);
        const content = offlineAnswer({ ...offline(), question });
        if (replace !== undefined) update(replace, (m) => ({ ...m, content, offline: true, streaming: false }));
        else setChat((all) => [...all, { id: nextId++, role: "assistant", content, offline: true }]);
        return true;
      };
      try {
        if (statusRef.current?.enabled !== true) {
          // No AI model on the server: answer at once from KAIRO's own knowledge.
          await new Promise((r) => setTimeout(r, 250));
          if (!answerOffline()) {
            setChat((all) => [...all, { id: nextId++, role: "assistant", content: "Saarthi's AI model is not connected on this server.", error: true }]);
          }
          return;
        }
        const id = nextId++;
        setChat((all) => [...all, { id, role: "assistant", content: "", streaming: true }]);
        const controller = new AbortController();
        answering.current = controller;
        const body: AskRequest = { question, languageId, executionId, sourceHash, source, history, evidence, diagnosticId };
        const reveal = smoothReveal((text) => update(id, (m) => ({ ...m, content: text })));
        let failed: string | null = null;
        let aborted = false;
        try {
          await api.askStream(
            body,
            (event) => {
              if (event.type === "start") update(id, (m) => ({ ...m, grounded: event.groundedOn }));
              else if (event.type === "delta") reveal.add(event.text);
              else if (event.type === "error") failed = event.detail;
            },
            controller.signal,
          );
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") aborted = true;
          else failed = message(e);
        }
        const received = !aborted && !failed;
        if (received) {
          // The whole answer is here; let the screen catch up. Stop still works meanwhile.
          const stopReveal = () => reveal.cancel();
          controller.signal.addEventListener("abort", stopReveal);
          await reveal.finish();
          controller.signal.removeEventListener("abort", stopReveal);
          aborted = controller.signal.aborted;
        }
        if (answering.current === controller) answering.current = null;
        const written = reveal.text();
        if (aborted) {
          // Stop keeps what is on screen. A new question instead finishes an answer
          // that had fully arrived, and keeps what arrived of one that had not.
          const byStop = stoppedByUser.current === controller;
          const shown = reveal.cancel();
          update(id, (m) => ({
            ...m,
            content: byStop ? shown : written,
            streaming: false,
            stopped: byStop || !received,
          }));
          return;
        }
        reveal.cancel();
        if (failed) {
          // Nothing written yet: offline Saarthi steps in. Otherwise keep what was written and say why it ended.
          if (!written.trim() && answerOffline(failed, id)) return;
          if (!written.trim()) update(id, (m) => ({ ...m, content: failed!, error: true, streaming: false }));
          else update(id, (m) => ({ ...m, content: `${written}\n\n_(${failed})_`, streaming: false }));
          return;
        }
        update(id, (m) => ({ ...m, content: written, streaming: false }));
      } catch (e) {
        if (!answerOffline(message(e))) setChat((all) => [...all, { id: nextId++, role: "assistant", content: message(e), error: true }]);
      } finally {
        if (askTurn.current === turn) setPending((p) => (p === "ask" ? null : p));
      }
    },
    [update],
  );

  const stop = useCallback(() => {
    stoppedByUser.current = answering.current;
    answering.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    answering.current?.abort();
    setChat([]);
    setPending((p) => (p === "ask" ? null : p));
  }, []);

  return {
    status,
    enabled: status?.enabled === true,
    explanation,
    fix,
    applied,
    verdict,
    chat,
    pending,
    error,
    explain,
    suggestFix,
    markApplied: useCallback((fixId: string, before: string) => {
      setApplied({ fixId, before });
      setVerdict(null);
    }, []),
    verify,
    ask,
    stop,
    newChat,
    dismissFix: useCallback(() => {
      setFix(null);
      setApplied(null);
      setVerdict(null);
    }, []),
    clearForLanguage: useCallback(() => {
      setExplanation(null);
      setFix(null);
      setApplied(null);
      setVerdict(null);
      setError(null);
    }, []),
  };
}

/**
 * Shows a streamed answer the way ChatGPT and Copilot do: whole words, a few
 * at a time, at an even pace, catching up faster when far behind. Models send
 * their answer in pieces of very different sizes (Gemini sends a sentence or
 * more at a time), so painting each piece as it arrives looks jumpy. With
 * reduced motion, or in a hidden tab, everything received is shown at once.
 */
export function smoothReveal(paint: (text: string) => void) {
  let received = "";
  let shown = 0;
  let scheduled = false;
  let cancelled = false;
  let ended = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));
  const instant = () =>
    document.hidden ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true ||
    document.querySelector<HTMLElement>(".cd-app")?.dataset.motion === "off";
  const tick = () => {
    scheduled = false;
    if (cancelled) return;
    if (shown < received.length) {
      let next = received.length;
      if (!instant()) {
        next = shown + Math.max(3, Math.ceil((received.length - shown) / 24));
        const space = received.slice(next).search(/\s/);
        next = space === -1 ? received.length : next + space;
      }
      shown = Math.min(next, received.length);
      paint(received.slice(0, shown));
    }
    if (shown < received.length) schedule();
    else if (ended) resolveFinished();
  };
  const schedule = () => {
    if (scheduled || cancelled) return;
    scheduled = true;
    // Animation frames pause in a hidden tab; a timer still runs there.
    if (document.hidden) window.setTimeout(tick, 50);
    else window.requestAnimationFrame(tick);
  };
  return {
    add(piece: string) {
      received += piece;
      schedule();
    },
    /** Everything received so far. */
    text: () => received,
    /** Resolves once everything received is on screen, or the reveal is cancelled. */
    finish(): Promise<void> {
      ended = true;
      if (shown >= received.length) resolveFinished();
      else schedule();
      return finished;
    },
    /** Stops revealing and returns what is on screen. */
    cancel(): string {
      cancelled = true;
      resolveFinished();
      return received.slice(0, shown);
    },
  };
}
