import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MobileMessageImageStore } from "../../src/daemon/mobile-message-image-store.ts";

describe("MobileMessageImageStore", () => {
  test("persists web input images and restores them onto the matching user message", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-mobile-input-images-"));
    const stateFile = path.join(directory, "mobile-message-images.json");
    const imagePath = path.join(directory, "input.png");
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const store = new MobileMessageImageStore("/tmp/project", { stateFile });
      store.remember({
        adapter: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        text: "看看这张图",
        images: [{ path: imagePath, alt: "设计稿.png" }],
      });

      const restored = new MobileMessageImageStore("/tmp/project", { stateFile });
      expect(restored.enrich([
        { role: "user", text: "看看这张图\n[image]", turnId: "turn-1" },
        { role: "assistant", text: "收到" },
      ], { adapter: "codex", threadId: "thread-1" })).toEqual([
        {
          role: "user",
          text: "看看这张图\n[image]",
          turnId: "turn-1",
          images: [{ source: "local", path: imagePath, alt: "设计稿.png" }],
        },
        { role: "assistant", text: "收到" },
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("matches repeated image-only inputs from newest to oldest without crossing threads", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-mobile-input-images-"));
    const stateFile = path.join(directory, "mobile-message-images.json");
    const firstPath = path.join(directory, "first.jpg");
    const secondPath = path.join(directory, "second.jpg");
    fs.writeFileSync(firstPath, "first");
    fs.writeFileSync(secondPath, "second");
    try {
      const store = new MobileMessageImageStore("/tmp/project", { stateFile });
      store.remember({
        adapter: "grok",
        threadId: "thread-1",
        text: "",
        images: [{ path: firstPath, alt: "first.jpg" }],
        createdAtMs: 1,
      });
      store.remember({
        adapter: "grok",
        threadId: "thread-1",
        text: "",
        images: [{ path: secondPath, alt: "second.jpg" }],
        createdAtMs: 2,
      });

      expect(store.enrich([
        { role: "user", text: "[image]" },
        { role: "assistant", text: "一" },
        { role: "user", text: "[image]" },
      ], { adapter: "grok", threadId: "thread-1" }).map((message) => message.images)).toEqual([
        [{ source: "local", path: firstPath, alt: "first.jpg" }],
        undefined,
        [{ source: "local", path: secondPath, alt: "second.jpg" }],
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
