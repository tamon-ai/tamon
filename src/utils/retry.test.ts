import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));
    const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 100 }).catch(
      (e: Error) => e,
    );
    await vi.advanceTimersByTimeAsync(100);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("always fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("oops"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    await vi.advanceTimersByTimeAsync(10);
    await promise;
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("caps delay at maxDelayMs", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 50 });
    // delay should be min(1000*2^0, 50)=50, then min(1000*2^1, 50)=50
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;
    expect(result).toBe("ok");
  });
});
