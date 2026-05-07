import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TTLCache } from "./cache";

describe("TTLCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stores and retrieves values", () => {
    const cache = new TTLCache<string>({ ttlMs: 5000 });
    cache.set("a", "hello");
    expect(cache.get("a")).toBe("hello");
  });

  it("returns undefined for missing keys", () => {
    const cache = new TTLCache<string>({ ttlMs: 5000 });
    expect(cache.get("nope")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    const cache = new TTLCache<string>({ ttlMs: 1000 });
    cache.set("a", "hello");
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts oldest entry when maxEntries reached", () => {
    const cache = new TTLCache<number>({ ttlMs: 60000, maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("invalidates by key", () => {
    const cache = new TTLCache<string>({ ttlMs: 60000 });
    cache.set("x", "val");
    cache.invalidate("x");
    expect(cache.get("x")).toBeUndefined();
  });

  it("invalidates by prefix", () => {
    const cache = new TTLCache<string>({ ttlMs: 60000 });
    cache.set("user:1", "a");
    cache.set("user:2", "b");
    cache.set("post:1", "c");
    cache.invalidateByPrefix("user:");
    expect(cache.get("user:1")).toBeUndefined();
    expect(cache.get("user:2")).toBeUndefined();
    expect(cache.get("post:1")).toBe("c");
  });

  it("clears all entries", () => {
    const cache = new TTLCache<string>({ ttlMs: 60000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("reports size correctly", () => {
    const cache = new TTLCache<string>({ ttlMs: 60000 });
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    expect(cache.size).toBe(1);
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });
});
