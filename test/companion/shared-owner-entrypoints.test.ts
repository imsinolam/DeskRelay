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
    test(`werelay-${adapter} launches the visible shared owner`, () => {
      const source = readRepoFile(`bin/werelay-${adapter}.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/companion/local-companion.js", ["--adapter", "${adapter}"])`,
      );
    });

    test(`werelay-${adapter}-start keeps the bridge bootstrap flow`, () => {
      const source = readRepoFile(`bin/werelay-${adapter}-start.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/companion/local-companion-start.js", ["--adapter", "${adapter}"])`,
      );
    });

    test(`werelay-bridge-${adapter} stays bridge-only`, () => {
      const source = readRepoFile(`bin/werelay-bridge-${adapter}.mjs`);
      expect(source).toContain(
        `runJsEntry("dist/bridge/werelay-bridge.js", ["--adapter", "${adapter}"])`,
      );
    });
  }

  test("package metadata publishes every shared-owner command and development script", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    for (const adapter of adapters) {
      expect(packageJson.bin?.[`werelay-${adapter}`]).toBe(`bin/werelay-${adapter}.mjs`);
      expect(packageJson.bin?.[`werelay-${adapter}-start`])
        .toBe(`bin/werelay-${adapter}-start.mjs`);
      expect(packageJson.bin?.[`werelay-bridge-${adapter}`])
        .toBe(`bin/werelay-bridge-${adapter}.mjs`);
      expect(packageJson.scripts?.[`${adapter}:companion`])
        .toContain(`src/companion/local-companion.ts --adapter ${adapter}`);
      expect(packageJson.scripts?.[`${adapter}:start`])
        .toContain(`src/companion/local-companion-start.ts --adapter ${adapter}`);
      expect(packageJson.scripts?.[`bridge:${adapter}`])
        .toContain(`src/bridge/werelay-bridge.ts --adapter ${adapter}`);
    }
  });
});
