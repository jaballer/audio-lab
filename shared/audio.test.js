import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIP, POWER_SWITCH, createAudioEngine, softClipCurve } from "./audio.js";

// An AudioContext that starts suspended, as browsers make it until a user
// gesture, and remembers every instance so a test can tell whether one was built.
function installAudioContext({ analysers = false, splitter = analysers } = {}) {
  const instances = [];
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 4;
      this.destination = { name: "destination" };
      this.listeners = [];
      this.resume = vi.fn(() => {
        this.state = "running";
      });
      this.suspend = vi.fn(() => {
        this.state = "suspended";
      });
      instances.push(this);
    }

    addEventListener(type, handler) {
      this.listeners.push({ type, handler });
    }

    // What the browser does when the state changes: the property handler and every listener hear it.
    changeState(state) {
      this.state = state;
      this.onstatechange?.();
      for (const l of this.listeners) if (l.type === "statechange") l.handler();
    }

    createGain() {
      // `disconnect` too: killSound lets go of the master it replaces, from a timer that outlives a test
      return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    }

    createWaveShaper() {
      return { curve: null, oversample: "2x", connect: vi.fn() };
    }
  }
  // Analysers and a channel splitter, for the tests that want them: an analyser is read, never wired onward.
  if (analysers) {
    FakeAudioContext.prototype.createAnalyser = function () {
      return { fftSize: 1024, smoothingTimeConstant: 0.8, connect: vi.fn() }; // not the size the engine sets, so a test sees whether it did
    };
  }
  if (splitter) {
    // `splittersMade` says whether the engine built one; "throws" is a context whose splitter fails
    FakeAudioContext.prototype.createChannelSplitter = function (outputs) {
      this.splittersMade = (this.splittersMade ?? 0) + 1;
      if (splitter === "throws") throw new Error("cannot split");
      return { outputs, connect: vi.fn() };
    };
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return instances;
}

// A window that records the listeners added to it.
function fakeTarget() {
  const listeners = [];
  return {
    listeners,
    addEventListener: vi.fn((type, handler, options) => listeners.push({ type, handler, options })),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("createAudioEngine", () => {
  it("builds nothing until the context is asked for", () => {
    const instances = installAudioContext();
    const audio = createAudioEngine();
    expect(instances).toHaveLength(0);
    expect(audio.ctx).toBeNull();
    expect(audio.master).toBeNull();
    expect(audio.running).toBe(false);
  });

  it("creates the context and master gain on first use, wired to the speakers", () => {
    const instances = installAudioContext();
    const audio = createAudioEngine({ volume: 0.4 });
    const ctx = audio.ensure();
    expect(instances).toEqual([ctx]);
    expect(audio.master.gain.value).toBe(0.4);
    expect(audio.master.connect).not.toHaveBeenCalledWith(ctx.destination); // through the clipper, below
  });

  it("puts a soft clipper between the master gain and the speakers, so loud steps do not crackle", () => {
    installAudioContext();
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    const half = audio.master.connect.mock.calls[0][0];
    expect(half.gain.value).toBe(1 / CLIP.reach);
    const shaper = half.connect.mock.calls[0][0];
    expect(shaper.connect).toHaveBeenCalledWith(ctx.destination);
    expect(shaper.curve).toBeInstanceOf(Float32Array);
    expect(shaper.oversample).toBe("none");
  });

  it("goes straight to the speakers when the context cannot make a waveshaper", () => {
    installAudioContext();
    const audio = createAudioEngine({
      createContext: () => {
        const ctx = new AudioContext();
        ctx.createWaveShaper = undefined;
        return ctx;
      },
    });
    const ctx = audio.ensure();
    expect(audio.master.connect).toHaveBeenCalledWith(ctx.destination);
  });

  it("uses the context its owner builds, when it is given a way to build one", () => {
    const instances = installAudioContext();
    const own = new AudioContext();
    instances.length = 0;
    const audio = createAudioEngine({ createContext: () => own });
    expect(audio.ensure()).toBe(own);
    expect(instances).toHaveLength(0);
  });

  it("returns the same context every time", () => {
    const instances = installAudioContext();
    const audio = createAudioEngine();
    expect(audio.ensure()).toBe(audio.ensure());
    expect(instances).toHaveLength(1);
  });

  it("resumes a suspended context, once it is running leaves it alone", () => {
    installAudioContext();
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(audio.running).toBe(true);
    audio.ensure();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("also resumes a context Safari has marked interrupted, after a call or a locked screen", () => {
    installAudioContext();
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    ctx.changeState("interrupted");
    ctx.resume.mockClear();
    audio.ensure();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("takes a volume set before the context exists", () => {
    installAudioContext();
    const audio = createAudioEngine({ volume: 1 });
    audio.setVolume(0.25);
    audio.ensure();
    expect(audio.master.gain.value).toBe(0.25);
  });

  it("smooths a volume change once the context exists, so the change does not click", () => {
    installAudioContext();
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    audio.setVolume(0.7);
    expect(audio.master.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    const [target, when, timeConstant] = audio.master.gain.setTargetAtTime.mock.calls[0];
    expect(target).toBe(0.7);
    expect(when).toBe(ctx.currentTime);
    // A time constant of zero would jump straight to the new level, which is the click.
    expect(Number.isFinite(timeConstant)).toBe(true);
    expect(timeConstant).toBeGreaterThan(0);
  });

  describe("onStateChange", () => {
    it('reports "closed" before there is a context, then the context\'s state as it changes', () => {
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ onStateChange });
      audio.unlockOnInteraction(fakeTarget());
      expect(onStateChange).toHaveBeenLastCalledWith("closed");

      const ctx = audio.ensure();
      expect(onStateChange).toHaveBeenLastCalledWith("running");

      ctx.changeState("suspended");
      expect(onStateChange).toHaveBeenLastCalledWith("suspended");
    });

    // Tone.js assigns `onstatechange` on the context it is given, which would silently replace
    // a handler set the same way: the header then stays on "click the page to enable".
    it("keeps reporting after a library replaces the context's onstatechange", () => {
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ onStateChange });
      const ctx = audio.ensure();
      ctx.onstatechange = () => {};
      ctx.changeState("suspended");
      expect(onStateChange).toHaveBeenLastCalledWith("suspended");
    });
  });

  describe("power", () => {
    it("starts on, and turning it off fades the sound out but leaves the context running", () => {
      installAudioContext();
      const audio = createAudioEngine({ volume: 0.5 });
      const ctx = audio.ensure();
      expect(audio.powered).toBe(true);

      audio.powerOff();
      expect(audio.powered).toBe(false);
      // Faded, not suspended: a suspended context freezes sounding notes, and a power cycle revives them.
      expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime, expect.any(Number));
      expect(ctx.suspend).not.toHaveBeenCalled();
      expect(ctx.state).toBe("running");
    });

    it("is not running while off, even though the context is, so pages see no sound", () => {
      installAudioContext();
      const audio = createAudioEngine();
      audio.ensure();
      expect(audio.running).toBe(true);
      audio.powerOff();
      expect(audio.running).toBe(false);
      audio.powerOn();
      expect(audio.running).toBe(true);
    });

    it('reports "off" while it is off, whatever the context does', () => {
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ onStateChange });
      const ctx = audio.ensure();
      audio.powerOff();
      expect(onStateChange).toHaveBeenLastCalledWith("off");
      ctx.changeState("suspended");
      expect(onStateChange).toHaveBeenLastCalledWith("off");
    });

    it("stays silent while off: a press or a note does not wake a suspended context", () => {
      installAudioContext();
      const audio = createAudioEngine();
      const target = fakeTarget();
      audio.unlockOnInteraction(target);
      const ctx = audio.ensure();
      audio.powerOff();
      ctx.changeState("suspended"); // the browser holds it
      ctx.resume.mockClear();

      target.listeners.find((l) => l.type === "pointerdown").handler();
      audio.ensure();
      expect(ctx.resume).not.toHaveBeenCalled();
      expect(audio.running).toBe(false);
    });

    it("builds a context made while off muted, so a gesture that starts it makes no sound", () => {
      installAudioContext();
      const audio = createAudioEngine({ volume: 0.5 });
      audio.powerOff(); // before any context exists
      audio.ensure();
      expect(audio.master.gain.value).toBe(0);
      audio.powerOn();
      expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, expect.any(Number), expect.any(Number));
    });

    it("turns back on: the sound returns at the volume it had and the state is reported", () => {
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ volume: 0.5, onStateChange });
      const ctx = audio.ensure();
      audio.powerOff();
      ctx.changeState("suspended"); // the browser stopped it meanwhile

      audio.powerOn();
      expect(audio.powered).toBe(true);
      expect(ctx.resume).toHaveBeenCalledTimes(2);
      expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, ctx.currentTime, expect.any(Number));
      expect(onStateChange).toHaveBeenLastCalledWith("running");
    });

    it("turning on with no context yet builds one and starts it, as a press would", () => {
      const instances = installAudioContext();
      const audio = createAudioEngine();
      audio.powerOff();
      audio.powerOn();
      expect(instances).toHaveLength(1);
      expect(audio.running).toBe(true);
    });

    it("never suspends the context, so a press during a fade has no suspension to race", () => {
      installAudioContext();
      const audio = createAudioEngine();
      const ctx = audio.ensure();
      audio.powerOff();
      audio.powerOn();
      audio.powerOff();
      audio.powerOn();
      expect(ctx.suspend).not.toHaveBeenCalled();
      expect(audio.running).toBe(true);
    });

    it("keeps a volume change made while off from bringing the sound back", () => {
      installAudioContext();
      const audio = createAudioEngine({ volume: 0.5 });
      const ctx = audio.ensure();
      audio.powerOff();
      audio.master.gain.setTargetAtTime.mockClear();

      audio.setVolume(0.9);
      expect(audio.master.gain.setTargetAtTime).not.toHaveBeenCalled();
      audio.powerOn();
      expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.9, ctx.currentTime, expect.any(Number));
    });
  });

  describe("unlockOnInteraction", () => {
    it("listens for a press or key in the capture phase, so no handler can stop it", () => {
      installAudioContext();
      const target = fakeTarget();
      createAudioEngine().unlockOnInteraction(target);
      expect(target.listeners.map((l) => l.type).sort()).toEqual(["keydown", "pointerdown"]);
      for (const { options } of target.listeners) expect(options).toEqual({ capture: true });
    });

    it("leaves a press on the POWER switch out, so the press that turns sound on finds it off", () => {
      const instances = installAudioContext();
      const audio = createAudioEngine();
      const target = fakeTarget();
      audio.unlockOnInteraction(target);
      const onSwitch = { target: { closest: (selector) => (selector === POWER_SWITCH ? {} : null) } };
      const elsewhere = { target: { closest: () => null } };

      for (const type of ["pointerdown", "keydown"]) target.listeners.find((l) => l.type === type).handler(onSwitch);
      expect(instances).toHaveLength(0);

      target.listeners.find((l) => l.type === "pointerdown").handler(elsewhere);
      expect(instances).toHaveLength(1);
    });

    it("starts audio when the first interaction happens, not before", () => {
      const instances = installAudioContext();
      const audio = createAudioEngine();
      const target = fakeTarget();
      audio.unlockOnInteraction(target);
      expect(instances).toHaveLength(0);

      target.listeners.find((l) => l.type === "pointerdown").handler();
      expect(instances).toHaveLength(1);
      expect(audio.running).toBe(true);
    });
  });
});

describe("softClipCurve", () => {
  // The curve is read as the signal goes from -1 to 1 across it, and the signal is halved first, so index i is
  // the output for an input of -reach + 2 * reach * i / (size - 1).
  const size = 4097;
  const curve = softClipCurve(CLIP, size);
  const at = (x) => curve[Math.round(((x + CLIP.reach) / (2 * CLIP.reach)) * (size - 1))];

  it("leaves what is below the knee alone, either side of zero", () => {
    for (const x of [0, 0.1, -0.3, 0.5, -0.69, 0.699]) expect(at(x)).toBeCloseTo(x, 3);
    expect(at(CLIP.knee)).toBeCloseTo(CLIP.knee, 3);
  });

  it("bends what is above it towards the ceiling, and never reaches it", () => {
    for (const x of [0.8, 1, 1.5, 2, -1.2, -2]) {
      expect(Math.abs(at(x))).toBeLessThan(CLIP.ceiling);
      expect(Math.abs(at(x))).toBeGreaterThan(CLIP.knee);
    }
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(0.8));
  });

  it("is symmetric, and has no step where it leaves the knee", () => {
    for (let i = 0; i < size; i++) expect(curve[i]).toBeCloseTo(-curve[size - 1 - i], 5);
    for (let i = 1; i < size; i++) expect(Math.abs(curve[i] - curve[i - 1])).toBeLessThan(0.0011); // the steepest part is 0.00098 a point
  });

  it("keeps the ceiling under full scale", () => {
    expect(CLIP.ceiling).toBeLessThan(1);
    expect(CLIP.knee).toBeLessThan(CLIP.ceiling);
  });
});

describe("killSound", () => {
  // The master gains the context made, in order, with the calls on each.
  function withMasters() {
    installAudioContext();
    const made = [];
    const audio = createAudioEngine({
      volume: 0.6,
      createContext: () => {
        const ctx = new AudioContext();
        ctx.currentTime = 2;
        ctx.createWaveShaper = undefined; // no clipper here: the masters connect straight to the speakers
        ctx.createGain = () => {
          const gain = { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
          made.push(gain);
          return gain;
        };
        return ctx;
      },
    });
    return { audio, made };
  }

  it("does nothing before the context exists, and says so", () => {
    const { audio, made } = withMasters();
    expect(audio.killSound()).toBe(false);
    expect(made).toHaveLength(0);
  });

  it("fades the master that sounds are connected to and cuts it off once it is silent", () => {
    vi.useFakeTimers();
    const { audio, made } = withMasters();
    audio.ensure();
    const old = audio.master;
    expect(audio.killSound()).toBe(true);
    const [target, when, constant] = old.gain.setTargetAtTime.mock.calls.at(-1);
    expect(target).toBe(0);
    expect(when).toBe(2);
    expect(constant).toBeLessThan(0.01); // faster than a power-off, and still a fade, so no click
    expect(old.disconnect).not.toHaveBeenCalled(); // not before the fade has had time
    vi.advanceTimersByTime(100);
    expect(old.disconnect).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(2);
    expect(audio.master).toBe(made[1]); // the new one is not the one that was cut off
    expect(made[1].disconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cuts off only the master it replaces, however many times it is called", () => {
    vi.useFakeTimers();
    const { audio, made } = withMasters();
    audio.ensure();
    audio.killSound();
    vi.advanceTimersByTime(30);
    audio.killSound(); // a second press before the first master has been disconnected
    vi.advanceTimersByTime(40); // the first one's timer is due, the second's is not
    expect(made[0].disconnect).toHaveBeenCalledTimes(1);
    expect(made[1].disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(made[1].disconnect).toHaveBeenCalledTimes(1);
    expect(made[2].disconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("raises the new master again when the power comes back on", () => {
    const { audio } = withMasters();
    audio.ensure();
    audio.powerOff();
    audio.killSound();
    audio.powerOn();
    expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.6, expect.any(Number), expect.any(Number));
  });

  it("gives sounds played afterwards a new master, at the level the volume is at, wired to the speakers", () => {
    const { audio } = withMasters();
    const ctx = audio.ensure();
    const old = audio.master;
    audio.setVolume(0.3);
    audio.killSound();
    expect(audio.master).not.toBe(old);
    expect(audio.master.gain.value).toBe(0.3);
    expect(audio.master.connect).toHaveBeenCalledWith(ctx.destination);
    audio.setVolume(0.5); // the volume control works on the new one
    expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, ctx.currentTime, expect.any(Number));
  });

  it("keeps the power off when it is killed while off", () => {
    const { audio } = withMasters();
    audio.ensure();
    audio.powerOff();
    audio.killSound();
    expect(audio.master.gain.value).toBe(0);
  });
});

describe("killSound with the clipper", () => {
  it("connects the new master to the same clipper, which stays", () => {
    vi.useFakeTimers(); // the cut-off master is disconnected from a timer, which must not outlive the test
    installAudioContext();
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    const old = audio.master;
    const half = old.connect.mock.calls[0][0];
    audio.killSound();
    expect(audio.master).not.toBe(old);
    expect(audio.master.connect).toHaveBeenCalledWith(half);
    expect(audio.master.connect).not.toHaveBeenCalledWith(ctx.destination);
    vi.runAllTimers();
    expect(old.disconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("channel analysers", () => {
  it("has none before the context exists", () => {
    installAudioContext({ analysers: true });
    expect(createAudioEngine().channelAnalysers).toBeNull();
  });

  it("has none when the context cannot make analysers", () => {
    installAudioContext();
    const audio = createAudioEngine();
    audio.ensure();
    expect(audio.channelAnalysers).toBeNull();
  });

  it("has none when the context can split channels but cannot make analysers", () => {
    installAudioContext({ analysers: false, splitter: true });
    const audio = createAudioEngine();
    expect(() => audio.ensure()).not.toThrow();
    expect(audio.channelAnalysers).toBeNull();
  });

  it("builds nothing for them until they are asked for, so a page that never reads them pays nothing", () => {
    installAudioContext({ analysers: true });
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    expect(ctx.splittersMade).toBeUndefined();
    const first = audio.channelAnalysers;
    expect(ctx.splittersMade).toBe(1);
    expect(audio.channelAnalysers).toBe(first); // built once
    expect(ctx.splittersMade).toBe(1);
  });

  it("gives none, and leaves the engine and its graph as they were, when building them fails", () => {
    installAudioContext({ analysers: true, splitter: "throws" });
    const audio = createAudioEngine();
    const ctx = audio.ensure();
    const clipperOutput = audio.master.connect.mock.calls[0][0].connect.mock.calls[0][0];
    const connectionsBefore = clipperOutput.connect.mock.calls.length;
    expect(() => audio.channelAnalysers).not.toThrow();
    expect(audio.channelAnalysers).toBeNull();
    expect(ctx.splittersMade).toBe(1); // tried once, not on every read
    expect(clipperOutput.connect.mock.calls).toHaveLength(connectionsBefore); // nothing was left wired
    expect(audio.master).not.toBeNull();
    expect(audio.ensure()).toBe(ctx); // still the same working engine
  });

  it("has none when the context cannot split channels, though it has the one analyser", () => {
    installAudioContext({ analysers: true, splitter: false });
    const audio = createAudioEngine();
    audio.ensure();
    expect(audio.analyser).not.toBeNull();
    expect(audio.channelAnalysers).toBeNull();
  });

  it("has none without the clipper, which is the fixed node they listen to", () => {
    installAudioContext({ analysers: true });
    const audio = createAudioEngine({
      createContext: () => {
        const ctx = new AudioContext();
        ctx.createWaveShaper = undefined;
        return ctx;
      },
    });
    audio.ensure();
    expect(audio.channelAnalysers).toBeNull();
  });

  it("makes an analyser for each side of what is heard, which only read", () => {
    installAudioContext({ analysers: true });
    const audio = createAudioEngine();
    audio.ensure();
    const [left, right] = audio.channelAnalysers;
    expect(audio.channelAnalysers).toHaveLength(2);
    expect(left).not.toBe(right);
    expect(left.fftSize).toBe(2048);
    expect(right.fftSize).toBe(2048);
    // nothing is wired on from them: they are read, not heard
    expect(left.connect).not.toHaveBeenCalled();
    expect(right.connect).not.toHaveBeenCalled();
  });

  it("feeds them from the clipper's output through a two-channel gain, so a mono sound is on both sides", () => {
    installAudioContext({ analysers: true });
    const audio = createAudioEngine();
    audio.ensure();
    const analysers = audio.channelAnalysers; // built when asked
    const clipperOutput = audio.master.connect.mock.calls[0][0].connect.mock.calls[0][0]; // master -> half -> shaper
    const stereo = clipperOutput.connect.mock.calls.map(([node]) => node).find((node) => node.channelCount === 2);
    expect(stereo).toBeDefined();
    expect(stereo.channelCountMode).toBe("explicit");
    expect(stereo.channelInterpretation).toBe("speakers");
    // the gain feeds a splitter of two outputs, which feeds the analysers: output 0 to the left, 1 to the right
    const splitter = stereo.connect.mock.calls[0][0];
    expect(splitter.outputs).toBe(2);
    expect(splitter.connect.mock.calls).toEqual([
      [analysers[0], 0],
      [analysers[1], 1],
    ]);
  });

  it("keeps them when sound is killed: they listen to the clipper, which stays", () => {
    vi.useFakeTimers();
    installAudioContext({ analysers: true });
    const audio = createAudioEngine();
    audio.ensure();
    const before = audio.channelAnalysers;
    audio.killSound();
    expect(audio.channelAnalysers).toBe(before);
    vi.runAllTimers();
    vi.useRealTimers();
  });
});
