import { describe, expect, test } from "bun:test";

import type { BridgeAdapter } from "../../src/bridge/bridge-types.ts";
import { LegacyAdapterRuntime } from "../../src/runtime/legacy-adapter-runtime.ts";

function buildAdapter(overrides: Partial<BridgeAdapter> = {}): BridgeAdapter {
  return {
    setEventSink() {},
    async start() {},
    async sendInput() {},
    async listResumeSessions() { return []; },
    async resumeSession() {},
    async interrupt() { return false; },
    async reset() {},
    async resolveApproval() { return false; },
    async resolveAllApprovals() { return 0; },
    async submitUserInput() { return false; },
    async dispose() {},
    getState() {
      return {
        kind: "grok",
        command: "grok",
        status: "idle",
        startedAt: new Date(0).toISOString(),
      };
    },
    ...overrides,
  };
}

describe("LegacyAdapterRuntime optional capabilities", () => {
  test("preserves missing optional adapter methods", () => {
    const runtime = new LegacyAdapterRuntime(buildAdapter());

    expect(runtime.getSessionMessages).toBeUndefined();
    expect(runtime.getSessionMessageMedia).toBeUndefined();
    expect(runtime.sendInputToSession).toBeUndefined();
    expect(runtime.getQueuedTaskInputs).toBeUndefined();
  });

  test("forwards optional session and queue methods to the wrapped adapter", async () => {
    const adapter = buildAdapter({
      async getSessionMessages(sessionId) {
        return [{ role: "assistant", text: `reply:${sessionId}` }];
      },
      async getSessionMessageMedia(sessionId, options, targetMessages) {
        expect(options).toEqual({ limit: 12, historyOnly: true });
        expect(targetMessages).toEqual([{ role: "user", text: "prompt" }]);
        return [{
          role: "assistant",
          text: `reply:${sessionId}`,
          images: [{ source: "local", path: "/tmp/generated.jpg" }],
        }];
      },
      async sendInputToSession(sessionId, text) {
        return { sessionId, turnId: text };
      },
      getQueuedTaskInputs(sessionId) {
        return [{ id: "queued-1", text: sessionId, imageCount: 0 }];
      },
    });
    const runtime = new LegacyAdapterRuntime(adapter);

    expect(await runtime.getSessionMessages?.("session-1")).toEqual([
      { role: "assistant", text: "reply:session-1" },
    ]);
    expect(await runtime.getSessionMessageMedia?.(
      "session-1",
      { limit: 12, historyOnly: true },
      [{ role: "user", text: "prompt" }],
    )).toEqual([{
      role: "assistant",
      text: "reply:session-1",
      images: [{ source: "local", path: "/tmp/generated.jpg" }],
    }]);
    expect(await runtime.sendInputToSession?.("session-1", "turn-1")).toEqual({
      sessionId: "session-1",
      turnId: "turn-1",
    });
    expect(runtime.getQueuedTaskInputs?.("session-1")).toEqual([
      { id: "queued-1", text: "session-1", imageCount: 0 },
    ]);
  });
});
