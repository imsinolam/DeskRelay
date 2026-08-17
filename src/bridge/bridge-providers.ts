export const BRIDGE_PROVIDER_IDS = [
  "codex",
  "claude",
  "tclaude",
  "grok",
  "codebuddy",
  "reasonix",
  "workbuddy",
  "deepseek",
  "opencode",
  "shell",
] as const;

export type BridgeProviderId = typeof BRIDGE_PROVIDER_IDS[number];

export const IMPLEMENTED_BRIDGE_ADAPTER_IDS = [
  "codex",
  "claude",
  "tclaude",
  "grok",
  "codebuddy",
  "reasonix",
  "workbuddy",
  "deepseek",
  "opencode",
  "shell",
] as const satisfies readonly BridgeProviderId[];

export type BridgeAdapterKind = typeof IMPLEMENTED_BRIDGE_ADAPTER_IDS[number];
export type DaemonAdapterKind = Exclude<BridgeAdapterKind, "shell">;

export type BridgeProviderTransport =
  | "codex_desktop"
  | "claude_cli"
  | "shared_service"
  | "desktop_app"
  | "harness_host"
  | "opencode_server"
  | "shell";

export type BridgeSessionOwnerMode =
  | "desktop_owner"
  | "visible_cli_owner"
  | "shared_service_owner"
  | "none";

export type BridgeSessionContinuity =
  | "same_owner"
  | "none";

export type BridgeLocalVisibility = "live" | "reload" | "none";

export type BridgeProviderSessionIntegration = {
  owner: BridgeSessionOwnerMode;
  continuity: BridgeSessionContinuity;
  localVisibility: BridgeLocalVisibility;
};

export type BridgeProviderCapabilities = {
  sessions: boolean;
  messages: boolean;
  images: boolean;
  queue: boolean;
  approvals: boolean;
  stop: boolean;
  nativeCommands: boolean;
};

/**
 * Declarative dependency graph for a provider (DSH-inspired "coeffects").
 * The runtime and `deskrelay doctor` use this to determine whether a
 * provider's prerequisites are satisfied, and what to tell the user when
 * they are not. A missing dependency must never be silently treated as
 * "online"; it drives the visible unavailable state instead.
 */
export type BridgeProviderDependency =
  | {
      kind: "command";
      name: string;
      hint: string;
      /** Set when a full install command is known and safe to print. */
      installHint?: string;
    }
  | {
      kind: "port";
      port: number;
      host?: string;
      hint: string;
    }
  | {
      kind: "app";
      path: string;
      hint: string;
    }
  | {
      kind: "env";
      name: string;
      hint: string;
    };

export type BridgeProviderDefinition = {
  id: BridgeProviderId;
  label: string;
  command: string;
  transport: BridgeProviderTransport;
  daemon: boolean;
  capabilities: BridgeProviderCapabilities;
  sessionIntegration: BridgeProviderSessionIntegration;
  /**
   * Declarative prerequisites. Order matters for doctor output: earlier
   * entries are checked first.
   */
  dependencies: BridgeProviderDependency[];
};

const BASE_CLI_CAPABILITIES: BridgeProviderCapabilities = {
  sessions: true,
  messages: true,
  images: false,
  queue: false,
  approvals: true,
  stop: true,
  nativeCommands: true,
};

export const BRIDGE_PROVIDERS: Record<BridgeProviderId, BridgeProviderDefinition> = {
  codex: {
    id: "codex",
    label: "Codex",
    command: "codex",
    transport: "codex_desktop",
    daemon: true,
    capabilities: {
      sessions: true,
      messages: true,
      images: true,
      queue: true,
      approvals: true,
      stop: true,
      nativeCommands: false,
    },
    sessionIntegration: {
      owner: "desktop_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "codex", hint: "未找到 codex 命令。请先安装 Codex CLI 并登录。" },
      { kind: "app", path: "/Applications/Codex.app", hint: "macOS Codex 桌面应用未安装；CLI 模式可用 codex 命令。" },
    ],
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    transport: "claude_cli",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "visible_cli_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "claude", hint: "未找到 claude 命令。请安装 Claude Code 并完成登录。" },
      { kind: "command", name: "tclaude", hint: "未找到 tclaude 命令；如使用 TClaude 请单独安装。" },
    ],
  },
  tclaude: {
    id: "tclaude",
    label: "TClaude",
    command: "tclaude",
    transport: "claude_cli",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "visible_cli_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "tclaude", hint: "未找到 tclaude 命令。TClaude 按组织内部方式安装并登录。" },
    ],
  },
  grok: {
    id: "grok",
    label: "Grok CLI",
    command: "grok",
    transport: "shared_service",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "shared_service_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "grok", hint: "未找到 grok 命令。请按供应方方式安装 Grok CLI 并登录。" },
    ],
  },
  codebuddy: {
    id: "codebuddy",
    label: "CodeBuddy",
    command: "codebuddy",
    transport: "shared_service",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "shared_service_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "codebuddy", hint: "未找到 codebuddy 命令。请按供应方方式安装 CodeBuddy 并登录。" },
    ],
  },
  reasonix: {
    id: "reasonix",
    label: "reasonix",
    command: "reasonix",
    transport: "shared_service",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "shared_service_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "command", name: "reasonix", hint: "未找到 reasonix 命令。请按供应方方式安装 reasonix 并登录。" },
    ],
  },
  workbuddy: {
    id: "workbuddy",
    label: "WorkBuddy",
    command: "workbuddy",
    transport: "desktop_app",
    daemon: true,
    capabilities: {
      sessions: true,
      messages: true,
      images: true,
      queue: false,
      approvals: true,
      stop: true,
      nativeCommands: false,
    },
    sessionIntegration: {
      owner: "desktop_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      { kind: "app", path: "/Applications/WorkBuddy.app", hint: "macOS 未安装 WorkBuddy Desktop。请安装应用并至少创建一个任务。" },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek Harness",
    command: "dsh",
    transport: "harness_host",
    daemon: true,
    capabilities: {
      sessions: true,
      messages: true,
      images: true,
      queue: true,
      approvals: true,
      stop: true,
      nativeCommands: true,
    },
    sessionIntegration: {
      owner: "shared_service_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      {
        kind: "command",
        name: "dsh",
        hint: "未找到 dsh 命令。请安装 DeepSeek Harness 并运行 dsh web。",
        installHint: "npm install -g @deepseek-ai/dsh",
      },
      {
        kind: "port",
        port: 3080,
        host: "127.0.0.1",
        hint: "本机 3080 端口没有 Harness Host 监听。请保持 dsh web 进程运行；可用 DESKRELAY_DEEPSEEK_HARNESS_URL 指定其他回环地址。",
      },
      {
        kind: "env",
        name: "DESKRELAY_DEEPSEEK_HARNESS_URL",
        hint: "可选：默认 http://127.0.0.1:3080，只接受本机回环地址。",
      },
    ],
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    transport: "opencode_server",
    daemon: true,
    capabilities: BASE_CLI_CAPABILITIES,
    sessionIntegration: {
      owner: "shared_service_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
    dependencies: [
      {
        kind: "command",
        name: "opencode",
        hint: "未找到 opencode 命令。请安装 opencode-ai 并完成模型配置。",
        installHint: "npm install -g opencode-ai",
      },
    ],
  },
  shell: {
    id: "shell",
    label: "Shell",
    command: "shell",
    transport: "shell",
    daemon: false,
    capabilities: {
      sessions: false,
      messages: false,
      images: false,
      queue: false,
      approvals: true,
      stop: true,
      nativeCommands: false,
    },
    sessionIntegration: {
      owner: "none",
      continuity: "none",
      localVisibility: "none",
    },
    dependencies: [],
  },
};

export const DAEMON_PROVIDER_IDS = IMPLEMENTED_BRIDGE_ADAPTER_IDS.filter(
  (id): id is DaemonAdapterKind => BRIDGE_PROVIDERS[id].daemon,
);

export function providerRequiresVisibleClient(kind: BridgeProviderId): boolean {
  const owner = getBridgeProvider(kind).sessionIntegration.owner;
  return owner === "visible_cli_owner" || owner === "shared_service_owner";
}

export function providerUsesDesktopOwner(kind: BridgeProviderId): boolean {
  return getBridgeProvider(kind).sessionIntegration.owner === "desktop_owner";
}

export function isBridgeAdapterKind(value: unknown): value is BridgeAdapterKind {
  return typeof value === "string" &&
    (IMPLEMENTED_BRIDGE_ADAPTER_IDS as readonly string[]).includes(value);
}

export function isDaemonAdapterKind(value: unknown): value is DaemonAdapterKind {
  return isBridgeAdapterKind(value) && BRIDGE_PROVIDERS[value].daemon;
}

export function isClaudeProviderKind(
  value: BridgeAdapterKind,
): value is "claude" | "tclaude" {
  return BRIDGE_PROVIDERS[value].transport === "claude_cli";
}

export function getBridgeProvider(
  kind: BridgeProviderId,
): BridgeProviderDefinition {
  return BRIDGE_PROVIDERS[kind];
}

export function listDaemonProviders(): BridgeProviderDefinition[] {
  return DAEMON_PROVIDER_IDS.map((id) => BRIDGE_PROVIDERS[id]);
}

/** True when a provider uses the running harness host (e.g. `dsh web`). */
export function providerUsesHarnessHost(kind: BridgeProviderId): boolean {
  return BRIDGE_PROVIDERS[kind].transport === "harness_host";
}
