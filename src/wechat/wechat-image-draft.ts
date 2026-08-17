import type {
  InboundWechatAttachment,
  InboundWechatMessage,
} from "./wechat-transport.ts";

const AUTO_SEND_TEXT_MIN_CHARACTERS = 11;

const CONFIRM_SHORT_TEXT_PATTERN = /^(?:1|是|确认|发送|可以|完整)$/u;
const REWRITE_SHORT_TEXT_PATTERN = /^(?:2|否|不|重写|重新写|重新书写|不发送)$/u;
const CANCEL_IMAGE_DRAFT_PATTERN = /^(?:取消图片|取消这次图片|取消图片任务)$/u;

type WechatImageDraft = {
  attachments: InboundWechatAttachment[];
  shortText?: string;
};

export type WechatImageDraftResult =
  | { type: "pass"; message: InboundWechatMessage }
  | { type: "wait"; reply: string }
  | { type: "send"; message: InboundWechatMessage };

export function countWechatTaskTextCharacters(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function imageCount(attachments: InboundWechatAttachment[]): number {
  return attachments.filter((attachment) => attachment.kind === "image").length;
}

function formatImageDraftReceived(count: number): string {
  return `已收到 ${count} 张图片，请继续发送图片或任务说明。`;
}

function formatShortTextConfirmation(text: string): string {
  return [
    "任务说明不超过 10 个字，是否已经完整并可以发送？",
    `“${text}”`,
    "1 发送",
    "2 重写",
  ].join("\n");
}

export class WechatImageDraftCollector {
  private readonly drafts = new Map<string, WechatImageDraft>();

  hasPendingDraft(senderId: string): boolean {
    return this.drafts.has(senderId);
  }

  pendingImageCount(senderId: string): number {
    return imageCount(this.drafts.get(senderId)?.attachments ?? []);
  }

  consume(message: InboundWechatMessage): WechatImageDraftResult {
    const senderId = message.senderId;
    const text = message.text.trim();
    const incomingImages = message.attachments.filter(
      (attachment) => attachment.kind === "image",
    );
    let draft = this.drafts.get(senderId);

    if (!draft && incomingImages.length === 0) {
      return { type: "pass", message };
    }

    if (draft && CANCEL_IMAGE_DRAFT_PATTERN.test(text)) {
      this.drafts.delete(senderId);
      return { type: "wait", reply: "已取消这次图片任务。" };
    }

    if (draft?.shortText && CONFIRM_SHORT_TEXT_PATTERN.test(text)) {
      return this.finish(message, draft.shortText, draft.attachments);
    }

    if (draft?.shortText && REWRITE_SHORT_TEXT_PATTERN.test(text)) {
      delete draft.shortText;
      return {
        type: "wait",
        reply: "图片已保留，请重新发送完整的任务说明。",
      };
    }

    if (!draft) {
      draft = { attachments: [] };
      this.drafts.set(senderId, draft);
    }

    if (message.attachments.length > 0) {
      draft.attachments.push(...message.attachments);
    }

    if (!text) {
      return {
        type: "wait",
        reply: formatImageDraftReceived(imageCount(draft.attachments)),
      };
    }

    if (countWechatTaskTextCharacters(text) >= AUTO_SEND_TEXT_MIN_CHARACTERS) {
      return this.finish(message, text, draft.attachments);
    }

    draft.shortText = text;
    return {
      type: "wait",
      reply: formatShortTextConfirmation(text),
    };
  }

  private finish(
    message: InboundWechatMessage,
    text: string,
    attachments: InboundWechatAttachment[],
  ): WechatImageDraftResult {
    this.drafts.delete(message.senderId);
    return {
      type: "send",
      message: {
        ...message,
        text,
        attachments: [...attachments],
      },
    };
  }
}
