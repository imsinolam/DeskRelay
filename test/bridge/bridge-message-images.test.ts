import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  collectAssistantMessageImages,
  enrichBridgeSessionMessageImages,
  extractBridgeMessageImages,
  mergeBridgeMessageMedia,
} from "../../src/bridge/bridge-message-images.ts";

describe("extractBridgeMessageImages", () => {
  test("extracts only explicit local and remote image references", () => {
    const cwd = path.resolve("/tmp/deskrelay-media");
    const images = extractBridgeMessageImages([
      "生成结果：",
      "![预览](images/result.png)",
      '<image path="/tmp/deskrelay-media/final.webp">',
      "[local image: /tmp/deskrelay-media/final.webp]",
      "源码在 /tmp/deskrelay-media/src/app.ts，不应作为图片。",
      "远程图：![海报](https://example.com/poster.jpg)",
    ].join("\n"), { cwd });

    expect(images).toEqual([
      { source: "local", path: path.join(cwd, "images/result.png"), alt: "预览" },
      { source: "local", path: "/tmp/deskrelay-media/final.webp" },
      { source: "remote", url: "https://example.com/poster.jpg", alt: "海报" },
    ]);
  });

  test("reads image entries from the final WeChat attachment block", () => {
    expect(extractBridgeMessageImages([
      "已完成。",
      "```wechat-attachments",
      "image /tmp/generated/a.png",
      "file /tmp/generated/report.pdf",
      "```",
    ].join("\n"))).toEqual([
      { source: "local", path: "/tmp/generated/a.png" },
    ]);
  });
  test("collects only the current turn images and falls back to the latest assistant message", () => {
    const messages = [
      {
        role: "assistant" as const,
        text: "旧图片",
        turnId: "turn-old",
        images: [{ source: "local" as const, path: "/tmp/old.png" }],
      },
      {
        role: "assistant" as const,
        text: "当前图片",
        turnId: "turn-new",
        images: [{ source: "local" as const, path: "/tmp/new.png" }],
      },
    ];

    expect(collectAssistantMessageImages(messages, { turnId: "turn-new" })).toEqual([
      { source: "local", path: "/tmp/new.png" },
    ]);
    expect(collectAssistantMessageImages(messages, { turnId: "missing" })).toEqual([
      { source: "local", path: "/tmp/new.png" },
    ]);
  });

  test("merges native image metadata into accelerated history without duplicating messages", () => {
    const accelerated = [
      { role: "user" as const, text: "生成四张图片" },
      { role: "assistant" as const, text: "第一张", model: "grok-4" },
      { role: "assistant" as const, text: "第二张" },
    ];
    const native = [
      { role: "user" as const, text: "更早的问题" },
      { role: "assistant" as const, text: "更早的回答" },
      { role: "user" as const, text: "生成四张图片", turnId: "turn-1" },
      {
        role: "assistant" as const,
        text: "第一张",
        phase: "final_answer" as const,
        images: [{ source: "local" as const, path: "/tmp/1.jpg" }],
      },
      {
        role: "assistant" as const,
        text: "第二张",
        phase: "final_answer" as const,
        model: "grok-4-native",
        images: [{ source: "local" as const, path: "/tmp/2.jpg" }],
      },
    ];

    expect(mergeBridgeMessageMedia(accelerated, native)).toEqual([
      { role: "user", text: "生成四张图片" },
      {
        role: "assistant",
        text: "第一张",
        model: "grok-4",
        images: [{ source: "local", path: "/tmp/1.jpg" }],
      },
      {
        role: "assistant",
        text: "第二张",
        model: "grok-4-native",
        images: [{ source: "local", path: "/tmp/2.jpg" }],
      },
    ]);
  });

  test("matches accelerated user text when the native image placeholder differs", () => {
    expect(mergeBridgeMessageMedia(
      [{ role: "user", text: "请看这张图" }],
      [{
        role: "user",
        text: "请看这张图\n\n[image]\n</image>",
        images: [{ source: "local", path: "/tmp/input.png" }],
      }],
    )).toEqual([{
      role: "user",
      text: "请看这张图",
      images: [{ source: "local", path: "/tmp/input.png" }],
    }]);
  });

  test("enriches explicit user image references for mobile transcript previews", () => {
    expect(enrichBridgeSessionMessageImages({
      role: "user",
      text: "请看附件\n[local image: /tmp/input.png]",
    })).toEqual({
      role: "user",
      text: "请看附件\n[local image: /tmp/input.png]",
      images: [{ source: "local", path: "/tmp/input.png" }],
    });
  });

});
