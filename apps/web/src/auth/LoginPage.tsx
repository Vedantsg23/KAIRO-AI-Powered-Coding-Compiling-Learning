import { ArrowDown, ArrowRight, Moon, Radar, ShieldCheck, Sparkles, Sun, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { CodeField } from "../fx/CodeField";
import { SceneCanvas, type Scene } from "../fx/SceneCanvas";
import { useFx } from "../fx/context";
import { CustomCursor } from "../fx/CustomCursor";
import { Tilt } from "../fx/pointer";
import { Counter, Marquee, Reveal, useScrollProgress } from "../fx/scroll";
import { Scramble, SplitText } from "../fx/text";
import { LANGUAGE_BADGE, LANGUAGE_NAMES, VERIFIED_LANGUAGES } from "../layout/LanguagePicker";
import { KairoLogo } from "../layout/Logo";
import type { Theme } from "../lib/hooks";
import { LIVE_LANGUAGES } from "../live/support";
import { useSaarthiHello } from "../mascot/SaarthiHello";
import type { MascotMood } from "../mascot/SaarthiMascot";
import { exampleCount } from "../onboarding/examples";
import { BADGES } from "../profile/achievements";
import { Avatar } from "../profile/Avatar";
import { AVATARS, cleanName, EXPERIENCE, newGuest, recentGuests, type AvatarId, type Experience, type Profile } from "../profile/profile";
import { Button } from "../ui/primitives";
import { CodeTypewriter } from "./CodeTypewriter";
import { HeroStage } from "./HeroStage";
import { PipelineTour } from "./PipelineTour";
import { Playground } from "./Playground";
import { AccountPanel } from "./AccountPanel";
import { InstallButton, useInstall } from "../pwa/install";

const START_WITH = ["c", "python", "java", "javascript", "cpp", "go"];

/**
 * The page's chapters. As you scroll, the chapter in the middle of the screen
 * sets the page's tone (the theme, or its opposite: the page turns from dark
 * to light and back) and the scene drawn behind it.
 */
const CHAPTERS: Record<string, { tone: "base" | "invert"; scene: Scene }> = {
  hero: { tone: "base", scene: "none" },
  languages: { tone: "base", scene: "stars" },
  pipeline: { tone: "invert", scene: "grid" },
  features: { tone: "invert", scene: "waves" },
  try: { tone: "invert", scene: "waves" },
  demo: { tone: "base", scene: "orbits" },
};

export const SAARTHI_HELLO = {
  title: "Hii! I'm Saarthi",
  text: "Your coding guide in KAIRO. I explain errors in plain words and suggest fixes you can check with a real run.",
};
const START_NAMES: Record<string, string> = { c: "C", python: "Python", java: "Java", javascript: "JavaScript", cpp: "C++", go: "Go" };

/** Arrow keys move between the options of a radio group, like native radios. */
function radioKeys<T extends string>(e: KeyboardEvent<HTMLDivElement>, options: T[], value: T, set: (v: T) => void) {
  const i = options.indexOf(value);
  let next = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
  if (next < 0) return;
  e.preventDefault();
  set(options[next]);
  (e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[next] as HTMLElement | undefined)?.focus();
}

function Feature({ index, icon, title, body, delay }: { index: string; icon: ReactNode; title: string; body: string; delay: number }) {
  return (
    <Reveal as="li" delay={delay}>
      <Tilt max={5} className="h-full rounded-lg">
        <div className="flex h-full flex-col gap-2 rounded-lg border border-line bg-surface p-5 shadow-[var(--cd-shadow)] transition-colors hover:border-brand/50">
          <span className="flex items-center gap-2">
            <span className="k-index">{index}</span>
            <span className="text-brand-fg">{icon}</span>
            <Scramble text={title} mount={false} className="k-label !text-fg" />
          </span>
          <span className="text-[13.5px] leading-relaxed text-muted">{body}</span>
        </div>
      </Tilt>
    </Reveal>
  );
}

/** A link in the entry page's top bar: scrolls to its chapter (or, for Saarthi, says hello). */
function NavLink({
  children,
  onClick,
  testId,
  active = false,
  className = "",
}: {
  children: ReactNode;
  onClick(e: MouseEvent<HTMLButtonElement>): void;
  testId: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      data-magnetic="0.25"
      className={`relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 uppercase tracking-[0.12em] transition-colors hover:bg-fg/6 hover:text-fg ${
        active ? "text-fg after:absolute after:inset-x-2.5 after:-bottom-px after:h-px after:bg-brand" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** One figure in the numbers band; it counts up when it scrolls into view. */
function Stat({ value, label, delay }: { value: number; label: string; delay: number }) {
  return (
    <Reveal as="li" delay={delay} className="border-t border-line-strong pt-3">
      <Counter value={value} className="block font-mono text-5xl font-semibold tracking-tight text-fg sm:text-6xl" />
      <span className="mt-1 block font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</span>
    </Reveal>
  );
}

/**
 * The entry page. Students start as a guest (a name, an emblem and their
 * experience, kept in this browser) or, when the server is connected to
 * Supabase, sign in with Google, GitHub or email.
 */
export function LoginPage({
  motion,
  onEnter,
  onLaunch,
  theme,
  onToggleTheme,
}: {
  motion: boolean;
  onEnter(profile: Profile, startLanguage: string | null): void;
  /** Called the moment the student launches the workspace (starts the curtain). */
  onLaunch?(): void;
  theme: Theme;
  onToggleTheme(): void;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>("comet");
  const [experience, setExperience] = useState<Experience>("new");
  const [start, setStart] = useState<string>("c");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [mood, setMood] = useState<MascotMood>("wave");
  const [tab, setTab] = useState<"guest" | "signin" | "signup">("guest");
  const [returning] = useState(recentGuests);
  const nameInput = useRef<HTMLInputElement>(null);
  const { fine } = useFx();
  const page = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const scroller = useCallback(() => page.current, []);
  useScrollProgress(scroller, useCallback(() => progress.current, []));
  const hello = useSaarthiHello();

  // The chapter under a line 40% down the screen sets the tone and the background
  // scene; at the very bottom of the page, the last chapter.
  const [chapter, setChapter] = useState("hero");
  const install = useInstall();
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const chapters = Array.from(root.querySelectorAll<HTMLElement>("[data-chapter]"));
      if (chapters.length === 0) return;
      const top = root.getBoundingClientRect().top;
      const line = top + root.clientHeight * 0.4;
      let current = chapters[0];
      for (const el of chapters) if (el.getBoundingClientRect().top <= line) current = el;
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = chapters[chapters.length - 1];
      setChapter(current.dataset.chapter ?? "hero");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const plan = CHAPTERS[chapter] ?? CHAPTERS.hero;
  const tone = plan.tone === "base" ? theme : theme === "dark" ? "light" : "dark";

  const goTo = (id: string) => {
    const target = page.current?.querySelector<HTMLElement>(`#${id}`);
    target?.scrollIntoView({ behavior: motion ? "smooth" : "auto", block: "start" });
  };
  const sayHello = (from: Element | null) => {
    setMood("wave");
    hello({ ...SAARTHI_HELLO, from });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setMood("idle"), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  const enter = (profile: Profile, language: string | null) => {
    setMood("happy");
    setLeaving(true);
    onLaunch?.();
    // With motion on, the curtain covers the page first (0.5 s), then the workspace opens under it.
    window.setTimeout(() => onEnter(profile, language), motion ? 520 : 0);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanName(name);
    if (!clean) {
      setError("Tell Saarthi your name (a nickname is fine).");
      setMood("concerned");
      nameInput.current?.focus();
      return;
    }
    enter(newGuest(clean, avatar, experience), start);
  };

  const greeting = cleanName(name) ? `Namaste, ${cleanName(name)}!` : "Initialize your session";
  const liveCount = LIVE_LANGUAGES.size;

  return (
    <div
      ref={page}
      className={`k-entry k-tone-${tone} k-cursor-zone relative z-10 h-full overflow-y-auto overflow-x-hidden ${leaving && motion ? "k-leave" : ""}`}
      data-testid="login-page"
      data-chapter={chapter}
      data-tone={tone}
    >
      <SceneCanvas scene={plan.scene} motion={motion} className="-z-10" />
      {motion && fine && <CustomCursor />}
      {/* ------------------------------------------------------------ nav */}
      <nav className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <KairoLogo size={30} animated={motion} sub="COMPILER OS" />
          <span className="ml-auto hidden items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint md:flex">
            <NavLink onClick={() => goTo("languages")} testId="nav-languages" active={chapter === "languages"}>
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {VERIFIED_LANGUAGES.length} languages
            </NavLink>
            <NavLink onClick={() => goTo("pipeline")} testId="nav-sandbox" active={chapter === "pipeline"}>
              Sandboxed runs
            </NavLink>
            <NavLink onClick={() => goTo("try")} testId="nav-analyzer" active={chapter === "try"}>
              Live analyzer
            </NavLink>
            <NavLink onClick={(e) => sayHello(e.currentTarget)} testId="nav-saarthi" className="text-ai-fg">
              Saarthi AI
            </NavLink>
          </span>
          <InstallButton state={install} className="ml-auto md:ml-2" />
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
            data-magnetic="0.4"
            className={`${install.available ? "ml-2" : "ml-auto md:ml-2"} flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-muted hover:text-fg`}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
        <div className="cd-scroll flex items-center gap-1 overflow-x-auto px-3 pb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint md:hidden">
          <NavLink onClick={() => goTo("languages")} testId="nav-languages-mobile">
            {VERIFIED_LANGUAGES.length} languages
          </NavLink>
          <NavLink onClick={() => goTo("pipeline")} testId="nav-sandbox-mobile">
            Sandbox
          </NavLink>
          <NavLink onClick={() => goTo("try")} testId="nav-analyzer-mobile">
            Analyzer
          </NavLink>
          <NavLink onClick={(e) => sayHello(e.currentTarget)} testId="nav-saarthi-mobile" className="text-ai-fg">
            Saarthi AI
          </NavLink>
        </div>
        {/* How far down the page you are. */}
        <div ref={progress} className="k-progress-bar absolute inset-x-0 -bottom-px h-[2px] bg-brand" aria-hidden />
      </nav>

      {/* ----------------------------------------------------------- hero */}
      <div className="relative" data-chapter="hero">
        <CodeField className="absolute inset-0 h-full w-full opacity-80 [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] dark:opacity-65" />
        <div className="relative mx-auto grid max-w-[1320px] grid-cols-1 gap-x-10 px-4 [grid-template-areas:'copy''stage''card'] sm:px-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:[grid-template-areas:'copy_card''stage_card']">
          {/* ---------------------------------------------------- hero copy */}
          <section className="pt-8 [grid-area:copy] lg:pt-14">
            <p className="cd-rise flex items-center gap-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-brand-fg">
              <span className="h-px w-6 bg-brand" /> <Scramble text="AI-powered compiler" duration={900} />
            </p>
            <SplitText
              as="h1"
              delay={120}
              stagger={70}
              className="mt-3 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.035em] text-fg sm:text-6xl xl:text-7xl"
              parts={["Code. Compile.", { br: true }, { text: "Learn", className: "text-brand-fg" }, " with KAIRO", { text: ".", className: "text-brand" }]}
            />
            <p className="cd-rise mt-4 max-w-xl text-[15px] leading-relaxed text-muted" style={{ animationDelay: "420ms" }}>
              <b className="font-semibold text-fg">AI-Powered Coding. Compiling. Learning.</b> Real compilers for {VERIFIED_LANGUAGES.length} languages in a locked
              sandbox, syntax slips flagged while you type, and Saarthi, your AI guide, explaining every error and proposing fixes you verify with a real
              run.
            </p>
            <div className="cd-rise mt-5 flex flex-wrap items-center gap-3" style={{ animationDelay: "520ms" }}>
              <a
                href="#try"
                data-magnetic="0.3"
                data-cursor="PLAY"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-fg transition-colors hover:border-brand/60"
              >
                Try the live analyzer <ArrowDown size={14} className="text-brand-fg" />
              </a>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">No sign-up needed</span>
            </div>
          </section>

          {/* --------------------------------------------------- hero stage */}
          <section className="cd-rise py-6 [grid-area:stage] lg:py-4" style={{ animationDelay: "220ms" }}>
            <HeroStage mood={mood} size={motion ? 250 : 240} onSaarthi={(el) => sayHello(el)} />
          </section>

        {/* ---------------------------------------------------------- card */}
        <section className="pb-8 [grid-area:card] lg:pt-14">
          <div className="k-hud cd-rise relative w-full rounded-lg border border-line-strong bg-surface p-6 shadow-[var(--cd-shadow)]" style={{ animationDelay: "120ms" }}>
            <div role="tablist" aria-label="How to start" className="mb-5 grid grid-cols-3 gap-1 rounded-lg border border-line bg-raised p-1">
              {(
                [
                  ["guest", "Guest"],
                  ["signin", "Sign in"],
                  ["signup", "Create account"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setMood(id === "guest" ? "idle" : "wave");
                  }}
                  data-testid={`login-tab-${id}`}
                  className={`rounded-md px-2 py-1.5 text-[12px] font-semibold transition-colors ${
                    tab === id ? "bg-surface text-fg shadow-[var(--cd-shadow-soft)]" : "text-muted hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab !== "guest" ? (
              <AccountPanel mode={tab} onGuest={() => setTab("guest")} onMode={setTab} />
            ) : (
            <>
            <p className="k-label flex items-center gap-2">
              <TerminalSquare size={13} className="text-brand-fg" /> Session / guest
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg" data-testid="login-greeting">
              {greeting}
            </h2>
            <p className="mt-1 text-sm text-muted">I'm Saarthi. Tell me who you are and I'll set up your workspace.</p>

            {returning.length > 0 && (
              <div className="mt-5">
                <p className="k-label">Continue where you left off</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {returning.slice(0, 3).map((guest) => (
                    <button
                      key={guest.id}
                      type="button"
                      data-testid={`recent-guest-${guest.id}`}
                      onClick={() => enter(guest, null)}
                      data-cursor="RESUME"
                      className="group flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-brand/60 hover:bg-brand/5"
                    >
                      <Avatar id={guest.avatar} size={30} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{guest.name}</span>
                      <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-fg" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form className="mt-5 flex flex-col gap-4" onSubmit={submit} noValidate>
              <div>
                <label htmlFor="login-name" className="k-label">
                  What should Saarthi call you?
                </label>
                <input
                  id="login-name"
                  ref={nameInput}
                  data-testid="login-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                    if (mood === "concerned") setMood("idle");
                  }}
                  maxLength={32}
                  autoComplete="nickname"
                  placeholder="Your name or a nickname"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "login-name-error" : undefined}
                  className="mt-1.5 h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 font-mono text-sm text-fg outline-none transition-shadow placeholder:font-sans placeholder:text-faint focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--cd-brand)_25%,transparent)]"
                />
                {error && (
                  <p id="login-name-error" role="alert" className="mt-1 text-xs text-danger-fg">
                    {error}
                  </p>
                )}
              </div>

              <div>
                <p id="login-avatar-label" className="k-label">
                  Choose your emblem
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="login-avatar-label"
                  className="mt-2 grid grid-cols-8 gap-1.5"
                  onKeyDown={(e) => radioKeys(e, AVATARS.map((a) => a.id), avatar, setAvatar)}
                >
                  {AVATARS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={avatar === a.id}
                      aria-label={a.label}
                      title={a.label}
                      tabIndex={avatar === a.id ? 0 : -1}
                      data-testid={`login-avatar-${a.id}`}
                      onClick={() => setAvatar(a.id)}
                      className={`flex aspect-square items-center justify-center rounded-[30%] transition-transform hover:scale-105 ${
                        avatar === a.id ? "scale-105 ring-2 ring-brand ring-offset-2 ring-offset-[var(--cd-surface)]" : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <Avatar id={a.id} size={34} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p id="login-exp-label" className="k-label">
                  How much have you coded?
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="login-exp-label"
                  className="mt-2 grid grid-cols-3 gap-1.5"
                  onKeyDown={(e) => radioKeys(e, EXPERIENCE.map((x) => x.id), experience, setExperience)}
                >
                  {EXPERIENCE.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      role="radio"
                      aria-checked={experience === x.id}
                      tabIndex={experience === x.id ? 0 : -1}
                      data-testid={`login-experience-${x.id}`}
                      onClick={() => setExperience(x.id)}
                      title={x.hint}
                      className={`rounded-md border px-2 py-2 text-xs font-semibold transition-colors ${
                        experience === x.id ? "border-brand bg-brand/10 text-brand-fg" : "border-line bg-surface text-muted hover:border-line-strong hover:text-fg"
                      }`}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p id="login-start-label" className="k-label">
                  Start with
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="login-start-label"
                  className="mt-2 flex flex-wrap gap-1.5"
                  onKeyDown={(e) => radioKeys(e, START_WITH, start, setStart)}
                >
                  {START_WITH.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={start === id}
                      tabIndex={start === id ? 0 : -1}
                      data-testid={`login-start-${id}`}
                      onClick={() => setStart(id)}
                      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        start === id ? "border-brand bg-brand/10 text-brand-fg" : "border-line bg-surface text-muted hover:border-line-strong hover:text-fg"
                      }`}
                    >
                      <span className="font-mono text-[10px] opacity-80">{LANGUAGE_BADGE[id]}</span>
                      {START_NAMES[id]}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="mt-1 h-12 w-full font-mono text-sm uppercase tracking-[0.14em]"
                data-testid="login-enter"
                data-cursor="LAUNCH"
                disabled={leaving}
              >
                Launch workspace <ArrowRight size={17} />
              </Button>
              <p className="-mt-2 text-center text-[11px] text-faint">As a guest, your code, badges and streaks stay in this browser.</p>
            </form>

            <p className="mt-4 text-center text-[12px] text-muted">
              Want your progress on every device?{" "}
              <button type="button" onClick={() => setTab("signup")} className="font-semibold text-brand-fg hover:underline" data-testid="login-create-account">
                Create an account
              </button>{" "}
              or{" "}
              <button type="button" onClick={() => setTab("signin")} className="font-semibold text-brand-fg hover:underline">
                sign in
              </button>
            </p>
            </>
            )}
          </div>
        </section>

        </div>
      </div>

      <div id="languages" data-chapter="languages" className="scroll-mt-14">
      {/* ------------------------------------------------ languages band */}
      <section aria-label={`Languages: ${VERIFIED_LANGUAGES.map((id) => LANGUAGE_NAMES[id]).join(", ")}`} className="border-y border-line bg-surface/60 py-5">
        <Marquee
          scroller={scroller}
          className="text-[clamp(2.2rem,6vw,4.6rem)] font-semibold leading-none tracking-[-0.04em]"
          items={VERIFIED_LANGUAGES.map((id, i) => (
            <>
              <span className={i % 2 ? "k-outline-text" : "text-fg"}>{LANGUAGE_NAMES[id]}</span>
              <span className="text-[0.4em] text-brand">✦</span>
            </>
          ))}
        />
        <Marquee
          scroller={scroller}
          reverse
          speed={0.4}
          className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted"
          items={["Live analyzer", "Quick fixes", "Sandboxed runs", "Saarthi AI", "Concept detection", "Badges and streaks", "Real compilers", "Exact line and column"].map((t) => (
            <>
              <span>{t}</span>
              <span className="text-brand-fg">/</span>
            </>
          ))}
        />
      </section>

      {/* ------------------------------------------------------- numbers */}
      <section className="mx-auto max-w-[1320px] px-4 pb-6 pt-14 sm:px-6" aria-label="KAIRO in numbers">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          <Stat value={VERIFIED_LANGUAGES.length} label="Languages, real toolchains" delay={0} />
          <Stat value={liveCount} label="Live syntax grammars" delay={90} />
          <Stat value={exampleCount(VERIFIED_LANGUAGES)} label="Ready-made examples" delay={180} />
          <Stat value={BADGES.length} label="Badges to earn" delay={270} />
        </ul>
        <p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          Plus HTML, CSS and React with a live preview, right in the browser
        </p>
      </section>
      </div>

      {/* ------------------------------------------------ the pipeline tour */}
      <div id="pipeline" data-chapter="pipeline" className="scroll-mt-14">
        <PipelineTour scroller={scroller} onSaarthi={(el) => sayHello(el)} />
      </div>

      {/* ------------------------------------------------------ features */}
      <section className="mx-auto max-w-[1320px] px-4 pb-4 pt-14 sm:px-6" data-chapter="features">
        <p className="k-label">Why KAIRO</p>
        <SplitText
          as="h2"
          observe
          className="mt-2 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-5xl"
          parts={["A compiler that ", { text: "teaches", className: "text-brand-fg" }, " while it compiles."]}
        />
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          <Feature index="01" icon={<ShieldCheck size={15} />} title="Real compilers" body="GCC, javac, CPython, rustc, .NET and more, each run in a fresh container: no network, strict time and memory limits." delay={0} />
          <Feature index="02" icon={<Radar size={15} />} title="Live analyzer" body="Syntax slips are flagged while you type, with the concept you are working on and rule-based quick fixes." delay={110} />
          <Feature index="03" icon={<Sparkles size={15} />} title="Saarthi explains" body="Plain-language help grounded in your real run, fixes you approve, and a real run that verifies them." delay={220} />
        </ul>
      </section>

      {/* ---------------------------------------------------- playground */}
      <section id="try" data-chapter="try" className="mx-auto max-w-[1320px] scroll-mt-20 px-4 pt-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="k-label">Try it here</p>
            <SplitText
              as="h2"
              observe
              className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-5xl"
              parts={["Break it. ", { text: "Watch it", className: "text-brand-fg" }, " catch it."]}
            />
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            This is the workspace's real live analyzer, running in your browser. Each program below has one slip. Fix it with one click, or make new
            ones.
          </p>
        </div>
        <Reveal className="mt-6" from="zoom">
          <Playground />
        </Reveal>
      </section>

      {/* ------------------------------------------------------ live demo */}
      <section className="mx-auto max-w-[1320px] px-4 pb-12 pt-16 sm:px-6" data-chapter="demo">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Reveal from="left">
            <p className="k-label">Live demo</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
              One editor, 32 toolchains. Every run travels through the same pipeline: queue, compile, run, result, with problems pinned to the exact
              line.
            </p>
            <p className="mt-4 text-xs text-faint">
              <span className="font-semibold text-ai-fg">Saarthi (सारथी)</span> is the charioteer who guides the way.
            </p>
            <button
              type="button"
              onClick={() => {
                page.current?.scrollTo({ top: 0, behavior: motion ? "smooth" : "auto" });
                window.setTimeout(() => nameInput.current?.focus({ preventScroll: true }), motion ? 450 : 0);
              }}
              data-magnetic="0.3"
              data-cursor="START"
              data-ripple=""
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-brand px-5 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-on-brand hover:brightness-105"
            >
              Start coding <ArrowRight size={15} />
            </button>
          </Reveal>
          <Reveal from="right" delay={120}>
            <CodeTypewriter motion={motion} />
          </Reveal>
        </div>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <span>KAIRO · AI-powered coding. Compiling. Learning.</span>
          <span>Code stays in this browser until you press Run</span>
        </footer>
      </section>
    </div>
  );
}
