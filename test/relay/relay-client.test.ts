import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WeRelayRelayCommandJournal,
} from "../../src/relay/relay-client.ts";
import {
  WERELAY_RELAY_PROTOCOL_VERSION,
  type WeRelayRelayCommandResponse,
} from "../../src/relay/relay-protocol.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("WeRelay relay command journal", () => {
  test("persists completed non-idempotent command responses across restarts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "werelay-relay-journal-"));
    tempDirs.push(directory);
    const stateFile = path.join(directory, "journal.json");
    const response: WeRelayRelayCommandResponse = {
      protocolVersion: WERELAY_RELAY_PROTOCOL_VERSION,
      commandId: "relay-command-1",
      statusCode: 200,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from('{"ok":true}').toString("base64"),
    };

    new WeRelayRelayCommandJournal(stateFile).save(response);

    expect(new WeRelayRelayCommandJournal(stateFile).get("relay-command-1"))
      .toEqual(response);
    if (process.platform !== "win32") {
      expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    }
  });
});
