import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  WechatImageDraftCollector,
  countWechatTaskTextCharacters,
} from "../../src/wechat/wechat-image-draft.ts";
import type {
  InboundWechatAttachment,
  InboundWechatMessage,
} from "../../src/wechat/wechat-transport.ts";

function image(name: string): InboundWechatAttachment {
  return {
    kind: "image",
    path: `/tmp/${name}`,
    fileName: name,
    sizeBytes: 128,
  };
}

function file(name: string): InboundWechatAttachment {
  return {
    kind: "file",
    path: `/tmp/${name}`,
    fileName: name,
    sizeBytes: 256,
  };
}

function message(
  text: string,
  attachments: InboundWechatAttachment[] = [],
): InboundWechatMessage {
  return {
    senderId: "user-1",
    sender: "Sino",
    sessionId: "wechat-session",
    text,
    attachments,
    contextToken: "context-token",
    createdAt: "2026-08-16 10:00:00",
    createdAtMs: 1_786_849_200_000,
  };
}

describe("WechatImageDraftCollector", () => {
  test("waits after an image-only message instead of forwarding it", () => {
    const collector = new WechatImageDraftCollector();

    const result = collector.consume(message("", [image("one.jpg")]));

    expect(result).toEqual({
      type: "wait",
      reply: "已收到 1 张图片，请继续发送图片或任务说明。",
    });
    expect(collector.pendingImageCount("user-1")).toBe(1);
  });

  test("combines consecutive images with a description longer than ten characters", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));
    collector.consume(message("", [image("two.jpg")]));

    const result = collector.consume(message("请认真检查这个页面存在的问题"));

    expect(result.type).toBe("send");
    if (result.type !== "send") throw new Error("expected send");
    expect(result.message.text).toBe("请认真检查这个页面存在的问题");
    expect(result.message.attachments.map((item) => item.fileName)).toEqual([
      "one.jpg",
      "two.jpg",
    ]);
    expect(collector.pendingImageCount("user-1")).toBe(0);
  });

  test("asks for confirmation when the description is ten characters or fewer", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));

    const result = collector.consume(message("请看看这个问题"));

    expect(result.type).toBe("wait");
    if (result.type !== "wait") throw new Error("expected wait");
    expect(result.reply).toContain("说明不超过 10 个字");
    expect(result.reply).toContain("1 发送");
    expect(result.reply).toContain("2 重写");
    expect(collector.pendingImageCount("user-1")).toBe(1);
  });

  test("sends the saved short description after confirmation", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));
    collector.consume(message("看下这里"));

    const result = collector.consume(message("1"));

    expect(result.type).toBe("send");
    if (result.type !== "send") throw new Error("expected send");
    expect(result.message.text).toBe("看下这里");
    expect(result.message.attachments).toHaveLength(1);
  });

  test("keeps the images but removes the short description when the user chooses rewrite", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));
    collector.consume(message("看下这里"));

    expect(collector.consume(message("2"))).toEqual({
      type: "wait",
      reply: "图片已保留，请重新发送完整的任务说明。",
    });

    const result = collector.consume(message("请检查截图中的按钮为什么没有响应"));
    expect(result.type).toBe("send");
    if (result.type !== "send") throw new Error("expected send");
    expect(result.message.text).toBe("请检查截图中的按钮为什么没有响应");
    expect(result.message.attachments).toHaveLength(1);
  });

  test("replaces an unconfirmed short description when the user writes again", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));
    collector.consume(message("第一版"));
    collector.consume(message("第二版说明"));

    const result = collector.consume(message("确认"));

    expect(result.type).toBe("send");
    if (result.type !== "send") throw new Error("expected send");
    expect(result.message.text).toBe("第二版说明");
  });

  test("keeps an unconfirmed short description while more images arrive", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));
    collector.consume(message("看下这里"));

    const waiting = collector.consume(message("", [image("two.jpg")]));
    expect(waiting).toEqual({
      type: "wait",
      reply: "已收到 2 张图片，请继续发送图片或任务说明。",
    });

    const result = collector.consume(message("1"));
    expect(result.type).toBe("send");
    if (result.type !== "send") throw new Error("expected send");
    expect(result.message.text).toBe("看下这里");
    expect(result.message.attachments).toHaveLength(2);
  });

  test("allows cancelling the pending image draft", () => {
    const collector = new WechatImageDraftCollector();
    collector.consume(message("", [image("one.jpg")]));

    expect(collector.consume(message("取消图片"))).toEqual({
      type: "wait",
      reply: "已取消这次图片任务。",
    });
    expect(collector.consume(message("继续普通对话"))).toEqual({
      type: "pass",
      message: message("继续普通对话"),
    });
  });

  test("does not delay ordinary text or file-only messages when no image draft exists", () => {
    const collector = new WechatImageDraftCollector();
    const plain = message("看一下");
    const document = message("处理文件", [file("report.pdf")]);

    expect(collector.consume(plain)).toEqual({ type: "pass", message: plain });
    expect(collector.consume(document)).toEqual({ type: "pass", message: document });
  });

  test("is wired into both the persistent daemon and standalone bridge", () => {
    const daemonSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/daemon/deskrelay-daemon.ts"),
      "utf8",
    );
    const bridgeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/bridge/deskrelay-bridge.ts"),
      "utf8",
    );

    expect(daemonSource).toContain("this.wechatImageDrafts.consume(message)");
    expect(bridgeSource).toContain("imageDraftCollector.consume(message)");
  });

  test("counts visible non-whitespace Unicode characters", () => {
    expect(countWechatTaskTextCharacters(" 一 二 三 ")).toBe(3);
    expect(countWechatTaskTextCharacters("修复页面🙂问题")).toBe(7);
  });
});
