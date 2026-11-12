# Using the sampler

A quick tour of the PAD16 sampler at [jaballer.github.io/audio-lab](https://jaballer.github.io/audio-lab/). It runs
in your browser: no account, nothing uploaded. Your work is kept in this browser between visits.

## Make a sound

- Click a pad, or press its key. The keys mirror the grid: `1 2 3 4` / `Q W E R` / `A S D F` / `Z X C V`.
- Hold **Shift** while you click or press to select a pad and open its editor without playing it.
- If there is no sound, click the page or press a key once: browsers keep audio silent until you do.

## Make a beat

1. Pick a pad, then turn its **step keys** on. Each pad has its own row of steps.
2. Press **Play** (or `Space`). **Stop** pressed again cuts off everything still ringing.
3. Not sure where to start? Pick a style in **Starter** (hip hop, techno, house, trap) and press **Start**.
4. **Rec** while playing records the pads you hit, snapped to 16th notes, with how hard you hit.

Set **Tempo** with the knob (drag, scroll, or arrow keys) or tap it out with **Tap**. **Swing** sounds the second step of each pair later. Turn on **Velocity** to show a bar under each step, then drag a bar to set how hard that step plays.

## Sequences

A beat holds up to eight **sequences** of 1, 2, 4 or 8 bars. The keys under the display choose which one you see and
edit; **+** adds an empty one, **Copy** duplicates the one showing, and **−** removes it.

- While playing, pressing a sequence key queues it for the end of the pass. Hold **Shift** to switch at once, or turn the **Next** latch off (raised), which is the way to do it on a touch
  screen.
- `Ctrl/⌘ Z` undoes a change to the steps (with `Shift`, redoes). **Copy Steps** and **Paste Steps** repeat a bar of the selected pad's steps (one pad at a time).

## Make a song

The **Song** panel, under the pads, sets the order the sequences play in: a cell for each entry, with its sequence and
how many times it repeats. Until you change it, it is every sequence once, in order.

- Select a cell, then **Add Entry** (puts the sequence showing in after it), **Remove Entry**, **Move Earlier** or
  **Move Later**, and **Repeats −** / **+** (1 to 16). A song holds up to 32 entries.
- Light the **Song** key, next to Play, and press Play: the song begins at the entry selected and stops after its last
  pass. Turn on **Loop**, at the start of the row under the panel's heading, to go round again instead.
- In Song mode the sequence keys only choose what you see and edit, so you can work on one sequence while the song
  plays another. The display shows the entry, its repeat and what comes next.

## Your own sounds

Drop an audio file on a pad (up to 10 seconds and 5 MB). **Edit Pad** opens the pad's editor: trim the start and end,
and set gain, pitch, an envelope, a **choke group** (pads in one group cut each other off, like a closed hat cutting an
open one) and a colour. Delete or double-click a slider to reset it.

## Save and share

- **Export** makes a 16-bit WAV: the sequence showing (1, 2, 4 or 8 loops, stereo or mono) or the song, in its order and repeats (up to 6 min 40 s). Choose
  **Stems** for a zip with one WAV for each pad that has steps, which add up to the mix.
- **Save** writes everything (beat, pad settings, samples) to a `.audiolab` file and **Open** puts one back. Use it as
  a backup: clearing the browser's site data clears your work.

## With a MIDI controller

Press **MIDI** and allow the permission prompt (Chrome, Edge or Firefox; not Safari). An original-layout Novation
Launchpad (Launchpad, S, or Mini mk1/mk2) plays the pads from its bottom-left block and lights up to mirror the pads and
steps, and an Akai MPC Sample plays the pads in any bank. On any other controller, including newer Launchpads, notes
36-51 play pads 1-16 and nothing is lit.
The [MIDI monitor](https://jaballer.github.io/audio-lab/monitor.html) shows what a controller really sends, and the
[README](../README.md#midi) has the details.
