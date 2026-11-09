import { describe, expect, it } from "vitest";
import { createHistory } from "./history.js";

describe("createHistory", () => {
  it("has nothing to undo or redo at first", () => {
    const history = createHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo("now")).toBeNull();
    expect(history.redo("now")).toBeNull();
  });

  it("goes back to the state before the last change, and forward again", () => {
    const history = createHistory();
    history.push("a"); // a -> b
    history.push("b"); // b -> c
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBe("a");
    expect(history.canUndo).toBe(false);
    expect(history.redo("a")).toBe("b");
    expect(history.redo("b")).toBe("c");
    expect(history.canRedo).toBe(false);
  });

  it("can undo again after a redo, back to where it was", () => {
    const history = createHistory();
    history.push("a");
    expect(history.undo("b")).toBe("a");
    expect(history.redo("a")).toBe("b");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.undo("b")).toBe("a");
    expect(history.canRedo).toBe(true);
  });

  it("ends the redo line when something new is pushed", () => {
    const history = createHistory();
    history.push("a");
    history.undo("b");
    expect(history.canRedo).toBe(true);
    history.push("a");
    expect(history.canRedo).toBe(false);
  });

  it("forgets the oldest changes past the limit", () => {
    const history = createHistory({ limit: 2 });
    ["a", "b", "c"].forEach((state) => history.push(state));
    expect(history.undo("d")).toBe("c");
    expect(history.undo("c")).toBe("b");
    expect(history.undo("b")).toBeNull();
  });

  it("clears both ways", () => {
    const history = createHistory();
    history.push("a");
    history.undo("b");
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
