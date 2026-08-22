import crypto from "node:crypto";
import fs from "node:fs";

import { BoundedTtlSet } from "../utils/bounded-ttl-cache.ts";
import { writePrivateFileAtomic } from "../utils/private-files.ts";
import { normalizeWeRelayRelayBaseUrl } from "./relay-protocol.ts";
import { encodeWeRelayTaskShortCode } from "./relay-task-short-code.ts";

export const WERELAY_RELAY_TASK_LINK_REGISTER_PATH =
  "/__werelay/device/task-links";
export const WERELAY_RELAY_TASK_LINK_ALIAS_LENGTH = 10;

const MAX_TASK_LINKS = 100_000;
const REGISTERED_ALIAS_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
const REGISTER_RETRY_MIN_MS = 1_000;
const REGISTER_RETRY_MAX_MS = 30_000;

export type WeRelayRelayTaskLinkTarget = {
  adapter: string;
  threadId: string;
};

type TaskLinkState = {
  version: 1;
  entries: Array<WeRelayRelayTaskLinkTarget & {
    alias: string;
    updatedAt: string;
  }>;
};

function normalizeTarget(
  target: WeRelayRelayTaskLinkTarget,
): WeRelayRelayTaskLinkTarget {
  const adapter = target.adapter.trim().toLowerCase();
  const threadId = target.threadId.trim();
  if (!adapter || adapter.length > 64 || !threadId || threadId.length > 512) {
    throw new Error("任务短链接目标无效。");
  }
  return { adapter, threadId };
}

export function createWeRelayRelayTaskLinkAlias(
  deviceToken: string,
  adapter: string,
  threadId: string,
): string {
  const token = deviceToken.trim();
  if (!token) {
    throw new Error("缺少 Relay 设备密钥，无法生成任务短链接。");
  }
  const target = normalizeTarget({ adapter, threadId });
  return crypto.createHmac("sha256", token)
    .update(target.adapter)
    .update("\0")
    .update(target.threadId)
    .digest("base64url")
    .slice(0, WERELAY_RELAY_TASK_LINK_ALIAS_LENGTH);
}

export class WeRelayRelayTaskLinkStore {
  private readonly deviceToken: string;
  private readonly stateFile?: string;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, WeRelayRelayTaskLinkTarget>();

  constructor(options: {
    deviceToken: string;
    stateFile?: string;
    maxEntries?: number;
  }) {
    this.deviceToken = options.deviceToken.trim();
    this.stateFile = options.stateFile;
    this.maxEntries = Math.max(1, options.maxEntries ?? MAX_TASK_LINKS);
    this.load();
  }

  register(alias: string, target: WeRelayRelayTaskLinkTarget): void {
    const normalizedAlias = alias.trim();
    const normalizedTarget = normalizeTarget(target);
    if (
      normalizedAlias !== createWeRelayRelayTaskLinkAlias(
        this.deviceToken,
        normalizedTarget.adapter,
        normalizedTarget.threadId,
      )
    ) {
      throw new Error("任务短链接校验失败。");
    }
    const existing = this.entries.get(normalizedAlias);
    if (
      existing &&
      (existing.adapter !== normalizedTarget.adapter ||
        existing.threadId !== normalizedTarget.threadId)
    ) {
      throw new Error("任务短链接发生冲突，请重试。");
    }
    this.entries.delete(normalizedAlias);
    this.entries.set(normalizedAlias, normalizedTarget);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    this.persist();
  }

  resolve(alias: string): WeRelayRelayTaskLinkTarget | null {
    return this.entries.get(alias.trim()) ?? null;
  }

  private load(): void {
    if (!this.stateFile) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as TaskLinkState;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const entry of parsed.entries.slice(-this.maxEntries)) {
        try {
          const target = normalizeTarget(entry);
          if (
            entry.alias === createWeRelayRelayTaskLinkAlias(
              this.deviceToken,
              target.adapter,
              target.threadId,
            )
          ) {
            this.entries.set(entry.alias, target);
          }
        } catch {
          // Invalid persisted entries are ignored.
        }
      }
    } catch {
      // Missing or invalid state is ignored.
    }
  }

  private persist(): void {
    if (!this.stateFile) return;
    const updatedAt = new Date().toISOString();
    const state: TaskLinkState = {
      version: 1,
      entries: [...this.entries.entries()].map(([alias, target]) => ({
        alias,
        ...target,
        updatedAt,
      })),
    };
    writePrivateFileAtomic(this.stateFile, `${JSON.stringify(state)}\n`);
  }
}

type PendingRegistration = WeRelayRelayTaskLinkTarget & {
  alias: string;
  retryMs: number;
  timer?: ReturnType<typeof setTimeout>;
};

export class WeRelayRelayTaskLinkClient {
  private readonly relayUrl: string;
  private readonly deviceId: string;
  private readonly deviceToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly registered = new BoundedTtlSet<string>({
    maxSize: 20_000,
    ttlMs: REGISTERED_ALIAS_CACHE_TTL_MS,
  });
  private readonly pending = new Map<string, PendingRegistration>();
  private readonly abortController = new AbortController();

  constructor(options: {
    relayUrl: string;
    deviceId: string;
    deviceToken: string;
    fetchImpl?: typeof fetch;
  }) {
    this.relayUrl = normalizeWeRelayRelayBaseUrl(options.relayUrl);
    this.deviceId = options.deviceId.trim();
    this.deviceToken = options.deviceToken.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  buildTaskUrl(
    threadId: string,
    adapter: string,
    searchParams: URLSearchParams,
  ): string {
    const target = normalizeTarget({ adapter, threadId });
    const alias = createWeRelayRelayTaskLinkAlias(
      this.deviceToken,
      target.adapter,
      target.threadId,
    );
    this.ensureRegistered(alias, target);
    const query = searchParams.toString();
    const pathname = this.registered.has(alias)
      ? `/${alias}`
      : `/t/${encodeWeRelayTaskShortCode(target.adapter, target.threadId)}`;
    return `${this.relayUrl}${pathname}${query ? `?${query}` : ""}`;
  }

  async close(): Promise<void> {
    this.abortController.abort();
    for (const registration of this.pending.values()) {
      if (registration.timer) clearTimeout(registration.timer);
    }
    this.pending.clear();
  }

  private ensureRegistered(
    alias: string,
    target: WeRelayRelayTaskLinkTarget,
  ): void {
    if (this.registered.has(alias) || this.pending.has(alias)) return;
    const registration: PendingRegistration = {
      alias,
      ...target,
      retryMs: REGISTER_RETRY_MIN_MS,
    };
    this.pending.set(alias, registration);
    void this.register(registration);
  }

  private async register(registration: PendingRegistration): Promise<void> {
    if (this.abortController.signal.aborted) return;
    try {
      const response = await this.fetchImpl(
        `${this.relayUrl}${WERELAY_RELAY_TASK_LINK_REGISTER_PATH}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.deviceToken}`,
            "content-type": "application/json",
            "x-werelay-device-id": this.deviceId,
          },
          body: JSON.stringify({
            alias: registration.alias,
            adapter: registration.adapter,
            threadId: registration.threadId,
          }),
          signal: this.abortController.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Relay 返回 ${response.status}`);
      }
      this.pending.delete(registration.alias);
      this.registered.add(registration.alias);
      return;
    } catch {
      if (this.abortController.signal.aborted) return;
      registration.timer = setTimeout(() => {
        registration.timer = undefined;
        void this.register(registration);
      }, registration.retryMs);
      registration.timer.unref?.();
      registration.retryMs = Math.min(
        REGISTER_RETRY_MAX_MS,
        registration.retryMs * 2,
      );
    }
  }
}
