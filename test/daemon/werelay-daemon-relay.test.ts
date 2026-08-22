import { describe, expect, test } from "bun:test";

import {
  resolveDaemonRelayConfig,
} from "../../src/daemon/werelay-daemon.ts";

describe("WeRelay daemon relay configuration", () => {
  test("enables the application relay only when the device token is configured", () => {
    expect(resolveDaemonRelayConfig({
      WERELAY_RELAY_URL: "https://relay.example.com",
      WERELAY_RELAY_DEVICE_ID: "example-device",
      WERELAY_RELAY_DEVICE_TOKEN: "device-secret",
    })).toEqual({
      relayUrl: "https://relay.example.com",
      deviceId: "example-device",
      deviceToken: "device-secret",
    });

    expect(resolveDaemonRelayConfig({
      WERELAY_RELAY_URL: "https://relay.example.com",
    })).toBeNull();
    expect(resolveDaemonRelayConfig({})).toBeNull();
  });

  test("uses a stable default device identifier", () => {
    expect(resolveDaemonRelayConfig({
      WERELAY_RELAY_URL: "https://relay.example.com",
      WERELAY_RELAY_DEVICE_TOKEN: "device-secret",
    })?.deviceId).toBe("default");
  });
});
