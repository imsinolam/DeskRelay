export class CodexInboundTaskQueue<T> {
  private readonly itemsByThreadId = new Map<string, T[]>();
  private readonly drainingThreadIds = new Set<string>();

  enqueue(threadId: string, item: T): number {
    const queue = this.itemsByThreadId.get(threadId) ?? [];
    queue.push(item);
    this.itemsByThreadId.set(threadId, queue);
    return queue.length;
  }

  count(threadId: string): number {
    return this.itemsByThreadId.get(threadId)?.length ?? 0;
  }

  items(threadId: string): T[] {
    return [...(this.itemsByThreadId.get(threadId) ?? [])];
  }

  entries(): Array<{ threadId: string; items: T[] }> {
    return Array.from(this.itemsByThreadId, ([threadId, items]) => ({
      threadId,
      items: [...items],
    }));
  }

  threadIds(): string[] {
    return [...this.itemsByThreadId.keys()];
  }

  peek(threadId: string): T | null {
    return this.itemsByThreadId.get(threadId)?.[0] ?? null;
  }

  shift(threadId: string): T | null {
    const queue = this.itemsByThreadId.get(threadId);
    const item = queue?.shift() ?? null;
    if (queue?.length === 0) {
      this.itemsByThreadId.delete(threadId);
    }
    return item;
  }

  prepend(threadId: string, item: T): void {
    const queue = this.itemsByThreadId.get(threadId) ?? [];
    queue.unshift(item);
    this.itemsByThreadId.set(threadId, queue);
  }

  beginDrain(threadId: string): boolean {
    if (this.drainingThreadIds.has(threadId)) {
      return false;
    }
    this.drainingThreadIds.add(threadId);
    return true;
  }

  endDrain(threadId: string): void {
    this.drainingThreadIds.delete(threadId);
  }

  clear(threadId?: string): void {
    if (threadId) {
      this.itemsByThreadId.delete(threadId);
      this.drainingThreadIds.delete(threadId);
      return;
    }
    this.itemsByThreadId.clear();
    this.drainingThreadIds.clear();
  }
}
