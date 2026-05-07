import { createHmac, randomBytes } from "crypto";
import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";

// X (Twitter) API v2連携
// OAuth 1.0a（投稿/削除）+ Bearer Token（検索/タイムライン/ユーザー情報）

const X_API = "https://api.x.com/2";

// --- Types ---

export interface Tweet {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  publicMetrics?: {
    likes: number;
    retweets: number;
    replies: number;
  };
}

export interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
}

// --- Internal types ---

interface XApiResponse {
  data?: unknown;
  errors?: Array<{
    message: string;
    type?: string;
    detail?: string;
  }>;
  meta?: {
    result_count?: number;
    next_token?: string;
  };
}

interface XTweetData {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
}

interface XUserData {
  id: string;
  name: string;
  username: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

// --- 設定チェック ---

/** X (Twitter)設定済みか判定 */
export function isXConfigured(): boolean {
  const config = getConfig();
  return !!(config.x?.apiKey && config.x?.accessToken);
}

// --- OAuth 1.0a署名生成 ---

/** RFC 3986準拠のパーセントエンコード */
function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * OAuth 1.0a認証ヘッダーを生成
 * HMAC-SHA1でリクエストに署名
 */
function buildOAuthHeader(
  method: string,
  url: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessTokenSecret: string,
  extraParams?: Record<string, string>,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // 署名ベース文字列の構築: 全パラメータをソートして連結
  const allParams: Record<string, string> = { ...oauthParams, ...extraParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join("&");

  const signatureBase = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");

  // 署名キー: consumer_secret&token_secret
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessTokenSecret)}`;

  // HMAC-SHA1で署名
  const signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  // Authorizationヘッダー組み立て
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(", ");

  return `OAuth ${headerParts}`;
}

// --- Internal helpers ---

/** OAuth 1.0a認証情報を取得 */
function getOAuthCredentials() {
  const config = getConfig();
  const x = config.x;
  if (!x?.apiKey || !x?.apiSecret || !x?.accessToken || !x?.accessTokenSecret) {
    throw new Error("X OAuth credentials not configured");
  }
  return {
    apiKey: x.apiKey,
    apiSecret: x.apiSecret,
    accessToken: x.accessToken,
    accessTokenSecret: x.accessTokenSecret,
  };
}

/** Bearer Token認証を取得 */
function getBearerToken(): string {
  const config = getConfig();
  const token = config.x?.bearerToken;
  if (!token) {
    throw new Error("X bearer token not configured");
  }
  return token;
}

/**
 * OAuth 1.0a認証付きリクエスト（書き込み系）
 */
async function oauthFetch<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const creds = getOAuthCredentials();

  return withRetry(
    async () => {
      const authHeader = buildOAuthHeader(
        method,
        url,
        creds.apiKey,
        creds.apiSecret,
        creds.accessToken,
        creds.accessTokenSecret,
      );

      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        throw new Error(`X API HTTP error (${resp.status}): ${errorBody}`);
      }

      // DELETE成功時は204 No Contentの場合がある
      if (resp.status === 204) {
        return {} as T;
      }

      const data = (await resp.json()) as XApiResponse;
      if (data.errors?.length) {
        throw new Error(
          `X API error: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }

      return data as unknown as T;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/**
 * Bearer Token認証付きリクエスト（読み取り系）
 */
async function bearerFetch<T>(url: string): Promise<T> {
  const token = getBearerToken();

  return withRetry(
    async () => {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        throw new Error(`X API HTTP error (${resp.status}): ${errorBody}`);
      }

      const data = (await resp.json()) as XApiResponse;
      if (data.errors?.length) {
        throw new Error(
          `X API error: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }

      return data as unknown as T;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/** API生データからTweetオブジェクトに変換 */
function parseTweet(raw: XTweetData): Tweet {
  return {
    id: raw.id,
    text: raw.text,
    authorId: raw.author_id || "",
    createdAt: raw.created_at || "",
    publicMetrics: raw.public_metrics
      ? {
          likes: raw.public_metrics.like_count,
          retweets: raw.public_metrics.retweet_count,
          replies: raw.public_metrics.reply_count,
        }
      : undefined,
  };
}

/** API生データからXUserオブジェクトに変換 */
function parseUser(raw: XUserData): XUser {
  return {
    id: raw.id,
    name: raw.name,
    username: raw.username,
    description: raw.description,
    followersCount: raw.public_metrics?.followers_count || 0,
    followingCount: raw.public_metrics?.following_count || 0,
    tweetCount: raw.public_metrics?.tweet_count || 0,
  };
}

// --- Public API ---

/**
 * ツイートを投稿（OAuth 1.0a認証）
 * @param text ツイート本文（280文字以内）
 */
export async function postTweet(text: string): Promise<Tweet | null> {
  if (!isXConfigured()) {
    throw new Error("X not configured");
  }

  try {
    const result = await oauthFetch<{ data: XTweetData }>(
      "POST",
      `${X_API}/tweets`,
      { text },
    );

    if (!result.data) return null;

    const tweet = parseTweet(result.data);
    logger.debug("[x] ツイート投稿完了", tweet.id);
    return tweet;
  } catch (err) {
    logger.error("[x] ツイート投稿エラー", err);
    return null;
  }
}

/**
 * ツイートを削除（OAuth 1.0a認証）
 * @param tweetId 削除するツイートのID
 */
export async function deleteTweet(tweetId: string): Promise<boolean> {
  if (!isXConfigured()) {
    throw new Error("X not configured");
  }

  try {
    await oauthFetch<{ data: { deleted: boolean } }>(
      "DELETE",
      `${X_API}/tweets/${tweetId}`,
    );

    logger.debug("[x] ツイート削除完了", tweetId);
    return true;
  } catch (err) {
    logger.error("[x] ツイート削除エラー", tweetId, err);
    return false;
  }
}

/**
 * ユーザーのタイムラインを取得（Bearer Token認証）
 * @param userId ユーザーID（省略時はgetMe()で自身を取得）
 * @param limit 取得件数（デフォルト10, 最大100）
 */
export async function getTimeline(
  userId?: string,
  limit = 10,
): Promise<Tweet[]> {
  if (!isXConfigured()) {
    logger.debug("[x] X未設定のためスキップ");
    return [];
  }

  try {
    // userIdが未指定の場合、認証ユーザーのIDを取得
    let targetUserId = userId;
    if (!targetUserId) {
      const me = await getMe();
      if (!me) return [];
      targetUserId = me.id;
    }

    const params = new URLSearchParams({
      max_results: String(Math.min(Math.max(limit, 5), 100)),
      "tweet.fields": "author_id,created_at,public_metrics",
    });

    const result = await bearerFetch<{ data?: XTweetData[] }>(
      `${X_API}/users/${targetUserId}/tweets?${params.toString()}`,
    );

    if (!result.data) return [];

    const tweets = result.data.map(parseTweet);
    logger.debug("[x] タイムライン取得完了", `${tweets.length}件`);
    return tweets;
  } catch (err) {
    logger.error("[x] タイムライン取得エラー", err);
    return [];
  }
}

/**
 * 最近のツイートを検索（Bearer Token認証）
 * 直近7日間が対象（Basic/Pro APIアクセスレベルによる）
 * @param queryStr 検索クエリ
 * @param limit 取得件数（デフォルト10, 最大100）
 */
export async function searchTweets(
  queryStr: string,
  limit = 10,
): Promise<Tweet[]> {
  if (!isXConfigured()) {
    logger.debug("[x] X未設定のためスキップ");
    return [];
  }

  try {
    const params = new URLSearchParams({
      query: queryStr,
      max_results: String(Math.min(Math.max(limit, 10), 100)),
      "tweet.fields": "author_id,created_at,public_metrics",
    });

    const result = await bearerFetch<{ data?: XTweetData[] }>(
      `${X_API}/tweets/search/recent?${params.toString()}`,
    );

    if (!result.data) return [];

    const tweets = result.data.map(parseTweet);
    logger.debug("[x] ツイート検索完了", `${tweets.length}件`);
    return tweets;
  } catch (err) {
    logger.error("[x] ツイート検索エラー", err);
    return [];
  }
}

/**
 * 認証ユーザーの情報を取得（Bearer Token認証）
 */
export async function getMe(): Promise<XUser | null> {
  if (!isXConfigured()) {
    logger.debug("[x] X未設定のためスキップ");
    return null;
  }

  try {
    const params = new URLSearchParams({
      "user.fields": "description,public_metrics",
    });

    const result = await bearerFetch<{ data?: XUserData }>(
      `${X_API}/users/me?${params.toString()}`,
    );

    if (!result.data) return null;

    const user = parseUser(result.data);
    logger.debug("[x] ユーザー情報取得完了", user.username);
    return user;
  } catch (err) {
    logger.error("[x] ユーザー情報取得エラー", err);
    return null;
  }
}
