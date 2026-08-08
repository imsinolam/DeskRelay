import { describe, expect, test } from "bun:test";

import {
  BoundedTtlMap,
  BoundedTtlSet,
} from "../../src/utils/bounded-ttl-cache.ts";

describe("bounded TTL caches", () => {
  test("evicts the least recently used map entry", () => {
    let now = 0;
    const cache = new BoundedTtlMap<string, string>({
      maxSize: 2,
      ttlMs: 1_000,
      now: () => now,
    });
    cache.set("a", "A");
    now += 1;
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    now += 1;
    cache.set("c", "C");

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  test("drops expired values and sensitive paths", () => {
    let now = 0;
    const cache = new BoundedTtlMap<string, { path: string }>({
      maxSize: 4,
      ttlMs: 100,
      now: () => now,
    });
    cache.set("image", { path: "/private/generated.png" });
    now = 101;

    expect(cache.get("image")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("bounds and expires set keys", () => {
    let now = 0;
    const cache = new BoundedTtlSet<string>({
      maxSize: 2,
      ttlMs: 50,
      now: () => now,
    });
    cache.add("a");
    cache.add("b");
    cache.add("c");
    expect(cache.has("a")).toBe(false);
    expect(cache.has("c")).toBe(true);

    now = 51;
    expect(cache.has("c")).toBe(false);
    expect(cache.size).toBe(0);
  });
});
