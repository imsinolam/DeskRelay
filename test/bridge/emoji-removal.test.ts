import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { buildWechatInboundPrompt } from "../../src/bridge/bridge-utils.ts";
import { messages as enMessages } from "../../src/i18n/messages-en.ts";
import { messages as zhMessages } from "../../src/i18n/messages-zh.ts";

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("emoji command removal", () => {
  test("keeps emoji and WeChat sticker text as ordinary adapter input", () => {
    const messages = [
      "👌🏻",
      "[强]",
      "[拥抱]继续刚才的任务",
      "你好[OK]",
    ];

    for (const message of messages) {
      expect(buildWechatInboundPrompt(message)).toBe(message);
    }
  });

  test("removes emoji command routing and binding management from both bridge modes", () => {
    const bridgeSource = readProjectFile("src/bridge/werelay-bridge.ts");
    const daemonSource = readProjectFile("src/daemon/werelay-daemon.ts");
    const combinedSource = `${bridgeSource}\n${daemonSource}`;

    expect(fs.existsSync(path.resolve(process.cwd(), "src/daemon/emoji-bindings.ts"))).toBe(false);
    for (const removedSymbol of [
      "resolveEmojiCommand",
      "parseEmojiBindingsCommand",
      "loadEmojiBindings",
      "formatBindingsListMessage",
      "isBindCommandPrefix",
    ]) {
      expect(combinedSource).not.toContain(removedSymbol);
    }
  });

  test("removes emoji binding prompts from welcome messages and README", () => {
    const visibleText = [
      zhMessages["bridge.welcome"],
      zhMessages["daemon.welcome"],
      enMessages["bridge.welcome"],
      enMessages["daemon.welcome"],
      readProjectFile("README.md"),
    ].join("\n");

    expect(visibleText).not.toMatch(/emoji bindings?|表情绑定/i);
    expect(visibleText).not.toContain("/bindings");
    expect(visibleText).not.toContain("/unbind");
    expect(visibleText).not.toMatch(/\/bind(?:\s|$)/);
  });
});
