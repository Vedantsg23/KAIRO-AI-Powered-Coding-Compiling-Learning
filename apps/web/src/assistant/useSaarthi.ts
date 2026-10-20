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
  ask(args: AskArgs, offline?: () => Omit<OfflineContext, "question" | "reason">): Promise<void>;
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
        const content = offlineAnswer({ ...offline(), question, reason });
        const note = reason ? `_The AI model did not answer (${reason}), so here is what I know offline._\n\n` : "";
        if (replace !== undefined) update(replace, (m) => ({ ...m, content: note + content, offline: true, streaming: false }));
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
        // Pieces arrive many times a second: collect them and paint once per frame.
        let buffer = "";
        let written = "";
        let frame = 0;
        const flush = () => {
          frame = 0;
          if (!buffer) return;
          const piece = buffer;
          buffer = "";
          update(id, (m) => ({ ...m, content: m.content + piece }));
        };
        let failed: string | null = null;
        try {
          await api.askStream(
            body,
            (event) => {
              if (event.type === "start") update(id, (m) => ({ ...m, grounded: event.groundedOn }));
              else if (event.type === "delta") {
                buffer += event.text;
                written += event.text;
                if (!frame) frame = requestAnimationFrame(flush);
              } else if (event.type === "error") failed = event.detail;
            },
            controller.signal,
          );
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            if (frame) cancelAnimationFrame(frame);
            flush();
            update(id, (m) => ({ ...m, streaming: false, stopped: true }));
            return;
          }
          failed = message(e);
        } finally {
          if (answering.current === controller) answering.current = null;
        }
        if (frame) cancelAnimationFrame(frame);
        flush();
        if (failed) {
          // Nothing written yet: offline Saarthi steps in. Otherwise keep what was written and say why it ended.
          if (!written.trim() && answerOffline(failed, id)) return;
          if (!written.trim()) update(id, (m) => ({ ...m, content: failed!, error: true, streaming: false }));
          else update(id, (m) => ({ ...m, content: `${m.content}\n\n_(${failed})_`, streaming: false }));
          return;
        }
        update(id, (m) => ({ ...m, streaming: false }));
      } catch (e) {
        if (!answerOffline(message(e))) setChat((all) => [...all, { id: nextId++, role: "assistant", content: message(e), error: true }]);
      } finally {
        setPending((p) => (p === "ask" ? null : p));
      }
    },
    [update],
  );

  const stop = useCallback(() => answering.current?.abort(), []);

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
