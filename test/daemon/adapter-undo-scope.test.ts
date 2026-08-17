import { describe, expect, test } from "bun:test";

import { AdapterUndoScope } from "../../src/daemon/adapter-undo-scope.ts";

describe("AdapterUndoScope", () => {
  test("replays effects in reverse registration order", async () => {
    const scope = new AdapterUndoScope();
    const order: string[] = [];
    scope.effect("a", () => { order.push("undo-a"); });
    scope.effect("b", () => { order.push("undo-b"); });
    scope.effect("c", () => { order.push("undo-c"); });

    const undone = await scope.undoAll();
    expect(order).toEqual(["undo-c", "undo-b", "undo-a"]);
    expect(undone).toEqual(["c", "b", "a"]);
  });

  test("undoAll is idempotent", async () => {
    const scope = new AdapterUndoScope();
    let count = 0;
    scope.effect("a", () => { count += 1; });
    await scope.undoAll();
    await scope.undoAll();
    expect(count).toBe(1);
  });

  test("a failing undo does not block the rest", async () => {
    const scope = new AdapterUndoScope();
    const order: string[] = [];
    scope.effect("boom", () => { throw new Error("nope"); });
    scope.effect("ok", () => { order.push("undo-ok"); });

    const undone = await scope.undoAll();
    // Reverse registration order: "ok" (registered later) undoes first.
    expect(undone[0]).toBe("ok");
    expect(undone[1]).toContain("boom");
    expect(undone[1]).toContain("error");
    expect(order).toEqual(["undo-ok"]);
  });

  test("cannot register after undo", async () => {
    const scope = new AdapterUndoScope();
    await scope.undoAll();
    expect(() => scope.effect("late", () => undefined)).toThrow(/after undo/);
  });

  test("exposes registered names and size", () => {
    const scope = new AdapterUndoScope();
    scope.effect("free-pass-state", () => undefined);
    scope.effect("endpoint", () => undefined);
    expect(scope.size).toBe(2);
    expect(scope.names()).toEqual(["free-pass-state", "endpoint"]);
  });
});
