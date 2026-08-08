import { describe, expect, test } from "bun:test";

import {
  CodexCompletionDeliveryQueue,
  type CodexCompletionDeliveryState,
} from "../../src/daemon/codex-completion-delivery.ts";

function buildQueue(
  initial?: CodexCompletionDeliveryState,
  snapshots: CodexCompletionDeliveryState[] = [],
): CodexCompletionDeliveryQueue {
  return new CodexCompletionDeliveryQueue({
    initial,
    now: () => Date.parse("2026-08-08T12:00:00.000Z"),
    persist: (state) => snapshots.push(structuredClone(state)),
  });
}

describe("Codex completion delivery queue", () => {
  test("retains a stale-token 0/N delivery for retry", async () => {
    const snapshots: CodexCompletionDeliveryState[] = [];
    const queue = buildQueue(undefined, snapshots);
    queue.enqueue({
      key: "thread:turn",
      threadId: "thread",
      turnId: "turn",
      texts: ["完成摘要", "链接"],
    });

    const result = await queue.deliver("thread:turn", async () => 0);

    expect(result.status).toBe("pending");
    expect(result.sentCount).toBe(0);
    expect(queue.snapshot().pending[0]?.nextTextIndex).toBe(0);
    expect(queue.hasDelivered("thread:turn")).toBe(false);
    expect(snapshots.at(-1)?.pending).toHaveLength(1);
  });

  test("resumes after a partial send without repeating delivered chunks", async () => {
    const queue = buildQueue();
    queue.enqueue({
      key: "thread:turn",
      threadId: "thread",
      texts: ["第一段", "第二段", "第三段"],
    });
    const attempts: string[][] = [];

    const first = await queue.deliver("thread:turn", async (_delivery, texts) => {
      attempts.push(texts);
      return 1;
    });
    const second = await queue.deliver("thread:turn", async (_delivery, texts) => {
      attempts.push(texts);
      return texts.length;
    });

    expect(first.status).toBe("pending");
    expect(second.status).toBe("delivered");
    expect(attempts).toEqual([
      ["第一段", "第二段", "第三段"],
      ["第二段", "第三段"],
    ]);
    expect(queue.snapshot().pending).toEqual([]);
    expect(queue.hasDelivered("thread:turn")).toBe(true);
  });

  test("prevents concurrent duplicate delivery while one attempt is in flight", async () => {
    const queue = buildQueue();
    queue.enqueue({
      key: "thread:turn",
      threadId: "thread",
      texts: ["完成"],
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.deliver("thread:turn", async (_delivery, texts) => {
      await waiting;
      return texts.length;
    });

    const duplicate = await queue.deliver("thread:turn", async () => 1);
    release();

    expect(duplicate.status).toBe("in_flight");
    expect((await first).status).toBe("delivered");
  });

  test("persists pending payloads and retries them after restart", async () => {
    const snapshots: CodexCompletionDeliveryState[] = [];
    const firstQueue = buildQueue(undefined, snapshots);
    firstQueue.enqueue({
      key: "thread:turn",
      threadId: "thread",
      texts: ["完整回答", "任务链接"],
    });
    await firstQueue.deliver("thread:turn", async () => 0);

    const restarted = buildQueue(snapshots.at(-1));
    const delivered = await restarted.deliver(
      "thread:turn",
      async (_delivery, texts) => texts.length,
    );

    expect(delivered.status).toBe("delivered");
    expect(restarted.snapshot().pending).toEqual([]);
    expect(restarted.hasDelivered("thread:turn")).toBe(true);
  });

  test("deduplicates a successfully delivered notification across restart", async () => {
    const snapshots: CodexCompletionDeliveryState[] = [];
    const queue = buildQueue(undefined, snapshots);
    queue.enqueue({
      key: "thread:turn",
      threadId: "thread",
      texts: ["完成"],
    });
    await queue.deliver("thread:turn", async (_delivery, texts) => texts.length);

    const restarted = buildQueue(snapshots.at(-1));
    const enqueue = restarted.enqueue({
      key: "thread:turn",
      threadId: "thread",
      texts: ["不应再次发送"],
    });
    let called = false;
    const result = await restarted.deliver("thread:turn", async () => {
      called = true;
      return 1;
    });

    expect(enqueue.status).toBe("delivered");
    expect(result.status).toBe("delivered");
    expect(called).toBe(false);
  });

  test("bounds delivered keys and expires retained payloads", async () => {
    let now = Date.parse("2026-08-08T12:00:00.000Z");
    let persisted: CodexCompletionDeliveryState | undefined;
    const queue = new CodexCompletionDeliveryQueue({
      now: () => now,
      persist: (state) => {
        persisted = structuredClone(state);
      },
    });
    for (let index = 0; index < 540; index += 1) {
      const key = `thread:turn-${index}`;
      queue.enqueue({ key, threadId: "thread", texts: [`完成 ${index}`] });
      await queue.deliver(key, async (_delivery, texts) => texts.length);
      now += 1;
    }
    expect(queue.snapshot().delivered.length).toBeLessThanOrEqual(512);

    queue.enqueue({
      key: "thread:pending-sensitive",
      threadId: "thread",
      texts: ["/Users/example/private-image.png"],
    });
    now += 31 * 24 * 60 * 60_000;

    expect(queue.getPending()).toEqual([]);
    expect(queue.snapshot().delivered).toEqual([]);
    expect(persisted?.pending).toEqual([]);
  });
});
