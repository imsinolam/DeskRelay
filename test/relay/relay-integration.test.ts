import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";

import {
  startDeskRelayRelayClient,
  type DeskRelayRelayClientHandle,
} from "../../src/relay/relay-client.ts";
import {
  DESKRELAY_RELAY_POLL_PATH,
} from "../../src/relay/relay-protocol.ts";
import {
  startDeskRelayRelayServer,
  type DeskRelayRelayServerHandle,
} from "../../src/relay/relay-server.ts";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) {
    await close();
  }
});

async function startLocalMobileStub() {
  const received: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      received.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
        body,
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": "codex_mobile_session=test-session; Path=/; HttpOnly; Secure",
      });
      response.end(JSON.stringify({
        ok: true,
        method: request.method,
        path: request.url,
        body: body ? JSON.parse(body) : null,
      }));
    })();
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing local address"));
        return;
      }
      resolve(address.port);
    });
  });
  closers.push(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  });
  return { port, received };
}

async function waitUntilOnline(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const payload = await fetch(`${baseUrl}/health`).then((response) => response.json()) as {
      deviceOnline?: boolean;
    };
    if (payload.deviceOnline) {
      return;
    }
    await Bun.sleep(20);
  }
  throw new Error("relay client did not connect");
}

describe("DeskRelay application relay", () => {
  test("serves the mobile shell and forwards only mobile API requests through the Mac client", async () => {
    const local = await startLocalMobileStub();
    const relay: DeskRelayRelayServerHandle = await startDeskRelayRelayServer({
      host: "127.0.0.1",
      port: 0,
      deviceId: "example-device",
      deviceToken: "test-device-token",
      pollTimeoutMs: 100,
      deviceOfflineMs: 500,
    });
    closers.push(() => relay.close());
    const client: DeskRelayRelayClientHandle = startDeskRelayRelayClient({
      relayUrl: relay.baseUrl,
      deviceId: "example-device",
      deviceToken: "test-device-token",
      localBaseUrl: `http://127.0.0.1:${local.port}`,
      retryDelayMs: 10,
    });
    closers.push(() => client.close());

    await waitUntilOnline(relay.baseUrl);

    const page = await fetch(`${relay.baseUrl}/?task=thread-1`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("DeskRelay");
    expect(local.received).toHaveLength(0);

    const tasks = await fetch(`${relay.baseUrl}/api/tasks?adapter=codex`, {
      headers: {
        cookie: "codex_mobile_session=browser-session",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.7",
      },
    });
    expect(tasks.status).toBe(200);
    expect(await tasks.json()).toMatchObject({
      ok: true,
      method: "GET",
      path: "/api/tasks?adapter=codex",
    });
    expect(tasks.headers.get("set-cookie")).toContain("test-session");
    expect(local.received[0]?.headers["x-real-ip"]).toBe("203.0.113.7");
    expect(local.received[0]?.headers["x-forwarded-proto"]).toBe("https");
    expect(local.received[0]?.headers.cookie).toBe(
      "codex_mobile_session=browser-session",
    );

    const send = await fetch(`${relay.baseUrl}/api/tasks/thread-1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "从手机继续当前任务", images: [] }),
    });
    expect(send.status).toBe(200);
    expect(await send.json()).toMatchObject({
      body: { text: "从手机继续当前任务", images: [] },
    });
    expect(local.received[1]?.body).toContain("从手机继续当前任务");
  });

  test("rejects unauthenticated device polls and reports an offline Mac in Chinese", async () => {
    const relay = await startDeskRelayRelayServer({
      host: "127.0.0.1",
      port: 0,
      deviceId: "example-device",
      deviceToken: "test-device-token",
      pollTimeoutMs: 50,
      deviceOfflineMs: 50,
    });
    closers.push(() => relay.close());

    const poll = await fetch(`${relay.baseUrl}${DESKRELAY_RELAY_POLL_PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "x-deskrelay-device-id": "example-device",
      },
    });
    expect(poll.status).toBe(401);

    const tasks = await fetch(`${relay.baseUrl}/api/tasks`);
    expect(tasks.status).toBe(503);
    expect(await tasks.json()).toEqual({
      error: "电脑当前离线，请确认 DeskRelay 正在运行。",
    });
  });
});
