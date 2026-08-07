import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const TEST_ROOT = path.join(REPO_ROOT, "test");
const THIS_FILE = path.resolve(import.meta.path);

function listTestSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTestSources(absolutePath);
    }
    return entry.isFile() && /\.test\.[cm]?[jt]sx?$/.test(entry.name)
      ? [absolutePath]
      : [];
  });
}

describe("test suite process safety", () => {
  test("ordinary tests never launch real macOS GUI jobs", () => {
    const forbiddenPatterns = [
      { name: "launchctl submit", pattern: /launchctl\s+submit/ },
      {
        name: "child process opening a real macOS application",
        pattern:
          /(?:spawn|execFile|execFileSync|execSync|Bun\.spawn)\s*\(\s*["'`]\/usr\/bin\/open["'`]/,
      },
    ];
    const offenders: string[] = [];

    for (const sourceFile of listTestSources(TEST_ROOT)) {
      if (path.resolve(sourceFile) === THIS_FILE) {
        continue;
      }
      const source = fs.readFileSync(sourceFile, "utf8");
      for (const forbidden of forbiddenPatterns) {
        if (forbidden.pattern.test(source)) {
          offenders.push(
            `${path.relative(REPO_ROOT, sourceFile)}: ${forbidden.name}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
