import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, interrupted } from "../api/client";
import type { Execution } from "../api/types";

/**
 * Submits a run and follows it to the end over one streamed request (see
 * api.runStream). Only the latest run is followed: starting a new one stops
 * following the previous one. `run` resolves with the first snapshot (the run
 * was accepted), or rejects when the server refused it.
 */
export function useExecution() {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const following = useRef<AbortController | null>(null);

  const run = useCallback(
    (languageId: string, source: string, stdin: string) =>
      new Promise<Execution>((resolve, reject) => {
        following.current?.abort();
        const controller = new AbortController();
        following.current = controller;
        setSubmitting(true);
        let first: Execution | null = null;
        let last: Execution | null = null;
        api
          .runStream(
            { languageId, source, stdin },
            (snapshot) => {
              if (controller.signal.aborted) return;
              last = snapshot;
              setExecution(snapshot);
              if (!first) {
                first = snapshot;
                setSubmitting(false);
                resolve(snapshot);
              }
            },
            controller.signal,
          )
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setSubmitting(false);
            if (!first || !last) {
              reject(error);
              return;
            }
            // The stream broke after the run started: end it visibly instead of waiting forever.
            const message = error instanceof ApiError ? error.message : "The connection to the server was lost.";
            setExecution(interrupted(last, message));
          });
      }),
    [],
  );

  useEffect(() => () => following.current?.abort(), []);

  const busy = submitting || (execution !== null && !execution.terminal);
  return { execution, busy, run };
}
