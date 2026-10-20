import type {
  AskAnswer,
  AssistantStatus,
  ChatTurn,
  Execution,
  Explanation,
  FixProposal,
  FixVerdict,
  Health,
  Language,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

const OFFLINE = "Cannot reach the server. Check your internet connection and try again.";

/** The error a failed response carries ({"detail": ...}), as an ApiError. */
async function errorFrom(response: Response): Promise<ApiError> {
  let detail = response.statusText || `HTTP ${response.status}`;
  let retryAfter: number | null = null;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("; ");
    if (typeof body.retryAfterS === "number") retryAfter = body.retryAfterS;
  } catch {
    // not JSON; keep the status text
  }
  const header = response.headers.get("Retry-After");
  if (retryAfter === null && header && !Number.isNaN(Number(header))) retryAfter = Number(header);
  return new ApiError(detail, response.status, retryAfter);
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE, 0);
  }
  if (!response.ok) throw await errorFrom(response);
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await send(path, init)).json()) as T;
}

const post = <T,>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body), signal });

/**
 * The objects of an NDJSON body (one JSON value per line), as they arrive.
 * Empty lines (the server's keep-alives) are skipped.
 */
export async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as T;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer) as T;
  } finally {
    reader.releaseLock();
  }
}

/** A run whose stream broke off: shown as finished, with the reason, so nothing waits forever. */
export function interrupted(last: Execution, message: string): Execution {
  return {
    ...last,
    terminal: true,
    state: "INTERNAL_ERROR",
    summary: message,
    error: message,
    evidence: null,
    steps: last.steps.map((s) => (s.status === "RUNNING" || s.status === "PENDING" ? { ...s, status: "SKIPPED" } : s)),
  };
}

export interface RunRequest {
  languageId: string;
  source: string;
  stdin: string;
}

/** Saarthi's streamed answer, event by event (POST /api/v1/assistant/ask/stream). */
export type AskEvent =
  | { type: "start"; groundedOn: AskAnswer["groundedOn"]; executionId: string | null; sourceHash: string | null; provider: string; model: string }
  | { type: "delta"; text: string }
  | { type: "done"; cached: boolean }
  | { type: "error"; detail: string; retryAfterS: number | null };

export interface AskRequest {
  question: string;
  languageId?: string | null;
  executionId?: string | null;
  sourceHash?: string | null;
  source?: string | null;
  history?: ChatTurn[];
  /** The run's sealed evidence (Execution.evidence), so any server instance can answer. */
  evidence?: string | null;
  /** With executionId: the diagnostic the question is about. */
  diagnosticId?: string | null;
}

export const api = {
  languages: () => request<Language[]>("/api/v1/languages"),
  health: () => request<Health>("/api/v1/health"),
  getExecution: (id: string) => request<Execution>(`/api/v1/executions/${encodeURIComponent(id)}`),
  createExecution: (body: RunRequest) => post<Execution>("/api/v1/executions", body),

  /**
   * Compile and run, following the run over the same request (NDJSON): one
   * snapshot per change, ending with the terminal one, which is returned.
   * Works on every host, including serverless ones without WebSockets.
   * Refusals (busy, too large, unknown language) reject before any snapshot.
   */
  async runStream(body: RunRequest, onUpdate?: (execution: Execution) => void, signal?: AbortSignal): Promise<Execution> {
    const response = await send("/api/v1/executions/run", { method: "POST", body: JSON.stringify(body), signal });
    if (!response.body) throw new ApiError("The server sent no data for this run.", 0);
    let last: Execution | null = null;
    try {
      for await (const line of ndjson<Execution | { detail: string }>(response.body)) {
        if (!("id" in line)) throw new ApiError(line.detail || "The run was lost on the server.", 0);
        last = line;
        onUpdate?.(line);
        if (line.terminal) return line;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("The connection to the server was lost while your program ran. Run it again.", 0);
    }
    throw new ApiError(
      last ? "The connection to the server was lost while your program ran. Run it again." : "The server sent no result for this run.",
      0,
    );
  },

  // Saarthi: every call is triggered by a student's click, never by typing.
  assistantStatus: () => request<AssistantStatus>("/api/v1/assistant/status"),
  explain: (body: { executionId: string; sourceHash: string; diagnosticId?: string | null; question?: string | null; evidence?: string | null }) =>
    post<Explanation>("/api/v1/assistant/explain", body),
  fix: (body: { executionId: string; sourceHash: string; diagnosticId?: string | null; evidence?: string | null }) =>
    post<FixProposal>("/api/v1/assistant/fix", body),
  verify: (body: { fixId: string; executionId: string; fixToken?: string | null; evidence?: string | null }) =>
    post<FixVerdict>("/api/v1/assistant/verify", body),
  ask: (body: AskRequest) => post<AskAnswer>("/api/v1/assistant/ask", body),

  /**
   * Ask Saarthi and receive the answer while it is written (like ChatGPT or
   * Copilot). Problems found before the model answers (stale code, limits)
   * reject; problems after it started arrive as an "error" event.
   */
  async askStream(body: AskRequest, onEvent: (event: AskEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await send("/api/v1/assistant/ask/stream", { method: "POST", body: JSON.stringify(body), signal });
    if (!response.body) throw new ApiError("Saarthi sent no answer.", 0);
    let ended = false;
    try {
      for await (const event of ndjson<AskEvent>(response.body)) {
        onEvent(event);
        if (event.type === "done" || event.type === "error") ended = true;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      throw new ApiError("The connection to Saarthi was lost. Please ask again.", 0);
    }
    if (!ended) throw new ApiError("Saarthi stopped before finishing the answer. Please ask again.", 0);
  },

  // The one exception: AI autocomplete (an extension the student switches on)
  // asks for ghost text after a pause in typing, with the code around the cursor.
  complete: (body: { languageId: string; prefix: string; suffix: string; maxLines?: number }, signal?: AbortSignal) =>
    post<{ completion: string; provider: string; model: string; cached: boolean }>("/api/v1/assistant/complete", body, signal),
};

function websocketUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

/**
 * Follow an execution until it reaches a terminal state, over the WebSocket
 * event stream (a full snapshot per change), falling back to polling. Kept
 * for API clients and the Docker setup; the app itself uses runStream, which
 * also works where WebSockets do not. Returns a function that stops watching.
 */
export function watchExecution(
  id: string,
  onUpdate: (execution: Execution) => void,
  pollIntervalMs = 400,
): () => void {
  let stopped = false;
  let finished = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deliver = (execution: Execution) => {
    if (stopped) return;
    onUpdate(execution);
    if (execution.terminal) {
      finished = true;
      stop();
    }
  };

  const poll = async () => {
    if (stopped || finished) return;
    try {
      deliver(await api.getExecution(id));
    } catch {
      // transient; try again
    }
    if (!stopped && !finished) timer = setTimeout(poll, pollIntervalMs);
  };

  function stop() {
    stopped = true;
    clearTimeout(timer);
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }

  try {
    socket = new WebSocket(websocketUrl(`/api/v1/executions/${encodeURIComponent(id)}/events`));
    socket.onmessage = (event) => deliver(JSON.parse(event.data) as Execution);
    socket.onclose = () => {
      if (!stopped && !finished) void poll();
    };
  } catch {
    void poll();
  }
  return stop;
}
