import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  createWeRelayRelayTaskLinkAlias,
  WeRelayRelayTaskLinkClient,
  WeRelayRelayTaskLinkStore,
} from "../../src/relay/relay-task-links.ts";
import {
  decodeCodexMobileTaskShortCode,
} from "../../src/daemon/codex-mobile-server.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("relay task links", () => {
  test("creates stable ten-character aliases without cross-adapter collisions", () => {
    const threadId = "0000000a-0000-7000-8000-00000000000a";
    const codex = createWeRelayRelayTaskLinkAlias("device-secret", "codex", threadId);
    const workbuddy = createWeRelayRelayTaskLinkAlias(
      "device-secret",
      "workbuddy",
      threadId,
    );

    expect(codex).toHaveLength(10);
    expect(codex).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(workbuddy).not.toBe(codex);
    expect(createWeRelayRelayTaskLinkAlias("device-secret", "codex", threadId)).toBe(codex);
  });

  test("persists aliases across relay restarts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "werelay-task-links-"));
    temporaryDirectories.push(directory);
    const stateFile = path.join(directory, "task-links.json");
    const target = {
      adapter: "codex",
      threadId: "0000000a-0000-7000-8000-00000000000a",
    };
    const alias = createWeRelayRelayTaskLinkAlias(
      "device-secret",
      target.adapter,
      target.threadId,
    );

    const first = new WeRelayRelayTaskLinkStore({
      deviceToken: "device-secret",
      stateFile,
    });
    first.register(alias, target);

    const restored = new WeRelayRelayTaskLinkStore({
      deviceToken: "device-secret",
      stateFile,
    });
    expect(restored.resolve(alias)).toEqual(target);
    if (process.platform !== "win32") {
      expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    }
  });

  test("uses a self-contained task URL until the Relay confirms the shorter alias", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let finishRegistration: ((response: Response) => void) | undefined;
    const client = new WeRelayRelayTaskLinkClient({
      relayUrl: "https://werelay.example",
      deviceId: "device-1",
      deviceToken: "device-secret",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return await new Promise<Response>((resolve) => {
          finishRegistration = resolve;
        });
      },
    });
    try {
      const firstUrl = new URL(client.buildTaskUrl(
        "0000000a-0000-7000-8000-00000000000a",
        "codex",
        new URLSearchParams(),
      ));
      expect(firstUrl.pathname).toMatch(/^\/t\/[A-Za-z0-9_.~-]+$/);
      expect(decodeCodexMobileTaskShortCode(firstUrl.pathname.slice(3))).toEqual({
        adapter: "codex",
        threadId: "0000000a-0000-7000-8000-00000000000a",
      });
      await Bun.sleep(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.init?.headers).toMatchObject({
        authorization: "Bearer device-secret",
        "x-werelay-device-id": "device-1",
      });
      finishRegistration?.(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await Bun.sleep(0);
      const confirmedUrl = client.buildTaskUrl(
        "0000000a-0000-7000-8000-00000000000a",
        "codex",
        new URLSearchParams(),
      );
      expect(confirmedUrl).toMatch(/^https:\/\/werelay\.example\/[A-Za-z0-9_-]{10}$/);
      expect(confirmedUrl.length).toBeLessThan(45);
    } finally {
      await client.close();
    }
  });

  test("never emits an unregistered alias while Relay registration is failing", async () => {
    const client = new WeRelayRelayTaskLinkClient({
      relayUrl: "https://werelay.example",
      deviceId: "device-1",
      deviceToken: "device-secret",
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });
    try {
      const url = new URL(client.buildTaskUrl(
        "0000000a-0000-7000-8000-00000000000a",
        "codex",
        new URLSearchParams("setup=token"),
      ));
      expect(url.pathname).toMatch(/^\/t\//);
      expect(url.searchParams.get("setup")).toBe("token");
    } finally {
      await client.close();
    }
  });
});
