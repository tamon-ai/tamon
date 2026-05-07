import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execute } from "../core/claude";
import { writeFileAtomic } from "../utils/fs";
import * as logger from "../utils/logger";
import { canRunAutonomousTasks } from "./activity-gate";
import { defaultEvaluator } from "./result-evaluator";
import { defaultScorer } from "./task-scorer";
import type {
  ExecutionState,
  ResultEvaluator,
  Task,
  TaskProgress,
  TaskScorer,
  TaskSource,
} from "./types";

const STATE_FILE = "autonomy-state.json";
const PROGRESS_FILE = "autonomy-progress.json";
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_FAILURES_PER_DAY = 2;

export interface TaskExecutorOptions {
  taskSource: TaskSource;
  scorer?: TaskScorer;
  evaluator?: ResultEvaluator;
  maxConcurrent?: number;
  maxFailuresPerDay?: number;
  stateDir?: string;
  systemPrompt?: string;
  onTaskComplete?: (task: Task, result: string) => Promise<void>;
  onTaskFailed?: (task: Task, error: string) => Promise<void>;
  onReviewNeeded?: (task: Task, result: string) => Promise<void>;
}

export class TaskExecutor {
  private readonly taskSource: TaskSource;
  private readonly scorer: TaskScorer;
  private readonly evaluator: ResultEvaluator;
  private readonly maxConcurrent: number;
  private readonly maxFailuresPerDay: number;
  private readonly stateDir: string;
  private readonly systemPrompt?: string;
  private readonly onTaskComplete?: (task: Task, result: string) => Promise<void>;
  private readonly onTaskFailed?: (task: Task, error: string) => Promise<void>;
  private readonly onReviewNeeded?: (task: Task, result: string) => Promise<void>;
  private state: ExecutionState;

  constructor(options: TaskExecutorOptions) {
    this.taskSource = options.taskSource;
    this.scorer = options.scorer ?? defaultScorer;
    this.evaluator = options.evaluator ?? defaultEvaluator;
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxFailuresPerDay = options.maxFailuresPerDay ?? DEFAULT_MAX_FAILURES_PER_DAY;
    this.stateDir = options.stateDir ?? "data/";
    this.systemPrompt = options.systemPrompt;
    this.onTaskComplete = options.onTaskComplete;
    this.onTaskFailed = options.onTaskFailed;
    this.onReviewNeeded = options.onReviewNeeded;
    this.state = this.loadState();
  }

  /**
   * 1サイクル分のタスク実行を行う。
   * cronやスケジューラから定期的に呼び出されることを想定。
   */
  async run(): Promise<void> {
    // ゲート確認
    const gate = canRunAutonomousTasks();
    if (!gate.allowed) {
      logger.info(`[task-executor] Skipping: ${gate.reason}`);
      return;
    }

    // タスク取得
    const tasks = await this.taskSource.fetchTasks();
    if (tasks.length === 0) {
      logger.debug("[task-executor] No tasks to execute");
      return;
    }

    // 自動実行可能なタスクをフィルタリング
    const autoTasks = tasks.filter((t) => this.isAutoExecutable(t));
    if (autoTasks.length === 0) {
      logger.debug("[task-executor] No auto-executable tasks");
      return;
    }

    // スコアリング・ソート（降順）
    const scored = autoTasks
      .map((task) => ({ task, score: this.scorer(task) }))
      .sort((a, b) => b.score - a.score);

    // 失敗上限に達したタスクを除外
    const executable = scored.filter(({ task }) => !this.hasExceededFailures(task.id));

    if (executable.length === 0) {
      logger.debug("[task-executor] All auto tasks have exceeded failure limits");
      return;
    }

    // 上位N件を並行実行
    const batch = executable.slice(0, this.maxConcurrent);
    logger.info(
      `[task-executor] Executing ${batch.length} task(s): ${batch.map((b) => b.task.title).join(", ")}`,
    );

    const promises = batch.map(({ task }) => this.executeTask(task));
    await Promise.allSettled(promises);

    // 状態を永続化
    this.saveState();
  }

  getState(): ExecutionState {
    return { ...this.state };
  }

  private isAutoExecutable(task: Task): boolean {
    // executionTypeが"manual"のタスクはスキップ
    if (task.executionType === "manual") return false;
    // "auto"が明示されている、または未設定のものを対象とする
    return task.status === "pending" || task.status === "in_progress";
  }

  private hasExceededFailures(taskId: string): boolean {
    const failure = this.state.failures[taskId];
    if (!failure) return false;

    // 日付が変わったらリセット
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = failure.lastAttempt.slice(0, 10);
    if (today !== lastDate) return false;

    return failure.failCount >= this.maxFailuresPerDay;
  }

  private async executeTask(task: Task): Promise<void> {
    logger.info(`[task-executor] Starting task: ${task.title} (${task.id})`);

    try {
      // ステータスを進行中に更新
      await this.taskSource.updateStatus(task.id, "in_progress");

      // 前回の進捗を読み込み
      const previousProgress = this.loadProgress(task.id);
      const prompt = this.buildPrompt(task, previousProgress);

      // Claude実行
      const result = await execute(prompt, {
        systemPrompt: this.systemPrompt,
        maxExecutionMs: 30 * 60 * 1000, // 30分上限
      });

      if (result.timedOut) {
        // タイムアウトの場合は途中経過を保存
        this.saveProgress({
          taskId: task.id,
          taskTitle: task.title,
          steps: [],
          partialResult: result.text.slice(0, 5000),
          lastAttempt: new Date().toISOString(),
        });
        this.recordFailure(task.id, true);
        await this.taskSource.addNote(task.id, `[Auto] Timed out. Partial result saved.`);
        await this.onTaskFailed?.(task, "Execution timed out");
        return;
      }

      // 結果評価
      const evaluation = this.evaluator(result.text);
      logger.info(`[task-executor] Task ${task.title} evaluated as: ${evaluation}`);

      switch (evaluation) {
        case "done":
          await this.taskSource.updateStatus(task.id, "done");
          await this.taskSource.addNote(task.id, `[Auto] Completed.\n${result.text.slice(0, 2000)}`);
          this.clearProgress(task.id);
          this.clearFailure(task.id);
          await this.onTaskComplete?.(task, result.text);
          break;

        case "review":
          await this.taskSource.addNote(task.id, `[Auto] Needs review.\n${result.text.slice(0, 2000)}`);
          this.clearProgress(task.id);
          await this.onReviewNeeded?.(task, result.text);
          break;

        case "retry":
          this.saveProgress({
            taskId: task.id,
            taskTitle: task.title,
            steps: [],
            partialResult: result.text.slice(0, 5000),
            lastAttempt: new Date().toISOString(),
          });
          this.recordFailure(task.id, false);
          await this.taskSource.updateStatus(task.id, "pending");
          await this.taskSource.addNote(task.id, `[Auto] Failed, will retry.\n${result.text.slice(0, 1000)}`);
          await this.onTaskFailed?.(task, result.text);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[task-executor] Task ${task.title} threw: ${message}`);
      this.recordFailure(task.id, false);
      await this.taskSource.addNote(task.id, `[Auto] Error: ${message.slice(0, 500)}`);
      await this.taskSource.updateStatus(task.id, "pending");
      await this.onTaskFailed?.(task, message);
    }
  }

  private buildPrompt(task: Task, progress: TaskProgress | null): string {
    const parts: string[] = [];

    parts.push(`# Task: ${task.title}`);
    parts.push(`ID: ${task.id}`);
    parts.push(`Priority: ${task.priority}`);

    if (task.dueDate) {
      parts.push(`Due: ${task.dueDate}`);
    }

    if (task.notes) {
      parts.push(`\n## Notes\n${task.notes}`);
    }

    if (progress) {
      parts.push(`\n## Previous Attempt (${progress.lastAttempt})`);
      parts.push(`The previous execution was incomplete. Here is the partial result:`);
      parts.push(progress.partialResult);
      parts.push(`\nPlease continue from where the previous attempt left off.`);
    }

    parts.push(`\n## Instructions`);
    parts.push(`Execute this task to completion. Report what you did and the outcome.`);
    parts.push(`If you cannot complete the task, explain what is blocking you.`);

    return parts.join("\n");
  }

  // --- 状態管理 ---

  private get statePath(): string {
    return join(this.stateDir, STATE_FILE);
  }

  private get progressDir(): string {
    return join(this.stateDir, "progress");
  }

  private loadState(): ExecutionState {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, "utf-8");
        return JSON.parse(raw) as ExecutionState;
      }
    } catch (err) {
      logger.warn("[task-executor] Failed to load state, starting fresh", err);
    }
    return { failures: {} };
  }

  private saveState(): void {
    try {
      writeFileAtomic(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error("[task-executor] Failed to save state", err);
    }
  }

  private recordFailure(taskId: string, isTimeout: boolean): void {
    const existing = this.state.failures[taskId];
    const now = new Date().toISOString();

    if (existing) {
      // 日付が変わっていたらリセット
      const today = now.slice(0, 10);
      const lastDate = existing.lastAttempt.slice(0, 10);
      if (today !== lastDate) {
        this.state.failures[taskId] = {
          failCount: 1,
          lastAttempt: now,
          timeoutCount: isTimeout ? 1 : 0,
        };
      } else {
        existing.failCount++;
        existing.lastAttempt = now;
        if (isTimeout) {
          existing.timeoutCount = (existing.timeoutCount ?? 0) + 1;
        }

        // サーキットブレーカー: 上限到達時にエスカレーションマークを付ける
        if (existing.failCount >= this.maxFailuresPerDay) {
          existing.lastEscalated = now;
          logger.warn(
            `[task-executor] Task ${taskId} hit failure limit (${existing.failCount}/${this.maxFailuresPerDay})`,
          );
        }
      }
    } else {
      this.state.failures[taskId] = {
        failCount: 1,
        lastAttempt: now,
        timeoutCount: isTimeout ? 1 : 0,
      };
    }
  }

  private clearFailure(taskId: string): void {
    delete this.state.failures[taskId];
  }

  private loadProgress(taskId: string): TaskProgress | null {
    const path = join(this.progressDir, `${taskId}.json`);
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8");
        return JSON.parse(raw) as TaskProgress;
      }
    } catch (err) {
      logger.warn(`[task-executor] Failed to load progress for ${taskId}`, err);
    }
    return null;
  }

  private saveProgress(progress: TaskProgress): void {
    const path = join(this.progressDir, `${progress.taskId}.json`);
    try {
      writeFileAtomic(path, JSON.stringify(progress, null, 2));
    } catch (err) {
      logger.error(`[task-executor] Failed to save progress for ${progress.taskId}`, err);
    }
  }

  private clearProgress(taskId: string): void {
    const path = join(this.progressDir, `${taskId}.json`);
    try {
      if (existsSync(path)) {
        const { unlinkSync } = require("fs");
        unlinkSync(path);
      }
    } catch (err) {
      logger.debug(`[task-executor] Failed to clear progress for ${taskId}`, err);
    }
  }
}
