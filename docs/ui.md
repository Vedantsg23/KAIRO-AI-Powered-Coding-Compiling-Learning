# The KAIRO interface ("compiler console")

KAIRO (AI-Powered Coding. Compiling. Learning.) is laid out like a
developer command center: one screen shows the code, what the build
pipeline is doing, the program's terminal, the diagnostics and Saarthi's
analysis, with the system's real status along the edges. The look is a
light "signal" theme (white panels, crisp green) by default, with a
restrained graphite dark theme as the student's choice. Motion is quick and
purposeful, never decoration for its own sake.

## Design system

### Tokens

Colours live as CSS custom properties in `apps/web/src/index.css`
(`--cd-*`, exposed to Tailwind as `bg-surface`, `text-brand-fg`...). The
values switch with the `dark` class on `<html>`.

| Token | Signal (light, default) | Graphite (dark) | Used for |
|---|---|---|---|
| canvas / surface / raised | `#f3f6f4` / `#ffffff` / `#f7f9f8` | `#0a0a0a` / `#101010` / `#161616` | page, panels, panel headers |
| line / line-strong | `#e2e8e4` / `#c9d3cc` | `#222222` / `#2e2e2e` | hairline borders |
| fg / muted / faint | `#0b1510` / `#435049` / `#5f6b64` | `#e8e8e8` / `#a8a8a8` / `#8a8a8a` | text |
| brand (green) | `#22c55e`, text `#137a3a` | `#22c55e`, text `#4ade80` | Run, build, success, online |
| ai (cyan) | `#06b6d4`, text `#0b7185` | `#22d3ee`, text `#67e8f9` | everything Saarthi says or does |
| warn / danger / info | amber / red / blue | amber / red / blue | statuses |
| accent (gold) | `#f59e0b`, text `#a14e07` | `#f59e0b`, text `#fbbf24` | XP, streaks, badges |

Every text token reaches at least 4.5:1 contrast (WCAG AA) on canvas,
surface, raised and sunken in both themes, and the green Run button's dark
text reaches 7.5:1 (checked from the token values). The focus ring uses the
text green (3:1 or better against the surfaces).

### Type

Geist (interface) and JetBrains Mono (code, and the uppercase technical
labels: SYSTEM, BUILD, DIAGNOSTICS, CONCEPT, QUICK FIX...), both bundled; no
font CDN. Labels use the `k-label` class: 10.5 px mono, 0.14 em tracking.

### Components (`apps/web/src/styles/kairo.css`, `ui/primitives.tsx`)

* `k-panel` + `PanelHead`: flat surface, hairline border, a header strip with
  an index number ("01 EXPLORER", "04 DIAGNOSTICS") and a label.
* `k-chip`: status chips in the system bar ("BUILD · PASSED").
* `k-hud`: green corner brackets for highlighted frames (boot card, the
  sign-in card, the concept card, tour cards).
* `Button` variants: `primary` (green, dark text), `ai` (cyan outline),
  `secondary`, `ghost`, `danger`.
* The build pipeline stations (`cd-station`), the editor's signal line
  (`k-editor-frame`), Saarthi's avatar (`k-avatar`), the floating assistant
  (`k-float`, `k-bubble`), the boot screen (`k-boot`).

All of `kairo.css` sits in Tailwind's `components` cascade layer, so
utilities (`hidden`, `max-lg:hidden`...) always win.

### Brand

The mark (`layout/Logo.tsx`) is a dark chip with a "K" built from a stem and
a code chevron (`|<`) and a green cursor. The wordmark draws KAIRO with the
"I" as a green text caret (KA|RO). The favicon is the mark.

## The screens

* **Boot sequence** (`boot/BootSequence.tsx`): once per browser tab. Each
  line is a real check: the API (compiler kernel), the language runtimes
  (the READY count comes from the API), the diagnostic notes, the sandbox
  (Docker via the runner), Saarthi's provider, the analyzer (WebAssembly and
  workers), the language adapters. Any key or click skips it; it never waits
  more than 4.5 s; with motion off it shows the results at once. With motion
  on, a field of stars gathers into the KAIRO mark above the checks
  (`fx/AstraField.tsx`, one canvas; the card is drawn in the dark palette over
  the night sky in either theme), and the boot stays up at least 2.1 s so the
  mark can form.
* **Entry page** (`auth/LoginPage.tsx`, `auth/HeroStage.tsx`,
  `auth/PipelineTour.tsx`, `auth/Playground.tsx`): the headline, Saarthi
  floating over its holo-platform with three cards (a live diagnostic, a
  quick fix, a verified run), the session card (guest profile, or accounts
  when Supabase is configured), a languages band, KAIRO in numbers, the
  pipeline tour, three feature cards, the analyzer playground and the demo
  terminal. See "The interaction layer" below.

  The page changes with the scroll: each section is a *chapter* with a tone
  (dark or light) and a background scene drawn on one canvas
  (`fx/SceneCanvas.tsx`: stars, a grid, waves, orbits). Crossing into the next
  chapter cross-fades the colours (the theme's colour tokens are registered
  CSS properties, so they animate) and the scene. The links in the header
  (the language count, Sandboxed runs, Live analyzer, Saarthi AI) go to their
  section. Clicking Saarthi makes it jump out big and say "Hii!", then go back;
  after signing in (or entering as a new guest) it says "Welcome, <name>!"
  (`mascot/SaarthiHello.tsx`). With reduced motion the tones still change,
  without animation, and the hello is a simple fade.
* **Notebook** (`notebook/NotebookView.tsx`, the notebook button on the left
  bar): Python cells and Markdown cells, run in the sandbox, with `In [n]`,
  `Out[n]`, tracebacks and quick notes under each cell, live checks while
  typing, `.ipynb` import and export, and its own terminal (run log, input and
  a `>>>` console). See [languages.md](languages.md#python-notebooks).
* **Extensions** (the left bar, Ctrl+Shift+X): every built-in extension with
  a switch and a details page: language packs, Typo Guard, Saarthi Tips,
  Error Lens, Complexity Lens, TODO Highlight, Prettier, the sandbox
  formatters (clang-format, Black, gofmt, shfmt), Format on Save, Emmet, the
  Vim keymap (with a mode line under the editor), Minimap, Word Wrap, Sticky
  Scroll, bracket colours, whitespace, three editor themes, Saarthi
  Autocomplete, Live Preview and Notebooks. Nothing is downloaded from a
  marketplace: they ship with KAIRO and are loaded the first time they are used.
* **Workspace** (`App.tsx`, laid out by `layout/Workbench.tsx` like VS Code
  or Antigravity):

  | Area | What it shows |
  |---|---|
  | Top bar | KAIRO / COMPILER OS, the language runtime, BUILD and SAARTHI status, COMMANDS (Ctrl+K), examples, tour, keys, theme, the **Layout** buttons (show or hide the explorer, the terminal and Saarthi's panel, each labelled in words), **Install app** where the browser offers it, RUN, profile |
  | Activity bar and side bar (left) | the explorer (drafts as files, one per language; `stdin.txt`; the language's examples; SYSTEM status) or Extensions. Ctrl+B shows or hides it |
  | Editor | Monaco with the KAIRO themes, minimap, folding, bracket matching, autocomplete, gutter glyphs for problems; the analyzer strip (live check, concept at the cursor, whether results are current); Saarthi floating in the corner |
  | Panel (bottom) | the terminal (the build pipeline over TERMINAL, INPUT, BUILD LOG and DETAILS) and, beside it, **Problems** (live syntax problems with quick fixes, then the run's errors, warnings and crashes; a location jumps to the line). Ctrl+\` or Ctrl+J shows or hides it, its maximize button gives it the whole height (restore brings the editor back), and Run opens it |
  | Saarthi (right) | the chat: answers stream in word by word with a caret, three dots while Saarthi starts, suggestions ("Explain this error", "Give me a hint"), Stop, New chat, a copy button on each answer; plus the fix loop, the current concept, the live analysis and the AI explanations and fixes. Ctrl+Alt+B shows or hides it, Ctrl+Alt+I jumps to the question box |
  | Status bar | compiler core, sandbox, Saarthi, languages ready, queue, toolchain, cursor, draft saved, and for accounts **Synced**, **Syncing** or **Offline** |

  Every divider works like VS Code's: drag it, or focus it and use the arrow
  keys (Home and End for the smallest and largest size, Enter or a
  double-click for the default); dragging the side bar, the panel or
  Saarthi's panel below about half its smallest size hides it. The layout is
  remembered per browser and, for accounts, saved with the account. Below
  1024 px the workspace stacks: the editor, then one tabbed panel
  (Diagnostics, Saarthi, Terminal, Input, Build log, Details).

## The interaction layer

Inspired by experimental studio sites (the brief named ilabsolutions.it),
the entry page and the console react to the pointer, the scroll and the
keyboard. The components are in `src/fx`, the styles in
`src/styles/fx.css`; the theme is unchanged.

| Where | Effect | How |
|---|---|---|
| Entry page | Custom cursor: a dot and a trailing ring that grows over controls and shows a label ("LAUNCH", "FIX", "RESUME") | `fx/CustomCursor.tsx`; mouse only; the system cursor is hidden only inside `.k-cursor-zone`, never over text fields |
| Entry page | Code glyphs drifting behind the hero, pushed aside by the pointer and wired to their neighbours near it | `fx/CodeField.tsx`: one 2D canvas, drawn only while on screen and the tab is visible, colours from the theme tokens |
| Entry page | Headline words rise into place; the eyebrow decodes itself like a terminal; below-the-fold headings wait until they scroll into view | `SplitText` and `Scramble` in `fx/text.tsx`; screen readers get the text once |
| Entry page | Hero layers drift with the pointer at different depths; the cards tilt towards it with a glare | `useParallax` (`data-depth` wrappers) and `Tilt` in `fx/pointer.tsx` |
| Entry page | Two endless bands (languages in outline type, features) that speed up and turn with the scroll | `Marquee` in `fx/scroll.tsx` |
| Entry page | Numbers that count up, sections that slide in, a scroll progress line under the navigation | `Counter`, `Reveal`, `useScrollProgress` |
| Entry page | The pipeline tour: the panel stays pinned while CODE → ANALYZE → DIAGNOSE → EXPLAIN → FIX → COMPILE → VERIFY take turns, with Saarthi in the middle as the guide (a face and a line for each step: waving, thinking, concerned, explaining, suggesting, happy); the track fills with the scroll; a node jumps to its step | `auth/PipelineTour.tsx` (a plain list of the seven steps, with Saarthi's lines, when motion is off) |
| Entry page | The playground: three programs with one slip each, checked by the real live analyzer, with the same quick fix | `auth/Playground.tsx`; the analyzer loads only when it scrolls into view |
| Boot | Stars drift in from everywhere and settle into the KAIRO mark (the K and its cursor), which then twinkles over a slowly turning nebula | `fx/AstraField.tsx` (`gather`): one canvas, additive blending, paused while the tab is hidden; motion off draws the finished picture once |
| Entry → console | A short flight through the stars: every star rushes outwards and stretches into a streak while "Launching workspace" grows and fades, then the console's panels rise in one after another | `StarFlight` in `fx/Curtain.tsx` (`AstraField` in `flight` mode), `.k-in` |
| Saarthi's chat | Messages slide in, answers are written with a glowing caret, three dots bounce before the first word, suggestion chips arrive one after another, the question box cycles example questions | `.k-chat-in`, `.k-streaming`, `.k-typing`, `.k-chip-suggest` in `styles/astra.css`; `useTypedPrompt` in `assistant/SaarthiPanel.tsx` |
| Both | Magnetic buttons (RUN, the call-to-action buttons) and click ripples | `fx/MagneticField.tsx`: one global listener for `[data-magnetic]` and `[data-ripple]` |
| Console | Ctrl+K command palette: run, save, explain, the quick fix at the cursor, every language, every example, editor actions, view switches, help; fuzzy search; `:42` goes to line 42 | `workspace/CommandPalette.tsx`, `workspace/commands.tsx` |
| Console | Saarthi can be dragged anywhere in the editor (the spot is remembered), moved with the arrow keys, double-clicked to wave; five quick clicks make it spin | `mascot/Companion.tsx` |
| Console | Panel borders light up near the pointer; panel labels decode on hover | `useSpotlight` writes to each panel's empty `.k-spot` child; `Scramble` |
| Console | The terminal writes its output line by line; a light sweeps across it when a run finishes (green: passed, red: failed) | `LineReveal` (text content unchanged), `.k-sweep` |
| Console | Optional sounds: a tick, a chime for a clean run or a verified fix, a low blip for a failure | `fx/sound.ts`, Web Audio oscillators, off until switched on in the profile card |

The command palette and Monaco share Ctrl+K: Monaco's own chords start with
it (Ctrl+K Ctrl+C comments a line, Ctrl+K Ctrl+0 folds everything), so when
the palette is opened from the editor, the second key of a chord closes it
and runs that editor action. The chords keep working as before.

Rules for every effect: it is decoration (nothing is only shown by it), it
stands still with motion off, looping decorations pause while the student
types, touch screens get no cursor effects, CSS animations use only
`transform` and `opacity`, and pointer effects restyle one small element
each (never a CSS variable on a large subtree).

## Saarthi, drawn

`mascot/SaarthiMascot.tsx` is original SVG artwork: a white glossy helmet,
a dark visor with two green eyes that follow the pointer, green ear lights
and chest light, floating over a holo-platform. Moods: idle (calm), thinking
(analysing: narrowed eyes, a scan line), explaining (a voice equaliser and a
text panel), happy (a clean run or a verified fix), concerned (amber eyes and
an alert), suggesting (a fix is ready: a lightbulb), sleeping (two minutes
of quiet) and wave (hello). The floating assistant (`mascot/Companion.tsx`)
says what happened after each run in one line, in a polite live region.

## Live analysis, quick fixes and concepts

The live check (`live/`) parses the code with Tree-sitter in a Web Worker
150 ms after typing stops. Each problem carries a topic (semicolon, colon,
bracket, comparison, elif, indent, block keywords, incomplete expression,
print...) with a human-written WHY and CONCEPT (`live/topics.ts`), and,
where the repair is unambiguous, a rule-based quick fix: add a missing ';',
':' or ')', '=' to '==' in a condition, 'else if' to 'elif', print "x" to
print("x"), a missing 'then' or 'do'. A fix is applied only on a click, as
one undoable edit; the analyzer then re-reads the code (LIVE ANALYZER:
SYNTAX OK), and "Apply & run" lets the compiler verify the rest. No quick fix
is offered where the right repair depends on intent (indentation, a missing
'}' or 'end').

Concept detection (`live/concepts.ts`) reads the same syntax tree: the
concept at the cursor ("C → Input & output → Formatted output (printf) →
Arguments", in `main()`) and the concept areas a file uses. The labels are
fixed and human-written, keyed by syntax node types.

## Moods

The workspace's mood lives in `data-mood` on `.cd-app` (rules in
`cosmos/mood.ts`, first match wins): running, success (2.6 s after a clean
run), error, warn (live syntax problem), typing, calm. It colours the 2 px
signal line along the top of the editor (green, amber, red, a scanning line
while running). Only descendant selectors react to it, so a mood change
never restyles the whole page.

## Accessibility

* Everything works from the keyboard: Ctrl+Enter runs from anywhere, Ctrl+S
  saves the draft, Ctrl+K opens the command palette (a combobox with a
  listbox), dialogs trap focus and close with Esc, dividers resize with the
  arrow keys, the language menu is a listbox with arrow keys, and Saarthi
  moves with the arrow keys when it has focus.
* Motion: the system's "reduce motion" setting turns decorative animation
  off by default; the profile card has an **Animations** switch
  (`data-motion` on `.cd-app`); decorative motion pauses while you type.
* Saarthi's drawing and the hero art are decorative; what they express is
  also said in text. Statuses are never colour alone (words and icons too).

## Performance

CSS animations move only `transform` and `opacity`; the panel spotlight
repaints one empty element's background; the code-glyph canvas draws only
while it is on screen and the tab is visible; the star field exists only
during the boot and the launch; the chat's typed example questions hold still
while the student types; panel dividers redraw once per animation frame while
dragged; the command palette builds its list only while it is open. Keystroke-to-markers latency
is measured by `e2e/latency.spec.ts` (500-line files, 14 languages, 20 edits
each, 150 ms pause included); see the milestone report for the numbers of
each run. The concept request is separate from the check (it runs after the
check, from the tree the check already built), so it does not add to the
check's latency.

## Tests

`e2e/kairo.spec.ts` covers the boot sequence (real counts, skipping, once
per tab), the default theme, live quick fixes (applied, verified by the
analyzer, undoable, and Apply & run), concept detection, the explorer, the
language runtimes' availability, Ctrl+S, the floating Saarthi and the tablet
layout. `e2e/interactive.spec.ts` covers the command palette (fuzzy search,
languages, go to line, Esc, Monaco's Ctrl+K chords), dragging Saarthi (and
that a click still opens it), the entry page's playground, tour and cursor,
reduced motion, and the sounds switch. `e2e/experience.spec.ts` covers the entry page, profiles, badges,
the companion's reactions and the mood. Unit tests: `live/analyze.test.ts`
(quick fixes on the real grammars), `live/concepts.test.ts`,
`lib/edits.test.ts`, `lib/fuzzy.test.ts` (the palette's matching),
`profile/achievements.test.ts`, `cosmos/mood.test.ts`.
`e2e/entry.spec.ts` covers the chapters' tones and scenes, the header links
and Saarthi's hello and welcome; `e2e/notebook.spec.ts` the notebook (runs,
shared variables, errors, the live typo check, the terminal and its console,
the time limit, `.ipynb` export and import, reloads);
`e2e/extensions.spec.ts` Prettier, clang-format and Black, Format on Save,
the palette's Format document, Emmet, the Vim keymap, the notebook switch and
AI autocomplete; `e2e/preview.spec.ts` HTML, CSS and React in the preview;
`e2e/workbench.spec.ts` the VS Code-style workspace (dragging and keyboard
resizing of the terminal, side bar and Saarthi's panel, maximize and restore,
Ctrl+\`, Ctrl+B and Ctrl+Alt+B, hiding by dragging, the layout kept across a
reload), Saarthi's streamed chat (written word by word, Stop, New chat, the
one-click suggestions), installing KAIRO as an app (manifest, icons, service
worker, the Install button and the browser's prompt) and the boot's star
field. Unit tests: `layout/workbench.test.ts` (sizes and limits),
`api/client.test.ts` (streamed runs and answers), `cloud/sync.test.ts`
(merging an account's saved work).
`notebook/model.test.ts` covers splitting a run into cells and the `.ipynb`
format.
