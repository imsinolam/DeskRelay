import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("package quality scripts", () => {
  test("ships the server-only GitHub publishing entrypoint", () => {
    expect(packageJson.files).toContain("scripts/publish-github-via-server.mjs");
    expect(packageJson.scripts["github:publish:server"]).toBe(
      "node scripts/publish-github-via-server.mjs",
    );
  });

  test("prepack typechecks source before building the npm package", () => {
    expect(packageJson.scripts?.prepack).toBe(
      "npm run typecheck:src && npm run build",
    );
  });

  test("ships the DeepSeek Harness bridge entrypoints", () => {
    expect(packageJson.scripts?.["bridge:deepseek"]).toBe(
      "node --no-warnings --experimental-strip-types src/bridge/deskrelay-bridge.ts --adapter deepseek",
    );
    const bin = (packageJson as { bin?: Record<string, string> }).bin;
    expect(bin?.["deskrelay-bridge-deepseek"]).toBe(
      "bin/deskrelay-bridge-deepseek.mjs",
    );
  });

  test("gives the hardened relay service a writable private task-link state directory", () => {
    const service = fs.readFileSync(
      path.resolve(import.meta.dir, "..", "deploy/systemd/deskrelay-relay.service.example"),
      "utf8",
    );
    const environment = fs.readFileSync(
      path.resolve(import.meta.dir, "..", "deploy/systemd/deskrelay-relay.env.example"),
      "utf8",
    );
    expect(service).toContain("StateDirectory=deskrelay");
    expect(service).toContain("StateDirectoryMode=0700");
    expect(environment).toContain(
      "DESKRELAY_RELAY_TASK_LINK_STATE_FILE=/var/lib/deskrelay/relay-task-links.json",
    );
  });
});
