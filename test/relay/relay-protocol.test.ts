import { describe, expect, test } from "bun:test";

import {
  isDeskRelayRelayApiRequest,
  normalizeDeskRelayRelayBaseUrl,
  timingSafeRelayTokenEqual,
} from "../../src/relay/relay-protocol.ts";

describe("DeskRelay relay protocol", () => {
  test("only forwards DeskRelay application APIs", () => {
    expect(isDeskRelayRelayApiRequest("GET", "/api/tasks")).toBe(true);
    expect(isDeskRelayRelayApiRequest("PATCH", "/api/tasks/thread")).toBe(true);
    expect(isDeskRelayRelayApiRequest("GET", "/health")).toBe(false);
    expect(isDeskRelayRelayApiRequest("POST", "/__deskrelay/device/poll")).toBe(false);
    expect(isDeskRelayRelayApiRequest("CONNECT", "/api/tasks")).toBe(false);
  });

  test("normalizes relay URLs without accepting embedded credentials", () => {
    expect(normalizeDeskRelayRelayBaseUrl("https://relay.example.com///")).toBe(
      "https://relay.example.com",
    );
    expect(() => normalizeDeskRelayRelayBaseUrl("https://user:pass@relay.example.com"))
      .toThrow("不能包含账号");
  });

  test("compares device tokens safely", () => {
    expect(timingSafeRelayTokenEqual("same-token", "same-token")).toBe(true);
    expect(timingSafeRelayTokenEqual("short", "different-token")).toBe(false);
  });
});
