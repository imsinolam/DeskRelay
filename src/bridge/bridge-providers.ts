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

export type BridgeProviderDefinition = {
  id: BridgeProviderId;
  label: string;
  command: string;
  transport: BridgeProviderTransport;
  daemon: boolean;
  capabilities: BridgeProviderCapabilities;
  sessionIntegration: BridgeProviderSessionIntegration;
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
      owner: "desktop_owner",
      continuity: "same_owner",
      localVisibility: "live",
    },
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
