import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Gmail REST API操作
// RFC 2047対応のヘッダーエンコーディング、Base64urlボディエンコーディング

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// --- Types ---

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
  hasAttachments: boolean;
  attachments: AttachmentInfo[];
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  snippet: string;
}

// --- Internal helpers ---

/** Base64url エンコード（Node.js Buffer使用） */
function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64urlデコード */
function base64urlDecode(input: string): string {
  // パディングを復元
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

/**
 * RFC 2047エンコード: 非ASCIIヘッダー用
 * Subject等に日本語が含まれる場合に使用
 */
function rfc2047Encode(text: string): string {
  // ASCII-onlyならそのまま
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const encoded = Buffer.from(text, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

/** Gmail APIリクエスト共通 */
async function gmailFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();

  return withRetry(
    async () => {
      const resp = await fetch(`${GMAIL_API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Gmail API error (${resp.status}): ${body}`);
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** メッセージヘッダーからフィールドを取得 */
function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value || "";
}

/** メッセージのパート構造からテキストボディを再帰的に抽出 */
function extractTextBody(payload: GmailPayload): string {
  // 単一パートの場合
  if (payload.body?.data) {
    const mimeType = payload.mimeType || "";
    if (mimeType === "text/plain" || mimeType === "text/html") {
      return base64urlDecode(payload.body.data);
    }
  }

  // マルチパートの場合: text/plain優先、なければtext/html
  if (payload.parts) {
    // まずtext/plainを探す
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return base64urlDecode(part.body.data);
      }
    }
    // text/plainがなければtext/htmlを探す
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return base64urlDecode(part.body.data);
      }
    }
    // ネストされたmultipart内を再帰探索
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith("multipart/") && part.parts) {
        const found = extractTextBody(part);
        if (found) return found;
      }
    }
  }

  return "";
}

/** 添付ファイル情報を抽出 */
function extractAttachments(payload: GmailPayload): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function walk(parts: GmailPayload[]): void {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        walk(part.parts);
      }
    }
  }

  if (payload.parts) {
    walk(payload.parts);
  }

  return attachments;
}

/** Gmail APIメッセージからEmailSummaryに変換 */
function toEmailSummary(msg: GmailMessage): EmailSummary {
  const headers = msg.payload?.headers || [];
  const attachments = msg.payload ? extractAttachments(msg.payload) : [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    snippet: msg.snippet || "",
    date: getHeader(headers, "Date"),
    labels: msg.labelIds || [],
    hasAttachments: attachments.length > 0,
    attachments,
  };
}

// --- Gmail API response types (internal) ---

interface GmailPayload {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPayload;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailThreadResponse {
  id: string;
  messages: GmailMessage[];
}

interface GmailDraftResponse {
  id: string;
  message: { id: string; threadId: string };
}

interface GmailProfileResponse {
  emailAddress: string;
}

// --- Public API ---

/**
 * 過去24時間の未読メールを取得
 * @param maxResults 最大件数（デフォルト20）
 */
export async function getUnreadEmails(
  maxResults = 20,
): Promise<EmailSummary[]> {
  if (!isGoogleConfigured()) {
    logger.debug("[gmail] Google未設定のためスキップ");
    return [];
  }

  try {
    // 過去24時間のフィルタ
    const after = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const query = `is:unread after:${after}`;
    return searchEmails(query, maxResults);
  } catch (err) {
    logger.error("[gmail] 未読メール取得エラー", err);
    return [];
  }
}

/**
 * Gmailクエリでメール検索
 * @param query Gmailの検索クエリ（例: "from:someone@example.com is:unread"）
 * @param maxResults 最大件数（デフォルト20）
 */
export async function searchEmails(
  query: string,
  maxResults = 20,
): Promise<EmailSummary[]> {
  if (!isGoogleConfigured()) {
    logger.debug("[gmail] Google未設定のためスキップ");
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
    });

    const listResult = await gmailFetch<GmailListResponse>(
      `/messages?${params}`,
    );

    if (!listResult.messages || listResult.messages.length === 0) {
      return [];
    }

    // 各メッセージの詳細を取得（並列実行、ただしレート制限考慮で10件ずつ）
    const results: EmailSummary[] = [];
    const batchSize = 10;

    for (let i = 0; i < listResult.messages.length; i += batchSize) {
      const batch = listResult.messages.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map((m) =>
          gmailFetch<GmailMessage>(
            `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          ),
        ),
      );
      results.push(...details.map(toEmailSummary));
    }

    return results;
  } catch (err) {
    logger.error("[gmail] メール検索エラー", err);
    return [];
  }
}

/**
 * メールの本文を取得
 * @param messageId GmailメッセージID
 */
export async function getEmailBody(messageId: string): Promise<string> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  try {
    const msg = await gmailFetch<GmailMessage>(
      `/messages/${messageId}?format=full`,
    );

    if (!msg.payload) {
      return msg.snippet || "";
    }

    return extractTextBody(msg.payload);
  } catch (err) {
    logger.error("[gmail] メール本文取得エラー", err);
    throw err;
  }
}

/**
 * スレッドの全メッセージを取得
 * @param threadId GmailスレッドID
 */
export async function getThread(threadId: string): Promise<ThreadMessage[]> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  try {
    const thread = await gmailFetch<GmailThreadResponse>(
      `/threads/${threadId}?format=full`,
    );

    return thread.messages.map((msg) => {
      const headers = msg.payload?.headers || [];
      const body = msg.payload ? extractTextBody(msg.payload) : "";

      return {
        id: msg.id,
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        date: getHeader(headers, "Date"),
        body,
        snippet: msg.snippet || "",
      };
    });
  } catch (err) {
    logger.error("[gmail] スレッド取得エラー", err);
    throw err;
  }
}

/**
 * 下書きを作成
 * @param to 宛先メールアドレス
 * @param subject 件名
 * @param body 本文
 * @param threadId スレッドID（返信の場合）
 * @returns 下書きリンク
 */
export async function createDraft(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
): Promise<string> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  try {
    // RFC 2822形式のメールメッセージを構築
    const encodedSubject = rfc2047Encode(subject);
    const rawLines = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      Buffer.from(body, "utf-8").toString("base64"),
    ];

    const rawMessage = base64urlEncode(rawLines.join("\r\n"));

    const payload: { message: { raw: string; threadId?: string } } = {
      message: { raw: rawMessage },
    };
    if (threadId) {
      payload.message.threadId = threadId;
    }

    const draft = await gmailFetch<GmailDraftResponse>("/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Gmail下書きリンクを構築
    return `https://mail.google.com/mail/#drafts/${draft.message.id}`;
  } catch (err) {
    logger.error("[gmail] 下書き作成エラー", err);
    throw err;
  }
}

/**
 * 認証済みユーザーのメールアドレスを取得
 */
export async function getMyEmail(): Promise<string> {
  if (!isGoogleConfigured()) {
    throw new Error("Google not configured");
  }

  try {
    const profile = await gmailFetch<GmailProfileResponse>("/profile");
    return profile.emailAddress;
  } catch (err) {
    logger.error("[gmail] プロフィール取得エラー", err);
    throw err;
  }
}
