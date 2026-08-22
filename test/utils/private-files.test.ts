import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  appendPrivateFile,
  ensurePrivateDir,
  repairPrivateTreePermissions,
  writePrivateFileAtomic,
} from "../../src/utils/private-files.ts";

const roots: string[] = [];

function makeTempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "werelay-private-files-"));
  roots.push(root);
  return root;
}

function mode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

const posixTest = process.platform === "win32" ? test.skip : test;

describe("private runtime filesystem helpers", () => {
  posixTest("creates and repairs private directories", () => {
    const root = makeTempDir();
    const nested = path.join(root, "workspaces", "example");

    fs.mkdirSync(nested, { recursive: true, mode: 0o755 });
    fs.chmodSync(root, 0o755);
    fs.chmodSync(path.join(root, "workspaces"), 0o755);
    fs.chmodSync(nested, 0o755);

    ensurePrivateDir(nested);

    expect(mode(nested)).toBe(PRIVATE_DIR_MODE);
  });

  posixTest("writes atomic private files and keeps appends private", () => {
    const root = makeTempDir();
    const filePath = path.join(root, "workspaces", "example", "daemon-state.json");

    writePrivateFileAtomic(filePath, "first");
    expect(fs.readFileSync(filePath, "utf8")).toBe("first");
    expect(mode(path.dirname(filePath))).toBe(PRIVATE_DIR_MODE);
    expect(mode(filePath)).toBe(PRIVATE_FILE_MODE);

    fs.chmodSync(filePath, 0o644);
    appendPrivateFile(filePath, "\nsecond");
    expect(fs.readFileSync(filePath, "utf8")).toBe("first\nsecond");
    expect(mode(filePath)).toBe(PRIVATE_FILE_MODE);
    expect(
      fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes(".tmp")),
    ).toEqual([]);
  });

  posixTest("repairs an existing runtime tree without following symlinks", () => {
    const root = makeTempDir();
    const workspace = path.join(root, "workspaces", "example");
    const attachments = path.join(root, "inbound-attachments", "2026-08-08");
    const stateFile = path.join(workspace, "daemon-state.json");
    const attachmentFile = path.join(attachments, "photo.png");
    const launcherFile = path.join(root, "start-daemon.zsh");
    const outside = path.join(os.tmpdir(), `werelay-outside-${process.pid}-${Date.now()}`);

    fs.mkdirSync(workspace, { recursive: true, mode: 0o755 });
    fs.mkdirSync(attachments, { recursive: true, mode: 0o755 });
    fs.writeFileSync(stateFile, "state", { mode: 0o644 });
    fs.writeFileSync(attachmentFile, "image", { mode: 0o644 });
    fs.writeFileSync(launcherFile, "#!/bin/zsh\n", { mode: 0o755 });
    fs.writeFileSync(outside, "outside", { mode: 0o644 });
    fs.chmodSync(outside, 0o644);
    fs.symlinkSync(outside, path.join(root, "outside-link"));
    fs.chmodSync(root, 0o755);

    try {
      repairPrivateTreePermissions(root);

      expect(mode(root)).toBe(PRIVATE_DIR_MODE);
      expect(mode(workspace)).toBe(PRIVATE_DIR_MODE);
      expect(mode(attachments)).toBe(PRIVATE_DIR_MODE);
      expect(mode(stateFile)).toBe(PRIVATE_FILE_MODE);
      expect(mode(attachmentFile)).toBe(PRIVATE_FILE_MODE);
      expect(mode(launcherFile)).toBe(0o700);
      expect(mode(outside)).toBe(0o644);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
