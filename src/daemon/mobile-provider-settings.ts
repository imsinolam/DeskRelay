import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  buildCliEnvironment,
  resolveCommandPath,
} from "../bridge/bridge-adapters.shared.ts";
import {
  getBridgeProvider,
  isDaemonAdapterKind,
  type BridgeProviderDefinition,
  type BridgeProviderDependency,
  type BridgeProviderId,
} from "../bridge/bridge-providers.ts";

export type MobileProviderDependencyStatus =
  | "ready"
  | "missing"
  | "inactive"
  | "optional"
  | "installing"
  | "failed";

export type MobileProviderStatus =
  | "ready"
  | "needs_setup"
  | "unavailable"
  | "installing";

export type MobileProviderInstallState = {
  status: "installing" | "succeeded" | "failed";
  detail?: string;
};

export type MobileProviderDependencyEntry = {
  id: string;
  kind: BridgeProviderDependency["kind"];
  name: string;
  label: string;
  required: boolean;
  status: MobileProviderDependencyStatus;
  statusLabel: string;
  hint: string;
  detail?: string;
  action?: {
    type: "install" | "manual";
    label: string;
  };
};

export type MobileProviderSettingsEntry = {
  id: string;
  label: string;
  transport: string;
  owner: string;
  continuity: string;
  localVisibility: string;
  sessionSource: string;
  status: MobileProviderStatus;
  statusLabel: string;
  capabilities: BridgeProviderDefinition["capabilities"];
  dependencies: MobileProviderDependencyEntry[];
};

type BuildMobileProviderSettingsOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resolveCommand?: (command: string) => string | undefined;
  exists?: (filePath: string) => boolean;
  isPortReachable?: (host: string, port: number) => Promise<boolean>;
  installManager?: Pick<MobileProviderInstallManager, "getState">;
};

type InstallCommandResult = {
  code: number;
  output: string;
};

type MobileProviderInstallManagerOptions = {
  runCommand?: (command: string, args: string[]) => Promise<InstallCommandResult>;
};

const INSTALL_OUTPUT_LIMIT = 4_000;

function dependencyName(dependency: BridgeProviderDependency): string {
  if (dependency.kind === "command") return dependency.name;
  if (dependency.kind === "port") {
    return `${dependency.host ?? "127.0.0.1"}:${dependency.port}`;
  }
  if (dependency.kind === "app") return dependency.path;
  return dependency.name;
}

function dependencyLabel(dependency: BridgeProviderDependency): string {
  if (dependency.label) return dependency.label;
  if (dependency.kind === "command") return `${dependency.name} 命令`;
  if (dependency.kind === "port") return `${dependencyName(dependency)} 服务`;
  if (dependency.kind === "app") return path.basename(dependency.path, ".app") || dependency.path;
  return dependency.name;
}

function providerSessionSource(provider: BridgeProviderDefinition): string {
  switch (provider.sessionIntegration.owner) {
    case "desktop_owner":
      return `任务由 ${provider.label} 桌面端持有，手机继续同一条任务。`;
    case "visible_cli_owner":
      return "连接电脑上由 WeRelay 打开的可见终端，手机与电脑共用同一条任务。";
    case "shared_service_owner":
      return "连接电脑上的本机服务，手机与电脑界面共用同一条任务。";
    default:
      return "此终端不保留可继续的任务。";
  }
}

function defaultPortCheck(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function dependencyAction(
  dependency: BridgeProviderDependency,
  status: MobileProviderDependencyStatus,
): MobileProviderDependencyEntry["action"] {
  if (status === "ready" || status === "optional" || status === "installing") {
    return undefined;
  }
  if (dependency.install) {
    return {
      type: "install",
      label: status === "failed" ? "重新安装" : "一键安装",
    };
  }
  return {
    type: "manual",
    label: dependency.kind === "port" ? "查看启动方法" : "查看安装方法",
  };
}

function providerStatus(
  dependencies: MobileProviderDependencyEntry[],
): Pick<MobileProviderSettingsEntry, "status" | "statusLabel"> {
  if (dependencies.some((dependency) => dependency.status === "installing")) {
    return { status: "installing", statusLabel: "正在安装" };
  }
  if (dependencies.some((dependency) =>
    dependency.required && (dependency.status === "missing" || dependency.status === "failed")
  )) {
    return { status: "unavailable", statusLabel: "需要安装" };
  }
  if (dependencies.some((dependency) =>
    dependency.required && dependency.status === "inactive"
  )) {
    return { status: "needs_setup", statusLabel: "需要启动" };
  }
  return { status: "ready", statusLabel: "可使用" };
}

function normalizeAlternativeGroups(
  provider: BridgeProviderDefinition,
  entries: MobileProviderDependencyEntry[],
): MobileProviderDependencyEntry[] {
  const groups = new Map<string, number[]>();
  provider.dependencies.forEach((dependency, index) => {
    if (!dependency.alternativeGroup) return;
    const indexes = groups.get(dependency.alternativeGroup) ?? [];
    indexes.push(index);
    groups.set(dependency.alternativeGroup, indexes);
  });

  const normalized = entries.map((entry) => ({ ...entry }));
  for (const indexes of groups.values()) {
    const satisfied = indexes.some((index) =>
      normalized[index]?.status === "ready" || normalized[index]?.status === "installing"
    );
    if (!satisfied) continue;
    for (const index of indexes) {
      const entry = normalized[index];
      if (!entry || entry.status === "ready" || entry.status === "installing") continue;
      entry.required = false;
      entry.status = "optional";
      entry.statusLabel = entry.kind === "port" ? "未启动（可选）" : "未安装（可选）";
    }
  }
  return normalized;
}

async function inspectDependency(
  provider: BridgeProviderDefinition,
  dependency: BridgeProviderDependency,
  options: Required<Pick<BuildMobileProviderSettingsOptions, "platform" | "env" | "resolveCommand" | "exists" | "isPortReachable">> &
    Pick<BuildMobileProviderSettingsOptions, "installManager">,
): Promise<MobileProviderDependencyEntry> {
  const required = dependency.required !== false;
  const installState = options.installManager?.getState(provider.id, dependency.id);
  let status: MobileProviderDependencyStatus;
  let statusLabel: string;
  let detail: string | undefined;

  if (installState?.status === "installing") {
    status = "installing";
    statusLabel = "正在安装";
    detail = "安装在电脑上进行，完成后会自动重新检测。";
  } else if (installState?.status === "failed") {
    status = "failed";
    statusLabel = "安装失败";
    detail = installState.detail || dependency.hint;
  } else if (dependency.kind === "command") {
    const resolved = options.resolveCommand(dependency.name);
    if (resolved) {
      status = "ready";
      statusLabel = "已安装";
      detail = resolved;
    } else {
      status = required ? "missing" : "optional";
      statusLabel = required ? "未安装" : "未安装（可选）";
      detail = dependency.hint;
    }
  } else if (dependency.kind === "app") {
    const found = options.exists(dependency.path);
    if (found) {
      status = "ready";
      statusLabel = "已安装";
      detail = dependency.path;
    } else {
      status = required ? "missing" : "optional";
      statusLabel = required ? "未安装" : "未安装（可选）";
      detail = dependency.hint;
    }
  } else if (dependency.kind === "port") {
    let host = dependency.host ?? "127.0.0.1";
    let port = dependency.port;
    if (provider.id === "deepseek") {
      const configuredUrl = options.env.WERELAY_DEEPSEEK_HARNESS_URL?.trim();
      if (configuredUrl) {
        try {
          const url = new URL(configuredUrl);
          host = url.hostname;
          port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
        } catch {
          // The adapter reports the invalid URL when it starts; keep the default probe here.
        }
      }
    }
    const reachable = await options.isPortReachable(host, port);
    if (reachable) {
      status = "ready";
      statusLabel = "已启动";
      detail = `${host}:${port}`;
    } else {
      status = required ? "inactive" : "optional";
      statusLabel = required ? "未启动" : "未启动（可选）";
      detail = dependency.hint;
    }
  } else {
    const value = options.env[dependency.name]?.trim();
    if (value) {
      status = "ready";
      statusLabel = "已配置";
      detail = value;
    } else {
      status = required ? "missing" : "optional";
      statusLabel = required ? "未配置" : "使用默认值";
      detail = dependency.hint;
    }
  }

  return {
    id: dependency.id,
    kind: dependency.kind,
    name: dependencyName(dependency),
    label: dependencyLabel(dependency),
    required,
    status,
    statusLabel,
    hint: dependency.hint,
    ...(detail ? { detail } : {}),
    ...(dependencyAction(dependency, status)
      ? { action: dependencyAction(dependency, status) }
      : {}),
  };
}

export async function buildMobileProviderSettings(
  providers: BridgeProviderDefinition[],
  options: BuildMobileProviderSettingsOptions = {},
): Promise<MobileProviderSettingsEntry[]> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolutionEnv = buildCliEnvironment("codex", { env, platform });
  const resolvedOptions = {
    platform,
    env,
    resolveCommand: options.resolveCommand ?? ((command: string) =>
      resolveCommandPath(command, platform, resolutionEnv)),
    exists: options.exists ?? fs.existsSync,
    isPortReachable: options.isPortReachable ?? defaultPortCheck,
    installManager: options.installManager,
  };

  return await Promise.all(providers.map(async (provider) => {
    const inspectedDependencies = await Promise.all(provider.dependencies.map(
      (dependency) => inspectDependency(provider, dependency, resolvedOptions),
    ));
    const dependencies = normalizeAlternativeGroups(provider, inspectedDependencies);
    return {
      id: provider.id,
      label: provider.label,
      transport: provider.transport,
      owner: provider.sessionIntegration.owner,
      continuity: provider.sessionIntegration.continuity,
      localVisibility: provider.sessionIntegration.localVisibility,
      sessionSource: providerSessionSource(provider),
      ...providerStatus(dependencies),
      capabilities: { ...provider.capabilities },
      dependencies,
    };
  }));
}

async function defaultRunInstallCommand(
  command: string,
  args: string[],
): Promise<InstallCommandResult> {
  const env = buildCliEnvironment("codex");
  const resolved = resolveCommandPath(command, process.platform, env);
  if (!resolved) {
    throw new Error(`电脑上没有找到 ${command}，请先安装 Node.js 与 npm。`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(resolved, args, {
      env,
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const append = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-INSTALL_OUTPUT_LIMIT);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", reject);
    child.once("close", (code) => resolve({
      code: code ?? 1,
      output: output.trim(),
    }));
  });
}

export class MobileProviderInstallManager {
  private readonly states = new Map<string, MobileProviderInstallState>();
  private readonly runCommand: NonNullable<MobileProviderInstallManagerOptions["runCommand"]>;

  constructor(options: MobileProviderInstallManagerOptions = {}) {
    this.runCommand = options.runCommand ?? defaultRunInstallCommand;
  }

  getState(providerId: string, dependencyId: string): MobileProviderInstallState | undefined {
    return this.states.get(`${providerId}:${dependencyId}`);
  }

  start(providerId: string, dependencyId: string): {
    accepted: true;
    status: "installing";
    message: string;
  } {
    if (!isDaemonAdapterKind(providerId)) {
      throw new Error(`不支持安装未知终端 ${providerId}。`);
    }
    const provider = getBridgeProvider(providerId as BridgeProviderId);
    const dependency = provider.dependencies.find((candidate) => candidate.id === dependencyId);
    if (!dependency) {
      throw new Error(`不支持安装 ${providerId} 的这个组件。`);
    }
    if (!dependency.install) {
      throw new Error(`${dependencyLabel(dependency)} 不支持一键安装，请查看安装方法。`);
    }

    const key = `${provider.id}:${dependency.id}`;
    const active = this.states.get(key);
    if (active?.status === "installing") {
      return {
        accepted: true,
        status: "installing",
        message: `${provider.label} 正在安装，请稍候。`,
      };
    }

    this.states.set(key, { status: "installing" });
    void this.runCommand(dependency.install.command, [...dependency.install.args])
      .then((result) => {
        if (result.code === 0) {
          this.states.set(key, { status: "succeeded" });
          return;
        }
        this.states.set(key, {
          status: "failed",
          detail: result.output || `安装命令退出，状态码 ${result.code}。`,
        });
      })
      .catch((error) => {
        this.states.set(key, {
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      });

    return {
      accepted: true,
      status: "installing",
      message: `${provider.label} 正在安装，请稍候。`,
    };
  }
}
