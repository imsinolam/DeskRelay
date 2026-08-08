import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dir, "..", "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("package quality scripts", () => {
  test("prepack typechecks source before building the npm package", () => {
    expect(packageJson.scripts?.prepack).toBe(
      "npm run typecheck:src && npm run build",
    );
  });
});
