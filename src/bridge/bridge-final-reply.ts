import type { BridgeAdapterKind, BridgeMessageImage } from "./bridge-types.ts";
import {
  formatFinalReplyMessage,
  parseWechatFinalReply,
  sanitizeWechatFinalReplyText,
  splitWechatTextIntoChunks,
} from "./bridge-utils.ts";

export type WechatFinalReplySender = {
  sendText: (text: string) => Promise<boolean | void>;
  sendImage: (imagePath: string) => Promise<unknown>;
  sendFile: (filePath: string) => Promise<unknown>;
  sendVoice: (voicePath: string) => Promise<unknown>;
  sendVideo: (videoPath: string) => Promise<unknown>;
};

export const OPENCODE_EMPTY_VISIBLE_REPLY_MESSAGE =
  "OpenCode 没有产生可发送到微信的可见回复。请查看本地终端输出，或重试这条消息。";

export async function forwardWechatFinalReply(params: {
  adapter: BridgeAdapterKind;
  rawText: string;
  images?: BridgeMessageImage[];
  sender: WechatFinalReplySender;
  onEmptyVisibleReply?: (details: {
    adapter: BridgeAdapterKind;
    rawVisibleText: string;
  }) => void;
}): Promise<void> {
  const { adapter, rawText, images, sender, onEmptyVisibleReply } = params;
  const parsed = parseWechatFinalReply(rawText);
  const sanitizedText = sanitizeWechatFinalReplyText(adapter, parsed.visibleText);
  const visibleText = formatFinalReplyMessage(adapter, sanitizedText).trim();

  if (visibleText) {
    // Send long replies in bounded chunks: a single oversized sendmessage call
    // can be rejected by the WeChat API, silently losing the whole reply.
    for (const chunk of splitWechatTextIntoChunks(visibleText)) {
      const sent = await sender.sendText(chunk);
      if (sent === false) {
        return;
      }
    }
  } else if (adapter === "opencode" && parsed.visibleText.trim()) {
    onEmptyVisibleReply?.({
      adapter,
      rawVisibleText: parsed.visibleText,
    });
    const sent = await sender.sendText(OPENCODE_EMPTY_VISIBLE_REPLY_MESSAGE);
    if (sent === false) {
      return;
    }
  }

  const structuredImagePaths = (images ?? [])
    .filter((image): image is Extract<BridgeMessageImage, { source: "local" }> =>
      image.source === "local"
    )
    .map((image) => image.path);
  const seenImagePaths = new Set<string>();
  const attachments = [
    ...parsed.attachments,
    ...structuredImagePaths.map((imagePath) => ({ kind: "image" as const, path: imagePath })),
  ].filter((attachment) => {
    if (attachment.kind !== "image") return true;
    if (seenImagePaths.has(attachment.path)) return false;
    seenImagePaths.add(attachment.path);
    return true;
  });

  for (const attachment of attachments) {
    try {
      switch (attachment.kind) {
        case "image":
          await sender.sendImage(attachment.path);
          break;
        case "file":
          await sender.sendFile(attachment.path);
          break;
        case "voice":
          await sender.sendVoice(attachment.path);
          break;
        case "video":
          await sender.sendVideo(attachment.path);
          break;
      }
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      await sender.sendText(
        `Failed to send ${attachment.kind} attachment: ${attachment.path}\n${errorText}`,
      );
    }
  }
}
