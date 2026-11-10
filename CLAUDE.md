# Conventions

Vite + vanilla JS (ES modules) + Web Audio / Web MIDI. No framework, and no runtime dependencies except
Tone.js, which only `tone-demo.html` + `apps/tone-demo/` may import: never from `shared/` or another app, or it
lands in their bundles. Everything is synthesized in the browser.

## Commands

Node 22.13 or newer, skipping the odd-numbered 23 and 25 (`.nvmrc` says 22, `engines` in `package.json` has the exact range).

```bash
npm run dev           # dev server on http://127.0.0.1:5173
npm run check         # lint + format check + tests + build: run before every commit
npm run lint          # eslint
npm run format        # prettier --write (format:check to verify only)
npm test              # vitest run
npm run coverage      # vitest with a coverage table (files at 100% are left out): shows what the tests do not reach
```

CI runs `npm run check` on pull requests, and the deploy to GitHub Pages runs it before building, so a
failing check blocks the deploy.

## Layout

- Five pages, each an HTML file plus `apps/<name>/`: `index.html` + `apps/sampler/` (the pad sampler),
  `keyboard.html` + `apps/keys/` (MIDI keyboard), `monitor.html` + `apps/monitor/` (MIDI monitor),
  `mpc-sample.html` + `apps/mpc-sample/` (Akai MPC Sample companion), `tone-demo.html` + `apps/tone-demo/` (Tone.js).
  `public/` holds files served as they are (the favicon). `README.md` has the file-by-file Layout.
- `shared/`: code used by more than one app. App-only code stays under `apps/<name>/`.
- A new page needs an entry in `vite.config.js` (`build.rollupOptions.input`) and in `shared/pages.js` (the site header's links); the test checks they agree. Copy the loading overlay (`#loading` markup, `shared/loading.css` link and `shared/loading-screen.js` script) from another page's HTML.

## Architecture rules

- **Logic modules have no DOM and no work at import time.** `synth.js`, `envelope.js`, `params.js`,
  `notes.js`, `holds.js`, `pointer-notes.js`, `pattern.js`, `starter-beat.js`, `sequencer.js`, `song.js`, `kit.js`, `voices.js`, `pad-envelope.js`, `pad-colors.js`, `export-wav.js`, `export-options.js`, `export-dialog-state.js`, `zip.js`, `project.js`, `pad-settings.js`, `trim.js`, `waveform.js`, `samples.js`, `sample-voice.js`, `blob-store.js`, `storage-budget.js`, `history.js`, `transport.js`, `scheduler.js`, `tempo.js`, `controller.js`, `layout.js`, `computer-keys.js`, `format.js`, `knob-moves.js`, `scales.js`,
  `midi-messages.js`, `precache.js`, `register-sw.js`, `mpc-sample.js`, `board.js`, `storage.js`, `console-log.js`, `pages.js`, `page-ready.js`, `dsp.js`, `sounds.js`, `power.js`, `light-show.js`, `describe.js` and `audio.js` only export functions, factories or plain data. This is what makes them testable.
- **View modules draw into an element they are handed.** `piano.js`, `pad-grid.js`, `knob-dials.js`,
  `pads.js`, `step-keys.js`, `velocity-bars.js`, `sample-loader.js`, `settings-sliders.js`, `color-swatches.js`, `pad-drawer.js`, `export-dialog.js`, `trim-view.js`, `tempo-knob.js`, `volume-knob.js`, `app-header.js`, `bank-strip.js`, `transport-lights.js`, `stick.js`, `site-header.js`, `update-notice.js`, `console-drawer.js`, `audio-notice.js`, `disclosure.js` and `lcd.js`, `light-show-view.js` export a `create…(element, options)` factory (the LCD
  takes a set of elements): no `getElementById`, nothing at import time. They
  show and report (a pad flashed, a key was pressed); they do not decide. Anything worth testing (such as the
  LCD text in `formatLcd`) is a pure function next to the DOM code.
- **`shared/download.js` (`saveBlob`) is the one place a file is saved**, through a link clicked by code; it takes its
  document as a parameter so it can be tested.
- **Views write only what changed, through `shared/dom-updates.js`.** The sampler redraws on every step while playing, and
  assigning the same text or attribute again can be announced again by a screen reader. A control that is disabled or
  hidden while it has keyboard focus hands the focus to a neighbour first (`setDisabled`, `setHidden`), so keys
  such as Escape keep working where the person was.
- **The service worker is built, not imported.** `shared/sw-template.js` is filled in by the `emit-service-worker` plugin in
  `vite.config.js` (the files to keep come from `precache.js`) and emitted as `sw.js`; no page imports it. Everything is
  relative (`./sw.js`, manifest `start_url` `./`) so the site works from any subpath. A new build waits until the
  person presses Reload; never `skipWaiting` on its own. Each page's `main.js` calls `enableOffline` and has an
  `#update-notice` element, and a new page's `<head>` copies the manifest, theme-color and apple-touch-icon lines.
- **`main.js` only wires.** It finds the elements, builds the synth and views, and connects inputs (MIDI,
  computer keyboard) to them. Page state that several views read lives there.
- **All audio goes through `shared/audio.js`.** Use `audio.ensure()` to get the context and `audio.master` as
  the output. Never construct an `AudioContext` or a master gain elsewhere. Nothing may assume the context
  exists before the first user interaction.
- **All MIDI input goes through `shared/midi-access.js` and `parseMidi`; messages reach an app through `createMidiRouter`.** Do not mask status bytes by hand;
  match on `msg.type`.
- **Controller-specific numbers live in a device profile, not in a handler.** A profile (see
  `shared/midi-devices.js`) has `match(inputName)` and `translate(msg)`, which returns the app's own events
  (`knob`, `pad`, `sustain`…); `main.js` reacts to those and never sees a CC number or channel. Supporting
  another controller means adding a profile. Both pages do this (`apps/keys/devices.js`,
  `apps/sampler/devices.js`). A profile can also describe a controller's lights (the Launchpad's LEDs); the
  LED colours and note numbers stay in the profile too.
- **Class names are scoped to the page that owns them.** A name two pages could both want (a pad, a knob) is prefixed with the page (`sampler-pad`, `mpc-pad`), so a component can later be shared without its styles colliding. Styles used by every page (chassis, LCD, buttons, header) live in `shared/base.css`.
- **Slider-to-value mappings use `shared/scales.js`**, not hand-written formulas.
- **One place changes each value.** A parameter that can be set from an on-screen dial, a MIDI knob or a default goes
  through a single setter (see `setSlider` / `setChoice` in `keys/controller.js` and `synth.set`), so the UI, the
  audio graph and the display cannot disagree. Parameters are listed once, in `apps/keys/params.js`; the page labels its dials from that table.
- Schedule sounds at `AudioContext` times (a lookahead scheduler, `AudioParam` events), never by starting them
  directly from `setTimeout`/`setInterval` callbacks. Timers drift and stall; the audio clock does not.

## Code style

Prettier and ESLint are the source of truth (`.prettierrc.json`, `eslint.config.js`); do not hand-format.
Beyond what they enforce:

- Comments explain **why** (a browser quirk, a hardware detail, a non-obvious choice), not what the code does.
- Prefer small functions over deep nesting; early `return` for guard cases.
- Unused function arguments are prefixed `_`.
- Save anything between visits with `shared/storage.js` (`loadJson` / `saveJson`), never `localStorage`
  directly: storage can throw or be empty (private windows, blocked site data), and the page must work
  without it Bytes that
  localStorage cannot hold (audio) go through `shared/blob-store.js`, which has the same never-throws contract.
- Magic numbers get a named constant or a comment (`BEND_RANGE`, `STICK_TRAVEL`, `LOOKAHEAD_MS`).

## Tests

- Tests sit next to the code as `*.test.js` and run in Node (Vitest). They cover logic modules, not DOM.
- Web Audio is faked with small stand-ins that record calls (see `apps/keys/synth.test.js`); do not add a
  browser-emulation dependency for this.
- New pure logic gets a test in the same commit. A bug fix starts with a test that fails.
- When a behaviour can only be judged by ear or by eye (envelope feel, layout), say so in the commit/PR rather
  than claiming it was verified.

### Testing with MIDI hardware

- **Use a real browser, not an embedded one.** The in-app browser pane of the Claude desktop app blocks Web
  MIDI: `navigator.requestMIDIAccess()` throws `NotAllowedError` and the page shows "MIDI: PERMISSION DENIED".
  Check anything that needs a connected controller (pad input, Launchpad LEDs, port names) in Firefox or
  Chrome at `http://127.0.0.1:5173` (`npm run dev`); Claude in Chrome can drive Chrome when its extension is
  connected. The built-in pane is fine for checks that do not touch MIDI.
- **Match against the exact port name.** Read it from the MIDI monitor page (`monitor.html`). Without a
  browser, `aconnect -l` or `/proc/asound/seq/clients` list the ALSA sequencer port names on Linux
  (`/proc/asound/cards` does not: it has card descriptions, which differ from the port name). Test a
  profile's `match` with the real string, not a guess. The monitor shows input names only; a profile with
  lights (`lights`/`reset`) is matched against the output port's name too (`apps/sampler/midi.js`), and a
  browser can name the two differently, so test both. In the browser console, list them with
  `[...(await navigator.requestMIDIAccess()).outputs.values()].map((p) => p.name)`.
- **Keep the model boundary, but allow for the browser's decoration.** Firefox on Linux reports ports as
  `client:port MIDI 1 28:0` and Windows can prefix `2- `, so a `match` that insists on the string ending
  right after the model name silently drops the profile. Accept those known prefixes and suffixes, and
  exclude sibling models by name, so one profile does not also claim a different model with the same
  leading name.
- Device profiles cover the controllers actually in use here, not every model of a brand.

## Workflow: branch and pull request

Project skills in `.claude/skills/` carry this workflow out: `ship-pr` (start to open PR), `pre-pr-review` (an
independent review before every PR; do not rely on Codex, which has a usage limit), `try-in-page`,
`handle-review-events` and `land-prs`.

`main` is protected: changes land through a pull request, and the `check` job must pass first. Pushing to
`main` deploys to GitHub Pages, so merging is shipping.

1. Start from an up-to-date `main`: `git switch main && git pull`.
2. Branch as `type/short-name`: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/` (for example
   `refactor/params-registry`).
3. Commit in small steps, and run `npm run check` before pushing.
4. Push the branch and open a PR. The template asks for a summary, a test plan and anything not verified.
5. Wait for `check` to go green, then merge. Squash for one commit per PR; rebase to keep a deliberate commit
   series (for example a format-only commit next to a behaviour change). Merge commits are disabled.
6. The branch is deleted on merge. Locally: `git switch main && git pull && git branch -d <branch>`.

One PR is one change that could be reverted on its own. Keep unrelated cleanups out of it.

## Commits and changes

- Small, single-purpose commits; format-only changes go in their own commit, separate from behaviour changes.
- Refactors say "no intended behaviour change" and are checked against the running page.
- Update the Layout section of `README.md` when files are added, moved or removed.
