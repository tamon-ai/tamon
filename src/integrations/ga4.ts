import * as logger from "../utils/logger";
import { withRetry } from "../utils/retry";
import { getConfig } from "../config";
import { getAccessToken, isGoogleConfigured } from "./google-auth";

// Google Analytics Data API v1beta 操作
// GA4プロパティのレポート実行・ページビュー・アクティブユーザー取得をサポート

const GA4_API = "https://analyticsdata.googleapis.com/v1beta";

// --- Types ---

export interface GA4Row {
  dimensions: Record<string, string>;
  metrics: Record<string, string | number>;
}

// --- Internal types ---

interface GA4RunReportRequest {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  metrics: Array<{ name: string }>;
  dimensions?: Array<{ name: string }>;
  limit?: number;
  orderBys?: Array<{
    metric?: { metricName: string };
    dimension?: { dimensionName: string };
    desc?: boolean;
  }>;
}

interface GA4RunReportResponse {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
  rowCount?: number;
}

// --- Internal helpers ---

/** GA4設定済みか判定（propertyIdとGoogle認証の両方が必要） */
export function isGA4Configured(): boolean {
  const config = getConfig();
  return !!config.ga4.propertyId && isGoogleConfigured();
}

/** GA4プロパティIDを取得 */
function getPropertyId(): string {
  const config = getConfig();
  const propertyId = config.ga4.propertyId;
  if (!propertyId) {
    throw new Error("GA4 property ID not configured");
  }
  return propertyId;
}

/** GA4 APIリクエスト共通 */
async function ga4Fetch<T>(
  urlPath: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();

  return withRetry(
    async () => {
      const resp = await fetch(`${GA4_API}${urlPath}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`GA4 API error (${resp.status}): ${body}`);
      }

      return resp.json() as Promise<T>;
    },
    { maxAttempts: 3, baseDelayMs: 1000 },
  );
}

/**
 * 日数指定を GA4 日付文字列に変換
 * @param daysAgo 何日前か
 * @returns "YYYY-MM-DD" 形式の文字列
 */
function daysAgoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

/** GA4レスポンスをGA4Row配列に変換 */
function parseReportResponse(response: GA4RunReportResponse): GA4Row[] {
  if (!response.rows || response.rows.length === 0) return [];

  const dimensionNames = (response.dimensionHeaders || []).map((h) => h.name);
  const metricNames = (response.metricHeaders || []).map((h) => h.name);
  const metricTypes = (response.metricHeaders || []).map((h) => h.type);

  return response.rows.map((row) => {
    const dimensions: Record<string, string> = {};
    const metrics: Record<string, string | number> = {};

    // ディメンション値をマッピング
    if (row.dimensionValues) {
      row.dimensionValues.forEach((val, i) => {
        if (i < dimensionNames.length) {
          dimensions[dimensionNames[i]] = val.value;
        }
      });
    }

    // メトリクス値をマッピング（数値型は数値に変換）
    if (row.metricValues) {
      row.metricValues.forEach((val, i) => {
        if (i < metricNames.length) {
          const type = metricTypes[i] || "";
          // INTEGER/FLOAT型の場合は数値に変換
          if (
            type === "TYPE_INTEGER" ||
            type === "TYPE_FLOAT" ||
            type === "TYPE_SECONDS" ||
            type === "TYPE_CURRENCY"
          ) {
            metrics[metricNames[i]] = Number(val.value);
          } else {
            metrics[metricNames[i]] = val.value;
          }
        }
      });
    }

    return { dimensions, metrics };
  });
}

// --- Public API ---

/**
 * GA4レポートを実行
 * @param params レポートパラメータ（期間、メトリクス、ディメンション）
 */
export async function runReport(params: {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
}): Promise<GA4Row[]> {
  if (!isGA4Configured()) {
    logger.debug("[ga4] GA4未設定のためスキップ");
    return [];
  }

  try {
    const propertyId = getPropertyId();

    const body: GA4RunReportRequest = {
      dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
      metrics: params.metrics.map((name) => ({ name })),
    };

    if (params.dimensions && params.dimensions.length > 0) {
      body.dimensions = params.dimensions.map((name) => ({ name }));
    }
    if (params.limit) {
      body.limit = params.limit;
    }

    const result = await ga4Fetch<GA4RunReportResponse>(
      `/properties/${propertyId}:runReport`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    return parseReportResponse(result);
  } catch (err) {
    logger.error("[ga4] レポート実行エラー", err);
    return [];
  }
}

/**
 * ページビューをページパス別に取得
 * @param days 取得期間の日数（デフォルト30日）
 */
export async function getPageViews(days = 30): Promise<GA4Row[]> {
  return runReport({
    startDate: daysAgoDate(days),
    endDate: "today",
    metrics: ["screenPageViews"],
    dimensions: ["pagePath"],
    limit: 50,
  });
}

/**
 * アクティブユーザー数を取得
 * @param days 取得期間の日数（デフォルト30日）
 */
export async function getActiveUsers(days = 30): Promise<number> {
  if (!isGA4Configured()) {
    logger.debug("[ga4] GA4未設定のためスキップ");
    return 0;
  }

  try {
    const rows = await runReport({
      startDate: daysAgoDate(days),
      endDate: "today",
      metrics: ["activeUsers"],
    });

    if (rows.length === 0) return 0;

    const value = rows[0].metrics["activeUsers"];
    return typeof value === "number" ? value : Number(value) || 0;
  } catch (err) {
    logger.error("[ga4] アクティブユーザー取得エラー", err);
    return 0;
  }
}

/**
 * トップページを閲覧数順に取得
 * @param days 取得期間の日数（デフォルト30日）
 * @param limit 取得件数（デフォルト20）
 */
export async function getTopPages(
  days = 30,
  limit = 20,
): Promise<GA4Row[]> {
  if (!isGA4Configured()) {
    logger.debug("[ga4] GA4未設定のためスキップ");
    return [];
  }

  try {
    const propertyId = getPropertyId();

    const body: GA4RunReportRequest = {
      dateRanges: [{ startDate: daysAgoDate(days), endDate: "today" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      limit,
      orderBys: [
        { metric: { metricName: "screenPageViews" }, desc: true },
      ],
    };

    const result = await ga4Fetch<GA4RunReportResponse>(
      `/properties/${propertyId}:runReport`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    return parseReportResponse(result);
  } catch (err) {
    logger.error("[ga4] トップページ取得エラー", err);
    return [];
  }
}

/**
 * GA4レポート結果をMarkdown形式にフォーマット
 * @param rows GA4Row配列
 */
export function formatReport(rows: GA4Row[]): string {
  if (rows.length === 0) return "データがありません。";

  // ヘッダー行の構築（最初の行からキー名を取得）
  const dimKeys = Object.keys(rows[0].dimensions);
  const metricKeys = Object.keys(rows[0].metrics);
  const allKeys = [...dimKeys, ...metricKeys];

  if (allKeys.length === 0) return "データがありません。";

  // Markdownテーブルのヘッダー
  const header = `| ${allKeys.join(" | ")} |`;
  const separator = `| ${allKeys.map(() => "---").join(" | ")} |`;

  // データ行
  const dataRows = rows.map((row) => {
    const values = [
      ...dimKeys.map((k) => row.dimensions[k] || ""),
      ...metricKeys.map((k) => {
        const v = row.metrics[k];
        if (typeof v === "number") {
          return v.toLocaleString("ja-JP");
        }
        return String(v || "");
      }),
    ];
    return `| ${values.join(" | ")} |`;
  });

  return [header, separator, ...dataRows].join("\n");
}
