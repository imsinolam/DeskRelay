import { describe, expect, test } from "bun:test";

import {
  DAEMON_PROVIDER_IDS,
  getBridgeProvider,
  isBridgeAdapterKind,
  isClaudeProviderKind,
  isDaemonAdapterKind,
} from "../../src/bridge/bridge-providers.ts";
import { createBridgeAdapter } from "../../src/bridge/bridge-adapters.ts";
import { LocalCompanionProxyAdapter } from "../../src/bridge/bridge-adapters.core.ts";
import { resolveDefaultAdapterCommand } from "../../src/bridge/bridge-adapters.shared.ts";

describe("bridge provider registry", () => {
  test("exposes implemented shared-owner and WorkBuddy Desktop providers", () => {
    expect(getBridgeProvider("grok")).toMatchObject({
      transport: "shared_service",
      sessionIntegration: {
        owner: "shared_service_owner",
        continuity: "same_owner",
        localVisibility: "live",
      },
    });
    expect(getBridgeProvider("workbuddy").transport).toBe("desktop_app");
    expect(getBridgeProvider("codebuddy")).toMatchObject({
      transport: "shared_service",
      sessionIntegration: {
        owner: "shared_service_owner",
        continuity: "same_owner",
        localVisibility: "live",
      },
    });
    expect(isBridgeAdapterKind("grok")).toBe(true);
    expect(isBridgeAdapterKind("codebuddy")).toBe(true);
    expect(isBridgeAdapterKind("reasonix")).toBe(true);
    expect(isDaemonAdapterKind("grok")).toBe(true);
    expect(isDaemonAdapterKind("codebuddy")).toBe(true);
    expect(isDaemonAdapterKind("reasonix")).toBe(true);
    expect(isBridgeAdapterKind("workbuddy")).toBe(true);
    expect(isBridgeAdapterKind("deepseek")).toBe(true);
    expect(isDaemonAdapterKind("workbuddy")).toBe(true);
    expect(DAEMON_PROVIDER_IDS).toContain("workbuddy");
    expect(DAEMON_PROVIDER_IDS).toContain("reasonix");
    expect(DAEMON_PROVIDER_IDS).toContain("deepseek");
    expect(getBridgeProvider("deepseek")).toMatchObject({
      label: "DeepSeek Harness",
      command: "dsh",
      transport: "harness_host",
      sessionIntegration: {
        owner: "desktop_owner",
        continuity: "same_owner",
        localVisibility: "live",
      },
    });
    expect(getBridgeProvider("reasonix")).toMatchObject({
      label: "reasonix",
      command: "reasonix",
      transport: "shared_service",
      sessionIntegration: {
        owner: "shared_service_owner",
        continuity: "same_owner",
        localVisibility: "live",
      },
    });
    expect(resolveDefaultAdapterCommand("reasonix")).toBe("reasonix");
    expect(resolveDefaultAdapterCommand("deepseek")).toBe("dsh");
  });

  test("treats TClaude as an implemented Claude-compatible daemon provider", () => {
    expect(getBridgeProvider("claude")).toMatchObject({
      label: "Claude Code",
      capabilities: {
        nativeCommands: true,
      },
    });
    expect(isBridgeAdapterKind("tclaude")).toBe(true);
    expect(isDaemonAdapterKind("tclaude")).toBe(true);
    expect(isClaudeProviderKind("tclaude")).toBe(true);
    expect(DAEMON_PROVIDER_IDS).toContain("tclaude");
    expect(resolveDefaultAdapterCommand("tclaude")).toBe("tclaude");
    expect(getBridgeProvider("tclaude").capabilities.nativeCommands).toBe(true);
  });

  test("never starts a second hidden owner for same-owner terminal providers", () => {
    for (const kind of [
      "claude",
      "tclaude",
      "grok",
      "codebuddy",
      "reasonix",
      "opencode",
    ] as const) {
      expect(createBridgeAdapter({
        kind,
        command: getBridgeProvider(kind).command,
        cwd: "/tmp/deskrelay-owner-contract",
      })).toBeInstanceOf(LocalCompanionProxyAdapter);
      expect(getBridgeProvider(kind).sessionIntegration).toMatchObject({
        continuity: "same_owner",
        localVisibility: "live",
      });
    }
  });
});
