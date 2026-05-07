import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Google Search Console API（Webmasters v3）操作
// サイト一覧・検索パフォーマンス分析をサポート

const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";

// --- Types ---

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResult {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: QueryRow[];
}

// --- Internal types ---

interface SiteListResponse {
  siteEntry?: Array<{
    siteUrl?: string;
    permissionLevel?: string;
  }>;
}

interface SearchAnalyticsResponse {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
  responseAggregationType?: string;
}

// --- Internal helpers ---

/** Search Console設定済みか判定（google-authに委任） */
export function isSearchConsoleConfigured(): boolean {
  return isGoogleConfigured();
}

/** Search Console APIリクエスト共通 */
async function searchConsoleFetch<T>(
  urlPath: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();

  return withRetry(
    async () => {
      const resp = await fetch(`${SEARCH_CONSOLE_API}${urlPath}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Search Console API error (${resp.status}): ${body}`);
      }

      if (resp.status === 204) {
        return undefined as unknown as T;
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/**
 * ISO 8601日付文字列を生成（日数前）
 * @param daysAgo 何日前か
 */
function daysAgoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// --- Public API ---

/**
 * 登録済みサイトの一覧を取得
 */
export async function getSiteList(): Promise<SiteEntry[]> {
  if (!isSearchConsoleConfigured()) {
    logger.debug("[search-console] Google未設定のためスキップ");
    return [];
  }

  try {
    const result = await searchConsoleFetch<SiteListResponse>("/sites");

    if (!result.siteEntry) return [];

    return result.siteEntry.map((entry) => ({
      siteUrl: entry.siteUrl || "",
      permissionLevel: entry.permissionLevel || "unknown",
    }));
  } catch (err) {
    logger.error("[search-console] サイト一覧取得エラー", err);
    return [];
  }
}

/**
 * 検索パフォーマンスデータを取得
 * @param siteUrl 対象サイトURL（Search Consoleに登録済みのもの）
 * @param days 取得期間の日数（デフォルト28日）
 * @param limit クエリ数の上限（デフォルト25）
 */
export async function getSearchAnalytics(
  siteUrl: string,
  days = 28,
  limit = 25,
): Promise<SearchAnalyticsResult> {
  const emptyResult: SearchAnalyticsResult = {
    totalClicks: 0,
    totalImpressions: 0,
    avgCtr: 0,
    avgPosition: 0,
    topQueries: [],
  };

  if (!isSearchConsoleConfigured()) {
    logger.debug("[search-console] Google未設定のためスキップ");
    return emptyResult;
  }

  try {
    const encodedSiteUrl = encodeURIComponent(siteUrl);

    const body = {
      startDate: daysAgoDate(days),
      endDate: daysAgoDate(1), // 最新データは前日まで
      dimensions: ["query"],
      rowLimit: limit,
      type: "web",
    };

    const result = await searchConsoleFetch<SearchAnalyticsResponse>(
      `/sites/${encodedSiteUrl}/searchAnalytics/query`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    if (!result.rows || result.rows.length === 0) {
      return emptyResult;
    }

    // 集計値の計算
    let totalClicks = 0;
    let totalImpressions = 0;
    let weightedCtr = 0;
    let weightedPosition = 0;

    const topQueries: QueryRow[] = result.rows.map((row) => {
      const clicks = row.clicks || 0;
      const impressions = row.impressions || 0;
      const ctr = row.ctr || 0;
      const position = row.position || 0;

      totalClicks += clicks;
      totalImpressions += impressions;
      weightedCtr += ctr * impressions;
      weightedPosition += position * impressions;

      return {
        query: row.keys?.[0] || "",
        clicks,
        impressions,
        ctr: Math.round(ctr * 10000) / 100, // パーセント表記（小数2桁）
        position: Math.round(position * 10) / 10,
      };
    });

    return {
      totalClicks,
      totalImpressions,
      avgCtr:
        totalImpressions > 0
          ? Math.round((weightedCtr / totalImpressions) * 10000) / 100
          : 0,
      avgPosition:
        totalImpressions > 0
          ? Math.round((weightedPosition / totalImpressions) * 10) / 10
          : 0,
      topQueries,
    };
  } catch (err) {
    logger.error("[search-console] 検索パフォーマンス取得エラー", err);
    return emptyResult;
  }
}

/**
 * トップ検索クエリを取得（getSearchAnalyticsの簡易版）
 * @param siteUrl 対象サイトURL
 * @param days 取得期間の日数（デフォルト28日）
 */
export async function getTopQueries(
  siteUrl: string,
  days = 28,
): Promise<QueryRow[]> {
  const result = await getSearchAnalytics(siteUrl, days);
  return result.topQueries;
}
