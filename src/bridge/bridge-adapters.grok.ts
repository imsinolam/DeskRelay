import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  type AdapterOptions,
  buildCliEnvironment,
  resolveSpawnTarget,
} from "./bridge-adapters.shared.ts";
import type {
  BridgeMessageImage,
  BridgeResumeSessionCandidate,
  BridgeSessionMessage,
} from "./bridge-types.ts";
import {
  enrichBridgeSessionMessageImages,
  mergeBridgeMessageImages,
} from "./bridge-message-images.ts";
import {
  AcpBridgeAdapter,
  normalizeAcpSessionCandidates,
} from "./bridge-adapters.acp.ts";
import {
  describeUnknownError,
  isRecord,
} from "./bridge-adapter-common.ts";
import { killProcessTreeSync } from "./bridge-process-reaper.ts";
import { nowIso } from "./bridge-utils.ts";

const GROK_LEADER_READY_TIMEOUT_MS = 10_000;
const GROK_LEADER_POLL_INTERVAL_MS = 100;

type GrokLeaderSocketOptions = {
  platform?: NodeJS.Platform;
  uid?: number;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function grokHomeDirectory(): string {
  return process.env.GROK_HOME?.trim() || path.join(os.homedir(), ".grok");
}

function grokSessionDirectory(cwd: string, sessionId: string): string {
  return path.join(grokHomeDirectory(), "sessions", encodeURIComponent(cwd), sessionId);
}

export function resolveGrokLeaderSocket(
  cwd: string,
  options: GrokLeaderSocketOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const workspaceHash = crypto.createHash("sha256")
    .update(path.resolve(cwd))
    .digest("hex")
    .slice(0, 16);
  if (platform === "win32") {
    return `\\\\.\\pipe\\deskrelay-grok-${uid}-${workspaceHash}`;
  }
  return `/tmp/deskrelay-grok-${uid}-${workspaceHash}.sock`;
}

export function buildGrokAcpArgs(
  options: AdapterOptions,
  leaderSocket: string,
): string[] {
  return [
    "agent",
    "--leader",
    "--leader-socket",
    leaderSocket,
    ...(options.profile ? ["--agent-profile", options.profile] : []),
    "stdio",
  ];
}

export function buildGrokNativeArgs(
  options: AdapterOptions,
  leaderSocket: string,
  sessionId?: string,
): string[] {
  return [
    "--leader-socket",
    leaderSocket,
    ...(sessionId ? ["--resume", sessionId] : []),
    ...(options.extraCliArgs ?? []),
  ];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canConnectToLeader(socketPath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    const settle = (connected: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

export function findGrokSessionDirectory(
  sessionId: string,
  preferredCwd?: string,
): string | null {
  if (preferredCwd) {
    const preferred = grokSessionDirectory(preferredCwd, sessionId);
    if (fs.existsSync(preferred)) return preferred;
  }
  const sessionsRoot = path.join(grokHomeDirectory(), "sessions");
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, project.name, sessionId);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveGrokSessionCwd(sessionId: string): string | null {
  const directory = findGrokSessionDirectory(sessionId);
  if (!directory) return null;
  try {
    const summary = JSON.parse(
      fs.readFileSync(path.join(directory, "summary.json"), "utf8"),
    ) as unknown;
    if (isRecord(summary) && isRecord(summary.info) && typeof summary.info.cwd === "string") {
      return summary.info.cwd;
    }
  } catch {
    // Fall back to decoding the project directory name.
  }
  try {
    return decodeURIComponent(path.basename(path.dirname(directory)));
  } catch {
    return null;
  }
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (isRecord(entry) && entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function normalizeGrokUserText(text: string): string {
  const query = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1]?.trim();
  if (query) return query;
  if (/<(?:system-reminder|user_info|git_status)>/i.test(text)) return "";
  return text.trim();
}

export function parseGrokChatHistory(text: string): BridgeSessionMessage[] {
  const messages: BridgeSessionMessage[] = [];
  let latestAssistantIndex = -1;
  const attachGeneratedImage = (image: BridgeMessageImage) => {
    if (latestAssistantIndex < 0) {
      messages.push({
        role: "assistant",
        text: "",
        phase: "final_answer",
        images: [image],
      });
      latestAssistantIndex = messages.length - 1;
      return;
    }
    const assistant = messages[latestAssistantIndex];
    if (!assistant || assistant.role !== "assistant") return;
    assistant.images = mergeBridgeMessageImages(assistant.images, [image]);
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;

    if (value.type === "tool_result") {
      const content = typeof value.content === "string" ? value.content.trim() : "";
      if (!content || /^Read image file:/i.test(content)) continue;
      let result: unknown;
      try {
        result = JSON.parse(content);
      } catch {
        continue;
      }
      if (!isRecord(result) || typeof result.path !== "string") continue;
      const imagePath = path.normalize(result.path);
      const extension = path.extname(imagePath).toLowerCase();
      if (
        !path.isAbsolute(imagePath) ||
        ![".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif"].includes(extension) ||
        !fs.existsSync(imagePath)
      ) {
        continue;
      }
      attachGeneratedImage({
        source: "local",
        path: imagePath,
        ...(readString(result.filename) ? { alt: readString(result.filename) } : {}),
      });
      continue;
    }

    if (value.type !== "user" && value.type !== "assistant") continue;
    const rawText = textContent(value.content);
    const messageText = value.type === "user" ? normalizeGrokUserText(rawText) : rawText.trim();
    if (value.type === "user") latestAssistantIndex = -1;
    if (!messageText) continue;
    const model = value.type === "assistant"
      ? readString(value.model_id) ?? readString(value.model)
      : undefined;
    const message = enrichBridgeSessionMessageImages({
      role: value.type,
      text: messageText,
      ...(value.type === "assistant" ? { phase: "final_answer" as const } : {}),
      ...(model ? { model } : {}),
    });
    messages.push(message);
    if (value.type === "assistant") latestAssistantIndex = messages.length - 1;
  }
  return messages;
}

export function listGrokStoredSessions(
  limit = 10,
): BridgeResumeSessionCandidate[] {
  const sessionsRoot = path.join(grokHomeDirectory(), "sessions");
  const candidates: BridgeResumeSessionCandidate[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDirectory = path.join(sessionsRoot, project.name);
    let sessions: fs.Dirent[];
    try {
      sessions = fs.readdirSync(projectDirectory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const directory = path.join(projectDirectory, session.name);
      const summaryPath = path.join(directory, "summary.json");
      let summary: unknown;
      let stat: fs.Stats;
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        stat = fs.statSync(summaryPath);
      } catch {
        continue;
      }
      if (!isRecord(summary)) continue;
      const info = isRecord(summary.info) ? summary.info : null;
      const sessionId = readString(info?.id) ?? session.name;
      const cwd = readString(info?.cwd) ?? (() => {
        try { return decodeURIComponent(project.name); } catch { return undefined; }
      })();
      const title = readString(summary.generated_title) ??
        readString(summary.session_summary) ??
        `Grok 会话 ${sessionId.slice(0, 8)}`;
      const lastUpdatedAt = readString(summary.last_active_at) ??
        readString(summary.updated_at) ??
        stat.mtime.toISOString();
      candidates.push({
        sessionId,
        threadId: sessionId,
        title,
        lastUpdatedAt,
        ...(cwd ? { cwd, projectName: path.basename(cwd) || cwd } : {}),
        runtimeStatus: { type: "notLoaded" },
      });
    }
  }
  return candidates
    .sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt))
    .slice(0, Math.max(1, limit));
}

export async function readGrokStoredSessionMessages(
  cwd: string,
  sessionId: string,
): Promise<BridgeSessionMessage[]> {
  try {
    const directory = findGrokSessionDirectory(sessionId, cwd);
    if (!directory) return [];
    return parseGrokChatHistory(
      fs.readFileSync(path.join(directory, "chat_history.jsonl"), "utf8"),
    );
  } catch {
    return [];
  }
}

export class GrokAcpAdapter extends AcpBridgeAdapter {
  private readonly grokOptions: AdapterOptions;
  private readonly leaderSocket: string;
  private leaderProcess: ChildProcess | null = null;
  private ownsLeaderProcess = false;
  private nativeProcess: ChildProcess | null = null;
  private nativeGeneration = 0;
  private disposingGrok = false;
  private startingGrok = false;

  constructor(options: AdapterOptions) {
    const leaderSocket = resolveGrokLeaderSocket(options.cwd);
    super(options, {
      kind: "grok",
      buildArgs: (adapterOptions) => buildGrokAcpArgs(adapterOptions, leaderSocket),
      listSessions: async (request, cwd, limit) =>
        normalizeAcpSessionCandidates(await request("session/list", {}), cwd, limit),
      readSessionMessages: readGrokStoredSessionMessages,
      resolveSessionCwd: resolveGrokSessionCwd,
    });
    this.grokOptions = options;
    this.leaderSocket = leaderSocket;
  }

  async getSessionMessageMedia(sessionId: string): Promise<BridgeSessionMessage[]> {
    return await readGrokStoredSessionMessages(this.grokOptions.cwd, sessionId);
  }

  override async start(): Promise<void> {
    this.disposingGrok = false;
    this.startingGrok = true;
    try {
      await this.ensureLeaderProcess();
      await super.start();
    } finally {
      this.startingGrok = false;
    }
    await this.restartNativeClient();
  }

  override async createSession(): Promise<void> {
    await super.createSession();
    if (!this.startingGrok && this.grokOptions.renderMode === "companion") {
      await this.restartNativeClient();
    }
  }

  override async resumeSession(sessionId: string): Promise<void> {
    await super.resumeSession(sessionId);
    if (!this.startingGrok && this.grokOptions.renderMode === "companion") {
      await this.restartNativeClient();
    }
  }

  override async dispose(): Promise<void> {
    this.disposingGrok = true;
    this.nativeGeneration += 1;
    this.stopNativeClient();
    await super.dispose();
    this.stopOwnedLeader();
  }

  private async ensureLeaderProcess(): Promise<void> {
    if (await canConnectToLeader(this.leaderSocket)) {
      return;
    }
    if (process.platform !== "win32") {
      try {
        fs.rmSync(this.leaderSocket, { force: true });
      } catch {
        // A concurrent Grok client may be creating the socket; spawning will report the real error.
      }
    }

    const env = buildCliEnvironment("grok");
    const target = resolveSpawnTarget(this.grokOptions.command, "grok", { env });
    const args = [
      "agent",
      "leader",
      "--no-exit-on-disconnect",
      "--relay-on-demand",
      "--leader-socket",
      this.leaderSocket,
    ];
    const child = spawn(target.file, [...target.args, ...args], {
      cwd: this.grokOptions.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.leaderProcess = child;
    this.ownsLeaderProcess = true;

    let leaderError = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      leaderError = `${leaderError}${String(chunk)}`.slice(-4000);
    });

    const deadline = Date.now() + GROK_LEADER_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await canConnectToLeader(this.leaderSocket)) {
        return;
      }
      if (child.exitCode !== null) {
        break;
      }
      await delay(GROK_LEADER_POLL_INTERVAL_MS);
    }

    this.stopOwnedLeader();
    const detail = leaderError.trim().replace(/\s+/g, " ");
    throw new Error(
      detail
        ? `Grok 共享会话服务启动失败：${detail}`
        : "Grok 共享会话服务启动超时，请先运行 grok doctor 检查登录和本机环境。",
    );
  }

  private async restartNativeClient(): Promise<void> {
    if (this.grokOptions.renderMode !== "companion") {
      return;
    }
    const generation = ++this.nativeGeneration;
    this.stopNativeClient();
    const env = buildCliEnvironment("grok");
    const target = resolveSpawnTarget(this.grokOptions.command, "grok", { env });
    const sessionId = this.getState().sharedSessionId;
    const args = buildGrokNativeArgs(this.grokOptions, this.leaderSocket, sessionId);
    const child = spawn(target.file, [...target.args, ...args], {
      cwd: sessionId ? resolveGrokSessionCwd(sessionId) ?? this.grokOptions.cwd : this.grokOptions.cwd,
      env,
      stdio: "inherit",
      windowsHide: false,
    });
    this.nativeProcess = child;

    child.once("error", (error) => {
      if (generation !== this.nativeGeneration || this.disposingGrok) return;
      this.setStatus("error", "Grok 可见终端启动失败。");
      this.emit({
        type: "fatal_error",
        message: `Grok 可见终端启动失败：${describeUnknownError(error)}`,
        timestamp: nowIso(),
      });
    });

    child.once("exit", (code, signal) => {
      if (generation !== this.nativeGeneration || this.disposingGrok) return;
      if (this.nativeProcess === child) this.nativeProcess = null;
      this.setStatus("stopped", "Grok 可见终端已关闭。");
      const detail = signal ? `信号 ${signal}` : `代码 ${code ?? "未知"}`;
      this.emit({
        type: "shutdown_requested",
        reason: "companion_closed",
        message: `Grok 可见终端已关闭（${detail}）。`,
        exitCode: typeof code === "number" ? code : 0,
        timestamp: nowIso(),
      });
    });
  }

  private stopNativeClient(): void {
    const child = this.nativeProcess;
    this.nativeProcess = null;
    if (child?.pid) {
      try {
        killProcessTreeSync(child.pid);
      } catch {
        // Best effort shutdown.
      }
    }
  }

  private stopOwnedLeader(): void {
    const child = this.leaderProcess;
    const ownedLeader = this.ownsLeaderProcess;
    this.leaderProcess = null;
    this.ownsLeaderProcess = false;
    if (ownedLeader && child?.pid) {
      try {
        killProcessTreeSync(child.pid);
      } catch {
        // Best effort shutdown.
      }
    }
    if (ownedLeader && process.platform !== "win32") {
      try {
        fs.rmSync(this.leaderSocket, { force: true });
      } catch {
        // Best effort stale socket cleanup.
      }
    }
  }
}
