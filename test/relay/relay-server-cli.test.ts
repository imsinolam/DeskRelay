import { describe, expect, test } from "bun:test";

import {
  parseRelayServerCliOptions,
} from "../../src/relay/relay-server-cli.ts";

describe("DeskRelay relay server CLI", () => {
  test("reads deployment settings without putting the device token in process arguments", () => {
    expect(parseRelayServerCliOptions(
      ["--host", "0.0.0.0", "--port", "14396", "--device-id", "example-device"],
      { DESKRELAY_RELAY_DEVICE_TOKEN: "server-secret" },
    )).toEqual({
      host: "0.0.0.0",
      port: 14396,
      deviceId: "example-device",
      deviceToken: "server-secret",
    });
  });

  test("requires a device token", () => {
    expect(() => parseRelayServerCliOptions([], {})).toThrow(
      "缺少 DESKRELAY_RELAY_DEVICE_TOKEN",
    );
  });
});
