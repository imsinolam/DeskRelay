import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  ensureWorkspaceChannelDir,
  normalizeWorkspacePath,
} from "../wechat/channel-config.ts";
import type { DaemonAdapterKind } from "./daemon-link.ts";
import { isDaemonAdapterKind } from "../bridge/bridge-providers.ts";

export type CodexWechatReplyMode = "preview" | "full";

export type DaemonWorkspaceState = {
  version: 1;
  cwd: string;
  activeAdapter?: DaemonAdapterKind;
  adapterSessionIds?: Partial<Record<DaemonAdapterKind, string>>;
  codexThreadId?: string;
  codexWechatThreadId?: string;
  mobileAccessToken?: string;
  codexWechatReplyMode?: CodexWechatReplyMode;
  restartNoticeSentAt?: string;
  updatedAt: string;
};

type DaemonWorkspaceStateOptions = {
  stateFile?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCodexWechatReplyMode(value: unknown): value is CodexWechatReplyMode {
  return value === "preview" || value === "full";
}

function isSameWorkspace(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalizeDaemonWorkspaceState(
  value: unknown,
  cwd: string,
): DaemonWorkspaceState | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.cwd !== "string") {
    return null;
  }
  if (!isSameWorkspace(value.cwd, cwd)) {
    return null;
  }
  if (
    value.activeAdapter !== undefined &&
    !isDaemonAdapterKind(value.activeAdapter)
  ) {
    return null;
  }
  if (
    value.codexThreadId !== undefined &&
    (typeof value.codexThreadId !== "string" || !value.codexThreadId.trim())
  ) {
    return null;
  }
  if (
    value.codexWechatThreadId !== undefined &&
    (
      typeof value.codexWechatThreadId !== "string" ||
      !value.codexWechatThreadId.trim()
    )
  ) {
    return null;
  }
  let adapterSessionIds: Partial<Record<DaemonAdapterKind, string>> | undefined;
  if (value.adapterSessionIds !== undefined) {
    if (!isRecord(value.adapterSessionIds)) {
      return null;
    }
    adapterSessionIds = {};
    for (const [adapter, sessionId] of Object.entries(value.adapterSessionIds)) {
      if (!isDaemonAdapterKind(adapter) || typeof sessionId !== "string" || !sessionId.trim()) {
        return null;
      }
      adapterSessionIds[adapter] = sessionId.trim();
    }
  }
  if (
    value.mobileAccessToken !== undefined &&
    (typeof value.mobileAccessToken !== "string" || !value.mobileAccessToken.trim())
  ) {
    return null;
  }
  if (
    value.codexWechatReplyMode !== undefined &&
    !isCodexWechatReplyMode(value.codexWechatReplyMode)
  ) {
    return null;
  }
  if (
    value.restartNoticeSentAt !== undefined &&
    (
      typeof value.restartNoticeSentAt !== "string" ||
      !value.restartNoticeSentAt.trim() ||
      !Number.isFinite(Date.parse(value.restartNoticeSentAt))
    )
  ) {
    return null;
  }
  if (typeof value.updatedAt !== "string" || !value.updatedAt.trim()) {
    return null;
  }

  return {
    version: 1,
    cwd: normalizeWorkspacePath(cwd),
    activeAdapter: value.activeAdapter,
    adapterSessionIds,
    codexThreadId:
      typeof value.codexThreadId === "string"
        ? value.codexThreadId.trim()
        : undefined,
    codexWechatThreadId:
      typeof value.codexWechatThreadId === "string"
        ? value.codexWechatThreadId.trim()
        : undefined,
    mobileAccessToken:
      typeof value.mobileAccessToken === "string"
        ? value.mobileAccessToken.trim()
        : undefined,
    codexWechatReplyMode: value.codexWechatReplyMode,
    restartNoticeSentAt:
      typeof value.restartNoticeSentAt === "string"
        ? value.restartNoticeSentAt.trim()
        : undefined,
    updatedAt: value.updatedAt,
  };
}

function resolveDaemonStateFile(
  cwd: string,
  options: DaemonWorkspaceStateOptions,
): string {
  return options.stateFile ?? ensureWorkspaceChannelDir(cwd).daemonStateFile;
}

export function readDaemonWorkspaceState(
  cwd: string,
  options: DaemonWorkspaceStateOptions = {},
): DaemonWorkspaceState | null {
  const stateFile = resolveDaemonStateFile(cwd, options);
  try {
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    return normalizeDaemonWorkspaceState(
      JSON.parse(fs.readFileSync(stateFile, "utf8")),
      cwd,
    );
  } catch {
    return null;
  }
}

export class DaemonWorkspaceStateStore {
  readonly hadPersistedState: boolean;
  private readonly stateFile: string;
  private state: DaemonWorkspaceState;
  private readonly persistedState: DaemonWorkspaceState | null;

  constructor(
    cwd: string,
    options: DaemonWorkspaceStateOptions = {},
  ) {
    this.stateFile = resolveDaemonStateFile(cwd, options);
    this.persistedState = readDaemonWorkspaceState(cwd, {
      stateFile: this.stateFile,
    });
    this.hadPersistedState = Boolean(this.persistedState);
    this.state = this.persistedState ?? {
      version: 1,
      cwd: normalizeWorkspacePath(cwd),
      updatedAt: new Date(0).toISOString(),
    };
  }

  getPersistedState(): DaemonWorkspaceState | null {
    return this.persistedState ? { ...this.persistedState } : null;
  }

  getState(): DaemonWorkspaceState {
    return { ...this.state };
  }

  setActiveAdapter(adapter: DaemonAdapterKind): void {
    if (this.state.activeAdapter === adapter) {
      return;
    }
    this.state.activeAdapter = adapter;
    this.persist();
  }

  getAdapterSessionId(adapter: DaemonAdapterKind): string | undefined {
    return this.state.adapterSessionIds?.[adapter] ?? (
      adapter === "codex" ? this.state.codexThreadId : undefined
    );
  }

  setAdapterSessionId(
    adapter: DaemonAdapterKind,
    sessionId: string | null | undefined,
  ): void {
    const normalizedSessionId = sessionId?.trim() || undefined;
    const next = { ...(this.state.adapterSessionIds ?? {}) };
    if (normalizedSessionId) {
      next[adapter] = normalizedSessionId;
    } else {
      delete next[adapter];
    }
    if (this.state.adapterSessionIds?.[adapter] === normalizedSessionId) {
      return;
    }
    this.state.adapterSessionIds = Object.keys(next).length > 0 ? next : undefined;
    if (adapter === "codex") {
      this.state.codexThreadId = normalizedSessionId;
    }
    this.persist();
  }

  setCodexWechatReplyMode(mode: CodexWechatReplyMode): void {
    if (this.state.codexWechatReplyMode === mode) {
      return;
    }
    this.state.codexWechatReplyMode = mode;
    this.persist();
  }

  setRestartNoticeSentAt(value: string): void {
    const normalized = value.trim();
    if (!normalized || !Number.isFinite(Date.parse(normalized))) {
      throw new Error("重启通知时间无效。");
    }
    if (this.state.restartNoticeSentAt === normalized) {
      return;
    }
    this.state.restartNoticeSentAt = normalized;
    this.persist();
  }

  setCodexThreadId(threadId: string | null | undefined): void {
    this.setAdapterSessionId("codex", threadId);
  }

  getCodexWechatThreadId(): string | undefined {
    return this.state.codexWechatThreadId ?? this.state.codexThreadId;
  }

  setCodexWechatThreadId(threadId: string | null | undefined): void {
    const normalizedThreadId = threadId?.trim() || undefined;
    if (this.state.codexWechatThreadId === normalizedThreadId) {
      return;
    }
    this.state.codexWechatThreadId = normalizedThreadId;
    this.persist();
  }

  ensureMobileAccessToken(
    generate: () => string = () => crypto.randomBytes(12).toString("base64url"),
  ): string {
    if (this.state.mobileAccessToken) {
      return this.state.mobileAccessToken;
    }
    const token = generate().trim();
    if (!token) {
      throw new Error("移动版访问密钥不能为空。");
    }
    this.state.mobileAccessToken = token;
    this.persist();
    return token;
  }

  private persist(): void {
    this.state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(this.state, null, 2), "utf8");
      fs.renameSync(tempFile, this.stateFile);
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  }
}
