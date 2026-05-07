import * as fs from "fs";
import * as path from "path";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// Slack Web API連携
// Bot TokenでメッセージCRUD、User Tokenで検索（オプション）

const SLACK_API = "https://slack.com/api";

// --- Types ---

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  channel: string;
  threadTs?: string;
  botId?: string;
  attachments?: Array<{
    fallback?: string;
    text?: string;
    title?: string;
  }>;
}

export interface SlackFileInfo {
  id: string;
  name: string;
  title: string;
  mimetype: string;
  size: number;
  permalink: string;
}

// --- Internal types ---

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

interface SlackHistoryResponse extends SlackApiResponse {
  messages?: Array<{
    ts: string;
    user?: string;
    text?: string;
    thread_ts?: string;
    bot_id?: string;
    attachments?: Array<{
      fallback?: string;
      text?: string;
      title?: string;
    }>;
  }>;
  has_more?: boolean;
}

interface SlackSearchResponse extends SlackApiResponse {
  messages?: {
    matches?: Array<{
      ts: string;
      user?: string;
      text?: string;
      channel?: { id?: string; name?: string };
      thread_ts?: string;
    }>;
    total?: number;
  };
}

interface SlackPostMessageResponse extends SlackApiResponse {
  ts?: string;
  channel?: string;
}

interface SlackUploadResponse extends SlackApiResponse {
  file?: {
    id: string;
    name: string;
    title: string;
    mimetype: string;
    size: number;
    permalink: string;
  };
}

interface SlackUploadUrlResponse extends SlackApiResponse {
  upload_url?: string;
  file_id?: string;
}

// --- Internal helpers ---

/** Slack設定済みか判定 */
export function isSlackConfigured(): boolean {
  const config = getConfig();
  return !!config.slack.botToken;
}

/** Slack APIリクエスト共通 */
async function slackFetch<T extends SlackApiResponse>(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return withRetry(
    async () => {
      const resp = await fetch(`${SLACK_API}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!resp.ok) {
        throw new Error(`Slack HTTP error (${resp.status}): ${resp.statusText}`);
      }

      const data = (await resp.json()) as T;
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error || "unknown_error"}`);
      }

      return data;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** Bot Tokenを取得 */
function getBotToken(): string {
  const config = getConfig();
  if (!config.slack.botToken) {
    throw new Error("Slack bot token not configured");
  }
  return config.slack.botToken;
}

/** User Token（検索用）を取得、なければBot Tokenにフォールバック */
function getUserToken(): string {
  const config = getConfig();
  return config.slack.userToken || config.slack.botToken;
}

// --- Public API ---

/**
 * チャンネルにメッセージを送信
 * @param channel チャンネルIDまたはチャンネル名
 * @param text 送信テキスト
 */
export async function sendMessage(
  channel: string,
  text: string,
): Promise<void> {
  if (!isSlackConfigured()) {
    throw new Error("Slack not configured");
  }

  try {
    await slackFetch<SlackPostMessageResponse>(
      "chat.postMessage",
      getBotToken(),
      { channel, text },
    );
    logger.debug("[slack] メッセージ送信完了", channel);
  } catch (err) {
    logger.error("[slack] メッセージ送信エラー", err);
    throw err;
  }
}

/**
 * チャンネルの直近メッセージ履歴を取得
 * @param channel チャンネルID
 * @param limit 取得件数（デフォルト50）
 */
export async function getChannelHistory(
  channel: string,
  limit = 50,
): Promise<SlackMessage[]> {
  if (!isSlackConfigured()) {
    logger.debug("[slack] Slack未設定のためスキップ");
    return [];
  }

  try {
    const result = await slackFetch<SlackHistoryResponse>(
      "conversations.history",
      getBotToken(),
      { channel, limit },
    );

    if (!result.messages) return [];

    return result.messages.map((msg) => ({
      ts: msg.ts,
      user: msg.user || "",
      text: msg.text || "",
      channel,
      threadTs: msg.thread_ts,
      botId: msg.bot_id,
      attachments: msg.attachments,
    }));
  } catch (err) {
    logger.error("[slack] チャンネル履歴取得エラー", err);
    return [];
  }
}

/**
 * メッセージ検索
 * 注意: search.messages にはUser Tokenが必要（Bot Tokenでは使えない）
 * @param query 検索クエリ
 * @param limit 最大件数（デフォルト20）
 */
export async function searchMessages(
  query: string,
  limit = 20,
): Promise<SlackMessage[]> {
  if (!isSlackConfigured()) {
    logger.debug("[slack] Slack未設定のためスキップ");
    return [];
  }

  const token = getUserToken();

  try {
    const result = await slackFetch<SlackSearchResponse>(
      "search.messages",
      token,
      { query, count: limit },
    );

    if (!result.messages?.matches) return [];

    return result.messages.matches.map((match) => ({
      ts: match.ts,
      user: match.user || "",
      text: match.text || "",
      channel: match.channel?.id || "",
      threadTs: match.thread_ts,
    }));
  } catch (err) {
    logger.error("[slack] メッセージ検索エラー", err);
    return [];
  }
}

/**
 * ファイルをチャンネルにアップロード
 * files.uploadV2 API（新方式）を使用
 * @param channel チャンネルID
 * @param filePath ローカルファイルパス
 * @param title ファイルタイトル（省略時はファイル名）
 */
export async function uploadFile(
  channel: string,
  filePath: string,
  title?: string,
): Promise<void> {
  if (!isSlackConfigured()) {
    throw new Error("Slack not configured");
  }

  const token = getBotToken();
  const filename = path.basename(filePath);
  const fileTitle = title || filename;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;

    // Step 1: アップロードURLを取得
    const urlResult = await slackFetch<SlackUploadUrlResponse>(
      "files.getUploadURLExternal",
      token,
      { filename, length: fileSize },
    );

    if (!urlResult.upload_url || !urlResult.file_id) {
      throw new Error("Failed to get upload URL from Slack");
    }

    // Step 2: ファイルをアップロード
    const uploadResp = await withRetry(
      async () => {
        const resp = await fetch(urlResult.upload_url!, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: fileBuffer,
        });
        if (!resp.ok) {
          throw new Error(`File upload failed (${resp.status})`);
        }
        return resp;
      },
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    // Step 3: アップロード完了を通知
    await slackFetch<SlackApiResponse>(
      "files.completeUploadExternal",
      token,
      {
        files: [{ id: urlResult.file_id, title: fileTitle }],
        channel_id: channel,
      },
    );

    logger.debug("[slack] ファイルアップロード完了", filename);
  } catch (err) {
    logger.error("[slack] ファイルアップロードエラー", err);
    throw err;
  }
}
