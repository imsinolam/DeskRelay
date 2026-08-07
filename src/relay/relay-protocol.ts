import crypto from "node:crypto";

export const DESKRELAY_RELAY_PROTOCOL_VERSION = 1;
export const DESKRELAY_RELAY_POLL_PATH = "/__deskrelay/device/poll";
export const DESKRELAY_RELAY_RESPONSE_PATH = "/__deskrelay/device/respond";
export const DESKRELAY_RELAY_CLIENT_IP_PATH = "/__deskrelay/client-ip";

export const DESKRELAY_RELAY_REQUEST_BODY_LIMIT = 36 * 1024 * 1024;
export const DESKRELAY_RELAY_RESPONSE_BODY_LIMIT = 36 * 1024 * 1024;

export type DeskRelayRelayHeaderMap = Record<string, string | string[]>;

export type DeskRelayRelayCommand = {
  protocolVersion: 1;
  id: string;
  deviceId: string;
  createdAtMs: number;
  expiresAtMs: number;
  request: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    headers: Record<string, string>;
    bodyBase64?: string;
    clientAddress: string;
    forwardedProto: "http" | "https";
  };
};

export type DeskRelayRelayCommandResponse = {
  protocolVersion: 1;
  commandId: string;
  statusCode: number;
  headers: DeskRelayRelayHeaderMap;
  bodyBase64?: string;
};

export function isDeskRelayRelayApiRequest(
  method: string,
  path: string,
): method is DeskRelayRelayCommand["request"]["method"] {
  return (
    method === "GET" ||
    method === "POST" ||
    method === "PATCH" ||
    method === "DELETE"
  ) && path.startsWith("/api/");
}

export function normalizeDeskRelayRelayBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("DeskRelay Relay 地址无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DeskRelay Relay 地址只支持 HTTP 或 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DeskRelay Relay 地址不能包含账号、查询参数或片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

export function deskRelayRelayBearerToken(requestHeaders: {
  authorization?: string | string[];
}): string {
  const authorization = Array.isArray(requestHeaders.authorization)
    ? requestHeaders.authorization[0]
    : requestHeaders.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function timingSafeRelayTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createDeskRelayRelayCommandId(): string {
  return `relay-${crypto.randomUUID()}`;
}
