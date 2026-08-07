import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  DaemonWorkspaceStateStore,
  readDaemonWorkspaceState,
} from "../../src/daemon/daemon-state.ts";

describe("daemon workspace state", () => {
  test("persists the active adapter and selected Codex thread", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-daemon-state-"));
    const stateFile = path.join(directory, "daemon-state.json");
    const cwd = path.join(directory, "workspace");

    try {
      const store = new DaemonWorkspaceStateStore(cwd, { stateFile });
      expect(store.hadPersistedState).toBe(false);

      store.setActiveAdapter("codex");
      store.setCodexThreadId(" 0000000a-0000-7000-8000-00000000000a ");
      store.setAdapterSessionId("grok", " grok-session ");
      store.setCodexWechatReplyMode("full");
      store.setCodexWechatThreadId(" wechat-thread ");
      store.setRestartNoticeSentAt("2026-08-05T02:04:00.000+08:00");
      expect(store.ensureMobileAccessToken(() => "mobile-secret")).toBe(
        "mobile-secret",
      );

      expect(readDaemonWorkspaceState(cwd, { stateFile })).toMatchObject({
        version: 1,
        cwd: path.resolve(cwd),
        activeAdapter: "codex",
        codexThreadId: "0000000a-0000-7000-8000-00000000000a",
        adapterSessionIds: {
          codex: "0000000a-0000-7000-8000-00000000000a",
          grok: "grok-session",
        },
        mobileAccessToken: "mobile-secret",
        codexWechatReplyMode: "full",
        codexWechatThreadId: "wechat-thread",
        restartNoticeSentAt: "2026-08-05T02:04:00.000+08:00",
      });

      const restoredStore = new DaemonWorkspaceStateStore(cwd, { stateFile });
      expect(restoredStore.hadPersistedState).toBe(true);
      expect(restoredStore.getState().codexThreadId).toBe(
        "0000000a-0000-7000-8000-00000000000a",
      );
      expect(restoredStore.getAdapterSessionId("grok")).toBe("grok-session");
      expect(restoredStore.ensureMobileAccessToken(() => "other-secret")).toBe(
        "mobile-secret",
      );
      expect(restoredStore.getState().codexWechatReplyMode).toBe("full");
      expect(restoredStore.getCodexWechatThreadId()).toBe("wechat-thread");
      expect(restoredStore.getState().restartNoticeSentAt).toBe(
        "2026-08-05T02:04:00.000+08:00",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("ignores malformed or cross-workspace state", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-daemon-state-"));
    const stateFile = path.join(directory, "daemon-state.json");
    const cwd = path.join(directory, "workspace");

    try {
      fs.writeFileSync(stateFile, "not-json", "utf8");
      expect(readDaemonWorkspaceState(cwd, { stateFile })).toBeNull();

      fs.writeFileSync(
        stateFile,
        JSON.stringify({
          version: 1,
          cwd: path.join(directory, "other-workspace"),
          activeAdapter: "codex",
          codexThreadId: "thread_other",
          updatedAt: "2026-07-31T00:00:00.000Z",
        }),
        "utf8",
      );
      expect(readDaemonWorkspaceState(cwd, { stateFile })).toBeNull();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
