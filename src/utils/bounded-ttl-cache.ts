type BoundedTtlCacheOptions = {
  maxSize: number;
  ttlMs: number;
  now?: () => number;
};

type CacheEntry<Value> = {
  value: Value;
  touchedAtMs: number;
};

export class BoundedTtlMap<Key, Value> {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly entriesByKey = new Map<Key, CacheEntry<Value>>();

  constructor(options: BoundedTtlCacheOptions) {
    if (!Number.isInteger(options.maxSize) || options.maxSize <= 0) {
      throw new Error("BoundedTtlMap maxSize must be a positive integer.");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error("BoundedTtlMap ttlMs must be positive.");
    }
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    this.pruneExpired();
    return this.entriesByKey.size;
  }

  set(key: Key, value: Value): this {
    const nowMs = this.now();
    this.pruneExpired(nowMs);
    this.entriesByKey.delete(key);
    this.entriesByKey.set(key, { value, touchedAtMs: nowMs });
    while (this.entriesByKey.size > this.maxSize) {
      const oldestKey = this.entriesByKey.keys().next().value;
      if (oldestKey === undefined) break;
      this.entriesByKey.delete(oldestKey);
    }
    return this;
  }

  get(key: Key): Value | undefined {
    const nowMs = this.now();
    const entry = this.entriesByKey.get(key);
    if (!entry) {
      this.pruneExpired(nowMs);
      return undefined;
    }
    if (this.isExpired(entry, nowMs)) {
      this.entriesByKey.delete(key);
      this.pruneExpired(nowMs);
      return undefined;
    }
    this.entriesByKey.delete(key);
    this.entriesByKey.set(key, { value: entry.value, touchedAtMs: nowMs });
    return entry.value;
  }

  has(key: Key): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: Key): boolean {
    return this.entriesByKey.delete(key);
  }

  clear(): void {
    this.entriesByKey.clear();
  }

  private pruneExpired(nowMs = this.now()): void {
    for (const [key, entry] of this.entriesByKey) {
      if (this.isExpired(entry, nowMs)) {
        this.entriesByKey.delete(key);
      }
    }
  }

  private isExpired(entry: CacheEntry<Value>, nowMs: number): boolean {
    return nowMs - entry.touchedAtMs >= this.ttlMs;
  }
}

export class BoundedTtlSet<Value> {
  private readonly values: BoundedTtlMap<Value, true>;

  constructor(options: BoundedTtlCacheOptions) {
    this.values = new BoundedTtlMap<Value, true>(options);
  }

  get size(): number {
    return this.values.size;
  }

  add(value: Value): this {
    this.values.set(value, true);
    return this;
  }

  has(value: Value): boolean {
    return this.values.has(value);
  }

  delete(value: Value): boolean {
    return this.values.delete(value);
  }

  clear(): void {
    this.values.clear();
  }
}
