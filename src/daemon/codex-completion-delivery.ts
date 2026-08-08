const MAX_PENDING_CODEX_COMPLETIONS = 80;
const MAX_DELIVERED_CODEX_COMPLETIONS = 512;
const CODEX_COMPLETION_RETENTION_MS = 30 * 24 * 60 * 60_000;

export type PendingCodexCompletionDelivery = {
  key: string;
  threadId: string;
  turnId?: string;
  texts: string[];
  nextTextIndex: number;
  createdAt: string;
};

export type DeliveredCodexCompletionDelivery = {
  key: string;
  deliveredAt: string;
};

export type CodexCompletionDeliveryState = {
  pending: PendingCodexCompletionDelivery[];
  delivered: DeliveredCodexCompletionDelivery[];
};

export type CodexCompletionDeliveryQueueOptions = {
  initial?: CodexCompletionDeliveryState;
  now?: () => number;
  persist?: (state: CodexCompletionDeliveryState) => void;
};

export type CodexCompletionEnqueueResult = {
  status: "queued" | "pending" | "delivered";
  delivery?: PendingCodexCompletionDelivery;
};

export type CodexCompletionDeliveryResult = {
  status: "missing" | "in_flight" | "pending" | "delivered";
  sentCount: number;
  totalCount: number;
  delivery?: PendingCodexCompletionDelivery;
};

function clonePending(
  delivery: PendingCodexCompletionDelivery,
): PendingCodexCompletionDelivery {
  return {
    ...delivery,
    texts: [...delivery.texts],
  };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(Date.parse(value)).toISOString();
}

function normalizePending(
  value: unknown,
): PendingCodexCompletionDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.key !== "string" ||
    !record.key.trim() ||
    typeof record.threadId !== "string" ||
    !record.threadId.trim() ||
    !Array.isArray(record.texts) ||
    record.texts.length === 0 ||
    !record.texts.every((text) => typeof text === "string") ||
    typeof record.nextTextIndex !== "number" ||
    !Number.isInteger(record.nextTextIndex) ||
    record.nextTextIndex < 0 ||
    record.nextTextIndex > record.texts.length
  ) {
    return null;
  }
  const createdAt = normalizeTimestamp(record.createdAt);
  if (!createdAt) {
    return null;
  }
  return {
    key: record.key.trim(),
    threadId: record.threadId.trim(),
    ...(typeof record.turnId === "string" && record.turnId.trim()
      ? { turnId: record.turnId.trim() }
      : {}),
    texts: [...record.texts],
    nextTextIndex: record.nextTextIndex,
    createdAt,
  };
}

function normalizeDelivered(
  value: unknown,
): DeliveredCodexCompletionDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || !record.key.trim()) {
    return null;
  }
  const deliveredAt = normalizeTimestamp(record.deliveredAt);
  if (!deliveredAt) {
    return null;
  }
  return {
    key: record.key.trim(),
    deliveredAt,
  };
}

export function normalizeCodexCompletionDeliveryState(
  value: unknown,
  nowMs = Date.now(),
): CodexCompletionDeliveryState {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const cutoff = nowMs - CODEX_COMPLETION_RETENTION_MS;
  const deliveredByKey = new Map<string, DeliveredCodexCompletionDelivery>();
  for (const item of Array.isArray(record.delivered) ? record.delivered : []) {
    const delivered = normalizeDelivered(item);
    if (!delivered || Date.parse(delivered.deliveredAt) < cutoff) {
      continue;
    }
    const previous = deliveredByKey.get(delivered.key);
    if (!previous || Date.parse(previous.deliveredAt) < Date.parse(delivered.deliveredAt)) {
      deliveredByKey.set(delivered.key, delivered);
    }
  }
  const delivered = [...deliveredByKey.values()]
    .sort((left, right) => Date.parse(left.deliveredAt) - Date.parse(right.deliveredAt))
    .slice(-MAX_DELIVERED_CODEX_COMPLETIONS);
  const deliveredKeys = new Set(delivered.map((item) => item.key));

  const pendingByKey = new Map<string, PendingCodexCompletionDelivery>();
  for (const item of Array.isArray(record.pending) ? record.pending : []) {
    const pending = normalizePending(item);
    if (
      !pending ||
      Date.parse(pending.createdAt) < cutoff ||
      deliveredKeys.has(pending.key)
    ) {
      continue;
    }
    const previous = pendingByKey.get(pending.key);
    if (!previous || Date.parse(previous.createdAt) < Date.parse(pending.createdAt)) {
      pendingByKey.set(pending.key, pending);
    }
  }
  const pending = [...pendingByKey.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_PENDING_CODEX_COMPLETIONS);

  return {
    pending: pending.map(clonePending),
    delivered: delivered.map((item) => ({ ...item })),
  };
}

export class CodexCompletionDeliveryQueue {
  private readonly now: () => number;
  private readonly persist?: (state: CodexCompletionDeliveryState) => void;
  private readonly pending = new Map<string, PendingCodexCompletionDelivery>();
  private readonly delivered = new Map<string, DeliveredCodexCompletionDelivery>();
  private readonly inFlight = new Set<string>();

  constructor(options: CodexCompletionDeliveryQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.persist = options.persist;
    const initial = normalizeCodexCompletionDeliveryState(
      options.initial,
      this.now(),
    );
    for (const delivery of initial.pending) {
      this.pending.set(delivery.key, clonePending(delivery));
    }
    for (const delivery of initial.delivered) {
      this.delivered.set(delivery.key, { ...delivery });
    }
  }

  snapshot(): CodexCompletionDeliveryState {
    this.pruneExpired();
    return this.snapshotWithoutPruning();
  }

  private snapshotWithoutPruning(): CodexCompletionDeliveryState {
    return {
      pending: [...this.pending.values()].map(clonePending),
      delivered: [...this.delivered.values()].map((item) => ({ ...item })),
    };
  }

  getPending(): PendingCodexCompletionDelivery[] {
    if (this.pruneExpired()) {
      this.persistState();
    }
    return [...this.pending.values()].map(clonePending);
  }

  hasDelivered(key: string): boolean {
    if (this.pruneExpired()) {
      this.persistState();
    }
    return this.delivered.has(key);
  }

  enqueue(input: {
    key: string;
    threadId: string;
    turnId?: string;
    texts: string[];
  }): CodexCompletionEnqueueResult {
    if (this.pruneExpired()) {
      this.persistState();
    }
    const key = input.key.trim();
    if (this.delivered.has(key)) {
      return { status: "delivered" };
    }
    const existing = this.pending.get(key);
    if (existing) {
      return { status: "pending", delivery: clonePending(existing) };
    }
    const texts = input.texts.filter((text) => typeof text === "string");
    if (!key || !input.threadId.trim() || texts.length === 0) {
      throw new Error("Codex completion delivery payload is invalid.");
    }
    const delivery: PendingCodexCompletionDelivery = {
      key,
      threadId: input.threadId.trim(),
      ...(input.turnId?.trim() ? { turnId: input.turnId.trim() } : {}),
      texts: [...texts],
      nextTextIndex: 0,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.pending.set(key, delivery);
    this.trimPending();
    this.persistState();
    return { status: "queued", delivery: clonePending(delivery) };
  }

  async deliver(
    key: string,
    send: (
      delivery: PendingCodexCompletionDelivery,
      remainingTexts: string[],
    ) => Promise<number>,
  ): Promise<CodexCompletionDeliveryResult> {
    if (this.pruneExpired()) {
      this.persistState();
    }
    if (this.delivered.has(key)) {
      return { status: "delivered", sentCount: 0, totalCount: 0 };
    }
    const delivery = this.pending.get(key);
    if (!delivery) {
      return { status: "missing", sentCount: 0, totalCount: 0 };
    }
    if (this.inFlight.has(key)) {
      return {
        status: "in_flight",
        sentCount: 0,
        totalCount: delivery.texts.length,
        delivery: clonePending(delivery),
      };
    }

    this.inFlight.add(key);
    try {
      const remaining = delivery.texts.slice(delivery.nextTextIndex);
      if (remaining.length === 0) {
        this.markDelivered(delivery);
        return {
          status: "delivered",
          sentCount: 0,
          totalCount: delivery.texts.length,
          delivery: clonePending(delivery),
        };
      }
      const reportedCount = await send(clonePending(delivery), [...remaining]);
      const sentCount = Math.max(
        0,
        Math.min(remaining.length, Number.isInteger(reportedCount) ? reportedCount : 0),
      );
      delivery.nextTextIndex += sentCount;
      if (delivery.nextTextIndex >= delivery.texts.length) {
        this.markDelivered(delivery);
        return {
          status: "delivered",
          sentCount,
          totalCount: delivery.texts.length,
          delivery: clonePending(delivery),
        };
      }
      if (sentCount > 0) {
        this.persistState();
      }
      return {
        status: "pending",
        sentCount,
        totalCount: delivery.texts.length,
        delivery: clonePending(delivery),
      };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private markDelivered(delivery: PendingCodexCompletionDelivery): void {
    this.pending.delete(delivery.key);
    this.delivered.delete(delivery.key);
    this.delivered.set(delivery.key, {
      key: delivery.key,
      deliveredAt: new Date(this.now()).toISOString(),
    });
    this.trimDelivered();
    this.persistState();
  }

  private trimPending(): void {
    while (this.pending.size > MAX_PENDING_CODEX_COMPLETIONS) {
      const oldestKey = this.pending.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.pending.delete(oldestKey);
    }
  }

  private trimDelivered(): void {
    this.pruneExpired();
    while (this.delivered.size > MAX_DELIVERED_CODEX_COMPLETIONS) {
      const oldestKey = this.delivered.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.delivered.delete(oldestKey);
    }
  }

  private persistState(): void {
    this.persist?.(this.snapshotWithoutPruning());
  }

  private pruneExpired(): boolean {
    const cutoff = this.now() - CODEX_COMPLETION_RETENTION_MS;
    let changed = false;
    for (const [key, delivery] of this.pending) {
      if (Date.parse(delivery.createdAt) < cutoff) {
        this.pending.delete(key);
        changed = true;
      }
    }
    for (const [key, delivery] of this.delivered) {
      if (Date.parse(delivery.deliveredAt) < cutoff) {
        this.delivered.delete(key);
        changed = true;
      }
    }
    return changed;
  }
}
