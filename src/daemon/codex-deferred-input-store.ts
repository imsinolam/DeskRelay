import fs from "node:fs";
import path from "node:path";

import {
  ensureWorkspaceChannelDir,
  normalizeWorkspacePath,
} from "../wechat/channel-config.ts";
import type { InboundWechatMessage } from "../wechat/wechat-transport.ts";

export type CodexDeferredInboundMessage =
  | { source: "wechat"; message: InboundWechatMessage }
  | { source: "mobile"; text: string };

export type CodexDeferredInputEntry = {
  threadId: string;
  item: CodexDeferredInboundMessage;
};

type CodexDeferredInputFile = {
  version: 1;
  cwd: string;
  entries: CodexDeferredInputEntry[];
};

type CodexDeferredInputStoreOptions = {
  stateFile?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSameWorkspace(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalizeWechatMessage(value: unknown): InboundWechatMessage | null {
  if (
    !isRecord(value) ||
    typeof value.senderId !== "string" ||
    typeof value.sender !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.attachments)
  ) {
    return null;
  }

  const attachments: InboundWechatMessage["attachments"] = [];
  for (const attachment of value.attachments) {
    if (!isRecord(attachment)) {
      return null;
    }
    const kind = attachment.kind;
    if (
      (kind !== "image" && kind !== "file") ||
      typeof attachment.path !== "string" ||
      typeof attachment.fileName !== "string" ||
      typeof attachment.sizeBytes !== "number"
    ) {
      return null;
    }
    attachments.push({
      kind,
      path: attachment.path,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
    });
  }
  return {
    senderId: value.senderId,
    sender: value.sender,
    sessionId: value.sessionId,
    text: value.text,
    attachments,
    ...(typeof value.contextToken === "string"
      ? { contextToken: value.contextToken }
      : {}),
    ...(typeof value.createdAtMs === "number"
      ? { createdAtMs: value.createdAtMs }
      : {}),
    createdAt: value.createdAt,
  };
}

function normalizeEntry(value: unknown): CodexDeferredInputEntry | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || !value.threadId.trim()) {
    return null;
  }
  if (!isRecord(value.item)) {
    return null;
  }
  if (value.item.source === "mobile" && typeof value.item.text === "string") {
    return {
      threadId: value.threadId.trim(),
      item: { source: "mobile", text: value.item.text },
    };
  }
  if (value.item.source === "wechat") {
    const message = normalizeWechatMessage(value.item.message);
    return message
      ? {
          threadId: value.threadId.trim(),
          item: { source: "wechat", message },
        }
      : null;
  }
  return null;
}

function resolveStateFile(
  cwd: string,
  options: CodexDeferredInputStoreOptions,
): string {
  return options.stateFile ?? path.join(
    ensureWorkspaceChannelDir(cwd).workspaceDir,
    "codex-deferred-inputs.json",
  );
}

export class CodexDeferredInputStore {
  private readonly cwd: string;
  private readonly stateFile: string;

  constructor(
    cwd: string,
    options: CodexDeferredInputStoreOptions = {},
  ) {
    this.cwd = normalizeWorkspacePath(cwd);
    this.stateFile = resolveStateFile(cwd, options);
  }

  load(): CodexDeferredInputEntry[] {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return [];
      }
      const value = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as unknown;
      if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.cwd !== "string" ||
        !isSameWorkspace(value.cwd, this.cwd) ||
        !Array.isArray(value.entries)
      ) {
        return [];
      }
      return value.entries.flatMap((entry) => {
        const normalized = normalizeEntry(entry);
        return normalized ? [normalized] : [];
      });
    } catch {
      return [];
    }
  }

  replace(entries: CodexDeferredInputEntry[]): void {
    if (entries.length === 0) {
      fs.rmSync(this.stateFile, { force: true });
      return;
    }

    const state: CodexDeferredInputFile = {
      version: 1,
      cwd: this.cwd,
      entries,
    };
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf8");
      fs.renameSync(tempFile, this.stateFile);
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
  }

  clear(): void {
    fs.rmSync(this.stateFile, { force: true });
  }
}
