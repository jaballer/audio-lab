---
name: try-in-page
description: Exercise a change in the running sampler page and leave a dev server up for the user - start the dev server, drive the new behaviour, look at wide and phone layouts, then clean up test data. Use before opening a PR for anything user-visible, or when the user says "spin up a server", "let me test", "try it in the browser", "check it in the page".
---

# Try it in the page

Complements `webdev:verify`. Tests prove the logic; this proves what a person will hit. Say honestly what could
not be judged: sound, feel, a real phone, other browsers, MIDI hardware.

## Start it

- Dev server config is `.claude/launch.json` (untracked; do not commit it):
  `{"version":"0.0.1","configurations":[{"name":"dev","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":5173}]}`
- `mcp__Claude_Browser__preview_start` with `name: "dev"`. If 5173 is taken it picks another port; give the user
  the URL it reports. Keep it running after the turn and say so.
- **The server serves whichever branch the worktree is on.** Switching branches changes what the user sees; say so
  before you switch.
- Pages: `/` sampler, `/keyboard.html`, `/mpc-sample.html`, `/monitor.html`. A loading overlay covers the page for
  2 to 3 seconds: `wait` before screenshots.

## Drive it

- Prefer `javascript_exec` for logic (click buttons by id, read `aria-pressed`, the LCD `#lcd-msg`, `localStorage`)
  and `find` plus `scroll_to` to bring a control into view before a screenshot.
- **Pads and files:** a pad is `[data-pad="N"]`; select it with a `pointerdown` event. To load a sample, build a WAV
  in the page, put it in a `DataTransfer` and dispatch a `drop` `DragEvent` on the pad. Spy `decodeAudioData` or
  `navigator.storage.persist` to count calls.
- **Layouts:** `resize_window` to 1280x900, then `preset: "mobile"`, then **reset with `preset: "desktop"`** when
  done. A wide emulated viewport can still wrap if the pane is narrow: check the real width.
- **MIDI does not work in the in-app browser** (permission denied). Anything with a controller needs Chrome or
  Firefox at the dev URL; list it under "Not verified".
- Read the console: `read_console_messages` with `onlyErrors`.

## Clean up

Leave the page as you found it: reset test pads (select the pad, press Default Sound), restore the bar length,
clear anything you saved. Storage keys: `localStorage` `pad-sampler:song` and `pad-sampler:samples`, IndexedDB
`audio-lab`. Do not leave generated test samples in the user's saved kit.
