import type { Task, TaskScorer } from "./types";

const PRIORITY_SCORES: Record<Task["priority"], number> = {
  high: 50,
  medium: 20,
  low: 0,
};

/**
 * タスクの優先度スコアを算出する。
 * スコアが高いほど先に実行される。
 *
 * - 期限超過: base 100 + 超過日数 * 10
 * - 優先度: high +50, medium +20, low +0
 * - 期限近接: 24h以内 +30, 3日以内 +15
 * - 期限未設定: +5（低優先度のタイブレーク）
 */
export const defaultScorer: TaskScorer = (task: Task): number => {
  let score = 0;
  const now = Date.now();

  // 優先度
  score += PRIORITY_SCORES[task.priority] ?? 0;

  if (task.dueDate) {
    const due = new Date(task.dueDate).getTime();
    const diffMs = due - now;
    const diffDays = diffMs / (24 * 60 * 60 * 1000);

    if (diffMs < 0) {
      // 期限超過
      const overdueDays = Math.abs(diffDays);
      score += 100 + overdueDays * 10;
    } else if (diffDays <= 1) {
      // 24時間以内
      score += 30;
    } else if (diffDays <= 3) {
      // 3日以内
      score += 15;
    }
  } else {
    // 期限未設定のタイブレーク
    score += 5;
  }

  return score;
};
