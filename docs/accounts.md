# Profiles and accounts

Everyone who opens KAIRO passes through the entry page. There are two
kinds of profile:

| | Guest (always available) | Account (needs Supabase) |
|---|---|---|
| How | A name, an emblem, an experience level and a start language | Email and password (**Create account**), plus Google, GitHub, Microsoft or a phone number when those providers are set up |
| Where it lives | This browser (`localStorage`) | Supabase Auth; the app keeps the session in the browser, so you stay logged in |
| Code, progress, badges, settings | This browser, per profile | **Saved to the account** in Supabase and mirrored in this browser: sign in on another computer or phone and your work is there |
| Switching | Profile card → **Switch profile**; the entry page offers to continue recent guests | Profile card → **Sign out** |

Guests need nothing on the server. Account sign-in stays switched off (the
buttons are disabled with an explanation and a "continue as a guest" button)
until the web app is built with a Supabase project's URL and publishable key.

The entry page's sign-in card has three tabs:

* **Guest**: name, emblem, experience and start language; recent guests on
  this browser can be continued with one click.
* **Sign in**: **email and password**, with **Forgot password?** (Supabase
  emails a reset link; opening it brings the student back to KAIRO with a
  "Choose a new password" dialog). The Google, GitHub and Microsoft buttons
  (OAuth with PKCE) and **phone** (6-digit code by SMS, +91 India first) appear
  only for the providers listed in `VITE_AUTH_PROVIDERS` (see below), so the
  live site never shows a button that cannot work.
* **Create account**: name, email, password and confirmation. With "Confirm
  email" turned off in Supabase (recommended, step 3 below) the new account
  opens the workspace at once; with it on, the card says to open the link in
  the email first.

After any sign-in (and after a new guest enters), Saarthi jumps out big and
says **"Welcome, <name>!"**, then shrinks back to its corner.

## What an account keeps

The workspace always works from this browser's storage, exactly as for a
guest; for an account those keys are named after the account and
`apps/web/src/cloud/sync.ts` mirrors them to the account's rows in Supabase:

| Table | What | From the browser key |
|---|---|---|
| `profiles` | name, emblem, experience | the profile card |
| `code_files` | the draft and the program input of each language | `cd.drafts.<id>`, `cd.stdin.<id>` |
| `progress` | XP, level, streaks, badges | `cd.progress.<id>` |
| `settings` | theme, motion, sound, extensions, editor font size, panel layout, last language | `cd.theme`, `k.layout`, ... |
| `notebooks` | the Python notebook | `k.notebook.<id>` |
| `runs` | a short history: language, result, time (no code) | each finished run |

* **On sign-in** KAIRO shows "Loading your saved work...", pulls the account's
  rows and merges them with this browser's copy: whatever changed since the
  last sync wins; when both changed, this browser's copy is kept and uploaded.
  For progress the copy with more XP wins, so badges are never lost.
* **While you work** changes are uploaded every few seconds and when the tab
  is hidden or closed. The status bar shows **Synced**, **Syncing** or
  **Offline** (work continues and is uploaded when the connection returns).
* **On sign-out** what is left is uploaded, then the account's copies are
  removed from this browser.
* **Row Level Security** on every table lets a signed-in user read and write
  only their own rows. The browser holds only the publishable key; there is
  no secret key anywhere in the web app or the repository.

The KAIRO API does not see the account: runs and Saarthi work the same for
guests and accounts, and their rate limits are per IP address.

### Never paused: the daily keep-alive

A free Supabase project is paused after a week without activity. Vercel Cron
calls `GET /api/v1/system/keepalive` once a day (`vercel.json`); the API calls
the database function `public.keepalive()` with the publishable key, which
updates the single `heartbeat` row, and it also wakes the code runner's
sandbox so its snapshot never expires. On Vercel the cron request carries
`CRON_SECRET`; without the secret the endpoint still works but does the work
at most once every ten minutes per server instance.

## Turning on accounts

1. Create a project at [supabase.com](https://supabase.com) (the free plan is
   enough) and apply the schema: paste
   `supabase/migrations/20261014193302_kairo_accounts.sql` into the SQL editor
   and run it (or `supabase db push` with the Supabase CLI).
2. **Authentication → Sign In / Providers**: email is on by default. To add
   Google or GitHub, create an OAuth app with that provider and paste its
   client id and secret; the callback URL to register with the provider is
   shown on the same Supabase page (`https://<project-ref>.supabase.co/auth/v1/callback`).
3. **Authentication → Sign In / Providers → Email**: turn off **Confirm
   email** so a new account can sign in at once. (Supabase's built-in email
   service only sends a few emails an hour; confirmation mails would soon stop
   arriving.)
4. **Authentication → URL Configuration**: set the *Site URL* to where KAIRO
   is opened (the live site, for example `https://kairo-ai-phi.vercel.app`) and
   add the other addresses you use under *Redirect URLs*
   (`http://localhost:5173` for `make web`, `http://localhost:8080` for Docker
   Compose, a Codespaces address). Password-reset links return only to these.
5. **Settings → API Keys** (or the **Connect** dialog): copy the project URL
   and the **publishable** key (`sb_publishable_...`). Both are meant to be
   public. The legacy `anon` key also works (set it as
   `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`). Never use a
   secret or `service_role` key in the web app.
6. Give them to the web app at build time:
   * **Vercel**: put them in `infra/vercel/public-settings.json` and push (the
     build hands them to the web app and to the API's keep-alive), or set
     `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` under Project →
     Settings → Environment Variables, which win over the file, and redeploy;
   * `make web` (development): create `apps/web/.env.local` from
     `apps/web/.env.example` and restart `make web`;
   * Docker Compose: set `VITE_SUPABASE_URL` and
     `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`, then
     `docker compose build api && docker compose up -d`.
7. Optional: `VITE_AUTH_PROVIDERS` lists the extra sign-in buttons to show,
   for example `google,github` (choices: `google`, `github`, `azure` for
   Microsoft, `phone`). Leave it empty for email and password only.

Optional providers:

* **Microsoft**: in Supabase it is called *Azure*. Register an app in the
  Microsoft Entra admin center (supported account types: personal and work
  accounts), add Supabase's callback URL as a redirect URI, and paste the
  application (client) id and a client secret into Supabase.
* **Phone**: turn on the *Phone* provider and connect an SMS service that
  Supabase supports (Twilio, MessageBird, Vonage or Textlocal). SMS costs money
  on those services; Supabase also lets you add test numbers with a fixed code
  for development.

## Progress: XP, levels, badges, streaks

Only things the platform observed count, never self-reported ones
(`apps/web/src/profile/achievements.ts`, unit-tested):

| Event | XP |
|---|---|
| Any run | 2 |
| A clean run (finished, no errors) | +10 |
| First clean run in a language | +15 |
| A clean run in a language whose previous run failed ("fixed an error") | +10 |
| First clean run of the day | +5 × the day streak (up to 7) |
| An explanation from Saarthi | 5 |
| A Saarthi fix verified by a real run | 20 |
| Opening an example | 3 |

Levels: Initiate, Syntax Scout, Bug Hunter, Builder, Debugger, Optimizer,
Architect, Compiler Whisperer, Systems Master, KAIRO Legend. There are 14
badges (First Build, Bug Squasher, Curious Mind, Input Handler, Explorer, On a
Roll, Polyglot, Verified Fix, Three-Day Uptime, Night Owl, Unstoppable,
Toolchain Master, Week of Code, Century); the profile card lists each with how
to earn it, next to the language matrix (one cell per language, lit after a
clean run in it). A day streak
counts local calendar days with at least one clean run and is broken when a
whole day passes without one.
