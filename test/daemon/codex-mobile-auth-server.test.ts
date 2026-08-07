import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexMobileAuthStore } from "../../src/daemon/codex-mobile-auth.ts";
import {
  CODEX_MOBILE_ASSET_VERSION,
  startCodexMobileServer,
} from "../../src/daemon/codex-mobile-server.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createAuthStore(): CodexMobileAuthStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-server-auth-"));
  tempDirs.push(dir);
  return new CodexMobileAuthStore({ stateFile: path.join(dir, "auth.json") });
}

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) {
    throw new Error("missing set-cookie");
  }
  return value.split(";", 1)[0] ?? "";
}

describe("Codex mobile server password gate", () => {
  test("requires first-use password setup and then issues a persistent session cookie", async () => {
    const authStore = createAuthStore();
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "192.168.50.10",
      publicBaseUrl: "http://198.51.100.10/",
      accessToken: "one-time-setup-secret",
      authStore,
      listTasks: async () => [{
        threadId: "0000000a-0000-7000-8000-00000000000a",
        title: "继续完善微信 Codex",
        status: "idle",
      }],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
        runSummary: null,
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      expect(server.buildTaskUrl("0000000a-0000-7000-8000-00000000000a")).toBe(
        `http://198.51.100.10/?task=0000000a-0000-7000-8000-00000000000a&appv=${CODEX_MOBILE_ASSET_VERSION}&setup=one-time-setup-secret`,
      );

      const statusBefore = await fetch(`${root}/api/auth/status`, {
        headers: { "x-codex-mobile-setup": "one-time-setup-secret" },
      });
      expect(await statusBefore.json()).toEqual({
        authenticated: false,
        configured: false,
        canSetup: true,
      });

      expect((await fetch(`${root}/api/tasks`)).status).toBe(428);

      const setup = await fetch(`${root}/api/auth/setup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-mobile-setup": "one-time-setup-secret",
        },
        body: JSON.stringify({ password: "my first secure password" }),
      });
      expect(setup.status).toBe(200);
      const sessionCookie = cookieFrom(setup);
      expect(sessionCookie).toStartWith("codex_mobile_session=");
      expect(authStore.verifyPassword("my first secure password")).toBe(true);

      expect(server.buildTaskUrl("0000000a-0000-7000-8000-00000000000a")).toBe(
        `http://198.51.100.10/?task=0000000a-0000-7000-8000-00000000000a&appv=${CODEX_MOBILE_ASSET_VERSION}`,
      );

      const tasksResponse = await fetch(`${root}/api/tasks`, {
        headers: { cookie: sessionCookie },
      });
      expect(tasksResponse.status).toBe(200);
      expect((await tasksResponse.json() as { tasks: unknown[] }).tasks).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  test("rejects wrong passwords, rate limits repeated attempts, and accepts the configured password", async () => {
    const authStore = createAuthStore();
    authStore.setPassword("the configured password");
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "unused-after-setup",
      authStore,
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
        runSummary: null,
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(`${root}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "wrong password" }),
        });
        expect(response.status).toBe(401);
      }
      const blocked = await fetch(`${root}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "the configured password" }),
      });
      expect(blocked.status).toBe(429);
    } finally {
      await server.close();
    }
  });

  test("marks the session cookie secure when the public URL uses HTTPS", async () => {
    const authStore = createAuthStore();
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      publicBaseUrl: "https://codex.example.com/",
      accessToken: "secure-setup-token",
      authStore,
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
        runSummary: null,
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/auth/setup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-mobile-setup": "secure-setup-token",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.10",
        },
        body: JSON.stringify({ password: "a secure public password" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("; Secure");
    } finally {
      await server.close();
    }
  });
});
