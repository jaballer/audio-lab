import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMidi } from "./midi.js";

const NOTE_ON = 0x90;
const CC = 0xb0;
const RESET = [CC, 0, 0]; // the Launchpad's "all LEDs off"
const PADS = 16;
const STEPS = 16;
const TOP_BUTTON_COUNT = 8;
const FLASH_MS = 120; // midi.js flashes a pad's LED this long

// Everything midi.js can ask the app to do.
const ACTIONS = [
  "triggerPad",
  "toggleStep",
  "start",
  "stop",
  "toggleRec",
  "clearPad",
  "clearAll",
  "tapTempo",
  "nudgeTempo",
];

const input = (name) => ({ name, state: "connected", onmidimessage: null });
const output = (name) => ({ name, state: "connected", send: vi.fn() });

// What the app gives midi.js: the actions it can call, and a view of its state.
function fakeApi(overrides = {}) {
  const state = {
    selected: 0,
    stepsOn: Array(STEPS).fill(false),
    playheadStep: -1,
    playing: false,
    recording: false,
  };
  return {
    padCount: PADS,
    steps: STEPS,
    triggerPad: vi.fn(),
    toggleStep: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    toggleRec: vi.fn(),
    clearPad: vi.fn(),
    clearAll: vi.fn(),
    tapTempo: vi.fn(),
    nudgeTempo: vi.fn(),
    onStatus: vi.fn(),
    state,
    getState: () => state,
    ...overrides,
  };
}

// Connects a midi.js to a fake Web MIDI with the given ports.
async function setup({ inputs = [], outputs = [], api = fakeApi() } = {}) {
  const access = {
    inputs: new Map(inputs.map((p, i) => [`in${i}`, p])),
    outputs: new Map(outputs.map((p, i) => [`out${i}`, p])),
    onstatechange: null,
  };
  vi.stubGlobal("navigator", { requestMIDIAccess: async () => access });
  const midi = createMidi(api);
  await midi.connect();
  return { access, api, midi };
}

// The raw messages sent to a controller, in order.
const sent = (port) => port.send.mock.calls.map(([message]) => message);
// The pad LED messages (Note On) among them, by note.
const padLed = (port, note) => sent(port).filter(([status, data1]) => status === NOTE_ON && data1 === note);

const windowHandlers = {};
beforeEach(() => {
  for (const key of Object.keys(windowHandlers)) delete windowHandlers[key];
  vi.stubGlobal("window", {
    addEventListener: (type, handler) => {
      windowHandlers[type] = handler;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("input from a Launchpad", () => {
  // Original layout: a note is `row * 16 + column`, row 0 at the top.
  const PAD_1 = 7 * 16 + 0; // bottom-left
  const PAD_16 = 4 * 16 + 3; // top-right of the 4x4 pad block

  it("plays the pad that was pressed, with the hit's velocity as a 0-1 level", async () => {
    const lp = input("Launchpad");
    const { api } = await setup({ inputs: [lp] });
    lp.onmidimessage({ data: [NOTE_ON, PAD_1, 127] });
    lp.onmidimessage({ data: [NOTE_ON, PAD_16, 64] });
    expect(api.triggerPad).toHaveBeenNthCalledWith(1, 0, 1);
    expect(api.triggerPad).toHaveBeenNthCalledWith(2, 15, 64 / 127);
  });

  it("toggles a step from the top two rows", async () => {
    const lp = input("Launchpad");
    const { api } = await setup({ inputs: [lp] });
    lp.onmidimessage({ data: [NOTE_ON, 0, 127] });
    lp.onmidimessage({ data: [NOTE_ON, 1 * 16 + 1, 127] });
    expect(api.toggleStep).toHaveBeenNthCalledWith(1, 0);
    expect(api.toggleStep).toHaveBeenNthCalledWith(2, 9);
  });

  it.each([
    [104, "start", []],
    [105, "stop", []],
    [106, "toggleRec", []],
    [107, "clearPad", []],
    [108, "clearAll", []],
    [109, "tapTempo", []],
    [110, "nudgeTempo", [-1]],
    [111, "nudgeTempo", [1]],
  ])("top button %i calls %s", async (cc, action, args) => {
    const lp = input("Launchpad");
    const { api } = await setup({ inputs: [lp] });
    lp.onmidimessage({ data: [CC, cc, 127] });
    expect(api[action]).toHaveBeenCalledTimes(1);
    expect(api[action]).toHaveBeenCalledWith(...args);
  });

  it("acts on a button press only, not on its release", async () => {
    const lp = input("Launchpad");
    const { api } = await setup({ inputs: [lp] });
    lp.onmidimessage({ data: [CC, 104, 0] });
    expect(api.start).not.toHaveBeenCalled();
  });

  it("ignores keys that do nothing and messages it does not use", async () => {
    const lp = input("Launchpad");
    const { api } = await setup({ inputs: [lp] });
    lp.onmidimessage({ data: [NOTE_ON, 6 * 16 + 5, 127] }); // between the pads and the edge
    lp.onmidimessage({ data: [0x80, PAD_1, 0] }); // key released
    lp.onmidimessage({ data: [CC, 99, 127] }); // not one of the top buttons
    for (const action of ACTIONS) expect(api[action]).not.toHaveBeenCalled();
  });

  it("drops pads and steps the app does not have", async () => {
    const lp = input("Launchpad");
    const api = fakeApi({ padCount: 8, steps: 8 });
    await setup({ inputs: [lp], api });
    lp.onmidimessage({ data: [NOTE_ON, PAD_1, 100] }); // pad 1: kept
    lp.onmidimessage({ data: [NOTE_ON, PAD_16, 100] }); // pad 16: dropped
    lp.onmidimessage({ data: [NOTE_ON, 1 * 16 + 1, 100] }); // step 10: dropped
    expect(api.triggerPad).toHaveBeenCalledTimes(1);
    expect(api.toggleStep).not.toHaveBeenCalled();
  });
});

describe("input from any other controller", () => {
  it("plays pads from notes 36 up, with the hit's velocity", async () => {
    const keys = input("MPK mini");
    const { api } = await setup({ inputs: [keys] });
    keys.onmidimessage({ data: [NOTE_ON, 36 + 5, 127] });
    expect(api.triggerPad).toHaveBeenCalledWith(5, 1);
  });

  it("drops notes beyond the last pad, and notes below the first", async () => {
    const keys = input("MPK mini");
    const { api } = await setup({ inputs: [keys] });
    keys.onmidimessage({ data: [NOTE_ON, 36 + PADS, 100] });
    keys.onmidimessage({ data: [NOTE_ON, 20, 100] });
    expect(api.triggerPad).not.toHaveBeenCalled();
  });

  it("uses the profile of the port a message came from", async () => {
    const lp = input("Launchpad");
    const keys = input("MPK mini");
    const { api } = await setup({ inputs: [lp, keys] });
    // Note 40 is pad 5 on a generic controller, but a dead key on the Launchpad.
    lp.onmidimessage({ data: [NOTE_ON, 40, 100] });
    expect(api.triggerPad).not.toHaveBeenCalled();
    keys.onmidimessage({ data: [NOTE_ON, 40, 100] });
    expect(api.triggerPad).toHaveBeenCalledWith(4, 100 / 127);
  });
});

describe("lighting a controller", () => {
  it("does nothing when there is no controller with lights", async () => {
    const { midi } = await setup({ inputs: [input("MPK mini")], outputs: [output("MPK mini")] });
    expect(() => {
      midi.refresh();
      midi.padHit(0);
    }).not.toThrow();
    expect(windowHandlers.pagehide).toBeInstanceOf(Function);
    expect(() => windowHandlers.pagehide()).not.toThrow();
  });

  it("clears the lights when the Launchpad connects, then lights every pad, step and button", async () => {
    const out = output("Launchpad");
    await setup({ inputs: [input("Launchpad")], outputs: [out] });
    expect(sent(out)[0]).toEqual(RESET);
    expect(sent(out)).toHaveLength(1 + PADS + STEPS + TOP_BUTTON_COUNT);
  });

  it("sends only the lights that changed", async () => {
    const out = output("Launchpad");
    const { api, midi } = await setup({ inputs: [input("Launchpad")], outputs: [out] });
    out.send.mockClear();

    midi.refresh();
    expect(out.send).not.toHaveBeenCalled();

    api.state.selected = 1; // the selected pad's light moves from pad 1 to pad 2
    midi.refresh();
    expect(out.send).toHaveBeenCalledTimes(2);
    expect(padLed(out, 7 * 16 + 0)).toHaveLength(1);
    expect(padLed(out, 7 * 16 + 1)).toHaveLength(1);
  });

  it("lights the step the playhead is on", async () => {
    const out = output("Launchpad");
    const { api, midi } = await setup({ inputs: [input("Launchpad")], outputs: [out] });
    const step3 = 2; // top row, third key
    const before = padLed(out, step3).at(-1)[2];
    out.send.mockClear();

    api.state.playing = true;
    api.state.playheadStep = 2;
    midi.refresh();
    expect(padLed(out, step3)).toHaveLength(1);
    expect(padLed(out, step3)[0][2]).not.toBe(before);
  });

  it("flashes a pad that was hit, then puts its light back", async () => {
    vi.useFakeTimers();
    const out = output("Launchpad");
    const { midi } = await setup({ inputs: [input("Launchpad")], outputs: [out] });
    const pad3 = 7 * 16 + 2;
    const resting = padLed(out, pad3).at(-1)[2];
    out.send.mockClear();

    midi.padHit(2);
    expect(padLed(out, pad3)).toHaveLength(1);
    const flash = padLed(out, pad3)[0][2];
    expect(flash).not.toBe(resting);

    vi.advanceTimersByTime(FLASH_MS);
    expect(padLed(out, pad3)).toHaveLength(2);
    expect(padLed(out, pad3)[1][2]).toBe(resting);
  });

  it("stops sending when the Launchpad is unplugged, and starts over with the next one", async () => {
    const first = output("Launchpad");
    const { access, midi } = await setup({ inputs: [input("Launchpad")], outputs: [first] });
    first.send.mockClear();

    first.state = "disconnected";
    access.onstatechange();
    midi.refresh();
    expect(first.send).not.toHaveBeenCalled();

    const second = output("Launchpad");
    access.outputs.set("out1", second);
    access.onstatechange();
    expect(sent(second)[0]).toEqual(RESET);
    expect(sent(second)).toHaveLength(1 + PADS + STEPS + TOP_BUTTON_COUNT); // every light again
  });

  it("turns the lights off when the page is left", async () => {
    const out = output("Launchpad");
    await setup({ inputs: [input("Launchpad")], outputs: [out] });
    out.send.mockClear();
    windowHandlers.pagehide();
    expect(sent(out)).toEqual([RESET]);
  });

  it("does not fail leaving the page if the controller has gone away", async () => {
    const out = output("Launchpad");
    await setup({ inputs: [input("Launchpad")], outputs: [out] });
    out.send.mockImplementation(() => {
      throw new Error("port closed");
    });
    expect(() => windowHandlers.pagehide()).not.toThrow();
  });
});
