/**
 * Cloud saves for signed-in accounts (Supabase, see supabase/migrations).
 *
 * The workspace keeps working from this browser's storage exactly as for
 * guests; for an account those keys are named after the account, and this
 * module mirrors them to the account's rows:
 *
 *   cd.drafts.<id>, cd.stdin.<id>   -> code_files (one row per language)
 *   cd.progress.<id>                -> progress   (XP, level, streaks, badges)
 *   k.notebook.<id>                 -> notebooks  ("main")
 *   the device settings below       -> settings   (theme, motion, extensions, layout...)
 *   finished runs                   -> runs       (language, result, time; no code)
 *
 * hydrate() runs once after sign-in, before the workspace opens: it pulls the
 * account's rows and merges them with what this browser has (whatever changed
 * since the last sync wins; when both changed, this browser's copy is kept and
 * uploaded). The mirror then uploads changes every few seconds and when the
 * tab is hidden. Sign-out uploads what is left, then removes the account's
 * copies from this browser.
 *
 * Row Level Security on every table limits each account to its own rows; the
 * browser uses the publishable key only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClient } from "../auth/supabase";

export const SETTINGS_KEYS = [
  "cd.theme",
  "cd.motion",
  "k.sound",
  "k.extensions",
  "k.fontSize",
  "k.layout",
  "k.dock",
  "k.explorer",
  "k.panel.open",
  "k.sideView",
  "k.split.diag",
  "k.nb.terminal",
  "cd.language",
] as const;

export const keysFor = (userId: string) => ({
  drafts: `cd.drafts.${userId}`,
  stdin: `cd.stdin.${userId}`,
  progress: `cd.progress.${userId}`,
  notebook: `k.notebook.${userId}`,
  sync: `k.sync.${userId}`,
});

const MAX_SOURCE_BYTES = 131_072; // code_files.source check
const MAX_STDIN_BYTES = 32_768;
const MAX_PROGRESS_BYTES = 60_000;
const MAX_SETTINGS_BYTES = 15_000;
const MAX_NOTEBOOK_BYTES = 500_000;

export type SyncStatus = "off" | "loading" | "synced" | "saving" | "offline";

// ------------------------------------------------------------ small helpers

function raw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked or full: the cloud copy still exists
  }
}

function parse<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** A short fingerprint (FNV-1a + length) to tell whether a value changed since it was synced. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** What was last in sync with the cloud, per item (fingerprints only). */
interface SyncMeta {
  drafts: Record<string, string>;
  stdin: Record<string, string>;
  progress?: string;
  settings?: string;
  notebook?: string;
}

const emptyMeta = (): SyncMeta => ({ drafts: {}, stdin: {} });

export function settingsSnapshot(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    const value = raw(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

/**
 * Merge one item: `local` and `cloud` are the two copies, `synced` the
 * fingerprint of the last copy both had. Returns the winner and whether the
 * cloud needs it.
 */
export function mergeItem(local: string | undefined, cloud: string | undefined, synced: string | undefined): { value: string | undefined; upload: boolean } {
  if (local === undefined) return { value: cloud, upload: false };
  if (cloud === undefined) return { value: local, upload: true };
  if (local === cloud) return { value: local, upload: false };
  const localChanged = synced === undefined || fingerprint(local) !== synced;
  const cloudChanged = synced === undefined || fingerprint(cloud) !== synced;
  if (!localChanged) return { value: cloud, upload: false }; // changed on another device
  if (!cloudChanged) return { value: local, upload: true }; // changed here
  return { value: local, upload: true }; // changed on both: this browser's copy wins
}

/** The progress with more XP (it contains the other's history), the cloud's on a tie. */
export function mergeProgress(local: string | undefined, cloud: string | undefined): { value: string | undefined; upload: boolean } {
  if (local === undefined) return { value: cloud, upload: false };
  if (cloud === undefined) return { value: local, upload: true };
  const xp = (text: string) => Number(parse<{ xp?: number }>(text, {}).xp ?? 0);
  return xp(local) > xp(cloud) ? { value: local, upload: true } : { value: cloud, upload: false };
}

// --------------------------------------------------------------- hydration

export interface CloudProfile {
  displayName: string;
  avatar: string;
  experience: string;
}

export interface Hydrated {
  profile: CloudProfile | null;
}

/** Pull the account's rows and merge them into this browser's storage. Throws when the cloud cannot be reached. */
export async function hydrate(userId: string): Promise<Hydrated> {
  const sb = await getClient();
  const keys = keysFor(userId);
  const [files, progress, settings, notebook, profile] = await Promise.all([
    sb.from("code_files").select("language_id, source, stdin").eq("user_id", userId),
    sb.from("progress").select("data").eq("user_id", userId).maybeSingle(),
    sb.from("settings").select("data").eq("user_id", userId).maybeSingle(),
    sb.from("notebooks").select("content").eq("user_id", userId).eq("name", "main").maybeSingle(),
    sb.from("profiles").select("display_name, avatar, experience").eq("id", userId).maybeSingle(),
  ]);
  for (const result of [files, progress, settings, notebook, profile]) if (result.error) throw result.error;

  const meta = parse<SyncMeta>(raw(keys.sync), emptyMeta());
  const next: SyncMeta = emptyMeta();

  // Drafts and program input, per language.
  const localDrafts = parse<Record<string, string>>(raw(keys.drafts), {});
  const localStdin = parse<Record<string, string>>(raw(keys.stdin), {});
  const cloudDrafts: Record<string, string> = {};
  const cloudStdin: Record<string, string> = {};
  for (const row of (files.data ?? []) as { language_id: string; source: string; stdin: string }[]) {
    cloudDrafts[row.language_id] = row.source;
    if (row.stdin) cloudStdin[row.language_id] = row.stdin;
  }
  // Items that must be uploaded get no fingerprint in the new meta, so the mirror's first pass sends them.
  const drafts: Record<string, string> = {};
  const stdin: Record<string, string> = {};
  for (const id of new Set([...Object.keys(localDrafts), ...Object.keys(cloudDrafts)])) {
    const merged = mergeItem(localDrafts[id], cloudDrafts[id], meta.drafts[id]);
    if (merged.value !== undefined) drafts[id] = merged.value;
    if (!merged.upload && merged.value !== undefined) next.drafts[id] = fingerprint(merged.value);
  }
  for (const id of new Set([...Object.keys(localStdin), ...Object.keys(cloudStdin)])) {
    const merged = mergeItem(localStdin[id], cloudStdin[id] ?? (id in cloudDrafts ? "" : undefined), meta.stdin[id]);
    if (merged.value) stdin[id] = merged.value;
    if (!merged.upload) next.stdin[id] = fingerprint(merged.value ?? "");
  }
  put(keys.drafts, JSON.stringify(drafts));
  put(keys.stdin, JSON.stringify(stdin));

  // Progress: the copy with more XP.
  const cloudProgress = progress.data?.data && Object.keys(progress.data.data).length ? JSON.stringify(progress.data.data) : undefined;
  const p = mergeProgress(raw(keys.progress) ?? undefined, cloudProgress);
  if (p.value !== undefined) put(keys.progress, p.value);
  if (!p.upload && p.value !== undefined) next.progress = fingerprint(p.value);

  // Settings: the device keys, as one object.
  const localSettings = settingsSnapshot();
  const cloudSettingsData = (settings.data?.data ?? null) as Record<string, string> | null;
  const s = mergeItem(
    Object.keys(localSettings).length ? JSON.stringify(localSettings) : undefined,
    cloudSettingsData && Object.keys(cloudSettingsData).length ? JSON.stringify(cloudSettingsData) : undefined,
    meta.settings,
  );
  if (s.value !== undefined) {
    const values = parse<Record<string, string>>(s.value, {});
    for (const key of SETTINGS_KEYS) if (typeof values[key] === "string") put(key, values[key]);
    if (!s.upload) next.settings = fingerprint(s.value);
  }

  // The notebook.
  const cloudNotebook = notebook.data?.content ? JSON.stringify(notebook.data.content) : undefined;
  const n = mergeItem(raw(keys.notebook) ?? undefined, cloudNotebook, meta.notebook);
  if (n.value !== undefined) {
    put(keys.notebook, n.value);
    if (!n.upload) next.notebook = fingerprint(n.value);
  }

  put(keys.sync, JSON.stringify(next));
  window.dispatchEvent(new Event("kairo:settings"));

  const row = profile.data as { display_name: string; avatar: string; experience: string } | null;
  return { profile: row ? { displayName: row.display_name, avatar: row.avatar, experience: row.experience } : null };
}

// ------------------------------------------------------------------ mirror

/** Uploads this account's changes every few seconds and when the tab is hidden. */
export class CloudMirror {
  status: SyncStatus = "synced";
  private timer = 0;
  private running: Promise<void> | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();
  private stopped = false;

  constructor(
    private readonly userId: string,
    private readonly intervalMs = 4000,
  ) {}

  start(): () => void {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void this.flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    this.timer = window.setInterval(() => void this.flush(), this.intervalMs);
    void this.flush();
    return () => {
      this.stopped = true;
      window.clearInterval(this.timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
    };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => void this.listeners.delete(listener);
  }

  private set(status: SyncStatus) {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  /** Upload whatever changed since the last sync (runs one at a time). */
  flush(): Promise<void> {
    if (this.running) return this.running.then(() => this.flush());
    this.running = this.upload()
      .then(() => this.set("synced"))
      .catch(() => this.set("offline"))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async upload(): Promise<void> {
    const keys = keysFor(this.userId);
    const meta = parse<SyncMeta>(raw(keys.sync), emptyMeta());
    const drafts = parse<Record<string, string>>(raw(keys.drafts), {});
    const stdin = parse<Record<string, string>>(raw(keys.stdin), {});
    const rows: { user_id: string; language_id: string; source: string; stdin: string }[] = [];
    for (const id of new Set([...Object.keys(drafts), ...Object.keys(stdin)])) {
      const source = drafts[id] ?? "";
      const input = stdin[id] ?? "";
      if (fingerprint(source) === meta.drafts[id] && fingerprint(input) === (meta.stdin[id] ?? fingerprint(""))) continue;
      if (bytes(source) > MAX_SOURCE_BYTES || bytes(input) > MAX_STDIN_BYTES) continue; // too big to keep online
      if (!/^[a-z0-9][a-z0-9_+.-]{0,39}$/.test(id)) continue;
      rows.push({ user_id: this.userId, language_id: id, source, stdin: input });
    }
    const progress = raw(keys.progress);
    const settings = JSON.stringify(settingsSnapshot());
    const notebook = raw(keys.notebook);
    const progressDue = progress !== null && fingerprint(progress) !== meta.progress && bytes(progress) <= MAX_PROGRESS_BYTES;
    const settingsDue = fingerprint(settings) !== meta.settings && bytes(settings) <= MAX_SETTINGS_BYTES;
    const notebookDue = notebook !== null && fingerprint(notebook) !== meta.notebook && bytes(notebook) <= MAX_NOTEBOOK_BYTES;
    if (!rows.length && !progressDue && !settingsDue && !notebookDue) return;
    if (this.stopped) return;

    this.set("saving");
    const sb = await getClient();
    const jobs: Promise<unknown>[] = [];
    if (rows.length) jobs.push(check(sb.from("code_files").upsert(rows, { onConflict: "user_id,language_id" })));
    if (progressDue) {
      const data = parse<{ xp?: number; badges?: Record<string, string> }>(progress, {});
      jobs.push(
        check(
          sb.from("progress").upsert(
            { user_id: this.userId, data, xp: Math.max(0, Math.round(data.xp ?? 0)), badges: Object.keys(data.badges ?? {}).length },
            { onConflict: "user_id" },
          ),
        ),
      );
    }
    if (settingsDue) jobs.push(check(sb.from("settings").upsert({ user_id: this.userId, data: JSON.parse(settings) }, { onConflict: "user_id" })));
    if (notebookDue) {
      jobs.push(check(sb.from("notebooks").upsert({ user_id: this.userId, name: "main", content: JSON.parse(notebook!) }, { onConflict: "user_id,name" })));
    }
    await Promise.all(jobs);

    // Record what is now in the cloud (re-read the meta: another flush may have written it).
    const after = parse<SyncMeta>(raw(keys.sync), emptyMeta());
    for (const row of rows) {
      after.drafts[row.language_id] = fingerprint(row.source);
      after.stdin[row.language_id] = fingerprint(row.stdin);
    }
    if (progressDue) after.progress = fingerprint(progress!);
    if (settingsDue) after.settings = fingerprint(settings);
    if (notebookDue) after.notebook = fingerprint(notebook!);
    put(keys.sync, JSON.stringify(after));
  }
}

async function check(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

/** One finished run in the account's history (no code is stored, only the outcome). */
export async function recordRun(run: { languageId: string; state: string; durationMs: number | null; errors: number }): Promise<void> {
  try {
    const sb = await getClient();
    await sb.from("runs").insert({
      language_id: run.languageId.slice(0, 40),
      state: run.state.slice(0, 32),
      duration_ms: run.durationMs !== null && run.durationMs >= 0 ? Math.round(run.durationMs) : null,
      errors: Math.max(0, run.errors),
    });
  } catch {
    // history is a nice-to-have: never disturb the student
  }
}

/** The account's latest runs, newest first. */
export async function recentRuns(limit = 8): Promise<{ language_id: string; state: string; duration_ms: number | null; errors: number; created_at: string }[]> {
  const sb = await getClient();
  const { data, error } = await sb.from("runs").select("language_id, state, duration_ms, errors, created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function saveProfileRow(userId: string, profile: { name: string; avatar: string; experience: string }): Promise<void> {
  const sb: SupabaseClient = await getClient();
  await check(
    sb
      .from("profiles")
      .upsert({ id: userId, display_name: profile.name.slice(0, 40) || "Coder", avatar: profile.avatar, experience: profile.experience }, { onConflict: "id" }),
  );
}

/** Sign-out: remove the account's copies from this browser (after a last upload). */
export function forgetAccount(userId: string): void {
  const keys = keysFor(userId);
  for (const key of [keys.drafts, keys.stdin, keys.progress, keys.notebook, keys.sync]) put(key, null);
}
