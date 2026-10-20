import { ArrowRight, Eye, EyeOff, GitBranch, Globe, KeyRound, Loader2, Lock, Mail, MonitorSmartphone, Phone, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../ui/primitives";
import {
  authConfigured,
  authProviders,
  sendPasswordReset,
  sendPhoneCode,
  signInWithEmail,
  signInWithProvider,
  signUpWithEmail,
  verifyPhoneCode,
  type OAuthProvider,
} from "./supabase";

/**
 * Account sign-in and sign-up for the entry page: Google, GitHub and
 * Microsoft, a one-time code by SMS, and email with a password (with a reset
 * link). Everything goes through Supabase Auth and is switched on only when
 * the web app is built with the project's URL and publishable key (see
 * docs/accounts.md); until then the forms are shown disabled with a note, and
 * students start as guests.
 */

type Mode = "signin" | "signup";

const COUNTRIES = [
  { code: "+91", label: "IN", name: "India" },
  { code: "+1", label: "US", name: "USA and Canada" },
  { code: "+44", label: "UK", name: "United Kingdom" },
  { code: "+971", label: "AE", name: "United Arab Emirates" },
  { code: "+61", label: "AU", name: "Australia" },
  { code: "+65", label: "SG", name: "Singapore" },
  { code: "+49", label: "DE", name: "Germany" },
];

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-fg outline-none transition-shadow placeholder:text-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--cd-brand)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="k-label my-4 flex items-center gap-3 !text-[9.5px]">
      <span className="h-px flex-1 bg-line-strong" /> {children} <span className="h-px flex-1 bg-line-strong" />
    </div>
  );
}

function Message({ message }: { message: { tone: "ok" | "error"; text: string } | null }) {
  if (!message) return null;
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`mt-3 rounded-md border px-3 py-2 text-[12px] leading-snug ${
        message.tone === "error" ? "border-danger/40 bg-danger/8 text-danger-fg" : "border-brand/40 bg-brand/8 text-brand-fg"
      }`}
      data-testid="account-message"
    >
      {message.text}
    </p>
  );
}

export function AccountPanel({ mode, onGuest, onMode }: { mode: Mode; onGuest(): void; onMode(mode: Mode): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // phone
  const [country, setCountry] = useState("+91");
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  // email
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const off = !authConfigured;
  const fullPhone = `${country}${phone.replace(/[^\d]/g, "")}`;
  const phoneOk = /^\+\d{8,15}$/.test(fullPhone);

  const run = async (what: string, action: () => Promise<void>, done?: string) => {
    setBusy(what);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ tone: "ok", text: done });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const provider = (id: OAuthProvider) => void run(id, () => signInWithProvider(id));

  // Only the providers switched on for this deployment (VITE_AUTH_PROVIDERS); email always works.
  const oauth = (
    [
      ["google", "Google", <Globe key="g" size={15} />],
      ["github", "GitHub", <GitBranch key="h" size={15} />],
      ["azure", "Microsoft", <MonitorSmartphone key="m" size={15} />],
    ] as const
  ).filter(([id]) => off || authProviders.has(id));
  const phoneOn = off || authProviders.has("phone");
  const providers = oauth.length > 0 && (
    <div className={`grid gap-2 ${oauth.length === 1 ? "grid-cols-1" : oauth.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {oauth.map(([id, label, icon]) => (
        <Button
          key={id}
          onClick={() => provider(id)}
          disabled={off || busy !== null}
          data-testid={id === "azure" ? "login-microsoft" : `login-${id}`}
          title={off ? "Account sign-in is not set up on this server" : `Continue with ${label}`}
          className="!px-2"
        >
          {busy === id ? <Loader2 size={15} className="animate-spin" /> : icon} {label}
        </Button>
      ))}
    </div>
  );

  const offNote = off && (
    <div className="mt-4 rounded-md border border-line bg-raised px-3 py-2.5" data-testid="login-accounts-off">
      <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted">
        <Lock size={12} className="mt-0.5 shrink-0" />
        Accounts (Google, GitHub, Microsoft, phone and email) turn on when this server is connected to Supabase. Until then, start as a guest:
        your code, badges and streaks stay in this browser.
      </p>
      <button type="button" onClick={onGuest} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-fg hover:underline" data-testid="login-use-guest">
        Continue as a guest <ArrowRight size={13} />
      </button>
    </div>
  );

  if (mode === "signup") {
    const problems = [
      !name.trim() && "your name",
      !EMAIL.test(email) && "a valid email",
      password.length < 8 && "a password of at least 8 characters",
      password !== confirm && "the same password twice",
    ].filter(Boolean) as string[];
    const create = (e: FormEvent) => {
      e.preventDefault();
      if (problems.length) {
        setMessage({ tone: "error", text: `Please enter ${problems.join(", ")}.` });
        return;
      }
      void run("signup", async () => {
        const confirmFirst = await signUpWithEmail(email.trim(), password, name.trim());
        setMessage({
          tone: "ok",
          text: confirmFirst
            ? `Account created. We sent a link to ${email.trim()}: open it to confirm your address, then sign in.`
            : "Account created. Welcome to KAIRO!",
        });
      });
    };
    return (
      <div data-testid="account-signup">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Create your account</h2>
        <p className="mt-1 text-sm text-muted">Keep your code, badges and streaks with you, on any device.</p>
        <form className="mt-4 flex flex-col gap-2.5" onSubmit={create} noValidate>
          <label className="flex flex-col gap-1">
            <span className="k-label">Your name</span>
            <span className="relative">
              <UserRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={off} autoComplete="name" maxLength={40} className={`${inputClass} pl-8`} data-testid="signup-name" placeholder="Vedant Gadage" />
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="k-label">Email</span>
            <span className="relative">
              <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={off} autoComplete="email" className={`${inputClass} pl-8`} data-testid="signup-email" placeholder="you@college.edu" />
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="k-label">Password</span>
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={off} autoComplete="new-password" className={inputClass} data-testid="signup-password" placeholder="8+ characters" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="k-label">Confirm</span>
              <input type={showPassword ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={off} autoComplete="new-password" className={inputClass} data-testid="signup-confirm" placeholder="Again" />
            </label>
          </div>
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="flex w-fit items-center gap-1 text-[11.5px] text-muted hover:text-fg" disabled={off}>
            {showPassword ? <EyeOff size={12} /> : <Eye size={12} />} {showPassword ? "Hide" : "Show"} passwords
          </button>
          <Button type="submit" variant="primary" disabled={off || busy !== null} className="mt-1 h-11 w-full font-mono text-[12px] uppercase tracking-[0.14em]" data-testid="signup-create">
            {busy === "signup" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Create account
          </Button>
        </form>
        {(providers || phoneOn) && <Divider>or sign up with</Divider>}
        {providers}
        {phoneOn && (
          <button
            type="button"
            onClick={() => onMode("signin")}
            disabled={off}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12.5px] font-semibold text-fg hover:border-brand/60 disabled:opacity-60"
          >
            <Phone size={14} /> Your phone number
          </button>
        )}
        <Message message={message} />
        {offNote}
        <p className="mt-4 text-center text-[12px] text-muted">
          Already have an account?{" "}
          <button type="button" onClick={() => onMode("signin")} className="font-semibold text-brand-fg hover:underline">
            Sign in
          </button>
        </p>
      </div>
    );
  }

  return (
    <div data-testid="account-signin">
      <h2 className="text-2xl font-semibold tracking-tight text-fg">Welcome back</h2>
      <p className="mt-1 text-sm text-muted">Sign in to pick up your code, badges and streaks.</p>
      {providers && <div className="mt-4">{providers}</div>}

      {phoneOn && <Divider>{providers ? "or with your phone" : "with your phone"}</Divider>}
      {!phoneOn ? null : !codeSent ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!phoneOk) return setMessage({ tone: "error", text: "Enter your mobile number, without the country code." });
            void run("phone", async () => {
              await sendPhoneCode(fullPhone);
              setCodeSent(true);
            }, `We sent a 6-digit code to ${fullPhone}.`);
          }}
        >
          <select value={country} onChange={(e) => setCountry(e.target.value)} disabled={off} aria-label="Country code" className={`${inputClass} !w-[96px] shrink-0 px-2`}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code} title={c.name}>
                {c.code} {c.label}
              </option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={off}
            autoComplete="tel-national"
            placeholder="98765 43210"
            aria-label="Mobile number"
            className={inputClass}
            data-testid="login-phone"
          />
          <Button type="submit" disabled={off || busy !== null} className="shrink-0" data-testid="login-phone-send">
            {busy === "phone" ? <Loader2 size={15} className="animate-spin" /> : <Phone size={15} />} Send code
          </Button>
        </form>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("verify", () => verifyPhoneCode(fullPhone, code.trim()));
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            aria-label="The code from the SMS"
            className={`${inputClass} font-mono tracking-[0.3em]`}
            data-testid="login-phone-code"
          />
          <Button type="submit" variant="primary" disabled={busy !== null || code.length < 6} className="shrink-0" data-testid="login-phone-verify">
            {busy === "verify" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Verify
          </Button>
          <button type="button" onClick={() => setCodeSent(false)} className="shrink-0 text-[11.5px] text-muted hover:text-fg">
            Change
          </button>
        </form>
      )}

      {providers || phoneOn ? <Divider>or with email</Divider> : <div className="mt-4" />}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!EMAIL.test(email) || !password) return setMessage({ tone: "error", text: "Enter your email and password." });
          void run("email", () => signInWithEmail(email.trim(), password));
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={off} placeholder="Email" autoComplete="email" aria-label="Email" className={inputClass} data-testid="login-email" />
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={off}
            placeholder="Password"
            autoComplete="current-password"
            aria-label="Password"
            className={`${inputClass} pr-9`}
            data-testid="login-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide the password" : "Show the password"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg"
            disabled={off}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={off || busy !== null} className="flex-1" data-testid="login-email-signin">
            {busy === "email" ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Sign in
          </Button>
          <button
            type="button"
            disabled={off || busy !== null}
            onClick={() => {
              if (!EMAIL.test(email)) return setMessage({ tone: "error", text: "Enter your email first, then press Forgot password." });
              void run("reset", () => sendPasswordReset(email.trim()), `If ${email.trim()} has an account, a reset link is on its way.`);
            }}
            className="text-[12px] font-semibold text-brand-fg hover:underline disabled:opacity-60"
            data-testid="login-forgot"
          >
            Forgot password?
          </button>
        </div>
      </form>
      <Message message={message} />
      {offNote}
      <p className="mt-4 text-center text-[12px] text-muted">
        New to KAIRO?{" "}
        <button type="button" onClick={() => onMode("signup")} className="font-semibold text-brand-fg hover:underline" data-testid="login-to-signup">
          Create an account
        </button>
      </p>
    </div>
  );
}
