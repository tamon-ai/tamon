import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execute } from "../core/claude";
import { writeFileAtomic } from "../utils/fs";
import * as logger from "../utils/logger";
import type { PrepAnalysis, PrepState, Task, TaskSource } from "./types";

const PREP_STATE_FILE = "prep-state.json";

export interface TaskPreparatorOptions {
  taskSource: TaskSource;
  stateDir?: string;
  systemPrompt?: string;
  onPrepComplete?: (task: Task, analysis: PrepAnalysis, result: string) => Promise<void>;
}

export class TaskPreparator {
  private readonly taskSource: TaskSource;
  private readonly stateDir: string;
  private readonly systemPrompt?: string;
  private readonly onPrepComplete?: (task: Task, analysis: PrepAnalysis, result: string) => Promise<void>;
  private state: PrepState;

  constructor(options: TaskPreparatorOptions) {
    this.taskSource = options.taskSource;
    this.stateDir = options.stateDir ?? "data/";
    this.systemPrompt = options.systemPrompt;
    this.onPrepComplete = options.onPrepComplete;
    this.state = this.loadState();
  }

  /**
   * 1サイクル分の事前準備を実行する。
   *
   * Phase 1: タスクを分析しPrepAnalysisを生成
   * Phase 2: small/medium規模の準備ステップを実行
   */
  async run(): Promise<void> {
    const tasks = await this.taskSource.fetchTasks();
    if (tasks.length === 0) {
      logger.debug("[task-prep] No tasks to prepare");
      return;
    }

    // pending状態のタスクのみ対象
    const pendingTasks = tasks.filter((t) => t.status === "pending");

    for (const task of pendingTasks) {
      const existing = this.state.tasks[task.id];

      if (!existing) {
        // Phase 1: 分析
        await this.analyzeTask(task);
      } else if (!existing.prepDone && existing.analysis.canPrepare) {
        // Phase 2: 準備実行
        await this.prepareTask(task, existing.analysis);
      }
      // 分析済みかつ準備完了（または準備不可）のタスクはスキップ
    }

    this.saveState();
  }

  /**
   * Phase 1: タスクをClaudeで分析し、準備可能性を判定する
   */
  private async analyzeTask(task: Task): Promise<void> {
    logger.info(`[task-prep] Analyzing task: ${task.title}`);

    const prompt = this.buildAnalysisPrompt(task);

    try {
      const result = await execute(prompt, {
        systemPrompt: this.systemPrompt ?? "You are a task analysis assistant. Respond only with valid JSON.",
        maxExecutionMs: 5 * 60 * 1000, // 5分上限
      });

      const analysis = this.parseAnalysis(result.text);
      if (!analysis) {
        logger.warn(`[task-prep] Failed to parse analysis for task: ${task.title}`);
        return;
      }

      this.state.tasks[task.id] = {
        analyzedAt: new Date().toISOString(),
        analysis,
        prepDone: false,
      };

      logger.info(
        `[task-prep] Analysis complete for "${task.title}": ` +
        `canPrepare=${analysis.canPrepare}, ` +
        `steps=${analysis.prepSteps.length}, ` +
        `humanRequired=${analysis.requiresHuman.length}`,
      );
    } catch (err) {
      logger.error(`[task-prep] Analysis failed for "${task.title}"`, err);
    }
  }

  /**
   * Phase 2: 分析結果に基づいてsmall/medium規模の準備ステップを実行する
   */
  private async prepareTask(task: Task, analysis: PrepAnalysis): Promise<void> {
    // large規模のステップは実行しない（人間の判断が必要）
    const executableSteps = analysis.prepSteps.filter((s) => s.effort !== "large");

    if (executableSteps.length === 0) {
      logger.info(`[task-prep] No executable prep steps for "${task.title}"`);
      this.state.tasks[task.id].prepDone = true;
      this.state.tasks[task.id].prepResult = "No executable steps (all large or human-required)";
      this.state.tasks[task.id].prepDoneAt = new Date().toISOString();
      return;
    }

    logger.info(
      `[task-prep] Preparing task "${task.title}": ${executableSteps.length} step(s)`,
    );

    const prompt = this.buildPrepPrompt(task, executableSteps);

    try {
      const result = await execute(prompt, {
        systemPrompt: this.systemPrompt,
        maxExecutionMs: 15 * 60 * 1000, // 15分上限
      });

      const entry = this.state.tasks[task.id];
      entry.prepDone = true;
      entry.prepResult = result.text.slice(0, 5000);
      entry.prepDoneAt = new Date().toISOString();

      // タスクにノートを追加
      const noteLines: string[] = [`[Prep] Preparation completed.`];
      if (analysis.requiresHuman.length > 0) {
        noteLines.push(`\nRequires human action:`);
        for (const item of analysis.requiresHuman) {
          noteLines.push(`- ${item}`);
        }
      }
      noteLines.push(`\n${result.text.slice(0, 1500)}`);
      await this.taskSource.addNote(task.id, noteLines.join("\n"));

      await this.onPrepComplete?.(task, analysis, result.text);
      logger.info(`[task-prep] Preparation complete for "${task.title}"`);
    } catch (err) {
      logger.error(`[task-prep] Preparation failed for "${task.title}"`, err);
    }
  }

  private buildAnalysisPrompt(task: Task): string {
    const parts: string[] = [];

    parts.push(`Analyze the following task and determine what preparation can be done beforehand.`);
    parts.push(``);
    parts.push(`# Task: ${task.title}`);
    parts.push(`Priority: ${task.priority}`);

    if (task.dueDate) {
      parts.push(`Due: ${task.dueDate}`);
    }

    if (task.notes) {
      parts.push(`\nNotes: ${task.notes}`);
    }

    parts.push(``);
    parts.push(`Respond with a JSON object matching this schema:`);
    parts.push(`{`);
    parts.push(`  "canPrepare": boolean,`);
    parts.push(`  "prepSteps": [{ "type": "string", "description": "string", "effort": "small" | "medium" | "large" }],`);
    parts.push(`  "requiresHuman": ["string"],`);
    parts.push(`  "recommendation": "string"`);
    parts.push(`}`);
    parts.push(``);
    parts.push(`- "canPrepare": true if any preparation steps can be done automatically`);
    parts.push(`- "prepSteps": specific preparation actions (research, draft, scaffold, etc.)`);
    parts.push(`- "requiresHuman": list of items that require human decision/action`);
    parts.push(`- "recommendation": brief summary of the recommended approach`);

    return parts.join("\n");
  }

  private buildPrepPrompt(
    task: Task,
    steps: { type: string; description: string; effort: "small" | "medium" | "large" }[],
  ): string {
    const parts: string[] = [];

    parts.push(`Execute the following preparation steps for the task "${task.title}".`);
    parts.push(``);

    if (task.notes) {
      parts.push(`## Task Notes`);
      parts.push(task.notes);
      parts.push(``);
    }

    parts.push(`## Preparation Steps`);
    for (let i = 0; i < steps.length; i++) {
      parts.push(`${i + 1}. [${steps[i].type}] ${steps[i].description} (effort: ${steps[i].effort})`);
    }

    parts.push(``);
    parts.push(`Execute each step and report the results. Do not execute the main task itself.`);
    parts.push(`Focus only on preparation: gathering info, creating drafts, setting up scaffolding, etc.`);

    return parts.join("\n");
  }

  private parseAnalysis(text: string): PrepAnalysis | null {
    try {
      // JSONブロックを抽出（コードフェンスで囲まれている場合に対応）
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[1]);

      // 最低限のバリデーション
      if (typeof parsed.canPrepare !== "boolean") return null;
      if (!Array.isArray(parsed.prepSteps)) parsed.prepSteps = [];
      if (!Array.isArray(parsed.requiresHuman)) parsed.requiresHuman = [];
      if (typeof parsed.recommendation !== "string") parsed.recommendation = "";

      return parsed as PrepAnalysis;
    } catch {
      logger.warn("[task-prep] Failed to parse analysis JSON");
      return null;
    }
  }

  // --- 状態管理 ---

  private get statePath(): string {
    return join(this.stateDir, PREP_STATE_FILE);
  }

  private loadState(): PrepState {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, "utf-8");
        return JSON.parse(raw) as PrepState;
      }
    } catch (err) {
      logger.warn("[task-prep] Failed to load prep state, starting fresh", err);
    }
    return { tasks: {} };
  }

  private saveState(): void {
    try {
      writeFileAtomic(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error("[task-prep] Failed to save prep state", err);
    }
  }
}
