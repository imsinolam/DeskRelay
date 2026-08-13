import { describe, expect, test } from "bun:test";

import {
  ApprovalNotificationDeliveryQueue,
  type ApprovalNotificationDeliveryState,
} from "../../src/daemon/approval-notification-delivery.ts";

function buildQueue(
  initial?: ApprovalNotificationDeliveryState,
  snapshots: ApprovalNotificationDeliveryState[] = [],
) {
  return new ApprovalNotificationDeliveryQueue({
    initial,
    now: () => Date.parse("2026-08-13T03:00:00.000Z"),
    persist: (state) => snapshots.push(structuredClone(state)),
  });
}

describe("approval notification delivery queue", () => {
  test("retains a stale-token notification and retries after context refresh", async () => {
    const snapshots: ApprovalNotificationDeliveryState[] = [];
    const queue = buildQueue(undefined, snapshots);
    queue.enqueue({
      key: "codex:thread:turn:request",
      adapter: "codex",
      threadId: "thread",
      turnId: "turn",
      requestId: "request",
      text: "[任务 · US中转服务器]\n需要确认",
      commandPreview: "ssh example",
    });

    expect(await queue.deliver("codex:thread:turn:request", async () => false)).toMatchObject({
      status: "pending",
    });
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPending()[0]?.commandPreview).toBe("ssh example");

    const restarted = buildQueue(snapshots.at(-1));
    expect(await restarted.deliver("codex:thread:turn:request", async () => true)).toMatchObject({
      status: "delivered",
    });
    expect(restarted.getPending()).toEqual([]);
    expect(restarted.hasDelivered("codex:thread:turn:request")).toBe(true);
  });

  test("cancels a resolved approval so it is never sent later", async () => {
    const queue = buildQueue();
    queue.enqueue({
      key: "codex:thread:turn:request",
      adapter: "codex",
      threadId: "thread",
      text: "需要确认",
    });
    expect(queue.cancel("codex:thread:turn:request")).toBe(true);

    let called = false;
    expect(await queue.deliver("codex:thread:turn:request", async () => {
      called = true;
      return true;
    })).toMatchObject({ status: "missing" });
    expect(called).toBe(false);
  });

  test("deduplicates delivered approvals and bounds retained state", async () => {
    const queue = buildQueue();
    queue.enqueue({
      key: "codex:thread:turn:request",
      adapter: "codex",
      threadId: "thread",
      text: "需要确认",
    });
    await queue.deliver("codex:thread:turn:request", async () => true);

    expect(queue.enqueue({
      key: "codex:thread:turn:request",
      adapter: "codex",
      threadId: "thread",
      text: "不应再次发送",
    }).status).toBe("delivered");
  });
});
