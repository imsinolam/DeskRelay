import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DaemonAdapterKind } from "../bridge/bridge-providers.ts";
import type {
  BridgeSessionMessage,
  BridgeSessionMessagePage,
  BridgeSessionMessagePageOptions,
} from "../bridge/bridge-types.ts";

const OPENAGENTLOG_CURSOR_PREFIX = "oal:";
const DEFAULT_REQUEST_TIMEOUT_MS = 750;
const DEFAULT_FAILURE_COOLDOWN_MS = 5_000;
const MAX_RUNTIME_FILE_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const OPENAGENTLOG_HISTORY_SOURCE_BY_ADAPTER: Record<
  DaemonAdapterKind,
  string
> = {
  codex: "codex",
  claude: "claude",
  tclaude: "tclaude",
  grok: "grok",
  codebuddy: "codebuddy",
  reasonix: "reasonix",
  workbuddy: "workbuddy",
  opencode: "opencode",
};

type OpenAgentLogRuntimeDescriptor = {
  apiVersion: 1;
  productId: "openagentlog";
  port: number;
  token: string;
  bootId: string;
  pid: number;
  startedAt: number;
};

type OpenAgentLogHistoryResponse = {
  apiVersion: 1;
  source: string;
  sessionId: string;
  contentFormat: "normalized_text";
  contentComplete: boolean;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    contentComplete: boolean;
    model?: string | null;
  }>;
  hasMore: boolean;
  nextBefore: string | null;
  freshness: {
    sourceState: {
      caughtUp: boolean;
    };
  };
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAgentLogHistoryProviderOptions = {
  runtimeFilePath?: string;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
  failureCooldownMs?: number;
  now?: () => number;
};

function defaultRuntimeFilePath(): string {
  const overridden = process.env.OPENAGENTLOG_RUNTIME_FILE?.trim();
  if (overridden) return path.resolve(overridden);
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "OpenAgentLog",
    "data",
    "integration-runtime.json",
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readSecureRuntimeDescriptor(
  runtimeFilePath: string,
): OpenAgentLogRuntimeDescriptor | null {
  let descriptor = -1;
  try {
    const linkStat = fs.lstatSync(runtimeFilePath);
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) return null;
    const noFollow = "O_NOFOLLOW" in fs.constants
      ? fs.constants.O_NOFOLLOW
      : 0;
    descriptor = fs.openSync(
      runtimeFilePath,
      fs.constants.O_RDONLY | noFollow,
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RUNTIME_FILE_BYTES) {
      return null;
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      return null;
    }
    if ((stat.mode & 0o077) !== 0) return null;
    const raw = fs.readFileSync(descriptor, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) return null;
    if (parsed.apiVersion !== 1 || parsed.productId !== "openagentlog") return null;
    if (!Number.isSafeInteger(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65_535) {
      return null;
    }
    if (typeof parsed.token !== "string" || parsed.token.length < 16 || parsed.token.length > 4_096) {
      return null;
    }
    if (typeof parsed.bootId !== "string" || !parsed.bootId.trim() || parsed.bootId.length > 256) {
      return null;
    }
    if (!Number.isSafeInteger(parsed.pid) || Number(parsed.pid) < 1) return null;
    if (!Number.isFinite(parsed.startedAt) || Number(parsed.startedAt) < 0) return null;
    return {
      apiVersion: 1,
      productId: "openagentlog",
      port: Number(parsed.port),
      token: parsed.token,
      bootId: parsed.bootId,
      pid: Number(parsed.pid),
      startedAt: Number(parsed.startedAt),
    };
  } catch {
    return null;
  } finally {
    if (descriptor >= 0) fs.closeSync(descriptor);
  }
}

function parseHistoryResponse(
  value: unknown,
  source: string,
  sessionId: string,
): OpenAgentLogHistoryResponse | null {
  if (!isPlainRecord(value)) return null;
  if (
    value.apiVersion !== 1 ||
    value.source !== source ||
    value.sessionId !== sessionId ||
    value.contentFormat !== "normalized_text" ||
    typeof value.contentComplete !== "boolean" ||
    typeof value.hasMore !== "boolean" ||
    !(typeof value.nextBefore === "string" || value.nextBefore === null) ||
    !Array.isArray(value.messages) ||
    !isPlainRecord(value.freshness) ||
    !isPlainRecord(value.freshness.sourceState) ||
    typeof value.freshness.sourceState.caughtUp !== "boolean"
  ) return null;

  const messages: OpenAgentLogHistoryResponse["messages"] = [];
  for (const item of value.messages) {
    if (!isPlainRecord(item)) return null;
    if (
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      typeof item.contentComplete !== "boolean" ||
      !(item.model === undefined || item.model === null || typeof item.model === "string")
    ) return null;
    messages.push({
      role: item.role,
      content: item.content,
      contentComplete: item.contentComplete,
      ...(typeof item.model === "string" && item.model.trim()
        ? { model: item.model }
        : {}),
    });
  }
  if (value.hasMore && !(typeof value.nextBefore === "string" && value.nextBefore)) {
    return null;
  }
  return {
    apiVersion: 1,
    source,
    sessionId,
    contentFormat: "normalized_text",
    contentComplete: value.contentComplete,
    messages,
    hasMore: value.hasMore,
    nextBefore: value.nextBefore,
    freshness: {
      sourceState: {
        caughtUp: value.freshness.sourceState.caughtUp,
      },
    },
  };
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 40;
  return Math.max(1, Math.min(100, Math.floor(value!)));
}

export class OpenAgentLogHistoryProvider {
  private readonly runtimeFilePath: string;
  private readonly fetch: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly failureCooldownMs: number;
  private readonly now: () => number;
  private unavailableUntilMs = 0;

  constructor(options: OpenAgentLogHistoryProviderOptions = {}) {
    this.runtimeFilePath = options.runtimeFilePath ?? defaultRuntimeFilePath();
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = Math.max(
      50,
      Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    );
    this.failureCooldownMs = Math.max(
      0,
      Math.floor(options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS),
    );
    this.now = options.now ?? Date.now;
  }

  async readPage(
    adapter: DaemonAdapterKind,
    sessionId: string,
    options: BridgeSessionMessagePageOptions = {},
  ): Promise<BridgeSessionMessagePage | null> {
    const source = OPENAGENTLOG_HISTORY_SOURCE_BY_ADAPTER[adapter];
    const normalizedSessionId = sessionId.trim();
    const before = typeof options.before === "string"
      ? options.before.trim()
      : "";
    const usesOpenAgentLogCursor = before.startsWith(OPENAGENTLOG_CURSOR_PREFIX);
    if (!source || !normalizedSessionId) return null;
    if (before && !usesOpenAgentLogCursor) return null;
    if (!usesOpenAgentLogCursor && !options.historyOnly) return null;

    if (this.now() < this.unavailableUntilMs) {
      return this.handleUnavailable(usesOpenAgentLogCursor);
    }
    const runtime = readSecureRuntimeDescriptor(this.runtimeFilePath);
    if (!runtime) {
      this.markUnavailable();
      return this.handleUnavailable(usesOpenAgentLogCursor);
    }

    const url = new URL(
      `/api/integrations/v1/sources/${encodeURIComponent(source)}` +
      `/sessions/${encodeURIComponent(normalizedSessionId)}/messages`,
      `http://127.0.0.1:${runtime.port}`,
    );
    url.searchParams.set("limit", String(normalizeLimit(options.limit)));
    if (usesOpenAgentLogCursor) {
      url.searchParams.set("before", before.slice(OPENAGENTLOG_CURSOR_PREFIX.length));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref?.();
    try {
      const response = await this.fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${runtime.token}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 409 && usesOpenAgentLogCursor) {
          throw new Error("OpenAgentLog 历史分页位置已失效，请重新打开任务。");
        }
        this.markUnavailable();
        return this.handleUnavailable(usesOpenAgentLogCursor);
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        this.markUnavailable();
        return this.handleUnavailable(usesOpenAgentLogCursor);
      }
      const payload = parseHistoryResponse(
        JSON.parse(text) as unknown,
        source,
        normalizedSessionId,
      );
      if (!payload) {
        this.markUnavailable();
        return this.handleUnavailable(usesOpenAgentLogCursor);
      }
      const contentComplete = payload.contentComplete &&
        payload.messages.every((message) => message.contentComplete);
      if (!contentComplete) {
        if (usesOpenAgentLogCursor) {
          throw new Error("OpenAgentLog 中这段历史不完整，请重新打开任务以读取原始记录。");
        }
        return null;
      }
      this.unavailableUntilMs = 0;
      return {
        messages: payload.messages.map((message): BridgeSessionMessage => ({
          role: message.role,
          text: message.content,
          ...(message.model ? { model: message.model } : {}),
        })),
        hasMore: payload.hasMore,
        nextBefore: payload.hasMore && payload.nextBefore
          ? `${OPENAGENTLOG_CURSOR_PREFIX}${payload.nextBefore}`
          : null,
        source: "openagentlog",
        caughtUp: payload.freshness.sourceState.caughtUp,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("分页位置已失效") || error.message.includes("这段历史不完整"))
      ) {
        throw error;
      }
      this.markUnavailable();
      return this.handleUnavailable(usesOpenAgentLogCursor);
    } finally {
      clearTimeout(timeout);
    }
  }

  async readLatestMessage(
    adapter: DaemonAdapterKind,
    sessionId: string,
  ): Promise<BridgeSessionMessage | null> {
    const page = await this.readPage(adapter, sessionId, {
      historyOnly: true,
      limit: 1,
    });
    return page?.messages.at(-1) ?? null;
  }

  private markUnavailable(): void {
    this.unavailableUntilMs = this.now() + this.failureCooldownMs;
  }

  private handleUnavailable(usesOpenAgentLogCursor: boolean): null {
    if (usesOpenAgentLogCursor) {
      throw new Error("OpenAgentLog 历史加速暂时不可用，请稍后重试。");
    }
    return null;
  }
}
