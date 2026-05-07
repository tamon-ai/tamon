import * as logger from "../utils/logger";

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5分

// チャンネルごとの最終アクティビティ
const lastActivity = new Map<string, number>();
let manualOverride: boolean | null = null;
let cooldownMs = DEFAULT_COOLDOWN_MS;

/**
 * ユーザーメッセージ受信時に呼び出し、アクティビティを記録する
 */
export function registerActivity(channelId: string): void {
  lastActivity.set(channelId, Date.now());
}

/**
 * 自律タスク実行の可否を判定する。
 * アクティブなユーザーセッションを中断しないよう、
 * 全チャンネルが一定時間非アクティブであることを確認する。
 */
export function canRunAutonomousTasks(): { allowed: boolean; reason?: string } {
  // 手動オーバーライドが設定されている場合はそれに従う
  if (manualOverride !== null) {
    return manualOverride
      ? { allowed: true }
      : { allowed: false, reason: "Gate manually closed" };
  }

  const now = Date.now();

  for (const [channelId, ts] of lastActivity) {
    const elapsed = now - ts;
    if (elapsed < cooldownMs) {
      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      return {
        allowed: false,
        reason: `Channel ${channelId} was active ${Math.floor(elapsed / 1000)}s ago (cooldown: ${remainingSec}s remaining)`,
      };
    }
  }

  return { allowed: true };
}

/**
 * ゲートを手動で開閉する。nullを渡すと自動判定に戻る。
 */
export function setGate(open: boolean | null): void {
  manualOverride = open;
  if (open === null) {
    logger.info("[activity-gate] Manual override cleared, returning to auto mode");
  } else {
    logger.info(`[activity-gate] Gate manually ${open ? "opened" : "closed"}`);
  }
}

/**
 * クールダウン時間を変更する（ミリ秒）
 */
export function setCooldown(ms: number): void {
  cooldownMs = ms;
  logger.debug(`[activity-gate] Cooldown set to ${ms}ms`);
}

/**
 * 全アクティビティ記録をクリアする（テスト用）
 */
export function clearActivity(): void {
  lastActivity.clear();
  manualOverride = null;
  cooldownMs = DEFAULT_COOLDOWN_MS;
}
