import type { ResultEvaluator } from "./types";

const REVIEW_PATTERNS = [
  /https?:\/\/github\.com\/[^\s]+\/pull\/\d+/i,
  /\bpull request\b/i,
  /\breview\b/i,
  /\bmerge\b/i,
  /\bapproval\b/i,
];

const DONE_PATTERNS = [
  /\bcompleted?\b/i,
  /\bcommitted\b/i,
  /\bdeployed\b/i,
  /\bimplemented\b/i,
  /\bfixed\b/i,
  /\bcreated\b/i,
  /\bsuccessfully\b/i,
  /\bdone\b/i,
  /\bfinished\b/i,
  /\bupdated\b/i,
];

const RETRY_PATTERNS = [
  /\bfailed\b/i,
  /\berror\b/i,
  /\bcannot\b/i,
  /\bunable\b/i,
  /\bpermission denied\b/i,
  /\btimed?\s*out\b/i,
  /\bcrash/i,
  /\brejected\b/i,
  /\baborted\b/i,
];

/**
 * 実行結果テキストからタスクの完了状態を判定する。
 * review > retry > done の優先順で評価する（楽観的デフォルト: done）。
 */
export const defaultEvaluator: ResultEvaluator = (result: string): "done" | "review" | "retry" => {
  if (!result || !result.trim()) {
    return "retry";
  }

  // reviewパターンを先にチェック（PRが作成された場合はレビュー待ち）
  for (const pattern of REVIEW_PATTERNS) {
    if (pattern.test(result)) {
      return "review";
    }
  }

  // 失敗パターンをチェック
  for (const pattern of RETRY_PATTERNS) {
    if (pattern.test(result)) {
      return "retry";
    }
  }

  // 完了パターンをチェック
  for (const pattern of DONE_PATTERNS) {
    if (pattern.test(result)) {
      return "done";
    }
  }

  // デフォルトは楽観的にdone
  return "done";
};
