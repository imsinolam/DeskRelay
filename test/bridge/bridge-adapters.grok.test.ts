import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createBridgeAdapter } from "../../src/bridge/bridge-adapters.ts";
import {
  GrokAcpAdapter,
  parseGrokChatHistory,
  buildGrokAcpArgs,
  buildGrokNativeArgs,
  resolveGrokLeaderSocket,
} from "../../src/bridge/bridge-adapters.grok.ts";
import { LocalCompanionProxyAdapter } from "../../src/bridge/bridge-adapters.core.ts";

const cwd = path.resolve("/tmp/deskrelay-grok-project");

describe("Grok shared owner adapter", () => {
  test("uses the local companion proxy on the bridge side", () => {
    const adapter = createBridgeAdapter({
      kind: "grok",
      command: "grok",
      cwd,
    });

    expect(adapter).toBeInstanceOf(LocalCompanionProxyAdapter);
  });

  test("runs the real Grok adapter inside the visible companion", () => {
    const adapter = createBridgeAdapter({
      kind: "grok",
      command: "grok",
      cwd,
      renderMode: "companion",
    });

    expect(adapter).toBeInstanceOf(GrokAcpAdapter);
  });

  test("connects ACP and the visible TUI to the same leader socket", () => {
    const socket = "/tmp/deskrelay-grok-test.sock";
    const options = {
      kind: "grok" as const,
      command: "grok",
      cwd,
      profile: "/tmp/profile.toml",
      extraCliArgs: ["--always-approve"],
    };

    expect(buildGrokAcpArgs(options, socket)).toEqual([
      "agent",
      "--leader",
      "--leader-socket",
      socket,
      "--agent-profile",
      "/tmp/profile.toml",
      "stdio",
    ]);
    expect(buildGrokNativeArgs(options, socket, "session-123")).toEqual([
      "--leader-socket",
      socket,
      "--resume",
      "session-123",
      "--always-approve",
    ]);
  });

  test("uses a short deterministic per-workspace socket", () => {
    const first = resolveGrokLeaderSocket(cwd, { platform: "darwin", uid: 501 });
    const second = resolveGrokLeaderSocket(cwd, { platform: "darwin", uid: 501 });
    const other = resolveGrokLeaderSocket(`${cwd}-other`, { platform: "darwin", uid: 501 });

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toStartWith("/tmp/deskrelay-grok-501-");
    expect(first.length).toBeLessThan(100);
  });
  test("does not unlink a leader socket owned by another visible Grok client", () => {
    if (process.platform === "win32") return;
    const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-grok-owner-"));
    const socketPath = resolveGrokLeaderSocket(tempCwd);
    fs.writeFileSync(socketPath, "external-owner", "utf8");
    const adapter = new GrokAcpAdapter({
      kind: "grok",
      command: "grok",
      cwd: tempCwd,
      renderMode: "companion",
    });
    const internal = adapter as unknown as { stopOwnedLeader(): void };
    try {
      internal.stopOwnedLeader();
      expect(fs.existsSync(socketPath)).toBe(true);
    } finally {
      fs.rmSync(socketPath, { force: true });
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  test("attaches generated image tool results to the preceding assistant message without duplicating image reads", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-grok-image-"));
    const imagePath = path.join(tempDir, "images", "3.jpg");
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    try {
      const messages = parseGrokChatHistory([
        JSON.stringify({ type: "assistant", content: "图片已经生成。", model_id: "grok-4" }),
        JSON.stringify({
          type: "tool_result",
          content: JSON.stringify({
            path: imagePath,
            filename: "3.jpg",
            session_folder: "images",
            message: "Image edited and saved",
          }),
        }),
        JSON.stringify({ type: "assistant", content: "" }),
        JSON.stringify({ type: "tool_result", content: `Read image file: ${imagePath}` }),
      ].join("\n"));

      expect(messages).toEqual([{
        role: "assistant",
        text: "图片已经生成。",
        phase: "final_answer",
        model: "grok-4",
        images: [{ source: "local", path: imagePath, alt: "3.jpg" }],
      }]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("uses stored Grok history while the visible companion is still starting", async () => {
    const expected = [{
      role: "assistant" as const,
      text: "图片已生成",
      images: [{ source: "local" as const, path: "/tmp/generated.png" }],
    }];
    const adapter = new LocalCompanionProxyAdapter({
      kind: "grok",
      command: "grok",
      cwd,
    }, {
      readSessionMessages: async (_cwd, sessionId) =>
        sessionId === "stored-session" ? expected : [],
    });

    expect(await adapter.getSessionMessages("stored-session")).toEqual(expected);
    expect(await adapter.getSessionMessageMedia("stored-session")).toEqual(expected);
    expect(await adapter.getLatestSessionMessage("stored-session")).toEqual(expected[0]);
  });

});
