import { describe, expect, it, vi } from "vitest";
import { createLiveMixer, createMixer } from "./mixer.js";

// A context that makes gain nodes which record what they were connected to.
function fakeContext() {
  const nodes = [];
  return {
    nodes,
    createGain: vi.fn(() => {
      const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      nodes.push(node);
      return node;
    }),
  };
}

describe("createMixer", () => {
  it("makes one strip for each pad, each leading to the output, and nothing else", () => {
    const ctx = fakeContext();
    const output = { id: "output" };
    createMixer(ctx, output, { pads: 4 });
    expect(ctx.nodes).toHaveLength(4);
    for (const node of ctx.nodes) expect(node.connect).toHaveBeenCalledExactlyOnceWith(output);
  });

  it("gives each pad its own strip, which passes the signal on as it is", () => {
    const ctx = fakeContext();
    const mixer = createMixer(ctx, {}, { pads: 3 });
    const inputs = [0, 1, 2].map((pad) => mixer.padInput(pad));
    expect(new Set(inputs).size).toBe(3);
    expect(mixer.padInput(1)).toBe(inputs[1]);
    for (const input of inputs) expect(input.gain.value).toBe(1);
  });
});

describe("createLiveMixer", () => {
  function fakeAudio() {
    const ctx = fakeContext();
    return { ctx, master: { id: "master 1" } };
  }

  it("builds nothing until a hit asks, then leads into the master", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, { pads: 2 });
    expect(audio.ctx.nodes).toHaveLength(0);
    const input = live.padInput(1);
    expect(audio.ctx.nodes).toHaveLength(2);
    expect(input.connect).toHaveBeenCalledWith(audio.master);
  });

  it("says so, and builds nothing, when the audio engine has not made its master yet", () => {
    const audio = { ctx: fakeContext(), master: null };
    const live = createLiveMixer(audio, { pads: 2 });
    expect(() => live.padInput(0)).toThrow(/audio\.ensure/);
    expect(audio.ctx.nodes).toHaveLength(0);
  });

  it("keeps the same strips while the master is the same one", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, { pads: 2 });
    expect(live.padInput(0)).toBe(live.padInput(0));
    expect(audio.ctx.nodes).toHaveLength(2);
  });

  it("builds new strips on the master that replaced the old one (after all sound is cut off), and leaves the old ones alone", () => {
    const audio = fakeAudio();
    const live = createLiveMixer(audio, { pads: 2 });
    const before = live.padInput(0);
    audio.master = { id: "master 2" };
    const after = live.padInput(0);
    expect(after).not.toBe(before);
    expect(after.connect).toHaveBeenCalledWith(audio.master);
    expect(before.disconnect).not.toHaveBeenCalled(); // the old master's own fade-out ends it
    expect(live.padInput(0)).toBe(after);
  });
});
