import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CodexDeferredInputStore,
  type CodexDeferredInputEntry,
} from "../../src/daemon/codex-deferred-input-store.ts";

describe("CodexDeferredInputStore", () => {
  test("persists mobile and WeChat queues across daemon restarts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-deferred-inputs-"));
    const stateFile = path.join(directory, "queue.json");
    const cwd = path.join(directory, "workspace");
    const entries: CodexDeferredInputEntry[] = [
      {
        threadId: "thread_a",
        item: { source: "mobile", text: "收到请回复ok" },
      },
      {
        threadId: "thread_a",
        item: {
          source: "wechat",
          message: {
            senderId: "user_1",
            sender: "示例用户",
            sessionId: "wechat_session",
            text: "继续处理",
            attachments: [],
            contextToken: "context",
            createdAt: "2026-08-01T06:33:00.000Z",
            createdAtMs: 1_785_569_580_000,
          },
        },
      },
    ];

    try {
      const store = new CodexDeferredInputStore(cwd, { stateFile });
      store.replace(entries);

      expect(new CodexDeferredInputStore(cwd, { stateFile }).load()).toEqual(entries);
      if (process.platform !== "win32") {
        expect(fs.statSync(path.dirname(stateFile)).mode & 0o777).toBe(0o700);
        expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
      }
      store.clear();
      expect(fs.existsSync(stateFile)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("ignores corrupt or cross-workspace queue files", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-deferred-inputs-"));
    const stateFile = path.join(directory, "queue.json");

    try {
      fs.writeFileSync(stateFile, "not-json", "utf8");
      expect(new CodexDeferredInputStore("/workspace/a", { stateFile }).load()).toEqual([]);

      fs.writeFileSync(stateFile, JSON.stringify({
        version: 1,
        cwd: "/workspace/b",
        entries: [],
      }), "utf8");
      expect(new CodexDeferredInputStore("/workspace/a", { stateFile }).load()).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
