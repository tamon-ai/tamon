import { describe, it, expect } from "vitest";
import { ExecutionQueue } from "./queue";

describe("ExecutionQueue", () => {
  it("allows up to maxConcurrent immediately", async () => {
    const q = new ExecutionQueue(2);
    await q.enqueue("a", "ch1");
    await q.enqueue("b", "ch1");
    expect(q.getStatus()).toEqual({ active: 2, queued: 0, maxConcurrent: 2 });
  });

  it("queues beyond maxConcurrent", () => {
    const q = new ExecutionQueue(1);
    q.enqueue("a", "ch1"); // immediate
    const pending = q.enqueue("b", "ch1"); // queued
    expect(q.getStatus()).toEqual({ active: 1, queued: 1, maxConcurrent: 1 });

    q.release("a");
    return pending.then(() => {
      expect(q.getStatus().active).toBe(1);
    });
  });

  it("cancelPendingForChannel rejects queued entries", async () => {
    const q = new ExecutionQueue(1);
    await q.enqueue("a", "ch1");
    const pending = q.enqueue("b", "ch1").catch((e: Error) => e);
    const cancelled = q.cancelPendingForChannel("ch1", "a");
    expect(cancelled).toBe(1);
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Cancelled by newer message");
  });

  it("cancelPendingForChannel excludes specified id", async () => {
    const q = new ExecutionQueue(1);
    await q.enqueue("a", "ch1");
    const pb = q.enqueue("b", "ch1").catch(() => {}); // queued
    q.enqueue("c", "ch1").catch(() => {}); // queued
    const cancelled = q.cancelPendingForChannel("ch1", "c");
    expect(cancelled).toBe(1); // only b cancelled, c excluded
    await pb;
  });

  it("does not cancel entries from other channels", async () => {
    const q = new ExecutionQueue(1);
    await q.enqueue("a", "ch1");
    q.enqueue("b", "ch2").catch(() => {}); // queued
    const cancelled = q.cancelPendingForChannel("ch1");
    expect(cancelled).toBe(0);
    expect(q.getStatus().queued).toBe(1);
    q.release("a"); // clean up
  });

  it("rejects enqueue after shutdown", async () => {
    const q = new ExecutionQueue(2);
    await q.drainAndShutdown();
    await expect(q.enqueue("x", "ch1")).rejects.toThrow("Queue is shutting down");
  });

  it("drainAndShutdown rejects pending and waits for active", async () => {
    const q = new ExecutionQueue(1);
    await q.enqueue("a", "ch1");
    const pending = q.enqueue("b", "ch1").catch((e: Error) => e);

    const drain = q.drainAndShutdown(5000);
    const err = await pending;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Queue shutdown");

    q.release("a");
    await drain;
    expect(q.getStatus().active).toBe(0);
  });

  it("getStatus returns correct counts", async () => {
    const q = new ExecutionQueue(3);
    const s = q.getStatus();
    expect(s).toEqual({ active: 0, queued: 0, maxConcurrent: 3 });
  });
});
