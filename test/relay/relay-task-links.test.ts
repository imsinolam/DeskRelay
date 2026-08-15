import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  createDeskRelayRelayTaskLinkAlias,
  DeskRelayRelayTaskLinkClient,
  DeskRelayRelayTaskLinkStore,
} from "../../src/relay/relay-task-links.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("relay task links", () => {
  test("creates stable ten-character aliases without cross-adapter collisions", () => {
    const threadId = "0000000a-0000-7000-8000-00000000000a";
    const codex = createDeskRelayRelayTaskLinkAlias("device-secret", "codex", threadId);
    const workbuddy = createDeskRelayRelayTaskLinkAlias(
      "device-secret",
      "workbuddy",
      threadId,
    );

    expect(codex).toHaveLength(10);
    expect(codex).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(workbuddy).not.toBe(codex);
    expect(createDeskRelayRelayTaskLinkAlias("device-secret", "codex", threadId)).toBe(codex);
  });

  test("persists aliases across relay restarts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-task-links-"));
    temporaryDirectories.push(directory);
    const stateFile = path.join(directory, "task-links.json");
    const target = {
      adapter: "codex",
      threadId: "0000000a-0000-7000-8000-00000000000a",
    };
    const alias = createDeskRelayRelayTaskLinkAlias(
      "device-secret",
      target.adapter,
      target.threadId,
    );

    const first = new DeskRelayRelayTaskLinkStore({
      deviceToken: "device-secret",
      stateFile,
    });
    first.register(alias, target);

    const restored = new DeskRelayRelayTaskLinkStore({
      deviceToken: "device-secret",
      stateFile,
    });
    expect(restored.resolve(alias)).toEqual(target);
    if (process.platform !== "win32") {
      expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    }
  });

  test("returns the short URL immediately and registers it in the background", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new DeskRelayRelayTaskLinkClient({
      relayUrl: "https://deskrelay.example",
      deviceId: "device-1",
      deviceToken: "device-secret",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    try {
      const url = client.buildTaskUrl(
        "0000000a-0000-7000-8000-00000000000a",
        "codex",
        new URLSearchParams(),
      );
      expect(url).toMatch(/^https:\/\/deskrelay\.example\/[A-Za-z0-9_-]{10}$/);
      expect(url.length).toBeLessThan(45);
      await Bun.sleep(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.init?.headers).toMatchObject({
        authorization: "Bearer device-secret",
        "x-deskrelay-device-id": "device-1",
      });
    } finally {
      await client.close();
    }
  });
});
