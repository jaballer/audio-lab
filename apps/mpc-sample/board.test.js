import { describe, expect, it } from "vitest";
import { BANK_LETTERS, bankLabel, createBoard } from "./board.js";

const down = (index, bank = 0, velocity = 100) => ({
  type: "padDown",
  index,
  bank,
  note: 36 + bank * 16 + index,
  velocity,
});
const up = (index, bank = 0) => ({ type: "padUp", index, bank, note: 36 + bank * 16 + index });
const press = (index, pressure, bank = 0) => ({
  type: "padPressure",
  index,
  bank,
  note: 36 + bank * 16 + index,
  pressure,
});

describe("a fresh board", () => {
  it("shows bank A with 16 idle pads and nothing played", () => {
    const { bank, pads, seen, last } = createBoard().snapshot();
    expect(bank).toBe(0);
    expect(pads).toHaveLength(16);
    expect(pads.every((p) => !p.down && p.hits === 0 && p.velocity === 0 && p.pressure === 0)).toBe(true);
    expect(seen).toEqual([]);
    expect(last).toBeNull();
  });
});

describe("hits", () => {
  it("holds a pad down with the velocity it was hit at, and counts the hit", () => {
    const board = createBoard();
    board.apply(down(2, 0, 78));
    const { pads, last } = board.snapshot();
    expect(pads[2]).toMatchObject({ down: true, velocity: 78, hits: 1 });
    expect(pads[3].down).toBe(false);
    expect(last).toMatchObject({ index: 2, bank: 0, note: 38, velocity: 78, hits: 1 });
  });

  it("lets go on release and keeps the count", () => {
    const board = createBoard();
    board.apply(down(2));
    board.apply(up(2));
    board.apply(down(2));
    expect(board.snapshot().pads[2]).toMatchObject({ down: true, hits: 2 });
    board.apply(up(2));
    expect(board.snapshot().pads[2]).toMatchObject({ down: false, hits: 2 });
  });

  it("follows pressure on a held pad, and clears it on release", () => {
    const board = createBoard();
    board.apply(down(0));
    board.apply(press(0, 104));
    expect(board.snapshot().pads[0].pressure).toBe(104);
    expect(board.snapshot().last.pressure).toBe(104);
    board.apply(up(0));
    expect(board.snapshot().pads[0].pressure).toBe(0);
  });
});

describe("banks", () => {
  it("shows the bank that was last played, with its own pads", () => {
    const board = createBoard();
    board.apply(down(0, 0));
    board.apply(down(15, 1));
    const { bank, pads, seen } = board.snapshot();
    expect(bank).toBe(1);
    expect(pads[15]).toMatchObject({ down: true, hits: 1 });
    expect(pads[0]).toMatchObject({ down: false, hits: 0 });
    expect(seen).toEqual([0, 1]);
  });

  it("remembers each bank's hits when the player goes back", () => {
    const board = createBoard();
    board.apply(down(4, 0));
    board.apply(down(4, 1));
    board.apply(down(4, 0));
    const { bank, pads } = board.snapshot();
    expect(bank).toBe(0);
    expect(pads[4].hits).toBe(2);
  });

  it("does not switch bank for a release or pressure that arrives late", () => {
    const board = createBoard();
    board.apply(down(0, 0));
    board.apply(down(0, 1));
    board.apply(press(0, 50, 0));
    board.apply(up(0, 0));
    expect(board.snapshot().bank).toBe(1);
    expect(board.snapshot().pads[0].down).toBe(true); // bank B's pad is still held
  });

  it("lists banks in order, only those with a hit", () => {
    const board = createBoard();
    board.apply(down(0, 2));
    board.apply(down(0, 0));
    board.apply(press(0, 5, 4)); // pressure alone is not a hit
    expect(board.snapshot().seen).toEqual([0, 2]);
  });
});

// An unplugged device cannot send the release for a pad it was holding.
describe("releaseAll", () => {
  it("lets go of every held pad in every bank and clears pressure, keeping the hit counts", () => {
    const board = createBoard();
    board.apply(down(1, 0));
    board.apply(press(1, 50, 0));
    board.apply(down(2, 1));
    board.apply(press(2, 70, 1));
    board.releaseAll();

    const bankB = board.snapshot();
    expect(bankB.bank).toBe(1);
    expect(bankB.pads[2]).toMatchObject({ down: false, pressure: 0, hits: 1 });
    expect(bankB.last.pressure).toBe(0);

    board.apply(down(3, 0)); // back to bank A to read its pads
    board.apply(up(3, 0));
    expect(board.snapshot().pads[1]).toMatchObject({ down: false, pressure: 0, hits: 1 });
  });

  it("does nothing to a board with nothing held", () => {
    const board = createBoard();
    board.releaseAll();
    expect(board.snapshot().pads.every((p) => !p.down && p.hits === 0)).toBe(true);
  });
});

describe("bankLabel", () => {
  it("names banks A-H and falls back to a number past them", () => {
    expect(BANK_LETTERS).toBe("ABCDEFGH");
    expect(bankLabel(0)).toBe("A");
    expect(bankLabel(7)).toBe("H");
    expect(bankLabel(8)).toBe("9");
  });
});
