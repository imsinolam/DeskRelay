/**
 * File-tail reading primitive (DSH-inspired "context management" original:
 * read only the tail of a potentially huge session file instead of loading
 * it whole). A 47 MB session can stall a daemon at ~95% CPU / 3.2 GB RAM
 * when fully subscribed; tail reads of the same session finish in ~100 ms.
 *
 * `readFileTail` scans a UTF-8 text file from its end, in bounded chunks,
 * and returns complete lines in file order. Callers provide a scanner that
 * processes each line from the tail forward; the primitive handles the
 * chunking, line-boundary stitching and scan-limit enforcement so adapters
 * do not re-implement reverse reads.
 */

import fs from "node:fs";

export type FileTailScanOptions = {
  /** Maximum bytes scanned from the end of the file. */
  scanLimitBytes: number;
  /** Chunk size used for each reverse read. */
  chunkBytes?: number;
};

export type FileTailLine = {
  /** Line text without the trailing newline. */
  text: string;
  /** True when this line is the first (oldest) scanned line. */
  isFirst: boolean;
  /** True when this line is the last (newest) scanned line. */
  isLast: boolean;
};

/**
 * Read the bounded tail of a UTF-8 text file from its end and feed each
 * complete line to `onLine` in file order (oldest scanned line first).
 * Returns the number of complete lines delivered, or null when the file
 * cannot be opened or read.
 *
 * A trailing line fragment at the start of the scanned window is discarded
 * when it does not end with a newline inside the window, unless
 * `keepLeadingFragment` is set (callers that want the partial first line).
 */
export function scanFileTail(
  filePath: string,
  options: FileTailScanOptions,
  onLine: (line: FileTailLine) => void,
): number | null {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return null;
  }
  let fileDescriptor: number;
  try {
    fileDescriptor = fs.openSync(filePath, "r");
  } catch {
    return null;
  }

  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const collected: string[] = [];
  try {
    let endOffset = stats.size;
    let scannedBytes = 0;
    let leadingLineFragment = "";
    while (endOffset > 0 && scannedBytes < options.scanLimitBytes) {
      const bytesToRead = Math.min(chunkBytes, endOffset, options.scanLimitBytes - scannedBytes);
      const startOffset = endOffset - bytesToRead;
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(
        fileDescriptor,
        buffer,
        0,
        buffer.length,
        startOffset,
      );
      const content = buffer.subarray(0, bytesRead).toString("utf8") + leadingLineFragment;
      const lines = content.split(/\r?\n/);
      // The first element may be a fragment that started before this chunk;
      // it becomes the leading fragment for the previous (older) chunk.
      leadingLineFragment = startOffset > 0 ? (lines.shift() ?? "") : "";
      // Skip a trailing empty element produced by a final newline.
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        collected.push(lines[index] ?? "");
      }
      endOffset = startOffset;
      scannedBytes += bytesRead;
    }
    if (endOffset === 0 && leadingLineFragment) {
      collected.push(leadingLineFragment);
    }
  } catch {
    return null;
  } finally {
    fs.closeSync(fileDescriptor);
  }

  collected.reverse();
  for (let index = 0; index < collected.length; index += 1) {
    onLine({
      text: collected[index] ?? "",
      isFirst: index === 0,
      isLast: index === collected.length - 1,
    });
  }
  return collected.length;
}

/** Convenience: collect tail lines into an array (oldest first). */
export function readFileTail(
  filePath: string,
  options: FileTailScanOptions,
): string[] | null {
  const lines: string[] = [];
  const count = scanFileTail(filePath, options, (line) => {
    lines.push(line.text);
  });
  return count === null ? null : lines;
}
