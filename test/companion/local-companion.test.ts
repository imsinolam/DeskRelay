import { describe, expect, test } from "bun:test";

import {
  isDirectRunModule,
  LOCAL_COMPANION_RECONNECT_RETRY_MS,
  shouldReconnectLocalCompanion,
} from "../../src/companion/local-companion.ts";

describe("local companion reconnect policy", () => {
  test("reconnects only for unexpected bridge disconnects", () => {
    expect(
      shouldReconnectLocalCompanion({
        shuttingDown: false,
        closeReason: null,
      }),
    ).toBe(true);

    expect(
      shouldReconnectLocalCompanion({
        shuttingDown: true,
        closeReason: null,
      }),
    ).toBe(false);

    expect(
      shouldReconnectLocalCompanion({
        shuttingDown: false,
        closeReason: "worker_exit",
      }),
    ).toBe(false);
  });

  test("keeps reconnect retries short for the grace window loop", () => {
    expect(LOCAL_COMPANION_RECONNECT_RETRY_MS).toBe(250);
  });

  test("recognizes direct Node execution even when import.meta.main is unavailable", () => {
    expect(isDirectRunModule(
      "file:///tmp/DeskRelay/dist/companion/local-companion.js",
      "/tmp/DeskRelay/dist/companion/local-companion.js",
      false,
    )).toBe(true);
    expect(isDirectRunModule(
      "file:///tmp/DeskRelay/dist/companion/local-companion.js",
      "/tmp/DeskRelay/test/companion/local-companion.test.js",
      false,
    )).toBe(false);
    expect(isDirectRunModule("file:///tmp/module.js", undefined, true)).toBe(true);
  });
});
