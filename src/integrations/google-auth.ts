import * as crypto from "crypto";
import * as fs from "fs";
import * as logger from "../utils/logger";
import { getConfig } from "../config";

// Google OAuth/SA認証の二重モード対応
// SA（サービスアカウント）が設定されていればドメインワイド委任で取得、
// 失敗時は自動的にOAuthリフレッシュトークンにフォールバック

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.readonly",
];

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// SAの認証失敗後のクールダウン（30分）
const SA_COOLDOWN_MS = 30 * 60 * 1000;
// トークン有効期限の余裕（5分前に更新）
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

// トークンキャッシュ: キーはユーザーメール（SAの場合）または"oauth"
const tokenCache = new Map<string, CachedToken>();

let saFailedAt: number | null = null;
let saKeyData: ServiceAccountKey | null = null;

/** SA鍵ファイルの読み込み（遅延・キャッシュ） */
function loadSAKey(): ServiceAccountKey | null {
  if (saKeyData) return saKeyData;

  const config = getConfig();
  const keyFile = config.google.saKeyFile;
  if (!keyFile) return null;

  try {
    const raw = fs.readFileSync(keyFile, "utf-8");
    saKeyData = JSON.parse(raw) as ServiceAccountKey;
    return saKeyData;
  } catch (err) {
    logger.error("[google-auth] SA鍵ファイルの読み込みに失敗", err);
    return null;
  }
}

/** Base64url エンコード */
function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SA用JWTの生成 */
function createSAJwt(saKey: ServiceAccountKey, userEmail: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: saKey.private_key_id,
  };
  const payload = {
    iss: saKey.client_email,
    sub: userEmail,
    scope: GOOGLE_SCOPES.join(" "),
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };

  const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const signingInput = segments.join(".");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(saKey.private_key);

  return `${signingInput}.${base64url(signature)}`;
}

/** SA経由でアクセストークンを取得 */
async function getTokenViaSA(userEmail: string): Promise<string> {
  const saKey = loadSAKey();
  if (!saKey) {
    throw new Error("SA key not available");
  }

  const jwt = createSAJwt(saKey, userEmail);

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SA token request failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  const cacheKey = `sa:${userEmail}`;
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.access_token;
}

/** OAuthリフレッシュトークン経由でアクセストークンを取得 */
async function getTokenViaOAuth(): Promise<string> {
  const config = getConfig();
  const { oauthClientId, oauthClientSecret, oauthRefreshToken } = config.google;

  if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) {
    throw new Error("OAuth credentials not configured");
  }

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      refresh_token: oauthRefreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OAuth token refresh failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache.set("oauth", {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.access_token;
}

/** キャッシュからトークンを取得（有効期限内のもの） */
function getCachedToken(key: string): string | null {
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }
  if (cached) {
    tokenCache.delete(key);
  }
  return null;
}

/** SAがクールダウン中かどうか */
function isSACoolingDown(): boolean {
  if (saFailedAt === null) return false;
  if (Date.now() - saFailedAt > SA_COOLDOWN_MS) {
    saFailedAt = null;
    return false;
  }
  return true;
}

/**
 * Google APIアクセストークンを取得する
 * SA（サービスアカウント）が設定されていればドメインワイド委任で取得、
 * 失敗時は30分クールダウンの後OAuthにフォールバック
 *
 * @param userEmail SA委任時のimpersonateメール（省略時はconfig値）
 */
export async function getAccessToken(userEmail?: string): Promise<string> {
  const config = getConfig();
  const impersonateEmail = userEmail || config.google.saImpersonateEmail;

  // SA経由を試みる（設定済み、クールダウン外の場合）
  const saKey = loadSAKey();
  if (saKey && impersonateEmail && !isSACoolingDown()) {
    const cacheKey = `sa:${impersonateEmail}`;
    const cached = getCachedToken(cacheKey);
    if (cached) return cached;

    try {
      const token = await getTokenViaSA(impersonateEmail);
      logger.debug("[google-auth] SA委任でトークン取得成功");
      return token;
    } catch (err) {
      logger.warn("[google-auth] SA委任失敗、OAuthにフォールバック", err);
      saFailedAt = Date.now();
    }
  }

  // OAuthフォールバック
  const cachedOAuth = getCachedToken("oauth");
  if (cachedOAuth) return cachedOAuth;

  try {
    const token = await getTokenViaOAuth();
    logger.debug("[google-auth] OAuthでトークン取得成功");
    return token;
  } catch (err) {
    logger.error("[google-auth] OAuthトークン取得にも失敗", err);
    throw new Error("All Google authentication methods failed");
  }
}

/**
 * Google連携が設定されているか判定
 * SA鍵 または OAuthクレデンシャルのいずれかがあればtrue
 */
export function isGoogleConfigured(): boolean {
  const config = getConfig();
  const hasSA = !!config.google.saKeyFile;
  const hasOAuth =
    !!config.google.oauthClientId &&
    !!config.google.oauthClientSecret &&
    !!config.google.oauthRefreshToken;
  return hasSA || hasOAuth;
}
