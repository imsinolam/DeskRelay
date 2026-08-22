import { describe, expect, test } from "bun:test";

import {
  isOpencodeAttachCommandLine,
  isOpencodeServeCommandLine,
  isWeRelayBridgeCommandLine,
  isWeRelayDaemonCommandLine,
  isWeRelayDaemonCommandLineForCwd,
  parsePosixBridgeProcessProbeOutput,
  parseWindowsBridgeProcessProbeOutput,
} from "../../src/bridge/bridge-process-reaper.ts";

describe("bridge peer process reaper", () => {
  test("detects werelay-bridge command lines", () => {
    expect(
      isWeRelayBridgeCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter opencode --cwd C:\\Users\\example',
      ),
    ).toBe(true);
    expect(
      isWeRelayBridgeCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\dist\\bridge\\werelay-bridge.js" "--adapter" "codex"',
      ),
    ).toBe(true);
    expect(
      isWeRelayBridgeCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\companion\\local-companion-start.ts --adapter opencode',
      ),
    ).toBe(false);
  });

  test("detects werelay-daemon command lines", () => {
    expect(
      isWeRelayDaemonCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\daemon\\werelay-daemon.ts --cwd C:\\repo',
      ),
    ).toBe(true);
    expect(
      isWeRelayDaemonCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\dist\\daemon\\werelay-daemon.js"',
      ),
    ).toBe(true);
    expect(
      isWeRelayDaemonCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\bin\\werelay.mjs" --adapter codex',
      ),
    ).toBe(true);
    expect(
      isWeRelayDaemonCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter codex',
      ),
    ).toBe(false);
    expect(
      isWeRelayDaemonCommandLine(
        "/opt/homebrew/bin/node --no-warnings ./launch-daemon.mjs --cwd /Users/test/project --adapter codex --no-open",
      ),
    ).toBe(true);
  });

  test("does not mistake deployment shells that mention daemon files for daemon processes", () => {
    expect(
      isWeRelayDaemonCommandLine(
        '/bin/zsh -lc set -euo pipefail; runtime="$HOME/.werelay/runtime/WeRelay"; rsync -a dist/ "$runtime/dist/"; launchctl bootstrap gui/501 "$HOME/Library/LaunchAgents/com.example.werelay-daemon.plist"',
      ),
    ).toBe(false);
    expect(
      isWeRelayDaemonCommandLine(
        "/bin/bash -lc 'node /repo/dist/daemon/werelay-daemon.js --cwd /tmp/project'",
      ),
    ).toBe(false);
  });

  test("matches werelay-daemon command lines for a startup cwd", () => {
    expect(
      isWeRelayDaemonCommandLineForCwd(
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\bin\\werelay-daemon.mjs" "--cwd" "C:\\Users\\example"',
        "C:\\Users\\example",
      ),
    ).toBe(true);

    expect(
      isWeRelayDaemonCommandLineForCwd(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\dist\\daemon\\werelay-daemon.js --cwd=C:\\Users\\example',
        "C:\\Users\\example",
      ),
    ).toBe(true);

    expect(
      isWeRelayDaemonCommandLineForCwd(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\dist\\daemon\\werelay-daemon.js --cwd C:\\Users\\tester',
        "C:\\Users\\example",
      ),
    ).toBe(false);

    expect(
      isWeRelayDaemonCommandLineForCwd(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter codex --cwd C:\\Users\\example',
        "C:\\Users\\example",
      ),
    ).toBe(false);
  });

  test("detects opencode serve command lines", () => {
    expect(isOpencodeServeCommandLine("opencode serve --port 12345 --hostname 127.0.0.1")).toBe(true);
    expect(isOpencodeServeCommandLine("opencode.exe serve --port 12345")).toBe(true);
    expect(isOpencodeServeCommandLine("opencode.cmd serve --port 12345")).toBe(true);
    expect(isOpencodeServeCommandLine("opencode.bat serve --port 12345")).toBe(true);
    expect(isOpencodeServeCommandLine("/usr/local/bin/opencode serve --port 12345")).toBe(true);
    expect(isOpencodeServeCommandLine("opencode chat")).toBe(false);
    expect(isOpencodeServeCommandLine("node server.js --port 12345")).toBe(false);
    expect(isOpencodeServeCommandLine("")).toBe(false);
  });

  test("detects opencode attach command lines", () => {
    expect(isOpencodeAttachCommandLine("opencode attach http://127.0.0.1:12345")).toBe(true);
    expect(
      isOpencodeAttachCommandLine("opencode.exe attach http://127.0.0.1:12345 --session ses_123"),
    ).toBe(true);
    expect(
      isOpencodeAttachCommandLine("opencode.cmd attach http://127.0.0.1:12345 --session 00000001"),
    ).toBe(true);
    expect(isOpencodeAttachCommandLine("/usr/local/bin/opencode attach http://127.0.0.1:12345")).toBe(true);
    expect(isOpencodeAttachCommandLine("opencode serve --port 12345")).toBe(false);
    expect(isOpencodeAttachCommandLine("node attach.js http://127.0.0.1:12345")).toBe(false);
    expect(isOpencodeAttachCommandLine("")).toBe(false);
  });

  test("parses Windows process probe output and filters non-bridge rows", () => {
    const output = JSON.stringify([
      {
        ProcessId: 101,
        ParentProcessId: 1,
        Name: "node.exe",
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter opencode --cwd C:\\Users\\example',
      },
      {
        ProcessId: 202,
        ParentProcessId: 1,
        Name: "node.exe",
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\companion\\local-companion-start.ts --adapter opencode',
      },
      {
        ProcessId: 204,
        ParentProcessId: 1,
        Name: "node.exe",
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\dist\\bridge\\werelay-bridge.js" "--adapter" "codex"',
      },
      {
        ProcessId: 303,
        ParentProcessId: 1,
        Name: "node.exe",
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter codex --cwd C:\\repo',
      },
    ]);

    expect(parseWindowsBridgeProcessProbeOutput(output, 303)).toEqual([
      {
        pid: 101,
        parentPid: 1,
        name: "node.exe",
        commandLine:
          '"C:\\Program Files\\nodejs\\node.exe" --no-warnings --experimental-strip-types C:\\repo\\src\\bridge\\werelay-bridge.ts --adapter opencode --cwd C:\\Users\\example',
      },
      {
        pid: 204,
        parentPid: 1,
        name: "node.exe",
        commandLine:
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\werelay\\dist\\bridge\\werelay-bridge.js" "--adapter" "codex"',
      },
    ]);
  });

  test("parses POSIX process probe output and ignores the current pid", () => {
    const output = [
      '101 node --no-warnings --experimental-strip-types /repo/src/bridge/werelay-bridge.ts --adapter opencode --cwd /tmp/work',
      '202 node --no-warnings --experimental-strip-types /repo/src/companion/local-companion-start.ts --adapter opencode',
      '303 node --no-warnings --experimental-strip-types /repo/src/bridge/werelay-bridge.ts --adapter codex --cwd /repo',
    ].join("\n");

    expect(parsePosixBridgeProcessProbeOutput(output, 303)).toEqual([
      {
        pid: 101,
        commandLine:
          'node --no-warnings --experimental-strip-types /repo/src/bridge/werelay-bridge.ts --adapter opencode --cwd /tmp/work',
      },
    ]);
  });
});
