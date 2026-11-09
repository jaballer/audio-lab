import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHOKE_TIME_CONSTANT, createVoices } from "./voices.js";

// A context whose gain nodes record what is done to them.
function fakeContext(time = 10) {
  const nodes = [];
  const ctx = {
    currentTime: time,
    createGain: () => {
      const node = {
        gain: { value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      nodes.push(node);
      return node;
    },
  };
  return { ctx, nodes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createVoices", () => {
  it("gives each hit a gain node of its own, connected to where it is told", () => {
    const { ctx } = fakeContext();
    const voices = createVoices(4);
    const destination = { name: "bus" };
    const a = voices.start(ctx, 0, destination, 10);
    const b = voices.start(ctx, 1, destination, 10);
    expect(a.out).not.toBe(b.out);
    expect(a.out.connect).toHaveBeenCalledWith(destination);
  });

  it("cuts off what the same pad was playing, from the time the new hit starts, with a fade", () => {
    const { ctx } = fakeContext();
    const voices = createVoices(4);
    const first = voices.start(ctx, 2, {}, 10);
    expect(first.chokes).toEqual([]); // nothing to cut the first time
    ctx.currentTime = 11;
    const second = voices.start(ctx, 2, {}, 11.5);
    expect(first.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 11.5, CHOKE_TIME_CONSTANT);
    expect(second.out.gain.setTargetAtTime).not.toHaveBeenCalled(); // the new one is not cut
    expect(second.chokes).toHaveLength(1);
  });

  it("leaves other pads alone", () => {
    const { ctx } = fakeContext();
    const voices = createVoices(4);
    const kick = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 1, {}, 10.5);
    expect(kick.out.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("cuts a voice only once, however many hits follow it", () => {
    const { ctx } = fakeContext();
    const voices = createVoices(2);
    const first = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 0, {}, 10.5);
    voices.start(ctx, 0, {}, 11);
    expect(first.out.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
  });

  it("does not cut a voice that starts later than the new hit (a step already queued ahead of a live hit)", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const queued = voices.start(ctx, 0, {}, 10.1); // a sequenced hit, handed to the audio clock early
    voices.start(ctx, 0, {}, 10); // a live hit now
    expect(queued.out.gain.setTargetAtTime).not.toHaveBeenCalled();
  });

  it("disconnects a cut voice a little after the cut, not before", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const first = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 0, {}, 10.5); // the cut is half a second away
    vi.advanceTimersByTime(500);
    expect(first.out.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(first.out.disconnect).toHaveBeenCalledTimes(1);
  });

  it("lets what a cancelled hit was going to cut carry on", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const first = voices.start(ctx, 0, {}, 10);
    const second = voices.start(ctx, 0, {}, 10.5);
    voices.undo(second.chokes);
    expect(first.out.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(5000);
    expect(first.out.disconnect).not.toHaveBeenCalled(); // and it is not cleaned up
    // and a later hit cuts it again
    voices.start(ctx, 0, {}, 11);
    expect(first.out.gain.setTargetAtTime).toHaveBeenCalledTimes(2);
  });

  it("cuts a voice at the earlier time when a hit comes before the cut a queued step asked for", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const long = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 0, {}, 10.425); // a queued step cuts it at 10.425
    voices.start(ctx, 0, {}, 10.41); // a live tap before that
    expect(long.out.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10.41, CHOKE_TIME_CONSTANT);
  });

  it("keeps the earlier cut when the queued step that asked for the later one is cancelled", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const long = voices.start(ctx, 0, {}, 10);
    const queued = voices.start(ctx, 0, {}, 10.425);
    voices.start(ctx, 0, {}, 10.41);
    long.out.gain.setTargetAtTime.mockClear();
    voices.undo(queued.chokes);
    expect(long.out.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10.41, CHOKE_TIME_CONSTANT); // still cut, by the tap
  });

  it("goes back to the queued step's cut when the tap that came before it is the one taken back", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const long = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 0, {}, 10.425);
    const tap = voices.start(ctx, 0, {}, 10.41);
    voices.undo(tap.chokes);
    expect(long.out.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10.425, CHOKE_TIME_CONSTANT);
  });

  it("gives back every voice when several queued hits on one pad are cancelled together", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const first = voices.start(ctx, 0, {}, 10);
    const a = voices.start(ctx, 0, {}, 10.1);
    const b = voices.start(ctx, 0, {}, 10.2);
    const c = voices.start(ctx, 0, {}, 10.3);
    voices.undo([...c.chokes, ...b.chokes, ...a.chokes]);
    vi.advanceTimersByTime(5000);
    expect(first.out.disconnect).not.toHaveBeenCalled();
    expect(a.out.disconnect).not.toHaveBeenCalled();
    expect(b.out.disconnect).not.toHaveBeenCalled();
    expect(first.out.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0); // no cut left on it
  });

  it("cuts a hit that comes at the same moment, as two hits within one render quantum do", () => {
    const { ctx } = fakeContext(10);
    const voices = createVoices(2);
    const first = voices.start(ctx, 0, {}, 10);
    voices.start(ctx, 0, {}, 10);
    expect(first.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10, CHOKE_TIME_CONSTANT);
  });

  describe("choke groups", () => {
    // pad -> group
    const groups = (map) => (pad) => map[pad] ?? 0;

    it("cuts what another pad in the same group was playing, from the moment the new hit starts", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(4, { groupOf: groups({ 2: 1, 3: 1 }) });
      const open = voices.start(ctx, 3, {}, 10);
      const closed = voices.start(ctx, 2, {}, 10.5);
      expect(open.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
      expect(closed.out.gain.setTargetAtTime).not.toHaveBeenCalled();
      expect(closed.chokes).toHaveLength(1);
    });

    it("works both ways: any pad in the group cuts the others", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(4, { groupOf: groups({ 2: 1, 3: 1 }) });
      const closed = voices.start(ctx, 2, {}, 10);
      voices.start(ctx, 3, {}, 10.5);
      expect(closed.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
    });

    it("leaves pads in another group, and pads in no group, playing", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(5, { groupOf: groups({ 1: 1, 2: 2, 3: 1 }) });
      const other = voices.start(ctx, 2, {}, 10); // group 2
      const none = voices.start(ctx, 0, {}, 10); // no group
      voices.start(ctx, 1, {}, 10.5); // group 1
      voices.start(ctx, 3, {}, 11); // group 1
      expect(other.out.gain.setTargetAtTime).not.toHaveBeenCalled();
      expect(none.out.gain.setTargetAtTime).not.toHaveBeenCalled();
    });

    it("does not make pads with no group cut each other (group 0 is no group)", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(3);
      const a = voices.start(ctx, 0, {}, 10);
      voices.start(ctx, 1, {}, 10.5);
      expect(a.out.gain.setTargetAtTime).not.toHaveBeenCalled();
    });

    it("still cuts the pad's own earlier voice, and the group's, with one hit", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(4, { groupOf: groups({ 0: 1, 1: 1 }) });
      const mine = voices.start(ctx, 0, {}, 10);
      const theirs = voices.start(ctx, 1, {}, 10.2);
      const next = voices.start(ctx, 0, {}, 10.5);
      expect(next.chokes).toHaveLength(1); // theirs was cut by mine already, and mine by theirs
      expect(mine.out.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
      expect(theirs.out.gain.setTargetAtTime).toHaveBeenCalledTimes(1);
    });

    it("reads the group when the hit starts, so a pad moved into a group is cut from then on", () => {
      const { ctx } = fakeContext(10);
      const map = { 0: 0, 1: 0 };
      const voices = createVoices(2, { groupOf: (pad) => map[pad] });
      const first = voices.start(ctx, 0, {}, 10);
      map[0] = 1;
      map[1] = 1;
      voices.start(ctx, 1, {}, 10.5);
      expect(first.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
    });

    it("gives back another pad's voice when the hit that was going to cut it is cancelled", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(3, { groupOf: groups({ 0: 1, 1: 1 }) });
      const open = voices.start(ctx, 1, {}, 10);
      const closed = voices.start(ctx, 0, {}, 10.5);
      voices.undo(closed.chokes);
      vi.advanceTimersByTime(5000);
      expect(open.out.disconnect).not.toHaveBeenCalled();
      expect(open.out.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    });

    it("does not cut a voice of the group that starts after the hit", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(3, { groupOf: groups({ 0: 1, 1: 1 }) });
      const queued = voices.start(ctx, 1, {}, 10.3);
      voices.start(ctx, 0, {}, 10); // a live tap before it
      expect(queued.out.gain.setTargetAtTime).not.toHaveBeenCalled();
    });
  });
});
