import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

type SharedOwnerAdapter = "grok" | "codebuddy" | "reasonix";

const adapters: SharedOwnerAdapter[] = ["grok", "codebuddy", "reasonix"];

describe("shared-owner CLI entrypoints", () => {
  for (const adapter of adapters) {
    test(`deskrelay-${adapter} launches the visible shared owner`, () => {
      const source = readRepoFile(`bin/deskrelay-${adapter}.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/companion/local-companion.js", ["--adapter", "${adapter}"])`,
      );
    });

    test(`deskrelay-${adapter}-start keeps the bridge bootstrap flow`, () => {
      const source = readRepoFile(`bin/deskrelay-${adapter}-start.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/companion/local-companion-start.js", ["--adapter", "${adapter}"])`,
      );
    });

    test(`deskrelay-bridge-${adapter} stays bridge-only`, () => {
      const source = readRepoFile(`bin/deskrelay-bridge-${adapter}.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/bridge/deskrelay-bridge.js", ["--adapter", "${adapter}"])`,
      );
    });
  }

  test("package metadata publishes every shared-owner command and development script", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    for (const adapter of adapters) {
      expect(packageJson.bin?.[`deskrelay-${adapter}`]).toBe(`bin/deskrelay-${adapter}.mjs`);
      expect(packageJson.bin?.[`deskrelay-${adapter}-start`])
        .toBe(`bin/deskrelay-${adapter}-start.mjs`);
      expect(packageJson.bin?.[`deskrelay-bridge-${adapter}`])
        .toBe(`bin/deskrelay-bridge-${adapter}.mjs`);
      expect(packageJson.scripts?.[`${adapter}:companion`])
        .toContain(`src/companion/local-companion.ts --adapter ${adapter}`);
      expect(packageJson.scripts?.[`${adapter}:start`])
        .toContain(`src/companion/local-companion-start.ts --adapter ${adapter}`);
      expect(packageJson.scripts?.[`bridge:${adapter}`])
        .toContain(`src/bridge/deskrelay-bridge.ts --adapter ${adapter}`);
    }
  });
});
