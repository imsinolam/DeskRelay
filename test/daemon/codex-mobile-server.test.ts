import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexMobileAuthStore } from "../../src/daemon/codex-mobile-auth.ts";
import { CODEX_MOBILE_CSS, CODEX_MOBILE_JS } from "../../src/daemon/codex-mobile-web.ts";
import { DaemonWorkspaceStateStore } from "../../src/daemon/daemon-state.ts";
import {
  CODEX_MOBILE_ASSET_VERSION,
  MobileAdapterUnavailableError,
  paginateCodexMobileMessages,
  resolveCodexMobileListenHost,
  resolvePreferredLanAddress,
  startCodexMobileServer,
} from "../../src/daemon/codex-mobile-server.ts";

describe("paginateCodexMobileMessages", () => {
  test("returns the latest page first and walks backwards with an opaque boundary", () => {
    const messages = Array.from({ length: 95 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `消息 ${index + 1}`,
    }));

    const latest = paginateCodexMobileMessages(messages, { limit: 40 });
    expect(latest.start).toBe(55);
    expect(latest.end).toBe(95);
    expect(latest.messages[0]?.text).toBe("消息 56");
    expect(latest.messages.at(-1)?.text).toBe("消息 95");
    expect(latest.hasMore).toBe(true);
    expect(latest.nextBefore).toBe(55);

    const older = paginateCodexMobileMessages(messages, {
      before: latest.nextBefore,
      limit: 40,
    });
    expect(older.start).toBe(15);
    expect(older.end).toBe(55);
    expect(older.messages[0]?.text).toBe("消息 16");
    expect(older.messages.at(-1)?.text).toBe("消息 55");
  });

  test("clamps invalid boundaries and page sizes", () => {
    const messages = [{ role: "user" as const, text: "唯一消息" }];
    expect(paginateCodexMobileMessages(messages, {
      before: Number.NaN,
      limit: 0,
    })).toMatchObject({
      start: 0,
      end: 1,
      total: 1,
      hasMore: false,
      nextBefore: null,
    });
  });
});

describe("mobile approval result helpers", () => {
  test("keeps approval decisions visible with action-specific labels", () => {
    const helpers = loadMobileApprovalResultHelpers();
    expect(helpers.title("confirm")).toBe("已允许本次操作");
    expect(helpers.title("confirm_session")).toBe("本任务后续同类操作已允许");
    expect(helpers.title("confirm_task")).toBe("已按本任务免审允许");
    expect(helpers.title("deny")).toBe("已拒绝此操作");
  });

  test("places an approval result after the matching turn", () => {
    const helpers = loadMobileApprovalResultHelpers();
    const messages = [
      { turnId: "turn-1" },
      { turnId: "turn-1" },
      { turnId: "turn-2" },
    ];
    expect(helpers.insertIndex(messages, { turnId: "turn-1" })).toBe(2);
    expect(helpers.insertIndex(messages, { turnId: "turn-missing" })).toBe(3);
    expect(helpers.insertIndex(messages, {})).toBe(3);
  });
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createAuthStore(password?: string): CodexMobileAuthStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mobile-server-"));
  tempDirs.push(dir);
  const store = new CodexMobileAuthStore({ stateFile: path.join(dir, "auth.json") });
  if (password) store.setPassword(password);
  return store;
}

function loadMobileMarkdownRenderer(): (markdown: string, foldPrefix?: string) => string {
  const start = CODEX_MOBILE_JS.indexOf("  function escapeHtml");
  const end = CODEX_MOBILE_JS.indexOf("\n  async function fetchJson", start);
  if (start < 0 || end < 0) throw new Error("Mobile markdown renderer not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn renderMarkdown;`)() as (markdown: string) => string;
}

function loadMobileRunSummaryResolver(): (
  messages: Array<{ role: string; turnId?: string }>,
  task: { status: string; startedAtMs?: number } | null,
  summary: { turnId?: string; status: string; startedAtMs?: number; durationMs?: number } | null,
  nowMs: number,
) => { turnId?: string; status: string; startedAtMs?: number; durationMs?: number } | null {
  const start = CODEX_MOBILE_JS.indexOf("  function isTaskActivelyRunning");
  const end = CODEX_MOBILE_JS.indexOf("\n  function runDurationMs", start);
  if (start < 0 || end < 0) throw new Error("Mobile run summary resolver not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn resolveVisibleRunSummary;`)() as ReturnType<
    typeof loadMobileRunSummaryResolver
  >;
}

function loadMobileComposerActionPredicate(): (
  task: { status: string } | null,
  summary: { status: string } | null,
  hasContent: boolean,
) => boolean {
  const start = CODEX_MOBILE_JS.indexOf("  function isTaskActivelyRunning");
  const end = CODEX_MOBILE_JS.indexOf("\n  function runDurationMs", start);
  if (start < 0 || end < 0) throw new Error("Mobile composer action helper not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn shouldUseStopComposerAction;`)() as ReturnType<
    typeof loadMobileComposerActionPredicate
  >;
}

function loadMobileTaskSidebarHelpers(): {
  projectBatchSize: number;
  recentBatchSize: number;
  nextTaskVisibleLimit: (current: number, total: number, batchSize: number) => number;
  setProjectGroupCollapsed: (
    collapsedGroups: Record<string, boolean>,
    visibleLimits: Record<string, number>,
    groupKey: string,
    collapsed: boolean,
  ) => void;
  sortTasksByRecency: <T extends { lastUpdatedAt?: string }>(tasks: T[]) => T[];
  taskBoardLane: (task: { status?: string; completedAt?: string }) => string;
  taskBoardMatchesQuery: (
    task: { title?: string; projectName?: string; adapterLabel?: string },
    query: string,
  ) => boolean;
  formatTaskBoardTime: (value: string, nowMs?: number) => string;
  projectTaskCreationSource: <T extends {
    threadId: string;
    canCreateInProject?: boolean;
  }>(tasks: T[], currentThreadId: string) => T | null;
} {
  const start = CODEX_MOBILE_JS.indexOf("  var PROJECT_TASK_BATCH_SIZE");
  const end = CODEX_MOBILE_JS.indexOf("\n  function readSetupToken", start);
  if (start < 0 || end < 0) throw new Error("Mobile task sidebar helpers not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}
return {
  projectBatchSize: PROJECT_TASK_BATCH_SIZE,
  recentBatchSize: RECENT_TASK_BATCH_SIZE,
  nextTaskVisibleLimit,
  setProjectGroupCollapsed,
  sortTasksByRecency,
  taskBoardLane,
  taskBoardMatchesQuery,
  formatTaskBoardTime,
  projectTaskCreationSource
};`)() as ReturnType<typeof loadMobileTaskSidebarHelpers>;
}

function loadMobileTaskSelector(): <T extends { threadId: string }>(
  tasks: T[],
  selector: string,
) => T | null {
  const start = CODEX_MOBILE_JS.indexOf("  function resolveTaskSelector");
  const end = CODEX_MOBILE_JS.indexOf("\n  function readSetupToken", start);
  if (start < 0 || end < 0) throw new Error("Mobile task selector not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn resolveTaskSelector;`)() as ReturnType<
    typeof loadMobileTaskSelector
  >;
}

function loadMobileMessagePageMerger(): (
  existing: Array<{ id?: string; role: string; text: string; turnId?: string; phase?: string }>,
  incoming: Array<{ id?: string; role: string; text: string; turnId?: string; phase?: string }>,
) => Array<{ id?: string; role: string; text: string; turnId?: string; phase?: string }> {
  const start = CODEX_MOBILE_JS.indexOf("  function messagePageKey");
  const end = CODEX_MOBILE_JS.indexOf("\n  function rebuildServerMessages", start);
  if (start < 0 || end < 0) throw new Error("Mobile message page merger not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn mergeMessagePages;`)() as ReturnType<
    typeof loadMobileMessagePageMerger
  >;
}

function loadMobilePendingMessageReconciler(): (
  pendingMessages: Array<{
    clientId: string;
    text: string;
    imageCount: number;
    status: string;
    turnId?: string;
    baselineUserCount: number;
    baselineUserKeys?: string[];
  }>,
  messages: Array<{
    id?: string;
    turnId?: string;
    role: string;
    text: string;
  }>,
) => Array<{ clientId: string }> {
  const start = CODEX_MOBILE_JS.indexOf("  function reconcilePendingMessages");
  const end = CODEX_MOBILE_JS.indexOf("\n  function runHeaderInsertIndex", start);
  if (start < 0 || end < 0) throw new Error("Mobile pending-message reconciler not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function("pendingMessages", "messages", `
var state = { pendingMessages: pendingMessages };
${source}
reconcilePendingMessages(messages);
return state.pendingMessages;
`) as ReturnType<typeof loadMobilePendingMessageReconciler>;
}

function loadMobileRunSummaryRenderKey(): (
  summary: {
    turnId?: string;
    status?: string;
    startedAtMs?: number;
    completedAtMs?: number;
    durationMs?: number;
    receivedAtMs?: number;
  } | null,
) => unknown {
  const start = CODEX_MOBILE_JS.indexOf("  function runSummaryRenderKey");
  const end = CODEX_MOBILE_JS.indexOf("\n  function renderMessages", start);
  if (start < 0 || end < 0) throw new Error("Mobile run-summary render key not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn runSummaryRenderKey;`)() as ReturnType<
    typeof loadMobileRunSummaryRenderKey
  >;
}

function loadMobileApprovalResultHelpers(): {
  title: (action: string) => string;
  insertIndex: (
    messages: Array<{ turnId?: string }>,
    result: { turnId?: string },
  ) => number;
} {
  const start = CODEX_MOBILE_JS.indexOf("  function approvalResultTitle");
  const end = CODEX_MOBILE_JS.indexOf("\n  function renderApprovalResult", start);
  if (start < 0 || end < 0) throw new Error("Mobile approval-result helpers not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn { title: approvalResultTitle, insertIndex: approvalResultInsertIndex };`)() as ReturnType<
    typeof loadMobileApprovalResultHelpers
  >;
}

function loadVisibleMessageModel(): (message: {
  role?: string;
  phase?: string;
  model?: string;
}) => string {
  const start = CODEX_MOBILE_JS.indexOf("  function visibleMessageModel");
  const end = CODEX_MOBILE_JS.indexOf("\n  function renderMessageRow", start);
  if (start < 0 || end < 0) throw new Error("Mobile message model helper not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn visibleMessageModel;`)() as ReturnType<
    typeof loadVisibleMessageModel
  >;
}

function loadMobileVisibleMessageText(): (message: {
  role?: string;
  text?: string;
}) => string {
  const start = CODEX_MOBILE_JS.indexOf("  function visibleMessageText");
  const end = CODEX_MOBILE_JS.indexOf("\n  function visibleMessageModel", start);
  if (start < 0 || end < 0) throw new Error("Mobile visible-message text helper not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn visibleMessageText;`)() as ReturnType<
    typeof loadMobileVisibleMessageText
  >;
}

function loadMobileProgressPartitioner(): (
  items: Array<{ id: string; kind: string; status: string; text: string }>,
) => {
  pinned: Array<{ id: string }>;
  hidden: Array<{ id: string }>;
  visible: Array<{ id: string }>;
} {
  const start = CODEX_MOBILE_JS.indexOf("  function partitionProgressItems");
  const end = CODEX_MOBILE_JS.indexOf("\n  function renderProgressList", start);
  if (start < 0 || end < 0) throw new Error("Mobile progress partitioner not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn partitionProgressItems;`)() as ReturnType<
    typeof loadMobileProgressPartitioner
  >;
}

function loadMobileSwitchProgressFormatter(): (startedAtMs: number, nowMs: number) => string {
  const start = CODEX_MOBILE_JS.indexOf("  function formatRunDuration");
  const end = CODEX_MOBILE_JS.indexOf("\n  function effectiveRunSummary", start);
  if (start < 0 || end < 0) throw new Error("Mobile switch-progress formatter not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn switchProgressLabel;`)() as ReturnType<
    typeof loadMobileSwitchProgressFormatter
  >;
}

function loadMobileQueuedMessageMerger(): (
  queuedMessages: Array<{ id: string; text: string; imageCount: number }>,
  pendingMessages: Array<{
    clientId: string;
    queuedMessageId?: string;
    text: string;
    imageCount: number;
    status: string;
    displayInTranscript: boolean;
    createdAtMs?: number;
  }>,
  transcriptMessages?: Array<{ role: string; text: string; turnId?: string }>,
  runSummary?: { status: string; turnId?: string } | null,
) => Array<{
  id: string;
  text: string;
  imageCount: number;
  createdAtMs?: number;
  optimistic?: boolean;
  status?: string;
}> {
  const start = CODEX_MOBILE_JS.indexOf("  function queuedMessageDisplayText");
  const end = CODEX_MOBILE_JS.indexOf("\n  async function steerQueuedMessage", start);
  if (start < 0 || end < 0) throw new Error("Mobile queued-message merger not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn mergeQueuedMessagesForDisplay;`)() as ReturnType<
    typeof loadMobileQueuedMessageMerger
  >;
}

function loadMobileUserMessageNavigator(): (
  offsets: number[],
  scrollTop: number,
  targetInset: number,
) => { previousIndex: number; nextIndex: number } {
  const start = CODEX_MOBILE_JS.indexOf("  function resolveUserMessageNavigation");
  const end = CODEX_MOBILE_JS.indexOf("\n  function updateUserMessageNavigation", start);
  if (start < 0 || end < 0) throw new Error("Mobile user-message navigator not found");
  const source = CODEX_MOBILE_JS.slice(start, end);
  return new Function(`${source}\nreturn resolveUserMessageNavigation;`)() as ReturnType<
    typeof loadMobileUserMessageNavigator
  >;
}

describe("Codex mobile web rendering", () => {
  test("resolves full task ids and rejects ambiguous legacy prefixes", () => {
    const resolveTaskSelector = loadMobileTaskSelector();
    const tasks = [
      { threadId: "0000000a-aaaa", title: "任务 A" },
      { threadId: "0000000a-bbbb", title: "任务 B" },
      { threadId: "0000000c-cccc", title: "任务 C" },
    ];

    expect(resolveTaskSelector(tasks, "0000000a-bbbb")).toEqual(tasks[1]);
    expect(resolveTaskSelector(tasks, "0000000c")).toEqual(tasks[2]);
    expect(resolveTaskSelector(tasks, "0000000a")).toBeNull();
  });

  test("chooses the current project task for project-scoped creation", () => {
    const { projectTaskCreationSource } = loadMobileTaskSidebarHelpers();
    const tasks = [
      { threadId: "task-a", canCreateInProject: true },
      { threadId: "task-b", canCreateInProject: true },
    ];

    expect(projectTaskCreationSource(tasks, "task-b")).toEqual(tasks[1]);
    expect(projectTaskCreationSource(tasks, "missing")).toEqual(tasks[0]);
    expect(projectTaskCreationSource([
      { threadId: "unsupported", canCreateInProject: false },
    ], "unsupported")).toBeNull();
    expect(CODEX_MOBILE_CSS).toContain(".task-group-create");
    expect(CODEX_MOBILE_JS).toContain("task-group-create");
  });

  test("does not rebuild the transcript when only the running clock advances", () => {
    const runSummaryRenderKey = loadMobileRunSummaryRenderKey();
    const base = {
      turnId: "turn-running",
      status: "running",
      startedAtMs: 1_800_000_000_000,
    };

    expect(runSummaryRenderKey({
      ...base,
      durationMs: 3_000,
      receivedAtMs: 1_800_000_003_000,
    })).toEqual(runSummaryRenderKey({
      ...base,
      durationMs: 8_000,
      receivedAtMs: 1_800_000_008_000,
    }));
    expect(runSummaryRenderKey({ ...base, status: "completed" })).not.toEqual(
      runSummaryRenderKey(base),
    );
  });

  test("navigates between user messages and hides directions at either boundary", () => {
    const resolveUserMessageNavigation = loadMobileUserMessageNavigator();
    const offsets = [120, 520, 930];

    expect(resolveUserMessageNavigation(offsets, 0, 72)).toEqual({
      previousIndex: -1,
      nextIndex: 0,
    });
    expect(resolveUserMessageNavigation(offsets, 448, 72)).toEqual({
      previousIndex: 0,
      nextIndex: 2,
    });
    expect(resolveUserMessageNavigation(offsets, 858, 72)).toEqual({
      previousIndex: 1,
      nextIndex: -1,
    });
  });

  test("shows the real model only at the end of an assistant reply", () => {
    const visibleMessageModel = loadVisibleMessageModel();
    expect(visibleMessageModel({
      role: "assistant",
      phase: "final_answer",
      model: " gpt-5.6-sol ",
    })).toBe("gpt-5.6-sol");
    expect(visibleMessageModel({
      role: "assistant",
      phase: "commentary",
      model: "gpt-5.6-sol",
    })).toBe("");
    expect(visibleMessageModel({ role: "user", model: "gpt-5.6-sol" })).toBe("");
    expect(visibleMessageModel({ role: "assistant" })).toBe("");
  });

  test("hides screenshot transport labels while keeping the real user request", () => {
    const visibleMessageText = loadMobileVisibleMessageText();
    expect(visibleMessageText({
      role: "user",
      text: "图片：png1 png2\n请对比两个页面。\n[image]</image>",
    })).toBe("请对比两个页面。");
    expect(visibleMessageText({ role: "user", text: "图片：png1\n[image]" })).toBe("已发送图片");
    expect(visibleMessageText({ role: "assistant", text: "图片：png1 是正文" })).toBe("图片：png1 是正文");
  });

  test("folds long code or output blocks but keeps short snippets expanded", () => {
    const renderMarkdown = loadMobileMarkdownRenderer();
    const longBlock = renderMarkdown(`\`\`\`\n${Array.from({ length: 7 }, (_, index) => `line ${index + 1}`).join("\n")}\n\`\`\``, "message-42");
    const shortBlock = renderMarkdown("```\nline 1\nline 2\n```");

    expect(longBlock).toContain('<details class="message-code-fold" data-fold-key="message-42:1">');
    expect(longBlock).toContain('data-fold-key="message-42:1"');
    expect(longBlock).toContain("代码 / 输出 · 7 行");
    expect(shortBlock).not.toContain('class="message-code-fold"');
    expect(shortBlock).toContain("<pre><code>line 1\nline 2</code></pre>");
  });

  test("keeps the plan and latest progress visible while folding older completed activity", () => {
    const partitionProgressItems = loadMobileProgressPartitioner();
    const items = [
      { id: "plan", kind: "plan", status: "running", text: "第 3 / 5 步" },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `done-${index + 1}`,
        kind: "command",
        status: "completed",
        text: `已运行命令 ${index + 1}`,
      })),
      { id: "running", kind: "file", status: "running", text: "正在修改文件" },
    ];

    const result = partitionProgressItems(items);
    expect(result.pinned.map((item) => item.id)).toEqual(["plan"]);
    expect(result.hidden.map((item) => item.id)).toEqual(["done-1", "done-2", "done-3"]);
    expect(result.visible.map((item) => item.id)).toEqual([
      "done-4",
      "done-5",
      "done-6",
      "running",
    ]);
  });

  test("shows terminal-switch feedback immediately and keeps elapsed time visible", () => {
    const switchProgressLabel = loadMobileSwitchProgressFormatter();
    expect(switchProgressLabel(1_800_000_000_000, 1_800_000_002_000)).toBe("连接中 · 0m 2s");
    expect(switchProgressLabel(1_800_000_000_000, 1_800_000_015_000)).toBe("仍在连接 · 0m 15s");
  });

  test("shows a likely queued follow-up immediately and reconciles it by server id", () => {
    const mergeQueuedMessagesForDisplay = loadMobileQueuedMessageMerger();
    const pending = {
      clientId: "mobile-pending",
      text: "等待当前任务结束后发送",
      imageCount: 1,
      status: "sending",
      displayInTranscript: false,
      createdAtMs: 1_800_000_000_000,
    };

    expect(mergeQueuedMessagesForDisplay([], [pending])).toEqual([{
      id: "mobile-pending",
      text: "等待当前任务结束后发送",
      imageCount: 1,
      createdAtMs: 1_800_000_000_000,
      optimistic: true,
      status: "sending",
    }]);
    expect(mergeQueuedMessagesForDisplay(
      [{ id: "queued-real", text: pending.text, imageCount: 1 }],
      [{ ...pending, status: "queued", queuedMessageId: "queued-real" }],
    )).toEqual([{ id: "queued-real", text: pending.text, imageCount: 1 }]);
  });

  test("hides a confirmed queue card once the same input is the active transcript turn", () => {
    const mergeQueuedMessagesForDisplay = loadMobileQueuedMessageMerger();
    expect(mergeQueuedMessagesForDisplay(
      [{
        id: "queued-real",
        text: "只处理一次",
        imageCount: 0,
        createdAtMs: 9_000,
      }],
      [],
      [{ role: "user", text: "只处理一次", turnId: "turn-current" }],
      { status: "running", turnId: "turn-current", startedAtMs: 10_000 },
    )).toEqual([]);
    expect(mergeQueuedMessagesForDisplay(
      [{ id: "queued-real", text: "下一条再处理", imageCount: 0 }],
      [],
      [{ role: "user", text: "当前任务", turnId: "turn-current" }],
      { status: "running", turnId: "turn-current", startedAtMs: 10_000 },
    )).toHaveLength(1);
    expect(mergeQueuedMessagesForDisplay(
      [{
        id: "queued-intentional-repeat",
        text: "只处理一次",
        imageCount: 0,
        createdAtMs: 11_000,
      }],
      [],
      [{ role: "user", text: "只处理一次", turnId: "turn-current" }],
      { status: "running", turnId: "turn-current", startedAtMs: 10_000 },
    )).toHaveLength(1);
    expect(mergeQueuedMessagesForDisplay(
      [{
        id: "queued-consumed",
        text: "只处理一次",
        imageCount: 0,
        createdAtMs: 9_000,
      }, {
        id: "queued-repeat",
        text: "只处理一次",
        imageCount: 0,
        createdAtMs: 9_500,
      }],
      [],
      [{ role: "user", text: "只处理一次", turnId: "turn-current" }],
      { status: "running", turnId: "turn-current", startedAtMs: 10_000 },
    )).toEqual([{
      id: "queued-repeat",
      text: "只处理一次",
      imageCount: 0,
      createdAtMs: 9_500,
    }]);
  });

  test("does not show transcript or failed pending messages in the composer queue", () => {
    const mergeQueuedMessagesForDisplay = loadMobileQueuedMessageMerger();
    expect(mergeQueuedMessagesForDisplay([], [
      {
        clientId: "sent-directly",
        text: "直接发送",
        imageCount: 0,
        status: "sending",
        displayInTranscript: true,
      },
      {
        clientId: "failed",
        text: "发送失败",
        imageCount: 0,
        status: "failed",
        displayInTranscript: false,
      },
    ])).toEqual([]);
  });

  test("removes an optimistic message as soon as the real user message appears", () => {
    const reconcilePendingMessages = loadMobilePendingMessageReconciler();
    const pending = [{
      clientId: "mobile-new",
      text: "只发送一次",
      imageCount: 0,
      status: "sending",
      baselineUserCount: 20,
      baselineUserKeys: ["id:old-user"],
    }];

    expect(reconcilePendingMessages(pending, [
      { id: "new-user", role: "user", text: "只发送一次" },
    ])).toEqual([]);
  });

  test("shows a timed run header even when the runtime summary is temporarily missing", () => {
    const resolveVisibleRunSummary = loadMobileRunSummaryResolver();
    const nowMs = 1_800_000_100_000;
    const messages = [{ role: "assistant", turnId: "turn-latest" }];

    expect(resolveVisibleRunSummary(
      messages,
      { status: "running", startedAtMs: nowMs - 12_000 },
      null,
      nowMs,
    )).toMatchObject({
      turnId: "turn-latest",
      status: "running",
      startedAtMs: nowMs - 12_000,
      durationMs: 12_000,
    });
    expect(resolveVisibleRunSummary(
      messages,
      { status: "idle" },
      null,
      nowMs,
    )).toBeNull();
    expect(resolveVisibleRunSummary(
      [{ role: "user", turnId: "turn-new" }],
      { status: "idle" },
      {
        turnId: "turn-old",
        status: "completed",
        startedAtMs: nowMs - 20_000,
        durationMs: 15_000,
      },
      nowMs,
    )).toBeNull();
    expect(resolveVisibleRunSummary(
      messages,
      { status: "idle" },
      {
        turnId: "turn-new",
        status: "running",
        startedAtMs: nowMs - 2_000,
        durationMs: 2_000,
      },
      nowMs,
    )).toMatchObject({
      turnId: "turn-new",
      status: "running",
      durationMs: 2_000,
    });
  });

  test("uses the composer button for stop only while running with empty input", () => {
    const shouldUseStopComposerAction = loadMobileComposerActionPredicate();

    expect(shouldUseStopComposerAction(
      { status: "running" },
      { status: "running" },
      false,
    )).toBe(true);
    expect(shouldUseStopComposerAction(
      { status: "running" },
      { status: "running" },
      true,
    )).toBe(false);
    expect(shouldUseStopComposerAction(
      { status: "idle" },
      { status: "completed" },
      false,
    )).toBe(false);
  });

  test("keeps project expansion bounded and resets it after collapsing", () => {
    const helpers = loadMobileTaskSidebarHelpers();
    const collapsedGroups: Record<string, boolean> = {};
    const visibleLimits: Record<string, number> = { "project:alpha": 15 };

    expect(helpers.projectBatchSize).toBe(5);
    expect(helpers.recentBatchSize).toBe(20);
    expect(helpers.nextTaskVisibleLimit(5, 18, 5)).toBe(10);
    expect(helpers.nextTaskVisibleLimit(15, 18, 5)).toBe(18);

    helpers.setProjectGroupCollapsed(
      collapsedGroups,
      visibleLimits,
      "project:alpha",
      true,
    );
    expect(collapsedGroups["project:alpha"]).toBe(true);
    expect(visibleLimits["project:alpha"]).toBeUndefined();

    helpers.setProjectGroupCollapsed(
      collapsedGroups,
      visibleLimits,
      "project:alpha",
      false,
    );
    expect(collapsedGroups["project:alpha"]).toBeUndefined();
    expect(visibleLimits["project:alpha"]).toBe(5);
  });

  test("sorts the recent view by the newest task timestamp", () => {
    const { sortTasksByRecency } = loadMobileTaskSidebarHelpers();
    const tasks = [
      { threadId: "older", lastUpdatedAt: "2026-08-01T12:00:00.000Z" },
      { threadId: "newest", lastUpdatedAt: "2026-08-02T12:00:00.000Z" },
      { threadId: "middle", lastUpdatedAt: "2026-08-02T08:00:00.000Z" },
    ];

    expect(sortTasksByRecency(tasks).map((task) => task.threadId)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
    expect(tasks.map((task) => task.threadId)).toEqual(["older", "newest", "middle"]);
  });

  test("classifies one unified task board without grouping by agent", () => {
    const {
      taskBoardLane,
      taskBoardMatchesQuery,
      formatTaskBoardTime,
    } = loadMobileTaskSidebarHelpers();

    expect(taskBoardLane({ status: "running", completedAt: "2026-08-07T01:00:00.000Z" }))
      .toBe("running");
    expect(taskBoardLane({ status: "approval" })).toBe("waiting");
    expect(taskBoardLane({ status: "input" })).toBe("waiting");
    expect(taskBoardLane({ status: "error" })).toBe("error");
    expect(taskBoardLane({ status: "idle", completedAt: "2026-08-07T01:00:00.000Z" }))
      .toBe("completed");
    expect(taskBoardLane({ status: "idle" })).toBe("queued");
    expect(taskBoardMatchesQuery({
      title: "统一任务看板",
      projectName: "DeskRelay",
      adapterLabel: "Codex",
    }, "codex")).toBe(true);
    expect(formatTaskBoardTime(
      "2026-08-07T02:30:00.000Z",
      Date.parse("2026-08-07T03:00:00.000Z"),
    )).toBe("30 分钟前");
  });

  test("preserves ordered-list numbers when bullet sections split the list", () => {
    const renderMarkdown = loadMobileMarkdownRenderer();
    const html = renderMarkdown([
      "1. 第一项",
      "",
      "- 第一项说明",
      "",
      "2. 第二项",
      "",
      "- 第二项说明",
      "",
      "3. 第三项",
    ].join("\n"));

    expect(html).toContain('<ol start="1"><li value="1">第一项</li></ol>');
    expect(html).toContain('<ol start="2"><li value="2">第二项</li></ol>');
    expect(html).toContain('<ol start="3"><li value="3">第三项</li></ol>');
  });

  test("replaces an accelerated history suffix with the native live tail without duplicates", () => {
    const mergeMessagePages = loadMobileMessagePageMerger();
    const merged = mergeMessagePages(
      [
        { role: "assistant", text: "更早的历史" },
        { role: "assistant", text: "已改好并部署" },
        { role: "user", text: '网页消息顺序不对\n<image path="local.png">' },
        { role: "assistant", text: "[tool_use]" },
        { role: "assistant", text: "正在排查" },
      ],
      [
        {
          id: "native-older",
          turnId: "turn-older",
          role: "user",
          text: "补充一条原生历史",
        },
        {
          id: "native-answer",
          turnId: "turn-previous",
          phase: "final_answer",
          role: "assistant",
          text: "已改好并部署",
        },
        {
          id: "native-user",
          turnId: "turn-current",
          role: "user",
          text: "网页消息顺序不对",
        },
        {
          id: "native-running",
          turnId: "turn-current",
          phase: "final_answer",
          role: "assistant",
          text: "正在排查",
        },
      ],
    );

    expect(merged).toEqual([
      { role: "assistant", text: "更早的历史" },
      {
        id: "native-older",
        turnId: "turn-older",
        role: "user",
        text: "补充一条原生历史",
      },
      {
        id: "native-answer",
        turnId: "turn-previous",
        phase: "final_answer",
        role: "assistant",
        text: "已改好并部署",
      },
      {
        id: "native-user",
        turnId: "turn-current",
        role: "user",
        text: "网页消息顺序不对",
      },
      {
        id: "native-running",
        turnId: "turn-current",
        phase: "final_answer",
        role: "assistant",
        text: "正在排查",
      },
    ]);
  });
});

describe("Codex mobile server", () => {
  test("serves one authenticated task board across adapters", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTaskBoard: async () => ({
        tasks: [
          {
            adapter: "codex",
            adapterLabel: "Codex",
            threadId: "codex-running",
            title: "实现统一任务看板",
            status: "running",
            lastUpdatedAt: "2026-08-07T03:00:00.000Z",
          },
          {
            adapter: "grok",
            adapterLabel: "Grok",
            threadId: "grok-approval",
            title: "检查发布说明",
            status: "approval",
            lastUpdatedAt: "2026-08-07T02:00:00.000Z",
          },
        ],
        recentCompleted: [
          {
            adapter: "workbuddy",
            adapterLabel: "WorkBuddy",
            threadId: "workbuddy-complete",
            title: "修复桌面同步",
            completedAt: "2026-08-07T01:00:00.000Z",
          },
        ],
      }),
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const unauthorized = await fetch(
        `http://127.0.0.1:${server.port}/api/task-board`,
      );
      expect(unauthorized.status).toBe(401);

      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/task-board`,
        { headers: { cookie: sessionCookie } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        tasks: [
          {
            adapter: "codex",
            adapterLabel: "Codex",
            threadId: "codex-running",
            title: "实现统一任务看板",
            status: "running",
            lastUpdatedAt: "2026-08-07T03:00:00.000Z",
          },
          {
            adapter: "grok",
            adapterLabel: "Grok",
            threadId: "grok-approval",
            title: "检查发布说明",
            status: "approval",
            lastUpdatedAt: "2026-08-07T02:00:00.000Z",
          },
        ],
        recentCompleted: [
          {
            adapter: "workbuddy",
            adapterLabel: "WorkBuddy",
            threadId: "workbuddy-complete",
            title: "修复桌面同步",
            completedAt: "2026-08-07T01:00:00.000Z",
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  test("returns a clear recoverable error when the selected adapter is not connected", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => {
        throw new MobileAdapterUnavailableError("TClaude 尚未连接。");
      },
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/tasks?adapter=tclaude`,
        { headers: { cookie: sessionCookie } },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "TClaude 尚未连接。" });
    } finally {
      await server.close();
    }
  });

  test("renames a real task through the mobile API", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    let title = "原任务名";
    const renames: Array<{ threadId: string; title: string; adapter?: string }> = [];
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [{
        threadId: "thread-rename",
        title,
        status: "idle",
        canRename: true,
      }],
      renameTask: async (threadId, nextTitle, adapter) => {
        renames.push({ threadId, title: nextTitle, adapter });
        title = nextTitle;
      },
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/tasks/thread-rename?adapter=codex`,
        {
          method: "PATCH",
          headers: {
            cookie: sessionCookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ title: "  新任务名  " }),
        },
      );
      expect(response.status).toBe(200);
      expect(renames).toEqual([{
        threadId: "thread-rename",
        title: "新任务名",
        adapter: "codex",
      }]);
      expect(await response.json()).toEqual({
        ok: true,
        threadId: "thread-rename",
        title: "新任务名",
      });
    } finally {
      await server.close();
    }
  });

  test("rejects invalid or unsupported mobile task renames", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [{
        threadId: "thread-readonly",
        title: "只读任务",
        status: "idle",
        canRename: false,
      }],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const empty = await fetch(`${root}/api/tasks/thread-readonly`, {
        method: "PATCH",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "   " }),
      });
      expect(empty.status).toBe(400);
      expect(await empty.json()).toEqual({ error: "任务名不能为空。" });

      const unsupported = await fetch(`${root}/api/tasks/thread-readonly`, {
        method: "PATCH",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "新名称" }),
      });
      expect(unsupported.status).toBe(409);
      expect(await unsupported.json()).toEqual({ error: "当前连接暂不支持重命名任务。" });
    } finally {
      await server.close();
    }
  });

  test("opens the LAN listener only when the password gate protects a public deployment", () => {
    expect(resolveCodexMobileListenHost({
      publicBaseUrl: "https://198.51.100.10/",
    })).toBe("127.0.0.1");
    expect(resolveCodexMobileListenHost({
      publicBaseUrl: "https://198.51.100.10/",
      authStore: createAuthStore("a configured mobile password"),
    })).toBe("0.0.0.0");
    expect(resolveCodexMobileListenHost({})).toBe("0.0.0.0");
    expect(resolveCodexMobileListenHost({
      host: "192.168.50.10",
      publicBaseUrl: "https://198.51.100.10/",
    })).toBe("192.168.50.10");
  });

  test("hands an authenticated public session to LAN once and preserves the selected task", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const publicCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "192.168.50.10",
      publicBaseUrl: "https://198.51.100.10/",
      accessToken: "mobile-secret",
      authStore,
      resolveDesktopPublicAddress: async () => "203.0.113.10",
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const proxyHeaders = {
        cookie: publicCookie,
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.10",
      };
      const routeResponse = await fetch(`${root}/api/network-route`, {
        headers: proxyHeaders,
      });
      expect(routeResponse.status).toBe(200);
      expect(await routeResponse.json()).toEqual({
        mode: "public",
        publicUrl: "https://198.51.100.10",
        lanUrl: `http://192.168.50.10:${server.port}`,
        sameNetworkLikely: true,
      });

      const handoffResponse = await fetch(`${root}/api/network/lan-handoff`, {
        method: "POST",
        headers: {
          ...proxyHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target: "/?adapter=codex&task=thread-1&appv=test&setup=must-not-survive",
        }),
      });
      expect(handoffResponse.status).toBe(200);
      const handoff = await handoffResponse.json() as { handoffUrl: string };
      const handoffUrl = new URL(handoff.handoffUrl);
      expect(handoffUrl.origin).toBe(`http://192.168.50.10:${server.port}`);
      expect(handoffUrl.pathname).toBe("/lan-entry");
      expect(handoffUrl.searchParams.get("handoff")).toBeTruthy();

      const rejectedPublicEntry = await fetch(
        `${root}${handoffUrl.pathname}${handoffUrl.search}`,
        {
          headers: {
            "x-forwarded-proto": "https",
            "x-real-ip": "203.0.113.10",
          },
          redirect: "manual",
        },
      );
      expect(rejectedPublicEntry.status).toBe(400);

      const lanEntry = await fetch(`${root}${handoffUrl.pathname}${handoffUrl.search}`, {
        redirect: "manual",
      });
      expect(lanEntry.status).toBe(302);
      expect(lanEntry.headers.get("location")).toBe(
        "/?adapter=codex&task=thread-1&appv=test",
      );
      expect(lanEntry.headers.get("set-cookie")).toContain("codex_mobile_session=");
      expect(lanEntry.headers.get("set-cookie")).not.toContain("; Secure");
      const lanCookie = lanEntry.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
      expect(lanCookie).toStartWith("codex_mobile_session=");

      const lanTasks = await fetch(`${root}/api/tasks`, {
        headers: { cookie: lanCookie },
      });
      expect(lanTasks.status).toBe(200);

      const rejectedOnPublic = await fetch(`${root}/api/tasks`, {
        headers: {
          cookie: lanCookie,
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.10",
        },
      });
      expect(rejectedOnPublic.status).toBe(401);

      const replay = await fetch(`${root}${handoffUrl.pathname}${handoffUrl.search}`, {
        redirect: "manual",
      });
      expect(replay.status).toBe(410);
    } finally {
      await server.close();
    }
  });

  test("does not offer automatic LAN switching when public source addresses differ", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "192.168.50.10",
      publicBaseUrl: "https://198.51.100.10/",
      accessToken: "mobile-secret",
      authStore,
      resolveDesktopPublicAddress: async () => "203.0.113.10",
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const response = await fetch(`${root}/api/network-route`, {
        headers: {
          cookie: sessionCookie,
          "x-forwarded-proto": "https",
          "x-real-ip": "198.51.100.22",
        },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        mode: "public",
        publicUrl: "https://198.51.100.10",
        lanUrl: `http://192.168.50.10:${server.port}`,
        sameNetworkLikely: false,
      });
    } finally {
      await server.close();
    }
  });

  test("prefers a private IPv4 address on a physical network interface", () => {
    expect(
      resolvePreferredLanAddress({
        utun0: [
          {
            address: "10.8.0.2",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: "10.8.0.2/24",
          },
        ],
        en0: [
          {
            address: "192.168.50.10",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:01",
            internal: false,
            cidr: "192.168.50.10/24",
          },
        ],
      }),
    ).toBe("192.168.50.10");
  });

  test("prefers a configured public URL when building task links", async () => {
    const authStore = createAuthStore();
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "192.168.50.10",
      publicBaseUrl: "http://198.51.100.10/",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [],
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      expect(server.buildTaskUrl("0000000a-0000-7000-8000-00000000000a")).toBe(
        `http://198.51.100.10/?task=0000000a-0000-7000-8000-00000000000a&appv=${CODEX_MOBILE_ASSET_VERSION}&setup=mobile-secret`,
      );
    } finally {
      await server.close();
    }
  });

  test("passes opaque message cursors through to the transcript reader", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const reads: Array<{ threadId: string; before?: string | null; limit?: number }> = [];
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [{
        threadId: "thread-page",
        title: "分页任务",
        status: "idle",
      }],
      readMessages: async (threadId, options) => {
        reads.push({ threadId, ...options });
        return {
          threadId,
          messages: [{ role: "user", text: "较早消息" }],
          messagePage: {
            hasMore: true,
            nextBefore: "byte:128",
          },
          queuedMessages: [],
        };
      },
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/tasks/thread-page/messages?limit=25&before=byte%3A256`,
        { headers: { cookie: sessionCookie } },
      );
      expect(response.status).toBe(200);
      expect(reads).toEqual([{
        threadId: "thread-page",
        before: "byte:256",
        limit: 25,
        lightweight: true,
      }]);
      expect(await response.json()).toMatchObject({
        messages: [{ role: "user", text: "较早消息" }],
        messagePage: {
          hasMore: true,
          nextBefore: "byte:128",
        },
      });
    } finally {
      await server.close();
    }
  });

  test("reads a directly addressed task without waiting for the task list", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    let listCalls = 0;
    const reads: Array<{
      threadId: string;
      historyOnly?: boolean;
      limit?: number;
      lightweight?: boolean;
    }> = [];
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => {
        listCalls += 1;
        await Bun.sleep(80);
        return [];
      },
      readMessages: async (threadId, options) => {
        reads.push({ threadId, ...options });
        return {
          threadId,
          messages: [{ role: "assistant", text: "历史正文" }],
          queuedMessages: [],
        };
      },
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const startedAt = performance.now();
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/tasks/direct-thread/messages?limit=40&history=1`,
        { headers: { cookie: sessionCookie } },
      );
      const elapsedMs = performance.now() - startedAt;
      expect(response.status).toBe(200);
      expect(listCalls).toBe(0);
      expect(elapsedMs).toBeLessThan(70);
      expect(reads).toEqual([{
        threadId: "direct-thread",
        historyOnly: true,
        limit: 40,
        lightweight: true,
      }]);
      expect(await response.json()).toMatchObject({
        task: null,
        threadId: "direct-thread",
        messages: [{ role: "assistant", text: "历史正文" }],
      });
    } finally {
      await server.close();
    }
  });

  test("serves the responsive app and authenticated task APIs", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const fullLongAssistantMessage = `完整回答开始\n\n${"这是网页必须保留的完整内容。".repeat(180)}\n\n完整回答结束`;
    const resolvedApprovals: Array<{ threadId: string; action: string }> = [];
    const sent: Array<{
      threadId: string;
      input: {
        text: string;
        images: Array<{ fileName: string; mimeType: string; data: Buffer }>;
      };
    }> = [];
    const stopped: string[] = [];
    const switchedAdapters: string[] = [];
    const queueActions: Array<{
      action: "update" | "delete" | "steer";
      threadId: string;
      messageId: string;
      text?: string;
    }> = [];
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "192.168.50.10",
      accessToken: "mobile-secret",
      authStore,
      listAdapters: async () => ({
        activeAdapter: "codex",
        adapters: [
          { id: "codex", label: "Codex", status: "running", active: true },
          { id: "workbuddy", label: "WorkBuddy", status: "idle", active: false },
        ],
      }),
      switchAdapter: async (adapter) => {
        switchedAdapters.push(adapter);
        return {
          activeAdapter: adapter,
          activated: true,
          detail: `已切换到 ${adapter}`,
        };
      },
      listTasks: async () => [
        {
          threadId: "0000000a-0000-7000-8000-00000000000a",
          title: "继续完善微信 Codex",
          projectName: "new-chat",
          lastUpdatedAt: "2026-08-02T16:00:00.000Z",
          status: "running",
          startedAtMs: 1_800_000_000_000,
          selected: true,
        },
      ],
      readMessages: async (threadId) => ({
        threadId,
        messages: [
          { role: "user", text: "做一个移动端页面" },
          { role: "assistant", text: "正在实现。", phase: "commentary" },
          {
            role: "assistant",
            text: fullLongAssistantMessage,
            phase: "final_answer",
            model: "gpt-5.6-sol",
          },
        ],
        queuedMessages: [
          {
            id: "queued-wechat",
            text: "修改任务列表说明",
            imageCount: 0,
            createdAtMs: 1_800_000_000_001,
          },
          {
            id: "queued-mobile",
            text: "收到请回复ok",
            imageCount: 1,
            createdAtMs: 1_800_000_000_002,
          },
        ],
        runSummary: {
          turnId: "turn-running",
          status: "running",
          startedAtMs: 1_780_000_000_000,
          durationMs: 73_000,
        },
        progressItems: [
          {
            id: "plan-running",
            turnId: "turn-running",
            kind: "plan",
            status: "running",
            text: "第 2 / 4 步 · 同步网页进展",
          },
          {
            id: "command-running",
            turnId: "turn-running",
            kind: "command",
            status: "completed",
            text: "已读取文件并运行命令",
          },
        ],
        pendingApproval: {
          summary: "Codex 请求运行命令。",
          commandPreview: "npm run quality",
          allowForSession: true,
          detailLabel: "运行命令",
          detailPreview: "npm run quality",
        },
        approvalResults: [
          {
            id: "approval-denied",
            action: "deny",
            turnId: "turn-previous",
            summary: "Codex 请求删除文件。",
            commandPreview: "rm obsolete.txt",
            resolvedAt: "2026-08-08T01:00:00.000Z",
          },
        ],
      }),
      sendMessage: async (threadId, input) => {
        if (input.text === "触发失败") {
          throw new Error("这个任务暂时不能发送消息。");
        }
        sent.push({ threadId, input });
        return { queued: false, turnId: "turn-new" };
      },
      resolveApproval: async (threadId, action) => {
        resolvedApprovals.push({ threadId, action });
        return {
          count: 1,
          result: {
            id: "approval-confirmed",
            action,
            turnId: "turn-running",
            summary: "Codex 请求运行命令。",
            commandPreview: "npm run quality",
            detailLabel: "运行命令",
            detailPreview: "npm run quality",
            resolvedAt: "2026-08-08T01:02:00.000Z",
          },
        };
      },
      updateQueuedMessage: async (threadId, messageId, text) => {
        queueActions.push({ action: "update", threadId, messageId, text });
        return true;
      },
      deleteQueuedMessage: async (threadId, messageId) => {
        queueActions.push({ action: "delete", threadId, messageId });
        return true;
      },
      steerQueuedMessage: async (threadId, messageId) => {
        queueActions.push({ action: "steer", threadId, messageId });
        return true;
      },
      stopTask: async (threadId) => {
        stopped.push(threadId);
        return true;
      },
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const htmlResponse = await fetch(`${root}/`);
      const html = await htmlResponse.text();
      expect(htmlResponse.status).toBe(200);
      expect(html).toContain('name="viewport"');
      expect(html).toContain('id="boot-status"');
      expect(html).toContain("<title>DeskRelay</title>");
      const cssVersion = html.match(/href="\/app\.css\?appv=([a-f0-9]+)"/i)?.[1];
      const jsVersion = html.match(/src="\/app\.js\?appv=([a-f0-9]+)"/i)?.[1];
      expect(cssVersion).toBeTruthy();
      expect(jsVersion).toBe(cssVersion);
      const versionResponse = await fetch(`${root}/app-version`);
      expect(versionResponse.status).toBe(200);
      expect(await versionResponse.json()).toEqual({ version: cssVersion });
      expect(html).toContain("从手机继续任务");
      expect(html).toContain('id="boot-screen" aria-label="正在打开 DeskRelay"');
      expect(html).not.toContain('class="brand-title"');
      expect(html).toContain('id="workspace-switcher"');
      expect(html).toContain('class="workspace-product">DeskRelay</span>');
      expect(html).toContain('class="workspace-divider">·</span>');
      expect(html).toContain('id="adapter-menu"');
      expect(html).not.toContain('id="composer-status"');
      expect(html).toContain('id="composer-queue"');
      expect(html).toContain('id="auth-screen" aria-labelledby="auth-title" hidden');
      expect(html).toContain('id="auth-form"');
      expect(html).toContain('id="auth-security-warning"');
      expect(html).toContain('id="task-view-projects"');
      expect(html).toContain('id="task-view-recent"');
      expect(html).toContain("当前连接未启用 HTTPS");
      expect(html).not.toContain('class="product-connection"');
      expect(html).toContain('id="workspace-menu"');
      expect(html).not.toContain('id="product-menu-button"');
      expect(html).not.toContain('id="adapter-switcher"');
      expect(html).toContain('class="workspace-menu-divider"');
      expect(html).toContain('class="workspace-menu-item" href="/about"');
      expect(html).not.toContain('class="sidebar-foot"');
      expect(html).not.toContain('id="jump-latest"');
      expect(html).toContain('id="previous-user-message"');
      expect(html).toContain('id="next-user-message"');
      expect(html).toContain('id="task-context-menu"');
      expect(html).toContain('id="task-context-rename"');
      expect(html).toContain('id="task-context-copy-id"');
      expect(html).toContain('id="task-rename-overlay"');
      expect(html).toContain('id="task-rename-input"');
      expect(html).not.toContain('aria-label="添加文件等"');
      expect(html).toContain('aria-label="添加图片"');
      expect(html).toContain('<path d="M12 5v14M5 12h14"/>');
      expect(html).toContain('class="send-stop-icon"');
      expect(html).toContain('<rect x="5" y="5" width="14" height="14" rx="2.2"/>');
      expect(html).not.toContain('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/>');
      expect(html).toContain('id="composer-image-input"');
      const composerStart = html.indexOf('<div class="composer">');
      const composerEnd = html.indexOf("</div>\n      </form>", composerStart);
      const composerMediaIndex = html.indexOf('id="composer-media"');
      expect(composerStart).toBeGreaterThan(-1);
      expect(composerMediaIndex).toBeGreaterThan(composerStart);
      expect(composerMediaIndex).toBeLessThan(composerEnd);
      expect(html).not.toContain("Codex 也可能会犯错。请核查重要信息。");
      expect(html).not.toContain('class="brand-mark"');
      expect(html).not.toContain('class="empty-logo"');
      expect(html).toContain('id="task-board-open"');
      expect(html).toContain('id="task-board-view-completed"');
      expect(html).toContain('id="task-board-body"');
      const sidebarHeadStart = html.indexOf('<div class="sidebar-head">');
      const sidebarHeadEnd = html.indexOf("</div>\n      <nav class=\"sidebar-primary-nav\"", sidebarHeadStart);
      const workspaceSwitcherIndex = html.indexOf('id="workspace-switcher"');
      const topbarCopyStart = html.indexOf('<div class="topbar-copy">');
      const topbarCopyEnd = html.indexOf("</div>\n        <div class=\"topbar-actions\">", topbarCopyStart);
      expect(workspaceSwitcherIndex).toBeGreaterThan(sidebarHeadStart);
      expect(workspaceSwitcherIndex).toBeLessThan(sidebarHeadEnd);
      expect(html.slice(topbarCopyStart, topbarCopyEnd)).not.toContain('id="workspace-switcher"');

      const aboutResponse = await fetch(`${root}/about`);
      const aboutHtml = await aboutResponse.text();
      expect(aboutResponse.status).toBe(200);
      expect(aboutHtml).toContain("<title>项目说明 · DeskRelay</title>");
      expect(aboutHtml).toContain("ONE REAL SESSION. EVERY SCREEN.");
      expect(aboutHtml).toContain("电脑端持有唯一真实任务");
      expect(aboutHtml).toContain('class="about-logo" href="/about">DeskRelay</a>');
      expect(aboutHtml).toContain('class="about-open-app" href="/">打开任务</a>');

      const cssResponse = await fetch(`${root}/app.css`);
      const css = await cssResponse.text();
      expect(cssResponse.status).toBe(200);
      expect(css).toContain("--thread-max: 48rem;");
      expect(css).toContain("border-radius: 28px;");
      expect(css).toContain(".composer {\n  display: grid;");
      expect(css).toContain("grid-template-columns: 36px minmax(0, 1fr) 36px;");
      expect(css).toContain("align-items: flex-end;");
      expect(css).toContain("gap: 4px;");
      expect(css).toContain("min-height: 52px;");
      expect(css).toContain(".send-button { width: 36px; height: 36px;");
      expect(css).toContain(".send-button .send-stop-icon { width: 20px; height: 20px;");
      expect(css).not.toContain("grid-template-areas:");
      expect(css).toContain(".topbar { position: absolute; top: 0;");
      expect(css).toContain(".sidebar {\n  height: 100%;\n  min-height: 0;");
      expect(css).toContain("overflow: hidden;");
      expect(css).toContain(".task-list { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto;");
      expect(css).toContain(".task-view-switch {");
      expect(css).toContain(".task-board-columns {");
      expect(css).toContain(".task-board-completed {");
      expect(css).toContain(".task-group-title {");
      expect(css).toContain(".task-group { margin: 0; }");
      expect(css).toContain(".task-group:not(.is-recent) .task-group-items .task-item,");
      expect(css).toContain(".task-group:not(.is-recent) .task-group-more { padding-left: 28px; }");
      expect(css).toContain(".message-navigation {");
      expect(css).toContain("left: auto;");
      expect(css).toContain("right: max(24px, calc((100% - var(--thread-max)) / 2));");
      expect(css).toContain("top: 68px;");
      expect(css).toContain("opacity: .62;");
      expect(css).not.toContain("left: max(24px, calc((100% - var(--thread-max)) / 2));");
      expect(css).toContain(".task-group-more");
      expect(css).toContain(".task-context-menu {");
      expect(css).toContain(".task-rename-overlay {");
      expect(css).toContain("-webkit-touch-callout: none;");
      expect(css).toContain(".task-status-badge.approval { display: inline-flex; }");
      expect(css).toContain(".task-dot.running { visibility: visible; background: var(--green); animation: task-dot-breathe");
      expect(css).toContain("@keyframes task-dot-breathe");
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
      expect(css).toContain("padding: 38px 24px 112px;");
      expect(css).toContain("margin: 0 auto 20px;");
      expect(css).toContain("padding: 20px 24px max(12px, env(safe-area-inset-bottom));");
      expect(css).toContain(".about-hero h1 {");
      expect(css).toContain(".about-flow {");
      expect(css).toContain("border-radius: 6px;");
      expect(css).toContain("visibility: hidden;");
      expect(css).toContain("-webkit-tap-highlight-color: transparent;");
      expect(css).toContain("touch-action: manipulation;");
      expect(css).toContain(".message-content h1, .message-content h2, .message-content h3, .message-content h4, .message-content h5, .message-content h6");
      expect(css).toContain("font-size: inherit;");
      expect(css).toContain("font-weight: inherit;");
      expect(css).toContain(".message-row.assistant .message-card { width: 100%; color: var(--text); font-size: 15px; line-height: 1.62; }");
      expect(css).toContain(".message-row.assistant.continues { margin-bottom: 10px; }");
      expect(css).toContain(".message-row.assistant.commentary .message-card { padding-left: 0; border-left: 0; color: var(--text); }");
      expect(css).not.toContain(".message-row.assistant.commentary .message-card { padding-left: 0; border-left: 0; color: var(--text); font-size: inherit;");
      expect(css).toContain(".message-content strong { font-weight: 620; }");
      expect(css).not.toContain(".message-role {");
      expect(css).toContain(".message-content { -webkit-user-select: text;");
      expect(css).toContain(".message-model { margin-top: 10px;");
      expect(css).toContain(".app-shell:not(.sidebar-open) .sidebar");
      expect(css).toContain("pointer-events: none;");
      expect(css).toContain(".response-pending {");
      expect(css).toContain("@keyframes response-pending-dot");
      expect(css).toContain(".run-progress-item {");
      expect(css).toContain(".workspace-switch-progress");
      expect(css).toContain(".queued-followup-status");
      expect(css).toContain("@media (hover: none) and (pointer: coarse)");
      expect(css).toContain(".icon-button:active, .composer-image-button:active");

      const jsResponse = await fetch(`${root}/app.js`);
      const js = await jsResponse.text();
      expect(jsResponse.status).toBe(200);
      expect(js).toContain("scheduleLiveRefresh");
      expect(js).toContain('document.addEventListener("visibilitychange"');
      expect(js).toContain("renderQueuedMessages");
      expect(js).toContain('var continues = message.role === "assistant" && nextMessage && nextMessage.role === "assistant"');
      expect(js).not.toContain('message.phase === "commentary" ? "工作过程" : ""');
      expect(js).toContain('group.key === "recent" ? " is-recent" : ""');
      expect(js).toContain("resolveUserMessageNavigation");
      expect(js).toContain("updateUserMessageNavigation");
      expect(js).toContain("navigateToUserMessage");
      expect(js).toContain('previousUserMessage.addEventListener("click"');
      expect(js).toContain('button.addEventListener("contextmenu"');
      expect(js).toContain('button.addEventListener("pointerdown"');
      expect(js).toContain('navigator.clipboard.writeText');
      expect(js).toContain('openTaskRenameDialog');
      expect(js).toContain('closeTaskContextMenu');
      expect(js).toContain('nextUserMessage.addEventListener("click"');
      expect(js).toContain("toggleWorkspaceMenu");
      expect(js).toContain('document.title = "DeskRelay \\u00B7 " + currentAdapterName();');
      expect(js).toContain('var requestedAdapter = pageUrl.searchParams.get("adapter") || "";');
      expect(js).toContain('requestedAdapter !== adapterPayload.activeAdapter');
      expect(js).toContain('if (!initial) canonicalUrl.searchParams.delete("task");');
      expect(js).toContain('if (requestedAdapter) state.currentAdapter = requestedAdapter;');
      expect(js).toContain("state.loadingTasks = needsInitialTask;");
      expect(js).toContain('messagesEl.innerHTML = \'<div class="loading-row">');
      expect(js).toContain("escapeHtml(currentAdapterName())");
      expect(js).toContain('updateDocumentTitle();\n  initializeAuthentication();');
      expect(js).toContain("mergeQueuedMessagesForDisplay");
      expect(js).toContain("switchingAdapterId");
      expect(js).toContain("switchProgressLabel");
      expect(js.match(/switchProgressLabel\(state\.switchStartedAtMs, Date\.now\(\)\)/g)).toHaveLength(1);
      expect(js).toContain("workspaceSwitchProgress.hidden = true;");
      expect(js).toContain("syncChildOrder(taskList, []);");
      expect(js).not.toContain('"正在连接 " + switchingAdapterName()');
      expect(js).not.toContain('showToast("正在连接 " + adapterName(adapterId) + "…")');
      expect(js).toContain('status.className = "queued-followup-status"');
      expect(js).toContain("renderQueuedMessages(state.queuedMessages);\n    renderMessages(true);\n    submitPendingMessage(pending);");
      expect(js).toContain("initializeAuthentication");
      expect(js).toContain("attemptLanAcceleration");
      expect(js).toContain("deskrelayLanRedirectAttemptedAt");
      expect(js).toContain("route.sameNetworkLikely");
      expect(js).toContain("bootStatus.textContent =");
      expect(js).toContain("window.location.assign(handoff.handoffUrl)");
      expect(js).toContain("updateAuthSecurityWarning");
      expect(js).toContain("pendingMessages");
      expect(js).toContain("messageRequestId");
      expect(js).toContain("taskRequestId");
      expect(js).toContain("requestedThreadId !== state.currentThreadId");
      expect(js).toContain("pending.threadId");
      expect(js).toContain("composerRevision");
      expect(js).toContain("composerInput.value = \"\";");
      expect(js).toContain("requestedComposerRevision !== state.composerRevision");
      expect(js).toContain("renderRunHeader");
      expect(js).toContain("runHeaderLabel");
      expect(js).toContain("renderApprovalCard");
      expect(js).toContain("renderProgressList");
      expect(js).toContain("visibleMessageModel(message)");
      expect(js).toContain('class="message-model"');
      expect(js).toContain("progressItems");
      expect(js).toContain("filterProgressItemsForCurrentTurn");
      expect(js).toContain("state.progressItems = filterProgressItemsForCurrentTurn(");
      expect(js).toContain("\\u7B49\\u5F85\\u786E\\u8BA4");
      expect(js).toContain("resolveVisibleRunSummary");
      expect(js).toContain("stopCurrentTask");
      expect(js).toContain("shouldUseStopComposerAction");
      expect(js).toContain('sendButton.classList.toggle("is-stop"');
      expect(js).toContain("pending.optimisticRun = true;");
      expect(js).not.toContain('class="run-stop-button"');
      expect(js).toContain("\\u5DF2\\u5B8C\\u6210");
      expect(js).toContain("if (!summary.completedAtMs || !summary.startedAtMs) return 0;");
      expect(js).toContain("updateRunSummary(payload.runSummary || null, payload.task || null);");
      expect(js).toContain('var LIVE_MESSAGE_PAGE_SIZE = 5;');
      expect(js).toContain('historyOnly ? "&history=1" : ""');
      expect(js).toContain('selectTask(requestedTask, false)');
      expect(js).toContain('state.nextTaskRefreshAtMs');
      expect(js).not.toContain('state.historySource === "openagentlog"');
      expect(js).toContain('forceFullPage ? MESSAGE_PAGE_SIZE : LIVE_MESSAGE_PAGE_SIZE');
      expect(js).toContain('void loadMessages(false, false, false);');
      expect(js).toContain('task.status === "running" || task.status === "approval" || task.status === "input"');
      expect(js).toContain("\\u6B63\\u5728\\u5904\\u7406");
      expect(js).not.toContain("codexMobileKey");
      expect(js).not.toContain("x-codex-mobile-key");
      expect(js).toContain("syncChildOrder");
      expect(js).toContain("taskGroupKey");
      expect(js).toContain("PROJECT_TASK_BATCH_SIZE = 5");
      expect(js).toContain("RECENT_TASK_BATCH_SIZE = 20");
      expect(js).toContain("setProjectGroupCollapsed");
      expect(js).toContain("sortTasksByRecency");
      expect(js).toContain("renderRecentTasks");
      expect(js).toContain('class="task-status-badge"');
      expect(js).toContain('task.status === "approval" ? "\\u5BA1\\u6279" : ""');
      expect(js).toContain("task-view-projects");
      expect(js).toContain("taskList.scrollTop = 0;");
      expect(js).toContain("MESSAGE_PAGE_SIZE = 40");
      expect(js).toContain("loadOlderMessages");
      expect(js).toContain('messagesEl.scrollTop < 120');
      expect(js).toContain('"/messages?limit=" + MESSAGE_PAGE_SIZE');
      expect(js).toContain('"&before=" + encodeURIComponent(before)');
      expect(js).toContain("state.historyRequestId += 1;");
      expect(js).toContain("state.historyMessages = [];");
      expect(js).toContain("mergeMessagePages");
      expect(js).toContain("state.oldestMessageCursor");
      expect(js).toContain('canonicalUrl.searchParams.set("task", chosen.threadId);');
      expect(js).not.toContain("connection-dot");
      expect(js).not.toContain("connection-label");
      expect(js).not.toContain("setConnection(");
      expect(js).not.toContain('taskList.innerHTML = ""');
      expect(js).toContain("addImageFiles");
      expect(js).toContain('composerInput.addEventListener("paste"');
      expect(js).not.toContain('composerTool.addEventListener("click"');
      expect(js).not.toContain("defaultComposerStatus");
      expect(js).not.toContain("已加入队列，前面还有");
      expect(js).toContain("steerQueuedMessage");
      expect(js).not.toContain("saveQueuedMessage");
      expect(js).toContain("beginQueuedMessageEdit");
      expect(js).toContain('replace(/\\s+/g, " ")');
      expect(js).toContain("message.id === state.editingQueuedMessageId");
      expect(js).toContain("submitQueuedMessageEdit");
      expect(js).toContain("loadAdapters");
      expect(js).toContain("loadTaskBoard");
      expect(js).toContain('api("/api/task-board")');
      expect(js).toContain("openTaskFromBoard");
      expect(js).toContain("switchAdapter");
      expect(js).toContain("deleteQueuedMessage");
      expect(js).not.toContain("state.queuedMessages.concat");
      expect(js).toContain("message.clientId !== pending.clientId");
      expect(js).toContain('pending.displayInTranscript = true;');
      const startAuthenticatedAppIndex = js.indexOf("function startAuthenticatedApp");
      const appVisibleIndex = js.indexOf("app.hidden = false;", startAuthenticatedAppIndex);
      expect(appVisibleIndex).toBeLessThan(
        js.indexOf("adapterPayload = await loadAdapters();", startAuthenticatedAppIndex),
      );
      expect(appVisibleIndex).toBeLessThan(js.indexOf("await loadTasks(true);", startAuthenticatedAppIndex));
      expect(js.indexOf("scheduleLiveRefresh(2200);", js.indexOf("function startAuthenticatedApp")))
        .toBeGreaterThan(js.indexOf("await loadTasks(true);"));
      expect(js).toContain("Math.max(96, composerHeight + 16)");
      expect(js).not.toContain("messageNavigation.style.bottom");
      expect(js).not.toContain('if (pending.status === "sending") return true;');
      expect(js).toContain("baselineUserKeys");
      expect(js).not.toContain('pending.status === "failed" || pending.status === "sending"');
      expect(js).toContain('pending.status = uncertain ? "unconfirmed" : "failed";');
      expect(js).toContain('var stillPending = state.pendingMessages.some');
      expect(js).toContain('message.status === "unconfirmed"');
      expect(js).toContain('if (result.duplicate)');
      expect(js).toContain("\\u4E0E\\u6700\\u8FD1\\u4E00\\u6761\\u6D88\\u606F\\u76F8\\u540C\\uFF0C\\u672A\\u91CD\\u590D\\u53D1\\u9001");
      expect(js).toContain("renderResponsePendingIndicator");
      expect(js).toContain("messagesEl.appendChild(responsePending)");
      expect(js).toContain("captureOpenFoldState");
      expect(js).toContain("restoreOpenFoldState");
      expect(js).toContain('messagesEl.dataset.threadId !== state.currentThreadId');
      expect(js).toContain("document.elementFromPoint(longPressStartX, longPressStartY)");
      expect(js).toContain("hasActiveTextSelection()");
      expect(js).toContain('app.classList.contains("sidebar-open")');
      expect(js).toContain('document.addEventListener("selectionchange"');
      expect(js).toContain('messagesEl.addEventListener("selectstart"');
      expect(js).toContain('messagesEl.addEventListener("contextmenu"');
      expect(js).toContain("isTaskContextMenuTriggerAllowed");
      expect(js).toContain("checkForAppUpdate");
      expect(js).toContain('window.addEventListener("pageshow"');
      expect(() => new Function(js)).not.toThrow();

      expect(server.buildTaskUrl("0000000a-0000-7000-8000-00000000000a")).toBe(
        `http://192.168.50.10:${server.port}/?task=0000000a-0000-7000-8000-00000000000a&appv=${CODEX_MOBILE_ASSET_VERSION}`,
      );

      const unauthorized = await fetch(`${root}/api/tasks`);
      expect(unauthorized.status).toBe(401);

      const headers = { cookie: sessionCookie };
      const adaptersResponse = await fetch(`${root}/api/adapters`, { headers });
      expect(adaptersResponse.status).toBe(200);
      expect(await adaptersResponse.json()).toEqual({
        activeAdapter: "codex",
        adapters: [
          { id: "codex", label: "Codex", status: "running", active: true },
          { id: "workbuddy", label: "WorkBuddy", status: "idle", active: false },
        ],
      });
      const switchResponse = await fetch(`${root}/api/adapters/workbuddy/switch`, {
        method: "POST",
        headers,
      });
      expect(switchResponse.status).toBe(200);
      expect(await switchResponse.json()).toEqual({
        activeAdapter: "workbuddy",
        activated: true,
        detail: "已切换到 workbuddy",
      });
      expect(switchedAdapters).toEqual(["workbuddy"]);
      const tasksResponse = await fetch(`${root}/api/tasks`, { headers });
      const tasks = await tasksResponse.json() as {
        tasks: Array<{ threadId: string; status: string; lastUpdatedAt?: string }>;
      };
      expect(tasks.tasks[0]).toMatchObject({
        threadId: "0000000a-0000-7000-8000-00000000000a",
        status: "running",
        lastUpdatedAt: "2026-08-02T16:00:00.000Z",
      });

      const messagesResponse = await fetch(
        `${root}/api/tasks/0000000a/messages`,
        { headers },
      );
      const transcript = await messagesResponse.json() as {
        threadId: string;
        messages: Array<{ role: string; text: string }>;
        messagePage: {
          start: number;
          end: number;
          total: number;
          hasMore: boolean;
          nextBefore: number | null;
        };
        queuedMessages: Array<{
          id: string;
          text: string;
          imageCount: number;
          createdAtMs?: number;
        }>;
        runSummary: { turnId?: string; status: string; durationMs?: number } | null;
        progressItems: Array<{
          id: string;
          kind: string;
          status: string;
          text: string;
        }>;
        pendingApproval: {
          summary: string;
          commandPreview: string;
          allowForSession?: boolean;
        } | null;
        approvalResults: Array<{
          id: string;
          action: string;
          turnId?: string;
          summary: string;
          commandPreview: string;
          resolvedAt: string;
        }>;
      };
      expect(transcript.threadId).toBe(
        "0000000a-0000-7000-8000-00000000000a",
      );
      expect(transcript.messages).toHaveLength(3);
      expect(transcript.messages[2]?.text).toBe(fullLongAssistantMessage);
      expect(transcript.messages[2]?.text.endsWith("完整回答结束")).toBe(true);
      expect(transcript.messagePage).toEqual({
        start: 0,
        end: 3,
        total: 3,
        hasMore: false,
        nextBefore: null,
      });
      expect(transcript.queuedMessages).toEqual([
        {
          id: "queued-wechat",
          text: "修改任务列表说明",
          imageCount: 0,
          createdAtMs: 1_800_000_000_001,
        },
        {
          id: "queued-mobile",
          text: "收到请回复ok",
          imageCount: 1,
          createdAtMs: 1_800_000_000_002,
        },
      ]);
      expect(transcript.runSummary).toMatchObject({
        turnId: "turn-running",
        status: "running",
        durationMs: 73_000,
      });
      expect(transcript.progressItems).toEqual([
        {
          id: "plan-running",
          turnId: "turn-running",
          kind: "plan",
          status: "running",
          text: "第 2 / 4 步 · 同步网页进展",
        },
        {
          id: "command-running",
          turnId: "turn-running",
          kind: "command",
          status: "completed",
          text: "已读取文件并运行命令",
        },
      ]);
      expect(transcript.pendingApproval).toMatchObject({
        summary: "Codex 请求运行命令。",
        commandPreview: "npm run quality",
        allowForSession: true,
      });
      expect(transcript.approvalResults).toEqual([
        {
          id: "approval-denied",
          action: "deny",
          turnId: "turn-previous",
          summary: "Codex 请求删除文件。",
          commandPreview: "rm obsolete.txt",
          resolvedAt: "2026-08-08T01:00:00.000Z",
        },
      ]);

      const approvalResponse = await fetch(
        `${root}/api/tasks/0000000a/approval`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "confirm" }),
        },
      );
      expect(approvalResponse.status).toBe(200);
      expect(await approvalResponse.json()).toEqual({
        ok: true,
        count: 1,
        result: {
          id: "approval-confirmed",
          action: "confirm",
          turnId: "turn-running",
          summary: "Codex 请求运行命令。",
          commandPreview: "npm run quality",
          detailLabel: "运行命令",
          detailPreview: "npm run quality",
          resolvedAt: "2026-08-08T01:02:00.000Z",
        },
      });
      expect(resolvedApprovals).toEqual([
        {
          threadId: "0000000a-0000-7000-8000-00000000000a",
          action: "confirm",
        },
      ]);

      const queueUpdateResponse = await fetch(
        `${root}/api/tasks/0000000a/queue/queued-mobile`,
        {
          method: "PATCH",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "修改后的待发送消息" }),
        },
      );
      expect(queueUpdateResponse.status).toBe(200);
      expect(await queueUpdateResponse.json()).toEqual({ ok: true });

      const queueSteerResponse = await fetch(
        `${root}/api/tasks/0000000a/queue/queued-mobile/steer`,
        { method: "POST", headers },
      );
      expect(queueSteerResponse.status).toBe(200);
      expect(await queueSteerResponse.json()).toEqual({ ok: true });

      const queueDeleteResponse = await fetch(
        `${root}/api/tasks/0000000a/queue/queued-wechat`,
        { method: "DELETE", headers },
      );
      expect(queueDeleteResponse.status).toBe(200);
      expect(await queueDeleteResponse.json()).toEqual({ ok: true });
      expect(queueActions).toEqual([
        {
          action: "update",
          threadId: "0000000a-0000-7000-8000-00000000000a",
          messageId: "queued-mobile",
          text: "修改后的待发送消息",
        },
        {
          action: "steer",
          threadId: "0000000a-0000-7000-8000-00000000000a",
          messageId: "queued-mobile",
        },
        {
          action: "delete",
          threadId: "0000000a-0000-7000-8000-00000000000a",
          messageId: "queued-wechat",
        },
      ]);

      const stopResponse = await fetch(
        `${root}/api/tasks/0000000a/stop`,
        { method: "POST", headers },
      );
      expect(stopResponse.status).toBe(200);
      expect(await stopResponse.json()).toEqual({ ok: true, interrupted: true });
      expect(stopped).toEqual(["0000000a-0000-7000-8000-00000000000a"]);

      const sendResponse = await fetch(
        `${root}/api/tasks/0000000a/messages`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "  继续处理这个任务\n保留缩进  " }),
        },
      );
      expect(sendResponse.status).toBe(202);
      expect(await sendResponse.json()).toEqual({
        ok: true,
        queued: false,
        turnId: "turn-new",
      });
      expect(sent).toEqual([
        {
          threadId: "0000000a-0000-7000-8000-00000000000a",
          input: {
            text: "  继续处理这个任务\n保留缩进  ",
            images: [],
          },
        },
      ]);

      const imageResponse = await fetch(
        `${root}/api/tasks/0000000a/messages`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            text: "请分析图片",
            images: [
              {
                fileName: "clipboard.png",
                mimeType: "image/png",
                dataBase64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4wGAAAAAASUVORK5CYII=",
              },
            ],
          }),
        },
      );
      expect(imageResponse.status).toBe(202);
      expect(sent[1]).toMatchObject({
        threadId: "0000000a-0000-7000-8000-00000000000a",
        input: {
          text: "请分析图片",
          images: [
            { fileName: "clipboard.png", mimeType: "image/png" },
          ],
        },
      });
      expect(Buffer.isBuffer(sent[1]?.input.images[0]?.data)).toBe(true);

      const rejectedResponse = await fetch(
        `${root}/api/tasks/0000000a/messages`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({ text: "触发失败" }),
        },
      );
      expect(rejectedResponse.status).toBe(409);
      expect(await rejectedResponse.json()).toEqual({
        error: "这个任务暂时不能发送消息。",
      });
    } finally {
      await server.close();
    }
  });

  test("keeps a resolved approval visible after the transcript is refreshed", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-approval-result-"));
    tempDirs.push(directory);
    const stateStore = new DaemonWorkspaceStateStore(directory, {
      stateFile: path.join(directory, "daemon-state.json"),
    });
    let pendingApproval: {
      summary: string;
      commandPreview: string;
      allowForSession: boolean;
      detailLabel: string;
      detailPreview: string;
    } | null = {
      summary: "Codex 请求运行命令。",
      commandPreview: "npm run quality",
      allowForSession: true,
      detailLabel: "运行命令",
      detailPreview: "npm run quality",
    };
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [{
        threadId: "approval-task",
        title: "审批结果验证",
        status: pendingApproval ? "approval" : "running",
        selected: true,
      }],
      readMessages: async (threadId) => ({
        threadId,
        messages: [
          { role: "user", text: "运行完整检查", turnId: "turn-approval" },
          { role: "assistant", text: "准备执行。", turnId: "turn-approval" },
        ],
        queuedMessages: [],
        pendingApproval,
        approvalResults: stateStore
          .getMobileApprovalResults("codex", threadId)
          .map(({ adapter: _adapter, threadId: _threadId, ...result }) => result),
      }),
      sendMessage: async () => ({ queued: false }),
      resolveApproval: async (threadId, action) => {
        if (!pendingApproval) {
          return { count: 0 };
        }
        const result = {
          id: "approval-persisted",
          action,
          turnId: "turn-approval",
          summary: pendingApproval.summary,
          commandPreview: pendingApproval.commandPreview,
          detailLabel: pendingApproval.detailLabel,
          detailPreview: pendingApproval.detailPreview,
          resolvedAt: "2026-08-08T02:00:00.000Z",
        };
        stateStore.recordMobileApprovalResult({
          ...result,
          adapter: "codex",
          threadId,
        });
        pendingApproval = null;
        return { count: 1, result };
      },
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const headers = { cookie: sessionCookie };
      const approvalResponse = await fetch(`${root}/api/tasks/approval-task/approval`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "confirm_session" }),
      });
      expect(approvalResponse.status).toBe(200);

      const refreshedResponse = await fetch(
        `${root}/api/tasks/approval-task/messages`,
        { headers },
      );
      expect(refreshedResponse.status).toBe(200);
      expect(await refreshedResponse.json()).toMatchObject({
        pendingApproval: null,
        approvalResults: [{
          id: "approval-persisted",
          action: "confirm_session",
          turnId: "turn-approval",
          commandPreview: "npm run quality",
        }],
      });
    } finally {
      await server.close();
    }
  });
});

describe("Codex mobile task creation", () => {
  test("creates a task for the selected adapter", async () => {
    const authStore = createAuthStore("a configured mobile password");
    const sessionCookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const createdRequests: Array<{
      adapter: string | undefined;
      sourceThreadId: string | undefined;
    }> = [];
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [],
      createTask: async (adapter, options) => {
        createdRequests.push({
          adapter,
          sourceThreadId: options?.sourceThreadId,
        });
        return {
          threadId: "new-tclaude-task",
          title: "新任务",
          projectName: "demo-workspace",
          status: "idle",
          selected: true,
        };
      },
      readMessages: async (threadId) => ({
        threadId,
        messages: [],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/tasks?adapter=tclaude&sourceTask=source-task`,
        {
          method: "POST",
          headers: { cookie: sessionCookie },
        },
      );
      expect(response.status).toBe(201);
      expect(createdRequests).toEqual([{
        adapter: "tclaude",
        sourceThreadId: "source-task",
      }]);
      expect(await response.json()).toEqual({
        task: {
          threadId: "new-tclaude-task",
          title: "新任务",
          projectName: "demo-workspace",
          status: "idle",
          selected: true,
        },
      });
    } finally {
      await server.close();
    }
  });
});

describe("Codex mobile generated image messages", () => {
  test("maps local assistant and user images to authenticated opaque URLs and serves the image", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrelay-mobile-output-image-"));
    tempDirs.push(dir);
    const imagePath = path.join(dir, "generated.png");
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl4wGAAAAAASUVORK5CYII=",
      "base64",
    );
    fs.writeFileSync(imagePath, imageBytes);
    const authStore = createAuthStore("a configured mobile password");
    const cookie = `codex_mobile_session=${authStore.createSessionToken()}`;
    const threadId = "generated-image-thread";
    const server = await startCodexMobileServer({
      host: "127.0.0.1",
      port: 0,
      lanAddress: "127.0.0.1",
      accessToken: "mobile-secret",
      authStore,
      listTasks: async () => [{ threadId, title: "生成图片", status: "idle" }],
      readMessages: async () => ({
        threadId,
        messages: [{
          role: "assistant",
          text: "图片已经生成。",
          images: [{ source: "local", path: imagePath, alt: "生成结果" }],
        }, {
          role: "user",
          text: "请查看输入图片。",
          images: [{ source: "local", path: imagePath, alt: "输入图片" }],
        }],
        queuedMessages: [],
      }),
      sendMessage: async () => ({ queued: false }),
    });

    try {
      const root = `http://127.0.0.1:${server.port}`;
      const messagesResponse = await fetch(
        `${root}/api/tasks/${encodeURIComponent(threadId)}/messages`,
        { headers: { cookie } },
      );
      expect(messagesResponse.status).toBe(200);
      const payload = await messagesResponse.json() as {
        messages: Array<{
          images?: Array<{ source: string; url: string; alt?: string; path?: string }>;
        }>;
      };
      const image = payload.messages[0]?.images?.[0];
      const inputImage = payload.messages[1]?.images?.[0];
      expect(image).toMatchObject({
        source: "remote",
        alt: "生成结果",
      });
      expect(image?.path).toBeUndefined();
      expect(image?.url).toMatch(
        /^\/api\/tasks\/generated-image-thread\/images\/[A-Za-z0-9_-]+$/,
      );
      expect(inputImage).toMatchObject({
        source: "remote",
        alt: "输入图片",
        url: image?.url,
      });

      const unauthorized = await fetch(`${root}${image?.url}`);
      expect(unauthorized.status).toBe(401);

      const imageResponse = await fetch(`${root}${image?.url}`, {
        headers: { cookie },
      });
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await imageResponse.arrayBuffer())).toEqual(imageBytes);
    } finally {
      await server.close();
    }
  });

  test("renders assistant images as clickable previews instead of pending-only thumbnails", () => {
    expect(CODEX_MOBILE_JS).toContain("function renderMessageImages");
    expect(CODEX_MOBILE_JS).toContain('data-open-image="');
    expect(CODEX_MOBILE_JS).toContain("openImageViewer");
    expect(CODEX_MOBILE_JS).not.toContain(
      "var pendingImages = message.pending && Array.isArray(message.images)",
    );
    expect(CODEX_MOBILE_JS).toContain("if (state.loadingMessages) return null;");
  });

  test("opens selected input images in the same full-screen viewer", () => {
    expect(CODEX_MOBILE_JS).toContain('previewButton.className = "composer-media-preview"');
    expect(CODEX_MOBILE_JS).toContain("openImageViewer(image.previewUrl, image.fileName)");
    expect(CODEX_MOBILE_CSS).toContain(".composer-media-preview");
  });
});
