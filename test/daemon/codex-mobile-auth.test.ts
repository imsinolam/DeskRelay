import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexMobileAuthStore } from "../../src/daemon/codex-mobile-auth.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createStore(nowMs = 1_780_000_000_000): {
  store: CodexMobileAuthStore;
  stateFile: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-auth-"));
  tempDirs.push(dir);
  const stateFile = path.join(dir, "auth.json");
  return {
    store: new CodexMobileAuthStore({ stateFile, now: () => nowMs }),
    stateFile,
  };
}

describe("Codex mobile password auth", () => {
  test("starts unconfigured and stores only a salted password hash", () => {
    const { store, stateFile } = createStore();

    expect(store.isConfigured()).toBe(false);
    expect(() => store.setPassword("short")).toThrow("密码至少需要 8 个字符");

    store.setPassword("correct horse battery staple");

    expect(store.isConfigured()).toBe(true);
    expect(store.verifyPassword("correct horse battery staple")).toBe(true);
    expect(store.verifyPassword("wrong password")).toBe(false);
    const persisted = fs.readFileSync(stateFile, "utf8");
    expect(persisted).not.toContain("correct horse battery staple");
    expect(JSON.parse(persisted)).toMatchObject({ version: 1 });
    expect((fs.statSync(stateFile).mode & 0o777)).toBe(0o600);
  });

  test("creates restart-safe signed sessions and rejects expired sessions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-auth-"));
    tempDirs.push(dir);
    const stateFile = path.join(dir, "auth.json");
    let nowMs = 1_780_000_000_000;
    const store = new CodexMobileAuthStore({
      stateFile,
      now: () => nowMs,
      sessionTtlMs: 60_000,
    });
    store.setPassword("a secure password");

    const token = store.createSessionToken();
    expect(store.verifySessionToken(token)).toBe(true);

    const restarted = new CodexMobileAuthStore({
      stateFile,
      now: () => nowMs,
      sessionTtlMs: 60_000,
    });
    expect(restarted.verifySessionToken(token)).toBe(true);

    nowMs += 60_001;
    expect(restarted.verifySessionToken(token)).toBe(false);
  });

  test("changing the password invalidates all existing sessions", () => {
    const { store } = createStore();
    store.setPassword("first secure password");
    const token = store.createSessionToken();
    expect(store.verifySessionToken(token)).toBe(true);

    store.setPassword("second secure password");

    expect(store.verifyPassword("first secure password")).toBe(false);
    expect(store.verifyPassword("second secure password")).toBe(true);
    expect(store.verifySessionToken(token)).toBe(false);
  });
});
