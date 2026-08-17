import { describe, expect, test } from "bun:test";

import { getBridgeProvider } from "../../src/bridge/bridge-providers.ts";
import {
  buildMobileProviderSettings,
  MobileProviderInstallManager,
} from "../../src/daemon/mobile-provider-settings.ts";

describe("mobile provider settings", () => {
  test("reports an installed command without showing its missing hint", async () => {
    const [provider] = await buildMobileProviderSettings(
      [getBridgeProvider("opencode")],
      {
        resolveCommand: (command) => command === "opencode"
          ? "/Users/example/.opencode/bin/opencode"
          : undefined,
      },
    );

    expect(provider).toMatchObject({
      id: "opencode",
      status: "ready",
      statusLabel: "可使用",
    });
    expect(provider.dependencies[0]).toMatchObject({
      id: "opencode-cli",
      status: "ready",
      statusLabel: "已安装",
      detail: "/Users/example/.opencode/bin/opencode",
    });
    expect(provider.dependencies[0].detail).not.toContain("未找到");
  });

  test("does not mark a provider unavailable when only an optional dependency is absent", async () => {
    const [provider] = await buildMobileProviderSettings(
      [getBridgeProvider("codex")],
      {
        platform: "darwin",
        resolveCommand: () => "/opt/homebrew/bin/codex",
        exists: () => false,
      },
    );

    expect(provider.status).toBe("ready");
    expect(provider.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "codex-desktop",
        required: false,
        status: "optional",
        statusLabel: "未安装（可选）",
      }),
    ]));
  });

  test("treats Codex Desktop and Codex CLI as alternative ways to use Codex", async () => {
    const [provider] = await buildMobileProviderSettings(
      [getBridgeProvider("codex")],
      {
        platform: "darwin",
        resolveCommand: () => undefined,
        exists: (filePath) => filePath === "/Applications/Codex.app",
      },
    );

    expect(provider.status).toBe("ready");
    expect(provider.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "codex-cli",
        required: false,
        status: "optional",
        statusLabel: "未安装（可选）",
      }),
      expect.objectContaining({
        id: "codex-desktop",
        required: true,
        status: "ready",
      }),
    ]));
  });

  test("distinguishes installed-but-not-running services from missing software", async () => {
    const [provider] = await buildMobileProviderSettings(
      [getBridgeProvider("deepseek")],
      {
        resolveCommand: () => "/usr/local/bin/dsh",
        isPortReachable: async () => false,
        env: {},
      },
    );

    expect(provider.status).toBe("needs_setup");
    expect(provider.statusLabel).toBe("需要启动");
    expect(provider.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "deepseek-host",
        status: "inactive",
        statusLabel: "未启动",
      }),
      expect.objectContaining({
        id: "deepseek-url",
        required: false,
        status: "optional",
      }),
    ]));
  });

  test("runs only registry-defined installation commands", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let release: ((result: { code: number; output: string }) => void) | undefined;
    const manager = new MobileProviderInstallManager({
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return await new Promise((resolve) => { release = resolve; });
      },
    });

    expect(manager.start("opencode", "opencode-cli")).toEqual({
      accepted: true,
      status: "installing",
      message: "OpenCode 正在安装，请稍候。",
    });
    expect(calls).toEqual([{ command: "npm", args: ["install", "-g", "opencode-ai"] }]);
    expect(manager.getState("opencode", "opencode-cli")).toMatchObject({ status: "installing" });
    expect(() => manager.start("opencode", "anything-else")).toThrow("不支持安装");
    expect(() => manager.start("workbuddy", "workbuddy-desktop")).toThrow("不支持一键安装");

    release?.({ code: 0, output: "installed" });
    await Bun.sleep(0);
    expect(manager.getState("opencode", "opencode-cli")).toMatchObject({ status: "succeeded" });
  });
});
