import { afterEach, describe, expect, it, vi } from "vitest";
import { createMidiAccess, summarizeInputs, wireMidiButton } from "./midi-access.js";

const port = (name, state = "connected") => ({ name, state, onmidimessage: null });

// What navigator.requestMIDIAccess() resolves to: ports keyed by id, and a hook
// the browser calls when a device is plugged in or removed.
function fakeAccess({ inputs = [], outputs = [] } = {}) {
  return {
    inputs: new Map(inputs.map((p, i) => [`in${i}`, p])),
    outputs: new Map(outputs.map((p, i) => [`out${i}`, p])),
    onstatechange: null,
  };
}

function stubNavigator(navigator) {
  vi.stubGlobal("navigator", navigator);
}

function setup({ access = fakeAccess() } = {}) {
  stubNavigator({ requestMIDIAccess: vi.fn(async () => access) });
  const handlers = { onMessage: vi.fn(), onStatus: vi.fn(), onChange: vi.fn() };
  return { access, handlers, midi: createMidiAccess(handlers) };
}

afterEach(() => vi.unstubAllGlobals());

describe("createMidiAccess.connect", () => {
  it("says so, and reports failure, when the browser has no Web MIDI", async () => {
    stubNavigator({});
    const onStatus = vi.fn();
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus });
    expect(await midi.connect()).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/use Chrome or Edge/));
  });

  it("reports a refused permission prompt", async () => {
    stubNavigator({
      requestMIDIAccess: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    const onStatus = vi.fn();
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus });
    expect(await midi.connect()).toBe(false);
    expect(onStatus).toHaveBeenCalledWith("MIDI: permission denied");
  });

  it("lists the connected inputs by name", async () => {
    const { midi, handlers } = setup({ access: fakeAccess({ inputs: [port("MPK mini"), port("Launchpad")] }) });
    expect(await midi.connect()).toBe(true);
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: MPK mini, Launchpad");
  });

  it('says "no device" when there are no inputs', async () => {
    const { midi, handlers } = setup();
    await midi.connect();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: no device");
  });

  it("ignores disconnected ports and the system's MIDI Through port", async () => {
    const access = fakeAccess({
      inputs: [port("Midi Through Port-0"), port("Old Keyboard", "disconnected"), port("MPK mini")],
    });
    const { midi, handlers } = setup({ access });
    await midi.connect();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: MPK mini");
    expect(access.inputs.get("in0").onmidimessage).toBeNull();
    expect(access.inputs.get("in1").onmidimessage).toBeNull();
  });

  it("hands each input's messages to onMessage along with the input they came from", async () => {
    const keys = port("MPK mini");
    const pads = port("Launchpad");
    const { midi, handlers } = setup({ access: fakeAccess({ inputs: [keys, pads] }) });
    await midi.connect();

    keys.onmidimessage({ data: [0x90, 60, 100], timeStamp: 10 });
    pads.onmidimessage({ data: [0xb0, 104, 127], timeStamp: 20 });
    expect(handlers.onMessage).toHaveBeenNthCalledWith(1, keys, [0x90, 60, 100], 10);
    expect(handlers.onMessage).toHaveBeenNthCalledWith(2, pads, [0xb0, 104, 127], 20);
  });

  it("passes on the time the system received a message, not the time the callback ran", async () => {
    const keys = port("MPK mini");
    const { midi, handlers } = setup({ access: fakeAccess({ inputs: [keys] }) });
    await midi.connect();
    keys.onmidimessage({ data: [0x90, 60, 100], timeStamp: 1234.5 });
    expect(handlers.onMessage.mock.calls[0][2]).toBe(1234.5);
  });

  it("does not ask for System Exclusive access unless the app does", async () => {
    const { midi, access } = setup();
    await midi.connect();
    expect(navigator.requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(access).toBeDefined();

    stubNavigator({ requestMIDIAccess: vi.fn(async () => fakeAccess()) });
    await createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn(), sysex: true }).connect();
    expect(navigator.requestMIDIAccess).toHaveBeenCalledWith({ sysex: true });
  });

  it("tells onChange about the access and the inputs it kept, so an app can find its outputs", async () => {
    const keys = port("MPK mini");
    const access = fakeAccess({ inputs: [keys, port("Midi Through Port-0")], outputs: [port("Launchpad")] });
    const { midi, handlers } = setup({ access });
    await midi.connect();
    expect(handlers.onChange).toHaveBeenCalledWith(access, [keys]);
  });

  it("works without an onChange", async () => {
    stubNavigator({ requestMIDIAccess: async () => fakeAccess() });
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(await midi.connect()).toBe(true);
  });

  it("keeps the header status short however many ports the browser lists", async () => {
    const inputs = Array.from({ length: 31 }, (_, i) => port(`WebMIDI output:Output connection ${i}:0`));
    const { midi, handlers } = setup({ access: fakeAccess({ inputs }) });
    await midi.connect();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: 31 inputs");
  });

  it("scans again when a device is plugged in", async () => {
    const access = fakeAccess({ inputs: [port("MPK mini")] });
    const { midi, handlers } = setup({ access });
    await midi.connect();

    const launchpad = port("Launchpad");
    access.inputs.set("in1", launchpad);
    access.onstatechange();

    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: MPK mini, Launchpad");
    expect(launchpad.onmidimessage).toEqual(expect.any(Function));
    expect(handlers.onChange).toHaveBeenCalledTimes(2);
  });

  it("scans again when a device is removed or switched off", async () => {
    const keys = port("MPK mini");
    const access = fakeAccess({ inputs: [keys, port("Launchpad")] });
    const { midi, handlers } = setup({ access });
    await midi.connect();

    access.inputs.delete("in1"); // unplugged
    access.onstatechange();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: MPK mini");
    expect(handlers.onChange).toHaveBeenLastCalledWith(access, [keys]);

    keys.state = "disconnected"; // still listed by the browser, but gone
    access.onstatechange();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: no device");
    expect(handlers.onChange).toHaveBeenLastCalledWith(access, []);
  });
});

describe("createMidiAccess.disconnect", () => {
  it("stops listening and clears the status, and connect() listens again", async () => {
    const keys = port("MPK mini");
    const access = fakeAccess({ inputs: [keys] });
    const { midi, handlers } = setup({ access });
    await midi.connect();
    expect(keys.onmidimessage).toBeTypeOf("function");

    midi.disconnect();
    expect(keys.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(handlers.onStatus).toHaveBeenLastCalledWith("");

    await midi.connect();
    expect(keys.onmidimessage).toBeTypeOf("function");
    expect(handlers.onStatus).toHaveBeenLastCalledWith("MIDI: MPK mini");
  });

  it("tells the app, with no ports left, so it releases what it held", async () => {
    const access = fakeAccess({ inputs: [port("MPK mini")], outputs: [port("MPK mini")] });
    const { midi, handlers } = setup({ access });
    await midi.connect();
    midi.disconnect();
    const [seenAccess, seenInputs] = handlers.onChange.mock.lastCall;
    expect(seenInputs).toEqual([]);
    expect(seenAccess.outputs.size).toBe(0);
  });

  it("does nothing before a connection", () => {
    const { midi, handlers } = setup();
    midi.disconnect();
    expect(handlers.onStatus).not.toHaveBeenCalled();
  });
});

describe("summarizeInputs", () => {
  it("names one or two inputs, and counts more than that", () => {
    expect(summarizeInputs([])).toBe("MIDI: no device");
    expect(summarizeInputs(["MPK mini"])).toBe("MIDI: MPK mini");
    expect(summarizeInputs(["MPK mini", "Launchpad"])).toBe("MIDI: MPK mini, Launchpad");
    expect(summarizeInputs(["a", "b", "c"])).toBe("MIDI: 3 inputs");
  });
});

describe("createMidiAccess onLog", () => {
  const withLog = async (access) => {
    stubNavigator({ requestMIDIAccess: vi.fn(async () => access) });
    const onLog = vi.fn();
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn(), onLog });
    await midi.connect();
    return { onLog, access };
  };

  it("lists every input in full on the first scan, without calling each one newly connected", async () => {
    const { onLog } = await withLog(fakeAccess({ inputs: [port("MPK mini"), port("Launchpad")] }));
    expect(onLog.mock.calls).toEqual([["Inputs (2): MPK mini, Launchpad"]]);
  });

  it("says when there are no inputs", async () => {
    const { onLog } = await withLog(fakeAccess());
    expect(onLog).toHaveBeenCalledWith("No MIDI inputs");
  });

  it("logs a device plugged in or removed later, the removal as a warning", async () => {
    const { onLog, access } = await withLog(fakeAccess({ inputs: [port("MPK mini")] }));
    onLog.mockClear();

    access.inputs.set("in1", port("Launchpad"));
    access.onstatechange();
    expect(onLog).toHaveBeenCalledWith("Connected: Launchpad");

    onLog.mockClear();
    access.inputs.delete("in0");
    access.onstatechange();
    expect(onLog).toHaveBeenCalledWith("Disconnected: MPK mini", "warn");
  });

  // Two units of one controller model have the same name; only the port id tells them apart.
  it("tells two inputs with the same name apart by port id", async () => {
    const a = { id: "a", name: "MPK mini", state: "connected", onmidimessage: null };
    const b = { id: "b", name: "MPK mini", state: "connected", onmidimessage: null };
    const access = fakeAccess({ inputs: [a] });
    const { onLog } = await withLog(access);
    onLog.mockClear();

    access.inputs.set("in1", b);
    access.onstatechange();
    expect(onLog).toHaveBeenCalledWith("Connected: MPK mini");

    onLog.mockClear();
    access.inputs.delete("in0");
    access.onstatechange();
    expect(onLog).toHaveBeenCalledWith("Disconnected: MPK mini", "warn");
  });

  it("logs a refused permission prompt as an error, with the browser's reason", async () => {
    stubNavigator({
      requestMIDIAccess: vi.fn(async () => {
        throw Object.assign(new Error("blocked"), { name: "NotAllowedError" });
      }),
    });
    const onLog = vi.fn();
    await createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn(), onLog }).connect();
    expect(onLog).toHaveBeenCalledWith("MIDI access refused: NotAllowedError (blocked)", "error");
  });

  it("logs a browser with no Web MIDI as an error", async () => {
    stubNavigator({});
    const onLog = vi.fn();
    await createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn(), onLog }).connect();
    expect(onLog).toHaveBeenCalledWith(expect.stringMatching(/no Web MIDI/), "error");
  });
});

describe("createMidiAccess.autoConnect", () => {
  it("connects without a click when permission was already granted", async () => {
    const access = fakeAccess({ inputs: [port("MPK mini")] });
    const requestMIDIAccess = vi.fn(async () => access);
    stubNavigator({ requestMIDIAccess, permissions: { query: vi.fn(async () => ({ state: "granted" })) } });
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(await midi.autoConnect()).toBe(true);
    expect(requestMIDIAccess).toHaveBeenCalled();
  });

  it("checks the permission it will ask for, so a sysex page is not reconnected on a plain grant", async () => {
    const query = vi.fn(async () => ({ state: "prompt" }));
    stubNavigator({ requestMIDIAccess: vi.fn(), permissions: { query } });
    await createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn(), sysex: true }).autoConnect();
    expect(query).toHaveBeenCalledWith({ name: "midi", sysex: true });
  });

  it("does not ask for permission on its own", async () => {
    const requestMIDIAccess = vi.fn();
    stubNavigator({ requestMIDIAccess, permissions: { query: vi.fn(async () => ({ state: "prompt" })) } });
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(await midi.autoConnect()).toBe(false);
    expect(requestMIDIAccess).not.toHaveBeenCalled();
  });

  it("gives up quietly where the Permissions API does not know about MIDI", async () => {
    const requestMIDIAccess = vi.fn();
    stubNavigator({
      requestMIDIAccess,
      permissions: {
        query: vi.fn(async () => {
          throw new TypeError("not a valid permission name");
        }),
      },
    });
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(await midi.autoConnect()).toBe(false);
    expect(requestMIDIAccess).not.toHaveBeenCalled();
  });

  it("gives up quietly where there is no Permissions API at all", async () => {
    stubNavigator({ requestMIDIAccess: vi.fn() });
    const midi = createMidiAccess({ onMessage: vi.fn(), onStatus: vi.fn() });
    expect(await midi.autoConnect()).toBe(false);
  });
});

describe("wireMidiButton", () => {
  // A button that remembers its click handler so the test can press it.
  function fakeButton() {
    const button = { attrs: {}, click: null };
    button.addEventListener = (_type, handler) => {
      button.click = handler;
    };
    button.setAttribute = (name, value) => {
      button.attrs[name] = value;
    };
    return button;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const fakeMidi = (over = {}) => ({
    connect: vi.fn(async () => true),
    disconnect: vi.fn(),
    autoConnect: vi.fn(async () => false),
    ...over,
  });

  it("starts off, and lights when a click connects", async () => {
    const button = fakeButton();
    const midi = fakeMidi();
    wireMidiButton(button, midi);
    await settle();
    expect(button.attrs["aria-pressed"]).toBe("false");

    await button.click();
    expect(midi.connect).toHaveBeenCalled();
    expect(button.attrs["aria-pressed"]).toBe("true");
  });

  it("stays in place and turns MIDI off on a second click", async () => {
    const button = fakeButton();
    const midi = fakeMidi();
    wireMidiButton(button, midi);
    await button.click();
    await button.click();
    expect(midi.disconnect).toHaveBeenCalled();
    expect(button.attrs["aria-pressed"]).toBe("false");

    await button.click();
    expect(midi.connect).toHaveBeenCalledTimes(2);
    expect(button.attrs["aria-pressed"]).toBe("true");
  });

  it("ignores a press while a connect waits on the permission prompt", async () => {
    const button = fakeButton();
    let allow;
    const midi = fakeMidi({ connect: vi.fn(() => new Promise((resolve) => (allow = resolve))) });
    wireMidiButton(button, midi);
    const first = button.click();
    await button.click();
    expect(midi.connect).toHaveBeenCalledTimes(1);
    allow(true);
    await first;
    expect(button.attrs["aria-pressed"]).toBe("true");
  });

  it("does not let a slow silent reconnect undo a press", async () => {
    const button = fakeButton();
    let resolveAuto;
    const midi = fakeMidi({ autoConnect: vi.fn(() => new Promise((resolve) => (resolveAuto = resolve))) });
    wireMidiButton(button, midi);
    await button.click(); // on
    await button.click(); // off
    resolveAuto(true);
    await settle();
    expect(button.attrs["aria-pressed"]).toBe("false");
    expect(midi.disconnect).toHaveBeenCalledTimes(2); // the press, and the reconnect that finished after it
  });

  it("stays off for another try when connecting fails", async () => {
    const button = fakeButton();
    wireMidiButton(button, fakeMidi({ connect: vi.fn(async () => false) }));
    await button.click();
    expect(button.attrs["aria-pressed"]).toBe("false");
  });

  it("lights when it reconnected on its own", async () => {
    const button = fakeButton();
    wireMidiButton(button, fakeMidi({ autoConnect: vi.fn(async () => true) }));
    await settle();
    expect(button.attrs["aria-pressed"]).toBe("true");
  });
});
