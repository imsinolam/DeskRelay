import { describe, expect, test } from "bun:test";

import {
  mergeSessionRuntimeSignals,
} from "../../src/daemon/global-task-catalog.ts";

describe("global task catalog runtime signals", () => {
  test("merges live slot approval signals into a freshly discovered Harness catalog", () => {
    const candidates = mergeSessionRuntimeSignals([
      {
        sessionId: "desktop-session",
        threadId: "desktop-session",
        title: "US中转服务器",
        lastUpdatedAt: "2026-08-19T02:00:00.000Z",
      },
      {
        sessionId: "other-session",
        threadId: "other-session",
        title: "其他任务",
        lastUpdatedAt: "2026-08-19T01:00:00.000Z",
      },
    ], {
      pendingApprovalIds: ["desktop-session"],
    });

    expect(candidates[0]?.runtimeStatus).toEqual({
      type: "active",
      activeFlags: ["waitingOnApproval"],
    });
    expect(candidates[1]?.runtimeStatus).toEqual({ type: "idle" });
  });
});
