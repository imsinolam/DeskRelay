import path from "node:path";

import type { BridgeMessageImage, BridgeSessionMessage } from "./bridge-types.ts";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
]);

function cleanReference(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/^['"]|['"]$/g, "");
}

function hasImageExtension(value: string): boolean {
  try {
    const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
    const extension = /^[A-Za-z]:[\\/]/.test(pathname) || pathname.startsWith("\\")
      ? path.win32.extname(pathname)
      : path.posix.extname(pathname);
    return IMAGE_EXTENSIONS.has(extension.toLowerCase());
  } catch {
    return false;
  }
}

function decodeLocalFileUrl(value: string): string | null {
  if (!/^file:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.hostname) {
      return `\\\\${url.hostname}${decodedPath.replace(/\//g, "\\")}`;
    }
    if (/^\/[A-Za-z]:\//.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }
    return decodedPath;
  } catch {
    return null;
  }
}

function localPathApi(value: string, cwd?: string): typeof path.posix | typeof path.win32 {
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\")) {
    return path.win32;
  }
  if (value.startsWith("/")) return path.posix;
  const candidate = cwd || "";
  if (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\")) {
    return path.win32;
  }
  return path.posix;
}

function resolveImageReference(
  rawValue: string,
  options: { cwd?: string; alt?: string } = {},
): BridgeMessageImage | null {
  let value = cleanReference(rawValue);
  if (!value || !hasImageExtension(value)) return null;

  const alt = options.alt?.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return {
        source: "remote",
        url: url.toString(),
        ...(alt ? { alt } : {}),
      };
    } catch {
      return null;
    }
  }

  const decodedFileUrl = decodeLocalFileUrl(value);
  if (!decodedFileUrl) return null;
  value = decodedFileUrl;
  if (!/^file:\/\//i.test(rawValue)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the original path when it is not URL-encoded.
    }
  }
  const pathApi = localPathApi(value, options.cwd);
  const localPath = pathApi.isAbsolute(value)
    ? pathApi.normalize(value)
    : options.cwd
      ? pathApi.resolve(options.cwd, value)
      : null;
  if (!localPath) return null;
  return {
    source: "local",
    path: localPath,
    ...(alt ? { alt } : {}),
  };
}

function imageKey(image: BridgeMessageImage): string {
  return image.source === "local" ? `local:${image.path}` : `remote:${image.url}`;
}

export function mergeBridgeMessageImages(
  ...groups: Array<BridgeMessageImage[] | undefined>
): BridgeMessageImage[] {
  const merged: BridgeMessageImage[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const image of group ?? []) {
      const key = imageKey(image);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(image);
    }
  }
  return merged;
}

function normalizeMessageMediaMatchText(message: BridgeSessionMessage): string {
  if (!message.images?.length && !message.text.includes("[image]")) {
    return message.text;
  }
  return message.text
    .replace(/<\/?image\b[^>]*>/gi, "")
    .replace(/\[local image:\s*[^\]]+\]/gi, "")
    .replace(/^\s*\[image\]\s*$/gim, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function mergeBridgeMessageMedia(
  acceleratedMessages: BridgeSessionMessage[],
  nativeMessages: BridgeSessionMessage[],
): BridgeSessionMessage[] {
  let nativeIndex = nativeMessages.length - 1;
  const merged = acceleratedMessages.map((message) => ({ ...message }));

  for (let acceleratedIndex = merged.length - 1; acceleratedIndex >= 0; acceleratedIndex -= 1) {
    const accelerated = merged[acceleratedIndex]!;
    let matchIndex = -1;
    for (let candidateIndex = nativeIndex; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = nativeMessages[candidateIndex]!;
      if (
        candidate.role === accelerated.role &&
        normalizeMessageMediaMatchText(candidate) ===
          normalizeMessageMediaMatchText(accelerated)
      ) {
        matchIndex = candidateIndex;
        break;
      }
    }
    if (matchIndex < 0) continue;

    const native = nativeMessages[matchIndex]!;
    nativeIndex = matchIndex - 1;
    const images = mergeBridgeMessageImages(accelerated.images, native.images);
    merged[acceleratedIndex] = {
      ...accelerated,
      ...(!accelerated.model && native.model ? { model: native.model } : {}),
      ...(images.length ? { images } : {}),
    };
  }

  return merged;
}

export function extractBridgeMessageImages(
  text: string,
  options: { cwd?: string } = {},
): BridgeMessageImage[] {
  const matches: Array<{ index: number; image: BridgeMessageImage }> = [];
  const remember = (index: number, rawValue: string, alt?: string) => {
    const image = resolveImageReference(rawValue, { ...options, ...(alt ? { alt } : {}) });
    if (image) matches.push({ index, image });
  };

  for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g)) {
    remember(match.index, match[2] ?? "", match[1] ?? "");
  }
  for (const match of text.matchAll(/<image\b[^>]*\b(?:path|url)=["']([^"']+)["'][^>]*>/gi)) {
    remember(match.index, match[1] ?? "");
  }
  for (const match of text.matchAll(/\[local image:\s*([^\]]+)\]/gi)) {
    remember(match.index, match[1] ?? "");
  }
  for (const block of text.matchAll(/```wechat-attachments[ \t]*\n([\s\S]*?)\n```/gi)) {
    let lineOffset = block.index;
    for (const line of (block[1] ?? "").split(/\r?\n/)) {
      const match = /^\s*image\s+(.+?)\s*$/.exec(line);
      if (match?.[1]) remember(lineOffset, match[1]);
      lineOffset += line.length + 1;
    }
  }

  matches.sort((left, right) => left.index - right.index);
  return mergeBridgeMessageImages(matches.map((match) => match.image));
}

export function enrichBridgeSessionMessageImages(
  message: BridgeSessionMessage,
  options: { cwd?: string } = {},
): BridgeSessionMessage {
  const images = mergeBridgeMessageImages(
    message.images,
    extractBridgeMessageImages(message.text, options),
  );
  return images.length ? { ...message, images } : message;
}

export function collectAssistantMessageImages(
  messages: BridgeSessionMessage[],
  options: {
    turnId?: string;
    cwd?: string;
    fallbackText?: string;
  } = {},
): BridgeMessageImage[] {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const exactTurnMessages = options.turnId
    ? assistantMessages.filter((message) => message.turnId === options.turnId)
    : [];
  const selected = exactTurnMessages.length
    ? exactTurnMessages
    : assistantMessages.length
      ? [assistantMessages[assistantMessages.length - 1]!]
      : [];
  return mergeBridgeMessageImages(
    ...selected.map((message) =>
      enrichBridgeSessionMessageImages(message, { cwd: options.cwd }).images
    ),
    options.fallbackText
      ? extractBridgeMessageImages(options.fallbackText, { cwd: options.cwd })
      : undefined,
  );
}
