/**
 * Account sign-in through Supabase Auth, switched on only when the web app
 * is built with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see
 * docs/accounts.md). Without them nothing here loads: the Supabase client is
 * a separate chunk imported on first use, and guests work as before.
 *
 * The publishable key is meant for browsers; access to data is governed by
 * the project's row-level security. A service-role key must never be used
 * in the web app.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { load, save } from "../lib/storage";
import { markWelcome } from "./welcome";
import { AVATARS, type AvatarId, type Profile } from "../profile/profile";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();

export const authConfigured = Boolean(url && key);

/**
 * Sign-in methods besides email and password, each switched on in the Supabase
 * project first: VITE_AUTH_PROVIDERS=google,github,azure,phone. Unset, the
 * entry page offers email and password only (they need no extra setup).
 */
export const authProviders = new Set(
  (import.meta.env.VITE_AUTH_PROVIDERS ?? "")
    .split(",")
    .map((name: string) => name.trim().toLowerCase())
    .filter(Boolean),
);

let client: Promise<SupabaseClient> | null = null;

function supabase(): Promise<SupabaseClient> {
  if (!authConfigured) return Promise.reject(new Error("Account sign-in is not configured on this server."));
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    }),
  );
  return client;
}

/** The signed-in Supabase client (for the account's cloud saves, see cloud/sync.ts). */
export const getClient = supabase;

/** Google, GitHub and Microsoft (Supabase calls it "azure"); each must be enabled in the Supabase project. */
export type OAuthProvider = "google" | "github" | "azure";

const redirectTo = () => `${window.location.origin}${window.location.pathname}`;

/** Leaves the page for the provider's consent screen; Supabase brings the student back signed in. */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  markWelcome(); // Saarthi welcomes the student when the provider sends them back
  const { error } = await (await supabase()).auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo(), scopes: provider === "azure" ? "email" : undefined },
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
  if (error) throw error;
  markWelcome();
}

/** Sends a one-time code by SMS (the Supabase project needs an SMS provider, e.g. Twilio). */
export async function sendPhoneCode(phone: string): Promise<void> {
  const { error } = await (await supabase()).auth.signInWithOtp({ phone });
  if (error) throw error;
}

export async function verifyPhoneCode(phone: string, token: string): Promise<void> {
  const { error } = await (await supabase()).auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
  markWelcome();
}

/** Emails a link that brings the student back here to choose a new password. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await (await supabase()).auth.updateUser({ password });
  if (error) throw error;
}

/** Returns true when the project asks the student to confirm the address by email first. */
export async function signUpWithEmail(email: string, password: string, name: string): Promise<boolean> {
  const { data, error } = await (await supabase()).auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo(), data: { full_name: name } },
  });
  if (error) throw error;
  return data.session === null;
}

export async function signOut(): Promise<void> {
  if (!authConfigured) return;
  await (await supabase()).auth.signOut();
}

/**
 * Calls back with the current session now and whenever it changes. `recovery`
 * is true when the student arrived from a password-reset email.
 */
export function watchSession(callback: (session: Session | null, recovery?: boolean) => void): () => void {
  if (!authConfigured) {
    callback(null);
    return () => undefined;
  }
  let unsubscribe = () => undefined as void;
  let cancelled = false;
  void supabase().then(async (sb) => {
    const { data } = await sb.auth.getSession();
    if (!cancelled) callback(data.session);
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (!cancelled) callback(session, event === "PASSWORD_RECOVERY");
    });
    unsubscribe = () => sub.subscription.unsubscribe();
    if (cancelled) unsubscribe();
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/** The account's KAIRO profile; the avatar choice is remembered per account in this browser. */
export function profileFromSession(session: Session): Profile {
  const user = session.user;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    [meta.full_name, meta.name, meta.user_name, user.email?.split("@")[0]].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    ) ?? "Coder";
  const stored = load<string | null>(`cd.avatar.${user.id}`, null);
  const avatar: AvatarId = AVATARS.some((a) => a.id === stored) ? (stored as AvatarId) : "comet";
  return {
    id: user.id,
    name: name.slice(0, 24),
    avatar,
    experience: load<Profile["experience"]>(`cd.experience.${user.id}`, "some"),
    kind: "account",
    email: user.email ?? undefined,
    createdAt: user.created_at,
  };
}

export function rememberAccountChoices(userId: string, avatar: AvatarId, experience: Profile["experience"]): void {
  save(`cd.avatar.${userId}`, avatar);
  save(`cd.experience.${userId}`, experience);
}
