import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHOKE_TIME_CONSTANT, CLEAN_UP_AFTER_S, createVoices } from "./voices.js";

// A context whose gain nodes record what is done to them.
function fakeContext(time = 10) {
  const nodes = [];
  const ctx = {
    currentTime: time,
    createGain: () => {
      const node = {
        gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
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
    expect(first.out.gain.setValueAtTime).toHaveBeenCalledWith(0, 10); // silenced at once: a fade would let it through
    expect(first.out.gain.setTargetAtTime).not.toHaveBeenCalled();
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

    it("cuts the pad's own voice and the group's other pads' voices with one hit", () => {
      const { ctx } = fakeContext(10);
      // pad 0 and pad 2 are in a group; the group's pad 1 is in no group
      const voices = createVoices(4, { groupOf: groups({ 0: 1, 2: 1 }) });
      const mine = voices.start(ctx, 0, {}, 10);
      const theirs = voices.start(ctx, 2, {}, 10.1); // cuts mine, at 10.1
      mine.out.gain.setTargetAtTime.mockClear();
      const another = voices.start(ctx, 1, {}, 10.2); // in no group: cuts nothing
      expect(another.chokes).toHaveLength(0);
      // a hit on pad 0 now: its own earlier voice is already cut (at 10.1, before this hit), the group's voice is not
      const next = voices.start(ctx, 0, {}, 10.5);
      expect(next.chokes.map((choke) => choke.voice)).toEqual([expect.objectContaining({ out: theirs.out })]);
      expect(theirs.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
    });

    it("cuts both the pad's own live voice and the group's live voice with one hit", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(4, { groupOf: groups({ 0: 1, 1: 1 }) });
      const own = voices.start(ctx, 0, {}, 10);
      const other = voices.start(ctx, 1, {}, 10); // the same moment: each cuts the other, silenced at once
      const next = voices.start(ctx, 0, {}, 10.5);
      expect(next.chokes).toHaveLength(1); // the group's voice; the pad's own was already cut at 10
      expect(own.out.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
      expect(other.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
    });

    it("when two pads of a group start at the same moment, silences the earlier-handled one and keeps the later", () => {
      const { ctx } = fakeContext(11);
      const voices = createVoices(4, { groupOf: groups({ 0: 1, 1: 1, 2: 1 }) });
      const a = voices.start(ctx, 0, {}, 11);
      const b = voices.start(ctx, 1, {}, 11);
      const c = voices.start(ctx, 2, {}, 11);
      expect(a.out.gain.setValueAtTime).toHaveBeenCalledWith(0, 11);
      expect(b.out.gain.setValueAtTime).toHaveBeenCalledWith(0, 11);
      expect(c.out.gain.setValueAtTime).not.toHaveBeenCalled();
      expect(c.out.gain.setTargetAtTime).not.toHaveBeenCalled();
    });

    it("takes back only the cut of the hit that is cancelled when two pads' hits cut the same voice", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(4, { groupOf: groups({ 0: 1, 1: 1, 2: 1 }) });
      const long = voices.start(ctx, 0, {}, 10);
      const late = voices.start(ctx, 1, {}, 10.5); // cuts it at 10.5
      const early = voices.start(ctx, 2, {}, 10.3); // cuts it at 10.3, earlier: that is the cut now
      expect(long.out.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10.3, CHOKE_TIME_CONSTANT);
      voices.undo(early.chokes); // the earlier hit is cancelled: the later one's cut is what is left
      expect(long.out.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
      voices.undo(late.chokes); // and then that one too: no cut
      expect(long.out.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0);
      expect(long.out.gain.setTargetAtTime).toHaveBeenCalledTimes(3); // 10.5, 10.3, and 10.5 again; none after the last undo
    });

    it("does not cut a voice that was playing when its pad left the group", () => {
      const { ctx } = fakeContext(10);
      const map = { 0: 1, 1: 1 };
      const voices = createVoices(2, { groupOf: (pad) => map[pad] });
      const old = voices.start(ctx, 0, {}, 10);
      map[0] = 0; // pad 0 leaves the group while its voice plays
      const next = voices.start(ctx, 1, {}, 10.5);
      expect(next.chokes).toHaveLength(0);
      expect(old.out.gain.setTargetAtTime).not.toHaveBeenCalled();
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

  describe("a pad's release", () => {
    it("is how long a cut takes to fade: spread over a few time constants, never faster than the short fade", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(2, { releaseOf: (pad) => (pad === 0 ? 2 : 0) });
      const slow = voices.start(ctx, 0, {}, 10);
      voices.start(ctx, 0, {}, 11);
      expect(slow.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 11, 2 / 7); // 2 s over seven time constants
      const quick = voices.start(ctx, 1, {}, 12);
      voices.start(ctx, 1, {}, 13);
      expect(quick.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 13, CHOKE_TIME_CONSTANT);
    });

    it("never goes below the short fade, however small it is", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(1, { releaseOf: () => 0.004 });
      const first = voices.start(ctx, 0, {}, 10);
      voices.start(ctx, 0, {}, 10.5);
      expect(first.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 10.5, CHOKE_TIME_CONSTANT);
    });

    it("is far down by the time the voice is disconnected, so there is no step to hear", () => {
      const { ctx } = fakeContext(10);
      for (const release of [0.5, 2, 5]) {
        const voices = createVoices(1, { releaseOf: () => release });
        const first = voices.start(ctx, 0, {}, 10);
        voices.start(ctx, 0, {}, 10);
        // not the equal-moment case: a later hit
        const later = createVoices(1, { releaseOf: () => release });
        const a = later.start(ctx, 0, {}, 10);
        later.start(ctx, 0, {}, 11);
        const constant = a.out.gain.setTargetAtTime.mock.calls[0][2];
        const left = Math.exp(-(release + 0.1) / constant); // the level when the voice is disconnected, from 1
        expect(left, `release ${release}`).toBeLessThan(0.002); // under -54 dB
        expect(first.out.gain.setValueAtTime).toHaveBeenCalled();
      }
    });

    it("keeps the voice connected for the release, and a little longer", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(1, { releaseOf: () => 2 });
      const first = voices.start(ctx, 0, {}, 10);
      voices.start(ctx, 0, {}, 10.5); // the cut is half a second away, and takes two seconds
      vi.advanceTimersByTime(2500);
      expect(first.out.disconnect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(first.out.disconnect).toHaveBeenCalledTimes(1);
    });

    it("is the voice's own, read when the hit starts, so changing it later does not change a voice already playing", () => {
      const { ctx } = fakeContext(10);
      let release = 2;
      const voices = createVoices(1, { releaseOf: () => release });
      const first = voices.start(ctx, 0, {}, 10);
      release = 0;
      voices.start(ctx, 0, {}, 11);
      expect(first.out.gain.setTargetAtTime).toHaveBeenCalledWith(0, 11, 2 / 7);
    });

    it("does not delay a cut that silences a voice at once (two hits at the same moment)", () => {
      const { ctx } = fakeContext(10);
      const voices = createVoices(1, { releaseOf: () => 2 });
      const first = voices.start(ctx, 0, {}, 10);
      voices.start(ctx, 0, {}, 10);
      expect(first.out.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
    });
  });
});

describe("createVoices, in an offline render", () => {
  // An offline context's clock stays at 0 until the render runs, so every hit is scheduled with `currentTime` at 0.
  const plainContext = () => ({
    currentTime: 0,
    createGain: () => ({
      gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} },
      connect() {},
      disconnect() {},
    }),
  });

  it("still cuts the pad's last hit when the next comes, and forgets one cut long before", () => {
    const ctx = plainContext();
    const voices = createVoices(2, { cleanUp: false });
    voices.start(ctx, 0, {}, 1);
    expect(voices.start(ctx, 0, {}, 100).chokes).toHaveLength(1); // the hit at 1 is cut at 100
    expect(voices.start(ctx, 0, {}, 200).chokes).toHaveLength(1); // only the one at 100: the one at 1 is long gone
  });

  it("does not slow down as passes are added: a hit looks at the voices still sounding, not at every one since the start", () => {
    // Nine passes of a dense 8 bars on 16 pads in one choke group, as a long export with loops makes. Each hit used to
    // look at every voice scheduled before it (about 15 s here); now only at those cut within the last moment.
    vi.useRealTimers();
    const ctx = plainContext();
    const voices = createVoices(16, { cleanUp: false, groupOf: () => 1 });
    const began = performance.now();
    for (let pass = 0; pass < 9; pass++)
      for (let step = 0; step < 128; step++)
        for (let pad = 0; pad < 16; pad++) voices.start(ctx, pad, {}, 0.01 + (pass * 128 + step) * 0.125);
    expect(performance.now() - began).toBeLessThan(3000);
  }, 60000);
});

describe("createVoices, stopping what was cut (an offline render)", () => {
  // A source that keeps on running after its voice is cut makes no sound, but the render still does the work of it: a
  // ten second sample cut after a tenth of a second is nine and nine tenths of silence to compute.
  const plainContext = () => ({
    currentTime: 0,
    createGain: () => ({
      gain: { cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} },
      connect() {},
      disconnect() {},
    }),
  });

  it("stops a voice's source a little after the cut, when it was told how", () => {
    const ctx = plainContext();
    const voices = createVoices(2, { cleanUp: false, stopCut: true });
    const stop = vi.fn();
    voices.start(ctx, 0, {}, 1).stopWith(stop);
    expect(stop).not.toHaveBeenCalled(); // nothing cuts it yet
    voices.start(ctx, 0, {}, 5);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(5 + CLEAN_UP_AFTER_S); // by then the fade is far below hearing
  });

  it("leaves room for the pad's release: the fade takes that long", () => {
    const ctx = plainContext();
    const voices = createVoices(2, { cleanUp: false, stopCut: true, releaseOf: () => 5 });
    const stop = vi.fn();
    voices.start(ctx, 0, {}, 1).stopWith(stop);
    voices.start(ctx, 0, {}, 5);
    // the cut fades with a time constant of a seventh of the release: twice the release is fourteen of them
    expect(stop).toHaveBeenCalledWith(5 + 2 * 5 + CLEAN_UP_AFTER_S);
  });

  it("stops the voice of another pad in the choke group that the new hit cuts", () => {
    const ctx = plainContext();
    const voices = createVoices(3, { cleanUp: false, stopCut: true, groupOf: () => 1 });
    const stop = vi.fn();
    voices.start(ctx, 0, {}, 1).stopWith(stop);
    voices.start(ctx, 2, {}, 3);
    expect(stop).toHaveBeenCalledWith(3 + CLEAN_UP_AFTER_S);
  });

  it("stops each voice once, and not one that was never cut", () => {
    const ctx = plainContext();
    const voices = createVoices(2, { cleanUp: false, stopCut: true });
    const first = vi.fn();
    const other = vi.fn();
    voices.start(ctx, 0, {}, 1).stopWith(first);
    voices.start(ctx, 1, {}, 1).stopWith(other); // another pad, no group
    voices.start(ctx, 0, {}, 2);
    voices.start(ctx, 0, {}, 3); // the one at 2 is cut here; the one at 1 is already gone
    expect(first).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("does nothing for a sound that gave nothing to stop (a built-in one stops itself)", () => {
    const ctx = plainContext();
    const voices = createVoices(1, { cleanUp: false, stopCut: true });
    voices.start(ctx, 0, {}, 1).stopWith(undefined);
    expect(() => voices.start(ctx, 0, {}, 2)).not.toThrow();
  });

  it("stops nothing on the page itself: only an offline render asks for it", () => {
    const { ctx } = fakeContext(0);
    const voices = createVoices(1); // as the page makes them
    const stop = vi.fn();
    voices.start(ctx, 0, {}, 1).stopWith(stop);
    voices.start(ctx, 0, {}, 2);
    expect(stop).not.toHaveBeenCalled();
  });
});
