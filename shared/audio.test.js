import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioEngine } from "./audio.js";

// An AudioContext that starts suspended, as browsers make it until a user
// gesture, and remembers every instance so a test can tell whether one was built.
function installAudioContext() {
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
      return { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn() };
    }
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
    afterEach(() => vi.useRealTimers());

    it("starts on, and turning it off fades the sound out before the context is suspended", () => {
      vi.useFakeTimers();
      installAudioContext();
      const audio = createAudioEngine({ volume: 0.5 });
      const ctx = audio.ensure();
      expect(audio.powered).toBe(true);

      audio.powerOff();
      expect(audio.powered).toBe(false);
      // Faded first: suspending a sounding context would cut it off with a click.
      expect(audio.master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, ctx.currentTime, expect.any(Number));
      expect(ctx.suspend).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(ctx.suspend).toHaveBeenCalledTimes(1);
    });

    it('reports "off" while it is off, whatever the context does', () => {
      vi.useFakeTimers();
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ onStateChange });
      const ctx = audio.ensure();
      audio.powerOff();
      expect(onStateChange).toHaveBeenLastCalledWith("off");
      vi.runAllTimers();
      ctx.changeState("suspended");
      expect(onStateChange).toHaveBeenLastCalledWith("off");
    });

    it("stays silent while off: a press or a note does not wake the context", () => {
      vi.useFakeTimers();
      installAudioContext();
      const audio = createAudioEngine();
      const target = fakeTarget();
      audio.unlockOnInteraction(target);
      const ctx = audio.ensure();
      audio.powerOff();
      vi.runAllTimers();
      ctx.resume.mockClear();

      target.listeners.find((l) => l.type === "pointerdown").handler();
      audio.ensure();
      expect(ctx.resume).not.toHaveBeenCalled();
      expect(audio.running).toBe(false);
    });

    it("suspends a context that a gesture just started while it is off", () => {
      installAudioContext();
      const audio = createAudioEngine();
      audio.powerOff(); // before any context exists
      const ctx = audio.ensure();
      ctx.changeState("running"); // a browser starts a context built during a gesture
      audio.ensure();
      expect(ctx.suspend).toHaveBeenCalled();
      expect(audio.running).toBe(false);
    });

    it("turns back on: the sound returns at the volume it had and the state is reported", () => {
      vi.useFakeTimers();
      installAudioContext();
      const onStateChange = vi.fn();
      const audio = createAudioEngine({ volume: 0.5, onStateChange });
      const ctx = audio.ensure();
      audio.powerOff();
      vi.runAllTimers();

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

    it("does not suspend if the power came back before the fade finished", () => {
      vi.useFakeTimers();
      installAudioContext();
      const audio = createAudioEngine();
      const ctx = audio.ensure();
      audio.powerOff();
      audio.powerOn();
      vi.runAllTimers();
      expect(ctx.suspend).not.toHaveBeenCalled();
    });

    it("keeps a volume change made while off from bringing the sound back", () => {
      vi.useFakeTimers();
      installAudioContext();
      const audio = createAudioEngine({ volume: 0.5 });
      const ctx = audio.ensure();
      audio.powerOff();
      vi.runAllTimers();
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
