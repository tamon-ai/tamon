import * as logger from "../../utils/logger";

interface QueueEntry {
  id: string;
  channelId: string;
  resolve: () => void;
  reject: (reason: Error) => void;
}

export class ExecutionQueue {
  private active = 0;
  private queue: QueueEntry[] = [];
  private readonly maxConcurrent: number;
  private shuttingDown = false;

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(id: string, channelId: string): Promise<void> {
    if (this.shuttingDown) {
      throw new Error("Queue is shutting down");
    }

    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ id, channelId, resolve, reject });
      logger.info(`[queue] Enqueued ${id} (position ${this.queue.length}, active ${this.active})`);
    });
  }

  release(id: string): void {
    this.active = Math.max(0, this.active - 1);

    const next = this.queue.shift();
    if (next) {
      this.active++;
      logger.info(`[queue] Promoting ${next.id} (remaining ${this.queue.length})`);
      next.resolve();
    }
  }

  cancelPendingForChannel(channelId: string, excludeId?: string): number {
    let cancelled = 0;
    this.queue = this.queue.filter((entry) => {
      if (entry.channelId === channelId && entry.id !== excludeId) {
        entry.reject(new Error("Cancelled by newer message"));
        cancelled++;
        return false;
      }
      return true;
    });
    return cancelled;
  }

  async drainAndShutdown(timeoutMs = 60000): Promise<void> {
    this.shuttingDown = true;

    // Reject all pending
    for (const entry of this.queue) {
      entry.reject(new Error("Queue shutdown"));
    }
    this.queue = [];

    // Wait for active to finish
    if (this.active > 0) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (this.active === 0) {
              clearInterval(check);
              resolve();
            }
          }, 500);
        }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  }

  getStatus(): { active: number; queued: number; maxConcurrent: number } {
    return { active: this.active, queued: this.queue.length, maxConcurrent: this.maxConcurrent };
  }
}
