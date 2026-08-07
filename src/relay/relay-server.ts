import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIP } from "node:net";

import {
  CODEX_MOBILE_ASSET_VERSION,
} from "../daemon/codex-mobile-server.ts";
import {
  CODEX_MOBILE_CSS,
  CODEX_MOBILE_HTML,
  CODEX_MOBILE_JS,
  DESK_RELAY_ABOUT_HTML,
} from "../daemon/codex-mobile-web.ts";
import {
  createDeskRelayRelayCommandId,
  DESKRELAY_RELAY_CLIENT_IP_PATH,
  DESKRELAY_RELAY_POLL_PATH,
  DESKRELAY_RELAY_PROTOCOL_VERSION,
  DESKRELAY_RELAY_REQUEST_BODY_LIMIT,
  DESKRELAY_RELAY_RESPONSE_BODY_LIMIT,
  DESKRELAY_RELAY_RESPONSE_PATH,
  deskRelayRelayBearerToken,
  isDeskRelayRelayApiRequest,
  timingSafeRelayTokenEqual,
  type DeskRelayRelayCommand,
  type DeskRelayRelayCommandResponse,
  type DeskRelayRelayHeaderMap,
} from "./relay-protocol.ts";

const ASSET_VERSION_PLACEHOLDER = "__DESK_RELAY_ASSET_VERSION__";
const MOBILE_HTML = CODEX_MOBILE_HTML.replaceAll(
  ASSET_VERSION_PLACEHOLDER,
  CODEX_MOBILE_ASSET_VERSION,
);
const ABOUT_HTML = DESK_RELAY_ABOUT_HTML.replaceAll(
  ASSET_VERSION_PLACEHOLDER,
  CODEX_MOBILE_ASSET_VERSION,
);
const MOBILE_JS = CODEX_MOBILE_JS.replaceAll(
  ASSET_VERSION_PLACEHOLDER,
  CODEX_MOBILE_ASSET_VERSION,
);

const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 90_000;
const DEFAULT_COMMAND_LEASE_MS = 35_000;
const DEFAULT_DEVICE_OFFLINE_MS = 45_000;
const MAX_PENDING_COMMANDS = 64;

export type StartDeskRelayRelayServerOptions = {
  host?: string;
  port?: number;
  deviceId: string;
  deviceToken: string;
  pollTimeoutMs?: number;
  commandTimeoutMs?: number;
  commandLeaseMs?: number;
  deviceOfflineMs?: number;
  now?: () => number;
  logger?: (message: string) => void;
};

export type DeskRelayRelayServerHandle = {
  host: string;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
};

type PendingCommand = {
  command: DeskRelayRelayCommand;
  leaseExpiresAtMs: number;
  resolve: (response: DeskRelayRelayCommandResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type WaitingPoll = {
  request: IncomingMessage;
  response: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
};

class RelayHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeIpAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const withoutZone = unwrapped.split("%", 1)[0] ?? unwrapped;
  const ipv4Mapped = withoutZone.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const candidate = ipv4Mapped ?? withoutZone;
  return isIP(candidate) ? candidate : null;
}

function isLoopback(value: string | undefined): boolean {
  const normalized = normalizeIpAddress(value);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isTrustedReverseProxyRequest(request: IncomingMessage): boolean {
  return isLoopback(request.socket.remoteAddress) &&
    typeof request.headers["x-real-ip"] === "string";
}

function requestClientAddress(request: IncomingMessage): string {
  if (isTrustedReverseProxyRequest(request)) {
    return normalizeIpAddress(request.headers["x-real-ip"] as string) ?? "unknown";
  }
  return normalizeIpAddress(request.socket.remoteAddress) ?? "unknown";
}

function requestForwardedProto(request: IncomingMessage): "http" | "https" {
  if ((request.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted) {
    return "https";
  }
  if (isTrustedReverseProxyRequest(request)) {
    const value = request.headers["x-forwarded-proto"];
    if (typeof value === "string" && value.split(",", 1)[0]?.trim() === "https") {
      return "https";
    }
  }
  return "http";
}

function requestDeviceId(request: IncomingMessage): string {
  const value = request.headers["x-deskrelay-device-id"];
  return typeof value === "string" ? value.trim() : "";
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
  headers: DeskRelayRelayHeaderMap = {},
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data: http: https:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  response.end(body);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: DeskRelayRelayHeaderMap = {},
): void {
  sendText(
    response,
    statusCode,
    "application/json; charset=utf-8",
    JSON.stringify(value),
    headers,
  );
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new RelayHttpError(413, "消息或附件过大。");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(
  request: IncomingMessage,
  maxBytes: number,
): Promise<T> {
  const body = await readBody(request, maxBytes);
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new RelayHttpError(400, "请求格式不正确。");
  }
}

function forwardedRequestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "cookie", "x-codex-mobile-setup"]) {
    const value = request.headers[name];
    if (typeof value === "string") {
      headers[name] = value;
    }
  }
  return headers;
}

function isRelayCommandResponse(value: unknown): value is DeskRelayRelayCommandResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.protocolVersion === DESKRELAY_RELAY_PROTOCOL_VERSION &&
    typeof record.commandId === "string" &&
    typeof record.statusCode === "number" &&
    Boolean(record.headers) &&
    typeof record.headers === "object" &&
    !Array.isArray(record.headers) &&
    (record.bodyBase64 === undefined || typeof record.bodyBase64 === "string");
}

function validateDeviceRequest(
  request: IncomingMessage,
  deviceId: string,
  deviceToken: string,
): void {
  if (
    requestDeviceId(request) !== deviceId ||
    !timingSafeRelayTokenEqual(
      deskRelayRelayBearerToken(request.headers),
      deviceToken,
    )
  ) {
    throw new RelayHttpError(401, "设备认证失败。");
  }
}

function writeForwardedResponse(
  response: ServerResponse,
  commandResponse: DeskRelayRelayCommandResponse,
): void {
  let body: Buffer;
  try {
    body = commandResponse.bodyBase64
      ? Buffer.from(commandResponse.bodyBase64, "base64")
      : Buffer.alloc(0);
  } catch {
    sendJson(response, 502, { error: "电脑返回的数据格式不正确。" });
    return;
  }
  if (body.length > DESKRELAY_RELAY_RESPONSE_BODY_LIMIT) {
    sendJson(response, 502, { error: "电脑返回的内容过大。" });
    return;
  }
  response.writeHead(commandResponse.statusCode, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...commandResponse.headers,
  });
  response.end(body);
}

export async function startDeskRelayRelayServer(
  options: StartDeskRelayRelayServerOptions,
): Promise<DeskRelayRelayServerHandle> {
  const host = options.host?.trim() || "127.0.0.1";
  const requestedPort = options.port ?? 14396;
  const deviceId = options.deviceId.trim();
  const deviceToken = options.deviceToken.trim();
  if (!deviceId || !deviceToken) {
    throw new Error("DeskRelay Relay 缺少设备 ID 或设备密钥。");
  }

  const now = options.now ?? (() => Date.now());
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const commandLeaseMs = options.commandLeaseMs ?? DEFAULT_COMMAND_LEASE_MS;
  const deviceOfflineMs = options.deviceOfflineMs ?? DEFAULT_DEVICE_OFFLINE_MS;
  const logger = options.logger ?? (() => undefined);
  const pendingCommands = new Map<string, PendingCommand>();
  const commandOrder: string[] = [];
  let waitingPoll: WaitingPoll | null = null;
  let lastDeviceSeenAtMs = 0;

  const cleanCommandOrder = () => {
    while (commandOrder.length > 0 && !pendingCommands.has(commandOrder[0] ?? "")) {
      commandOrder.shift();
    }
  };

  const nextCommand = (): PendingCommand | null => {
    cleanCommandOrder();
    const currentMs = now();
    for (const commandId of commandOrder) {
      const pending = pendingCommands.get(commandId);
      if (!pending) {
        continue;
      }
      if (pending.command.expiresAtMs <= currentMs) {
        clearTimeout(pending.timer);
        pendingCommands.delete(commandId);
        pending.reject(new Error("电脑响应超时，请稍后重试。"));
        continue;
      }
      if (pending.leaseExpiresAtMs <= currentMs) {
        return pending;
      }
    }
    cleanCommandOrder();
    return null;
  };

  const deliverCommand = (response: ServerResponse): boolean => {
    const pending = nextCommand();
    if (!pending) {
      return false;
    }
    pending.leaseExpiresAtMs = now() + commandLeaseMs;
    sendJson(response, 200, pending.command);
    return true;
  };

  const dispatchWaitingPoll = () => {
    if (!waitingPoll) {
      return;
    }
    const activePoll = waitingPoll;
    if (!deliverCommand(activePoll.response)) {
      return;
    }
    waitingPoll = null;
    clearTimeout(activePoll.timer);
  };

  const enqueueBrowserRequest = async (
    request: IncomingMessage,
    url: URL,
  ): Promise<DeskRelayRelayCommandResponse> => {
    if (pendingCommands.size >= MAX_PENDING_COMMANDS) {
      throw new RelayHttpError(503, "待处理请求过多，请稍后重试。");
    }
    if (!lastDeviceSeenAtMs || now() - lastDeviceSeenAtMs > deviceOfflineMs) {
      throw new RelayHttpError(503, "电脑当前离线，请确认 DeskRelay 正在运行。");
    }
    const method = request.method ?? "GET";
    if (!isDeskRelayRelayApiRequest(method, url.pathname)) {
      throw new RelayHttpError(404, "页面不存在。");
    }
    const body = await readBody(request, DESKRELAY_RELAY_REQUEST_BODY_LIMIT);
    const commandId = createDeskRelayRelayCommandId();
    const createdAtMs = now();
    const command: DeskRelayRelayCommand = {
      protocolVersion: DESKRELAY_RELAY_PROTOCOL_VERSION,
      id: commandId,
      deviceId,
      createdAtMs,
      expiresAtMs: createdAtMs + commandTimeoutMs,
      request: {
        method,
        path: `${url.pathname}${url.search}`,
        headers: forwardedRequestHeaders(request),
        ...(body.length > 0 ? { bodyBase64: body.toString("base64") } : {}),
        clientAddress: requestClientAddress(request),
        forwardedProto: requestForwardedProto(request),
      },
    };

    const responsePromise = new Promise<DeskRelayRelayCommandResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = pendingCommands.get(commandId);
        if (!pending) {
          return;
        }
        pendingCommands.delete(commandId);
        pending.reject(new Error("电脑响应超时，请稍后重试。"));
      }, commandTimeoutMs);
      pendingCommands.set(commandId, {
        command,
        leaseExpiresAtMs: 0,
        resolve,
        reject,
        timer,
      });
      commandOrder.push(commandId);
    });
    dispatchWaitingPoll();
    return await responsePromise;
  };

  const activeSockets = new Set<import("node:net").Socket>();
  const server: Server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://deskrelay-relay.local");
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/") {
        sendText(response, 200, "text/html; charset=utf-8", MOBILE_HTML);
        return;
      }
      if (method === "GET" && url.pathname === "/about") {
        sendText(response, 200, "text/html; charset=utf-8", ABOUT_HTML);
        return;
      }
      if (method === "GET" && url.pathname === "/app.css") {
        sendText(response, 200, "text/css; charset=utf-8", CODEX_MOBILE_CSS);
        return;
      }
      if (method === "GET" && url.pathname === "/app.js") {
        sendText(response, 200, "text/javascript; charset=utf-8", MOBILE_JS);
        return;
      }
      if (method === "GET" && url.pathname === "/app-version") {
        sendJson(response, 200, { version: CODEX_MOBILE_ASSET_VERSION });
        return;
      }
      if (method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (method === "GET" && url.pathname === DESKRELAY_RELAY_CLIENT_IP_PATH) {
        sendText(response, 200, "text/plain; charset=utf-8", requestClientAddress(request));
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          deviceOnline: Boolean(
            lastDeviceSeenAtMs && now() - lastDeviceSeenAtMs <= deviceOfflineMs,
          ),
        });
        return;
      }

      if (method === "POST" && url.pathname === DESKRELAY_RELAY_POLL_PATH) {
        validateDeviceRequest(request, deviceId, deviceToken);
        await readBody(request, 4_096);
        lastDeviceSeenAtMs = now();
        if (deliverCommand(response)) {
          return;
        }
        if (waitingPoll) {
          clearTimeout(waitingPoll.timer);
          if (!waitingPoll.response.headersSent) {
            sendJson(waitingPoll.response, 409, { error: "设备已建立新的连接。" });
          }
          waitingPoll = null;
        }
        const timer = setTimeout(() => {
          if (waitingPoll?.response === response) {
            waitingPoll = null;
          }
          if (!response.headersSent) {
            response.writeHead(204, { "cache-control": "no-store" });
            response.end();
          }
        }, pollTimeoutMs);
        waitingPoll = { request, response, timer };
        response.once("close", () => {
          if (response.writableEnded || waitingPoll?.request !== request) {
            return;
          }
          clearTimeout(waitingPoll.timer);
          waitingPoll = null;
        });
        return;
      }

      if (method === "POST" && url.pathname === DESKRELAY_RELAY_RESPONSE_PATH) {
        validateDeviceRequest(request, deviceId, deviceToken);
        lastDeviceSeenAtMs = now();
        const commandResponse = await readJson<DeskRelayRelayCommandResponse>(
          request,
          DESKRELAY_RELAY_RESPONSE_BODY_LIMIT * 2,
        );
        if (!isRelayCommandResponse(commandResponse)) {
          throw new RelayHttpError(400, "设备响应格式不正确。");
        }
        const pending = pendingCommands.get(commandResponse.commandId);
        if (!pending) {
          sendJson(response, 200, { ok: true, ignored: true });
          return;
        }
        clearTimeout(pending.timer);
        pendingCommands.delete(commandResponse.commandId);
        pending.resolve(commandResponse);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (isDeskRelayRelayApiRequest(method, url.pathname)) {
        try {
          writeForwardedResponse(
            response,
            await enqueueBrowserRequest(request, url),
          );
        } catch (error) {
          if (error instanceof RelayHttpError) {
            throw error;
          }
          throw new RelayHttpError(
            504,
            error instanceof Error ? error.message : "电脑响应超时，请稍后重试。",
          );
        }
        return;
      }

      throw new RelayHttpError(404, "页面不存在。");
    })().catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      const statusCode = error instanceof RelayHttpError ? error.statusCode : 500;
      const message = error instanceof RelayHttpError
        ? error.message
        : "DeskRelay Relay 暂时不可用。";
      logger(`${methodForLog(request)} 请求失败：${message}`);
      sendJson(response, statusCode, { error: message });
    });
  });

  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("DeskRelay Relay 无法取得监听端口。"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    close: async () => {
      if (waitingPoll) {
        clearTimeout(waitingPoll.timer);
        if (!waitingPoll.response.headersSent) {
          waitingPoll.response.writeHead(204, { "cache-control": "no-store" });
          waitingPoll.response.end();
        }
        waitingPoll = null;
      }
      for (const pending of pendingCommands.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("DeskRelay Relay 已停止。"));
      }
      pendingCommands.clear();
      for (const socket of activeSockets) {
        socket.destroy();
      }
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(fallbackTimer);
          resolve();
        };
        const fallbackTimer = setTimeout(finish, 500);
        server.close(finish);
      });
    },
  };
}

function methodForLog(request: IncomingMessage): string {
  return request.method ?? "GET";
}
