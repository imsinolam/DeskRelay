import { describe, expect, test } from "bun:test";

import { CodexInboundTaskQueue } from "../../src/bridge/codex-inbound-queue.ts";

describe("CodexInboundTaskQueue", () => {
  test("keeps FIFO queues independent for each desktop task", () => {
    const queue = new CodexInboundTaskQueue<string>();

    expect(queue.enqueue("thread_a", "a1")).toBe(1);
    expect(queue.enqueue("thread_b", "b1")).toBe(1);
    expect(queue.enqueue("thread_a", "a2")).toBe(2);

    expect(queue.peek("thread_a")).toBe("a1");
    expect(queue.items("thread_a")).toEqual(["a1", "a2"]);
    expect(queue.entries()).toEqual([
      { threadId: "thread_a", items: ["a1", "a2"] },
      { threadId: "thread_b", items: ["b1"] },
    ]);
    expect(queue.shift("thread_a")).toBe("a1");
    expect(queue.shift("thread_b")).toBe("b1");
    expect(queue.shift("thread_a")).toBe("a2");
    expect(queue.shift("thread_a")).toBeNull();
  });

  test("prevents concurrent drains for the same task but allows another task", () => {
    const queue = new CodexInboundTaskQueue<string>();

    expect(queue.beginDrain("thread_a")).toBe(true);
    expect(queue.beginDrain("thread_a")).toBe(false);
    expect(queue.beginDrain("thread_b")).toBe(true);

    queue.endDrain("thread_a");
    expect(queue.beginDrain("thread_a")).toBe(true);
  });

  test("can put a transiently blocked message back at the front", () => {
    const queue = new CodexInboundTaskQueue<string>();
    queue.enqueue("thread_a", "a2");
    queue.prepend("thread_a", "a1");

    expect(queue.count("thread_a")).toBe(2);
    expect(queue.shift("thread_a")).toBe("a1");
    expect(queue.shift("thread_a")).toBe("a2");
  });

  test("lists only tasks that still have queued messages", () => {
    const queue = new CodexInboundTaskQueue<string>();
    queue.enqueue("thread_a", "a1");
    queue.enqueue("thread_b", "b1");

    expect(queue.threadIds()).toEqual(["thread_a", "thread_b"]);
    queue.shift("thread_a");
    expect(queue.threadIds()).toEqual(["thread_b"]);
    queue.clear();
    expect(queue.threadIds()).toEqual([]);
  });
});
