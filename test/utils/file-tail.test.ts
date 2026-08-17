import { describe, expect, test } from "bun:test";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readFileTail, scanFileTail } from "../../src/utils/file-tail.ts";

function writeTempFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-file-tail-"));
  const file = path.join(dir, "session.log");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("file-tail primitive", () => {
  test("reads the bounded tail of a small file in order", () => {
    const file = writeTempFile("line1\nline2\nline3\n");
    const lines = readFileTail(file, { scanLimitBytes: 1024 * 1024 });
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  test("keeps only the newest lines when the file exceeds the scan limit", () => {
    const rows = Array.from({ length: 2000 }, (_, index) => `row-${index}`);
    const file = writeTempFile(rows.join("\n") + "\n");
    const lines = readFileTail(file, { scanLimitBytes: 256 });
    expect(lines).not.toBeNull();
    expect((lines ?? []).length).toBeGreaterThan(0);
    expect((lines ?? []).length).toBeLessThan(rows.length);
    // The newest line must always be present.
    expect((lines ?? []).at(-1)).toBe("row-1999");
  });

  test("reports null for a missing file", () => {
    expect(readFileTail("/nonexistent/deskrelay-tail.log", { scanLimitBytes: 1024 })).toBeNull();
  });

  test("delivers line flags for first and last scanned lines", () => {
    const file = writeTempFile("a\nb\nc\n");
    const flags: Array<{ text: string; isFirst: boolean; isLast: boolean }> = [];
    const count = scanFileTail(file, { scanLimitBytes: 1024 * 1024 }, (line) => {
      flags.push({ text: line.text, isFirst: line.isFirst, isLast: line.isLast });
    });
    expect(count).toBe(3);
    expect(flags.map((flag) => flag.text)).toEqual(["a", "b", "c"]);
    expect(flags[0]?.isFirst).toBe(true);
    expect(flags[0]?.isLast).toBe(false);
    expect(flags[2]?.isLast).toBe(true);
  });

  test("handles a file without a trailing newline", () => {
    const file = writeTempFile("alpha\nbeta");
    const lines = readFileTail(file, { scanLimitBytes: 1024 * 1024 });
    expect(lines).toEqual(["alpha", "beta"]);
  });

  test("returns zero lines for an empty file", () => {
    const file = writeTempFile("");
    expect(readFileTail(file, { scanLimitBytes: 1024 * 1024 })).toEqual([]);
  });
});
