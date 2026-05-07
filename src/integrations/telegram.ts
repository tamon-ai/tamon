import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// Telegram Bot API連携
// MTProtoは使わず、シンプルなHTTP Bot APIで実装（OSS向け）

const TELEGRAM_API = "https://api.telegram.org";

// --- Types ---

export interface TelegramUser {
  id: number;
  isBot: boolean;
  firstName: string;
  lastName?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string; // "private" | "group" | "supergroup" | "channel"
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TelegramMessage {
  messageId: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number; // Unix timestamp
  text?: string;
  replyToMessage?: TelegramMessage;
}

export interface TelegramUpdate {
  updateId: number;
  message?: TelegramMessage;
  editedMessage?: TelegramMessage;
  channelPost?: TelegramMessage;
}

// --- Internal types ---

interface TgApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  reply_to_message?: TgMessage;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

// --- Internal helpers ---

/** Telegram Bot設定済みか判定 */
export function isTelegramConfigured(): boolean {
  const config = getConfig();
  return !!config.telegram.botToken;
}

/** Bot TokenからAPI URLベースを構築 */
function getApiBase(): string {
  const config = getConfig();
  if (!config.telegram.botToken) {
    throw new Error("Telegram bot token not configured");
  }
  return `${TELEGRAM_API}/bot${config.telegram.botToken}`;
}

/** Telegram APIリクエスト共通 */
async function telegramFetch<T>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const apiBase = getApiBase();

  return withRetry(
    async () => {
      const options: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      };
      if (body) {
        options.body = JSON.stringify(body);
      }

      const resp = await fetch(`${apiBase}/${method}`, options);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Telegram API HTTP error (${resp.status}): ${text}`);
      }

      const data = (await resp.json()) as TgApiResponse<T>;
      if (!data.ok) {
        throw new Error(
          `Telegram API error (${data.error_code}): ${data.description}`,
        );
      }

      return data.result;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** TgUserをTelegramUserに変換（snake_case → camelCase） */
function toTelegramUser(u: TgUser): TelegramUser {
  return {
    id: u.id,
    isBot: u.is_bot,
    firstName: u.first_name,
    lastName: u.last_name,
    username: u.username,
  };
}

/** TgChatをTelegramChatに変換 */
function toTelegramChat(c: TgChat): TelegramChat {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    username: c.username,
    firstName: c.first_name,
    lastName: c.last_name,
  };
}

/** TgMessageをTelegramMessageに変換（再帰対応: reply_to_message） */
function toTelegramMessage(m: TgMessage): TelegramMessage {
  const result: TelegramMessage = {
    messageId: m.message_id,
    chat: toTelegramChat(m.chat),
    date: m.date,
    text: m.text,
  };
  if (m.from) {
    result.from = toTelegramUser(m.from);
  }
  if (m.reply_to_message) {
    result.replyToMessage = toTelegramMessage(m.reply_to_message);
  }
  return result;
}

/** TgUpdateをTelegramUpdateに変換 */
function toTelegramUpdate(u: TgUpdate): TelegramUpdate {
  const result: TelegramUpdate = { updateId: u.update_id };
  if (u.message) {
    result.message = toTelegramMessage(u.message);
  }
  if (u.edited_message) {
    result.editedMessage = toTelegramMessage(u.edited_message);
  }
  if (u.channel_post) {
    result.channelPost = toTelegramMessage(u.channel_post);
  }
  return result;
}

// --- Public API ---

/**
 * メッセージを送信
 * @param chatId チャットID（数値文字列 or @username）
 * @param text 送信テキスト（Markdown対応）
 */
export async function sendMessage(
  chatId: string,
  text: string,
): Promise<void> {
  if (!isTelegramConfigured()) {
    throw new Error("Telegram not configured");
  }

  try {
    // Telegramのメッセージ上限: 4096文字
    // 超える場合は分割送信
    const MAX_LENGTH = 4096;

    if (text.length <= MAX_LENGTH) {
      await telegramFetch<TgMessage>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      });
    } else {
      // 長文分割送信
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_LENGTH) {
          chunks.push(remaining);
          break;
        }
        // 改行位置で分割を試みる
        let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
        if (splitAt < MAX_LENGTH * 0.5) {
          // 改行が遠すぎる場合はスペースで分割
          splitAt = remaining.lastIndexOf(" ", MAX_LENGTH);
        }
        if (splitAt < MAX_LENGTH * 0.5) {
          // それでもダメなら強制分割
          splitAt = MAX_LENGTH;
        }
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
      }

      for (const chunk of chunks) {
        await telegramFetch<TgMessage>("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        });
      }
    }

    logger.debug("[telegram] メッセージ送信完了", chatId);
  } catch (err) {
    logger.error("[telegram] メッセージ送信エラー", err);
    throw err;
  }
}

/**
 * 未処理のアップデートを取得（ロングポーリング用途にも対応）
 * @param offset 前回のupdate_id + 1（既読位置の管理に使用）
 * @param limit 最大取得件数（デフォルト100、上限100）
 */
export async function getUpdates(
  offset?: number,
  limit = 100,
): Promise<TelegramUpdate[]> {
  if (!isTelegramConfigured()) {
    logger.debug("[telegram] Telegram未設定のためスキップ");
    return [];
  }

  try {
    const params: Record<string, unknown> = {
      limit: Math.min(limit, 100),
    };
    if (offset !== undefined) {
      params.offset = offset;
    }

    const updates = await telegramFetch<TgUpdate[]>("getUpdates", params);
    return updates.map(toTelegramUpdate);
  } catch (err) {
    logger.error("[telegram] アップデート取得エラー", err);
    return [];
  }
}

/**
 * Bot情報を取得（接続テスト用途にも使える）
 */
export async function getMe(): Promise<TelegramUser> {
  if (!isTelegramConfigured()) {
    throw new Error("Telegram not configured");
  }

  try {
    const result = await telegramFetch<TgUser>("getMe");
    return toTelegramUser(result);
  } catch (err) {
    logger.error("[telegram] getMe エラー", err);
    throw err;
  }
}
