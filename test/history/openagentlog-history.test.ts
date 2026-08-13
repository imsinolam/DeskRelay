import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OPENAGENTLOG_HISTORY_SOURCE_BY_ADAPTER,
  OpenAgentLogHistoryProvider,
} from "../../src/history/openagentlog-history.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createRuntimeFile(overrides: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-oal-"));
  tempDirs.push(dir);
  const runtimePath = path.join(dir, "integration-runtime.json");
  fs.writeFileSync(runtimePath, JSON.stringify({
    apiVersion: 1,
    productId: "openagentlog",
    port: 7823,
    token: "integration-secret",
    bootId: "boot-1",
    pid: process.pid,
    startedAt: Date.now(),
    ...overrides,
  }), { mode: 0o600 });
  fs.chmodSync(runtimePath, 0o600);
  return runtimePath;
}

function completePage(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 1,
    source: "codex",
    sessionId: "thread-1",
    contentFormat: "normalized_text",
    contentComplete: true,
    messages: [
      {
        messageId: 11,
        role: "user",
        content: "先检查性能",
        timestamp: 100,
        contentComplete: true,
      },
      {
        messageId: 12,
        role: "assistant",
        content: "已经定位到正文读取链路。",
        timestamp: 200,
        contentComplete: true,
        model: "gpt-5.6",
      },
    ],
    hasMore: true,
    nextBefore: "signed-cursor",
    freshness: {
      indexedAt: Date.now(),
      indexing: false,
      sourceState: {
        observedSize: 200,
        indexedSize: 200,
        indexedByteOffset: 200,
        indexedLine: 20,
        parserVersion: 3,
        caughtUp: true,
        lagBytes: 0,
      },
    },
    ...overrides,
  };
}

describe("OpenAgentLog history provider", () => {
  test("maps every interactive daemon adapter to an OpenAgentLog source", () => {
    expect(OPENAGENTLOG_HISTORY_SOURCE_BY_ADAPTER).toEqual({
      codex: "codex",
      claude: "claude",
      tclaude: "tclaude",
      grok: "grok",
      codebuddy: "codebuddy",
      reasonix: "reasonix",
      workbuddy: "workbuddy",
      opencode: "opencode",
    });
  });

  test("reads a secure local runtime descriptor and returns a prefixed cursor", async () => {
    const runtimeFilePath = createRuntimeFile();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAgentLogHistoryProvider({
      runtimeFilePath,
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify(completePage()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const page = await provider.readPage("codex", "thread-1", {
      historyOnly: true,
      limit: 40,
    });

    expect(page).toEqual({
      messages: [
        { id: "11", role: "user", text: "先检查性能", createdAtMs: 100 },
        {
          id: "12",
          role: "assistant",
          text: "已经定位到正文读取链路。",
          createdAtMs: 200,
          model: "gpt-5.6",
        },
      ],
      hasMore: true,
      nextBefore: "oal:signed-cursor",
      source: "openagentlog",
      caughtUp: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://127.0.0.1:7823/api/integrations/v1/sources/codex/sessions/thread-1/messages?limit=40",
    );
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer integration-secret",
    );
  });

  test("passes an opaque OpenAgentLog cursor back without exposing native cursors", async () => {
    const runtimeFilePath = createRuntimeFile();
    let requestedUrl = "";
    const provider = new OpenAgentLogHistoryProvider({
      runtimeFilePath,
      fetch: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(completePage({
          messages: [],
          hasMore: false,
          nextBefore: null,
        })), { status: 200 });
      },
    });

    const page = await provider.readPage("codex", "thread-1", {
      before: "oal:older-signed-cursor",
      limit: 25,
    });

    expect(page).toEqual({
      messages: [],
      hasMore: false,
      nextBefore: null,
      source: "openagentlog",
      caughtUp: true,
    });
    expect(requestedUrl).toContain("before=older-signed-cursor");
    expect(await provider.readPage("codex", "thread-1", {
      before: "byte:100",
      limit: 25,
    })).toBeNull();
  });

  test("falls back on the first page when the runtime file is insecure", async () => {
    const runtimeFilePath = createRuntimeFile();
    fs.chmodSync(runtimeFilePath, 0o644);
    let fetchCalls = 0;
    const provider = new OpenAgentLogHistoryProvider({
      runtimeFilePath,
      fetch: async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      },
    });

    expect(await provider.readPage("codex", "thread-1", {
      historyOnly: true,
      limit: 40,
    })).toBeNull();
    expect(fetchCalls).toBe(0);
  });

  test("falls back from incomplete pages but can preview stale indexed history", async () => {
    const runtimeFilePath = createRuntimeFile();
    const responses = [
      completePage({
        contentComplete: false,
        messages: [{
          messageId: 1,
          role: "assistant",
          content: "被截断",
          timestamp: 1,
          contentComplete: false,
        }],
      }),
      completePage({
        freshness: {
          indexedAt: Date.now(),
          indexing: true,
          sourceState: {
            observedSize: 300,
            indexedSize: 200,
            indexedByteOffset: 200,
            indexedLine: 20,
            parserVersion: 3,
            caughtUp: false,
            lagBytes: 100,
          },
        },
      }),
    ];
    const provider = new OpenAgentLogHistoryProvider({
      runtimeFilePath,
      fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
      failureCooldownMs: 0,
    });

    expect(await provider.readPage("codex", "thread-1", {
      historyOnly: true,
      limit: 40,
    })).toBeNull();
    const stalePage = await provider.readPage("codex", "thread-1", {
      historyOnly: true,
      limit: 40,
    });
    expect(stalePage).toMatchObject({
      source: "openagentlog",
      caughtUp: false,
      hasMore: true,
    });
  });

  test("returns null for an unavailable first page but keeps OAL pagination errors visible", async () => {
    const runtimeFilePath = createRuntimeFile();
    const provider = new OpenAgentLogHistoryProvider({
      runtimeFilePath,
      fetch: async () => {
        throw new Error("connection refused");
      },
      failureCooldownMs: 0,
    });

    expect(await provider.readPage("codex", "thread-1", {
      historyOnly: true,
      limit: 40,
    })).toBeNull();
    await expect(provider.readPage("codex", "thread-1", {
      before: "oal:older",
      limit: 40,
    })).rejects.toThrow("OpenAgentLog 历史加速暂时不可用");
  });
});
